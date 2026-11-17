// ─── Lab controls: start/stop the lab, launch attacks, switch defence ────
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Eye, FlaskConical, Loader2, Play, ShieldCheck, Square, XCircle, Zap } from 'lucide-react';
import type {
  AgentConnection,
  LabAlgo,
  LabAttackKind,
  LabCommand,
  LabDefence,
  LabHealth,
  LabStartConfig,
  LabStatus,
} from '../../api/labTypes';

interface SegProps<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}

function Seg<T extends string | number>({ value, options, onChange, disabled }: SegProps<T>) {
  return (
    <div className="env-toggle" role="group" style={{ width: 'fit-content' }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={`env-toggle-btn ${o.value === value ? 'active' : ''}`}
          onClick={() => onChange(o.value)}
          disabled={disabled}
          aria-pressed={o.value === value}
          style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

const ALGO_OPTIONS: { value: LabAlgo; label: string }[] = [
  { value: 'roundrobin', label: 'Round robin' },
  { value: 'leastconn', label: 'Least connections' },
];
const DEFENCE_OPTIONS: { value: LabDefence; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'monitor', label: 'Detect only' },
  { value: 'protect', label: 'Detect + block' },
];
const ATTACK_OPTIONS: { value: LabAttackKind; label: string }[] = [
  { value: 'udp', label: 'UDP flood' },
  { value: 'syn', label: 'SYN flood' },
  { value: 'icmp', label: 'ICMP flood' },
];
const LENGTH_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: '15 s' },
  { value: 30, label: '30 s' },
  { value: 60, label: '60 s' },
];
const UPLINK_OPTIONS: { value: number; label: string }[] = [
  { value: 10, label: '10 Mbit/s (constrained)' },
  { value: 100, label: '100 Mbit/s (control)' },
];

interface Props {
  agent: AgentConnection;
  health: LabHealth | null;
  status: LabStatus | null;
  running: boolean;
  ready: boolean;
  algo: LabAlgo;
  slow: boolean;
  defence: LabDefence;
  attacking: boolean;
  anyBlocked: boolean;
  busy: boolean;
  error: string | null;
  onStart: (cfg: LabStartConfig) => void;
  onStop: () => void;
  onCommand: (cmd: LabCommand) => void;
}

