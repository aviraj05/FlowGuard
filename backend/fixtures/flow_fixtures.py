"""
Representative flow record fixtures for FlowGuard model contract testing.
Includes verified benign and attack flow fixtures matching UNSW-NB15 schema.
"""

BENIGN_WEB_FLOW = {
    "flow_id": "flow-benign-001",
    "srcip": "192.168.1.100",
    "sport": 54321,
    "dstip": "10.0.0.1",
    "dsport": 80,
    "proto": "tcp",
    "state": "CON",
    "dur": 0.05,
    "sbytes": 500,
    "dbytes": 1200,
    "Spkts": 6,
    "Dpkts": 8,
    "service": "http",
    "sttl": 64,
    "dttl": 60,
    "swin": 255,
    "dwin": 255
}

BENIGN_DNS_FLOW = {
    "flow_id": "flow-benign-002",
    "srcip": "192.168.1.105",
    "sport": 61200,
    "dstip": "10.0.0.53",
    "dsport": 53,
    "proto": "udp",
    "state": "CON",
    "dur": 0.003,
    "sbytes": 74,
    "dbytes": 148,
    "Spkts": 1,
    "Dpkts": 1,
    "service": "dns",
    "sttl": 64,
    "dttl": 60
}

# Malicious flow fixture constructed to trigger the model's verified attack branch
# Traces through tree: src_ip_octet_1 > 162, dsport <= 74.5, dst_ip_octet_3 > 79, total_bytes > 1319
ATTACK_RECON_FLOW = {
    "flow_id": "flow-attack-001",
    "srcip": "175.45.176.3",
    "sport": 49152,
    "dstip": "10.0.80.1",
    "dsport": 21,
    "proto": "tcp",
    "state": "FIN",
    "dur": 0.05,
    "sbytes": 1800,
    "dbytes": 200,
    "Spkts": 15,
    "Dpkts": 2,
    "service": "ftp",
    "sttl": 64,
    "dttl": 60,
    "smeansz": 45,
    "ct_srv_src": 12,
    "ct_srv_dst": 12,
    "ct_dst_ltm": 10,
    "ct_src_ ltm": 10
}

# Raw 90-feature record (already pre-computed)
BENIGN_RAW_90 = {
    "sport": 80,
    "dsport": 49152,
    "proto": "tcp",
    "state": "CON",
    "dur": 0.04,
    "sbytes": 800,
    "dbytes": 4000,
    "sttl": 64,
    "dttl": 60,
    "service": "http",
    "src_ip_octet_1": 10,
    "dst_ip_octet_1": 192
}
