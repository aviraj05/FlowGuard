"""
FlowGuard Backend API
FastAPI REST endpoints and WebSocket event streaming for network intrusion detection.
"""

import os
import sys
import time
import platform
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, HTMLResponse

# Add backend directory to sys.path
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from schemas import (
    FlowRecordInput,
    FlowBatchInput,
    FlowPredictionResponse,
    HealthResponse,
    ModelInfoResponse,
    BackendFailRequest,
    LabActionResponse,
    DashboardSnapshot,
    EventItem,
    ExperimentRunCreate,
    FlowSubmission,
)
from model_pipeline import get_pipeline, LABEL_MAP
import database
from websocket_manager import manager
from replay import replay_engine
from report_generator import build_experiment_report, generate_report_csv, generate_report_html
from feature_mapping import map_flow_to_features

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("flowguard.api")

app = FastAPI(
    title="FlowGuard Security API",
    description="Inference API, telemetry persistence, and lab controls for FlowGuard Network Monitor",
    version="1.0.0"
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

START_TIME = time.time()

# In-memory lab backend states
LAB_BACKENDS = {
    "Backend-01": {"id": "Backend-01", "name": "Primary Ingress", "ip": "10.0.0.1", "weight": 40, "status": "HEALTHY", "failed": False},
    "Backend-02": {"id": "Backend-02", "name": "Secondary Ingress", "ip": "10.0.0.2", "weight": 35, "status": "HEALTHY", "failed": False},
    "Backend-03": {"id": "Backend-03", "name": "Analytics Node", "ip": "10.0.0.3", "weight": 25, "status": "HEALTHY", "failed": False},
}


@app.on_event("startup")
async def startup_event():
    database.init_db()
    # Warm up pipeline
    pipeline = get_pipeline()
    logger.info("FlowGuard API initialized. OS: %s, Model loaded: %s", platform.system(), pipeline.is_loaded)


@app.get("/api/v1/health", response_model=HealthResponse)
async def health_check():
    """Returns service health, model readiness, and OS runtime info."""
    pipeline = get_pipeline()
    os_sys = platform.system()
    mininet_supported = os_sys == "Linux"
    collector_mode = "Mininet Native (Linux)" if mininet_supported else "Offline Flow Replay (Windows/Portable)"

    return HealthResponse(
        status="HEALTHY" if pipeline.is_loaded else "DEGRADED",
        service="flowguard-backend",
        model_loaded=pipeline.is_loaded,
        model_version="DecisionTree_UNSW90_v1.0",
        schema_version="flowguard-unsw-90-v1",
        os_environment=f"{os_sys} {platform.release()}",
        mininet_supported=mininet_supported,
        collector_mode=collector_mode,
        uptime_seconds=round(time.time() - START_TIME, 2)
    )


@app.get("/api/v1/model/info", response_model=ModelInfoResponse)
async def model_info():
    """Returns the model schema, feature order, and documented assumptions."""
    pipeline = get_pipeline()
    info = pipeline.get_info()
    return ModelInfoResponse(**info)


@app.post("/api/v1/flows/predict", response_model=FlowPredictionResponse)
async def predict_single_flow(flow: FlowRecordInput):
    """
    Scores a single network flow record through the 90-feature Decision Tree pipeline.
    Persists decision to event store and broadcasts over WebSocket.
    """
    pipeline = get_pipeline()
    flow_data = flow.model_dump(exclude_unset=False)
    flow_id = flow.flow_id or f"flow-{uuid.uuid4().hex[:8]}"
    flow_data["flow_id"] = flow_id

    # If extra_features provided, merge into dict
    if flow.extra_features:
        for k, v in flow.extra_features.items():
            flow_data[k] = v

    try:
        res = pipeline.predict_flow(flow_data)
    except Exception as err:
        logger.error("Inference failure for flow %s: %s", flow_id, err)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Feature extraction or scoring failed: {str(err)}"
        )

    event_record = {
        "event_id": flow_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "src_ip": flow.srcip or "0.0.0.0",
        "dst_ip": flow.dstip or "0.0.0.0",
        "src_port": flow.sport or 0,
        "dst_port": flow.dsport or 0,
        "proto": flow.proto or "tcp",
        "service": flow.service or "-",
        "label": res["label"],
        "label_name": res["label_name"],
        "risk_score": res["risk_score"],
        "action": res["action"],
        "severity": res["severity"],
        "model_version": res["model_version"],
        "source_type": "api"
    }

    # Persist and broadcast
    database.save_event(event_record)
    await manager.broadcast({
        "type": "flow_event",
        "data": event_record
    })

    return FlowPredictionResponse(
        flow_id=flow_id,
        label=res["label"],
        label_name=res["label_name"],
        probabilities=res["probabilities"],
        risk_score=res["risk_score"],
        action=res["action"],
        severity=res["severity"],
        model_version=res["model_version"],
        schema_version="flowguard-unsw-90-v1",
        timestamp=event_record["timestamp"]
    )


