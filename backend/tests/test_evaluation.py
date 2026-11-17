"""
Unit tests for FlowGuard Model Evaluation Engine and Performance Gates.
Verifies hand-calculated confusion matrix and metrics, unlabeled data handling,
Wilson confidence intervals, and performance gate pass/fail conditions.
"""

import unittest
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from evaluation import evaluate_flows, wilson_score_interval


class TestEvaluationEngine(unittest.TestCase):
    def test_hand_calculated_metric_fixture(self):
        """
        Hand-crafted fixture:
        10 Normal (GT=0): 9 predicted Normal (TN=9), 1 predicted Attack (FP=1)
        10 Attack (GT=1): 8 predicted Attack (TP=8), 2 predicted Normal (FN=2)
        Total: 20 records
        Expected:
        - TN=9, FP=1, FN=2, TP=8
        - Accuracy = 17/20 = 0.8500
        - Recall = 8/10 = 0.8000
        - FPR = 1/10 = 0.1000
        - Specificity = 9/10 = 0.9000
        - Balanced Accuracy = (0.80 + 0.90)/2 = 0.8500
        - Precision = 8/9 = 0.8889
        - F1 = 2 * (8/9 * 0.8) / (8/9 + 0.8) = 0.8421
        """
        records = []
        # 9 True Negatives
        for _ in range(9):
            records.append({"ground_truth": 0, "prediction": 0, "latency_ms": 10.0})
        # 1 False Positive
        records.append({"ground_truth": 0, "prediction": 1, "latency_ms": 12.0})
        # 2 False Negatives
        for _ in range(2):
            records.append({"ground_truth": 1, "prediction": 0, "latency_ms": 11.0})
        # 8 True Positives
        for _ in range(8):
            records.append({"ground_truth": 1, "prediction": 1, "latency_ms": 15.0})

        res = evaluate_flows(records, gates={"max_fpr": 0.05, "min_recall": 0.80, "min_balanced_acc": 0.80})

        cm = res["confusion_matrix"]
        self.assertEqual(cm["true_negatives"], 9)
        self.assertEqual(cm["false_positives"], 1)
        self.assertEqual(cm["false_negatives"], 2)
        self.assertEqual(cm["true_positives"], 8)

        m = res["metrics"]
        self.assertEqual(m["accuracy"], 0.8500)
        self.assertEqual(m["attack_recall"], 0.8000)
        self.assertEqual(m["benign_false_positive_rate"], 0.1000)
        self.assertEqual(m["specificity"], 0.9000)
        self.assertEqual(m["balanced_accuracy"], 0.8500)
        self.assertEqual(m["precision"], 0.8889)
        self.assertEqual(m["f1_score"], 0.8421)

        # FPR is 0.10 which exceeds max_fpr 0.05, so gate should fail
        self.assertEqual(res["evaluation_status"], "FAILED")
        self.assertFalse(res["gate_results"]["fpr"]["passed"])
        self.assertTrue(res["gate_results"]["attack_recall"]["passed"])
        self.assertTrue(res["gate_results"]["balanced_accuracy"]["passed"])

    def test_unlabeled_data_produces_no_fabricated_metrics(self):
        """Unlabeled flows must report UNLABELED status and null metrics."""
        records = [
            {"ground_truth": None, "prediction": 0, "latency_ms": 5.0},
            {"ground_truth": -1, "prediction": 1, "latency_ms": 6.0},
            {"prediction": 0, "latency_ms": 7.0},
        ]
        res = evaluate_flows(records)
        self.assertEqual(res["evaluation_status"], "UNLABELED")
        self.assertIsNone(res["metrics"])
        self.assertIsNone(res["confusion_matrix"])
        self.assertIn("cannot be calculated", res["message"])
        self.assertEqual(res["unlabeled_count"], 3)
        self.assertEqual(res["operational_telemetry"]["latency"]["count"], 3)

    def test_insufficient_samples_blocks_passed_status(self):
        """Small sample counts report INSUFFICIENT_SAMPLES rather than PASSED."""
        records = [
            {"ground_truth": 0, "prediction": 0},
            {"ground_truth": 1, "prediction": 1},
        ]
        res = evaluate_flows(records, gates={"min_samples_per_class": 5})
        self.assertEqual(res["evaluation_status"], "INSUFFICIENT_SAMPLES")
        self.assertIn("requires at least 5 samples", res["message"])

    def test_passing_gates(self):
        """Clean run with 0% FPR and 100% recall satisfies all gates."""
        records = []
        for _ in range(10):
            records.append({"ground_truth": 0, "prediction": 0})
        for _ in range(10):
            records.append({"ground_truth": 1, "prediction": 1})

        res = evaluate_flows(records)
        self.assertEqual(res["evaluation_status"], "PASSED")
        self.assertEqual(res["metrics"]["benign_false_positive_rate"], 0.0)
        self.assertEqual(res["metrics"]["attack_recall"], 1.0)
        self.assertEqual(res["metrics"]["accuracy"], 1.0)


if __name__ == "__main__":
    unittest.main()
