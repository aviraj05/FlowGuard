# FlowGuard — Lab Scenarios & Ground Truth Methodology

## 1. Overview
FlowGuard utilizes four bounded, repeatable traffic generation scenarios confined strictly to the Mininet virtual network. Ground truth labels are generated independently from the scenario runner prior to execution and are never derived from model predictions.

---

## 2. Scenario Catalog

### 1. `benign_http`
- **Description**: Sequential HTTP GET requests to backend web servers.
- **Client**: `h1` (`10.0.0.100`)
- **Targets**: `h2` (`10.0.0.1:80`), `h3` (`10.0.0.2:80`), `h4` (`10.0.0.3:80`)
- **Pacing**: 20 requests with 0.2s inter-request delay.
- **Ground Truth**: `0` (`NORMAL`)
- **Expected Flow State**: `FIN` or `CON`, `service="http"`.

### 2. `benign_repeated`
- **Description**: Intermittent web browsing simulation with variable pacing.
- **Client**: `h1` (`10.0.0.100`)
- **Targets**: `h2` (`10.0.0.1:80`), `h3` (`10.0.0.2:80`)
- **Pacing**: 10 requests with 0.5s delay.
- **Ground Truth**: `0` (`NORMAL`)
- **Expected Flow State**: `CON`, `service="http"`.

### 3. `port_scan`
- **Description**: Low-rate TCP SYN port reconnaissance sweep across common service ports.
- **Client**: `h1` (`10.0.0.100`)
- **Target**: `h2` (`10.0.0.1`)
- **Ports Scanned**: `21, 22, 23, 25, 80, 110, 443, 8080`
- **Pacing**: 0.1s inter-probe delay.
- **Ground Truth**: `1` (`ATTACK`)
- **Expected Flow State**: `REQ` or `RST` on closed ports, high flow count with 1 packet each (`Spkts=1`, `Dpkts=0` or `1`).

### 4. `server_failure`
- **Description**: Connection attempts to an offline port (`9999`) simulating service failure.
- **Client**: `h1` (`10.0.0.100`)
- **Target**: `h2` (`10.0.0.1:9999`)
- **Pacing**: 5 attempts.
- **Ground Truth**: `0` (`NORMAL`)
- **Important Rationale**: Service unavailability or server downtime is an operational fault, not an intrusion attempt. Ground truth is labeled Normal to avoid conflating outages with attacks.

---

## 3. Independent Ground Truth Association

1. **Manifest File**: For every run, `mininet/scenario_runner.py` writes `experiments/<run_id>/manifest.json` recording the ground-truth label and metadata.
2. **Ambiguity Handling**: Flows that occur outside defined scenario windows or lack explicit matching rules are assigned label `-1` (`UNKNOWN` / `UNLABELED`).
3. **Evaluation Gate**: Unlabeled flows are never evaluated for accuracy, false positive rate, or recall. They are reported under operational telemetry only.
