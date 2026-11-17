"""Unit test to verify Mininet topology configuration integrity across platforms."""
import unittest
import ipaddress
import sys
import os

# Include mininet directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "mininet"))
from topology import DEFAULT_LAB_CONFIG

class TestMininetConfig(unittest.TestCase):
    def test_all_hosts_same_subnet(self):
        subnet = ipaddress.ip_network(DEFAULT_LAB_CONFIG["subnet"])
        
        client_ip = ipaddress.ip_interface(DEFAULT_LAB_CONFIG["client"]["ip"]).ip
        self.assertIn(client_ip, subnet, "Client must be inside lab subnet")
        
        seen_ips = {client_ip}
        for b in DEFAULT_LAB_CONFIG["backends"]:
            b_ip = ipaddress.ip_interface(b["ip"]).ip
            self.assertIn(b_ip, subnet, f"Backend {b['name']} must be inside lab subnet")
            self.assertNotIn(b_ip, seen_ips, f"Duplicate IP found: {b_ip}")
            seen_ips.add(b_ip)
            self.assertGreater(b["port"], 0)
            self.assertLessEqual(b["port"], 65535)

    def test_no_bogus_default_routes(self):
        # Ensure no non-existent gateway routes configured
        self.assertNotIn("defaultRoute", DEFAULT_LAB_CONFIG["client"])
        for b in DEFAULT_LAB_CONFIG["backends"]:
            self.assertNotIn("defaultRoute", b)

if __name__ == "__main__":
    unittest.main()
