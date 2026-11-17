"""
FlowGuard Model Evaluation & Performance Gate Engine
Implements rigorous, honest evaluation metrics:
- Rejects reporting accuracy/recall/FPR on unlabeled data
- Computes Confusion Matrix (TN, FP, FN, TP), Accuracy, Balanced Accuracy, Precision, Recall, FPR, F1
- Computes 95% Wilson confidence intervals
- Computes latency p50/p95 and feature quality metrics
- Evaluates against provisional performance gates (FPR <= 5%, Recall >= 80%, Balanced Acc >= 80%)
"""

from typing import Dict, Any, List, Optional, Tuple
import math
import numpy as np

# Provisional evaluation gates
DEFAULT_GATES = {
    "max_fpr": 0.05,            # Benign False Positive Rate <= 5%
    "min_recall": 0.80,         # Attack Recall / Detection Rate >= 80%
    "min_balanced_acc": 0.80,   # Balanced Accuracy >= 80%
    "min_samples_per_class": 5, # Minimum samples required to evaluate gates
}


def wilson_score_interval(successes: int, trials: int, confidence: float = 0.95) -> Tuple[Optional[float], Optional[float]]:
    """Calculates Wilson score 95% confidence interval for a proportion."""
    if trials == 0:
        return None, None
    z = 1.95996  # 95% confidence standard normal quantile
    p = successes / trials
    denominator = 1 + (z ** 2) / trials
    centre_adj = p + (z ** 2) / (2 * trials)
    adjusted_diff = z * math.sqrt((p * (1 - p) + (z ** 2) / (4 * trials)) / trials)

    lower = max(0.0, (centre_adj - adjusted_diff) / denominator)
    upper = min(1.0, (centre_adj + adjusted_diff) / denominator)
    return round(lower, 4), round(upper, 4)


