"""
FlowGuard Mininet Traffic Capture Runner
Captures packets from a specific Mininet interface (default 's1-eth1', client switch port)
using tcpdump and records an experiment manifest.

Usage (Linux VM):
    sudo python3 mininet/capture.py start --run-id run_001 --scenario benign_http
    # ... run traffic scenario ...
    sudo python3 mininet/capture.py stop --run-id run_001
"""

import sys
import os
import subprocess
import signal
import time
import json
import argparse
from pathlib import Path
from typing import Optional, Dict, Any

EXPERIMENTS_DIR = Path("experiments")


class CaptureRunner:
    """Manages tcpdump packet capture lifecycle for an experiment run."""

    def __init__(self, run_id: str, scenario_id: str = "default", interface: str = "s1-eth1"):
        self.run_id = run_id
        self.scenario_id = scenario_id
        self.interface = interface
        self.run_dir = EXPERIMENTS_DIR / run_id
        self.pcap_path = self.run_dir / "traffic.pcap"
        self.pid_file = self.run_dir / "tcpdump.pid"
        self.manifest_path = self.run_dir / "capture_manifest.json"

    def start(self) -> Dict[str, Any]:
        """Starts tcpdump in the background."""
        self.run_dir.mkdir(parents=True, exist_ok=True)

        if self.pid_file.exists():
            raise RuntimeError(f"Capture already running for run_id {self.run_id}")

        cmd = [
            "tcpdump",
            "-i", self.interface,
            "-n",
            "-s", "0",
            "-w", str(self.pcap_path.resolve()),
        ]

        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with open(self.pid_file, "w") as f:
                f.write(str(proc.pid))

            manifest = {
                "run_id": self.run_id,
                "scenario_id": self.scenario_id,
                "interface": self.interface,
                "status": "capturing",
                "start_time": time.time(),
                "end_time": None,
                "pcap_file": str(self.pcap_path),
                "pid": proc.pid,
            }
            with open(self.manifest_path, "w") as f:
                json.dump(manifest, f, indent=2)

            print(f"[CAPTURE START] Interface {self.interface} -> {self.pcap_path} (PID {proc.pid})")
            return manifest
        except Exception as e:
            print(f"[CAPTURE ERROR] Failed to start tcpdump: {e}")
            raise

    def stop(self) -> Dict[str, Any]:
        """Stops the active tcpdump capture process and updates manifest."""
        if not self.pid_file.exists():
            raise RuntimeError(f"No active capture PID file found for {self.run_id}")

        with open(self.pid_file, "r") as f:
            pid = int(f.read().strip())

        try:
            os.kill(pid, signal.SIGINT)
            time.sleep(0.5)
            # Ensure process terminated
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        except ProcessLookupError:
            pass

        self.pid_file.unlink(missing_ok=True)

        manifest: Dict[str, Any] = {}
        if self.manifest_path.exists():
            with open(self.manifest_path, "r") as f:
                manifest = json.load(f)

        pcap_size = self.pcap_path.stat().st_size if self.pcap_path.exists() else 0
        manifest["status"] = "completed"
        manifest["end_time"] = time.time()
        manifest["duration_sec"] = round(manifest["end_time"] - manifest.get("start_time", manifest["end_time"]), 2)
        manifest["pcap_bytes"] = pcap_size

        with open(self.manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        print(f"[CAPTURE STOP] Run {self.run_id} completed. PCAP size: {pcap_size} bytes.")
        return manifest


def main():
    parser = argparse.ArgumentParser(description="FlowGuard Traffic Capture Runner")
    parser.add_argument("action", choices=["start", "stop"], help="Start or stop packet capture")
    parser.add_argument("--run-id", required=True, help="Unique experiment run ID")
    parser.add_argument("--scenario", default="default", help="Scenario identifier (e.g. benign_http, port_scan)")
    parser.add_argument("--interface", default="s1-eth1", help="Network interface to monitor (default: s1-eth1)")

    args = parser.parse_args()
    runner = CaptureRunner(run_id=args.run_id, scenario_id=args.scenario, interface=args.interface)

    if args.action == "start":
        runner.start()
    elif args.action == "stop":
        runner.stop()


if __name__ == "__main__":
    main()
