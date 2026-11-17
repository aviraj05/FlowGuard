#!/usr/bin/env python3
"""
FlowGuard Phase 5: attack experiment (T23 and T24)

Three scenarios, each on a fresh Mininet network behind the HAProxy load balancer:
    baseline  legitimate load only
    attack    legitimate load + flood from the attacker, no defence
    defended  same flood, with the ML detector blocking the attacker at switch s1

Legitimate load = 3 parallel clients, each sending sequential HTTP requests.
A request counts as successful only if it returns HTTP 200 within 2 seconds.

Needs: topo.py, lb_test.py, haproxy.cfg, feature_extractor.py, detector.py,
       model_lab.joblib in the same folder (run train_lab_model.py first).

Usage:  sudo python3 run_scenario.py                       (all 3 scenarios, ~3 min)
        sudo python3 run_scenario.py --attack syn --algo roundrobin
Output: results_scenarios_<bw>M.csv, results_timeline_<bw>M.csv
        --lb-bw sets the load balancer uplink in Mbit/s (default 10; use 100 for the unconstrained control)
"""
import argparse
import csv
import os
import statistics
import subprocess
import time

from mininet.log import setLogLevel

from detector import Detector
from lb_test import start_haproxy, stop_haproxy
from topo import build, start_servers

HERE = os.path.dirname(os.path.abspath(__file__))
LB_IP = "10.0.0.10"
ATTACKER_IP = "10.0.0.2"
DEVNULL = subprocess.DEVNULL

LEGIT = (
    "while true; do s=$(date +%s.%N); "
    "out=$(curl -s -o /dev/null --max-time 2 -w '%{http_code} %{time_total}' http://LBIP/ 2>/dev/null); "
    "echo \"$s ${out:-000 2.0}\" >> LOGFILE; sleep 0.1; done"
).replace("LBIP", LB_IP)

ATTACKS = {  # about 10,000 packets/s towards the load balancer
    "udp": ["hping3", "--udp", "-p", "80", "-d", "1000", "-i", "u100", LB_IP],
    "syn": ["hping3", "-S", "-p", "80", "-i", "u100", LB_IP],
    "icmp": ["hping3", "--icmp", "-d", "1000", "-i", "u100", LB_IP],
}


def kill_leftovers():
    for name in ("hping3", "curl", "tcpdump"):
        subprocess.run(["pkill", "-x", name], stdout=DEVNULL, stderr=DEVNULL)


def read_log(paths):
    rows = []
    for p in paths:
        for line in open(p, errors="ignore"):
            parts = line.split()
            if len(parts) == 3:
                try:
                    rows.append((float(parts[0]), parts[1], float(parts[2]) * 1000))
                except ValueError:
                    pass
    return sorted(rows)


def stats(rows, lo, hi):
    sel = [r for r in rows if lo <= r[0] < hi]
    ok = [r[2] for r in sel if r[1] == "200"]
    if not sel:
        return {"n": 0, "success": None, "mean_ms": None, "p95_ms": None}
    return {
        "n": len(sel),
        "success": round(100.0 * len(ok) / len(sel), 1),
        "mean_ms": round(statistics.mean(ok), 1) if ok else None,
        "p95_ms": round(sorted(ok)[int(0.95 * (len(ok) - 1))], 1) if ok else None,
    }


