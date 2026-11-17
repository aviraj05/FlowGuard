#!/usr/bin/env python3
"""
FlowGuard lab session (started by lab_agent.py, needs root).

Builds the Mininet lab (client, attacker, HAProxy load balancer, three web
back-ends), keeps three legitimate clients sending requests, runs the live
detector, and prints one JSON object per line on stdout:

    {"type": "status", ...}     lifecycle (starting, ready, stopped, error)
    {"type": "tick", ...}       once per second: latency, requests, per-back-end load
    {"type": "detector", ...}   one scored 1-second window of a source
    {"type": "event", ...}      human-readable events (attack started, source blocked, ...)
    {"type": "episode", ...}    summary of one attack once it ends

JSON commands arrive on stdin, one per line:
    {"cmd": "attack_start", "attack": "udp", "length": 30}
    {"cmd": "attack_stop"}
    {"cmd": "set_algo", "algo": "roundrobin" | "leastconn"}
    {"cmd": "set_slow", "on": true | false}            # srv1 +100 ms
    {"cmd": "set_defence", "mode": "off" | "monitor" | "protect"}
    {"cmd": "unblock"}
    {"cmd": "stop"}

--simulate runs the same protocol from a simple model instead of Mininet. It is
only for previewing the dashboard (the dashboard labels it SIMULATED).
Compatible with Python 3.8.
"""
import argparse
import json
import os
import queue
import random
import re
import socket
import statistics
import subprocess
import sys
import threading
import time
from collections import Counter, deque

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

LB_IP = "10.0.0.10"
ATTACKER_IP = "10.0.0.2"
CLIENT_IP = "10.0.0.1"
SERVERS = ["srv1", "srv2", "srv3"]
SOCK = "/tmp/haproxy.sock"
PIDFILE = "/tmp/haproxy_lab.pid"
DEVNULL = subprocess.DEVNULL

ATTACKS = {  # about 10,000 packets/s towards the load balancer
    "udp": ["hping3", "--udp", "-p", "80", "-d", "1000", "-i", "u100", LB_IP],
    "syn": ["hping3", "-S", "-p", "80", "-i", "u100", LB_IP],
    "icmp": ["hping3", "--icmp", "-d", "1000", "-i", "u100", LB_IP],
}

LEGIT_LOOP = (
    "while true; do s=$(date +%s.%N); "
    "out=$(curl -s --max-time 2 -w ' %{http_code} %{time_total}' http://LBIP/ 2>/dev/null | tr '\\n' ' '); "
    "echo \"$s ${out:- 000 2.0}\" >> LOGFILE; sleep 0.1; done"
).replace("LBIP", LB_IP)

_out_lock = threading.Lock()


def emit(obj):
    with _out_lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def emit_event(kind, msg, level="info"):
    emit({"type": "event", "ts": time.time(), "kind": kind, "msg": msg, "level": level})


# ───────────────────────── pure helpers (unit-tested) ─────────────────────────
LEG = re.compile(r"^(\d+\.\d+)\s+(?:served by (srv\d)\s+)?(\d{3})\s+([\d.]+)\s*$")


def parse_legit_line(line):
    """'1700000000.1 served by srv2  200 0.003' -> dict (ms = response time)."""
    m = LEG.match(line.strip())
    if not m:
        return None
    return {"ts": float(m.group(1)), "srv": m.group(2), "code": m.group(3),
            "ms": float(m.group(4)) * 1000.0}


def percentile(values, q):
    if not values:
        return None
    s = sorted(values)
    return s[int(q * (len(s) - 1))]


def parse_haproxy_stats(text):
    """Parse 'show stat' CSV into {srvN: {active, total, up}} for backend web_pool."""
    lines = [ln for ln in text.strip().split("\n") if ln]
    if not lines:
        return {}
    header = lines[0].lstrip("# ").split(",")
    idx = {name: i for i, name in enumerate(header)}
    need = ("pxname", "svname", "scur", "stot", "status")
    if any(n not in idx for n in need):
        return {}
    out = {}
    for ln in lines[1:]:
        c = ln.split(",")
        if len(c) <= max(idx[n] for n in need):
            continue
        if c[idx["pxname"]] == "web_pool" and c[idx["svname"]] in SERVERS:
            out[c[idx["svname"]]] = {
                "active": int(c[idx["scur"]] or 0),
                "total": int(c[idx["stot"]] or 0),
                "up": c[idx["status"]].startswith("UP"),
            }
    return out


