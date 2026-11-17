#!/usr/bin/env python3
"""
FlowGuard Phase 5: live detector with automatic mitigation

Watches traffic arriving at the load balancer (tcpdump), builds the same
1-second per-source window features used for training, scores each window with
the lab-native model (model_lab.joblib), and when a source is classified as
ATTACK it installs an OpenFlow drop rule for that source on switch s1. Dropping
at the switch stops the flood before it reaches the load balancer's link.

Used by run_scenario.py and lab_session.py (class Detector); not meant to be run
on its own.

Modes (can be changed while running):
    off      do not score anything
    monitor  score windows and report attacks, but do not block
    protect  score windows and block attacking sources at the switch (default)
"""
import os
import subprocess
import threading
import time
from collections import defaultdict

import joblib
import numpy as np

from feature_extractor import parse_line, window_features

HERE = os.path.dirname(os.path.abspath(__file__))
LB_IP = "10.0.0.10"
NEVER_BLOCK = {LB_IP, "10.0.0.11", "10.0.0.12", "10.0.0.13"}


class Detector(threading.Thread):
    def __init__(self, lb, model_path=None, switch="s1", threshold=0.5, consecutive=1,
                 mode="protect", on_window=None, on_block=None):
        super().__init__(daemon=True)
        bundle = joblib.load(model_path or os.path.join(HERE, "model_lab.joblib"))
        self.model = bundle["model"]
        self.features = bundle["features"]
        self.model_name = bundle.get("name", "model")
        self.lb = lb
        self.switch = switch
        self.threshold = threshold
        self.consecutive = consecutive
        self.mode = mode              # "off" | "monitor" | "protect"
        self.on_window = on_window    # called with a dict for every scored window
        self.on_block = on_block      # called with (src, score, pkts) when a source is blocked
        self.bucket = None
        self.records = []
        self.strikes = defaultdict(int)
        self.blocked = {}   # source ip -> time it was blocked
        self.events = []    # every window classified as attack
        self.proc = None

    # ---- scoring -------------------------------------------------------
    def score(self, row):
        x = np.array([[row[f] for f in self.features]], dtype=float)
        if hasattr(self.model, "predict_proba"):
            return float(self.model.predict_proba(x)[0][1])
        return float(self.model.predict(x)[0])

    def flush(self):
        for row in window_features(self.records):
            src = row["src"]
            if src in NEVER_BLOCK or src in self.blocked or self.mode == "off":
                continue
            p = self.score(row)
            action = "none"
            if p >= self.threshold:
                self.strikes[src] += 1
                self.events.append({"time": time.time(), "src": src, "pkts": row["pkts"], "score": p})
                if self.strikes[src] >= self.consecutive:
                    if self.mode == "protect":
                        self.block(src, p, row["pkts"])
                        action = "blocked"
                    else:
                        action = "flagged"
            else:
                self.strikes[src] = 0
            if self.on_window:
                self.on_window({"src": src, "pkts": row["pkts"], "bytes": row["bytes"],
                                "mean_len": row["mean_len"], "syn_ratio": row["syn_ratio"],
                                "score": round(p, 3), "verdict": "attack" if p >= self.threshold else "normal",
                                "action": action})
        self.records = []

    def handle_line(self, line):
        r = parse_line(line)
        if r is None:
            return
        b = int(r["ts"])
        if self.bucket is None:
            self.bucket = b
        if b != self.bucket:  # a new second started: score the finished one
            self.flush()
            self.bucket = b
        self.records.append(r)

    # ---- mitigation ----------------------------------------------------
    def block(self, src, score, pkts):
        subprocess.run(["ovs-ofctl", "add-flow", self.switch,
                        f"priority=100,ip,nw_src={src},actions=drop"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.blocked[src] = time.time()
        if self.on_block:
            self.on_block(src, score, pkts)
        else:
            print(f"[detector] BLOCKED {src} (score {score:.2f}, {pkts} pkts/s)")

    def release(self):
        """Remove all drop rules and forget past verdicts (used between demo attacks)."""
        self.unblock_all()
        self.blocked = {}
        self.strikes.clear()

    def unblock_all(self):
        for src in self.blocked:
            subprocess.run(["ovs-ofctl", "--strict", "del-flows", self.switch,
                            f"priority=100,ip,nw_src={src}"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # ---- thread --------------------------------------------------------
    def run(self):
        iface = self.lb.defaultIntf().name
        self.proc = self.lb.popen(
            ["tcpdump", "-i", iface, "-nn", "-tt", "-l", f"dst host {LB_IP}"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            universal_newlines=True, bufsize=1)
        for line in self.proc.stdout:
            self.handle_line(line)

    def stop(self):
        if self.proc:
            self.proc.terminate()
        self.unblock_all()
