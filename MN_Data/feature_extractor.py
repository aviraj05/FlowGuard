#!/usr/bin/env python3
"""
FlowGuard Phase 3: window-based feature extraction

Reads tcpdump text output (tcpdump -nn -tt) and turns it into one feature row
per (1-second window, source IP). No external libraries needed.
"""
import re
from collections import defaultdict

WINDOW_S = 1.0

FEATURES = [
    "pkts",          # packets in the window
    "bytes",         # payload bytes in the window
    "mean_len",      # mean payload length per packet
    "syn_ratio",     # share of packets that are TCP SYN
    "n_dst_ports",   # distinct destination ports contacted
    "n_src_ports",   # distinct source ports used
    "tcp_share",     # share of TCP packets
    "udp_share",     # share of UDP packets
    "icmp_share",    # share of ICMP packets
]

HEADER = re.compile(r"^(\d+\.\d+) IP (\S+) > (\S+): (.*)$")
FLAGS = re.compile(r"Flags \[([A-Za-z.]+)\]")
LENGTH = re.compile(r"length (\d+)")


def split_addr(tok):
    """'10.0.0.2.34567' -> ('10.0.0.2', 34567); '10.0.0.2' -> ('10.0.0.2', None)"""
    parts = tok.split(".")
    if len(parts) == 5:
        return ".".join(parts[:4]), int(parts[4])
    return tok, None


def parse_line(line):
    m = HEADER.match(line.strip())
    if not m:
        return None
    ts, src, dst, rest = m.groups()
    sip, sport = split_addr(src)
    dip, dport = split_addr(dst)
    ln = LENGTH.search(rest)
    length = int(ln.group(1)) if ln else 0
    fl = FLAGS.search(rest)
    if fl:
        proto, syn = "tcp", ("S" in fl.group(1) and "." not in fl.group(1))
    elif rest.startswith("UDP"):
        proto, syn = "udp", False
    elif "ICMP" in rest:
        proto, syn = "icmp", False
    else:
        return None
    return {"ts": float(ts), "src": sip, "sport": sport, "dst": dip,
            "dport": dport, "len": length, "proto": proto, "syn": syn}


def parse_file(path):
    recs = []
    with open(path, errors="ignore") as f:
        for line in f:
            r = parse_line(line)
            if r:
                recs.append(r)
    return recs


def window_features(records, window_s=WINDOW_S):
    """Return a list of dicts: window, src, plus every name in FEATURES."""
    if not records:
        return []
    t0 = min(r["ts"] for r in records)
    buckets = defaultdict(list)
    for r in records:
        buckets[(int((r["ts"] - t0) // window_s), r["src"])].append(r)
    rows = []
    for (win, src), rs in sorted(buckets.items()):
        n = len(rs)
        total = sum(r["len"] for r in rs)
        rows.append({
            "window": win,
            "src": src,
            "pkts": n,
            "bytes": total,
            "mean_len": round(total / n, 2),
            "syn_ratio": round(sum(r["syn"] for r in rs) / n, 4),
            "n_dst_ports": len({r["dport"] for r in rs if r["dport"] is not None}),
            "n_src_ports": len({r["sport"] for r in rs if r["sport"] is not None}),
            "tcp_share": round(sum(r["proto"] == "tcp" for r in rs) / n, 4),
            "udp_share": round(sum(r["proto"] == "udp" for r in rs) / n, 4),
            "icmp_share": round(sum(r["proto"] == "icmp" for r in rs) / n, 4),
        })
    return rows
