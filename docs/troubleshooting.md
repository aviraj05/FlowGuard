# FlowGuard — Troubleshooting & Diagnostic Guide

## 1. Mininet Lab Issues

### `Mininet is not installed or current OS does not support Linux network namespaces`
- **Cause**: Executed on Windows or macOS host.
- **Resolution**: Mininet requires Linux kernel network namespaces. Run the topology inside the VirtualBox Ubuntu VM using `sudo python3 mininet/smoke_test.py` or use the Offline Flow Replay mode.

### `Cannot find interface s1-eth1` or `Port already in use`
- **Cause**: Residual Open vSwitch state or open ports from interrupted runs.
- **Resolution**:
  ```bash
  sudo mn -c
  sudo pkill -9 -f "python3 -m http.server"
  sudo pkill -9 tcpdump
  ```

### `Client cannot ping backends`
- **Cause**: Old topology had mismatched subnets (`192.168.1.100` vs `10.0.0.x`).
- **Resolution**: Verified fixed in `mininet/topology.py` where all hosts are in `10.0.0.0/24`.

---

## 2. Model & API Issues

### `InconsistentVersionWarning: Trying to unpickle estimator from version 1.8.0`
- **Status**: Known non-blocking risk.
- **Details**: Model artifacts were pickled in scikit-learn 1.8.0; runtime is 1.5.2. Prediction outputs have been validated against fixtures and are stable.

### `API Error: Cannot connect to http://localhost:8000`
- **Cause**: Backend FastAPI server is not running.
- **Resolution**:
  ```bash
  python backend/main.py
  # Or with uvicorn:
  uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
  ```

---

## 3. Dashboard & Frontend Issues

### `WebSocket RECONNECTING`
- **Cause**: Backend API is down or port 8000 is blocked.
- **Resolution**: Ensure backend is running and `VITE_API_BASE_URL` points to the active API IP.
