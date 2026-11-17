"""
FlowGuard notifier (used by lab_agent.py).

Sends incident alerts to stakeholders by email (SMTP) and Telegram, routed by
severity, once per incident, plus a "resolved" follow-up. Telegram messages
carry Acknowledge / Unblock buttons that act on the incident.

Configuration
  notify_config.json   stakeholders, their channels and the severities they get
                       (edited from the dashboard: Settings > Notifications)
  .env                 secrets, never committed:
                         SMTP_HOST=smtp.gmail.com   SMTP_PORT=587
                         SMTP_USER=you@gmail.com    SMTP_PASS=<16-char app password>
                         SMTP_FROM=FlowGuard <you@gmail.com>       (optional)
                         TELEGRAM_BOT_TOKEN=123456:ABC...
                         DASHBOARD_URL=http://localhost:5173       (optional)

Pure standard library, Python 3.8 compatible.
"""
import json
import os
import smtplib
import threading
import time
import urllib.parse
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape

from incidents import ATTACK_NAMES, fmt_ms, load_json, save_json

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(HERE, "notify_config.json")
LOG_FILE = os.path.join(HERE, "notify_log.json")
ENV_FILE = os.path.join(HERE, ".env")

SEVERITIES = ["critical", "high", "medium"]
SEV_COLOR = {"critical": "#F0565B", "high": "#F0883E", "medium": "#E3B341"}

DEFAULT_CONFIG = {
    "stakeholders": [
        {"id": "it-admin", "name": "IT Admin (on-call)", "role": "IT admin",
         "email": "", "telegram_chat_id": "", "channels": ["email", "telegram"],
         "severities": ["critical", "high", "medium"], "resolved": True, "weekly_report": False},
        {"id": "exam-cell", "name": "Exam Cell", "role": "Service owner",
         "email": "", "telegram_chat_id": "", "channels": ["email"],
         "severities": ["critical"], "resolved": True, "weekly_report": False},
        {"id": "security-lead", "name": "Network & Security Lead", "role": "Security lead",
         "email": "", "telegram_chat_id": "", "channels": ["email"],
         "severities": ["critical", "high"], "resolved": False, "weekly_report": True},
        {"id": "management", "name": "Principal's Office", "role": "Management",
         "email": "", "telegram_chat_id": "", "channels": ["email"],
         "severities": [], "resolved": False, "weekly_report": True},
    ],
    "in_app": True,
}


def load_env():
    env = {}
    try:
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    for k in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
              "TELEGRAM_BOT_TOKEN", "DASHBOARD_URL"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


def fmt_time(ts):
    return time.strftime("%d %b %Y, %H:%M:%S", time.localtime(ts)) if ts else "-"


