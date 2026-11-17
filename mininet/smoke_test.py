"""
FlowGuard Mininet Lab Smoke Test
Executes an automated end-to-end verification of the Mininet topology:
1. Starts the network and backend HTTP services
2. Runs pingall to verify L2/L3 reachability
3. Executes HTTP GET requests from client h1 to backends h2, h3, h4
4. Cleans up all processes and tears down the network cleanly
5. Exits with code 0 on success, 1 on failure.

Usage (Linux VM with Mininet):
    sudo python3 mininet/smoke_test.py
"""

import sys
import os
import json

# Ensure mininet directory is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from topology import FlowGuardNetwork, MININET_AVAILABLE

def run_smoke_test() -> int:
    if not MININET_AVAILABLE:
        print("[SMOKE TEST SKIP] Mininet is not installed or current OS does not support Linux network namespaces.")
        print("                  On Windows, Mininet tests are skipped; use offline replay or a Linux VM.")
        return 0

    print("==================================================")
    print(" FlowGuard Mininet Lab — Automated Smoke Test")
    print("==================================================")

    lab = FlowGuardNetwork()
    success = False
    try:
        lab.start()
        print("\n[STEP 1] Testing pingall & HTTP services...")
        results = lab.test_connectivity()
        print(json.dumps(results, indent=2))

        if results["all_success"]:
            print("\n[PASS] All connectivity and HTTP service checks passed!")
            success = True
        else:
            print("\n[FAIL] Connectivity checks failed!")
            if not results["ping_success"]:
                print(f"       Ping loss: {results['ping_loss_percent']}%")
            for host, res in results["http_results"].items():
                if not res["success"]:
                    print(f"       HTTP to {host} failed: code {res['status_code']}")
            success = False
    except Exception as e:
        print(f"\n[ERROR] Exception during smoke test: {e}")
        success = False
    finally:
        print("\n[STEP 2] Cleaning up network and server processes...")
        lab.stop()
        print("[PASS] Cleanup completed.")

    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(run_smoke_test())
