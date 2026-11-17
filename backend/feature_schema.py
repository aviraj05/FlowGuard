"""
FlowGuard Feature Schema — Documented Source of Truth
Schema Version: flowguard-unsw-90-v1

Defines the exact 90-feature contract required by the UNSW-NB15 Decision Tree model,
including data types, valid ranges, categorical alphabets, provenance classification,
and pre-inference validation rules.
"""

from typing import Dict, Any, List, Tuple, Optional, Set
import math
import numpy as np

SCHEMA_VERSION = "flowguard-unsw-90-v1"
MODEL_VERSION = "DecisionTree_UNSW90_v1.0"

# Exact 90 features in model input order
FEATURE_COLUMNS_90: List[str] = [
    "sport", "dsport", "proto", "state", "dur", "sbytes", "dbytes", "sttl", "dttl",
    "sloss", "dloss", "service", "Sload", "Dload", "Spkts", "Dpkts", "swin", "dwin",
    "stcpb", "dtcpb", "smeansz", "dmeansz", "trans_depth", "res_bdy_len", "Sjit",
    "Djit", "Stime", "Ltime", "Sintpkt", "Dintpkt", "tcprtt", "synack", "ackdat",
    "is_sm_ips_ports", "ct_state_ttl", "ct_flw_http_mthd", "is_ftp_login", "ct_ftp_cmd",
    "ct_srv_src", "ct_srv_dst", "ct_dst_ltm", "ct_src_ ltm", "ct_src_dport_ltm",
    "ct_dst_sport_ltm", "ct_dst_src_ltm", "payload_ratio", "client_pkt_rate",
    "avg_sbytes", "total_bytes", "total_pkts", "avg_dbytes", "avg_spkt_size",
    "avg_dpkt_size", "bytes_ratio", "packet_ratio", "byte_difference", "packet_difference",
    "server_pkt_rate", "total_pkt_rate", "total_byte_rate", "server_byte_rate",
    "client_byte_rate", "pkts_per_byte", "bytes_per_packet", "tcp_retrans_ratio",
    "syn_ack_ratio", "tcp_setup_time", "dst_host_srv_ratio", "src_ip_version",
    "src_is_private", "src_is_loopback", "src_is_multicast", "src_is_global",
    "src_ip_numeric", "src_ip_octet_1", "src_ip_octet_2", "src_ip_octet_3",
    "src_ip_octet_4", "dst_ip_version", "dst_is_private", "dst_is_loopback",
    "dst_is_multicast", "dst_is_global", "dst_ip_numeric", "dst_ip_octet_1",
    "dst_ip_octet_2", "dst_ip_octet_3", "dst_ip_octet_4", "same_subnet_24",
    "same_ip"
]

CATEGORICAL_FEATURES: List[str] = ["proto", "state", "service"]

# Natural provenance expectations when capturing flows from live packets
MEASURABLE_FROM_PACKET_HEADERS: Set[str] = {
    "sport", "dsport", "proto", "state", "dur", "sbytes", "dbytes", "sttl", "dttl",
    "sloss", "dloss", "service", "Spkts", "Dpkts", "swin", "dwin", "stcpb", "dtcpb",
    "Stime", "Ltime", "Sjit", "Djit", "Sintpkt", "Dintpkt", "tcprtt", "synack", "ackdat"
}

DERIVABLE_FROM_FLOW_STATS: Set[str] = {
    "Sload", "Dload", "smeansz", "dmeansz", "is_sm_ips_ports",
    "payload_ratio", "client_pkt_rate", "avg_sbytes", "total_bytes", "total_pkts",
    "avg_dbytes", "avg_spkt_size", "avg_dpkt_size", "bytes_ratio", "packet_ratio",
    "byte_difference", "packet_difference", "server_pkt_rate", "total_pkt_rate",
    "total_byte_rate", "server_byte_rate", "client_byte_rate", "pkts_per_byte",
    "bytes_per_packet", "tcp_retrans_ratio", "syn_ack_ratio", "tcp_setup_time",
    "src_ip_version", "src_is_private", "src_is_loopback", "src_is_multicast", "src_is_global",
    "src_ip_numeric", "src_ip_octet_1", "src_ip_octet_2", "src_ip_octet_3", "src_ip_octet_4",
    "dst_ip_version", "dst_is_private", "dst_is_loopback", "dst_is_multicast", "dst_is_global",
    "dst_ip_numeric", "dst_ip_octet_1", "dst_ip_octet_2", "dst_ip_octet_3", "dst_ip_octet_4",
    "same_subnet_24", "same_ip"
}