@app.post("/api/v1/flows/predict_batch")
async def predict_batch_flows(batch: FlowBatchInput):
    """Scores up to 100 flow records in a single batch request."""
    pipeline = get_pipeline()
    flows_data = []
    for item in batch.flows:
        d = item.model_dump(exclude_unset=False)
        if not d.get("flow_id"):
            d["flow_id"] = f"batch-flow-{uuid.uuid4().hex[:6]}"
        if item.extra_features:
            d.update(item.extra_features)
        flows_data.append(d)

    try:
        results = pipeline.predict_batch(flows_data)
    except Exception as err:
        logger.error("Batch prediction failure: %s", err)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Batch scoring error: {str(err)}"
        )

    # Persist batch events
    now_iso = datetime.now(timezone.utc).isoformat()
    for i, res in enumerate(results):
        flow = flows_data[i]
        event = {
            "event_id": res["flow_id"],
            "timestamp": now_iso,
            "src_ip": flow.get("srcip", "0.0.0.0"),
            "dst_ip": flow.get("dstip", "0.0.0.0"),
            "src_port": flow.get("sport", 0),
            "dst_port": flow.get("dsport", 0),
            "proto": flow.get("proto", "tcp"),
            "service": flow.get("service", "-"),
            "label": res["label"],
            "label_name": res["label_name"],
            "risk_score": res["risk_score"],
            "action": res["action"],
            "severity": res["severity"],
            "model_version": res["model_version"],
            "source_type": "batch"
        }
        database.save_event(event)

    return {"count": len(results), "results": results}


@app.get("/api/v1/dashboard/snapshot", response_model=DashboardSnapshot)
async def get_dashboard_snapshot():
    """Returns recent counts, backend matrix statuses, and recent scored events."""
    counts = database.get_event_counts()
    recent_db_events = database.get_recent_events(limit=25)

    recent_items = [
        EventItem(
            event_id=r["event_id"],
            timestamp=r["timestamp"],
            src_ip=r["src_ip"],
            dst_ip=r["dst_ip"],
            src_port=r["src_port"],
            dst_port=r["dst_port"],
            proto=r["proto"],
            service=r["service"],
            label=r["label"],
            label_name=r["label_name"],
            risk_score=r["risk_score"],
            action=r["action"],
            severity=r["severity"],
            source_type=r["source_type"]
        ) for r in recent_db_events
    ]

    return DashboardSnapshot(
        status="ONLINE",
        model_version="DecisionTree_UNSW90_v1.0",
        total_events=counts["total"],
        normal_count=counts["normal"],
        attack_count=counts["attack"],
        last_update=datetime.now(timezone.utc).isoformat(),
        backends=list(LAB_BACKENDS.values()),
        recent_events=recent_items
    )


@app.get("/api/v1/events")
async def get_events(
    limit: int = Query(default=50, ge=1, le=500),
    severity: Optional[str] = Query(default=None),
    label: Optional[int] = Query(default=None)
):
    """Returns paginated, filterable event history."""
    events = database.get_recent_events(limit=limit, severity=severity, label=label)
    return {"total": len(events), "events": events}


@app.post("/api/v1/lab/backends/{backend_id}/fail", response_model=LabActionResponse)
async def toggle_lab_backend_failure(backend_id: str, payload: BackendFailRequest):
    """
    Toggles simulated failure on a lab backend node.
    Restricted to isolated lab: fails safely if unknown node.
    """
    if backend_id not in LAB_BACKENDS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Backend '{backend_id}' not found in lab environment."
        )

    backend = LAB_BACKENDS[backend_id]
    backend["failed"] = payload.failed
    backend["status"] = "OFFLINE" if payload.failed else "HEALTHY"

    # Save to audit trail
    audit_action = f"SET_FAILED_{payload.failed}"
    database.save_lab_audit(
        backend_id=backend_id,
        action=audit_action,
        status=backend["status"],
        operator=payload.operator or "admin"
    )

    # Broadcast backend health update
    await manager.broadcast({
        "type": "backend_update",
        "data": backend
    })

    return LabActionResponse(
        status="SUCCESS",
        backend_id=backend_id,
        failed=backend["failed"],
        isolated_lab_only=True,
        timestamp=datetime.now(timezone.utc).isoformat(),
        message=f"Lab backend {backend_id} set to {backend['status']} (reason: {payload.reason})"
    )


@app.post("/api/v1/replay/start")
async def start_replay(interval: float = Query(default=2.0, ge=0.5, le=10.0)):
    """Starts the offline flow replay engine for repeatable demonstrations."""
    res = replay_engine.start(interval=interval)
    return res


@app.post("/api/v1/replay/stop")
async def stop_replay():
    """Stops the offline flow replay engine."""
    res = replay_engine.stop()
    return res


@app.get("/api/v1/replay/status")
async def get_replay_status():
    """Returns current status of the offline flow replay engine."""
    return replay_engine.status()


@app.get("/api/v1/experiments")
async def list_experiment_runs(limit: int = Query(default=50, ge=1, le=200)):
    """Lists recent Mininet experiment runs."""
    runs = database.get_experiment_runs(limit=limit)
    return {"total": len(runs), "runs": runs}


