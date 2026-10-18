"""
Offline Flow Replay Engine for FlowGuard.
Provides a repeatable flow source when Mininet / Linux packet capture is unavailable.
Never fabricates live telemetry: clearly tags generated events as 'replay'.
"""

import asyncio
import logging
import time
import uuid
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from model_pipeline import get_pipeline
import database
from websocket_manager import manager
from fixtures.flow_fixtures import BENIGN_WEB_FLOW, BENIGN_DNS_FLOW, ATTACK_RECON_FLOW

logger = logging.getLogger("flowguard.replay")

# Repeatable sequence of representative benign and attack flows
REPLAY_SCENARIO: List[Dict[str, Any]] = [
    {
        "flow_id": "replay-benign-web-1",
        "srcip": "192.168.1.101",
        "sport": 51234,
        "dstip": "10.0.0.1",
        "dsport": 80,
        "proto": "tcp",
        "state": "CON",
        "dur": 0.045,
        "sbytes": 450,
        "dbytes": 2200,
        "Spkts": 5,
        "Dpkts": 8,
        "service": "http"
    },
    {
        "flow_id": "replay-benign-web-2",
        "srcip": "192.168.1.102",
        "sport": 51235,
        "dstip": "10.0.0.2",
        "dsport": 80,
        "proto": "tcp",
        "state": "CON",
        "dur": 0.062,
        "sbytes": 520,
        "dbytes": 3400,
        "Spkts": 6,
        "Dpkts": 12,
        "service": "http"
    },
    {
        "flow_id": "replay-benign-dns-1",
        "srcip": "192.168.1.103",
        "sport": 60123,
        "dstip": "10.0.0.53",
        "dsport": 53,
        "proto": "udp",
        "state": "CON",
        "dur": 0.002,
        "sbytes": 68,
        "dbytes": 136,
        "Spkts": 1,
        "Dpkts": 1,
        "service": "dns"
    },
    {
        "flow_id": "replay-attack-scan-1",
        "srcip": "175.45.176.5",
        "sport": 49160,
        "dstip": "10.0.80.1",
        "dsport": 21,
        "proto": "tcp",
        "state": "FIN",
        "dur": 0.05,
        "sbytes": 1900,
        "dbytes": 180,
        "Spkts": 16,
        "Dpkts": 2,
        "service": "ftp",
        "sttl": 64,
        "dttl": 60,
        "smeansz": 45,
        "ct_srv_src": 14,
        "ct_srv_dst": 14,
        "ct_dst_ltm": 12,
        "ct_src_ ltm": 12
    },
    {
        "flow_id": "replay-benign-web-3",
        "srcip": "192.168.1.104",
        "sport": 51236,
        "dstip": "10.0.0.3",
        "dsport": 80,
        "proto": "tcp",
        "state": "CON",
        "dur": 0.038,
        "sbytes": 390,
        "dbytes": 1800,
        "Spkts": 4,
        "Dpkts": 7,
        "service": "http"
    }
]


class ReplayEngine:
    def __init__(self):
        self.is_running = False
        self.current_index = 0
        self.task: Optional[asyncio.Task] = None
        self.interval_seconds = 2.0
        self.total_replayed = 0

    async def _run_loop(self):
        pipeline = get_pipeline()
        logger.info("Offline replay engine started.")
        while self.is_running:
            flow_template = REPLAY_SCENARIO[self.current_index % len(REPLAY_SCENARIO)]
            self.current_index += 1
            self.total_replayed += 1

            # Generate unique instance
            flow_data = dict(flow_template)
            flow_id = f"{flow_data['flow_id']}-{uuid.uuid4().hex[:6]}"
            flow_data["flow_id"] = flow_id

            # Score through model pipeline
            prediction = pipeline.predict_flow(flow_data)

            # Persist event
            event = {
                "event_id": flow_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "src_ip": flow_data.get("srcip", "0.0.0.0"),
                "dst_ip": flow_data.get("dstip", "0.0.0.0"),
                "src_port": flow_data.get("sport", 0),
                "dst_port": flow_data.get("dsport", 0),
                "proto": flow_data.get("proto", "tcp"),
                "service": flow_data.get("service", "-"),
                "label": prediction["label"],
                "label_name": prediction["label_name"],
                "risk_score": prediction["risk_score"],
                "action": prediction["action"],
                "severity": prediction["severity"],
                "model_version": prediction["model_version"],
                "source_type": "replay"
            }
            database.save_event(event)

            # Broadcast to WebSocket subscribers
            await manager.broadcast({
                "type": "flow_event",
                "data": event
            })

            await asyncio.sleep(self.interval_seconds)

    def start(self, interval: float = 2.0) -> Dict[str, Any]:
        if self.is_running:
            return {"status": "already_running", "interval": self.interval_seconds}
        self.is_running = True
        self.interval_seconds = interval
        self.task = asyncio.create_task(self._run_loop())
        return {"status": "started", "interval": self.interval_seconds}

    def stop(self) -> Dict[str, Any]:
        if not self.is_running:
            return {"status": "not_running"}
        self.is_running = False
        if self.task:
            self.task.cancel()
            self.task = None
        return {"status": "stopped", "total_replayed": self.total_replayed}

    def status(self) -> Dict[str, Any]:
        return {
            "is_running": self.is_running,
            "interval_seconds": self.interval_seconds,
            "total_replayed": self.total_replayed,
            "scenario_length": len(REPLAY_SCENARIO)
        }


replay_engine = ReplayEngine()
