# FlowGuard — Evaluation Methodology & Performance Gates

## 1. Dual-Track Evaluation Framework

FlowGuard enforces two distinct evaluation tracks to guarantee academic honesty and prevent fabricated claims:

### Track A — Static Model Regression (Baseline Integrity)
- **Status**: Historical training score ($F_1 = 0.9802$) **cannot be independently verified** because the raw training dataset (`data/unsw_nb15.csv`) was not bundled with the model artifacts.
- **Verification**: FlowGuard runs fixed baseline fixtures (`BENIGN_WEB_FLOW`, `BENIGN_DNS_FLOW`, `ATTACK_RECON_FLOW`) to confirm the pre-fitted Decision Tree produces deterministic predictions.

### Track B — Mininet Scenario Evaluation (Live Telemetry)
- Evaluates flows collected during controlled lab experiments against independent ground-truth manifests.
- Unlabeled flows are reported under operational telemetry only; accuracy, FPR, and recall are withheld if labels are absent.

---

## 2. Metric Formulations & Ground Rules

| Metric | Formula | Description & Handling |
|---|---|---|
| **Confusion Matrix** | `TN, FP, FN, TP` | Negative class = `Normal (0)`, Positive class = `Attack (1)` |
| **Accuracy** | $\frac{TP + TN}{\text{Total Labeled}}$ | Reported alongside class distribution to prevent imbalance distortion. |
| **Attack Recall** | $\frac{TP}{TP + FN}$ | Detection rate for intrusion flows. If $TP+FN=0$, reported as `N/A`. |
| **Benign FPR** | $\frac{FP}{FP + TN}$ | False alert rate on normal traffic. If $FP+TN=0$, reported as `N/A`. |
| **Balanced Accuracy** | $\frac{\text{Recall} + \text{Specificity}}{2}$ | Arithmetic mean of sensitivity and specificity. |
| **Precision** | $\frac{TP}{TP + FP}$ | Fraction of flagged flows that are true attacks. |
| **$F_1$ Score** | $2 \times \frac{P \times R}{P + R}$ | Harmonic mean of precision and recall. |
| **95% Confidence Intervals** | Wilson Score Interval | Computed for Attack Recall and Benign FPR. |

---

## 3. Configurable Performance Gates

FlowGuard establishes provisional targets for lab validation:
1. **Benign False Positive Rate**: $\le 5\%$
2. **Attack Recall / Detection Rate**: $\ge 80\%$
3. **Balanced Accuracy**: $\ge 80\%$
4. **Minimum Sample Support**: $\ge 5$ samples per class. If sample count is insufficient, status is set to `INSUFFICIENT_SAMPLES` rather than passing or failing.