@app.post("/api/v1/experiments")
async def create_experiment_run(payload: ExperimentRunCreate):
    """Registers or updates a Mininet experiment run manifest."""
    run_dict = payload.model_dump()
    database.save_experiment_run(run_dict)
    return {"status": "SUCCESS", "run_id": payload.run_id, "message": "Experiment run recorded"}


@app.get("/api/v1/experiments/{run_id}")
async def get_experiment_details(run_id: str):
    """Retrieves metadata and event counts for a specific experiment run."""
    run = database.get_experiment_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Experiment run {run_id} not found")
    events = database.get_events_for_run(run_id)
    return {"run": run, "event_count": len(events)}


@app.get("/api/v1/experiments/{run_id}/report")
async def get_run_report(
    run_id: str,
    format: str = Query(default="json", pattern="^(json|csv|html)$"),
    include_raw_ips: bool = Query(default=False)
):
    """Generates an honest evaluation report for an experiment run in JSON, CSV, or HTML."""
    run = database.get_experiment_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Experiment run {run_id} not found")

    report = build_experiment_report(run_id=run_id, include_raw_ips=include_raw_ips)

    if format == "csv":
        csv_content = generate_report_csv(report)
        return PlainTextResponse(
            csv_content,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=flowguard_report_{run_id}.csv"}
        )
    elif format == "html":
        html_content = generate_report_html(report)
        return HTMLResponse(content=html_content)

    return JSONResponse(content=report)


@app.get("/api/v1/reports/generate")
async def generate_custom_report(
    scenario_id: Optional[str] = Query(default=None),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    format: str = Query(default="json", pattern="^(json|csv|html)$"),
    include_raw_ips: bool = Query(default=False)
):
    """Generates an evaluation report across custom criteria."""
    report = build_experiment_report(
        scenario_id=scenario_id,
        start_date=start_date,
        end_date=end_date,
        include_raw_ips=include_raw_ips
    )

    if format == "csv":
        csv_content = generate_report_csv(report)
        return PlainTextResponse(
            csv_content,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=flowguard_custom_report.csv"}
        )
    elif format == "html":
        html_content = generate_report_html(report)
        return HTMLResponse(content=html_content)

    return JSONResponse(content=report)


@app.post("/api/v1/flow/submit")
async def submit_flows_from_collector(payload: FlowSubmission):
    """
    Ingests live or captured flows from Mininet or remote agents.
    Transforms raw flow records via FeatureMapping into the 90-feature schema,
    evaluates predictions with feature provenance, persists with ground truth,
    and streams to connected dashboards.
    """
    pipeline = get_pipeline()
    processed_events = []

    for raw_flow in payload.flows:
        if "sbytes" in raw_flow and "total_bytes" not in raw_flow:
            mapped_features, prov_tags = map_flow_to_features(raw_flow)
        else:
            mapped_features = raw_flow
            prov_tags = raw_flow.get("_provenance_tags", {})

        flow_id = raw_flow.get("flow_id") or f"flow-{uuid.uuid4().hex[:8]}"
        mapped_features["flow_id"] = flow_id

        try:
            pred = pipeline.predict_flow(mapped_features)
        except Exception as e:
            logger.error("Failed to predict flow %s: %s", flow_id, e)
            continue

        prov_info = pred.get("provenance", {})
        event_dict = {
            "event_id": flow_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "src_ip": raw_flow.get("src_ip", raw_flow.get("srcip", "0.0.0.0")),
            "dst_ip": raw_flow.get("dst_ip", raw_flow.get("dstip", "0.0.0.0")),
            "src_port": int(raw_flow.get("sport", raw_flow.get("src_port", 0))),
            "dst_port": int(raw_flow.get("dsport", raw_flow.get("dst_port", 0))),
            "proto": raw_flow.get("proto", "tcp"),
            "service": raw_flow.get("service", "-"),
            "label": pred["label"],
            "label_name": pred["label_name"],
            "risk_score": pred["risk_score"],
            "action": pred["action"],
            "severity": pred["severity"],
            "model_version": pred["model_version"],
            "source_type": payload.source_type or "mininet_capture",
            "run_id": payload.run_id,
            "scenario_id": payload.scenario_id,
            "ground_truth": payload.ground_truth_label,
            "imputation_rate": prov_info.get("imputation_rate"),
            "provenance": prov_info,
            "latency_ms": 10.0
        }

        database.save_event(event_dict)
        processed_events.append(event_dict)

        # Broadcast live over WebSocket
        await manager.broadcast({
            "type": "new_event",
            "data": event_dict
        })

    return {
        "status": "SUCCESS",
        "processed_count": len(processed_events),
        "run_id": payload.run_id,
        "source_type": payload.source_type
    }


@app.websocket("/api/v1/events/stream")
async def websocket_event_stream(websocket: WebSocket):
    """WebSocket stream for real-time model predictions and health updates with heartbeat."""
    await manager.connect(websocket)
    try:
        # Send initial snapshot info
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to FlowGuard Live Event Stream",
            "model_version": "DecisionTree_UNSW90_v1.0",
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        while True:
            # Listen for client heartbeat/ping
            text = await websocket.receive_text()
            if text == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.warning("WebSocket connection exception: %s", e)
        manager.disconnect(websocket)