def evaluate_flows(
    records: List[Dict[str, Any]],
    gates: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Evaluates a set of flow records with ground-truth vs model prediction.
    Each record must have:
      - 'ground_truth': 0, 1, or None / -1 (unlabeled)
      - 'prediction': 0 or 1
      - 'latency_ms': optional float
      - 'imputation_rate': optional float
    """
    active_gates = dict(DEFAULT_GATES)
    if gates:
        active_gates.update(gates)

    total_records = len(records)
    labeled_records = []
    unlabeled_count = 0
    latencies: List[float] = []
    imputation_rates: List[float] = []

    for r in records:
        gt = r.get("ground_truth")
        pred = r.get("prediction")

        if "latency_ms" in r and r["latency_ms"] is not None:
            latencies.append(float(r["latency_ms"]))
        if "imputation_rate" in r and r["imputation_rate"] is not None:
            imputation_rates.append(float(r["imputation_rate"]))

        if gt in [0, 1] and pred in [0, 1]:
            labeled_records.append(r)
        else:
            unlabeled_count += 1

    # Operational Telemetry (Available regardless of labels)
    latency_summary = {
        "count": len(latencies),
        "mean_ms": round(float(np.mean(latencies)), 2) if latencies else None,
        "p50_ms": round(float(np.percentile(latencies, 50)), 2) if latencies else None,
        "p95_ms": round(float(np.percentile(latencies, 95)), 2) if latencies else None,
    }

    avg_imputation = round(float(np.mean(imputation_rates)), 4) if imputation_rates else None

    # Track B: Check if ground-truth labels are available
    if not labeled_records:
        return {
            "evaluation_status": "UNLABELED",
            "message": "Ground-truth labels missing. Supervised metrics (accuracy, FPR, recall) cannot be calculated.",
            "total_records": total_records,
            "labeled_count": 0,
            "unlabeled_count": unlabeled_count,
            "operational_telemetry": {
                "latency": latency_summary,
                "avg_imputation_rate": avg_imputation,
            },
            "metrics": None,
            "confusion_matrix": None,
            "gates_passed": False,
            "gate_results": {},
        }

    # Compute Confusion Matrix
    # Negative class = 0 (Normal), Positive class = 1 (Attack)
    tn = 0  # GT=0, Pred=0
    fp = 0  # GT=0, Pred=1
    fn = 0  # GT=1, Pred=0
    tp = 0  # GT=1, Pred=1

    for r in labeled_records:
        gt = int(r["ground_truth"])
        pred = int(r["prediction"])
        if gt == 0 and pred == 0:
            tn += 1
        elif gt == 0 and pred == 1:
            fp += 1
        elif gt == 1 and pred == 0:
            fn += 1
        elif gt == 1 and pred == 1:
            tp += 1

    normal_support = tn + fp
    attack_support = tp + fn
    total_labeled = len(labeled_records)

    # Calculate metrics with missing-class protection
    accuracy = round((tp + tn) / total_labeled, 4)

    # Attack Recall / Detection Rate (TP / (TP + FN))
    recall = round(tp / attack_support, 4) if attack_support > 0 else None
    recall_ci = wilson_score_interval(tp, attack_support) if attack_support > 0 else (None, None)

    # Benign False Positive Rate (FP / (FP + TN))
    fpr = round(fp / normal_support, 4) if normal_support > 0 else None
    fpr_ci = wilson_score_interval(fp, normal_support) if normal_support > 0 else (None, None)

    # Specificity / True Negative Rate (TN / (TN + FP))
    specificity = round(tn / normal_support, 4) if normal_support > 0 else None

    # Precision (TP / (TP + FP))
    precision = round(tp / (tp + fp), 4) if (tp + fp) > 0 else None

    # F1 Score (2 * P * R / (P + R))
    if precision is not None and recall is not None and (precision + recall) > 0:
        f1_score = round(2 * (precision * recall) / (precision + recall), 4)
    else:
        f1_score = None

    # Balanced Accuracy: (Sensitivity + Specificity) / 2
    if recall is not None and specificity is not None:
        balanced_accuracy = round((recall + specificity) / 2.0, 4)
    else:
        balanced_accuracy = None

    # Performance Gate Checks
    gate_results = {}
    min_samples = active_gates["min_samples_per_class"]
    has_sufficient_samples = (normal_support >= min_samples) and (attack_support >= min_samples)

    if not has_sufficient_samples:
        gate_status = "INSUFFICIENT_SAMPLES"
        gate_message = (
            f"Evaluation requires at least {min_samples} samples per class to evaluate gates "
            f"(found {normal_support} Normal, {attack_support} Attack)."
        )
    else:
        fpr_passed = (fpr is not None) and (fpr <= active_gates["max_fpr"])
        recall_passed = (recall is not None) and (recall >= active_gates["min_recall"])
        bal_acc_passed = (balanced_accuracy is not None) and (balanced_accuracy >= active_gates["min_balanced_acc"])

        gate_results["fpr"] = {
            "target": f"<= {active_gates['max_fpr']}",
            "value": fpr,
            "passed": fpr_passed
        }
        gate_results["attack_recall"] = {
            "target": f">= {active_gates['min_recall']}",
            "value": recall,
            "passed": recall_passed
        }
        gate_results["balanced_accuracy"] = {
            "target": f">= {active_gates['min_balanced_acc']}",
            "value": balanced_accuracy,
            "passed": bal_acc_passed
        }

        all_passed = fpr_passed and recall_passed and bal_acc_passed
        gate_status = "PASSED" if all_passed else "FAILED"
        gate_message = "All performance gates satisfied." if all_passed else "One or more performance gates failed."

    return {
        "evaluation_status": gate_status,
        "message": gate_message,
        "total_records": total_records,
        "labeled_count": total_labeled,
        "unlabeled_count": unlabeled_count,
        "class_support": {
            "normal": normal_support,
            "attack": attack_support,
            "unlabeled": unlabeled_count,
        },
        "confusion_matrix": {
            "true_negatives": tn,
            "false_positives": fp,
            "false_negatives": fn,
            "true_positives": tp,
        },
        "metrics": {
            "accuracy": accuracy,
            "balanced_accuracy": balanced_accuracy,
            "precision": precision,
            "attack_recall": recall,
            "attack_recall_ci_95": recall_ci,
            "benign_false_positive_rate": fpr,
            "benign_fpr_ci_95": fpr_ci,
            "specificity": specificity,
            "f1_score": f1_score,
        },
        "operational_telemetry": {
            "latency": latency_summary,
            "avg_imputation_rate": avg_imputation,
        },
        "gates_configured": active_gates,
        "gate_results": gate_results,
    }
