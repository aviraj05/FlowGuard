"""
FlowGuard Flow Adapter & Pure-Python PCAP Parser
Extracts bidirectional network flows from standard libpcap files without external C libraries.
Computes flow duration, forward/backward bytes and packet counts, TCP handshake timings,
and protocol states.
"""

import struct
import socket
import os
import math
from typing import Dict, Any, List, Optional, Tuple, Iterator

# Protocol numbers
PROTO_ICMP = 1
PROTO_TCP = 6
PROTO_UDP = 17

PROTO_MAP = {
    PROTO_ICMP: "icmp",
    PROTO_TCP: "tcp",
    PROTO_UDP: "udp",
}

PORT_SERVICE_MAP = {
    80: "http",
    8080: "http",
    443: "ssl",
    53: "dns",
    21: "ftp",
    22: "ssh",
    25: "smtp",
    110: "pop3",
    143: "imap",
    123: "ntp",
    67: "dhcp",
    68: "dhcp",
}


class PcapReader:
    """Reads standard libpcap files using pure Python struct unpacking."""

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.file = None
        self.magic = None
        self.endian = "<"  # default little endian
        self.snaplen = 65535
        self.linktype = 1  # 1 = Ethernet (DLT_EN10MB)

    def __enter__(self):
        self.file = open(self.filepath, "rb")
        self._read_global_header()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.file:
            self.file.close()

    def _read_global_header(self):
        header_bytes = self.file.read(24)
        if len(header_bytes) < 24:
            raise ValueError(f"File {self.filepath} is too small to be a valid PCAP")

        magic = struct.unpack("=I", header_bytes[0:4])[0]
        if magic == 0xA1B2C3D4:
            self.endian = ">"  # Big endian
        elif magic == 0xD4C3B2A1:
            self.endian = "<"  # Little endian
        else:
            raise ValueError(f"Unsupported PCAP magic number: {hex(magic)}")

        version_major, version_minor, thiszone, sigfigs, self.snaplen, self.linktype = struct.unpack(
            f"{self.endian}HHIIII", header_bytes[4:24]
        )

    def packets(self) -> Iterator[Dict[str, Any]]:
        """Yields raw parsed packets with timestamp, IP headers, and transport info."""
        while True:
            pkt_hdr = self.file.read(16)
            if len(pkt_hdr) < 16:
                break

            ts_sec, ts_usec, incl_len, orig_len = struct.unpack(f"{self.endian}IIII", pkt_hdr)
            pkt_data = self.file.read(incl_len)
            if len(pkt_data) < incl_len:
                break

            timestamp = float(ts_sec) + float(ts_usec) / 1_000_000.0

            # Only handle Ethernet frames (linktype 1)
            if self.linktype != 1 or len(pkt_data) < 14:
                continue

            eth_type = struct.unpack("!H", pkt_data[12:14])[0]
            # Handle 802.1Q VLAN tag
            ip_offset = 14
            if eth_type == 0x8100:
                eth_type = struct.unpack("!H", pkt_data[16:18])[0]
                ip_offset = 18

            # IPv4 only for lab topology
            if eth_type != 0x0800:
                continue

            ip_data = pkt_data[ip_offset:]
            if len(ip_data) < 20:
                continue

            ihl = (ip_data[0] & 0x0F) * 4
            ttl = ip_data[8]
            proto_num = ip_data[9]
            src_ip = socket.inet_ntoa(ip_data[12:16])
            dst_ip = socket.inet_ntoa(ip_data[16:20])
            total_len = struct.unpack("!H", ip_data[2:4])[0]

            transport_data = ip_data[ihl:]
            sport = 0
            dsport = 0
            tcp_flags = 0
            seq_num = 0
            ack_num = 0
            win_size = 0

            if proto_num == PROTO_TCP and len(transport_data) >= 20:
                sport, dsport, seq_num, ack_num = struct.unpack("!HHII", transport_data[0:12])
                tcp_flags = transport_data[13]
                win_size = struct.unpack("!H", transport_data[14:16])[0]
            elif proto_num == PROTO_UDP and len(transport_data) >= 8:
                sport, dsport = struct.unpack("!HH", transport_data[0:4])

            yield {
                "timestamp": timestamp,
                "src_ip": src_ip,
                "dst_ip": dst_ip,
                "proto_num": proto_num,
                "proto": PROTO_MAP.get(proto_num, str(proto_num)),
                "sport": sport,
                "dsport": dsport,
                "ttl": ttl,
                "wire_len": incl_len,
                "ip_len": total_len,
                "tcp_flags": tcp_flags,
                "seq_num": seq_num,
                "ack_num": ack_num,
                "win_size": win_size,
            }


