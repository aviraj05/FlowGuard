#!/usr/bin/env python3
"""
FlowGuard Phase 2: HAProxy load-balancing experiment

Runs 4 scenarios and prints a results table:
    1. round robin,       equal back-ends
    2. least connections, equal back-ends
    3. round robin,       srv1 slowed down (+100 ms)
    4. least connections, srv1 slowed down (+100 ms)

Needs topo.py and haproxy.cfg in the same folder.

Usage:  sudo python3 lb_test.py
"""
import csv
import os
import re
import statistics
import time

from mininet.log import info, setLogLevel

from topo import SERVERS, build, start_servers

HERE = os.path.dirname(os.path.abspath(__file__))
LB_IP = "10.0.0.10"
REQUESTS = 300
CONCURRENCY = 20


def write_cfg(algo):
    """Copy haproxy.cfg, replacing the 'balance' line with the chosen algorithm."""
    text = open(os.path.join(HERE, "haproxy.cfg")).read()
    text = re.sub(r"balance\s+\w+", f"balance {algo}", text)
    path = f"/tmp/haproxy_{algo}.cfg"
    open(path, "w").write(text)
    return path


def start_haproxy(lb, algo):
    cfg = write_cfg(algo)
    check = lb.cmd(f"haproxy -c -f {cfg}")
    if "valid" not in check.lower():
        raise RuntimeError("haproxy config invalid:\n" + check)
    lb.cmd(f"haproxy -f {cfg} -D")
    time.sleep(2)  # let health checks mark the back-ends UP
    if not lb.cmd("pgrep -x haproxy").strip():
        raise RuntimeError("haproxy did not start")


def stop_haproxy(lb):
    lb.cmd("pkill -x haproxy")
    time.sleep(1)


def run_load(client):
    """Fire REQUESTS requests with CONCURRENCY parallel clients.
    Each output line looks like: 'served by srv2 0.012'"""
    cmd = (
        f"seq 1 {REQUESTS} | xargs -P {CONCURRENCY} -n1 sh -c "
        f"'curl -s --max-time 20 -w \"%{{time_total}}\" http://{LB_IP}/ "
        f"| tr \"\\n\" \" \"; echo' _"
    )
    t0 = time.time()
    out = client.cmd(cmd)
    elapsed = time.time() - t0
    return out, elapsed


def summarise(out, elapsed):
    hits = re.findall(r"served by (srv\d) ([\d.]+)", out)
    counts = {s: 0 for s in SERVERS}
    times = []
    for srv, t in hits:
        counts[srv] += 1
        times.append(float(t) * 1000)  # ms
    ok = len(hits)
    mean = statistics.mean(times) if times else 0
    p95 = sorted(times)[int(0.95 * (len(times) - 1))] if times else 0
    return {
        "srv1": counts["srv1"], "srv2": counts["srv2"], "srv3": counts["srv3"],
        "success_pct": round(100.0 * ok / REQUESTS, 1),
        "mean_ms": round(mean, 1),
        "p95_ms": round(p95, 1),
        "req_per_s": round(REQUESTS / elapsed, 1),
    }


def main():
    setLogLevel("warning")
    net = build()
    net.start()
    procs = start_servers(net)
    lb, client = net.get("lb"), net.get("client")
    results = []
    try:
        plan = [("roundrobin", "equal"), ("leastconn", "equal"),
                ("roundrobin", "srv1 slow"), ("leastconn", "srv1 slow")]
        slowed = False
        for algo, condition in plan:
            if condition == "srv1 slow" and not slowed:
                net.get("srv1").intf().config(bw=100, delay="100ms")
                slowed = True
            start_haproxy(lb, algo)
            out, elapsed = run_load(client)
            stop_haproxy(lb)
            r = summarise(out, elapsed)
            r.update(algorithm=algo, backends=condition)
            results.append(r)
            print(f"done: {algo:10s} / {condition:9s} -> "
                  f"{r['srv1']}/{r['srv2']}/{r['srv3']}")
    finally:
        stop_haproxy(lb)
        for p in procs:
            p.terminate()
        net.stop()

    cols = ["algorithm", "backends", "srv1", "srv2", "srv3",
            "success_pct", "mean_ms", "p95_ms", "req_per_s"]
    print("\n=== RESULTS (%d requests, %d concurrent) ===" % (REQUESTS, CONCURRENCY))
    print("%-11s %-10s %5s %5s %5s %8s %8s %8s %8s" %
          ("algorithm", "backends", "srv1", "srv2", "srv3",
           "succ%", "mean_ms", "p95_ms", "req/s"))
    for r in results:
        print("%-11s %-10s %5d %5d %5d %8.1f %8.1f %8.1f %8.1f" %
              tuple(r[c] for c in cols))
    path = os.path.join(HERE, "results_lb.csv")
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(results)
    print("\nSaved:", path)


if __name__ == "__main__":
    main()
