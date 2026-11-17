import type { Incident, NotificationEntry } from '../api/labTypes';
import { attackName, clock, dateTime, ms, num, secs } from '../lib/format';
import { href } from '../lib/router';
import { useFG } from '../state/store';
import { LineChart } from '../ui/Chart';
import type { Band, Marker } from '../ui/Chart';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { ErrorNotice } from '../ui/LabSession';
import { Card, Empty, IncidentStatusLabel, PageHead, SeverityBadge } from '../ui/parts';

const T_COLORS: Record<string, string> = {
  traffic: 'var(--warn)', detected: 'var(--orange)', blocked: 'var(--ok)', resolved: 'var(--faint)',
  ack: 'var(--accent)', unblocked: 'var(--violet)', unblock_request: 'var(--violet)', false_positive: 'var(--violet)',
  notified: 'var(--accent)',
};

function timelineWithAlerts(inc: Incident) {
  const alerts = inc.notifications
    .filter((n) => n.channel !== 'in_app' && n.status === 'sent' && n.event === 'opened');
  const grouped = alerts.length
    ? [{ ts: alerts[0].ts, kind: 'notified', text: `Alert sent to ${[...new Set(alerts.map((a) => a.to))].join(', ')} (${[...new Set(alerts.map((a) => (a.channel === 'email' ? 'email' : 'Telegram')))].join(' + ')})` }]
    : [];
  return [...inc.timeline, ...grouped].sort((a, b) => a.ts - b.ts);
}

function channelIcon(n: NotificationEntry): IconName {
  return n.channel === 'email' ? 'mail' : n.channel === 'telegram' ? 'send' : 'bell';
}