class BidirectionalFlow:
    """Maintains state for a single bidirectional flow."""

    def __init__(self, first_pkt: Dict[str, Any]):
        self.flow_id = f"{first_pkt['src_ip']}:{first_pkt['sport']}_{first_pkt['dst_ip']}:{first_pkt['dsport']}_{first_pkt['proto']}"
        self.src_ip = first_pkt["src_ip"]
        self.dst_ip = first_pkt["dst_ip"]
        self.sport = first_pkt["sport"]
        self.dsport = first_pkt["dsport"]
        self.proto = first_pkt["proto"]
        self.proto_num = first_pkt["proto_num"]

        self.start_time = first_pkt["timestamp"]
        self.last_time = first_pkt["timestamp"]

        self.sbytes = 0
        self.dbytes = 0
        self.spkts = 0
        self.dpkts = 0

        self.sttl = first_pkt["ttl"]
        self.dttl = 0

        self.swin = first_pkt["win_size"]
        self.dwin = 0

        self.stcpb = first_pkt["seq_num"]
        self.dtcpb = 0

        self.syn_time: Optional[float] = None
        self.synack_time: Optional[float] = None
        self.ack_time: Optional[float] = None

        self.has_fin = False
        self.has_rst = False

        self.add_packet(first_pkt)

    def is_forward(self, pkt: Dict[str, Any]) -> bool:
        return pkt["src_ip"] == self.src_ip and pkt["sport"] == self.sport

    def add_packet(self, pkt: Dict[str, Any]):
        self.last_time = max(self.last_time, pkt["timestamp"])
        is_fwd = self.is_forward(pkt)

        if is_fwd:
            self.spkts += 1
            self.sbytes += pkt["ip_len"]
            self.sttl = pkt["ttl"]
            if pkt["win_size"]:
                self.swin = pkt["win_size"]
        else:
            self.dpkts += 1
            self.dbytes += pkt["ip_len"]
            self.dttl = pkt["ttl"]
            if not self.dtcpb and pkt["seq_num"]:
                self.dtcpb = pkt["seq_num"]
            if pkt["win_size"]:
                self.dwin = pkt["win_size"]

        # Track TCP 3-way handshake times
        if pkt["proto_num"] == PROTO_TCP:
            flags = pkt["tcp_flags"]
            is_syn = bool(flags & 0x02)
            is_ack = bool(flags & 0x10)
            is_fin = bool(flags & 0x01)
            is_rst = bool(flags & 0x04)

            if is_fin:
                self.has_fin = True
            if is_rst:
                self.has_rst = True

            if is_syn and not is_ack and is_fwd and self.syn_time is None:
                self.syn_time = pkt["timestamp"]
            elif is_syn and is_ack and not is_fwd and self.synack_time is None:
                self.synack_time = pkt["timestamp"]
            elif is_ack and not is_syn and is_fwd and self.synack_time is not None and self.ack_time is None:
                self.ack_time = pkt["timestamp"]

    def to_record(self) -> Dict[str, Any]:
        """Converts flow state into raw flow measurements dictionary."""
        dur = max(0.0, self.last_time - self.start_time)

        # Service mapping
        service = PORT_SERVICE_MAP.get(self.dsport, PORT_SERVICE_MAP.get(self.sport, "-"))

        # State determination
        if self.has_rst:
            state = "RST"
        elif self.has_fin:
            state = "FIN"
        elif self.spkts > 0 and self.dpkts > 0:
            state = "CON"
        elif self.spkts > 0:
            state = "REQ"
        else:
            state = "INT"

        # TCP timing metrics (in seconds)
        tcprtt = 0.0
        synack = 0.0
        ackdat = 0.0

        if self.syn_time and self.synack_time:
            synack = max(0.0, self.synack_time - self.syn_time)
        if self.synack_time and self.ack_time:
            ackdat = max(0.0, self.ack_time - self.synack_time)
        if synack > 0 or ackdat > 0:
            tcprtt = synack + ackdat

        return {
            "flow_id": self.flow_id,
            "src_ip": self.src_ip,
            "dst_ip": self.dst_ip,
            "sport": self.sport,
            "dsport": self.dsport,
            "proto": self.proto,
            "state": state,
            "dur": round(dur, 6),
            "sbytes": self.sbytes,
            "dbytes": self.dbytes,
            "sttl": self.sttl,
            "dttl": self.dttl,
            "sloss": 0,
            "dloss": 0,
            "service": service,
            "Spkts": self.spkts,
            "Dpkts": self.dpkts,
            "swin": self.swin,
            "dwin": self.dwin,
            "stcpb": self.stcpb,
            "dtcpb": self.dtcpb,
            "Stime": self.start_time,
            "Ltime": self.last_time,
            "Sjit": 0.0,
            "Djit": 0.0,
            "Sintpkt": 0.0 if self.spkts <= 1 else round(dur / (self.spkts - 1), 6),
            "Dintpkt": 0.0 if self.dpkts <= 1 else round(dur / (self.dpkts - 1), 6),
            "tcprtt": round(tcprtt, 6),
            "synack": round(synack, 6),
            "ackdat": round(ackdat, 6),
        }


