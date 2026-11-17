import { attackName, clock, ago, ms, num, secs } from '../lib/format';
import { attackBands, blockMarkers, deviceStatus, inRange, latencySeries, rangeStats, serverStats } from '../lib/derive';
import { href } from '../lib/router';
import { RANGE_SECONDS, useFG } from '../state/store';
import type { Range } from '../state/store';
import { LineChart } from '../ui/Chart';
import { Icon } from '../ui/Icon';
import { ErrorNotice, StartMonitoring } from '../ui/LabSession';
import { Card, CardLink, Empty, PageHead, Seg, SeverityBadge, Stat } from '../ui/parts';

export const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: '24h', label: '24h' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' },
];

function StatusBanner() {
  const fg = useFG();
  const active = fg.incidents.filter((i) => i.status === 'active');
  const contained = fg.incidents.filter((i) => i.status === 'contained');
  const t = fg.lastTick;

  if (!fg.running && fg.source !== 'demo') return <StartMonitoring />;

  if (active.length || (t?.attack && t.blocked.length === 0 && t.defence !== 'off')) {
    const inc = active[0];
    return (
      <div className="banner banner-danger">
        <div className="banner-icon"><Icon name="shieldAlert" size={20} /></div>
        <div>
          <div className="banner-title">Attack in progress{inc ? `: ${attackName(inc.kind)} from ${inc.src_name}` : ''}</div>
          <div className="banner-text">Protection is in monitor mode, so the source is flagged but not blocked. Switch to Protect to stop it.</div>
        </div>
        <div className="spacer" />
        {inc && <a className="btn btn-danger" href={href(`/incidents/${inc.id}`)}>Open incident</a>}
      </div>
    );
  }
  if (t?.attack && t.defence === 'off') {
    return (
      <div className="banner banner-danger">
        <div className="banner-icon"><Icon name="shieldAlert" size={20} /></div>
        <div>
          <div className="banner-title">Traffic flood reaching your servers, and protection is off</div>
          <div className="banner-text">Users are seeing slow responses. Turn on protection in Settings → Protection.</div>
        </div>
        <div className="spacer" />
        <a className="btn" href={href('/settings/protection')}>Turn on protection</a>
      </div>
    );
  }
  if (contained.length) {
    const inc = contained[contained.length - 1];
    return (
      <div className="banner banner-warn">
        <div className="banner-icon"><Icon name="shield" size={20} /></div>
        <div>
          <div className="banner-title">Attack contained: {inc.src_name} is blocked at the switch</div>
          <div className="banner-text">{attackName(inc.kind)} detected at {clock(inc.opened)} and blocked{inc.impact.detect_delay_s !== null ? ` ${secs(inc.impact.detect_delay_s)} after it began` : ''}. Users are not affected.</div>
        </div>
        <div className="spacer" />
        <a className="btn" href={href(`/incidents/${inc.id}`)}>View incident</a>
      </div>
    );
  }
  const off = t?.defence === 'off';
  return (
    <div className={`banner ${off ? 'banner-warn' : 'banner-ok'}`}>
      <div className="banner-icon"><Icon name={off ? 'shield' : 'shieldCheck'} size={20} /></div>
      <div>
        <div className="banner-title">{off ? 'Protection is off' : 'All clear. Your network is protected'}</div>
        <div className="banner-text">
          {off ? 'Traffic is monitored, but attacks will not be detected or blocked.'
            : `No active threats. ${t ? `Users are getting responses in ${ms(t.mean_ms)} on average.` : ''}`}
        </div>
      </div>
    </div>
  );
}

