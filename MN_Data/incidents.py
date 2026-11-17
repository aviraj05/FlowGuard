"""
FlowGuard incident manager (used by lab_agent.py).

Turns the raw lab stream (detector windows, events, ticks, episodes) into
incidents: one per attacking source, from first detection until the attack
ends. Each incident carries a plain-English summary, a timeline, evidence,
impact numbers and the list of notifications sent for it.

Pure standard library, Python 3.8 compatible.
"""
import json
import os
import re
import statistics
import threading
import time
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
DEVICES_FILE = os.path.join(HERE, "devices.json")
INCIDENTS_FILE = os.path.join(HERE, "incidents.json")

IP_RE = re.compile(r"(\d+\.\d+\.\d+\.\d+)")
ATTACK_NAMES = {"udp": "UDP flood", "syn": "SYN flood", "icmp": "ICMP flood", "scan": "Port scan"}

DEFAULT_DEVICES = [
    {"ip": "10.0.0.1", "host": "client", "name": "Student laptop", "role": "client",
     "location": "Hostel Wi-Fi", "owner": "Students", "critical": False},
    {"ip": "10.0.0.2", "host": "attacker", "name": "Lab-3 PC-14", "role": "workstation",
     "location": "Computer Lab 3", "owner": "CS Department", "critical": False},
    {"ip": "10.0.0.10", "host": "lb", "name": "Campus gateway", "role": "gateway",
     "location": "Server room", "owner": "IT Services", "critical": True},
    {"ip": "10.0.0.11", "host": "srv1", "name": "Exam portal", "role": "server",
     "location": "Server room", "owner": "Exam Cell", "critical": True},
    {"ip": "10.0.0.12", "host": "srv2", "name": "ERP", "role": "server",
     "location": "Server room", "owner": "Admin Office", "critical": True},
    {"ip": "10.0.0.13", "host": "srv3", "name": "LMS", "role": "server",
     "location": "Server room", "owner": "Academics", "critical": False},
]


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(data, f, indent=1)
        os.replace(tmp, path)
    except OSError:
        pass


class Devices:
    def __init__(self):
        data = load_json(DEVICES_FILE, None)
        if not isinstance(data, list) or not data:
            data = [dict(d) for d in DEFAULT_DEVICES]
            save_json(DEVICES_FILE, data)
        self.items = data

    def by_ip(self, ip):
        for d in self.items:
            if d.get("ip") == ip:
                return d
        return None

    def name(self, ip):
        d = self.by_ip(ip)
        return d["name"] if d else ip

    def save(self, items):
        clean = []
        for d in items:
            if not isinstance(d, dict) or not d.get("ip"):
                continue
            clean.append({
                "ip": str(d.get("ip")), "host": str(d.get("host", "")),
                "name": str(d.get("name") or d.get("ip")), "role": str(d.get("role", "")),
                "location": str(d.get("location", "")), "owner": str(d.get("owner", "")),
                "critical": bool(d.get("critical", False)),
            })
        if clean:
            self.items = clean
            save_json(DEVICES_FILE, clean)
        return self.items


def severity_for(pps):
    if pps is None:
        return "medium"
    if pps >= 1200:
        return "critical"
    if pps >= 500:
        return "high"
    return "medium"


def fmt_ms(v):
    if v is None:
        return "n/a"
    return "%d ms" % round(v) if v >= 10 else "%.1f ms" % v


def build_summary(inc):
    """One plain-English paragraph, shared by the dashboard, email and Telegram."""
    ev = inc["evidence"]
    src = "%s (%s)" % (inc["src_name"], inc["src"])
    kind = ATTACK_NAMES.get(inc["kind"], "Traffic flood")
    parts = []
    rate = ev.get("peak_pps")
    if rate:
        s = "%s sent about %s packets/s of %s traffic at the %s" % (
            src, format(int(rate), ","), kind.split()[0], inc["target_name"])
        ratio = ev.get("ratio")
        if ratio and ratio >= 2:
            s += ", roughly %dx its normal rate" % round(ratio)
        parts.append(s + ".")
    else:
        parts.append("%s was detected sending a %s at the %s." % (src, kind.lower(), inc["target_name"]))
    if inc.get("blocked_at"):
        delay = inc["impact"].get("detect_delay_s")
        if delay is not None:
            parts.append("FlowGuard blocked it at the switch %.1f s after the attack began." % delay)
        else:
            parts.append("FlowGuard blocked it at the switch.")
    elif inc["mode"] == "monitor":
        parts.append("Protection is in monitor mode, so the source was flagged but not blocked.")
    imp = inc["impact"]
    if imp.get("attack_ms") is not None and imp.get("baseline_ms") is not None:
        s = "Response time for users went from %s to %s during the attack" % (
            fmt_ms(imp["baseline_ms"]), fmt_ms(imp["attack_ms"]))
        if imp.get("after_ms") is not None:
            s += " and was back to %s after the block" % fmt_ms(imp["after_ms"])
        parts.append(s + ".")
    if inc["status"] == "resolved":
        parts.append("The attack has ended.")
    return " ".join(parts)


