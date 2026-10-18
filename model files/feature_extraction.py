import ipaddress
import re

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin


EXPECTED_FEATURES = [
    "sport", "dsport", "proto", "state", "dur", "sbytes", "dbytes", "sttl",
    "dttl", "sloss", "dloss", "service", "Sload", "Dload", "Spkts", "Dpkts",
    "swin", "dwin", "stcpb", "dtcpb", "smeansz", "dmeansz", "trans_depth",
    "res_bdy_len", "Sjit", "Djit", "Stime", "Ltime", "Sintpkt", "Dintpkt",
    "tcprtt", "synack", "ackdat", "is_sm_ips_ports", "ct_state_ttl",
    "ct_flw_http_mthd", "is_ftp_login", "ct_ftp_cmd", "ct_srv_src",
    "ct_srv_dst", "ct_dst_ltm", "ct_src_ ltm", "ct_src_dport_ltm",
    "ct_dst_sport_ltm", "ct_dst_src_ltm", "payload_ratio", "client_pkt_rate",
    "avg_sbytes", "total_bytes", "total_pkts", "avg_dbytes", "avg_spkt_size",
    "avg_dpkt_size", "bytes_ratio", "packet_ratio", "byte_difference",
    "packet_difference", "server_pkt_rate", "total_pkt_rate", "total_byte_rate",
    "server_byte_rate", "client_byte_rate", "pkts_per_byte", "bytes_per_packet",
    "tcp_retrans_ratio", "syn_ack_ratio", "tcp_setup_time", "dst_host_srv_ratio",
    "src_ip_version", "src_is_private", "src_is_loopback", "src_is_multicast",
    "src_is_global", "src_ip_numeric", "src_ip_octet_1", "src_ip_octet_2",
    "src_ip_octet_3", "src_ip_octet_4", "dst_ip_version", "dst_is_private",
    "dst_is_loopback", "dst_is_multicast", "dst_is_global", "dst_ip_numeric",
    "dst_ip_octet_1", "dst_ip_octet_2", "dst_ip_octet_3", "dst_ip_octet_4",
    "same_subnet_24", "same_ip"
]


def _norm(name):
    return re.sub(r"\s+", "", str(name)).lower()


def _parse_numeric(value):
    if pd.isna(value):
        return np.nan
    if isinstance(value, (int, float, np.integer, np.floating)):
        value = float(value)
        return value if np.isfinite(value) else np.nan
    text = str(value).strip()
    if text.lower() in {"", "nan", "none", "null", "na", "n/a", "-", "inf", "+inf", "-inf", "infinity"}:
        return np.nan
    if re.fullmatch(r"[+-]?0[xX][0-9a-fA-F]+", text):
        try:
            sign = -1 if text.startswith("-") else 1
            return float(sign * int(text.lstrip("+-"), 16))
        except (ValueError, OverflowError):
            return np.nan
    try:
        value = float(text)
        return value if np.isfinite(value) else np.nan
    except (ValueError, TypeError, OverflowError):
        return np.nan


def _parse_ip(value):
    try:
        ip = ipaddress.ip_address(str(value).strip())
        if ip.version == 4:
            subnet = str(ipaddress.ip_network(f"{ip}/24", strict=False))
            octets = [int(part) for part in str(ip).split(".")]
            numeric = float(int(ip))
        else:
            subnet = str(ipaddress.ip_network(f"{ip}/64", strict=False))
            octets = [np.nan] * 4
            numeric = np.nan
        return {
            "version": ip.version, "private": int(ip.is_private),
            "loopback": int(ip.is_loopback), "multicast": int(ip.is_multicast),
            "global": int(ip.is_global), "numeric": numeric, "subnet": subnet,
            "octet1": octets[0], "octet2": octets[1],
            "octet3": octets[2], "octet4": octets[3],
            "octet_1": octets[0], "octet_2": octets[1],
            "octet_3": octets[2], "octet_4": octets[3]
        }
    except (ValueError, TypeError):
        return {k: np.nan for k in (
            "version", "private", "loopback", "multicast", "global",
            "numeric", "subnet", "octet1", "octet2", "octet3", "octet4",
            "octet_1", "octet_2", "octet_3", "octet_4"
        )}