export default function Overview() {
  const fg = useFG();
  const scoped = inRange(fg.incidents, RANGE_SECONDS[fg.range]);
  const s = rangeStats(scoped);
  const lat = latencySeries(fg.ticks);
  const servers = serverStats(fg.ticks, fg.devices);
  const recent = [...fg.incidents].reverse().slice(0, 4);
  const flagged = new Set(Object.values(fg.detector).filter((w) => w.action === 'flagged').map((w) => w.src));
  const devices = fg.devices.filter((d) => d.role !== 'gateway');

  return (
    <div className="page">
      <PageHead title="Overview" sub="Real-time security and network health of your campus network."
        actions={<Seg value={fg.range} onChange={fg.setRange} options={RANGE_OPTIONS} />} />
      <ErrorNotice />
      <StatusBanner />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat icon="shieldCheck" tone="ok" value={s.blocked} label="Attacks blocked" foot={`${s.total} incident${s.total === 1 ? '' : 's'} in the last ${fg.range}`} />
        <Stat icon="zap" value={s.medianDelay !== null ? s.medianDelay.toFixed(1) : '—'} unit={s.medianDelay !== null ? 's' : undefined}
          label="Median time to block" foot="From attack start to drop rule" />
        <Stat icon="users" tone="violet" value={num(s.protectedReqs)} label="Requests protected" foot="User requests served during attacks" />
        <Stat icon="incidents" tone={s.open ? 'danger' : undefined} value={s.open} label="Open incidents" foot={s.open ? 'Needs attention' : 'Nothing needs attention'} />
      </div>

      <div className="grid grid-main" style={{ marginBottom: 16 }}>
        <Card title="Response time for users" sub="Live · last 3 minutes · shaded = attack in progress"
          action={<div className="legend hide-sm"><span><i style={{ background: 'var(--accent)' }} />Average</span><span><i style={{ background: 'var(--violet)' }} />Slowest 5%</span></div>}>
          <LineChart height={250} unit=" ms" xFormat={clock}
            series={[{ name: 'Average', color: '#5AB8F0', points: lat.mean, area: true }, { name: 'Slowest 5%', color: '#9B87F5', points: lat.p95 }]}
            bands={attackBands(fg.ticks)} markers={blockMarkers(fg.ticks)}
            emptyText={fg.running ? 'Collecting the first samples…' : 'Start monitoring to see live response times'} />
        </Card>
        <Card title="Service health" action={<CardLink to="/services" />} bodyClass="">
          {servers.map((sv) => (
            <div key={sv.id} className="list-row">
              <span className={`dot ${!sv.up ? 'dot-danger' : sv.slow ? 'dot-warn' : 'dot-ok'}`} />
              <div className="list-main">
                <div className="list-title">{sv.name}</div>
                <div className="list-sub">{sv.owner}{sv.slow ? ' · degraded (slow)' : ''}</div>
              </div>
              <div style={{ width: 90 }}>
                <div className="bar"><span style={{ width: `${Math.round(sv.share * 100)}%` }} /></div>
              </div>
              <span className="num muted" style={{ width: 42, textAlign: 'right' }}>{Math.round(sv.share * 100)}%</span>
            </div>
          ))}
          <div className="list-row">
            <span className="dot dot-ok" />
            <div className="list-main">
              <div className="list-title">Campus gateway</div>
              <div className="list-sub">Load balancer · {fg.lastTick?.algo === 'leastconn' ? 'least connections' : 'round robin'}</div>
            </div>
            <span className="num muted">{fg.lastTick ? `${fg.lastTick.rps} req/s` : '—'}</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-main">
        <Card title="Recent incidents" action={<CardLink to="/incidents" />} bodyClass="">
          {recent.length === 0 && <Empty title="No incidents yet">When FlowGuard detects an attack it will appear here.</Empty>}
          {recent.map((i) => (
            <a key={i.id} className="list-row" href={href(`/incidents/${i.id}`)}>
              <div className="list-icon" style={{ color: i.severity === 'critical' ? 'var(--danger)' : 'var(--orange)' }}>
                <Icon name="incidents" size={16} />
              </div>
              <div className="list-main">
                <div className="list-title">{attackName(i.kind)} {i.blocked_at ? 'blocked' : 'detected'} · {i.src_name}</div>
                <div className="list-sub">{ago(i.opened)} · {i.status === 'resolved' ? 'Resolved' : i.status === 'contained' ? 'Contained' : 'Active'}{i.impact.detect_delay_s !== null ? ` · blocked in ${secs(i.impact.detect_delay_s)}` : ''}</div>
              </div>
              <SeverityBadge s={i.severity} />
            </a>
          ))}
        </Card>
        <Card title="Devices" sub={`${devices.length} monitored`} action={<CardLink to="/network" />} bodyClass="">
          {devices.map((d) => {
            const st = deviceStatus(d, fg.lastTick, flagged);
            return (
              <div key={d.ip} className="list-row">
                <span className={`dot ${st === 'blocked' ? 'dot-danger' : st === 'flagged' || st === 'slow' ? 'dot-warn' : 'dot-ok'}`} />
                <div className="list-main">
                  <div className="list-title">{d.name}</div>
                  <div className="list-sub">{d.location}</div>
                </div>
                <span className={`num ${st === 'blocked' ? 'danger' : 'muted'}`} style={{ fontSize: 12.5 }}>
                  {st === 'blocked' ? 'Blocked' : st === 'flagged' ? 'Flagged' : st === 'slow' ? 'Slow' : d.ip}
                </span>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