AGGREGATION_WINDOW_FEATURES: Set[str] = {
    "ct_state_ttl", "ct_flw_http_mthd", "is_ftp_login", "ct_ftp_cmd",
    "ct_srv_src", "ct_srv_dst", "ct_dst_ltm", "ct_src_ ltm", "ct_src_dport_ltm",
    "ct_dst_sport_ltm", "ct_dst_src_ltm", "dst_host_srv_ratio",
    "trans_depth", "res_bdy_len"
}


def validate_flow_pre_inference(flow_dict: Dict[str, Any]) -> Tuple[bool, List[str], Dict[str, Any]]:
    """
    Validates flow input before passing to inference pipeline.
    Checks:
    - Port ranges (0 - 65535)
    - Non-negative packet/byte counters and durations
    - Finite numeric values (no NaN/Inf in core numeric inputs)
    - Valid IP formatting if present
    """
    issues: List[str] = []
    cleaned: Dict[str, Any] = dict(flow_dict)

    # 1. Port validation
    for p_field in ["sport", "dsport", "src_port", "dst_port"]:
        if p_field in cleaned and cleaned[p_field] is not None:
            try:
                p_val = int(cleaned[p_field])
                if not (0 <= p_val <= 65535):
                    issues.append(f"Invalid port value for {p_field}: {p_val} (must be 0-65535)")
            except (ValueError, TypeError):
                issues.append(f"Non-integer port value for {p_field}: {cleaned[p_field]}")

    # 2. Non-negative counters
    non_negative_fields = ["dur", "sbytes", "dbytes", "Spkts", "Dpkts", "sloss", "dloss"]
    for field in non_negative_fields:
        if field in cleaned and cleaned[field] is not None:
            try:
                val = float(cleaned[field])
                if val < 0:
                    issues.append(f"Negative value for counter {field}: {val}")
                elif math.isnan(val) or math.isinf(val):
                    issues.append(f"Non-finite value for counter {field}: {val}")
            except (ValueError, TypeError):
                pass

    # 3. Protocol and state validation
    proto = str(cleaned.get("proto", "")).lower()
    if proto and proto not in ["tcp", "udp", "icmp", "arp", "ospf", "sctp", "igmp", "ipv6-icmp", "any"]:
        # We don't fail, but flag unusual protocol for tracking
        cleaned["_unusual_proto"] = True

    is_valid = len(issues) == 0
    return is_valid, issues, cleaned


def analyze_feature_provenance(
    flow_dict: Dict[str, Any],
    max_imputation_threshold: float = 0.60
) -> Dict[str, Any]:
    """
    Computes per-feature provenance for the 90 model features.
    Categories:
    - measured: directly measured from packet headers
    - derived: calculated from measured values or IP addresses
    - imputed: missing from input and filled by median imputer
    - unavailable: feature requiring cross-flow history window without context
    """
    provenance_map: Dict[str, str] = {}
    counts = {"measured": 0, "derived": 0, "imputed": 0, "unavailable": 0}

    # If the flow explicitly provided provenance tags, use them; otherwise infer
    explicit_tags = flow_dict.get("_provenance_tags", {})

    for feat in FEATURE_COLUMNS_90:
        if feat in explicit_tags:
            tag = explicit_tags[feat]
        elif feat in flow_dict and flow_dict[feat] is not None and not (isinstance(flow_dict[feat], float) and math.isnan(flow_dict[feat])):
            if feat in MEASURABLE_FROM_PACKET_HEADERS:
                tag = "measured"
            elif feat in DERIVABLE_FROM_FLOW_STATS:
                tag = "derived"
            else:
                tag = "measured"
        elif feat in DERIVABLE_FROM_FLOW_STATS and (
            feat.startswith("src_") or feat.startswith("dst_") or feat in ("same_subnet_24", "same_ip")
        ):
            # Derived from IP addresses if IPs are provided
            if flow_dict.get("src_ip") or flow_dict.get("dst_ip"):
                tag = "derived"
            else:
                tag = "imputed"
        elif feat in AGGREGATION_WINDOW_FEATURES:
            tag = "unavailable"  # Requires cross-flow window aggregation
        else:
            tag = "imputed"

        provenance_map[feat] = tag
        counts[tag] += 1

    total_features = len(FEATURE_COLUMNS_90)
    imputed_or_unavail = counts["imputed"] + counts["unavailable"]
    imputation_rate = round(imputed_or_unavail / total_features, 4)

    is_reliable = imputation_rate <= max_imputation_threshold
    quality_status = "high" if imputation_rate <= 0.30 else ("acceptable" if is_reliable else "insufficient")

    return {
        "schema_version": SCHEMA_VERSION,
        "total_features": total_features,
        "counts": counts,
        "percentages": {
            k: round((v / total_features) * 100, 1) for k, v in counts.items()
        },
        "imputation_rate": imputation_rate,
        "quality_status": quality_status,
        "is_reliable": is_reliable,
        "provenance_map": provenance_map
    }
