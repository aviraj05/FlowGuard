# FlowGuard — 90-Feature Contract & Provenance Specification

## 1. Schema Overview
- **Schema Identifier**: `flowguard-unsw-90-v1`
- **Model Classifier**: Scikit-learn Decision Tree (`best_model.joblib`)
- **Total Feature Width**: Exactly 90 numerical and categorical features in fixed positional order.
- **Categorical Columns**: `proto` (135 classes), `state` (16 classes), `service` (13 classes).
- **Categorical Encoding**: Pre-fitted `OrdinalEncoder` (`categorical_encoder.joblib`) configured with `handle_unknown='use_encoded_value'`, mapping unseen values to `-1.0`.
- **Missing Value Strategy**: Pre-fitted `SimpleImputer` (`missing_value_imputer.joblib`) using column-wise median statistics.

---

## 2. Feature Provenance Classification

When capturing live network traffic in Mininet, raw packets do not automatically produce all 90 features. FlowGuard categorizes every feature into four transparent provenance tiers:

| Tier | Definition | Examples | Handling |
|---|---|---|---|
| **`measured`** | Directly extracted from packet headers and TCP timestamps | `sport`, `dsport`, `proto`, `state`, `dur`, `sbytes`, `dbytes`, `sttl`, `dttl`, `Spkts`, `Dpkts`, `swin`, `dwin`, `stcpb`, `dtcpb`, `tcprtt`, `synack`, `ackdat` | Computed by `FlowAdapter` |
| **`derived`** | Computed mathematically from measured counters or IP addresses | `total_bytes`, `total_pkts`, `smeansz`, `dmeansz`, `Sload`, `Dload`, `payload_ratio`, `client_pkt_rate`, `src_ip_octet_1..4`, `same_subnet_24` | Computed by `FeatureMapping` |
| **`unavailable`** | Features requiring long-term host history or sliding multi-flow windows | `ct_srv_src`, `ct_srv_dst`, `ct_dst_ltm`, `ct_src_ ltm`, `ct_src_dport_ltm`, `ct_dst_sport_ltm`, `ct_dst_src_ltm`, `trans_depth`, `res_bdy_len` | Marked as absent; filled by pre-fitted median imputer |
| **`imputed`** | Missing or unmeasured fields | Any absent optional field | Filled by median imputer |

---

## 3. Imputation Quality Gate

FlowGuard evaluates the imputation rate of every scored flow:
- **High Quality**: $\le 30\%$ features imputed.
- **Acceptable Quality**: $31\% - 60\%$ features imputed.
- **Insufficient Quality**: $> 60\%$ features imputed. Flows exceeding this threshold are flagged with `is_reliable: false` and must not be presented as high-confidence detections.

---

## 4. Full 90-Feature Ordering Contract

```
 1. sport               2. dsport              3. proto               4. state               5. dur
 6. sbytes              7. dbytes              8. sttl                9. dttl               10. sloss
11. dloss              12. service            13. Sload              14. Dload              15. Spkts
16. Dpkts              17. swin               18. dwin               19. stcpb              20. dtcpb
21. smeansz            22. dmeansz            23. trans_depth        24. res_bdy_len        25. Sjit
26. Djit               27. Stime              28. Ltime              29. Sintpkt            30. Dintpkt
31. tcprtt             32. synack             33. ackdat             34. is_sm_ips_ports    35. ct_state_ttl
36. ct_flw_http_mthd   37. is_ftp_login       38. ct_ftp_cmd         39. ct_srv_src         40. ct_srv_dst
41. ct_dst_ltm         42. ct_src_ ltm        43. ct_src_dport_ltm   44. ct_dst_sport_ltm   45. ct_dst_src_ltm
46. payload_ratio      47. client_pkt_rate    48. avg_sbytes         49. total_bytes        50. total_pkts
51. avg_dbytes         52. avg_spkt_size      53. avg_dpkt_size      54. bytes_ratio        55. packet_ratio
56. byte_difference    57. packet_difference  58. server_pkt_rate    59. total_pkt_rate     60. total_byte_rate
61. server_byte_rate   62. client_byte_rate   63. pkts_per_byte      64. bytes_per_packet   65. tcp_retrans_ratio
66. syn_ack_ratio      67. tcp_setup_time     68. dst_host_srv_ratio 69. src_ip_version     70. src_is_private
71. src_is_loopback    72. src_is_multicast   73. src_is_global      74. src_ip_numeric     75. src_ip_octet_1
76. src_ip_octet_2     77. src_ip_octet_3     78. src_ip_octet_4     79. dst_ip_version     80. dst_is_private
81. dst_is_loopback    82. dst_is_multicast   83. dst_is_global      84. dst_ip_numeric     85. dst_ip_octet_1
86. dst_ip_octet_2     87. dst_ip_octet_3     88. dst_ip_octet_4     89. same_subnet_24     90. same_ip
```
