"""
Integration tests for FlowGuard FastAPI backend endpoints.
Verifies health, model info, single flow prediction, batch prediction,
snapshot, persistence, and lab failure controls.
"""

import unittest
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient
from main import app
from fixtures.flow_fixtures import BENIGN_WEB_FLOW, ATTACK_RECON_FLOW, BENIGN_DNS_FLOW


class TestFlowGuardAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        # Seed at least one event into the database so snapshot and events tests have data
        cls.client.post("/api/v1/flows/predict", json=BENIGN_WEB_FLOW)

    def test_health_endpoint(self):
        """GET /api/v1/health returns 200 with service and model readiness."""
        res = self.client.get("/api/v1/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "HEALTHY")
        self.assertTrue(data["model_loaded"])
        self.assertIn("os_environment", data)
        self.assertIn("collector_mode", data)

    def test_model_info_endpoint(self):
        """GET /api/v1/model/info returns 90 features and unverified note."""
        res = self.client.get("/api/v1/model/info")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["feature_count"], 90)
        self.assertFalse(data["historical_score_verified"])
        self.assertIn("notes", data)

    def test_predict_benign_flow(self):
        """POST /api/v1/flows/predict with benign flow returns Normal (0)."""
        res = self.client.post("/api/v1/flows/predict", json=BENIGN_WEB_FLOW)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["label"], 0)
        self.assertEqual(data["label_name"], "NORMAL")
        self.assertEqual(data["action"], "ALLOW")
        self.assertIn("flow_id", data)
        self.assertGreaterEqual(data["probabilities"]["normal"], 0.5)

    def test_predict_attack_flow(self):
        """POST /api/v1/flows/predict with recon flow returns Attack (1)."""
        res = self.client.post("/api/v1/flows/predict", json=ATTACK_RECON_FLOW)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["label"], 1)
        self.assertEqual(data["label_name"], "ATTACK")
        self.assertEqual(data["action"], "ALERT")
        self.assertGreaterEqual(data["probabilities"]["attack"], 0.5)

    def test_predict_batch_flows(self):
        """POST /api/v1/flows/predict_batch scores multiple records."""
        payload = {"flows": [BENIGN_WEB_FLOW, ATTACK_RECON_FLOW, BENIGN_DNS_FLOW]}
        res = self.client.post("/api/v1/flows/predict_batch", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["count"], 3)
        self.assertEqual(data["results"][0]["label"], 0)
        self.assertEqual(data["results"][1]["label"], 1)
        self.assertEqual(data["results"][2]["label"], 0)

    def test_dashboard_snapshot(self):
        """GET /api/v1/dashboard/snapshot returns status, counts, and backends."""
        res = self.client.get("/api/v1/dashboard/snapshot")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "ONLINE")
        self.assertGreaterEqual(data["total_events"], 1)
        self.assertEqual(len(data["backends"]), 3)

    def test_events_query(self):
        """GET /api/v1/events returns persisted events list."""
        res = self.client.get("/api/v1/events?limit=10")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("events", data)
        self.assertGreaterEqual(len(data["events"]), 1)

    def test_lab_backend_fail_toggle(self):
        """POST /api/v1/lab/backends/{id}/fail changes backend status and logs audit."""
        payload = {"failed": True, "reason": "Test fault injection"}
        res = self.client.post("/api/v1/lab/backends/Backend-01/fail", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "SUCCESS")
        self.assertTrue(data["failed"])

        # Reset back to healthy
        res_reset = self.client.post("/api/v1/lab/backends/Backend-01/fail", json={"failed": False})
        self.assertEqual(res_reset.status_code, 200)
        self.assertFalse(res_reset.json()["failed"])

    def test_replay_lifecycle(self):
        """Verify replay start, status, and stop."""
        res_start = self.client.post("/api/v1/replay/start?interval=2.0")
        self.assertIn(res_start.status_code, [200, 400])

        res_status = self.client.get("/api/v1/replay/status")
        self.assertEqual(res_status.status_code, 200)
        self.assertTrue(res_status.json()["is_running"])

        res_stop = self.client.post("/api/v1/replay/stop")
        self.assertEqual(res_stop.status_code, 200)
        self.assertEqual(res_stop.json()["status"], "stopped")


if __name__ == "__main__":
    unittest.main()
