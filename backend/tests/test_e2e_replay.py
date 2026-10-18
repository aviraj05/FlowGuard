"""
End-to-End Replay Verification Test for FlowGuard.
Deterministic test that traces a network flow record from raw ingestion,
through feature extraction, 90-feature model scoring, SQLite persistence,
REST snapshot queries, and WebSocket delivery.
"""

import unittest
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient
from main import app
import database
from fixtures.flow_fixtures import BENIGN_WEB_FLOW, ATTACK_RECON_FLOW


class TestEndToEndReplay(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_e2e_flow_lifecycle(self):
        """
        Follows a flow record through the full vertical slice:
        1. Ingestion via API
        2. Feature extraction (90 UNSW-NB15 features)
        3. Decision Tree scoring (Normal vs Attack)
        4. Database persistence
        5. Dashboard snapshot query
        6. WebSocket delivery
        """
        # Step 1 & 2 & 3: Post attack flow to prediction endpoint
        res = self.client.post("/api/v1/flows/predict", json=ATTACK_RECON_FLOW)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        event_id = data["flow_id"]
        self.assertEqual(data["label"], 1)
        self.assertEqual(data["label_name"], "ATTACK")
        self.assertEqual(data["action"], "ALERT")
        self.assertEqual(data["model_version"], "DecisionTree_UNSW90_v1.0")
        self.assertEqual(data["schema_version"], "flowguard-unsw-90-v1")

        # Step 4: Verify persistence in SQLite
        events = database.get_recent_events(limit=10)
        persisted = next((e for e in events if e["event_id"] == event_id), None)
        self.assertIsNotNone(persisted, f"Event {event_id} was not found in SQLite database.")
        self.assertEqual(persisted["label"], 1)
        self.assertEqual(persisted["label_name"], "ATTACK")
        self.assertEqual(persisted["src_ip"], ATTACK_RECON_FLOW["srcip"])

        # Step 5: Verify dashboard snapshot contains the updated counts and event
        snap_res = self.client.get("/api/v1/dashboard/snapshot")
        self.assertEqual(snap_res.status_code, 200)
        snapshot = snap_res.json()
        self.assertGreaterEqual(snapshot["total_events"], 1)
        self.assertGreaterEqual(snapshot["attack_count"], 1)

        found_in_recent = any(e["event_id"] == event_id for e in snapshot["recent_events"])
        self.assertTrue(found_in_recent, f"Event {event_id} must appear in dashboard recent events.")

        # Step 6: Verify WebSocket connectivity
        with self.client.websocket_connect("/api/v1/events/stream") as websocket:
            init_msg = websocket.receive_json()
            self.assertEqual(init_msg["type"], "connected")
            self.assertEqual(init_msg["model_version"], "DecisionTree_UNSW90_v1.0")

            # Test ping-pong heartbeat
            websocket.send_text("ping")
            response = websocket.receive_text()
            self.assertEqual(response, "pong")


if __name__ == "__main__":
    unittest.main()
