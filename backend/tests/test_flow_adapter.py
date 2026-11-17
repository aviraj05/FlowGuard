"""
Unit tests for Pure-Python FlowAdapter, PCAP parsing, and FeatureMapping.
Builds a synthetic PCAP binary in memory, runs it through FlowAdapter and FeatureMapping,
and verifies model inference with feature provenance.
"""

import unittest
import struct
import socket
import tempfile
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from flow_adapter import FlowAdapter, PcapReader
from feature_mapping import map_flow_to_features
from model_pipeline import get_pipeline


def make_ipv4_tcp_packet(
    src_ip: str, dst_ip: str, sport: int, dsport: int,
    seq: int, ack: int, flags: int, payload: bytes = b"",
    timestamp_sec: int = 1700000000, timestamp_usec: int = 0
) -> bytes:
    """Builds a raw Ethernet + IPv4 + TCP packet frame with PCAP packet header."""
    # Ethernet header: dst MAC (6), src MAC (6), ethertype 0x0800 (IPv4)
    eth_hdr = b"\x00\x11\x22\x33\x44\x55\x66\x77\x88\x99\xaa\xbb\x08\x00"

    # TCP payload and header
    tcp_hdr_len = 20
    data_offset_and_reserved = (tcp_hdr_len // 4) << 4
    win_size = 64240
    tcp_hdr = struct.pack(
        "!HHIIBBHHH",
        sport, dsport, seq, ack, data_offset_and_reserved, flags, win_size, 0, 0
    )
    tcp_segment = tcp_hdr + payload

    # IPv4 header
    ip_ver_ihl = (4 << 4) | 5
    total_len = 20 + len(tcp_segment)
    src_bytes = socket.inet_aton(src_ip)
    dst_bytes = socket.inet_aton(dst_ip)
    ip_hdr = struct.pack(
        "!BBHHHBBH4s4s",
        ip_ver_ihl, 0, total_len, 54321, 0x4000, 64, 6, 0, src_bytes, dst_bytes
    )

    frame = eth_hdr + ip_hdr + tcp_segment
    incl_len = len(frame)
    orig_len = incl_len

    # PCAP packet record header (ts_sec, ts_usec, incl_len, orig_len)
    pcap_pkt_hdr = struct.pack("<IIII", timestamp_sec, timestamp_usec, incl_len, orig_len)
    return pcap_pkt_hdr + frame


def create_synthetic_http_pcap(filepath: str):
    """Generates a standard libpcap with a complete HTTP GET exchange."""
    # Global PCAP Header (24 bytes): magic, major 2, minor 4, tz 0, sigfigs 0, snaplen 65535, linktype 1 (EN10MB)
    global_hdr = struct.pack("<IHHiIII", 0xD4C3B2A1, 2, 4, 0, 0, 65535, 1)

    c_ip = "10.0.0.100"
    s_ip = "10.0.0.1"
    c_port = 45000
    s_port = 80

    # 1. Client SYN (seq=1000)
    pkt1 = make_ipv4_tcp_packet(c_ip, s_ip, c_port, s_port, seq=1000, ack=0, flags=0x02, timestamp_sec=1700000000, timestamp_usec=10000)
    # 2. Server SYN-ACK (seq=5000, ack=1001)
    pkt2 = make_ipv4_tcp_packet(s_ip, c_ip, s_port, c_port, seq=5000, ack=1001, flags=0x12, timestamp_sec=1700000000, timestamp_usec=12000)
    # 3. Client ACK (seq=1001, ack=5001)
    pkt3 = make_ipv4_tcp_packet(c_ip, s_ip, c_port, s_port, seq=1001, ack=5001, flags=0x10, timestamp_sec=1700000000, timestamp_usec=13000)
    # 4. Client HTTP GET (seq=1001, ack=5001)
    http_req = b"GET / HTTP/1.1\r\nHost: 10.0.0.1\r\n\r\n"
    pkt4 = make_ipv4_tcp_packet(c_ip, s_ip, c_port, s_port, seq=1001, ack=5001, flags=0x18, payload=http_req, timestamp_sec=1700000000, timestamp_usec=14000)
    # 5. Server HTTP 200 OK + FIN (seq=5001, ack=1001+len)
    http_resp = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nHello"
    pkt5 = make_ipv4_tcp_packet(s_ip, c_ip, s_port, c_port, seq=5001, ack=1001 + len(http_req), flags=0x19, payload=http_resp, timestamp_sec=1700000000, timestamp_usec=16000)

    with open(filepath, "wb") as f:
        f.write(global_hdr)
        f.write(pkt1)
        f.write(pkt2)
        f.write(pkt3)
        f.write(pkt4)
        f.write(pkt5)


class TestFlowAdapter(unittest.TestCase):
    def setUp(self):
        self.tmp_pcap = tempfile.NamedTemporaryFile(suffix=".pcap", delete=False)
        self.tmp_pcap.close()
        create_synthetic_http_pcap(self.tmp_pcap.name)
        self.pipeline = get_pipeline()

    def tearDown(self):
        if os.path.exists(self.tmp_pcap.name):
            os.remove(self.tmp_pcap.name)

    def test_pcap_reader_packets(self):
        """PcapReader parses Ethernet + IPv4 + TCP frames accurately."""
        with PcapReader(self.tmp_pcap.name) as reader:
            pkts = list(reader.packets())
        self.assertEqual(len(pkts), 5)
        self.assertEqual(pkts[0]["src_ip"], "10.0.0.100")
        self.assertEqual(pkts[0]["dst_ip"], "10.0.0.1")
        self.assertEqual(pkts[0]["proto"], "tcp")
        self.assertEqual(pkts[0]["dsport"], 80)

    def test_flow_aggregation(self):
        """FlowAdapter aggregates packets into 1 bidirectional flow with correct metrics."""
        adapter = FlowAdapter()
        flows = adapter.process_pcap(self.tmp_pcap.name)
        self.assertEqual(len(flows), 1)

        f = flows[0]
        self.assertEqual(f["src_ip"], "10.0.0.100")
        self.assertEqual(f["dst_ip"], "10.0.0.1")
        self.assertEqual(f["sport"], 45000)
        self.assertEqual(f["dsport"], 80)
        self.assertEqual(f["proto"], "tcp")
        self.assertEqual(f["service"], "http")
        self.assertEqual(f["state"], "FIN")
        self.assertEqual(f["Spkts"], 3)  # SYN, ACK, GET
        self.assertEqual(f["Dpkts"], 2)  # SYN-ACK, 200 OK
        self.assertGreater(f["sbytes"], 0)
        self.assertGreater(f["dbytes"], 0)

        counters = adapter.get_counters()
        self.assertEqual(counters["packets_seen"], 5)
        self.assertEqual(counters["flows_created"], 1)
        self.assertEqual(counters["flows_emitted"], 1)
        self.assertEqual(counters["exporter_errors"], 0)

    def test_feature_mapping_and_inference(self):
        """Flow record maps to 90 features and passes successfully into Decision Tree."""
        adapter = FlowAdapter()
        flows = adapter.process_pcap(self.tmp_pcap.name)
        raw_flow = flows[0]

        features, prov = map_flow_to_features(raw_flow)
        self.assertIn("sport", features)
        self.assertIn("dur", features)
        self.assertIn("same_subnet_24", features)
        self.assertEqual(features["same_subnet_24"], 1)  # 10.0.0.x is same /24

        # Verify provenance tags
        self.assertEqual(prov["dur"], "measured")
        self.assertEqual(prov["total_bytes"], "derived")
        self.assertEqual(prov["ct_srv_src"], "unavailable")

        # Run model inference
        result = self.pipeline.predict_flow(features)
        self.assertIn("label", result)
        self.assertIn("label_name", result)
        self.assertIn("action", result)
        self.assertIn("provenance", result)
        self.assertEqual(result["schema_version"], "flowguard-unsw-90-v1")


if __name__ == "__main__":
    unittest.main()
