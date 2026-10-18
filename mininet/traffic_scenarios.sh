#!/usr/bin/env bash
# FlowGuard Mininet Traffic Generation Scenarios
# Run on client host h1 inside Mininet CLI: mininet> h1 bash mininet/traffic_scenarios.sh benign

SCENARIO="${1:-benign}"

case "$SCENARIO" in
  benign)
    echo "[FlowGuard] Generating benign HTTP requests to backend cluster..."
    for i in {1..20}; do
      curl -s -o /dev/null http://10.0.0.1/
      curl -s -o /dev/null http://10.0.0.2/
      sleep 0.2
    done
    echo "[FlowGuard] Benign scenario completed."
    ;;

  attack)
    echo "[FlowGuard] Generating port sweep / SYN reconnaissance to 10.0.0.1..."
    # SYN probe simulation using hping3 or nmap if installed, or rapid curl attempts
    if command -v nmap &>/dev/null; then
      nmap -sS -p 21,22,80,443 -T4 10.0.0.1
    else
      for port in 21 22 23 25 80 110 443; do
        timeout 0.2 bash -c "cat < /dev/null > /dev/tcp/10.0.0.1/$port" 2>/dev/null
      done
    fi
    echo "[FlowGuard] Attack scenario completed."
    ;;

  *)
    echo "Usage: $0 [benign|attack]"
    exit 1
    ;;
esac
