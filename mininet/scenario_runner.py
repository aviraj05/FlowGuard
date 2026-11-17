"""
FlowGuard Repeatable Lab Scenario Runner & Independent Ground Truth Manager
Executes bounded, safe traffic generation inside Mininet client namespaces,
generates a versioned run manifest, records independent ground-truth labels,
and optionally pushes processed flow records with provenance to the FlowGuard API.
"""

import sys
import os
import time
import json
import uuid
import argparse
from pathlib import Path
from typing import Dict, Any, List, Optional

# Pre-defined lab scenario specifications
SCENARIOS: Dict[str, Dict[str, Any]] = {
    "benign_http": {
        "description": "Benign HTTP GET requests to backend web servers (10.0.0.1-3:80)",
        "ground_truth_label": 0,  # 0 = NORMAL
        "ground_truth_name": "NORMAL",
        "requests_count": 20,
        "delay_sec": 0.2,
        "target_servers": ["10.0.0.1:80", "10.0.0.2:80", "10.0.0.3:80"],
    },
    "benign_repeated": {
        "description": "Repeated paced requests simulating intermittent web browsing",
        "ground_truth_label": 0,
        "ground_truth_name": "NORMAL",
        "requests_count": 10,
        "delay_sec": 0.5,
        "target_servers": ["10.0.0.1:80", "10.0.0.2:80"],
    },
    "port_scan": {
        "description": "Low-rate TCP SYN port reconnaissance sweep across ports 21-8080",
        "ground_truth_label": 1,  # 1 = ATTACK
        "ground_truth_name": "ATTACK",
        "target_ip": "10.0.0.1",
        "target_ports": [21, 22, 23, 25, 80, 110, 443, 8080],
        "delay_sec": 0.1,
    },
    "server_failure": {
        "description": "HTTP connection attempt to an inactive port generating TCP RSTs",
        "ground_truth_label": 0,  # Server unavailability is operational error, not intrusion
        "ground_truth_name": "NORMAL",
        "target_ip": "10.0.0.1",
        "target_port": 9999,
        "requests_count": 5,
    },
}

EXPERIMENTS_DIR = Path("experiments")


def generate_run_id(scenario_name: str) -> str:
    """Creates a timestamped, traceable run identifier."""
    ts = time.strftime("%Y%m%d_%H%M%S")
    short_uuid = str(uuid.uuid4())[:6]
    return f"run_{scenario_name}_{ts}_{short_uuid}"


def create_run_manifest(run_id: str, scenario_name: str, config_override: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Builds an immutable experiment manifest recording independent ground truth."""
    spec = SCENARIOS.get(scenario_name, {
        "description": "Custom or unknown scenario",
        "ground_truth_label": -1,  # -1 = UNKNOWN/UNLABELED
        "ground_truth_name": "UNKNOWN",
    })

    manifest = {
        "run_id": run_id,
        "scenario_id": scenario_name,
        "description": spec["description"],
        "ground_truth_label": spec.get("ground_truth_label", -1),
        "ground_truth_name": spec.get("ground_truth_name", "UNKNOWN"),
        "created_at": time.time(),
        "created_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "initialized",
        "spec": spec,
        "config_override": config_override or {},
        "flow_label_rules": {
            "default_label": spec.get("ground_truth_label", -1),
            "rationale": "Independent ground-truth established prior to execution; never derived from ML prediction."
        }
    }

    run_dir = EXPERIMENTS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = run_dir / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    return manifest


def update_run_manifest(run_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    """Updates manifest on run completion."""
    manifest_path = EXPERIMENTS_DIR / run_id / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found for {run_id}")

    with open(manifest_path, "r") as f:
        manifest = json.load(f)

    manifest.update(updates)
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    return manifest


def execute_scenario_on_host(client_host: Any, scenario_name: str) -> bool:
    """Executes traffic scenario commands within Mininet client host namespace."""
    spec = SCENARIOS.get(scenario_name)
    if not spec:
        raise ValueError(f"Unknown scenario: {scenario_name}")

    print(f"[SCENARIO RUN] Executing {scenario_name}: {spec['description']}")

    if scenario_name in ["benign_http", "benign_repeated"]:
        targets = spec["target_servers"]
        count = spec["requests_count"]
        delay = spec["delay_sec"]
        for i in range(count):
            for target in targets:
                client_host.cmd(f"curl -s -o /dev/null --max-time 2 http://{target}/")
                time.sleep(delay)
    elif scenario_name == "port_scan":
        target_ip = spec["target_ip"]
        ports = spec["target_ports"]
        delay = spec["delay_sec"]
        for p in ports:
            # Send TCP probe
            client_host.cmd(f"timeout 0.2 bash -c 'cat < /dev/null > /dev/tcp/{target_ip}/{p}' 2>/dev/null")
            time.sleep(delay)
    elif scenario_name == "server_failure":
        target = f"{spec['target_ip']}:{spec['target_port']}"
        for _ in range(spec["requests_count"]):
            client_host.cmd(f"curl -s -o /dev/null --max-time 1 http://{target}/")
            time.sleep(0.1)

    print(f"[SCENARIO RUN] Scenario {scenario_name} finished successfully.")
    return True


def list_available_scenarios() -> List[Dict[str, Any]]:
    """Returns catalog of all registered lab scenarios."""
    return [
        {
            "scenario_id": name,
            "description": spec["description"],
            "ground_truth_label": spec.get("ground_truth_label", -1),
            "ground_truth_name": spec.get("ground_truth_name", "UNKNOWN"),
        }
        for name, spec in SCENARIOS.items()
    ]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FlowGuard Scenario Runner")
    parser.add_argument("--list", action="store_true", help="List available scenarios")
    parser.add_argument("--create-run", help="Initialize a new run with given scenario ID")
    args = parser.parse_args()

    if args.list:
        print(json.dumps(list_available_scenarios(), indent=2))
    elif args.create_run:
        run_id = generate_run_id(args.create_run)
        manifest = create_run_manifest(run_id, args.create_run)
        print(f"Created experiment run: {run_id}")
        print(json.dumps(manifest, indent=2))
