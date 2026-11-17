# FlowGuard — Mininet VM Setup & Isolation Guide

## 1. Overview & Isolation Architecture

Mininet requires Linux kernel network namespaces (`ip netns`) and Open vSwitch kernel modules. To guarantee safe and repeatable execution without impacting external networks, run Mininet inside a dedicated Linux virtual machine (Ubuntu 22.04 LTS or Debian 12 recommended) using VirtualBox or VMware.

### Network Isolation Rules
- **Host-Only Network (Adapter 1)**: Assign IP `192.168.56.x` to allow your host machine (running the FlowGuard React dashboard and FastAPI backend) to reach the VM, and the VM to submit flow records to `http://192.168.56.1:8000/api/v1/flow/submit`.
- **Lab Subnet (`10.0.0.0/24`)**: Confined strictly inside Mininet's virtual switch (`s1`).
- **NO BRIDGED ADAPTER**: Never bridge the Mininet VM adapter to a physical campus, enterprise, or public Wi-Fi network. All attack traffic and port scans must remain isolated inside the Mininet virtual namespaces.

---

## 2. Step-by-Step VirtualBox Setup

1. **Download Ubuntu 22.04 Server ISO** or use a pre-built Mininet VM from [mininet.org](http://mininet.org/download/).
2. **Create VM**:
   - RAM: 2048 MB or higher
   - CPUs: 2 cores
   - Disk: 20 GB dynamically allocated
3. **Configure Network Adapters in VirtualBox**:
   - **Adapter 1 (Host Communication)**: Attached to `Host-only Adapter` (e.g. `VirtualBox Host-Only Ethernet Adapter`). This allows safe HTTP traffic between your host OS and the VM.
   - **Adapter 2 (Package Installation / NAT)**: Attached to `NAT` (only for `apt-get` package downloads; can be disabled during experiment runs).
4. **Install Mininet & Dependencies**:
   ```bash
   sudo apt-get update
   sudo apt-get install -y git python3 python3-pip mininet openvswitch-switch tcpdump curl nmap
   # Python packages for capture and adapter
   pip3 install requests dpkt scapy pydantic
   ```
5. **Clone or Share FlowGuard Repository**:
   Mount the repository folder as a VirtualBox Shared Folder or clone it:
   ```bash
   cd ~/FlowGuard
   ```

---

## 3. Running the Smoke Test

To verify that Mininet, Open vSwitch, and Python bindings are correctly installed and operating:

```bash
sudo python3 mininet/smoke_test.py
```

Expected output:
```
==================================================
 FlowGuard Mininet Lab — Automated Smoke Test
==================================================
*** Creating Mininet network
*** Adding Controller
*** Adding Switch
*** Adding Client Host
*** Adding Backend Hosts
*** Starting Network
*** Starting managed HTTP servers on backends
    Started http.server on h2 (port 80, PID 1234)
    Started http.server on h3 (port 80, PID 1235)
    Started http.server on h4 (port 80, PID 1236)
*** FlowGuard Lab network is ready.

[STEP 1] Testing pingall & HTTP services...
*** Testing connectivity: pingall
*** Results: 0% dropped (12/12 received)
*** Testing HTTP services from client
{
  "ping_loss_percent": 0.0,
  "ping_success": true,
  "http_results": {
    "h2": {"target": "10.0.0.1:80", "status_code": "200", "success": true},
    "h3": {"target": "10.0.0.2:80", "status_code": "200", "success": true},
    "h4": {"target": "10.0.0.3:80", "status_code": "200", "success": true}
  },
  "all_success": true
}

[PASS] All connectivity and HTTP service checks passed!

[STEP 2] Cleaning up network and server processes...
*** Stopping backend servers cleanly
*** Stopping Mininet network
*** Teardown complete.
[PASS] Cleanup completed.
```

---

## 4. Troubleshooting Mininet VM Issues

- **Switch or Controller Error**: Run `sudo mn -c` to clear stale OpenFlow sockets and interfaces.
- **Permission Denied**: Mininet commands modifying kernel namespaces and Open vSwitch require `sudo`.
- **Cannot Reach Backend API from VM**: Ensure host firewall allows inbound connections on port 8000 on the VirtualBox Host-Only interface. Test with `curl http://192.168.56.1:8000/api/v1/health`.
