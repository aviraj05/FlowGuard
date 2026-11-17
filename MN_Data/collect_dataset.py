#!/usr/bin/env python3
"""
FlowGuard Phase 3: build the labelled lab dataset

For every segment, the client (10.0.0.1) and the attacker (10.0.0.2) generate
traffic towards the HAProxy load balancer at the same time while tcpdump records
what the load balancer receives. Each source is labelled by what it was doing:
benign (HTTP, ping) or attack (SYN / UDP / ICMP flood, port scan). The
attacker host also sometimes sends benign traffic, so the model cannot just
learn "this IP = attack".

Needs topo.py, lb_test.py, haproxy.cfg and feature_extractor.py in the same folder.

Quick test (about 2 minutes):  sudo python3 collect_dataset.py --reps 1 --seg 8
Full run   (about 15 minutes): sudo python3 collect_dataset.py
Output: dataset_lab.csv (or the name given with --out)
Re-collect only port scans:  sudo python3 collect_dataset.py --only scan --reps 10 --out dataset_scan.csv
"""
import argparse
import csv
import os
import subprocess
import time
from collections import Counter

from mininet.log import setLogLevel

from feature_extractor import FEATURES, parse_file, window_features
from lb_test import start_haproxy, stop_haproxy
from topo import build, start_servers

HERE = os.path.dirname(os.path.abspath(__file__))
LB_IP = "10.0.0.10"
CLIENT_IP, ATTACKER_IP = "10.0.0.1", "10.0.0.2"
DEVNULL = subprocess.DEVNULL

HTTP_LIGHT = ("while true; do curl -s -o /dev/null --max-time 3 http://%s/; "
              "sleep 0.$((RANDOM%%4+1)); done" % LB_IP)
HTTP_HEAVY = ("while true; do seq 1 20 | xargs -P 10 -n1 sh -c "
              "'curl -s -o /dev/null --max-time 3 http://%s/' _; "
              "sleep 0.$((RANDOM%%3+1)); done" % LB_IP)
SCAN = ("while true; do nmap -n -Pn -sS -p 1-1000 -T4 --max-retries 0 %s "
        ">/dev/null 2>&1; sleep 1; done" % LB_IP)

BENIGN = {"http_light", "http_heavy", "ping"}


def command(profile, seg, rate):
    t = str(seg)
    if profile == "http_light":
        return ["timeout", t, "bash", "-c", HTTP_LIGHT]
    if profile == "http_heavy":
        return ["timeout", t, "bash", "-c", HTTP_HEAVY]
    if profile == "ping":
        return ["timeout", t, "ping", "-i", "0.2", LB_IP]
    if profile == "syn":
        return ["timeout", t, "hping3", "-S", "-p", "80", "-i", rate, LB_IP]
    if profile == "udp":
        return ["timeout", t, "hping3", "--udp", "-p", "80", "-d", "120", "-i", rate, LB_IP]
    if profile == "icmp":
        return ["timeout", t, "hping3", "--icmp", "-i", rate, LB_IP]
    if profile == "scan":
        return ["timeout", t, "bash", "-c", SCAN]
    raise ValueError(profile)


def build_plan(reps):
    rates = ["u2000", "u1000", "u500"]  # 500, 1000, 2000 packets/s
    plan = []
    for r in range(reps):
        rate = rates[r % 3]
        plan += [
            ("benign_a", "http_light", "http_heavy", rate),
            ("benign_b", "http_heavy", "ping", rate),
            ("syn", "http_light", "syn", rate),
            ("udp", "http_heavy", "udp", rate),
            ("icmp", "http_light", "icmp", rate),
            ("scan", "http_light", "scan", rate),
        ]
    return plan


def kill_leftovers():
    for name in ("hping3", "curl", "nmap", "ping", "xargs"):
        subprocess.run(["pkill", "-x", name], stdout=DEVNULL, stderr=DEVNULL)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=6, help="repetitions of the 6-segment plan")
    ap.add_argument("--seg", type=int, default=20, help="seconds per segment")
    ap.add_argument("--only", default="", help="comma-separated segment names to run, e.g. scan")
    ap.add_argument("--out", default="dataset_lab.csv", help="output CSV file name")
    args = ap.parse_args()

    setLogLevel("warning")
    plan = build_plan(args.reps)
    if args.only:
        wanted = set(args.only.split(","))
        plan = [p for p in plan if p[0] in wanted]
    net = build()
    net.start()
    procs = start_servers(net)
    lb, client, attacker = net.get("lb"), net.get("client"), net.get("attacker")
    iface = lb.defaultIntf().name
    rows = []
    try:
        start_haproxy(lb, "roundrobin")
        for i, (name, cprof, aprof, rate) in enumerate(plan, start=1):
            cap = f"/tmp/seg_{i}.txt"
            tcpd = lb.popen(
                ["sh", "-c", f"exec tcpdump -i {iface} -nn -tt -l 'dst host {LB_IP}' > {cap} 2>/dev/null"],
                stdout=DEVNULL, stderr=DEVNULL)
            time.sleep(1.5)
            jobs = [client.popen(command(cprof, args.seg, rate), stdout=DEVNULL, stderr=DEVNULL),
                    attacker.popen(command(aprof, args.seg, rate), stdout=DEVNULL, stderr=DEVNULL)]
            for j in jobs:
                j.wait()
            time.sleep(1)
            tcpd.terminate()
            tcpd.wait()
            kill_leftovers()

            labels = {CLIENT_IP: (cprof, 0 if cprof in BENIGN else 1),
                      ATTACKER_IP: (aprof, 0 if aprof in BENIGN else 1)}
            n_before = len(rows)
            for w in window_features(parse_file(cap)):
                if w["src"] not in labels:
                    continue  # ignore anything that is not client/attacker
                prof, lab = labels[w["src"]]
                w.update(segment=i, profile=prof, label=lab,
                         attack_type="benign" if lab == 0 else prof)
                rows.append(w)
            print(f"[{i}/{len(plan)}] {name:8s} client={cprof:10s} attacker={aprof:10s} "
                  f"-> {len(rows) - n_before} rows")
    finally:
        kill_leftovers()
        stop_haproxy(lb)
        for p in procs:
            p.terminate()
        net.stop()

    cols = ["segment", "window", "src", "profile", "attack_type", "label"] + FEATURES
    path = os.path.join(HERE, args.out)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

    print("\n=== DATASET SUMMARY ===")
    print("total rows:", len(rows))
    print("by label  :", dict(Counter(r["label"] for r in rows)))
    print("by profile:", dict(Counter(r["attack_type"] if r["label"] else r["profile"] for r in rows)))
    print("saved:", path)


if __name__ == "__main__":
    main()