def haproxy_stats():
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(0.6)
        s.connect(SOCK)
        s.sendall(b"show stat\n")
        buf = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
        s.close()
        return parse_haproxy_stats(buf.decode("utf-8", "ignore"))
    except Exception:
        return {}


class LogTail:
    """Reads new lines appended to the legitimate-client log files."""

    def __init__(self, paths):
        self.paths = paths
        self.offsets = {p: 0 for p in paths}
        self.partial = {p: "" for p in paths}

    def read_new(self):
        recs = []
        for p in self.paths:
            try:
                with open(p, "r", errors="ignore") as f:
                    f.seek(self.offsets[p])
                    data = f.read()
                    self.offsets[p] = f.tell()
            except OSError:
                continue
            data = self.partial[p] + data
            lines = data.split("\n")
            self.partial[p] = lines.pop()  # last piece may be an unfinished line
            for ln in lines:
                r = parse_legit_line(ln)
                if r:
                    recs.append(r)
        return recs


class EpisodeTracker:
    """Collects the numbers for one attack (start to end) and builds the summary."""

    def __init__(self):
        self.pre = deque(maxlen=10)  # latency lists of the 10 ticks before the attack
        self.active = False
        self.counter = 0

    def start(self, t, cfg):
        self.active = True
        self.t_start = t
        self.cfg = dict(cfg)
        self.baseline = [x for lst in self.pre for x in lst]
        self.lat, self.after = [], []
        self.ok = self.fail = 0
        self.t_block = None
        # time from which blocking was possible (attack start, or when protect mode was switched on)
        self.t_protect = t if cfg.get("defence") == "protect" else None

    def on_tick(self, t, ok, fail, lat):
        if not self.active:
            self.pre.append(list(lat))
            return
        self.ok += ok
        self.fail += fail
        self.lat.extend(lat)
        if self.t_block is not None and t >= self.t_block + 2:
            self.after.extend(lat)

    def blocked(self, t):
        if self.active and self.t_block is None:
            self.t_block = t

    def set_defence(self, mode, t):
        """Record a defence change in the middle of an attack (e.g. 'off>protect')."""
        if not self.active:
            return
        if self.cfg.get("defence") != mode and ">" not in str(self.cfg.get("defence")):
            self.cfg["defence"] = "%s>%s" % (self.cfg.get("defence"), mode)
        if mode == "protect" and self.t_protect is None:
            self.t_protect = t

    def finish(self, t_end):
        self.active = False
        self.counter += 1
        mean = lambda v: round(statistics.mean(v), 1) if v else None
        p95 = percentile(self.lat, 0.95)
        return {
            "type": "episode", "id": self.counter, "ts": t_end,
            "attack": self.cfg.get("attack"), "algo": self.cfg.get("algo"),
            "defence": self.cfg.get("defence"), "uplink": self.cfg.get("uplink"),
            "slow": self.cfg.get("slow"), "simulated": self.cfg.get("simulated", False),
            "length_s": round(t_end - self.t_start, 1),
            "baseline_ms": mean(self.baseline), "attack_ms": mean(self.lat),
            "attack_p95_ms": round(p95, 1) if p95 is not None else None,
            "completed": self.ok, "failed": self.fail,
            "blocked": self.t_block is not None,
            "detect_delay_s": (round(self.t_block - (self.t_protect if self.t_protect is not None else self.t_start), 2)
                               if self.t_block else None),
            "after_ms": mean(self.after),
        }


def make_tick(t0, now, recs, haproxy, state):
    ok = [r for r in recs if r["code"] == "200"]
    lat = [r["ms"] for r in ok]
    per = Counter(r["srv"] for r in ok if r["srv"])
    backends = {}
    for s in SERVERS:
        h = haproxy.get(s, {})
        backends[s] = {"reqs": per.get(s, 0), "active": h.get("active", 0),
                       "total": h.get("total", 0), "up": h.get("up", True)}
    tick = {
        "type": "tick", "t": round(now - t0, 1), "ts": now,
        "ok": len(ok), "fail": len(recs) - len(ok),
        "mean_ms": round(statistics.mean(lat), 1) if lat else None,
        "p95_ms": round(percentile(lat, 0.95), 1) if lat else None,
        "rps": len(recs), "backends": backends,
    }
    tick.update(state)
    return tick, lat


