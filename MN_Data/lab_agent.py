#!/usr/bin/env python3
"""
FlowGuard lab agent (run inside the Mininet VM, needs root).

A small web server using only the Python standard library (works on Python 3.8).
The dashboard talks to it directly:

    GET  /api/lab/health     what is installed / ready
    GET  /api/lab/status     current session status
    GET  /api/lab/stream     live events (Server-Sent Events)
    GET  /api/lab/history    summaries of past attacks
    POST /api/lab/start      {"algo","defence","uplink","slow","simulate"}
    POST /api/lab/command    {"cmd": ...}  forwarded to the running session
    POST /api/lab/stop
    POST /api/lab/history/clear
    GET  /api/lab/incidents                 incidents (newest last)
    POST /api/lab/incidents/<id>/action     {"action": "ack"|"unblock"|"false_positive"|"resolve"}
    GET  /api/lab/devices  POST /api/lab/devices   device names / owners
    GET  /api/lab/notify/config  POST /api/lab/notify/config
    POST /api/lab/notify/test    {"stakeholder": id?}
    POST /api/lab/notify/report  weekly report email
    GET  /api/lab/notify/log

Usage:   sudo python3 lab_agent.py            (real Mininet lab)
         python3 lab_agent.py --simulate      (preview mode, no Mininet needed)
"""
import argparse
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from incidents import Devices, IncidentManager  # noqa: E402
from notifier import Notifier  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SESSION = os.path.join(HERE, "lab_session.py")
HISTORY_FILE = os.path.join(HERE, "lab_history.json")
DEVNULL = subprocess.DEVNULL

ALLOWED_CMDS = {"attack_start", "attack_stop", "set_algo", "set_slow", "set_defence", "unblock"}


