# FlowGuard — Known Limitations & Honest Disclosures

## 1. No Automatic Packet Blocking
- **Disclosure**: FlowGuard operates strictly as an **intrusion detection, telemetry monitoring, and alerting system**.
- **Details**: The dashboard uses honest terms such as **"FLAGGED"** and **"ALERTED"**. It does not perform active kernel packet filtering, inline firewall drops, or OpenFlow flow rule eviction.

## 2. No Live Campus or Production Packet Sniffing
- **Disclosure**: Traffic capture is confined strictly to the virtual Mininet switch interface (`s1-eth1` / `s1-eth2`) within an isolated Linux VM.
- **Details**: Generating port scans or attack traffic across university, campus, or public networks is prohibited.

## 3. Unverified Historical F1 Score
- **Disclosure**: The historical F1 score of **0.9802** cited in `metadata.json` is unverified.
- **Details**: The original UNSW-NB15 training dataset and train/test splits were not bundled with the artifacts. FlowGuard reports this number with an explicit disclosure and does not claim to have reproduced it.

## 4. Decision Tree Probability Scores
- **Disclosure**: Probability outputs from `predict_proba()` represent tree leaf node sample proportions and may not correspond to calibrated confidence intervals.

## 5. Single-Flow Imputation Overhead
- **Disclosure**: Approximately 15 features in the 90-feature schema require sliding-window context across multiple flows (`ct_srv_src`, `ct_dst_ltm`, etc.). Single-flow captures have these features median-imputed by design.