class UNSWFeatureExtractor(BaseEstimator, TransformerMixin):
    """Create the model's fixed 90-feature schema. Never adds extra model features."""

    def fit(self, X, y=None):
        if not isinstance(X, pd.DataFrame):
            raise TypeError("UNSWFeatureExtractor requires a pandas DataFrame.")
        self.feature_names_in_ = np.asarray([str(c).strip() for c in X.columns], dtype=object)
        return self

    def transform(self, X):
        if not isinstance(X, pd.DataFrame):
            raise TypeError("UNSWFeatureExtractor requires a pandas DataFrame.")

        df = X.copy()
        df.columns = [str(c).strip() for c in df.columns]

        # Normalize known dataset aliases while preserving the model's 90-column output schema.
        rename = {}
        for c in df.columns:
            key = _norm(c)
            if key == "resbd ylen".replace(" ", "") or key == "res_bdy_len":
                rename[c] = "res_bdy_len"
            elif key == "ct_src_ltm":
                rename[c] = "ct_src_ ltm"
        if rename:
            df = df.rename(columns=rename)
        if df.columns.duplicated().any():
            df = df.loc[:, ~df.columns.duplicated(keep="first")].copy()

        lookup = {_norm(c): c for c in df.columns}

        def col(name):
            return lookup.get(_norm(name))

        def series(name):
            c = col(name)
            return pd.to_numeric(df[c].map(_parse_numeric), errors="coerce") if c else None

        # Derive IP features only when raw IP columns are actually available.
        src_col, dst_col = col("srcip"), col("dstip")
        src_parsed = df[src_col].map(_parse_ip) if src_col else None
        dst_parsed = df[dst_col].map(_parse_ip) if dst_col else None

        def set_if_missing(name, values):
            if name not in df.columns:
                df[name] = values

        if src_col:
            for key in ("version", "private", "loopback", "multicast", "global", "numeric", "octet1", "octet2", "octet3", "octet4", "octet_1", "octet_2", "octet_3", "octet_4"):
                set_if_missing(f"src_ip_{key}", src_parsed.map(lambda v, k=key: v[k]))
        if dst_col:
            for key in ("version", "private", "loopback", "multicast", "global", "numeric", "octet1", "octet2", "octet3", "octet4", "octet_1", "octet_2", "octet_3", "octet_4"):
                set_if_missing(f"dst_ip_{key}", dst_parsed.map(lambda v, k=key: v[k]))
        if src_col and dst_col:
            src = df[src_col].astype("string").str.strip()
            dst = df[dst_col].astype("string").str.strip()
            set_if_missing("same_ip", (src.notna() & dst.notna() & src.eq(dst)).astype("float64"))
            src_subnet = src_parsed.map(lambda v: v["subnet"]).astype("string")
            dst_subnet = dst_parsed.map(lambda v: v["subnet"]).astype("string")
            set_if_missing("same_subnet_24", (
                src_subnet.notna() & dst_subnet.notna() & src_subnet.eq(dst_subnet)
            ).astype("float64"))

        # Build only the engineered columns that belong to the fixed 90-feature contract.
        sbytes, dbytes = series("sbytes"), series("dbytes")
        spkts, dpkts = series("Spkts"), series("Dpkts")
        dur = series("dur")
        tcprtt, synack, ackdat = series("tcprtt"), series("synack"), series("ackdat")

        def add(name, values):
            if name not in df.columns and name in EXPECTED_FEATURES:
                df[name] = values

        if sbytes is not None and dbytes is not None:
            add("payload_ratio", dbytes / (sbytes + 1))
            add("total_bytes", sbytes + dbytes)
            add("avg_sbytes", sbytes / ((spkts if spkts is not None else 0) + 1))
            add("avg_spkt_size", sbytes / ((spkts if spkts is not None else 0) + 1))
            add("bytes_ratio", sbytes / (dbytes + 1))
            add("byte_difference", sbytes - dbytes)
            if dur is not None:
                add("total_byte_rate", (sbytes + dbytes) / (dur + 0.001))
                add("client_byte_rate", sbytes / (dur + 0.001))
                add("server_byte_rate", dbytes / (dur + 0.001))
        if spkts is not None and dpkts is not None:
            add("total_pkts", spkts + dpkts)
            add("packet_ratio", spkts / (dpkts + 1))
            add("packet_difference", spkts - dpkts)
            add("pkts_per_byte", (spkts + dpkts) / ((sbytes + dbytes + 1) if sbytes is not None and dbytes is not None else 1))
            if dur is not None:
                add("client_pkt_rate", spkts / (dur + 0.001))
                add("server_pkt_rate", dpkts / (dur + 0.001))
                add("total_pkt_rate", (spkts + dpkts) / (dur + 0.001))
        if sbytes is not None and spkts is not None:
            add("avg_sbytes", sbytes / (spkts + 1))
            add("avg_spkt_size", sbytes / (spkts + 1))
        if dbytes is not None and dpkts is not None:
            add("avg_dbytes", dbytes / (dpkts + 1))
            add("avg_dpkt_size", dbytes / (dpkts + 1))
        if tcprtt is not None and dur is not None:
            add("tcp_retrans_ratio", tcprtt / (dur + 0.001))
        if synack is not None and ackdat is not None:
            add("syn_ack_ratio", synack / (ackdat + 0.001))
            add("tcp_setup_time", synack + ackdat)

        ct_srv_src, ct_src_ltm = series("ct_srv_src"), series("ct_src_ ltm")
        ct_dst_sport_ltm, ct_dst_ltm = series("ct_dst_sport_ltm"), series("ct_dst_ltm")
        if ct_srv_src is not None and ct_src_ltm is not None:
            add("dst_host_srv_ratio", ct_srv_src / (ct_src_ltm + 1))
        elif ct_dst_sport_ltm is not None and ct_dst_ltm is not None:
            add("dst_host_srv_ratio", ct_dst_sport_ltm / (ct_dst_ltm + 1))

        # Ensure the exact, ordered feature contract required by the trained model.
        for name in EXPECTED_FEATURES:
            if name not in df.columns:
                df[name] = np.nan

        result = df.loc[:, EXPECTED_FEATURES].copy()
        result.replace([np.inf, -np.inf], np.nan, inplace=True)
        self.feature_names_out_ = np.asarray(EXPECTED_FEATURES, dtype=object)
        return result

    def get_feature_names_out(self, input_features=None):
        return np.asarray(EXPECTED_FEATURES, dtype=object)
