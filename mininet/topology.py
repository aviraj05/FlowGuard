"""
FlowGuard Mininet Lab Topology
Configurable L2 topology connecting client and backends on a unified subnet (10.0.0.0/24).
Requires a Linux host with Mininet, Open vSwitch, and Python 3 installed.
(On Windows/macOS, use the documented VM or the backend's Offline Flow Replay Engine).

Topology Architecture:
                [Client Host (h1)] - 10.0.0.100
                        | (100 Mbps, 2ms)
                 [Core Switch (s1)]
              /          |          \
   (100M, 1ms)      (100M, 1ms)     (50M, 5ms)
   [Backend 1 (h2)] [Backend 2 (h3)] [Backend 3 (h4)]
     10.0.0.1:80      10.0.0.2:80      10.0.0.3:80
"""

import sys
import os
import signal
import time
from typing import Dict, Any, List, Optional

# Default configuration for repeatable lab environments
DEFAULT_LAB_CONFIG = {
    "subnet": "10.0.0.0/24",
    "client": {
        "name": "h1",
        "ip": "10.0.0.100/24",
        "bw": 100,
        "delay": "2ms",
    },
    "backends": [
        {"name": "h2", "ip": "10.0.0.1/24", "port": 80, "bw": 100, "delay": "1ms"},
        {"name": "h3", "ip": "10.0.0.2/24", "port": 80, "bw": 100, "delay": "1ms"},
        {"name": "h4", "ip": "10.0.0.3/24", "port": 80, "bw": 50, "delay": "5ms"},
    ],
    "switch": "s1",
    "controller": "c0",
}

# Check Mininet availability without immediately exiting if imported by test runners
MININET_AVAILABLE = False
try:
    from mininet.net import Mininet
    from mininet.node import Controller, OVSKernelSwitch
    from mininet.cli import CLI
    from mininet.log import setLogLevel, info
    from mininet.link import TCLink
    MININET_AVAILABLE = True
except ImportError:
    pass


class FlowGuardNetwork:
    """Manages the lifecycle of the FlowGuard Mininet network."""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or DEFAULT_LAB_CONFIG
        self.net: Optional[Any] = None
        self.server_pids: Dict[str, List[int]] = {}

    def start(self) -> Any:
        """Initialize and start the Mininet network and backend services."""
        if not MININET_AVAILABLE:
            raise RuntimeError(
                "Mininet is not installed or current OS does not support Linux network namespaces.\n"
                "To run this topology, execute inside a Linux VM or container with Mininet installed.\n"
                "On Windows, use the offline replay mode or run against a remote VM."
            )

        info("*** Creating Mininet network\n")
        self.net = Mininet(controller=Controller, switch=OVSKernelSwitch, link=TCLink)

        info("*** Adding Controller\n")
        self.net.addController(self.config["controller"])

        info("*** Adding Switch\n")
        s1 = self.net.addSwitch(self.config["switch"])

        info("*** Adding Client Host\n")
        client_cfg = self.config["client"]
        client = self.net.addHost(client_cfg["name"], ip=client_cfg["ip"])
        self.net.addLink(client, s1, bw=client_cfg["bw"], delay=client_cfg["delay"])

        info("*** Adding Backend Hosts\n")
        for b_cfg in self.config["backends"]:
            b_host = self.net.addHost(b_cfg["name"], ip=b_cfg["ip"])
            self.net.addLink(b_host, s1, bw=b_cfg["bw"], delay=b_cfg["delay"])

        info("*** Starting Network\n")
        self.net.start()

        info("*** Starting managed HTTP servers on backends\n")
        for b_cfg in self.config["backends"]:
            b_host = self.net.get(b_cfg["name"])
            port = b_cfg["port"]
            # Start python3 http.server and record the PID for clean teardown
            pid_cmd = f"python3 -m http.server {port} > /dev/null 2>&1 & echo $!"
            pid_str = b_host.cmd(pid_cmd).strip()
            try:
                pid = int(pid_str)
                self.server_pids.setdefault(b_cfg["name"], []).append(pid)
                info(f"    Started http.server on {b_cfg['name']} (port {port}, PID {pid})\n")
            except ValueError:
                info(f"    Started http.server on {b_cfg['name']} (port {port}, PID unknown: '{pid_str}')\n")

        # Allow servers brief moment to bind
        time.sleep(1.0)
        info("*** FlowGuard Lab network is ready.\n")
        return self.net

    def stop(self):
        """Stop all background servers and the Mininet network."""
        if not self.net:
            return

        info("*** Stopping backend servers cleanly\n")
        for host_name, pids in self.server_pids.items():
            try:
                host = self.net.get(host_name)
                for pid in pids:
                    host.cmd(f"kill -9 {pid} 2>/dev/null")
                # Also kill any residual python3 http.server on the host
                host.cmd("pkill -9 -f 'python3 -m http.server' 2>/dev/null")
            except Exception as e:
                info(f"    Warning cleaning up {host_name}: {e}\n")
        self.server_pids.clear()

        info("*** Stopping Mininet network\n")
        try:
            self.net.stop()
        except Exception as e:
            info(f"    Warning stopping Mininet: {e}\n")
        self.net = None
        info("*** Teardown complete.\n")

    def test_connectivity(self) -> Dict[str, Any]:
        """Perform pingall and HTTP checks, returning a summary dict."""
        if not self.net:
            raise RuntimeError("Network is not running")

        info("*** Testing connectivity: pingall\n")
        loss = self.net.pingAll()
        ping_ok = (loss == 0.0)

        info("*** Testing HTTP services from client\n")
        client = self.net.get(self.config["client"]["name"])
        http_results = {}
        for b_cfg in self.config["backends"]:
            target_ip = b_cfg["ip"].split("/")[0]
            port = b_cfg["port"]
            curl_res = client.cmd(f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 3 http://{target_ip}:{port}/")
            status_code = curl_res.strip()
            http_results[b_cfg["name"]] = {
                "target": f"{target_ip}:{port}",
                "status_code": status_code,
                "success": (status_code == "200"),
            }

        all_http_ok = all(r["success"] for r in http_results.values())
        return {
            "ping_loss_percent": loss,
            "ping_success": ping_ok,
            "http_results": http_results,
            "all_success": ping_ok and all_http_ok,
        }


def create_flowguard_topology(open_cli: bool = True):
    """Entry point for manual CLI execution."""
    if not MININET_AVAILABLE:
        print("[ERROR] Mininet is not installed or current OS does not support Linux network namespaces.")
        print("        FlowGuard provides an Offline Replay Engine on Windows via the backend API.")
        print("        To run this topology, execute inside a Linux VM or WSL2 with Mininet installed.")
        sys.exit(1)

    setLogLevel("info")
    lab = FlowGuardNetwork()
    try:
        net = lab.start()
        if open_cli:
            info("*** Opening Mininet CLI (type 'exit' or Ctrl-D to quit)...\n")
            CLI(net)
    finally:
        lab.stop()


if __name__ == "__main__":
    create_flowguard_topology(open_cli=True)
