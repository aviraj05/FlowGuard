import type { Device, LabTick } from '../api/labTypes';
import { deviceStatus } from '../lib/derive';
import { num } from '../lib/format';
import { href } from '../lib/router';
import { useFG } from '../state/store';
import { Icon } from '../ui/Icon';
import { Card, PageHead } from '../ui/parts';

type St = ReturnType<typeof deviceStatus>;
const ST_COLOR: Record<St, string> = { ok: '#3FB950', blocked: '#F0565B', flagged: '#E3B341', slow: '#E3B341' };
const ST_LABEL: Record<St, string> = { ok: 'Normal', blocked: 'Blocked', flagged: 'Flagged', slow: 'Slow' };

function Node({ x, y, d, st, kind }: { x: number; y: number; d: Device; st: St; kind: 'client' | 'gw' | 'server' }) {
  const w = kind === 'gw' ? 170 : 150;
  return (
    <g transform={`translate(${x - w / 2},${y - 28})`}>
      <rect width={w} height={56} rx={10} fill="#14171C" stroke={st === 'ok' ? '#2E333C' : ST_COLOR[st]} strokeWidth={st === 'ok' ? 1 : 1.5} />
      <circle cx={16} cy={20} r={4} fill={ST_COLOR[st]} />
      <text x={28} y={24} fill="#E6E8EB" fontSize={13} fontWeight={600}>{d.name}</text>
      <text x={16} y={43} fill="#8B929C" fontSize={11} fontFamily="JetBrains Mono, monospace">{d.ip}</text>
      {kind === 'gw' && <text x={w - 12} y={43} fill="#5AB8F0" fontSize={10.5} textAnchor="end">FlowGuard</text>}
    </g>
  );
}