class Hub:
    def __init__(self, default_simulate):
        self.default_simulate = default_simulate
        self.lock = threading.Lock()
        self.proc = None
        self.simulated = False
        self.status = {"type": "status", "phase": "idle", "msg": "No session running",
                       "simulated": False, "config": None}
        self.ticks = deque(maxlen=180)
        self.events = deque(maxlen=150)
        self.detector = {}
        self.episodes = self._load_history()
        self.subs = []
        self.log_tail = deque(maxlen=15)
        self.devices = Devices()
        self.incidents = IncidentManager(self.devices, self._incident_changed)
        self.notifier = Notifier(self.publish, self.incident_action)

    # ---- incidents
    def _incident_changed(self, inc, what):
        self.publish({"type": "incident", "incident": inc, "what": what})
        self.notifier.on_incident(inc, what)

    def incident_action(self, inc_id, action, who="Dashboard"):
        if action == "unblock":
            inc = self.incidents.get(inc_id)
            if inc is None:
                return False, "Incident not found"
            if inc["status"] == "resolved":
                return False, "Incident already resolved (attacker was released automatically)"
            ok, msg = self.command({"cmd": "unblock"})
            if not ok:
                return False, msg
        inc, msg = self.incidents.action(inc_id, action, who)
        return inc is not None, msg

    # ---- history
    def _load_history(self):
        try:
            with open(HISTORY_FILE) as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except (OSError, ValueError):
            return []

    def _save_history(self):
        try:
            with open(HISTORY_FILE, "w") as f:
                json.dump([e for e in self.episodes if not e.get("simulated")][-50:], f)
        except OSError:
            pass

    # ---- pub/sub
    def subscribe(self):
        q = queue.Queue(maxsize=500)
        with self.lock:
            self.subs.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.subs:
                self.subs.remove(q)

    def publish(self, obj):
        t = obj.get("type")
        with self.lock:
            if t == "status":
                self.status = obj
            elif t == "tick":
                self.ticks.append(obj)
            elif t == "event":
                self.events.append(obj)
            elif t == "detector":
                self.detector[obj["src"]] = obj
            elif t == "episode":
                self.episodes.append(obj)
                self.episodes = self.episodes[-50:]
                self._save_history()
            elif t == "reset":
                self.ticks.clear()
                self.events.clear()
                self.detector = {}
            subs = list(self.subs)
        if t in ("status", "tick", "detector", "event", "episode"):
            self.incidents.feed(obj)
        elif t == "incident":
            self.incidents._save()
        for q in subs:
            try:
                q.put_nowait(obj)
            except queue.Full:
                pass

    def snapshot(self):
        with self.lock:
            return {"type": "snapshot", "status": self.status, "running": self._running(),
                    "ticks": list(self.ticks), "events": list(self.events),
                    "detector": dict(self.detector), "episodes": list(self.episodes),
                    "incidents": self.incidents.list()[-100:], "notify_log": self.notifier.log[-60:],
                    "devices": self.devices.items}

    def _running(self):
        return self.proc is not None and self.proc.poll() is None

    # ---- health
    def health(self):
        return {
            "ok": True, "agent": "flowguard-lab-agent", "time": time.time(),
            "root": hasattr(os, "geteuid") and os.geteuid() == 0,
            "mininet": shutil.which("mn") is not None,
            "haproxy": shutil.which("haproxy") is not None,
            "hping3": shutil.which("hping3") is not None,
            "model": os.path.exists(os.path.join(HERE, "model_lab.joblib")),
            "default_simulate": self.default_simulate,
            "running": self._running(),
            "python": sys.version.split()[0],
        }

    # ---- session control
    def start(self, cfg):
        with self.lock:
            if self._running():
                return False, "A session is already running"
        simulate = bool(cfg.get("simulate", self.default_simulate))
        algo = cfg.get("algo", "roundrobin")
        defence = cfg.get("defence", "off")
        if algo not in ("roundrobin", "leastconn") or defence not in ("off", "monitor", "protect"):
            return False, "Invalid configuration"
        try:
            uplink = int(cfg.get("uplink", 10))
        except (TypeError, ValueError):
            return False, "Invalid uplink"
        uplink = max(1, min(uplink, 100))
        if not simulate:
            h = self.health()
            missing = [k for k in ("root", "mininet", "haproxy", "hping3", "model") if not h[k]]
            if missing:
                return False, "Not ready: missing " + ", ".join(missing)
        cmd = [sys.executable, SESSION, "--algo", algo, "--defence", defence,
               "--uplink", str(uplink), "--slow", "1" if cfg.get("slow") else "0"]
        if simulate:
            cmd.append("--simulate")
        self.publish({"type": "reset"})
        self.log_tail.clear()
        self.simulated = simulate
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, universal_newlines=True, bufsize=1, cwd=HERE)
        threading.Thread(target=self._reader, args=(self.proc,), daemon=True).start()
        return True, "Starting"

    def _reader(self, proc):
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if isinstance(obj, dict) and "type" in obj:
                    self.publish(obj)
                    continue
            except ValueError:
                pass
            self.log_tail.append(line)
        proc.wait()
        last = self.status
        if last.get("phase") not in ("stopped", "error"):
            msg = "Session ended unexpectedly"
            if self.log_tail:
                msg += ": " + " | ".join(list(self.log_tail)[-3:])
            self.publish({"type": "status", "phase": "error", "msg": msg, "simulated": self.simulated})
        if not self.simulated:
            subprocess.run(["mn", "-c"], stdout=DEVNULL, stderr=DEVNULL)

    def command(self, cmd):
        if cmd.get("cmd") not in ALLOWED_CMDS:
            return False, "Unknown command"
        if not self._running():
            return False, "No session is running"
        try:
            self.proc.stdin.write(json.dumps(cmd) + "\n")
            self.proc.stdin.flush()
        except (OSError, ValueError):
            return False, "Could not reach the session"
        return True, "OK"

    def stop(self):
        proc = self.proc
        if proc is None or proc.poll() is not None:
            return False, "No session is running"
        try:
            proc.stdin.write(json.dumps({"cmd": "stop"}) + "\n")
            proc.stdin.flush()
        except (OSError, ValueError):
            pass

        def watchdog():
            for _ in range(40):
                if proc.poll() is not None:
                    return
                time.sleep(0.5)
            proc.terminate()
            time.sleep(3)
            if proc.poll() is None:
                proc.kill()

        threading.Thread(target=watchdog, daemon=True).start()
        return True, "Stopping"

    def clear_history(self):
        with self.lock:
            self.episodes = []
        self._save_history()
        self.incidents.clear()
        self.publish({"type": "history_cleared"})