# ─────────────────────────────── real (Mininet) world ───────────────────────────────
class RealWorld:
    simulated = False

    def __init__(self, args, tracker):
        self.args = args
        self.tr = tracker
        self.algo = args.algo
        self.slow = bool(args.slow)
        self.uplink = args.uplink
        self.attack_proc = None
        self.attack_kind = None
        self.attack_started = 0
        self.last_window = {}
        self.flagged = set()
        self.legit = []
        self.logs = []

    # -- setup / teardown
    def setup(self):
        try:
            import joblib  # noqa: F401
            import numpy  # noqa: F401
            import sklearn  # noqa: F401
        except ImportError as e:
            raise RuntimeError("root Python cannot import scikit-learn/joblib/numpy (%s). "
                               "Run: sudo pip3 install scikit-learn joblib numpy" % e)
        if not os.path.exists(os.path.join(HERE, "model_lab.joblib")):
            raise RuntimeError("model_lab.joblib not found next to lab_session.py (run train_lab_model.py)")
        from mininet.log import setLogLevel
        from detector import Detector
        from topo import build, start_servers
        setLogLevel("warning")
        self._kill_leftovers()
        subprocess.run(["mn", "-c"], stdout=DEVNULL, stderr=DEVNULL)
        self.net = build()
        self.net.start()
        self.srv_procs = start_servers(self.net)
        self.lb = self.net.get("lb")
        self.client = self.net.get("client")
        self.attacker = self.net.get("attacker")
        self.srv1 = self.net.get("srv1")
        if self.uplink:
            for link in self.net.linksBetween(self.lb, self.net.get("s1")):
                link.intf1.config(bw=self.uplink)
                link.intf2.config(bw=self.uplink)
        if self.slow:
            self.srv1.intf().config(bw=100, delay="100ms")
        if os.path.exists(PIDFILE):
            os.remove(PIDFILE)
        self._apply_algo(self.algo)
        self.det = Detector(self.lb, mode=self.args.defence,
                            on_window=self._on_window, on_block=self._on_block)
        self.det.start()
        for k in range(3):
            log = "/tmp/legit_lab_%d.txt" % k
            open(log, "w").close()
            self.logs.append(log)
            self.legit.append(self.client.popen(
                ["bash", "-c", LEGIT_LOOP.replace("LOGFILE", log)], stdout=DEVNULL, stderr=DEVNULL))
        self.tail = LogTail(self.logs)
        time.sleep(1.5)

    def _kill_leftovers(self):
        for name in ("hping3", "curl", "tcpdump", "haproxy"):
            subprocess.run(["pkill", "-x", name], stdout=DEVNULL, stderr=DEVNULL)

    def teardown(self):
        for p in self.legit:
            p.terminate()
        if self.attack_proc and self.attack_proc.poll() is None:
            self.attack_proc.terminate()
        try:
            self.det.stop()
        except Exception:
            pass
        self._kill_leftovers()
        for p in getattr(self, "srv_procs", []):
            p.terminate()
        try:
            self.net.stop()
        except Exception:
            pass

    # -- HAProxy
    def _apply_algo(self, algo):
        text = open(os.path.join(HERE, "haproxy.cfg")).read()
        text = re.sub(r"balance\s+\w+", "balance %s" % algo, text)
        cfg = "/tmp/haproxy_lab_%s.cfg" % algo
        open(cfg, "w").write(text)
        chk = self.lb.cmd("haproxy -c -f %s" % cfg)
        if "valid" not in chk.lower():
            raise RuntimeError("haproxy config invalid: " + chk.strip())
        if os.path.exists(PIDFILE) and os.path.getsize(PIDFILE) > 0:
            self.lb.cmd("haproxy -f %s -D -p %s -sf $(cat %s)" % (cfg, PIDFILE, PIDFILE))
        else:
            self.lb.cmd("haproxy -f %s -D -p %s" % (cfg, PIDFILE))
        time.sleep(1.0)
        self.algo = algo

    # -- detector callbacks (run in the detector thread)
    def _on_window(self, w):
        self.last_window[w["src"]] = dict(w, ts=time.time())
        emit(dict(w, type="detector", ts=time.time()))
        if w["action"] == "flagged" and w["src"] not in self.flagged:
            self.flagged.add(w["src"])
            emit_event("flagged", "Detector flagged %s as ATTACK (%d pkts/s, score %.2f) - monitor mode, not blocking"
                       % (w["src"], w["pkts"], w["score"]), "warn")

    def _on_block(self, src, score, pkts):
        self.tr.blocked(time.time())
        emit_event("blocked", "BLOCKED %s at switch s1 (%d pkts/s, score %.2f)" % (src, pkts, score), "alert")

    # -- commands
    def handle(self, cmd):
        c = cmd.get("cmd")
        if c == "attack_start":
            if self.attack_proc and self.attack_proc.poll() is None:
                emit_event("info", "An attack is already running", "warn")
                return
            kind = cmd.get("attack", "udp")
            if kind not in ATTACKS:
                return
            length = max(5, min(int(cmd.get("length", 30)), 120))
            self.flagged.clear()
            self.attack_kind = kind
            self.attack_started = time.time()
            self.tr.start(self.attack_started, self._cfg())
            self.attack_proc = self.attacker.popen(["timeout", str(length)] + ATTACKS[kind],
                                                   stdout=DEVNULL, stderr=DEVNULL)
            emit_event("attack_started", "%s flood launched from attacker (10.0.0.2) for %d s" % (kind.upper(), length), "alert")
        elif c == "attack_stop":
            if self.attack_proc and self.attack_proc.poll() is None:
                self.attack_proc.terminate()
                subprocess.run(["pkill", "-x", "hping3"], stdout=DEVNULL, stderr=DEVNULL)
        elif c == "set_algo" and cmd.get("algo") in ("roundrobin", "leastconn"):
            self._apply_algo(cmd["algo"])
            emit_event("algo_changed", "Load-balancing algorithm switched to %s" % self.algo, "info")
        elif c == "set_slow":
            self.slow = bool(cmd.get("on"))
            self.srv1.intf().config(bw=100, delay="100ms" if self.slow else "0ms")
            emit_event("slow_changed", "srv1 is now %s" % ("SLOW (+100 ms)" if self.slow else "back to normal speed"), "info")
        elif c == "set_defence" and cmd.get("mode") in ("off", "monitor", "protect"):
            self.det.mode = cmd["mode"]
            self.tr.set_defence(cmd["mode"], time.time())
            if cmd["mode"] != "protect" and self.det.blocked:
                self.det.release()
                emit_event("unblocked", "Block rules removed (defence mode changed)", "info")
            self.flagged.clear()
            emit_event("defence_changed", "Defence mode set to %s" % cmd["mode"].upper(), "info")
        elif c == "unblock":
            self.det.release()
            emit_event("unblocked", "Block rules removed", "info")

    def _cfg(self):
        return {"attack": self.attack_kind, "algo": self.algo, "defence": self.det.mode,
                "uplink": self.uplink, "slow": self.slow, "simulated": False}

    # -- one second
    def tick(self, t0, now):
        recs = self.tail.read_new()
        state = self._state()
        tick, lat = make_tick(t0, now, recs, haproxy_stats(), state)
        self.tr.on_tick(now, tick["ok"], tick["fail"], lat)
        if self.attack_proc is not None and self.attack_proc.poll() is not None:
            self.attack_proc = None
            ep = self.tr.finish(now)
            emit(ep)
            emit_event("attack_stopped", "Attack ended after %.0f s" % ep["length_s"], "info")
            if self.det.blocked:
                self.det.release()
                emit_event("unblocked", "Attacker released after the attack ended (ready for the next run)", "info")
        return tick

    def _state(self):
        now = time.time()
        w = self.last_window.get(ATTACKER_IP)
        pps = w["pkts"] if w and now - w["ts"] < 3 and ATTACKER_IP not in self.det.blocked else None
        return {"algo": self.algo, "slow": self.slow, "defence": self.det.mode, "uplink": self.uplink,
                "attack": self.attack_proc is not None, "blocked": sorted(self.det.blocked),
                "attacker_pps": pps, "simulated": False}


