#!/usr/bin/env python3
"""
FlowGuard lab topology (Phase 1)

    client   (10.0.0.1)  --\
    attacker (10.0.0.2)  ---\
    lb       (10.0.0.10) ----+-- s1 (learning switch, no controller)
    srv1     (10.0.0.11) ---/
    srv2     (10.0.0.12) --/
    srv3     (10.0.0.13) -/

Usage:
    sudo python3 topo.py --test   # run smoke test and exit
    sudo python3 topo.py          # start lab and drop into Mininet CLI
"""
import re
import subprocess
import sys
import time

from mininet.cli import CLI
from mininet.link import TCLink
from mininet.log import info, setLogLevel
from mininet.net import Mininet
from mininet.node import OVSBridge

HOSTS = [
    ("client", "10.0.0.1"),
    ("attacker", "10.0.0.2"),
    ("lb", "10.0.0.10"),
    ("srv1", "10.0.0.11"),
    ("srv2", "10.0.0.12"),
    ("srv3", "10.0.0.13"),
]
SERVERS = ["srv1", "srv2", "srv3"]


def build():
    net = Mininet(switch=OVSBridge, controller=None, link=TCLink, autoSetMacs=True)
    s1 = net.addSwitch("s1")
    for name, ip in HOSTS:
        h = net.addHost(name, ip=ip + "/24")
        net.addLink(h, s1, bw=100)  # 100 Mbit/s per link
    return net


def start_servers(net):
    """One tiny web server per backend; each page names its server."""
    procs = []
    for name in SERVERS:
        h = net.get(name)
        h.cmd(f"mkdir -p /tmp/{name} && echo 'served by {name}' > /tmp/{name}/index.html")
        p = h.popen(
            f"python3 -m http.server 80 --directory /tmp/{name}",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        procs.append(p)
    time.sleep(1)
    return procs


def smoke_test(net):
    ok = True

    info("\n*** [1/3] pingall\n")
    loss = net.pingAll()
    if loss != 0:
        ok = False
        info(f"FAIL: pingall packet loss {loss}%\n")

    info("\n*** [2/3] client -> each web server (HTTP)\n")
    client = net.get("client")
    for name in SERVERS:
        ip = net.get(name).IP()
        out = client.cmd(f"curl -s --max-time 3 http://{ip}/").strip()
        status = "OK  " if f"served by {name}" in out else "FAIL"
        if status == "FAIL":
            ok = False
        info(f"{status} {name} ({ip}) -> '{out}'\n")

    info("\n*** [3/3] iperf client -> srv1 (TCP, 3s)\n")
    srv1 = net.get("srv1")
    srv1.cmd("iperf -s -D")  # server in background
    time.sleep(1)
    out = client.cmd(f"timeout 15 iperf -c {srv1.IP()} -t 3 -f m")
    srv1.cmd("pkill -x iperf")
    rates = re.findall(r"([\d.]+)\s+Mbits/sec", out)
    if rates:
        info(f"iperf result: {rates[-1]} Mbits/sec\n")
    else:
        ok = False
        info(f"FAIL: iperf produced no result. Output: {out.strip()}\n")

    info("\n*** SMOKE TEST " + ("PASSED\n" if ok else "FAILED\n"))
    return ok


if __name__ == "__main__":
    setLogLevel("info")
    net = build()
    net.start()
    procs = start_servers(net)
    try:
        if "--test" in sys.argv:
            sys.exit(0 if smoke_test(net) else 1)
        CLI(net)
    finally:
        for p in procs:
            p.terminate()
        net.stop()