export default function LabControls(p: Props) {
  const [cfgAlgo, setCfgAlgo] = useState<LabAlgo>('roundrobin');
  const [cfgDefence, setCfgDefence] = useState<LabDefence>('off');
  const [cfgUplink, setCfgUplink] = useState<number>(10);
  const [cfgSlow, setCfgSlow] = useState(false);
  const [attackKind, setAttackKind] = useState<LabAttackKind>('udp');
  const [attackLen, setAttackLen] = useState<number>(30);

  const online = p.agent === 'online';
  const h = p.health;
  const prereq: { key: string; label: string; ok: boolean }[] = h
    ? [
        { key: 'root', label: 'running as root (sudo)', ok: h.root },
        { key: 'mininet', label: 'Mininet', ok: h.mininet },
        { key: 'haproxy', label: 'HAProxy', ok: h.haproxy },
        { key: 'hping3', label: 'hping3', ok: h.hping3 },
        { key: 'model', label: 'model_lab.joblib', ok: h.model },
      ]
    : [];
  const realReady = prereq.length > 0 && prereq.every((x) => x.ok);
  const starting = p.status?.phase === 'starting';
  const stopping = p.status?.phase === 'stopping';

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="section-header" style={{ marginBottom: 0 }}>
        <div className="section-title">
          <FlaskConical size={14} />
          Lab controls
        </div>
        <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: p.running ? 'var(--green)' : 'var(--text-muted)' }}>
          {p.status ? p.status.phase.toUpperCase() : 'IDLE'}
        </span>
      </div>

      {p.error && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--red-dim)', border: '1px solid var(--red-border)', color: 'var(--red)', fontSize: 'var(--text-xs)' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{p.error}</span>
        </div>
      )}
      {p.status?.phase === 'error' && (
        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--red-dim)', border: '1px solid var(--red-border)', color: 'var(--red)', fontSize: 'var(--text-xs)', wordBreak: 'break-word' }}>
          Lab error: {p.status.msg}
        </div>
      )}

      {!p.running && (
        <>
          <Row label="Load-balancing algorithm"><Seg value={cfgAlgo} options={ALGO_OPTIONS} onChange={setCfgAlgo} /></Row>
          <Row label="Defence at start"><Seg value={cfgDefence} options={DEFENCE_OPTIONS} onChange={setCfgDefence} /></Row>
          <Row label="Load balancer uplink"><Seg value={cfgUplink} options={UPLINK_OPTIONS} onChange={setCfgUplink} /></Row>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={cfgSlow} onChange={(e) => setCfgSlow(e.target.checked)} />
            Start with srv1 slowed down (+100 ms)
          </label>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-success"
              disabled={!online || !realReady || p.busy}
              onClick={() => p.onStart({ algo: cfgAlgo, defence: cfgDefence, uplink: cfgUplink, slow: cfgSlow, simulate: false })}
              style={{ padding: '6px 14px', fontSize: 'var(--text-sm)' }}
            >
              <Play size={12} />
              Start Mininet lab
            </button>
            <button
              className="btn btn-ghost"
              disabled={!online || p.busy}
              onClick={() => p.onStart({ algo: cfgAlgo, defence: cfgDefence, uplink: cfgUplink, slow: cfgSlow, simulate: true })}
              title="Synthetic preview of the dashboard. Not real measurements."
              style={{ padding: '6px 14px', fontSize: 'var(--text-sm)' }}
            >
              <Eye size={12} />
              Preview (simulation)
            </button>
          </div>

          {online && prereq.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 'var(--text-2xs)' }}>
              {prereq.map((x) => (
                <span key={x.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: x.ok ? 'var(--green)' : 'var(--red)' }}>
                  {x.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                  {x.label}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {starting && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)', color: 'var(--amber)' }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Building the lab (this takes about 20&ndash;30 s)&hellip;
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {p.running && !starting && (
        <>
          <Row label="Load-balancing algorithm (switches live)">
            <Seg value={p.algo} options={ALGO_OPTIONS} disabled={!p.ready || p.busy} onChange={(v) => p.onCommand({ cmd: 'set_algo', algo: v })} />
          </Row>
          <Row label="ML defence (switches live)">
            <Seg value={p.defence} options={DEFENCE_OPTIONS} disabled={!p.ready || p.busy} onChange={(v) => p.onCommand({ cmd: 'set_defence', mode: v })} />
          </Row>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className={`btn ${p.slow ? 'btn-danger' : 'btn-ghost'}`}
              disabled={!p.ready || p.busy}
              onClick={() => p.onCommand({ cmd: 'set_slow', on: !p.slow })}
            >
              <Zap size={11} />
              {p.slow ? 'srv1 is SLOW - click to restore' : 'Slow down srv1 (+100 ms)'}
            </button>
            <button
              className="btn btn-ghost"
              disabled={!p.ready || p.busy || !p.anyBlocked}
              onClick={() => p.onCommand({ cmd: 'unblock' })}
            >
              <ShieldCheck size={11} />
              Release attacker
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Row label="Attack from 10.0.0.2 (isolated lab only)">
              <Seg value={attackKind} options={ATTACK_OPTIONS} onChange={setAttackKind} disabled={p.attacking} />
            </Row>
            <Row label="Duration">
              <Seg value={attackLen} options={LENGTH_OPTIONS} onChange={setAttackLen} disabled={p.attacking} />
            </Row>
            {p.attacking ? (
              <button className="btn btn-ghost" disabled={p.busy} onClick={() => p.onCommand({ cmd: 'attack_stop' })} style={{ padding: '6px 14px', fontSize: 'var(--text-sm)', width: 'fit-content' }}>
                <Square size={12} />
                Stop attack
              </button>
            ) : (
              <button className="btn btn-danger" disabled={!p.ready || p.busy} onClick={() => p.onCommand({ cmd: 'attack_start', attack: attackKind, length: attackLen })} style={{ padding: '6px 14px', fontSize: 'var(--text-sm)', width: 'fit-content' }}>
                <Zap size={12} />
                Launch attack
              </button>
            )}
          </div>

          <button
            className="btn btn-ghost"
            disabled={stopping || p.busy}
            onClick={p.onStop}
            style={{ width: 'fit-content', marginTop: 4 }}
          >
            <Square size={11} />
            {stopping ? 'Stopping\u2026' : 'Stop lab'}
          </button>
        </>
      )}

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <b style={{ color: 'var(--text-secondary)' }}>Suggested demo</b><br />
        1. Watch the baseline (a few ms).<br />
        2. Defence <b>Off</b> &rarr; launch a UDP flood: response time jumps.<br />
        3. Switch defence to <b>Detect + block</b>: the attacker is dropped at the switch and latency recovers.<br />
        4. Slow down srv1, then compare <b>Round robin</b> vs <b>Least connections</b>.
      </div>
    </div>
  );
}