# ─────────────────────────────── simulated world ───────────────────────────────
class SimWorld:
    """Crude model that speaks the same protocol. For previewing the dashboard only."""
    simulated = True

    def __init__(self, args, tracker):
        self.tr = tracker
        self.algo = args.algo
        self.slow = bool(args.slow)
        self.mode = args.defence
        self.uplink = args.uplink
        self.rng = random.Random(7)
        self.share = [1 / 3.0] * 3
        self.attack_kind = None
        self.attack_end = 0.0
        self.attack_start_t = 0.0
        self.blocked = set()
        self.totals = [0, 0, 0]
        self.flagged = False

    def setup(self):
        time.sleep(0.5)

    def teardown(self):
        pass

    def _cfg(self):
        return {"attack": self.attack_kind, "algo": self.algo, "defence": self.mode,
                "uplink": self.uplink, "slow": self.slow, "simulated": True}

    def handle(self, cmd):
        c = cmd.get("cmd")
        now = time.time()
        if c == "attack_start" and self.attack_end <= now and cmd.get("attack") in ATTACKS:
            length = max(5, min(int(cmd.get("length", 30)), 120))
            self.attack_kind = cmd["attack"]
            self.attack_start_t = now
            self.attack_end = now + length
            self.flagged = False
            self.tr.start(now, self._cfg())
            emit_event("attack_started", "%s flood launched from attacker (10.0.0.2) for %d s [simulated]"
                       % (self.attack_kind.upper(), length), "alert")
        elif c == "attack_stop":
            self.attack_end = 0.0
        elif c == "set_algo" and cmd.get("algo") in ("roundrobin", "leastconn"):
            self.algo = cmd["algo"]
            emit_event("algo_changed", "Load-balancing algorithm switched to %s" % self.algo, "info")
        elif c == "set_slow":
            self.slow = bool(cmd.get("on"))
            emit_event("slow_changed", "srv1 is now %s" % ("SLOW (+100 ms)" if self.slow else "back to normal speed"), "info")
        elif c == "set_defence" and cmd.get("mode") in ("off", "monitor", "protect"):
            self.mode = cmd["mode"]
            self.tr.set_defence(self.mode, now)
            if self.mode != "protect":
                self.blocked.clear()
            self.flagged = False
            emit_event("defence_changed", "Defence mode set to %s" % self.mode.upper(), "info")
        elif c == "unblock":
            self.blocked.clear()
            emit_event("unblocked", "Block rules removed", "info")

    def tick(self, t0, now):
        target = [1 / 3.0] * 3
        if self.algo == "leastconn" and self.slow:
            target = [0.03, 0.485, 0.485]
        self.share = [s + 0.35 * (t - s) for s, t in zip(self.share, target)]
        base = 3.0 + (100.0 * self.share[0] if self.slow else 0.0)
        attacking = self.attack_kind is not None and now < self.attack_end
        if self.tr.active and not attacking:
            ep = self.tr.finish(now)
            emit(ep)
            emit_event("attack_stopped", "Attack ended after %.0f s [simulated]" % ep["length_s"], "info")
            if self.blocked:
                self.blocked.clear()
                emit_event("unblocked", "Attacker released after the attack ended (ready for the next run)", "info")
        effective = attacking and ATTACKER_IP not in self.blocked
        if effective and self.uplink <= 20:
            mean, n = base + 260 + self.rng.gauss(0, 25), self.rng.randint(7, 12)
        elif effective:
            mean, n = base + 1.2, self.rng.randint(26, 30)
        else:
            mean, n = base, self.rng.randint(28, 32)
        recs = []
        for _ in range(n):
            r = self.rng.random()
            acc, srv = 0.0, "srv3"
            for i, sh in enumerate(self.share):
                acc += sh
                if r <= acc:
                    srv = SERVERS[i]
                    break
            recs.append({"ts": now, "srv": srv, "code": "200",
                         "ms": max(0.5, self.rng.gauss(mean, mean * 0.12))})
        if attacking and self.mode != "off" and ATTACKER_IP not in self.blocked:
            pps = self.rng.randint(900, 1600)
            action = "none"
            if now - self.attack_start_t >= 1.0:
                if self.mode == "protect":
                    self.blocked.add(ATTACKER_IP)
                    action = "blocked"
                    self.tr.blocked(now)
                    emit_event("blocked", "BLOCKED %s at switch s1 (%d pkts/s, score 1.00) [simulated]" % (ATTACKER_IP, pps), "alert")
                elif not self.flagged:
                    self.flagged = True
                    action = "flagged"
                    emit_event("flagged", "Detector flagged %s as ATTACK (%d pkts/s) - monitor mode, not blocking [simulated]"
                               % (ATTACKER_IP, pps), "warn")
            syn = self.attack_kind == "syn"
            emit({"type": "detector", "ts": now, "src": ATTACKER_IP, "pkts": pps, "bytes": pps * (0 if syn else 1000),
                  "mean_len": 0.0 if syn else 1000.0, "syn_ratio": 1.0 if syn else 0.0,
                  "score": round(self.rng.uniform(0.97, 1.0), 3),
                  "verdict": "attack", "action": action})
        if self.mode != "off":
            emit({"type": "detector", "ts": now, "src": CLIENT_IP, "pkts": self.rng.randint(25, 70),
                  "bytes": 2000, "mean_len": 20.0, "syn_ratio": 0.2,
                  "score": round(self.rng.uniform(0.0, 0.05), 3), "verdict": "normal", "action": "none"})
        for i, r in enumerate(recs):
            self.totals[SERVERS.index(r["srv"])] += 1
        haproxy = {s: {"active": max(0, int(self.rng.gauss(2 + (6 if (i == 0 and self.slow and self.algo == "roundrobin") else 0), 1))),
                       "total": self.totals[i], "up": True} for i, s in enumerate(SERVERS)}
        state = {"algo": self.algo, "slow": self.slow, "defence": self.mode, "uplink": self.uplink,
                 "attack": attacking, "blocked": sorted(self.blocked),
                 "attacker_pps": (self.rng.randint(900, 1600) if effective and self.mode != "off" else (self.rng.randint(900, 1600) if effective else None)),
                 "simulated": True}
        tick, lat = make_tick(t0, now, recs, haproxy, state)
        self.tr.on_tick(now, tick["ok"], tick["fail"], lat)
        return tick


