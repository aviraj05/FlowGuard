"""
SQLite event, experiment, and audit store for FlowGuard.
Stores flow inference events, model versions, experiment runs,
ground-truth associations, and isolated lab operator actions.
Safely migrates schema while preserving all existing event history.
"""

import sqlite3
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

DB_PATH = Path(__file__).resolve().parent / "flowguard.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initializes tables and runs safe non-destructive migrations."""
    with get_connection() as conn:
        # 1. Base events table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE NOT NULL,
                timestamp TEXT NOT NULL,
                src_ip TEXT NOT NULL,
                dst_ip TEXT NOT NULL,
                src_port INTEGER NOT NULL,
                dst_port INTEGER NOT NULL,
                proto TEXT NOT NULL,
                service TEXT NOT NULL,
                label INTEGER NOT NULL,
                label_name TEXT NOT NULL,
                risk_score REAL NOT NULL,
                action TEXT NOT NULL,
                severity TEXT NOT NULL,
                model_version TEXT NOT NULL,
                source_type TEXT NOT NULL
            );
        """)

        # 2. Lab audit table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS lab_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                backend_id TEXT NOT NULL,
                action TEXT NOT NULL,
                status TEXT NOT NULL,
                operator TEXT NOT NULL
            );
        """)

        # 3. Experiment runs table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS experiment_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT UNIQUE NOT NULL,
                scenario_id TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                status TEXT NOT NULL,
                ground_truth_label INTEGER,
                ground_truth_name TEXT,
                config_json TEXT,
                metrics_json TEXT
            );
        """)

        # 4. Safe column migrations on events table
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(events);")
        existing_cols = {row["name"] for row in cur.fetchall()}

        new_columns = [
            ("run_id", "TEXT"),
            ("scenario_id", "TEXT"),
            ("ground_truth", "INTEGER"),
            ("imputation_rate", "REAL"),
            ("provenance_summary", "TEXT"),
            ("latency_ms", "REAL"),
        ]

        for col_name, col_type in new_columns:
            if col_name not in existing_cols:
                cur.execute(f"ALTER TABLE events ADD COLUMN {col_name} {col_type};")

        conn.commit()


def save_event(event: Dict[str, Any]) -> None:
    """Inserts a scored flow event with provenance and ground-truth into the database."""
    prov_str = None
    if "provenance" in event and event["provenance"]:
        prov_str = json.dumps(event["provenance"])

    with get_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO events (
                event_id, timestamp, src_ip, dst_ip, src_port, dst_port,
                proto, service, label, label_name, risk_score, action,
                severity, model_version, source_type,
                run_id, scenario_id, ground_truth, imputation_rate,
                provenance_summary, latency_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            event["event_id"],
            event.get("timestamp", datetime.now(timezone.utc).isoformat()),
            event.get("src_ip", "0.0.0.0"),
            event.get("dst_ip", "0.0.0.0"),
            int(event.get("src_port", 0)),
            int(event.get("dst_port", 0)),
            event.get("proto", "tcp"),
            event.get("service", "-"),
            int(event["label"]),
            event["label_name"],
            float(event["risk_score"]),
            event["action"],
            event["severity"],
            event.get("model_version", "DecisionTree_UNSW90_v1.0"),
            event.get("source_type", "live"),
            event.get("run_id"),
            event.get("scenario_id"),
            event.get("ground_truth"),
            event.get("imputation_rate"),
            prov_str,
            event.get("latency_ms"),
        ))
        conn.commit()


def get_recent_events(limit: int = 50, severity: Optional[str] = None, label: Optional[int] = None) -> List[Dict[str, Any]]:
    """Retrieves recent scored events, optionally filtered."""
    query = "SELECT * FROM events WHERE 1=1"
    params: List[Any] = []
    if severity:
        query += " AND severity = ?"
        params.append(severity.upper())
    if label is not None:
        query += " AND label = ?"
        params.append(label)
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]


def get_event_counts() -> Dict[str, int]:
    """Retrieves total count, normal count, and attack count."""
    with get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        normal = conn.execute("SELECT COUNT(*) FROM events WHERE label = 0").fetchone()[0]
        attack = conn.execute("SELECT COUNT(*) FROM events WHERE label = 1").fetchone()[0]
        return {
            "total": total,
            "normal": normal,
            "attack": attack
        }


def save_experiment_run(run_data: Dict[str, Any]) -> None:
    """Inserts or updates an experiment run."""
    with get_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO experiment_runs (
                run_id, scenario_id, description, created_at, completed_at,
                status, ground_truth_label, ground_truth_name, config_json, metrics_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            run_data["run_id"],
            run_data["scenario_id"],
            run_data.get("description", ""),
            run_data.get("created_at", datetime.now(timezone.utc).isoformat()),
            run_data.get("completed_at"),
            run_data.get("status", "initialized"),
            run_data.get("ground_truth_label"),
            run_data.get("ground_truth_name"),
            json.dumps(run_data.get("config", {})),
            json.dumps(run_data.get("metrics", {})),
        ))
        conn.commit()


def get_experiment_runs(limit: int = 50) -> List[Dict[str, Any]]:
    """Retrieves experiment runs ordered by creation time desc."""
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM experiment_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            if d.get("config_json"):
                d["config"] = json.loads(d["config_json"])
            if d.get("metrics_json"):
                d["metrics"] = json.loads(d["metrics_json"])
            results.append(d)
        return results


def get_experiment_run(run_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves a single experiment run by run_id."""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM experiment_runs WHERE run_id = ?", (run_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        if d.get("config_json"):
            d["config"] = json.loads(d["config_json"])
        if d.get("metrics_json"):
            d["metrics"] = json.loads(d["metrics_json"])
        return d


def get_events_for_run(run_id: str) -> List[Dict[str, Any]]:
    """Retrieves all flow events associated with an experiment run."""
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM events WHERE run_id = ? ORDER BY id ASC", (run_id,)).fetchall()
        return [dict(r) for r in rows]


def get_events_filtered(
    run_id: Optional[str] = None,
    scenario_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 1000
) -> List[Dict[str, Any]]:
    """Flexible query for report generation."""
    query = "SELECT * FROM events WHERE 1=1"
    params: List[Any] = []

    if run_id:
        query += " AND run_id = ?"
        params.append(run_id)
    if scenario_id:
        query += " AND scenario_id = ?"
        params.append(scenario_id)
    if start_date:
        query += " AND timestamp >= ?"
        params.append(start_date)
    if end_date:
        query += " AND timestamp <= ?"
        params.append(end_date)

    query += " ORDER BY id ASC LIMIT ?"
    params.append(limit)

    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]


def save_lab_audit(backend_id: str, action: str, status: str, operator: str = "admin") -> None:
    """Records an isolated lab failure action for auditability."""
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO lab_audit (timestamp, backend_id, action, status, operator)
            VALUES (?, ?, ?, ?, ?);
        """, (
            datetime.now(timezone.utc).isoformat(),
            backend_id,
            action,
            status,
            operator
        ))
        conn.commit()


def get_lab_audit_logs(limit: int = 50) -> List[Dict[str, Any]]:
    """Retrieves recent audit logs."""
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM lab_audit ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]


# Automatically initialize schema and apply migrations on import
init_db()
