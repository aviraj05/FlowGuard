"""
Unit tests for FlowGuard Model Pipeline and reproducibility.
Verifies contract, label mapping, fixture predictions, and input robustness.
"""

import unittest
import sys
from pathlib import Path

# Add backend to path
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from model_pipeline import FlowGuardPipeline, LABEL_MAP, get_pipeline
from fixtures.flow_fixtures import BENIGN_WEB_FLOW, BENIGN_DNS_FLOW, ATTACK_RECON_FLOW, BENIGN_RAW_90


class TestModelPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pipeline = get_pipeline()

    def test_pipeline_initialization(self):
        """Pipeline must initialize with model, encoder, and imputer."""
        self.assertTrue(self.pipeline.is_loaded)
        self.assertEqual(self.pipeline.model.n_features_in_, 90)
        self.assertEqual(self.pipeline.imputer.n_features_in_, 90)
        self.assertEqual(self.pipeline.encoder.n_features_in_, 3)

    def test_label_semantics(self):
        """Verify binary label mapping matches project documentation."""
        self.assertEqual(LABEL_MAP[0], "NORMAL")
        self.assertEqual(LABEL_MAP[1], "ATTACK")

    def test_benign_web_prediction(self):
        """Benign web flow should be classified as Normal (0)."""
        result = self.pipeline.predict_flow(BENIGN_WEB_FLOW)
        self.assertEqual(result["label"], 0)
        self.assertEqual(result["label_name"], "NORMAL")
        self.assertEqual(result["action"], "ALLOW")
        self.assertGreaterEqual(result["probabilities"]["normal"], 0.5)

    def test_benign_dns_prediction(self):
        """Benign DNS flow should be classified as Normal (0)."""
        result = self.pipeline.predict_flow(BENIGN_DNS_FLOW)
        self.assertEqual(result["label"], 0)
        self.assertEqual(result["label_name"], "NORMAL")
        self.assertEqual(result["action"], "ALLOW")

    def test_attack_flow_prediction(self):
        """Recon attack flow fixture should be classified as Attack (1)."""
        result = self.pipeline.predict_flow(ATTACK_RECON_FLOW)
        self.assertEqual(result["label"], 1)
        self.assertEqual(result["label_name"], "ATTACK")
        self.assertEqual(result["action"], "ALERT")
        self.assertGreaterEqual(result["probabilities"]["attack"], 0.5)

    def test_batch_prediction(self):
        """Batch prediction returns list of results matching input length."""
        flows = [BENIGN_WEB_FLOW, ATTACK_RECON_FLOW, BENIGN_DNS_FLOW]
        results = self.pipeline.predict_batch(flows)
        self.assertEqual(len(results), 3)
        self.assertEqual(results[0]["label"], 0)
        self.assertEqual(results[1]["label"], 1)
        self.assertEqual(results[2]["label"], 0)

    def test_model_info_reports_unverified_claims(self):
        """Model info must clearly state that historical F1 score is unverified."""
        info = self.pipeline.get_info()
        self.assertEqual(info["feature_count"], 90)
        self.assertFalse(info["historical_score_verified"])
        self.assertIn("cannot be independently verified", info["notes"])


if __name__ == "__main__":
    unittest.main()