# ─────────────────────────────────── main ───────────────────────────────────
def stdin_reader(q):
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            q.put(json.loads(line))
        except ValueError:
            pass
    q.put({"cmd": "stop"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--algo", default="roundrobin", choices=["roundrobin", "leastconn"])
    ap.add_argument("--defence", default="off", choices=["off", "monitor", "protect"])
    ap.add_argument("--uplink", type=int, default=10)
    ap.add_argument("--slow", type=int, default=0)
    ap.add_argument("--simulate", action="store_true")
    args = ap.parse_args()

    emit({"type": "status", "phase": "starting", "simulated": args.simulate,
          "msg": "Building the lab..." if not args.simulate else "Starting simulation (no Mininet)",
          "config": {"algo": args.algo, "defence": args.defence, "uplink": args.uplink, "slow": bool(args.slow)}})
    tracker = EpisodeTracker()
    world = SimWorld(args, tracker) if args.simulate else RealWorld(args, tracker)
    try:
        world.setup()
    except Exception as e:  # report the reason to the dashboard instead of just dying
        emit({"type": "status", "phase": "error", "simulated": args.simulate, "msg": str(e)})
        try:
            world.teardown()
        except Exception:
            pass
        return 1
    q = queue.Queue()
    threading.Thread(target=stdin_reader, args=(q,), daemon=True).start()
    emit({"type": "status", "phase": "ready", "simulated": args.simulate, "msg": "Lab is running",
          "config": {"algo": args.algo, "defence": args.defence, "uplink": args.uplink, "slow": bool(args.slow)}})
    emit_event("ready", "Lab is up: 3 legitimate clients are sending requests through HAProxy (%s)" % args.algo, "ok")

    t0 = time.time()
    next_tick = t0 + 1.0
    running = True
    try:
        while running:
            time.sleep(max(0.0, next_tick - time.time()))
            next_tick += 1.0
            while True:
                try:
                    cmd = q.get_nowait()
                except queue.Empty:
                    break
                if cmd.get("cmd") == "stop":
                    running = False
                else:
                    try:
                        world.handle(cmd)
                    except Exception as e:
                        emit_event("error", "Command failed: %s" % e, "warn")
            if running:
                emit(world.tick(t0, time.time()))
    finally:
        emit({"type": "status", "phase": "stopping", "simulated": args.simulate, "msg": "Cleaning up..."})
        world.teardown()
        emit({"type": "status", "phase": "stopped", "simulated": args.simulate, "msg": "Lab stopped"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
