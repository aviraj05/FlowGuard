"""
Unit tests for Experiment Storage, Report Generation, and Flow Submission APIs.
"""

import unittest
import sys
from pathlib import Path
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from main import app
import database


class TestExperimentsAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_experiment_lifecycle_and_report_generation(self):
        """Creates experiment, submits flows with ground truth, and downloads reports in JSON, CSV, HTML."""
        run_id = f"test_run_unit_{id(self)}"
        
        # 1. Register run
        create_resp = self.client.post("/api/v1/experiments", json={
            "run_id": run_id,
            "scenario_id": "benign_http",
            "description": "Automated unit test experiment",
            "ground_truth_label": 0,
            "ground_truth_name": "NORMAL"
        })
        self.assertEqual(create_resp.status_code, 200)

        # 2. Submit raw flows associated with this run
        flow_payload = {
            "run_id": run_id,
            "scenario_id": "benign_http",
            "ground_truth_label": 0,
            "source_type": "mininet_capture",
            "flows": [
                {
                    "flow_id": f"{run_id}-f1",
                    "src_ip": "10.0.0.100",
                    "dst_ip": "10.0.0.1",
                    "sport": 54321,
                    "dsport": 80,
                    "proto": "tcp",
                    "dur": 0.05,
                    "sbytes": 350,
                    "dbytes": 1200,
                    "Spkts": 5,
                    "Dpkts": 4,
                    "state": "FIN",
                    "service": "http"
                },
                {
                    "flow_id": f"{run_id}-f2",
                    "src_ip": "10.0.0.100",
                    "dst_ip": "10.0.0.2",
                    "sport": 54322,
                    "dsport": 80,
                    "proto": "tcp",
                    "dur": 0.03,
                    "sbytes": 300,
                    "dbytes": 800,
                    "Spkts": 4,
                    "Dpkts": 3,
                    "state": "FIN",
                    "service": "http"
                }
            ]
        }
        submit_resp = self.client.post("/api/v1/flow/submit", json=flow_payload)
        self.assertEqual(submit_resp.status_code, 200)
        self.assertEqual(submit_resp.json()["processed_count"], 2)

        # 3. Retrieve run details
        details_resp = self.client.get(f"/api/v1/experiments/{run_id}")
        self.assertEqual(details_resp.status_code, 200)
        self.assertEqual(details_resp.json()["event_count"], 2)

        # 4. Generate JSON report
        json_report_resp = self.client.get(f"/api/v1/experiments/{run_id}/report?format=json")
        self.assertEqual(json_report_resp.status_code, 200)
        report_data = json_report_resp.json()
        self.assertEqual(report_data["executive_summary"]["total_flows"], 2)
        self.assertEqual(report_data["executive_summary"]["labeled_flows"], 2)
        self.assertIn("artifact_hashes_sha256", report_data["model_provenance"])
        self.assertIn("scikit_learn", report_data["model_provenance"]["runtime_environment"])

        # 5. Generate CSV report
        csv_report_resp = self.client.get(f"/api/v1/experiments/{run_id}/report?format=csv")
        self.assertEqual(csv_report_resp.status_code, 200)
        self.assertIn("text/csv", csv_report_resp.headers["content-type"])
        self.assertIn("Event ID,Timestamp,Source IP", csv_report_resp.text)
        self.assertIn(f"{run_id}-f1", csv_report_resp.text)

        # 6. Generate HTML report
        html_report_resp = self.client.get(f"/api/v1/experiments/{run_id}/report?format=html")
        self.assertEqual(html_report_resp.status_code, 200)
        self.assertIn("text/html", html_report_resp.headers["content-type"])
        self.assertIn("FlowGuard Security Lab", html_report_resp.text)
        self.assertIn(run_id, html_report_resp.text)

    def test_unlabeled_run_report_honesty(self):
        """Unlabeled flows report UNLABELED status without fabricated accuracy."""
        run_id = f"test_run_unlabeled_{id(self)}"
        self.client.post("/api/v1/experiments", json={
            "run_id": run_id,
            "scenario_id": "unlabeled_probe",
            "ground_truth_label": -1
        })
        self.client.post("/api/v1/flow/submit", json={
            "run_id": run_id,
            "ground_truth_label": None,
            "flows": [{
                "src_ip": "10.0.0.100", "dst_ip": "10.0.0.1", "sport": 12345, "dsport": 80,
                "proto": "tcp", "sbytes": 100, "dbytes": 200, "Spkts": 2, "Dpkts": 2
            }]
        })

        resp = self.client.get(f"/api/v1/experiments/{run_id}/report?format=json")
        self.assertEqual(resp.status_code, 200)
        report = resp.json()
        self.assertEqual(report["executive_summary"]["status"], "UNLABELED")
        self.assertIn("cannot be calculated", report["executive_summary"]["message"])
        self.assertIsNone(report["evaluation"]["metrics"])


if __name__ == "__main__":
    unittest.main()
