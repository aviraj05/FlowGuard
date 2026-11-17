import type { LabAlgo } from '../api/labTypes';
import { clock, ms, num } from '../lib/format';
import { latencySeries, serverStats } from '../lib/derive';
import { useFG } from '../state/store';
import { LineChart } from '../ui/Chart';
import { Icon } from '../ui/Icon';
import { ErrorNotice, StartMonitoring } from '../ui/LabSession';
import { Card, PageHead, Seg, Switch } from '../ui/parts';

export default function Services() {
  const fg = useFG();
  const last = fg.lastTick;
  const servers = serverStats(fg.ticks, fg.devices);
  const lat = latencySeries(fg.ticks);
  const canControl = fg.running && fg.status?.phase === 'ready';
  const algo: LabAlgo = last?.algo ?? 'leastconn';

  return (
    <div className="page">
      <PageHead title="Services" sub="Your servers behind the campus gateway, and how load is shared between them." />
      <ErrorNotice />
      {!fg.running && fg.source !== 'demo' && <StartMonitoring compact />}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        {servers.map((s) => (
          <div key={s.id} className="card" style={{ padding: 20 }}>
            <div className="between">
              <div className="row">
                <div className="list-icon"><Icon name="server" size={16} /></div>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{s.owner}</div>
                </div>
              </div>
              <span className={`pill ${!s.up ? 'pill-danger' : s.slow ? 'pill-warn' : 'pill-ok'}`}>
                <span className={`dot ${!s.up ? 'dot-danger' : s.slow ? 'dot-warn' : 'dot-ok'}`} />{!s.up ? 'Down' : s.slow ? 'Degraded' : 'Healthy'}
              </span>
            </div>
            <div style={{ marginTop: 18 }}>
              <div className="between" style={{ fontSize: 12.5, marginBottom: 6 }}>
                <span className="muted">Share of requests (last 30 s)</span><span className="num">{Math.round(s.share * 100)}%</span>
              </div>
              <div className="bar"><span style={{ width: `${Math.round(s.share * 100)}%`, background: s.slow ? 'var(--warn)' : undefined }} /></div>
            </div>
            <dl className="kv" style={{ marginTop: 16 }}>
              <dt>Open connections</dt><dd>{s.active}</dd>
              <dt>Requests served</dt><dd>{num(s.total)}</dd>
            </dl>
          </div>
        ))}
      </div>

      <div className="grid grid-main">
        <Card title="Response time" sub="Live · average and slowest 5% of requests"
          action={<div className="legend hide-sm"><span><i style={{ background: 'var(--accent)' }} />Average</span><span><i style={{ background: 'var(--violet)' }} />Slowest 5%</span></div>}>
          <LineChart height={240} unit=" ms" xFormat={clock}
            series={[{ name: 'Average', color: '#5AB8F0', points: lat.mean, area: true }, { name: 'Slowest 5%', color: '#9B87F5', points: lat.p95 }]}
            emptyText="Start monitoring to see live response times" />
        </Card>
        <Card title="Load balancing" sub="How the campus gateway picks a server">
          <div className="stack">
            <div className="field">
              <label>Algorithm</label>
              <Seg value={algo} disabled={!canControl || fg.busy} onChange={(v) => fg.command({ cmd: 'set_algo', algo: v })}
                options={[{ value: 'roundrobin', label: 'Round robin' }, { value: 'leastconn', label: 'Least connections' }]} />
              <div className="muted" style={{ fontSize: 12.5 }}>
                {algo === 'leastconn'
                  ? 'Sends each request to the server with the fewest open connections, so a slow server automatically gets less traffic.'
                  : 'Takes turns between servers. Simple, but a slow server still gets a third of all requests.'}
              </div>
            </div>
            <div className="between" style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 500 }}>Simulate a slow Exam portal</div>
                <div className="muted" style={{ fontSize: 12.5 }}>Adds 100 ms to every response from the Exam portal.</div>
              </div>
              <Switch on={!!last?.slow} disabled={!canControl || fg.busy} onChange={(v) => fg.command({ cmd: 'set_slow', on: v })} label="Slow server" />
            </div>
            <div className="notice">
              Measured on the testbed: with one slow server, least connections kept the average at <b>7.2 ms</b> versus <b>68.8 ms</b> for round robin.
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>Current average: <span className="num">{ms(last?.mean_ms)}</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