class IncidentManager:
    """Fed by Hub.publish(); calls on_change(incident, what) when something happens."""

    def __init__(self, devices, on_change):
        self.devices = devices
        self.on_change = on_change
        self.lock = threading.RLock()
        data = load_json(INCIDENTS_FILE, [])
        self.items = data if isinstance(data, list) else []
        self.seq = max([i.get("seq", 1000) for i in self.items] + [1000])
        self.recent_ticks = deque(maxlen=15)
        self.normal_pps = deque(maxlen=60)
        self.attack_kind = None
        self.attack_started = None
        self.mode = "off"
        self.simulated = False

    # ---------- helpers
    def _save(self):
        save_json(INCIDENTS_FILE, self.items[-200:])

    def _open_for(self, src):
        for inc in reversed(self.items):
            if inc["src"] == src and inc["status"] != "resolved":
                return inc
        return None

    def _open_any(self):
        return [i for i in self.items if i["status"] != "resolved"]

    def get(self, inc_id):
        for inc in self.items:
            if inc["id"] == inc_id:
                return inc
        return None

    def _touch(self, inc, what):
        inc["summary"] = build_summary(inc)
        inc["updated"] = time.time()
        self._save()
        self.on_change(inc, what)

    def add_timeline(self, inc, kind, text, ts=None):
        inc["timeline"].append({"ts": ts or time.time(), "kind": kind, "text": text})

    def _new(self, src, ts, level):
        self.seq += 1
        normal = statistics.mean(self.normal_pps) if self.normal_pps else None
        target = self.devices.by_ip("10.0.0.10")
        inc = {
            "id": "INC-%d" % self.seq, "seq": self.seq,
            "src": src, "src_name": self.devices.name(src),
            "target": "10.0.0.10", "target_name": target["name"] if target else "load balancer",
            "kind": self.attack_kind or "udp",
            "severity": "medium", "status": "active", "mode": self.mode,
            "simulated": self.simulated, "opened": ts, "updated": ts,
            "attack_started": self.attack_started,
            "blocked_at": None, "resolved_at": None, "ack_by": None, "ack_at": None,
            "false_positive": False,
            "evidence": {"peak_pps": None, "normal_pps": round(normal, 1) if normal else None,
                         "ratio": None, "score": None, "mean_len": None, "syn_ratio": None,
                         "windows": 0},
            "impact": {"baseline_ms": None, "attack_ms": None, "attack_p95_ms": None,
                       "after_ms": None, "detect_delay_s": None, "completed": None, "failed": None},
            "timeline": [], "notifications": [],
            "series": [[t["ts"], t.get("mean_ms")] for t in self.recent_ticks],
            "summary": "",
        }
        if self.attack_started:
            self.add_timeline(inc, "traffic", "Unusual traffic started from %s" % inc["src_name"], self.attack_started)
        self.add_timeline(inc, "detected", "Detector classified %s as ATTACK" % inc["src_name"], ts)
        self.items.append(inc)
        return inc

    # ---------- stream input
    def feed(self, obj):
        t = obj.get("type")
        with self.lock:
            if t == "status":
                cfg = obj.get("config") or {}
                if cfg.get("defence"):
                    self.mode = cfg["defence"]
                self.simulated = bool(obj.get("simulated"))
                if obj.get("phase") in ("stopped", "error"):
                    for inc in self._open_any():
                        self._resolve(inc, "Monitoring session stopped")
            elif t == "tick":
                self.recent_ticks.append(obj)
                self.mode = obj.get("defence", self.mode)
                for inc in self._open_any():
                    inc["series"].append([obj["ts"], obj.get("mean_ms")])
                    inc["series"] = inc["series"][-150:]
            elif t == "detector":
                self._on_window(obj)
            elif t == "event":
                self._on_event(obj)
            elif t == "episode":
                self._on_episode(obj)

    def _on_window(self, w):
        src = w.get("src")
        if w.get("verdict") == "normal":
            if w.get("pkts") is not None:
                self.normal_pps.append(w["pkts"])
            return
        inc = self._open_for(src)
        if inc is None:
            return
        ev = inc["evidence"]
        ev["windows"] += 1
        if ev["peak_pps"] is None or w["pkts"] >= ev["peak_pps"] or ev["mean_len"] is None:
            ev["peak_pps"] = max(w["pkts"], ev["peak_pps"] or 0)
            ev["mean_len"] = w.get("mean_len")
            ev["syn_ratio"] = w.get("syn_ratio")
        ev["score"] = max(ev["score"] or 0, w.get("score") or 0)
        if ev["normal_pps"]:
            ev["ratio"] = round(ev["peak_pps"] / max(ev["normal_pps"], 1), 1)
        sev = severity_for(ev["peak_pps"])
        if ["medium", "high", "critical"].index(sev) > ["medium", "high", "critical"].index(inc["severity"]):
            inc["severity"] = sev
        inc["summary"] = build_summary(inc)

    def _on_event(self, e):
        kind = e.get("kind")
        ts = e.get("ts") or time.time()
        if kind == "attack_started":
            first = (e.get("msg") or "").split(" ")[0].lower()
            self.attack_kind = first if first in ATTACK_NAMES else "udp"
            self.attack_started = ts
            return
        if kind in ("blocked", "flagged"):
            m = IP_RE.search(e.get("msg") or "")
            if not m:
                return
            src = m.group(1)
            pps_m = re.search(r"\((\d+) pkts/s", e.get("msg") or "")
            inc = self._open_for(src)
            created = inc is None
            if created:
                inc = self._new(src, ts, e.get("level"))
            if pps_m:
                pps = int(pps_m.group(1))
                ev = inc["evidence"]
                if ev["peak_pps"] is None or pps > ev["peak_pps"]:
                    ev["peak_pps"] = pps
                if ev["normal_pps"]:
                    ev["ratio"] = round(ev["peak_pps"] / max(ev["normal_pps"], 1), 1)
                inc["severity"] = severity_for(ev["peak_pps"])
            if kind == "blocked" and not inc["blocked_at"]:
                inc["blocked_at"] = ts
                inc["status"] = "contained"
                inc["mode"] = "protect"
                if inc.get("attack_started"):
                    inc["impact"]["detect_delay_s"] = round(ts - inc["attack_started"], 2)
                self.add_timeline(inc, "blocked", "Blocked %s with a drop rule on switch s1" % inc["src_name"], ts)
            elif kind == "flagged":
                inc["mode"] = "monitor"
            self._touch(inc, "opened" if created else "updated")
        elif kind == "unblocked":
            for inc in self._open_any():
                if inc["blocked_at"]:
                    self.add_timeline(inc, "unblocked", "Block rule removed", ts)
                    self._touch(inc, "updated")

    def _on_episode(self, ep):
        targets = self._open_any()
        if not targets:
            return
        for inc in targets:
            imp = inc["impact"]
            for k in ("baseline_ms", "attack_ms", "attack_p95_ms", "after_ms", "completed", "failed"):
                imp[k] = ep.get(k)
            if ep.get("detect_delay_s") is not None:
                imp["detect_delay_s"] = ep["detect_delay_s"]
            self._resolve(inc, "Attack ended after %.0f s" % (ep.get("length_s") or 0), ts=ep.get("ts"))
        self.attack_kind = None
        self.attack_started = None

    def _resolve(self, inc, reason, ts=None):
        if inc["status"] == "resolved":
            return
        ts = ts or time.time()
        inc["status"] = "resolved"
        inc["resolved_at"] = ts
        self.add_timeline(inc, "resolved", reason, ts)
        self._touch(inc, "resolved")

    # ---------- user actions
    def action(self, inc_id, action, who="Dashboard"):
        with self.lock:
            inc = self.get(inc_id)
            if inc is None:
                return None, "Incident not found"
            if action == "ack":
                if not inc["ack_at"]:
                    inc["ack_at"] = time.time()
                    inc["ack_by"] = who
                    self.add_timeline(inc, "ack", "Acknowledged by %s" % who)
            elif action == "false_positive":
                inc["false_positive"] = True
                self.add_timeline(inc, "false_positive", "Marked as a false positive by %s" % who)
            elif action == "unblock":
                self.add_timeline(inc, "unblock_request", "Unblock requested by %s" % who)
            elif action == "resolve":
                self._resolve(inc, "Resolved manually by %s" % who)
                return inc, "OK"
            else:
                return None, "Unknown action"
            self._touch(inc, "updated")
            return inc, "OK"

    def clear(self):
        with self.lock:
            self.items = []
            self._save()

    def list(self):
        with self.lock:
            return list(self.items)