function Link({ x1, y1, x2, y2, state }: { x1: number; y1: number; x2: number; y2: number; state: 'idle' | 'flow' | 'attack' | 'blocked' }) {
  const color = state === 'attack' ? '#F0565B' : state === 'blocked' ? '#F0565B' : state === 'flow' ? '#5AB8F0' : '#2E333C';
  const midX = (x1 + x2) / 2;
  const d = `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeOpacity={state === 'idle' ? 1 : 0.55} strokeWidth={state === 'attack' ? 2.5 : 1.5}
        strokeDasharray={state === 'blocked' ? '4 5' : undefined} />
      {(state === 'flow' || state === 'attack') && (
        <circle r={state === 'attack' ? 3.5 : 2.5} fill={color}>
          <animateMotion dur={state === 'attack' ? '0.6s' : '1.6s'} repeatCount="indefinite" path={d} />
        </circle>
      )}
    </g>
  );
}

function Topology({ devices, last, flagged }: { devices: Device[]; last: LabTick | null; flagged: Set<string> }) {
  const by = (h: string) => devices.find((d) => d.host === h);
  const clients = ['client', 'attacker'].map(by).filter(Boolean) as Device[];
  const gw = by('lb');
  const servers = ['srv1', 'srv2', 'srv3'].map(by).filter(Boolean) as Device[];
  if (!gw) return null;
  const W = 960, H = 320;
  const cx = 110, sx = W / 2 - 150, gx = W / 2 + 60, rx = W - 110;
  const swY = H / 2;
  const attack = !!last?.attack;
  const blockedSet = new Set(last?.blocked ?? []);
  const live = !!last;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="topo" role="img" aria-label="Network topology">
      {clients.map((d, i) => {
        const y = 90 + i * 140;
        const isAtt = d.host === 'attacker';
        const st: 'idle' | 'flow' | 'attack' | 'blocked' = !live ? 'idle' : isAtt ? (blockedSet.has(d.ip) ? 'blocked' : attack ? 'attack' : 'idle') : 'flow';
        return <Link key={d.ip} x1={cx + 75} y1={y} x2={sx - 22} y2={swY} state={st} />;
      })}
      <Link x1={sx + 22} y1={swY} x2={gx - 85} y2={swY} state={live ? (attack && !blockedSet.size ? 'attack' : 'flow') : 'idle'} />
      {servers.map((d, i) => (
        <Link key={d.ip} x1={gx + 85} y1={swY} x2={rx - 75} y2={60 + i * 100} state={live ? 'flow' : 'idle'} />
      ))}
      {clients.map((d, i) => {
        const y = 90 + i * 140;
        const st = deviceStatus(d, last, flagged);
        return (
          <g key={d.ip}>
            <Node x={cx} y={y} d={d} st={st} kind="client" />
            {st === 'blocked' && (
              <g transform={`translate(${(cx + sx) / 2 + 10},${(y + swY) / 2})`}>
                <circle r={11} fill="#0D0F12" stroke="#F0565B" />
                <path d="M-4,-4 L4,4 M4,-4 L-4,4" stroke="#F0565B" strokeWidth={2} />
              </g>
            )}
          </g>
        );
      })}
      <g transform={`translate(${sx},${swY})`}>
        <rect x={-22} y={-22} width={44} height={44} rx={10} fill="#1A1E24" stroke="#2E333C" />
        <text y={4} textAnchor="middle" fill="#C9CDD3" fontSize={12} fontWeight={600}>s1</text>
        <text y={40} textAnchor="middle" fill="#8B929C" fontSize={11}>Switch</text>
      </g>
      <Node x={gx} y={swY} d={gw} st="ok" kind="gw" />
      {servers.map((d, i) => <Node key={d.ip} x={rx} y={60 + i * 100} d={d} st={deviceStatus(d, last, flagged)} kind="server" />)}
    </svg>
  );
}

export default function Network() {
  const fg = useFG();
  const flagged = new Set(Object.values(fg.detector).filter((w) => w.action === 'flagged').map((w) => w.src));
  const roleLabel: Record<string, string> = { client: 'User device', workstation: 'Lab workstation', gateway: 'Gateway', server: 'Server' };

  return (
    <div className="page">
      <PageHead title="Network" sub="Every device FlowGuard watches, and how traffic flows through the campus gateway."
        actions={<a className="btn" href={href('/settings/devices')}><Icon name="settings" size={14} />Edit devices</a>} />

      <Card title="Topology" sub={fg.lastTick ? 'Live: moving dots show traffic, red means attack traffic' : 'Start monitoring to see live traffic'} className="" >
        <Topology devices={fg.devices} last={fg.lastTick} flagged={flagged} />
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title="Devices" sub={`${fg.devices.length} devices`} bodyClass="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Device</th><th>IP address</th><th className="hide-sm">Type</th><th className="hide-sm">Location</th><th className="hide-sm">Owner</th><th className="r hide-sm">Traffic now</th><th className="r">Status</th></tr>
            </thead>
            <tbody>
              {fg.devices.map((d) => {
                const st = deviceStatus(d, fg.lastTick, flagged);
                const w = fg.detector[d.ip];
                const fresh = w && Date.now() / 1000 - w.ts < 4;
                return (
                  <tr key={d.ip}>
                    <td>
                      <div className="row">
                        <span style={{ fontWeight: 500 }}>{d.name}</span>
                        {d.critical && <span className="tag" style={{ fontSize: 10 }}>Critical</span>}
                      </div>
                    </td>
                    <td className="num muted">{d.ip}</td>
                    <td className="hide-sm muted">{roleLabel[d.role] ?? d.role}</td>
                    <td className="hide-sm muted">{d.location}</td>
                    <td className="hide-sm muted">{d.owner}</td>
                    <td className="r hide-sm num muted">{fresh ? `${num(w.pkts)} pkt/s` : '—'}</td>
                    <td className="r"><span className="status" style={{ justifyContent: 'flex-end' }}><span className="dot" style={{ background: ST_COLOR[st] }} />{ST_LABEL[st]}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