class FlowAdapter:
    """Coordinates PCAP ingestion, flow aggregation, timeouts, and metric counters."""

    def __init__(self, tcp_timeout: float = 60.0, udp_timeout: float = 30.0):
        self.tcp_timeout = tcp_timeout
        self.udp_timeout = udp_timeout
        self.counters = {
            "packets_seen": 0,
            "flows_created": 0,
            "flows_emitted": 0,
            "exporter_errors": 0,
            "dropped_unusable": 0,
        }

    def process_pcap(self, pcap_path: str) -> List[Dict[str, Any]]:
        """Processes a PCAP file and returns all aggregated bidirectional flow records."""
        if not os.path.exists(pcap_path):
            self.counters["exporter_errors"] += 1
            raise FileNotFoundError(f"PCAP file not found: {pcap_path}")

        active_flows: Dict[str, BidirectionalFlow] = {}
        completed_flows: List[Dict[str, Any]] = []

        try:
            with PcapReader(pcap_path) as reader:
                for pkt in reader.packets():
                    self.counters["packets_seen"] += 1

                    # Canonical flow key (ignoring direction)
                    ip1, ip2 = sorted([pkt["src_ip"], pkt["dst_ip"]])
                    p1, p2 = sorted([pkt["sport"], pkt["dsport"]])
                    key = f"{ip1}:{p1}_{ip2}:{p2}_{pkt['proto']}"

                    if key not in active_flows:
                        active_flows[key] = BidirectionalFlow(pkt)
                        self.counters["flows_created"] += 1
                    else:
                        flow = active_flows[key]
                        # Check timeout
                        timeout = self.tcp_timeout if pkt["proto_num"] == PROTO_TCP else self.udp_timeout
                        if pkt["timestamp"] - flow.last_time > timeout:
                            completed_flows.append(flow.to_record())
                            self.counters["flows_emitted"] += 1
                            active_flows[key] = BidirectionalFlow(pkt)
                            self.counters["flows_created"] += 1
                        else:
                            flow.add_packet(pkt)

            # Flush remaining active flows
            for flow in active_flows.values():
                rec = flow.to_record()
                completed_flows.append(rec)
                self.counters["flows_emitted"] += 1

        except Exception as e:
            self.counters["exporter_errors"] += 1
            raise RuntimeError(f"Error parsing PCAP {pcap_path}: {e}")

        return completed_flows

    def get_counters(self) -> Dict[str, int]:
        return dict(self.counters)
