"""
Unit tests for FlowGuard Feature Schema, Pre-Inference Validation, and Provenance.
"""

import unittest
import sys
from pathlib import Path
import json

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from feature_schema import (
    FEATURE_COLUMNS_90,
    CATEGORICAL_FEATURES,
    SCHEMA_VERSION,
    validate_flow_pre_inference,
    analyze_feature_provenance,
)
from model_pipeline import get_pipeline
from fixtures.flow_fixtures import BENIGN_WEB_FLOW, ATTACK_RECON_FLOW

class TestFeatureSchema(unittest.TestCase):
    def setUp(self):
        self.pipeline = get_pipeline()

    def test_feature_count_and_order(self):
        """Must define exactly 90 features matching metadata.json."""
        self.assertEqual(len(FEATURE_COLUMNS_90), 90)
        
        meta_path = BACKEND_DIR.parent / "model files" / "metadata.json"
        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            self.assertEqual(FEATURE_COLUMNS_90, meta["feature_columns"])

    def test_categorical_features(self):
        """Categoricals must be proto, state, service."""
        self.assertEqual(CATEGORICAL_FEATURES, ["proto", "state", "service"])

    def test_validation_clean_flow(self):
        """Clean flow passes pre-inference validation."""
        valid, issues, cleaned = validate_flow_pre_inference(BENIGN_WEB_FLOW)
        self.assertTrue(valid)
        self.assertEqual(len(issues), 0)

    def test_validation_invalid_port_and_negative_counter(self):
        """Out of range port and negative duration are flagged."""
        bad_flow = {
            "sport": 99999,  # invalid port > 65535
            "dur": -1.5,     # negative duration
            "sbytes": 100,
        }
        valid, issues, cleaned = validate_flow_pre_inference(bad_flow)
        self.assertFalse(valid)
        self.assertTrue(any("Invalid port" in iss for iss in issues))
        self.assertTrue(any("Negative value" in iss for iss in issues))

    def test_provenance_analysis(self):
        """Provenance analysis returns accurate counts and imputation rates."""
        prov = analyze_feature_provenance(BENIGN_WEB_FLOW)
        self.assertEqual(prov["total_features"], 90)
        self.assertIn("counts", prov)
        self.assertIn("percentages", prov)
        self.assertIn("imputation_rate", prov)
        self.assertIn(prov["quality_status"], ["high", "acceptable", "insufficient"])

    def test_high_imputation_triggers_insufficient_quality(self):
        """Flow with almost no features has high imputation rate and insufficient quality."""
        sparse_flow = {"proto": "tcp"}
        prov = analyze_feature_provenance(sparse_flow)
        self.assertGreater(prov["imputation_rate"], 0.60)
        self.assertEqual(prov["quality_status"], "insufficient")
        self.assertFalse(prov["is_reliable"])

    def test_unknown_category_safe_handling(self):
        """Unseen protocol/state/service does not crash inference."""
        weird_flow = dict(BENIGN_WEB_FLOW)
        weird_flow["proto"] = "xyz_unknown_proto_99"
        weird_flow["state"] = "UNKNOWN_STATE"
        weird_flow["service"] = "nonexistent_svc"
        
        # Should execute without throwing ValueError
        res = self.pipeline.predict_flow(weird_flow)
        self.assertIn(res["label"], [0, 1])
        self.assertIn("provenance", res)

if __name__ == "__main__":
    unittest.main()
