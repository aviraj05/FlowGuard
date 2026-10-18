# FlowGuard — Network Traffic Monitoring & ML-Assisted Threat Detection

FlowGuard is a network intrusion detection and telemetry dashboard. It integrates a scikit-learn Decision Tree classifier (trained on the 90-feature UNSW-NB15 schema) with a Python FastAPI backend, local SQLite event persistence, real-time WebSocket event streaming, and a React 19 + TypeScript + Vite frontend.

---

## Architecture & System Overview

```
[Flow Source: Replay / Mininet]
               │
               ▼
   [Feature Adapter (90 columns)]
               │
               ▼
[FlowGuard Pipeline (Fitted Encoder + Imputer + DT Classifier)]
               │
               ▼
      [FastAPI REST & WebSocket] ──▶ [SQLite Store (flowguard.db)]
               │
               ▼ (WebSocket / REST)
    [React 19 Dashboard (Demo & Live Modes)]
```

### Key Engineering Decisions & Truthful Assertions
1. **Model Contract (90 Features)**:
   - The classifier expects a fixed 90-column numeric schema (UNSW-NB15 flow statistics + derived IP/packet rates).
   - Categorical fields (`proto`, `state`, `service`) are converted using the fitted `OrdinalEncoder`.
   - Missing fields are filled with median values from the fitted `SimpleImputer`.
   - **Label Semantics**: `0 = NORMAL` (Benign), `1 = ATTACK` (Malicious).
   - **Artifact Version Warning**: Artifacts were serialized under scikit-learn 1.8.0. In the current runtime (scikit-learn 1.5.2), warnings are logged on load; inference execution is verified reproducible across all test suites.
   - **Historical Metrics**: `metadata.json` records an F1 score of 0.9802. Because the original training dataset (`data/unsw_nb15.csv`) was not bundled, this headline score is recorded as historical and unverified.
2. **Mininet & Operating System Support**:
   - Mininet requires native Linux network namespaces and Open vSwitch. It cannot run natively on Windows.
   - On Windows development environments, FlowGuard provides an **Offline Flow Replay Engine** (`backend/replay.py`) that reads verified benign and attack flow records. All replayed telemetry is explicitly tagged as `replay` and never fabricated as live sensor data.
   - Mininet topology scripts are provided under `mininet/` for Linux / WSL2 environments.
3. **Telemetry Truthfulness**:
   - In **Demo Mode**, the dashboard displays client-side simulated traffic and is clearly labeled with an amber banner.
   - In **Live Mode**, the dashboard renders real scored flows from the FastAPI backend.
   - Uninstrumented metrics (HTTP caching proxy, DGA, packet payload entropy) are explicitly tagged as `UNINSTRUMENTED` or `N/A` in Live Mode.

---

## Quickstart & Execution

### 1. Backend Setup & Startup (FastAPI)

Prerequisites: Python 3.11 or 3.12.

```bash
# Install backend dependencies
pip install -r backend/requirements.txt

# Launch FastAPI backend server (runs on port 8000)
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Verify backend health:
```bash
curl http://localhost:8000/api/v1/health
```

### 2. Frontend Setup & Startup (React + Vite)

Prerequisites: Node.js 18+ and npm.

```bash
# Install dependencies
npm install

# Start Vite dev server
npm run dev

# Run typecheck and production build
npm run build

# Run linter
npm run lint
```

Access the dashboard at `http://localhost:5174/` (or `http://localhost:5173/`).

---

## API Endpoints Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Service status, model readiness, OS runtime, collector mode |
| `GET` | `/api/v1/model/info` | 90-feature list, classes, tree depth, and documentation notes |
| `POST` | `/api/v1/flows/predict` | Single flow record inference; saves event and broadcasts to WebSocket |
| `POST` | `/api/v1/flows/predict_batch` | Batch inference (bounded up to 100 flows) |
| `GET` | `/api/v1/dashboard/snapshot` | Cluster status, aggregate counts, backend health, recent events |
| `GET` | `/api/v1/events` | Paginated, filterable event history (`limit`, `severity`, `label`) |
| `POST` | `/api/v1/lab/backends/{id}/fail` | Isolated lab fault injection toggle with audit logging |
| `POST` | `/api/v1/replay/start` | Starts offline flow replay engine (interval configurable) |
| `POST` | `/api/v1/replay/stop` | Stops offline flow replay engine |
| `GET` | `/api/v1/replay/status` | Current replay status and count |
| `WS` | `/api/v1/events/stream` | Real-time WebSocket event subscription with ping/pong heartbeat |

---

## Automated Test Suites

All tests are implemented using standard `unittest` and `TestClient`:

```bash
# Run all backend tests (model pipeline, API endpoints, e2e replay)
python -m unittest discover backend/tests

# Run model pipeline contract test
python -m unittest backend.tests.test_model_pipeline

# Run REST API integration tests
python -m unittest backend.tests.test_api

# Run end-to-end replay verification test
python -m unittest backend.tests.test_e2e_replay

# Run frontend build & typecheck
npm run build
```

---

## Demonstration Procedure

1. **Open the Dashboard**: Navigate to `http://localhost:5174/`.
2. **Demo Mode (Default)**: Notice the amber `[DEMO SIMULATION]` banner. The interface displays simulated traffic and mock log entries to showcase UI interactions safely.
3. **Switch to Live API Mode**: Click the **Live API** button in the top navbar.
   - The indicator switches to green `[LIVE API MODE]`.
   - The dashboard connects to the FastAPI backend over WebSocket (`WS: ACTIVE`).
   - Notice the Cache Performance panel displays `UNINSTRUMENTED IN LIVE`, truthfully reflecting that no cache proxy is active.
4. **Trigger Flow Replay**: Click **Start Replay** in the navbar (or send `POST /api/v1/replay/start`).
   - The offline replay engine generates verified UNSW-NB15 flow records (benign web traffic, DNS queries, and recon attacks).
   - Each flow is scored server-side through the 90-feature Decision Tree, persisted in SQLite, and streamed via WebSocket to the Security Feed in real time.
   - Attack events are flagged in red (`ATTACK`, `RISK: 1.00`), while normal traffic is marked in green (`NORMAL`, `PASS`).
5. **Simulate Lab Fault**:
   - In Backend Matrix, click **Fail Server** on `Primary Ingress (Backend-01)`.
   - The frontend issues `POST /api/v1/lab/backends/Backend-01/fail`.
   - Backend transitions to `OFFLINE`, an audit entry is recorded in `lab_audit` SQLite table, and the updated status is broadcast to the dashboard.
   - Click **Restore Server** to return it to `HEALTHY`.
