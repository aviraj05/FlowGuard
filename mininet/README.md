# FlowGuard Mininet Network Lab

## Environment Support & Architecture

> **Notice regarding OS Support**: Mininet requires native Linux network namespaces (`ip netns`) and Open vSwitch kernel modules. It cannot run natively on Windows. On Windows development systems, FlowGuard uses the **Offline Flow Replay Engine** built into the backend (`POST /api/v1/replay/start`), which feeds verified benign and attack flow records through the same 90-feature pipeline.

For Linux or WSL2 environments with kernel namespace support:

### Prerequisites (Linux)
```bash
sudo apt-get update
sudo apt-get install -y mininet openvswitch-switch curl nmap
```

### Running the Topology
```bash
sudo python3 mininet/topology.py
```

### Flow Exporting & Feature Mapping
When running live capture in Mininet, a flow exporter such as `argus`, `tshark`, or `cicflowmeter` must be mapped to the UNSW-NB15 90-feature schema expected by `model files/best_model.joblib`.

Because raw packet capture does not produce historical host-level ratios (e.g. `ct_src_ ltm`, `ct_srv_dst`) by default, those fields are derived server-side in `backend/model_pipeline.py` or median-imputed via `missing_value_imputer.joblib`.
