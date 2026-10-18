"""
SQLite event and audit store for FlowGuard.
Stores flow inference events, model versions, and isolated lab operator actions.
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
    """Initializes tables if they do not exist."""
    with get_connection() as conn:
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
        conn.commit()


def save_event(event: Dict[str, Any]) -> None:
    """Inserts a scored flow event into the database."""
    with get_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO events (
                event_id, timestamp, src_ip, dst_ip, src_port, dst_port,
                proto, service, label, label_name, risk_score, action,
                severity, model_version, source_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
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
            event.get("source_type", "live")
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


# Initialize database schema on module import
init_db()