class Notifier:
    def __init__(self, publish, incident_action):
        """publish(obj) pushes a message to dashboards; incident_action(id, action, who) acts on incidents."""
        self.publish = publish
        self.incident_action = incident_action
        self.env = load_env()
        cfg = load_json(CONFIG_FILE, None)
        if not isinstance(cfg, dict) or "stakeholders" not in cfg:
            cfg = json.loads(json.dumps(DEFAULT_CONFIG))
            save_json(CONFIG_FILE, cfg)
        self.config = cfg
        log = load_json(LOG_FILE, [])
        self.log = log if isinstance(log, list) else []
        self.lock = threading.Lock()
        self.sent = {}  # incident id -> set of "opened"/"resolved" already handled
        self.bot_name = None
        self._tg_offset = 0
        if self.telegram_ready():
            threading.Thread(target=self._telegram_loop, daemon=True).start()

    # ---------- status / config
    def email_ready(self):
        return bool(self.env.get("SMTP_USER") and self.env.get("SMTP_PASS"))

    def telegram_ready(self):
        return bool(self.env.get("TELEGRAM_BOT_TOKEN"))

    def dashboard_url(self):
        return (self.env.get("DASHBOARD_URL") or "http://localhost:5173").rstrip("/")

    def public_config(self):
        return {
            "stakeholders": self.config.get("stakeholders", []),
            "in_app": self.config.get("in_app", True),
            "channels": {
                "email": {"configured": self.email_ready(),
                          "sender": self.env.get("SMTP_FROM") or self.env.get("SMTP_USER") or None},
                "telegram": {"configured": self.telegram_ready(), "bot": self.bot_name},
                "in_app": {"configured": True},
            },
        }

    def save_config(self, body):
        st = body.get("stakeholders")
        if not isinstance(st, list):
            return False, "stakeholders must be a list"
        clean = []
        for i, s in enumerate(st):
            if not isinstance(s, dict):
                continue
            clean.append({
                "id": str(s.get("id") or "s%d" % i), "name": str(s.get("name") or "Stakeholder"),
                "role": str(s.get("role") or ""), "email": str(s.get("email") or "").strip(),
                "telegram_chat_id": str(s.get("telegram_chat_id") or "").strip(),
                "channels": [c for c in s.get("channels", []) if c in ("email", "telegram")],
                "severities": [v for v in s.get("severities", []) if v in SEVERITIES],
                "resolved": bool(s.get("resolved")), "weekly_report": bool(s.get("weekly_report")),
            })
        self.config["stakeholders"] = clean
        if "in_app" in body:
            self.config["in_app"] = bool(body["in_app"])
        save_json(CONFIG_FILE, self.config)
        return True, "Saved"

    # ---------- log
    def _record(self, entry, inc=None):
        entry.setdefault("ts", time.time())
        with self.lock:
            self.log.append(entry)
            self.log = self.log[-300:]
            save_json(LOG_FILE, self.log)
        if inc is not None:
            inc.setdefault("notifications", []).append(entry)
        self.publish({"type": "notification", "entry": entry})

    # ---------- incident hooks (called by the agent)
    def on_incident(self, inc, what):
        if what not in ("opened", "resolved"):
            return
        done = self.sent.setdefault(inc["id"], set())
        if what in done:
            return
        done.add(what)
        recipients = []
        for s in self.config.get("stakeholders", []):
            if what == "opened" and inc["severity"] in s.get("severities", []):
                recipients.append(s)
            elif (what == "resolved" and s.get("resolved") and "opened" in done
                  and inc["severity"] in s.get("severities", [])):
                recipients.append(s)
        if self.config.get("in_app", True):
            self._record({"incident": inc["id"], "event": what, "channel": "in_app",
                          "to": "Dashboard", "status": "sent", "detail": ""}, inc)
        if recipients:
            threading.Thread(target=self._deliver, args=(inc, what, recipients), daemon=True).start()

    def _deliver(self, inc, what, recipients):
        subject, text, html = self.compose(inc, what)
        for s in recipients:
            for ch in s.get("channels", []):
                entry = {"incident": inc["id"], "event": what, "channel": ch, "to": s["name"],
                         "stakeholder": s["id"]}
                ok, detail = self._send(ch, s, subject, text, html, inc if what == "opened" else None)
                entry.update(status="sent" if ok else ("skipped" if detail.startswith("Not configured") else "failed"),
                             detail=detail)
                self._record(entry, inc)
        self.publish({"type": "incident", "incident": inc})

    def _send(self, ch, s, subject, text, html, inc_for_buttons):
        try:
            if ch == "email":
                if not self.email_ready():
                    return False, "Not configured: add SMTP_USER and SMTP_PASS to MN_Data/.env"
                if not s.get("email"):
                    return False, "Not configured: no email address for this stakeholder"
                self.send_email(s["email"], subject, text, html)
                return True, s["email"]
            if ch == "telegram":
                if not self.telegram_ready():
                    return False, "Not configured: add TELEGRAM_BOT_TOKEN to MN_Data/.env"
                if not s.get("telegram_chat_id"):
                    return False, "Not configured: no Telegram chat ID (send /start to the bot)"
                buttons = None
                if inc_for_buttons is not None:
                    buttons = [[{"text": "Acknowledge", "callback_data": "ack:" + inc_for_buttons["id"]},
                                {"text": "Unblock source", "callback_data": "unblock:" + inc_for_buttons["id"]}]]
                self.send_telegram(s["telegram_chat_id"], self.telegram_text(subject, text), buttons)
                return True, "chat " + s["telegram_chat_id"]
            return False, "Unknown channel"
        except Exception as e:  # network, auth, bad address...
            return False, str(e)[:200]

    # ---------- composing
    def compose(self, inc, what):
        kind = ATTACK_NAMES.get(inc.get("kind"), "Traffic flood")
        sev = inc["severity"].upper()
        link = "%s/#/incidents/%s" % (self.dashboard_url(), inc["id"])
        if what == "resolved":
            subject = "[FlowGuard] Resolved: %s from %s (%s)" % (kind, inc["src_name"], inc["id"])
            headline = "Resolved: %s from %s" % (kind, inc["src_name"])
        else:
            action = "blocked" if inc.get("blocked_at") else "detected"
            subject = "[FlowGuard] %s: %s %s from %s (%s)" % (sev, kind, action, inc["src_name"], inc["id"])
            headline = "%s %s from %s" % (kind, action, inc["src_name"])
        imp = inc.get("impact", {})
        ev = inc.get("evidence", {})
        rows = [
            ("Incident", inc["id"] + (" (simulated drill)" if inc.get("simulated") else "")),
            ("Severity", sev),
            ("Source", "%s (%s)" % (inc["src_name"], inc["src"])),
            ("Target", inc["target_name"]),
            ("Detected", fmt_time(inc.get("opened"))),
            ("Status", "Blocked at switch" if inc.get("blocked_at") and inc["status"] != "resolved"
             else ("Flagged, not blocked (monitor mode)" if inc["status"] == "active" else inc["status"].capitalize())),
        ]
        if ev.get("peak_pps"):
            rows.append(("Peak rate", "%s packets/s" % format(int(ev["peak_pps"]), ",")))
        if imp.get("detect_delay_s") is not None:
            rows.append(("Time to block", "%.1f s" % imp["detect_delay_s"]))
        if imp.get("attack_ms") is not None:
            rows.append(("Response time", "%s normal / %s during attack%s" % (
                fmt_ms(imp.get("baseline_ms")), fmt_ms(imp.get("attack_ms")),
                (" / %s after block" % fmt_ms(imp["after_ms"])) if imp.get("after_ms") is not None else "")))
        summary = inc.get("summary") or ""
        text = "%s\n\n%s\n\n%s\n\nOpen incident: %s\n" % (
            headline, summary, "\n".join("%s: %s" % r for r in rows), link)
        color = "#3FB950" if what == "resolved" else SEV_COLOR.get(inc["severity"], "#5AB8F0")
        row_html = "".join(
            '<tr><td style="padding:6px 12px 6px 0;color:#8B929C;white-space:nowrap">%s</td>'
            '<td style="padding:6px 0;color:#E6E8EB">%s</td></tr>' % (escape(k), escape(str(v))) for k, v in rows)
        html = (
            '<div style="background:#0D0F12;padding:24px;font-family:Inter,Segoe UI,Arial,sans-serif">'
            '<div style="max-width:560px;margin:0 auto;background:#14171C;border:1px solid #23272F;border-radius:12px;overflow:hidden">'
            '<div style="height:4px;background:%s"></div>'
            '<div style="padding:24px">'
            '<div style="font-size:12px;letter-spacing:.08em;color:#8B929C;text-transform:uppercase">FlowGuard alert</div>'
            '<div style="font-size:20px;font-weight:600;color:#E6E8EB;margin:6px 0 12px">%s</div>'
            '<p style="font-size:14px;line-height:1.6;color:#C9CDD3;margin:0 0 16px">%s</p>'
            '<table style="font-size:13px;border-collapse:collapse">%s</table>'
            '<a href="%s" style="display:inline-block;margin-top:20px;background:#E6E8EB;color:#0D0F12;'
            'text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:8px">Open incident</a>'
            '</div></div>'
            '<div style="max-width:560px;margin:12px auto 0;font-size:11px;color:#5C636E;text-align:center">'
            'Sent by FlowGuard because you are listed as a stakeholder for %s alerts.</div></div>'
        ) % (color, escape(headline), escape(summary), row_html, escape(link), escape(inc["severity"]))
        return subject, text, html

    def telegram_text(self, subject, text):
        lines = text.split("\n")
        head = "<b>%s</b>" % escape(subject.replace("[FlowGuard] ", ""))
        return "\U0001F6E1 " + head + "\n\n" + escape("\n".join(lines[2:]))

    # ---------- transports
    def send_email(self, to, subject, text, html):
        host = self.env.get("SMTP_HOST") or "smtp.gmail.com"
        port = int(self.env.get("SMTP_PORT") or 587)
        user, pw = self.env["SMTP_USER"], self.env["SMTP_PASS"].replace(" ", "")
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = self.env.get("SMTP_FROM") or "FlowGuard <%s>" % user
        msg["To"] = to
        msg.attach(MIMEText(text, "plain", "utf-8"))
        msg.attach(MIMEText(html, "html", "utf-8"))
        recipients = [a.strip() for a in to.split(",") if a.strip()]
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=20) as s:
                s.login(user, pw)
                s.sendmail(user, recipients, msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=20) as s:
                s.starttls()
                s.login(user, pw)
                s.sendmail(user, recipients, msg.as_string())

    def _tg(self, method, params, timeout=20):
        url = "https://api.telegram.org/bot%s/%s" % (self.env["TELEGRAM_BOT_TOKEN"], method)
        data = json.dumps(params).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            res = json.loads(r.read().decode())
        if not res.get("ok"):
            raise RuntimeError(res.get("description", "Telegram error"))
        return res.get("result")

    def send_telegram(self, chat_id, html_text, buttons=None):
        params = {"chat_id": chat_id, "text": html_text, "parse_mode": "HTML",
                  "disable_web_page_preview": True}
        if buttons:
            params["reply_markup"] = {"inline_keyboard": buttons}
        return self._tg("sendMessage", params)

    def _telegram_loop(self):
        """Long-polls Telegram: answers /start with the chat ID and handles alert buttons."""
        try:
            me = self._tg("getMe", {})
            self.bot_name = "@" + me.get("username", "")
        except Exception:
            pass
        while True:
            try:
                updates = self._tg("getUpdates", {"offset": self._tg_offset, "timeout": 25,
                                                  "allowed_updates": ["message", "callback_query"]}, timeout=35)
                for u in updates or []:
                    self._tg_offset = u["update_id"] + 1
                    if "message" in u:
                        m = u["message"]
                        chat = m.get("chat", {}).get("id")
                        if chat and (m.get("text") or "").startswith("/start"):
                            self.send_telegram(chat, "FlowGuard bot is connected.\nYour chat ID is <code>%s</code>.\n"
                                                     "Paste it into Settings &gt; Notifications in the dashboard." % chat)
                    elif "callback_query" in u:
                        self._on_button(u["callback_query"])
            except Exception:
                time.sleep(5)

    def _on_button(self, q):
        data = q.get("data") or ""
        who = q.get("from", {}).get("first_name") or "Telegram user"
        action, _, inc_id = data.partition(":")
        ok, msg = self.incident_action(inc_id, action, "%s (Telegram)" % who)
        reply = {"ack": "Acknowledged %s" % inc_id, "unblock": "Unblock sent for %s" % inc_id}.get(action, msg)
        try:
            self._tg("answerCallbackQuery", {"callback_query_id": q["id"], "text": reply if ok else msg})
            chat = q.get("message", {}).get("chat", {}).get("id")
            if ok and chat:
                self.send_telegram(chat, "✅ %s by %s" % (escape(reply), escape(who)))
        except Exception:
            pass

    # ---------- test & weekly report
    def send_test(self, stakeholder_id=None):
        sample = {
            "id": "INC-TEST", "severity": "critical", "kind": "udp", "src": "10.0.0.2",
            "src_name": "Lab-3 PC-14", "target_name": "Campus gateway", "opened": time.time(),
            "blocked_at": time.time(), "status": "contained", "simulated": True,
            "evidence": {"peak_pps": 1480},
            "impact": {"baseline_ms": 3.5, "attack_ms": 269.4, "after_ms": 7.1, "detect_delay_s": 1.18},
            "summary": "This is a test alert from FlowGuard. In a real incident this message explains what was "
                       "detected, what FlowGuard did about it and how users were affected.",
        }
        subject, text, html = self.compose(sample, "opened")
        subject = subject.replace("[FlowGuard]", "[FlowGuard TEST]")
        results = []
        for s in self.config.get("stakeholders", []):
            if stakeholder_id and s["id"] != stakeholder_id:
                continue
            for ch in s.get("channels", []):
                ok, detail = self._send(ch, s, subject, text, html, None)
                entry = {"incident": "TEST", "event": "test", "channel": ch, "to": s["name"],
                         "stakeholder": s["id"],
                         "status": "sent" if ok else ("skipped" if detail.startswith("Not configured") else "failed"),
                         "detail": detail}
                self._record(entry)
                results.append(entry)
        return results

    def send_weekly_report(self, incidents):
        week_ago = time.time() - 7 * 86400
        recent = [i for i in incidents if (i.get("opened") or 0) >= week_ago]
        blocked = [i for i in recent if i.get("blocked_at")]
        delays = sorted(i["impact"]["detect_delay_s"] for i in blocked if i["impact"].get("detect_delay_s") is not None)
        median = delays[len(delays) // 2] if delays else None
        offenders = {}
        for i in recent:
            offenders[i["src_name"]] = offenders.get(i["src_name"], 0) + 1
        top = sorted(offenders.items(), key=lambda x: -x[1])[:3]
        subject = "[FlowGuard] Weekly security report: %d incidents, %d blocked" % (len(recent), len(blocked))
        lines = [
            "Incidents this week: %d" % len(recent),
            "Blocked automatically: %d" % len(blocked),
            "Median time to block: %s" % ("%.1f s" % median if median is not None else "n/a"),
            "Most frequent sources: %s" % (", ".join("%s (%d)" % t for t in top) or "none"),
        ]
        text = "FlowGuard weekly report\n\n" + "\n".join(lines) + "\n\nDashboard: %s/#/reports\n" % self.dashboard_url()
        html = (
            '<div style="background:#0D0F12;padding:24px;font-family:Inter,Segoe UI,Arial,sans-serif">'
            '<div style="max-width:560px;margin:0 auto;background:#14171C;border:1px solid #23272F;border-radius:12px;padding:24px">'
            '<div style="font-size:12px;letter-spacing:.08em;color:#8B929C;text-transform:uppercase">FlowGuard weekly report</div>'
            '<div style="font-size:20px;font-weight:600;color:#E6E8EB;margin:6px 0 16px">%d incidents, %d blocked automatically</div>'
            '<ul style="color:#C9CDD3;font-size:14px;line-height:1.8;padding-left:18px">%s</ul>'
            '<a href="%s/#/reports" style="display:inline-block;margin-top:12px;background:#E6E8EB;color:#0D0F12;'
            'text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:8px">Open report</a>'
            '</div></div>'
        ) % (len(recent), len(blocked), "".join("<li>%s</li>" % escape(l) for l in lines), escape(self.dashboard_url()))
        results = []
        for s in self.config.get("stakeholders", []):
            if not s.get("weekly_report"):
                continue
            ok, detail = self._send("email", s, subject, text, html, None)
            entry = {"incident": "REPORT", "event": "weekly_report", "channel": "email", "to": s["name"],
                     "stakeholder": s["id"],
                     "status": "sent" if ok else ("skipped" if detail.startswith("Not configured") else "failed"),
                     "detail": detail}
            self._record(entry)
            results.append(entry)
        return results
