import { useState } from 'react';
import type { LabAttackKind, LabDefence } from '../api/labTypes';
import { attackName, clock, dateTime, ms, num, secs } from '../lib/format';
import { attackBands, blockMarkers, latencySeries } from '../lib/derive';
import { useFG } from '../state/store';
import { LineChart } from '../ui/Chart';
import { Icon } from '../ui/Icon';
import { ErrorNotice, StartMonitoring } from '../ui/LabSession';
import { Card, Empty, Notice, PageHead, Seg } from '../ui/parts';

const DEFENCE_TEXT: Record<LabDefence, string> = {
  off: 'Off: FlowGuard does nothing. Shows the damage an attack causes.',
  monitor: 'Monitor: attacks are detected and alerted on, but not blocked.',
  protect: 'Protect: attacks are detected, blocked at the switch and alerted on.',
};

export default function Drills() {
  const fg = useFG();
  const [kind, setKind] = useState<LabAttackKind>('udp');
  const [len, setLen] = useState('30');
  const last = fg.lastTick;
  const ready = fg.running && fg.status?.phase === 'ready';
  const attacking = !!last?.attack;
  const defence: LabDefence = last?.defence ?? 'protect';
  const lat = latencySeries(fg.ticks);
  const episodes = [...fg.episodes].reverse();
  const attackerBlocked = (last?.blocked.length ?? 0) > 0;

  return (
    <div className="page">
      <PageHead title="Drills" sub="Test your defences safely: launch a simulated attack from a lab machine and watch FlowGuard respond."
        actions={fg.running ? (
          <button className="btn" disabled={fg.busy || fg.status?.phase === 'stopping'} onClick={() => fg.stop()}>
            <Icon name="stop" size={13} />Stop monitoring
          </button>
        ) : undefined} />
      <ErrorNotice />
      {fg.status?.phase === 'error' && <div style={{ marginBottom: 16 }}><Notice tone="danger">Session error: {fg.status.msg}</Notice></div>}
      {!fg.running && <StartMonitoring />}
      {fg.status?.phase === 'starting' && <div style={{ marginBottom: 16 }}><Notice>{fg.status.msg}</Notice></div>}

      <div className="grid grid-main" style={{ marginBottom: 16 }}>
        <Card title="Response time for users" sub="Live · shaded = attack · green line = attacker blocked"
          action={attacking ? (
            <span className={`pill ${attackerBlocked ? 'pill-ok' : 'pill-danger'}`}>
              <span className={`dot ${attackerBlocked ? 'dot-ok' : 'dot-danger pulse'}`} />
              {attackerBlocked ? 'Attacker blocked' : `Attack running${last?.attacker_pps ? ` · ${num(last.attacker_pps)} pkt/s` : ''}`}
            </span>
          ) : undefined}>
          <LineChart height={300} unit=" ms" xFormat={clock}
            series={[{ name: 'Average', color: '#5AB8F0', points: lat.mean, area: true }, { name: 'Slowest 5%', color: '#9B87F5', points: lat.p95 }]}
            bands={attackBands(fg.ticks)} markers={blockMarkers(fg.ticks)}
            emptyText={fg.running ? 'Collecting the first samples…' : 'Start monitoring to run a drill'} />
          <div className="row-wrap" style={{ marginTop: 14, gap: 24 }}>
            <span className="muted">Average now <b className="num" style={{ color: 'var(--text)' }}>{ms(last?.mean_ms)}</b></span>
            <span className="muted">Requests/s <b className="num" style={{ color: 'var(--text)' }}>{last ? last.rps : '—'}</b></span>
            <span className="muted">Failed <b className="num" style={{ color: 'var(--text)' }}>{last ? last.fail : '—'}</b></span>
          </div>
        </Card>

        <Card title="Run a drill" sub="Attacker: Lab-3 PC-14 → Campus gateway">
          <div className="stack">
            <div className="field">
              <label>Protection</label>
              <Seg value={defence} disabled={!ready || fg.busy} onChange={(v) => fg.command({ cmd: 'set_defence', mode: v })}
                options={[{ value: 'off', label: 'Off' }, { value: 'monitor', label: 'Monitor' }, { value: 'protect', label: 'Protect' }]} />
              <div className="muted" style={{ fontSize: 12.5 }}>{DEFENCE_TEXT[defence]}</div>
            </div>
            <div className="field">
              <label>Attack type</label>
              <Seg value={kind} disabled={attacking} onChange={setKind}
                options={[{ value: 'udp', label: 'UDP flood' }, { value: 'syn', label: 'SYN flood' }, { value: 'icmp', label: 'ICMP flood' }]} />
            </div>
            <div className="field">
              <label>Duration</label>
              <Seg value={len} disabled={attacking} onChange={setLen}
                options={[{ value: '15', label: '15 s' }, { value: '30', label: '30 s' }, { value: '45', label: '45 s' }]} />
            </div>
            {attacking ? (
              <button className="btn btn-lg" disabled={fg.busy} onClick={() => fg.command({ cmd: 'attack_stop' })}>
                <Icon name="stop" size={14} />Stop attack
              </button>
            ) : (
              <button className="btn btn-danger btn-lg" disabled={!ready || fg.busy}
                onClick={() => fg.command({ cmd: 'attack_start', attack: kind, length: Number(len) })}>
                <Icon name="zap" size={15} />Launch {attackName(kind)}
              </button>
            )}
            {attackerBlocked && !attacking && (
              <button className="btn btn-sm" disabled={fg.busy} onClick={() => fg.command({ cmd: 'unblock' })}><Icon name="unlock" size={13} />Release block</button>
            )}
            <div className="faint" style={{ fontSize: 12 }}>
              {fg.source === 'simulated' ? 'Simulated network: numbers are modelled, not measured.' :
                fg.source === 'live' ? 'Real Mininet network: attack traffic stays inside the isolated lab.' : ''}
            </div>
          </div>
        </Card>
      </div>

      <Card title="Drill history" sub="Each attack and how users were affected"
        action={episodes.length > 0 && fg.source !== 'demo' ? <button className="btn btn-ghost btn-sm" onClick={() => fg.clearHistory()}><Icon name="trash" size={13} />Clear</button> : undefined}
        bodyClass="table-wrap">
        {episodes.length === 0 ? (
          <Empty icon="drills" title="No drills yet">Launch an attack above to see how FlowGuard responds.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th><th>Attack</th><th>Protection</th>
                <th className="r">Before</th><th className="r">During</th><th className="r hide-sm">After block</th>
                <th className="r hide-sm">Time to block</th><th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((e) => (
                <tr key={`${e.id}-${e.ts}`}>
                  <td className="muted">{dateTime(e.ts)}</td>
                  <td>{attackName(e.attack)} <span className="faint">· {Math.round(e.length_s)} s</span></td>
                  <td className="muted" style={{ textTransform: 'capitalize' }}>{String(e.defence).replace('>', ' → ')}</td>
                  <td className="r num">{ms(e.baseline_ms)}</td>
                  <td className={`r num ${e.attack_ms !== null && e.baseline_ms !== null && e.attack_ms > e.baseline_ms * 5 ? 'danger' : ''}`}>{ms(e.attack_ms)}</td>
                  <td className="r num hide-sm">{ms(e.after_ms)}</td>
                  <td className="r num hide-sm">{secs(e.detect_delay_s)}</td>
                  <td>
                    {e.blocked
                      ? <span className="status ok"><Icon name="shieldCheck" size={14} />Blocked</span>
                      : String(e.defence).includes('monitor')
                        ? <span className="status warn"><Icon name="eye" size={14} />Detected only</span>
                        : <span className="status danger"><Icon name="shieldAlert" size={14} />Not stopped</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
