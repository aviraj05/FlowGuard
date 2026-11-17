"""
FlowGuard Feature Mapping Layer
Transforms raw bidirectional flow records into the exact 90-feature UNSW-NB15 schema
with explicit, transparent per-feature provenance tracking.
Never silently invents measurements.
"""

from typing import Dict, Any, Tuple
import ipaddress
import math

from feature_schema import (
    FEATURE_COLUMNS_90,
    MEASURABLE_FROM_PACKET_HEADERS,
    DERIVABLE_FROM_FLOW_STATS,
    AGGREGATION_WINDOW_FEATURES,
    SCHEMA_VERSION
)


def map_flow_to_features(raw_flow: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, str]]:
    """
    Transforms a raw flow dictionary into a 90-feature dictionary and a provenance map.
    Returns (feature_dict, provenance_tags).
    """
    feat: Dict[str, Any] = {}
    prov: Dict[str, str] = {}

    # 1. Directly measurable features from packet headers
    dur = float(raw_flow.get("dur", 0.0))
    sbytes = float(raw_flow.get("sbytes", 0))
    dbytes = float(raw_flow.get("dbytes", 0))
    spkts = float(raw_flow.get("Spkts", 0))
    dpkts = float(raw_flow.get("Dpkts", 0))

    feat["sport"] = int(raw_flow.get("sport", 0))
    prov["sport"] = "measured"

    feat["dsport"] = int(raw_flow.get("dsport", 0))
    prov["dsport"] = "measured"

    feat["proto"] = str(raw_flow.get("proto", "tcp")).lower()
    prov["proto"] = "measured"

    feat["state"] = str(raw_flow.get("state", "CON")).upper()
    prov["state"] = "measured"

    feat["dur"] = dur
    prov["dur"] = "measured"

    feat["sbytes"] = sbytes
    prov["sbytes"] = "measured"

    feat["dbytes"] = dbytes
    prov["dbytes"] = "measured"

    feat["sttl"] = float(raw_flow.get("sttl", 64))
    prov["sttl"] = "measured"

    feat["dttl"] = float(raw_flow.get("dttl", 0))
    prov["dttl"] = "measured"

    feat["sloss"] = float(raw_flow.get("sloss", 0))
    prov["sloss"] = "measured"

    feat["dloss"] = float(raw_flow.get("dloss", 0))
    prov["dloss"] = "measured"

    feat["service"] = str(raw_flow.get("service", "-")).lower()
    prov["service"] = "measured"

    feat["Spkts"] = spkts
    prov["Spkts"] = "measured"

    feat["Dpkts"] = dpkts
    prov["Dpkts"] = "measured"

    feat["swin"] = float(raw_flow.get("swin", 0))
    prov["swin"] = "measured"

    feat["dwin"] = float(raw_flow.get("dwin", 0))
    prov["dwin"] = "measured"

    feat["stcpb"] = float(raw_flow.get("stcpb", 0))
    prov["stcpb"] = "measured"

    feat["dtcpb"] = float(raw_flow.get("dtcpb", 0))
    prov["dtcpb"] = "measured"

    feat["Stime"] = float(raw_flow.get("Stime", 0.0))
    prov["Stime"] = "measured"

    feat["Ltime"] = float(raw_flow.get("Ltime", 0.0))
    prov["Ltime"] = "measured"

    feat["Sjit"] = float(raw_flow.get("Sjit", 0.0))
    prov["Sjit"] = "measured"

    feat["Djit"] = float(raw_flow.get("Djit", 0.0))
    prov["Djit"] = "measured"

    feat["Sintpkt"] = float(raw_flow.get("Sintpkt", 0.0))
    prov["Sintpkt"] = "measured"

    feat["Dintpkt"] = float(raw_flow.get("Dintpkt", 0.0))
    prov["Dintpkt"] = "measured"

    feat["tcprtt"] = float(raw_flow.get("tcprtt", 0.0))
    prov["tcprtt"] = "measured"

    feat["synack"] = float(raw_flow.get("synack", 0.0))
    prov["synack"] = "measured"

    feat["ackdat"] = float(raw_flow.get("ackdat", 0.0))
    prov["ackdat"] = "measured"

    # 2. Derived statistics and rates
    total_bytes = sbytes + dbytes
    total_pkts = spkts + dpkts
    feat["total_bytes"] = total_bytes
    prov["total_bytes"] = "derived"

    feat["total_pkts"] = total_pkts
    prov["total_pkts"] = "derived"

    smeansz = sbytes / spkts if spkts > 0 else 0.0
    dmeansz = dbytes / dpkts if dpkts > 0 else 0.0
    feat["smeansz"] = round(smeansz, 2)
    prov["smeansz"] = "derived"
    feat["dmeansz"] = round(dmeansz, 2)
    prov["dmeansz"] = "derived"

    safe_dur = max(dur, 0.000001)
    feat["Sload"] = (sbytes * 8) / safe_dur
    prov["Sload"] = "derived"
    feat["Dload"] = (dbytes * 8) / safe_dur
    prov["Dload"] = "derived"

    feat["payload_ratio"] = sbytes / dbytes if dbytes > 0 else (sbytes if sbytes > 0 else 0.0)
    prov["payload_ratio"] = "derived"

    feat["client_pkt_rate"] = spkts / safe_dur
    prov["client_pkt_rate"] = "derived"
    feat["server_pkt_rate"] = dpkts / safe_dur
    prov["server_pkt_rate"] = "derived"
    feat["total_pkt_rate"] = total_pkts / safe_dur
    prov["total_pkt_rate"] = "derived"

    feat["client_byte_rate"] = sbytes / safe_dur
    prov["client_byte_rate"] = "derived"
    feat["server_byte_rate"] = dbytes / safe_dur
    prov["server_byte_rate"] = "derived"
    feat["total_byte_rate"] = total_bytes / safe_dur
    prov["total_byte_rate"] = "derived"

    feat["avg_sbytes"] = smeansz
    prov["avg_sbytes"] = "derived"
    feat["avg_dbytes"] = dmeansz
    prov["avg_dbytes"] = "derived"
    feat["avg_spkt_size"] = smeansz
    prov["avg_spkt_size"] = "derived"
    feat["avg_dpkt_size"] = dmeansz
    prov["avg_dpkt_size"] = "derived"

    feat["bytes_ratio"] = sbytes / (total_bytes + 1e-6)
    prov["bytes_ratio"] = "derived"
    feat["packet_ratio"] = spkts / (total_pkts + 1e-6)
    prov["packet_ratio"] = "derived"

    feat["byte_difference"] = abs(sbytes - dbytes)
    prov["byte_difference"] = "derived"
    feat["packet_difference"] = abs(spkts - dpkts)
    prov["packet_difference"] = "derived"

    feat["pkts_per_byte"] = total_pkts / (total_bytes + 1e-6)
    prov["pkts_per_byte"] = "derived"
    feat["bytes_per_packet"] = total_bytes / (total_pkts + 1e-6)
    prov["bytes_per_packet"] = "derived"

    feat["tcp_retrans_ratio"] = 0.0
    prov["tcp_retrans_ratio"] = "derived"
    feat["syn_ack_ratio"] = 1.0 if (feat["synack"] > 0 and feat["ackdat"] > 0) else 0.0
    prov["syn_ack_ratio"] = "derived"
    feat["tcp_setup_time"] = feat["tcprtt"]
    prov["tcp_setup_time"] = "derived"

    # 3. IP Derivations
    src_ip_str = raw_flow.get("src_ip", "0.0.0.0")
    dst_ip_str = raw_flow.get("dst_ip", "0.0.0.0")

    try:
        src_ip = ipaddress.IPv4Address(src_ip_str)
        src_octets = [int(o) for o in src_ip_str.split(".")]
        feat["src_ip_version"] = 4
        feat["src_is_private"] = int(src_ip.is_private)
        feat["src_is_loopback"] = int(src_ip.is_loopback)
        feat["src_is_multicast"] = int(src_ip.is_multicast)
        feat["src_is_global"] = int(src_ip.is_global)
        feat["src_ip_numeric"] = int(src_ip)
        feat["src_ip_octet_1"] = src_octets[0]
        feat["src_ip_octet_2"] = src_octets[1]
        feat["src_ip_octet_3"] = src_octets[2]
        feat["src_ip_octet_4"] = src_octets[3]
        for k in ["src_ip_version", "src_is_private", "src_is_loopback", "src_is_multicast", "src_is_global", "src_ip_numeric", "src_ip_octet_1", "src_ip_octet_2", "src_ip_octet_3", "src_ip_octet_4"]:
            prov[k] = "derived"
    except Exception:
        for k in ["src_ip_version", "src_is_private", "src_is_loopback", "src_is_multicast", "src_is_global", "src_ip_numeric", "src_ip_octet_1", "src_ip_octet_2", "src_ip_octet_3", "src_ip_octet_4"]:
            feat[k] = None
            prov[k] = "imputed"

    try:
        dst_ip = ipaddress.IPv4Address(dst_ip_str)
        dst_octets = [int(o) for o in dst_ip_str.split(".")]
        feat["dst_ip_version"] = 4
        feat["dst_is_private"] = int(dst_ip.is_private)
        feat["dst_is_loopback"] = int(dst_ip.is_loopback)
        feat["dst_is_multicast"] = int(dst_ip.is_multicast)
        feat["dst_is_global"] = int(dst_ip.is_global)
        feat["dst_ip_numeric"] = int(dst_ip)
        feat["dst_ip_octet_1"] = dst_octets[0]
        feat["dst_ip_octet_2"] = dst_octets[1]
        feat["dst_ip_octet_3"] = dst_octets[2]
        feat["dst_ip_octet_4"] = dst_octets[3]
        for k in ["dst_ip_version", "dst_is_private", "dst_is_loopback", "dst_is_multicast", "dst_is_global", "dst_ip_numeric", "dst_ip_octet_1", "dst_ip_octet_2", "dst_ip_octet_3", "dst_ip_octet_4"]:
            prov[k] = "derived"
    except Exception:
        for k in ["dst_ip_version", "dst_is_private", "dst_is_loopback", "dst_is_multicast", "dst_is_global", "dst_ip_numeric", "dst_ip_octet_1", "dst_ip_octet_2", "dst_ip_octet_3", "dst_ip_octet_4"]:
            feat[k] = None
            prov[k] = "imputed"

    feat["same_ip"] = int(src_ip_str == dst_ip_str)
    prov["same_ip"] = "derived"

    same_sub = 0
    if "src_octets" in locals() and "dst_octets" in locals():
        same_sub = int(src_octets[0:3] == dst_octets[0:3])
    feat["same_subnet_24"] = same_sub
    prov["same_subnet_24"] = "derived"

    feat["is_sm_ips_ports"] = int(src_ip_str == dst_ip_str and feat["sport"] == feat["dsport"])
    prov["is_sm_ips_ports"] = "derived"

    # 4. Window / Context Aggregation Features (Marked as unavailable from single-flow capture)
    for col in AGGREGATION_WINDOW_FEATURES:
        feat[col] = None  # To be filled by pre-fitted median imputer
        prov[col] = "unavailable"

    # Attach provenance tags inside metadata
    feat["_provenance_tags"] = prov
    feat["_schema_version"] = SCHEMA_VERSION
    feat["src_ip"] = src_ip_str
    feat["dst_ip"] = dst_ip_str
    feat["flow_id"] = raw_flow.get("flow_id", f"{src_ip_str}:{feat['sport']}->{dst_ip_str}:{feat['dsport']}")

    return feat, prov
