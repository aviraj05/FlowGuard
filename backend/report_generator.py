"""
FlowGuard Report Generation Engine
Generates honest, verifiable experiment evaluation reports in JSON, CSV, and printable HTML formats.
Reports artifact hashes, runtime dependencies, class distribution, confusion matrix,
confidence intervals, latency percentiles, and limitations.
Masks IP addresses by default unless explicitly requested for lab debugging.
"""

import json
import csv
import io
import sys
import platform
import hashlib
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from database import get_events_filtered, get_experiment_run
from evaluation import evaluate_flows
from feature_schema import SCHEMA_VERSION, MODEL_VERSION

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = PROJECT_ROOT / "model files"


def get_artifact_hashes() -> Dict[str, str]:
    """Computes SHA-256 for model artifacts."""
    hashes = {}
    for filename in ["best_model.joblib", "categorical_encoder.joblib", "missing_value_imputer.joblib", "metadata.json"]:
        p = MODEL_DIR / filename
        if p.exists():
            h = hashlib.sha256(p.read_bytes()).hexdigest()
            hashes[filename] = h
        else:
            hashes[filename] = "NOT_FOUND"
    return hashes


def get_runtime_environment() -> Dict[str, str]:
    """Collects installed Python and library versions."""
    import sklearn
    import numpy as np
    import pandas as pd
    import joblib

    return {
        "python": platform.python_version(),
        "scikit_learn": sklearn.__version__,
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "joblib": joblib.__version__,
        "os": f"{platform.system()} {platform.release()}",
    }


def mask_ip(ip_str: str, include_raw: bool = False) -> str:
    """Masks last octet unless include_raw is True."""
    if include_raw or not ip_str:
        return ip_str
    parts = ip_str.split(".")
    if len(parts) == 4:
        return f"{parts[0]}.{parts[1]}.{parts[2]}.xxx"
    return "xxx.xxx.xxx.xxx"


def build_experiment_report(
    run_id: Optional[str] = None,
    scenario_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    include_raw_ips: bool = False
) -> Dict[str, Any]:
    """Generates complete structured report object."""
    events = get_events_filtered(run_id=run_id, scenario_id=scenario_id, start_date=start_date, end_date=end_date)
    run_meta = get_experiment_run(run_id) if run_id else None

    # Format records for evaluation engine
    eval_records = []
    flow_rows = []
    for e in events:
        gt = e.get("ground_truth")
        eval_records.append({
            "ground_truth": gt,
            "prediction": e.get("label"),
            "latency_ms": e.get("latency_ms"),
            "imputation_rate": e.get("imputation_rate"),
        })

        flow_rows.append({
            "event_id": e.get("event_id"),
            "timestamp": e.get("timestamp"),
            "src_ip": mask_ip(e.get("src_ip", ""), include_raw_ips),
            "dst_ip": mask_ip(e.get("dst_ip", ""), include_raw_ips),
            "sport": e.get("src_port"),
            "dsport": e.get("dst_port"),
            "proto": e.get("proto"),
            "service": e.get("service"),
            "ground_truth": "NORMAL" if gt == 0 else ("ATTACK" if gt == 1 else "UNLABELED"),
            "prediction": e.get("label_name"),
            "risk_score": e.get("risk_score"),
            "action": e.get("action"),
            "severity": e.get("severity"),
            "imputation_rate": e.get("imputation_rate"),
            "source_type": e.get("source_type"),
        })

    eval_results = evaluate_flows(eval_records)

    report = {
        "report_id": f"rep_{run_id or 'aggregate'}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "query_params": {
            "run_id": run_id,
            "scenario_id": scenario_id,
            "start_date": start_date,
            "end_date": end_date,
            "include_raw_ips": include_raw_ips,
        },
        "run_metadata": run_meta,
        "executive_summary": {
            "status": eval_results["evaluation_status"],
            "message": eval_results["message"],
            "total_flows": eval_results["total_records"],
            "labeled_flows": eval_results["labeled_count"],
            "unlabeled_flows": eval_results["unlabeled_count"],
        },
        "model_provenance": {
            "model_version": MODEL_VERSION,
            "schema_version": SCHEMA_VERSION,
            "artifact_hashes_sha256": get_artifact_hashes(),
            "runtime_environment": get_runtime_environment(),
            "historical_score_note": (
                "Historical F1 score (0.9802) recorded in metadata.json cannot be independently "
                "reproduced without original training dataset."
            ),
        },
        "evaluation": eval_results,
        "flow_records": flow_rows,
        "limitations": [
            "No automatic packet blocking is implemented; alerts are purely informational telemetry.",
            "Decision tree probability scores reflect tree leaf sample ratios and may not represent calibrated confidence.",
            "Evaluations without independent ground-truth manifests omit supervised classification metrics."
        ]
    }

    return report


def generate_report_csv(report: Dict[str, Any]) -> str:
    """Exports flow records into standard CSV format."""
    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "Event ID", "Timestamp", "Source IP", "Destination IP", "Src Port", "Dst Port",
        "Protocol", "Service", "Ground Truth", "Prediction", "Risk Score", "Action",
        "Severity", "Imputation Rate", "Source Type"
    ])

    for row in report.get("flow_records", []):
        writer.writerow([
            row.get("event_id"),
            row.get("timestamp"),
            row.get("src_ip"),
            row.get("dst_ip"),
            row.get("sport"),
            row.get("dsport"),
            row.get("proto"),
            row.get("service"),
            row.get("ground_truth"),
            row.get("prediction"),
            row.get("risk_score"),
            row.get("action"),
            row.get("severity"),
            row.get("imputation_rate"),
            row.get("source_type"),
        ])

    return output.getvalue()


