import { useEffect, useState } from 'react';
import { fetchNotifyConfig, saveDevices, saveNotifyConfig, sendTestAlert } from '../api/lab';
import type { Device, LabDefence, NotifyConfig, Severity, Stakeholder } from '../api/labTypes';
import { ago, clock } from '../lib/format';
import { href } from '../lib/router';
import { useFG } from '../state/store';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { ErrorNotice } from '../ui/LabSession';
import { Card, Check, Notice, PageHead, Switch } from '../ui/parts';

const TABS = [
  { id: 'protection', label: 'Protection' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'devices', label: 'Devices' },
  { id: 'detection', label: 'Detection engine' },
];

export default function Settings({ tab }: { tab: string }) {
  return (
    <div className="page">
      <PageHead title="Settings" sub="Configure how FlowGuard protects your network and who it tells." />
      <nav className="tabs">
        {TABS.map((t) => <a key={t.id} href={href(`/settings/${t.id}`)} className={tab === t.id ? 'on' : ''}>{t.label}</a>)}
      </nav>
      <ErrorNotice />
      {tab === 'notifications' ? <Notifications /> : tab === 'devices' ? <Devices /> : tab === 'detection' ? <Detection /> : <Protection />}
    </div>
  );
}

/* ───────────────────────── Protection ───────────────────────── */
function Protection() {
  const fg = useFG();
  const last = fg.lastTick;
  const ready = fg.running && fg.status?.phase === 'ready';
  const mode: LabDefence = last?.defence ?? 'protect';
  const blocked = last?.blocked ?? [];
  const modes: { v: LabDefence; title: string; text: string; icon: IconName }[] = [
    { v: 'protect', title: 'Protect', icon: 'shieldCheck', text: 'Detect attacks, block the source at the switch within about a second, and alert stakeholders.' },
    { v: 'monitor', title: 'Monitor only', icon: 'eye', text: 'Detect and alert, but never block. Useful while you build trust in the detector.' },
    { v: 'off', title: 'Off', icon: 'shield', text: 'No detection. Traffic still flows through the load balancer.' },
  ];
  return (
    <div className="stack">
      {!ready && <Notice>{fg.source === 'demo' ? 'Demo data: connect the FlowGuard agent to change protection settings.' : 'Start monitoring (Drills page) to change protection settings.'}</Notice>}
      <div className="grid grid-3">
        {modes.map((m) => (
          <button key={m.v} type="button" disabled={!ready || fg.busy} onClick={() => fg.command({ cmd: 'set_defence', mode: m.v })}
            className="card" style={{ padding: 20, textAlign: 'left', cursor: ready ? 'pointer' : 'default', borderColor: mode === m.v ? 'var(--accent)' : undefined, boxShadow: mode === m.v ? '0 0 0 3px var(--accent-soft)' : undefined }}>
            <div className="between">
              <div className="stat-icon" style={mode === m.v ? undefined : { background: 'var(--surface-2)', color: 'var(--muted)' }}><Icon name={m.icon} size={18} /></div>
              {mode === m.v && <span className="tag" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>Active</span>}
            </div>
            <div style={{ fontWeight: 600, fontSize: 15, marginTop: 14 }}>{m.title}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{m.text}</div>
          </button>
        ))}
      </div>
      <div className="grid grid-2">
        <Card title="Currently blocked" sub="Sources with an active drop rule on the switch" bodyClass="">
          {blocked.length === 0 && <div className="empty" style={{ padding: 24 }}>Nothing is blocked right now.</div>}
          {blocked.map((ip) => (
            <div key={ip} className="list-row">
              <span className="dot dot-danger" />
              <div className="list-main"><div className="list-title">{fg.devices.find((d) => d.ip === ip)?.name ?? ip}</div><div className="list-sub mono">{ip}</div></div>
              <button className="btn btn-sm" disabled={fg.busy} onClick={() => fg.command({ cmd: 'unblock' })}><Icon name="unlock" size={13} />Unblock</button>
            </div>
          ))}
        </Card>
        <Card title="Safety rules" sub="Built into the detector">
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-2)', lineHeight: 1.9, fontSize: 13.5 }}>
            <li>The gateway and servers are <b>never blocked</b>, even if they look unusual.</li>
            <li>Blocks are <b>released automatically</b> when the attack ends, ready for normal use.</li>
            <li>A block only happens when the model is at least <b>50% confident</b> for a full 1-second window.</li>
            <li>Every block can be undone with one click here, on the incident page, or from Telegram.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────── Notifications ───────────────────────── */
const DEMO_CONFIG: NotifyConfig = {
  in_app: true,
  channels: { email: { configured: true, sender: 'flowguard.alerts@gmail.com' }, telegram: { configured: true, bot: '@FlowGuardCampusBot' }, in_app: { configured: true } },
  stakeholders: [
    { id: 'it-admin', name: 'IT Admin (on-call)', role: 'IT admin', email: 'it-admin@campus.edu', telegram_chat_id: '51234', channels: ['email', 'telegram'], severities: ['critical', 'high', 'medium'], resolved: true, weekly_report: false },
    { id: 'exam-cell', name: 'Exam Cell', role: 'Service owner', email: 'exam-cell@campus.edu', telegram_chat_id: '', channels: ['email'], severities: ['critical'], resolved: true, weekly_report: false },
    { id: 'security-lead', name: 'Network & Security Lead', role: 'Security lead', email: 'security@campus.edu', telegram_chat_id: '', channels: ['email'], severities: ['critical', 'high'], resolved: false, weekly_report: true },
    { id: 'management', name: "Principal's Office", role: 'Management', email: 'principal@campus.edu', telegram_chat_id: '', channels: ['email'], severities: [], resolved: false, weekly_report: true },
  ],
};

const SEVS: Severity[] = ['critical', 'high', 'medium'];

function Notifications() {
  const fg = useFG();
  const demo = fg.source === 'demo';
  const [cfg, setCfg] = useState<NotifyConfig | null>(null);
  const [rows, setRows] = useState<Stakeholder[]>([]);
  const [inApp, setInApp] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let alive = true;
    if (demo) {
      setCfg(DEMO_CONFIG);
      setRows(DEMO_CONFIG.stakeholders);
      return;
    }
    if (fg.agent !== 'online') return;
    fetchNotifyConfig().then((c) => {
      if (!alive) return;
      setCfg(c);
      setRows(c.stakeholders);
      setInApp(c.in_app);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [demo, fg.agent]);

  const update = (i: number, patch: Partial<Stakeholder>) => {
    setRows((r) => r.map((s, k) => (k === i ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

  const save = async () => {
    setWorking(true);
    try {
      const r = await saveNotifyConfig(rows, inApp);
      if (r.config) setCfg(r.config);
      setDirty(false);
      setMsg({ ok: r.ok, text: r.ok ? 'Notification rules saved.' : r.message });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setWorking(false);
    }
  };

  const test = async (id?: string) => {
    setWorking(true);
    try {
      if (dirty) await saveNotifyConfig(rows, inApp);
      setDirty(false);
      const r = await sendTestAlert(id);
      const failed = r.results.filter((x) => x.status !== 'sent');
      setMsg({ ok: failed.length === 0 && r.results.length > 0,
        text: r.results.length === 0 ? 'No channels selected for this stakeholder.' :
          `${r.message}.${failed.length ? ` ${failed.map((f) => `${f.to} (${f.channel}): ${f.detail}`).join(' · ')}` : ''}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setWorking(false);
    }
  };

  const ch = cfg?.channels;
  const log = [...fg.notifyLog].filter((e) => e.channel !== 'in_app').reverse().slice(0, 12);

  const channels: { icon: IconName; name: string; status: string; ok: boolean | null; detail: string }[] = [
    { icon: 'mail', name: 'Email', ok: ch ? ch.email.configured : null, status: ch?.email.configured ? 'Connected' : 'Not set up',
      detail: ch?.email.configured ? `Sending as ${ch.email.sender}` : 'Add SMTP_USER and SMTP_PASS (Gmail app password) to MN_Data/.env' },
    { icon: 'send', name: 'Telegram', ok: ch ? ch.telegram.configured : null, status: ch?.telegram.configured ? 'Connected' : 'Not set up',
      detail: ch?.telegram.configured ? `${ch.telegram.bot ?? 'Bot'} · alerts include Acknowledge / Unblock buttons` : 'Add TELEGRAM_BOT_TOKEN to MN_Data/.env, then send /start to the bot' },
    { icon: 'bell', name: 'Dashboard', ok: true, status: inApp ? 'On' : 'Off', detail: 'Pop-up and bell on every page when an attack is detected' },
  ];
  const soon: { icon: IconName; name: string; detail: string }[] = [
    { icon: 'chat', name: 'WhatsApp', detail: 'Via WhatsApp Business API' },
    { icon: 'sms', name: 'SMS', detail: 'Backup when the internet is down' },
    { icon: 'phone', name: 'Voice call', detail: 'Escalate if not acknowledged in 5 min' },
  ];

  return (
    <div className="stack">
      {demo && <Notice>Demo data: connect the FlowGuard agent to edit and test notification rules.</Notice>}
      {msg && <Notice tone={msg.ok ? 'ok' : 'danger'}>{msg.text}</Notice>}

      <div className="grid grid-3">
        {channels.map((c) => (
          <div key={c.name} className="card channel">
            <div className="channel-icon"><Icon name={c.icon} size={18} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="between">
                <b>{c.name}</b>
                {c.name === 'Dashboard'
                  ? <Switch on={inApp} disabled={demo} onChange={(v) => { setInApp(v); setDirty(true); }} label="Dashboard alerts" />
                  : <span className={`status ${c.ok ? 'ok' : 'faint'}`} style={{ fontSize: 12.5 }}><span className={`dot ${c.ok ? 'dot-ok' : 'dot-muted'}`} />{c.status}</span>}
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-3">
        {soon.map((c) => (
          <div key={c.name} className="card channel soon">
            <div className="channel-icon"><Icon name={c.icon} size={18} /></div>
            <div style={{ flex: 1 }}>
              <div className="between"><b>{c.name}</b><span className="tag">Coming soon</span></div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{c.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <Card title="Who gets told what" sub="Each stakeholder only receives the severities ticked for them. Management gets the weekly report, not every alert."
        action={
          <span className="row">
            <button className="btn" disabled={demo || working} onClick={() => test()}><Icon name="send" size={14} />Send test alert</button>
            <button className="btn btn-primary" disabled={demo || working || !dirty} onClick={save}>Save changes</button>
          </span>
        } bodyClass="table-wrap">
        <table className="table table-tight">
          <thead>
            <tr>
              <th style={{ minWidth: 170 }}>Stakeholder</th>
              <th style={{ minWidth: 200 }}>Contact</th>
              <th>Email</th><th>Telegram</th>
              <th style={{ borderLeft: '1px solid var(--border)' }}><span className="sev sev-critical">Critical</span></th>
              <th><span className="sev sev-high">High</span></th>
              <th><span className="sev sev-medium">Medium</span></th>
              <th style={{ borderLeft: '1px solid var(--border)' }}>Resolved</th>
              <th>Weekly report</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.id}>
                <td>
                  <input className="input input-sm" value={s.name} disabled={demo} onChange={(e) => update(i, { name: e.target.value })} style={{ fontWeight: 500 }} />
                  <input className="input input-sm" value={s.role} disabled={demo} placeholder="Role" onChange={(e) => update(i, { role: e.target.value })} style={{ marginTop: 4, color: 'var(--muted)' }} />
                </td>
                <td>
                  <input className="input input-sm" value={s.email} disabled={demo} placeholder="name@college.edu" onChange={(e) => update(i, { email: e.target.value })} />
                  <input className="input input-sm mono" value={s.telegram_chat_id} disabled={demo} placeholder="Telegram chat ID" onChange={(e) => update(i, { telegram_chat_id: e.target.value })} style={{ marginTop: 4 }} />
                </td>
                <td><Check on={s.channels.includes('email')} disabled={demo} label="Email" onChange={(v) => update(i, { channels: toggle(s.channels, 'email', v) })} /></td>
                <td><Check on={s.channels.includes('telegram')} disabled={demo} label="Telegram" onChange={(v) => update(i, { channels: toggle(s.channels, 'telegram', v) })} /></td>
                {SEVS.map((v, k) => (
                  <td key={v} style={k === 0 ? { borderLeft: '1px solid var(--border)' } : undefined}>
                    <Check on={s.severities.includes(v)} disabled={demo} label={v} onChange={(on) => update(i, { severities: toggle(s.severities, v, on) })} />
                  </td>
                ))}
                <td style={{ borderLeft: '1px solid var(--border)' }}><Switch on={s.resolved} disabled={demo} label="Resolved follow-up" onChange={(v) => update(i, { resolved: v })} /></td>
                <td><Switch on={s.weekly_report} disabled={demo} label="Weekly report" onChange={(v) => update(i, { weekly_report: v })} /></td>
                <td className="r">
                  <span className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                    <button className="btn btn-ghost btn-sm" disabled={demo || working} onClick={() => test(s.id)} title="Send a test alert to this stakeholder">Test</button>
                    <button className="btn btn-ghost btn-sm" disabled={demo} onClick={() => { setRows((r) => r.filter((_, k) => k !== i)); setDirty(true); }} title="Remove"><Icon name="trash" size={13} /></button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '12px 20px' }}>
          <button className="btn btn-ghost btn-sm" disabled={demo} onClick={() => {
            setRows((r) => [...r, { id: `s${Date.now()}`, name: 'New stakeholder', role: '', email: '', telegram_chat_id: '', channels: ['email'], severities: ['critical'], resolved: true, weekly_report: false }]);
            setDirty(true);
          }}><Icon name="plus" size={13} />Add stakeholder</button>
        </div>
      </Card>

      <div className="grid grid-main">
        <Card title="Delivery log" sub="Every alert FlowGuard has sent or tried to send" bodyClass="table-wrap">
          {log.length === 0 ? <div className="empty">No alerts sent yet. Use “Send test alert” to try your setup.</div> : (
            <table className="table">
              <thead><tr><th>Time</th><th>Incident</th><th>To</th><th>Channel</th><th>Result</th></tr></thead>
              <tbody>
                {log.map((e, i) => (
                  <tr key={i}>
                    <td className="num muted nowrap" title={ago(e.ts)}>{clock(e.ts)}</td>
                    <td>{e.incident.startsWith('INC') ? <a className="mono accent" href={href(`/incidents/${e.incident}`)}>{e.incident}</a> : <span className="mono muted">{e.incident === 'TEST' ? 'Test' : 'Report'}</span>}
                      <div className="faint" style={{ fontSize: 12 }}>{e.event === 'opened' ? 'Alert' : e.event === 'resolved' ? 'Resolved follow-up' : e.event === 'test' ? 'Test' : 'Weekly report'}</div></td>
                    <td>{e.to}</td>
                    <td className="muted">{e.channel === 'email' ? 'Email' : 'Telegram'}</td>
                    <td title={e.detail}>
                      <span className={`status nowrap ${e.status === 'sent' ? 'ok' : e.status === 'failed' ? 'danger' : 'faint'}`} style={{ fontSize: 12.5 }}>
                        {e.status === 'sent' ? 'Delivered' : e.status === 'failed' ? 'Failed' : 'Not set up'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Setting up channels" sub="One-time setup in the VM">
          <div className="stack" style={{ gap: 12, fontSize: 13 }}>
            <div className="muted">Create <span className="mono">MN_Data/.env</span> (it is never uploaded to GitHub) and restart the agent:</div>
            <div className="code">{`SMTP_USER=you@gmail.com
SMTP_PASS=your 16-char app password
TELEGRAM_BOT_TOKEN=123456:ABC-xyz
DASHBOARD_URL=http://localhost:5173`}</div>
            <div className="muted"><b style={{ color: 'var(--text)' }}>Gmail:</b> turn on 2-Step Verification, then create an App password.</div>
            <div className="muted"><b style={{ color: 'var(--text)' }}>Telegram:</b> create a bot with @BotFather, then send <span className="mono">/start</span> to it. It replies with the chat ID to paste above.</div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────── Devices ───────────────────────── */
function Devices() {
  const fg = useFG();
  const demo = fg.source === 'demo';
  const [rows, setRows] = useState<Device[]>(fg.devices);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (!dirty) setRows(fg.devices); }, [fg.devices, dirty]);
  const update = (i: number, patch: Partial<Device>) => { setRows((r) => r.map((d, k) => (k === i ? { ...d, ...patch } : d))); setDirty(true); };
  const save = async () => {
    try {
      const r = await saveDevices(rows);
      setMsg({ ok: r.ok, text: r.ok ? 'Devices saved. New names appear in incidents and alerts.' : r.message });
      setDirty(false);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="stack">
      {demo && <Notice>Demo data: connect the FlowGuard agent to edit devices.</Notice>}
      {msg && <Notice tone={msg.ok ? 'ok' : 'danger'}>{msg.text}</Notice>}
      <Card title="Device names" sub="Give every IP a name people recognise. These names are used in incidents, emails and Telegram alerts."
        action={<button className="btn btn-primary" disabled={demo || !dirty} onClick={save}>Save changes</button>} bodyClass="table-wrap">
        <table className="table">
          <thead><tr><th>IP address</th><th>Name</th><th>Location</th><th>Owner</th><th>Critical service</th></tr></thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={d.ip}>
                <td className="num muted">{d.ip}<div className="faint" style={{ fontSize: 11.5 }}>{d.host}</div></td>
                <td><input className="input input-sm" value={d.name} disabled={demo} onChange={(e) => update(i, { name: e.target.value })} /></td>
                <td><input className="input input-sm" value={d.location} disabled={demo} onChange={(e) => update(i, { location: e.target.value })} /></td>
                <td><input className="input input-sm" value={d.owner} disabled={demo} onChange={(e) => update(i, { owner: e.target.value })} /></td>
                <td><Switch on={d.critical} disabled={demo} onChange={(v) => update(i, { critical: v })} label="Critical" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ───────────────────────── Detection engine ───────────────────────── */
function Detection() {
  const fg = useFG();
  const features = ['Packets per second', 'Bytes per second', 'Average packet size', 'Share of SYN packets', 'Distinct destination ports',
    'Distinct source ports', 'TCP share', 'UDP share', 'ICMP share'];
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card stat"><div><div className="stat-value">1.000</div><div className="stat-label">F1 score</div><div className="stat-foot">5-fold grouped cross-validation</div></div></div>
        <div className="card stat"><div><div className="stat-value">0.0<small>%</small></div><div className="stat-label">False-positive rate</div><div className="stat-foot">Normal traffic wrongly flagged</div></div></div>
        <div className="card stat"><div><div className="stat-value">3.3<small>ms</small></div><div className="stat-label">Decision time</div><div className="stat-foot">Per 1-second traffic window</div></div></div>
        <div className="card stat"><div><div className="stat-value">1,725</div><div className="stat-label">Training windows</div><div className="stat-foot">From 46 capture segments</div></div></div>
      </div>
      <div className="grid grid-2">
        <Card title="Lab model: Random Forest" sub="Runs at the campus gateway on every source, every second">
          <dl className="kv">
            <dt>Model file</dt><dd>{fg.health ? (fg.health.model ? 'model_lab.joblib ✓' : 'missing: run train_lab_model.py') : '—'}</dd>
            <dt>Attacks learned</dt><dd>SYN, UDP, ICMP floods · port scans</dd>
            <dt>Block threshold</dt><dd>≥ 50% confidence</dd>
            <dt>Compared against</dt><dd>Decision Tree (F1 0.996) · XGBoost (F1 0.996)</dd>
          </dl>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 16 }}>Features it looks at:</div>
          <div className="row-wrap" style={{ marginTop: 8, gap: 6 }}>
            {features.map((f) => <span key={f} className="tag" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>{f}</span>)}
          </div>
        </Card>
        <Card title="Baseline model: UNSW-NB15 Decision Tree" sub="Used by the FastAPI gateway on 90-feature flow records">
          <dl className="kv">
            <dt>F1 score</dt><dd>0.9802 (on UNSW-NB15)</dd>
            <dt>Inference</dt><dd>&lt; 15 ms per flow</dd>
            <dt>Features</dt><dd>90 (UNSW-NB15 schema)</dd>
          </dl>
          <div className="notice" style={{ marginTop: 16 }}>
            Honest limits: lab scores come from an emulated network where floods are easy to separate. Slow, low-rate attacks were not tested.
          </div>
        </Card>
      </div>
    </div>
  );
}