HUB = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # keep the console quiet
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except ValueError:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/lab/health":
            self._json(HUB.health())
        elif path == "/api/lab/status":
            self._json({"status": HUB.status, "running": HUB._running()})
        elif path == "/api/lab/history":
            self._json({"episodes": HUB.episodes})
        elif path == "/api/lab/stream":
            self._stream()
        elif path == "/api/lab/incidents":
            self._json({"incidents": HUB.incidents.list()})
        elif path == "/api/lab/devices":
            self._json({"devices": HUB.devices.items})
        elif path == "/api/lab/notify/config":
            self._json(HUB.notifier.public_config())
        elif path == "/api/lab/notify/log":
            self._json({"log": HUB.notifier.log[-200:]})
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = self.path.split("?")[0]
        body = self._body()
        if path == "/api/lab/start":
            ok, msg = HUB.start(body)
            self._json({"ok": ok, "message": msg}, 200 if ok else 409)
        elif path == "/api/lab/stop":
            ok, msg = HUB.stop()
            self._json({"ok": ok, "message": msg}, 200 if ok else 409)
        elif path == "/api/lab/command":
            ok, msg = HUB.command(body)
            self._json({"ok": ok, "message": msg}, 200 if ok else 409)
        elif path == "/api/lab/history/clear":
            HUB.clear_history()
            self._json({"ok": True})
        elif path.startswith("/api/lab/incidents/") and path.endswith("/action"):
            inc_id = path[len("/api/lab/incidents/"):-len("/action")]
            ok, msg = HUB.incident_action(inc_id, body.get("action"), body.get("who") or "Dashboard")
            self._json({"ok": ok, "message": msg}, 200 if ok else 409)
        elif path == "/api/lab/devices":
            items = HUB.devices.save(body.get("devices") or [])
            HUB.publish({"type": "devices", "devices": items})
            self._json({"ok": True, "message": "Saved", "devices": items})
        elif path == "/api/lab/notify/config":
            ok, msg = HUB.notifier.save_config(body)
            self._json({"ok": ok, "message": msg, "config": HUB.notifier.public_config()}, 200 if ok else 400)
        elif path == "/api/lab/notify/test":
            res = HUB.notifier.send_test(body.get("stakeholder"))
            sent = sum(1 for r in res if r["status"] == "sent")
            self._json({"ok": True, "message": "%d of %d test messages sent" % (sent, len(res)), "results": res})
        elif path == "/api/lab/notify/report":
            res = HUB.notifier.send_weekly_report(HUB.incidents.list())
            sent = sum(1 for r in res if r["status"] == "sent")
            self._json({"ok": True, "message": "Weekly report sent to %d of %d recipients" % (sent, len(res)), "results": res})
        else:
            self._json({"error": "not found"}, 404)

    def _stream(self):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        q = HUB.subscribe()
        try:
            self.wfile.write(("data: " + json.dumps(HUB.snapshot()) + "\n\n").encode())
            self.wfile.flush()
            while True:
                try:
                    obj = q.get(timeout=10)
                    self.wfile.write(("data: " + json.dumps(obj) + "\n\n").encode())
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            HUB.unsubscribe(q)


def main():
    global HUB
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--simulate", action="store_true", help="default to the simulated preview (no Mininet)")
    args = ap.parse_args()
    HUB = Hub(args.simulate)
    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    srv.daemon_threads = True
    h = HUB.health()
    print("FlowGuard lab agent listening on port %d" % args.port)
    print("  root=%s mininet=%s haproxy=%s hping3=%s model=%s%s" % (
        h["root"], h["mininet"], h["haproxy"], h["hping3"], h["model"],
        "  [SIMULATION by default]" if args.simulate else ""))
    n = HUB.notifier
    print("  notifications: email=%s telegram=%s  (secrets in MN_Data/.env)" % (
        "ready" if n.email_ready() else "not configured", "ready" if n.telegram_ready() else "not configured"))
    print("  Open the dashboard (Drills page). Press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if HUB._running():
            HUB.stop()
            time.sleep(2)


if __name__ == "__main__":
    main()