def run_one(scenario, algo, attack, duration, attack_start, attack_len, lb_bw):
    print(f"\n--- scenario: {scenario} (algo={algo}, attack={attack}) ---")
    net = build()
    net.start()
    procs = start_servers(net)
    lb, client, attacker = net.get("lb"), net.get("client"), net.get("attacker")
    if lb_bw:  # limit the load balancer's uplink (both directions)
        for link in net.linksBetween(lb, net.get("s1")):
            link.intf1.config(bw=lb_bw)
            link.intf2.config(bw=lb_bw)
        print(f"[testbed] load balancer uplink limited to {lb_bw} Mbit/s")
    det = None
    try:
        start_haproxy(lb, algo)
        if scenario == "defended":
            det = Detector(lb)
            det.start()
            time.sleep(2)
        logs = []
        for k in range(3):
            log = f"/tmp/legit_{scenario}_{k}.txt"
            open(log, "w").close()
            logs.append(log)
        t0 = time.time()
        jobs = [client.popen(["timeout", str(duration), "bash", "-c", LEGIT.replace("LOGFILE", log)],
                             stdout=DEVNULL, stderr=DEVNULL) for log in logs]
        t_attack = t0 + attack_start
        t_end = t_attack + attack_len
        time.sleep(max(0, t_attack - time.time()))
        if scenario != "baseline":
            t_attack = time.time()
            atk = attacker.popen(["timeout", str(attack_len)] + ATTACKS[attack],
                                 stdout=DEVNULL, stderr=DEVNULL)
            atk.wait()
            t_end = time.time()
        for j in jobs:
            j.wait()
        time.sleep(1)
    finally:
        if det:
            det.stop()
        kill_leftovers()
        stop_haproxy(lb)
        for p in procs:
            p.terminate()
        net.stop()

    rows = read_log(logs)
    res = {"scenario": scenario, "lb_mbit": lb_bw, "algo": algo, "attack": attack if scenario != "baseline" else "-"}
    pre = stats(rows, t0 + 1, t_attack)
    during = stats(rows, t_attack, t_end)
    res.update(pre_success=pre["success"], atk_success=during["success"],
               atk_mean_ms=during["mean_ms"], atk_p95_ms=during["p95_ms"],
               atk_requests=during["n"])
    t_block = det.blocked.get(ATTACKER_IP) if det else None
    if t_block:
        after = stats(rows, t_block + 1, t_end)
        res.update(detect_delay_s=round(t_block - t_attack, 2),
                   after_success=after["success"], after_mean_ms=after["mean_ms"])
    else:
        res.update(detect_delay_s=None, after_success=None, after_mean_ms=None)
    res["false_blocks"] = len([s for s in det.blocked if s != ATTACKER_IP]) if det else 0

    timeline = []
    for sec in range(int(duration)):
        s = stats(rows, t0 + sec, t0 + sec + 1)
        timeline.append({"scenario": scenario, "sec": sec, "n": s["n"],
                         "success_pct": s["success"], "mean_ms": s["mean_ms"],
                         "attack_on": int(t_attack - t0 <= sec < t_end - t0 and scenario != "baseline"),
                         "blocked": int(bool(t_block) and sec >= t_block - t0)})
    return res, timeline


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="all", choices=["all", "baseline", "attack", "defended"])
    ap.add_argument("--algo", default="leastconn", choices=["roundrobin", "leastconn"])
    ap.add_argument("--attack", default="udp", choices=list(ATTACKS))
    ap.add_argument("--lb-bw", type=int, default=10, help="load balancer uplink in Mbit/s")
    ap.add_argument("--duration", type=int, default=45)
    ap.add_argument("--attack-start", type=int, default=10)
    ap.add_argument("--attack-len", type=int, default=25)
    a = ap.parse_args()
    setLogLevel("warning")

    names = ["baseline", "attack", "defended"] if a.scenario == "all" else [a.scenario]
    results, timeline = [], []
    for n in names:
        r, t = run_one(n, a.algo, a.attack, a.duration, a.attack_start, a.attack_len, a.lb_bw)
        results.append(r)
        timeline += t

    cols = ["scenario", "lb_mbit", "algo", "attack", "pre_success", "atk_success", "atk_mean_ms",
            "atk_p95_ms", "atk_requests", "detect_delay_s", "after_success",
            "after_mean_ms", "false_blocks"]
    print("\n=== RESULTS (legitimate clients; success = HTTP 200 within 2 s) ===")
    print("%-9s %-5s %8s %9s %8s %8s %6s %7s %8s %8s %6s" %
          ("scenario", "atk", "pre_ok%", "attack_ok%", "mean_ms", "p95_ms", "reqs",
           "delay_s", "after_ok%", "after_ms", "falseB"))
    for r in results:
        f = lambda v: "-" if v is None else v
        print("%-9s %-5s %8s %9s %8s %8s %6s %7s %8s %8s %6s" % (
            r["scenario"], r["attack"], f(r["pre_success"]), f(r["atk_success"]),
            f(r["atk_mean_ms"]), f(r["atk_p95_ms"]), r["atk_requests"],
            f(r["detect_delay_s"]), f(r["after_success"]), f(r["after_mean_ms"]),
            r["false_blocks"]))
    with open(os.path.join(HERE, f"results_scenarios_{a.lb_bw}M.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(results)
    with open(os.path.join(HERE, f"results_timeline_{a.lb_bw}M.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(timeline[0].keys()))
        w.writeheader()
        w.writerows(timeline)
    print(f"\nSaved: results_scenarios_{a.lb_bw}M.csv, results_timeline_{a.lb_bw}M.csv")


if __name__ == "__main__":
    main()
