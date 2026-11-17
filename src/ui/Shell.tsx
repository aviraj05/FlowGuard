import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ago, attackName, clock } from '../lib/format';
import { href, navigate } from '../lib/router';
import { useFG } from '../state/store';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { SourceTag } from './parts';

const NAV: { id: string; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'incidents', label: 'Incidents', icon: 'incidents' },
  { id: 'network', label: 'Network', icon: 'network' },
  { id: 'services', label: 'Services', icon: 'services' },
  { id: 'drills', label: 'Drills', icon: 'drills' },
  { id: 'reports', label: 'Reports', icon: 'reports' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.id, n.label]));

function NetworkPill() {
  const fg = useFG();
  const t = fg.lastTick;
  const openActive = fg.incidents.some((i) => i.status === 'active');
  if (fg.source === 'demo') return <span className="pill pill-ok"><span className="dot dot-ok" />Protected</span>;
  if (!fg.running) return <span className="pill pill-muted"><span className="dot dot-muted" />Monitoring paused</span>;
  if ((t?.attack && t.blocked.length === 0) || openActive)
    return <span className="pill pill-danger"><span className="dot dot-danger pulse" />Under attack</span>;
  if (t?.defence === 'protect') return <span className="pill pill-ok"><span className="dot dot-ok" />Protected</span>;
  if (t?.defence === 'monitor') return <span className="pill pill-warn"><span className="dot dot-warn" />Monitoring only</span>;
  return <span className="pill pill-warn"><span className="dot dot-warn" />Protection off</span>;
}

function Bell() {
  const fg = useFG();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const log = fg.notifyLog.filter((e) => e.channel !== 'in_app' || e.event === 'opened');
  const recent = [...log].reverse().slice(0, 25);
  const unread = fg.notifyLog.filter((e) => e.ts > seen && e.channel === 'in_app').length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const chIcon = (c: string): IconName => (c === 'email' ? 'mail' : c === 'telegram' ? 'send' : 'bell');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label="Notifications" onClick={() => {
        setOpen(!open);
        setSeen(Date.now() / 1000);
      }}>
        <Icon name="bell" size={17} />
        {unread > 0 && !open && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="popover">
          <div className="popover-head">
            Alerts sent
            <a className="card-link" href={href('/settings/notifications')} onClick={() => setOpen(false)}>Settings <Icon name="arrowRight" size={13} /></a>
          </div>
          {recent.length === 0 && <div className="empty">No alerts yet.</div>}
          {recent.map((e, i) => (
            <a key={i} className="list-row" href={e.incident.startsWith('INC') ? href(`/incidents/${e.incident}`) : href('/settings/notifications')}
              onClick={() => setOpen(false)}>
              <div className="list-icon"><Icon name={chIcon(e.channel)} size={15} /></div>
              <div className="list-main">
                <div className="list-title">
                  {e.event === 'opened' ? 'Alert' : e.event === 'resolved' ? 'Resolved' : e.event === 'test' ? 'Test alert' : 'Weekly report'}
                  {' · '}{e.incident}
                </div>
                <div className="list-sub">{e.channel === 'in_app' ? 'Dashboard' : `${e.channel === 'email' ? 'Email' : 'Telegram'} → ${e.to}`} · {ago(e.ts)}</div>
              </div>
              <span className={`dot ${e.status === 'sent' ? 'dot-ok' : e.status === 'failed' ? 'dot-danger' : 'dot-muted'}`} title={e.status} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const fg = useFG();
  return (
    <div className="toasts">
      {fg.toasts.map((t) => (
        <div key={t.id} className="toast" role="alert">
          <div className="toast-icon"><Icon name="shieldAlert" size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="toast-title">
              {attackName(t.incident.kind)} {t.incident.blocked_at ? 'blocked' : 'detected'}
            </div>
            <div className="toast-text">
              {t.incident.src_name} · {clock(t.incident.opened)}
              {t.incident.blocked_at ? ' · stopped at the switch' : ' · not blocked (monitor mode)'}
            </div>
            <div className="row">
              <button className="btn btn-sm btn-primary" onClick={() => { navigate(`/incidents/${t.incident.id}`); fg.dismissToast(t.id); }}>View incident</button>
              <button className="btn btn-sm btn-ghost" onClick={() => fg.dismissToast(t.id)}>Dismiss</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Shell({ route, children }: { route: string[]; children: ReactNode }) {
  const fg = useFG();
  const page = route[0];
  const openCount = fg.incidents.filter((i) => i.status !== 'resolved').length;
  const agentText = fg.source === 'demo' ? 'Agent offline · demo data' : fg.agent === 'online'
    ? (fg.running ? (fg.source === 'simulated' ? 'Agent online · simulated network' : 'Agent online · live network') : 'Agent online · idle')
    : 'Connecting to agent…';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="shield" size={18} strokeWidth={2.2} /></div>
          <div>
            <div className="brand-name">FlowGuard</div>
            <div className="brand-sub">Campus network guard</div>
          </div>
        </div>
        {NAV.map((n) => (
          <a key={n.id} href={href(`/${n.id}`)} className={`nav-item ${page === n.id ? 'active' : ''}`} title={n.label}>
            <Icon name={n.icon} size={18} />
            <span className="nav-label">{n.label}</span>
            {n.id === 'incidents' && openCount > 0 && <span className="nav-badge">{openCount}</span>}
          </a>
        ))}
        <div className="sidebar-foot">
          <div className="agent-line">
            <span className={`dot ${fg.agent === 'online' ? 'dot-ok' : fg.source === 'demo' ? 'dot-muted' : 'dot-warn'}`} />
            {agentText}
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumbs hide-sm">
            <span>Campus network</span><span className="faint">/</span><b>{TITLES[page] ?? 'Overview'}</b>
          </div>
          <div className="spacer" />
          <SourceTag source={fg.source} />
          <NetworkPill />
          <Bell />
        </header>
        {children}
      </div>
      <Toasts />
    </div>
  );
}