export default function IncidentDetail({ id }: { id: string }) {
  const fg = useFG();
  const inc = fg.incidents.find((i) => i.id === id);
  const demo = fg.source === 'demo';

  if (!inc) {
    return (
      <div className="page">
        <PageHead title={id} back={{ to: '/incidents', label: 'Incidents' }} />
        <Card><Empty icon="info" title="Incident not found">{fg.source === 'connecting' ? 'Connecting to the agent…' : 'It may have been cleared from history.'}</Empty></Card>
      </div>
    );
  }

  const ev = inc.evidence;
  const imp = inc.impact;
  const start = inc.attack_started ?? inc.opened;
  // While the attack is still running, estimate before/during/after from the live series.
  const avg = (from: number, to: number) => {
    const v = inc.series.filter(([t, y]) => t >= from && t < to && y !== null).map(([, y]) => y as number);
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
  };
  const before = imp.baseline_ms ?? avg(start - 10, start);
  const during = imp.attack_ms ?? avg(start, inc.blocked_at ? inc.blocked_at + 1 : Infinity);
  const after = imp.after_ms ?? (inc.blocked_at ? avg(inc.blocked_at + 2, Infinity) : null);
  const bands: Band[] = [{ from: start, to: inc.resolved_at ?? Date.now() / 1000, label: 'attack' }];
  const markers: Marker[] = inc.blocked_at ? [{ x: inc.blocked_at, label: 'blocked', tone: 'ok' }] : [];
  const sentTo = inc.notifications.filter((n) => n.channel !== 'in_app');

  return (
    <div className="page">
      <PageHead
        back={{ to: '/incidents', label: 'Incidents' }}
        title={<span className="row-wrap" style={{ gap: 12 }}>{attackName(inc.kind)} {inc.blocked_at ? 'blocked' : 'detected'} from {inc.src_name}</span>}
        sub={<span className="row-wrap" style={{ gap: 12 }}>
          <SeverityBadge s={inc.severity} /><IncidentStatusLabel inc={inc} />
          <span className="mono muted">{inc.id}</span><span className="muted">{dateTime(inc.opened)}</span>
          {inc.simulated && <span className="tag tag-sim">Drill</span>}
        </span>}
        actions={
          <>
            {!inc.ack_at && <button className="btn" disabled={demo || fg.busy} onClick={() => fg.actOnIncident(inc.id, 'ack')}><Icon name="check" size={14} />Acknowledge</button>}
            {inc.status === 'contained' && <button className="btn" disabled={demo || fg.busy} onClick={() => fg.actOnIncident(inc.id, 'unblock')}><Icon name="unlock" size={14} />Unblock source</button>}
            {!inc.false_positive && <button className="btn btn-ghost" disabled={demo || fg.busy} onClick={() => fg.actOnIncident(inc.id, 'false_positive')}>Mark false positive</button>}
          </>
        } />
      <ErrorNotice />

      <div className="grid grid-main" style={{ marginBottom: 16 }}>
        <Card title="What happened">
          <p className="summary-text">{inc.summary || 'Collecting details…'}</p>
          <div className="big-compare" style={{ marginTop: 20 }}>
            <div className="compare-cell"><div className="l">Before attack</div><div className="v">{ms(before)}</div></div>
            <div className="compare-cell"><div className="l">During attack</div><div className="v danger">{ms(during)}</div></div>
            <div className="compare-cell"><div className="l">After block</div><div className="v ok">{ms(after)}</div></div>
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>{imp.attack_ms === null ? 'Live estimate: final figures are filled in when the attack ends.' : 'Average response time for legitimate users.'}</div>
        </Card>
        <Card title="Timeline">
          <ul className="timeline">
            {timelineWithAlerts(inc).map((t, i) => (
              <li key={i}>
                <span className="t-dot" style={{ background: T_COLORS[t.kind] ?? 'var(--faint)' }} />
                <div className="t-time">{clock(t.ts)}</div>
                <div className="t-text">{t.text}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Response time during the incident" sub="Average response time for users · shaded = attack · green line = blocked" className="" >
        <LineChart height={220} unit=" ms" xFormat={clock} bands={bands} markers={markers}
          series={[{ name: 'Average', color: '#5AB8F0', points: inc.series, area: true }]} />
      </Card>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <Card title="Evidence" sub="Why the detector flagged this source">
          <dl className="kv">
            <dt>Peak rate</dt><dd>{num(ev.peak_pps)} pkt/s</dd>
            <dt>Normal rate</dt><dd>{ev.normal_pps ? `${num(ev.normal_pps)} pkt/s` : '—'}</dd>
            <dt>Above normal</dt><dd className="danger">{ev.ratio ? `${Math.round(ev.ratio)}×` : '—'}</dd>
            <dt>Model confidence</dt><dd>{ev.score !== null ? `${Math.round(ev.score * 100)}%` : '—'}</dd>
            <dt>Avg packet size</dt><dd>{ev.mean_len !== null ? `${Math.round(ev.mean_len)} B` : '—'}</dd>
            <dt>SYN share</dt><dd>{ev.syn_ratio !== null ? `${Math.round(ev.syn_ratio * 100)}%` : '—'}</dd>
          </dl>
        </Card>
        <Card title="Response" sub="What FlowGuard did">
          <dl className="kv">
            <dt>Action</dt><dd>{inc.blocked_at ? 'Blocked at switch' : 'Flagged only'}</dd>
            <dt>Time to block</dt><dd className="ok">{secs(imp.detect_delay_s)}</dd>
            <dt>Protection mode</dt><dd>{inc.mode === 'protect' ? 'Protect' : inc.mode === 'monitor' ? 'Monitor' : inc.mode}</dd>
            <dt>Requests served</dt><dd>{num(imp.completed)}</dd>
            <dt>Requests failed</dt><dd>{num(imp.failed)}</dd>
            <dt>Acknowledged</dt><dd>{inc.ack_by ?? 'Not yet'}</dd>
          </dl>
        </Card>
        <Card title="Who was notified" action={<a className="card-link" href={href('/settings/notifications')}>Rules <Icon name="arrowRight" size={13} /></a>} bodyClass="">
          {sentTo.length === 0 && <div className="empty" style={{ padding: 24 }}>No external alerts for this incident.</div>}
          {sentTo.map((n, i) => (
            <div key={i} className="list-row">
              <div className="list-icon"><Icon name={channelIcon(n)} size={15} /></div>
              <div className="list-main">
                <div className="list-title">{n.to}</div>
                <div className="list-sub">{n.event === 'resolved' ? 'Resolved follow-up' : 'Alert'} · {n.channel === 'email' ? 'Email' : 'Telegram'} · {clock(n.ts)}</div>
              </div>
              <span className={`status ${n.status === 'sent' ? 'ok' : n.status === 'failed' ? 'danger' : 'faint'}`} title={n.detail} style={{ fontSize: 12.5 }}>
                {n.status === 'sent' ? 'Sent' : n.status === 'failed' ? 'Failed' : 'Not set up'}
              </span>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ marginTop: 16 }} className="row-wrap faint">
        <Icon name="info" size={14} />
        <span style={{ fontSize: 12.5 }}>Source {inc.src_name} ({inc.src}) · target {inc.target_name} ({inc.target}) · detection model: Random Forest on 1-second traffic windows.</span>
      </div>
    </div>
  );
}