def generate_report_html(report: Dict[str, Any]) -> str:
    """Generates clean, printer-friendly HTML report."""
    summary = report["executive_summary"]
    eval_res = report["evaluation"]
    metrics = eval_res.get("metrics") or {}
    cm = eval_res.get("confusion_matrix") or {}
    prov = report["model_provenance"]

    status_color = "#10b981" if summary["status"] == "PASSED" else ("#f59e0b" if "INSUFFICIENT" in summary["status"] or summary["status"] == "UNLABELED" else "#ef4444")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FlowGuard Evaluation Report - {report['report_id']}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 40px; color: #1e293b; background: #fff; }}
    h1, h2, h3 {{ color: #0f172a; margin-top: 1.5em; }}
    .badge {{ display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: 700; color: #fff; background: {status_color}; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }}
    th {{ background: #f1f5f9; }}
    .mono {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }}
    .card {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 16px 0; }}
    @media print {{ body {{ margin: 15mm; }} }}
  </style>
</head>
<body>
  <h1>FlowGuard Security Lab &amp; Model Performance Report</h1>
  <p><strong>Report ID:</strong> <span class="mono">{report['report_id']}</span> | <strong>Generated:</strong> {report['generated_at']}</p>
  
  <div class="card">
    <h2>Executive Summary: <span class="badge">{summary['status']}</span></h2>
    <p>{summary['message']}</p>
    <ul>
      <li><strong>Total Flows Evaluated:</strong> {summary['total_flows']}</li>
      <li><strong>Labeled Flows:</strong> {summary['labeled_flows']}</li>
      <li><strong>Unlabeled Flows:</strong> {summary['unlabeled_flows']}</li>
    </ul>
  </div>

  <h2>Model &amp; Environment Provenance</h2>
  <table>
    <tr><th>Component</th><th>Details</th></tr>
    <tr><td>Model Version</td><td class="mono">{prov['model_version']}</td></tr>
    <tr><td>Schema Version</td><td class="mono">{prov['schema_version']}</td></tr>
    <tr><td>Python Runtime</td><td class="mono">{prov['runtime_environment']['python']} (scikit-learn {prov['runtime_environment']['scikit_learn']})</td></tr>
    <tr><td>Historical Model F1</td><td>{prov['historical_score_note']}</td></tr>
  </table>

  <h2>Artifact Hashes (SHA-256)</h2>
  <table>
    <tr><th>Artifact File</th><th>SHA-256 Hash</th></tr>
"""
    for fname, hval in prov["artifact_hashes_sha256"].items():
        html += f"    <tr><td>{fname}</td><td class=\"mono\">{hval}</td></tr>\n"

    html += """  </table>\n"""

    if metrics:
        html += f"""
  <h2>Evaluation Metrics &amp; Performance Gates</h2>
  <table>
    <tr><th>Metric</th><th>Measured Value</th><th>95% Confidence Interval</th><th>Performance Gate</th></tr>
    <tr><td>Accuracy</td><td>{metrics.get('accuracy', 'N/A')}</td><td>-</td><td>-</td></tr>
    <tr><td>Balanced Accuracy</td><td>{metrics.get('balanced_accuracy', 'N/A')}</td><td>-</td><td>>= 80%</td></tr>
    <tr><td>Benign False Positive Rate</td><td>{metrics.get('benign_false_positive_rate', 'N/A')}</td><td>{metrics.get('benign_fpr_ci_95', '-')}</td><td><= 5%</td></tr>
    <tr><td>Attack Recall / Detection Rate</td><td>{metrics.get('attack_recall', 'N/A')}</td><td>{metrics.get('attack_recall_ci_95', '-')}</td><td>>= 80%</td></tr>
    <tr><td>Precision</td><td>{metrics.get('precision', 'N/A')}</td><td>-</td><td>-</td></tr>
    <tr><td>F1 Score</td><td>{metrics.get('f1_score', 'N/A')}</td><td>-</td><td>-</td></tr>
  </table>

  <h2>Confusion Matrix</h2>
  <table>
    <tr><th></th><th>Predicted Normal (0)</th><th>Predicted Attack (1)</th></tr>
    <tr><th>Ground Truth Normal (0)</th><td>TN: {cm.get('true_negatives', 0)}</td><td>FP: {cm.get('false_positives', 0)}</td></tr>
    <tr><th>Ground Truth Attack (1)</th><td>FN: {cm.get('false_negatives', 0)}</td><td>TP: {cm.get('true_positives', 0)}</td></tr>
  </table>
"""
    else:
        html += f"""
  <div class="card" style="border-left: 4px solid #f59e0b;">
    <h3>Supervised Metrics Unavailable</h3>
    <p>This run does not contain verified ground-truth labels. Operational telemetry (flows captured: {summary['total_flows']}) is preserved, but classification metrics are withheld to prevent fabricated scores.</p>
  </div>
"""

    html += """
  <h2>Known Limitations</h2>
  <ul>
"""
    for lim in report["limitations"]:
        html += f"    <li>{lim}</li>\n"

    html += """  </ul>
</body>
</html>
"""
    return html
