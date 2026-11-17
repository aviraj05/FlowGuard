// ─── Mininet Lab view: load balancing + ML attack prevention, live ────────
import type { ReactNode } from 'react';
import { AlertTriangle, Server, ShieldCheck, Terminal, Timer, Zap } from 'lucide-react';
import { isSessionRunning, useLab } from '../../hooks/useLab';
import { LAB_URL } from '../../api/lab';
import type { LabAlgo, LabDefence, LabTick } from '../../api/labTypes';
import DetectorPanel from './DetectorPanel';
import EpisodeTable from './EpisodeTable';
import LabControls from './LabControls';
import LabTopology from './LabTopology';
import LatencyChart from './LatencyChart';
import LoadBalancerPanel from './LoadBalancerPanel';
import { ALGO_LABEL, BACKEND_NAMES, fmtMs, latencyColor } from './labUtils';

/**
 * Seconds from the moment blocking was possible (attack start, or when "Detect + block"
 * was switched on during the attack) to the first tick where the attacker is blocked.
 */
function liveDetectDelay(ticks: LabTick[]): number | null {
  let last = ticks.length - 1;
  while (last >= 0 && !ticks[last].attack) last--;
  if (last < 0) return null;
  let first = last;
  while (first > 0 && ticks[first - 1].attack) first--;
  let ref = -1;
  for (let i = first; i <= last; i++) {
    if (ref < 0 && ticks[i].defence === 'protect') ref = i;
    if (ref >= 0 && ticks[i].blocked.length > 0) return ticks[i].ts - ticks[ref].ts;
  }
  return null;
}

function Kpi({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: ReactNode }) {
  return (
    <div className="card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {icon}
        {label}
      </div>
      <div className="mono" style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  );
}

export default function LabView() {
  const { state, busy, actionError, start, stop, command, clearHistory } = useLab();
  const latest = state.ticks.length > 0 ? state.ticks[state.ticks.length - 1] : null;
  const phase = state.status ? state.status.phase : 'idle';
  const running = isSessionRunning(state.status);
  const ready = phase === 'ready';
  const simulated = state.status ? state.status.simulated : false;

  const cfg = state.status ? state.status.config : null;
  const algo: LabAlgo = latest ? latest.algo : cfg ? cfg.algo : 'roundrobin';
  const defence: LabDefence = latest ? latest.defence : cfg ? cfg.defence : 'off';
  const slow = latest ? latest.slow : cfg ? cfg.slow : false;
  const uplink = latest ? latest.uplink : cfg ? cfg.uplink : 10;
  const attacking = latest ? latest.attack : false;
  const blockedList = latest ? latest.blocked : [];
  const anyBlocked = blockedList.length > 0;

  const recent = state.ticks.slice(-30);
  const totals = BACKEND_NAMES.map((n) => recent.reduce((s, t) => s + (t.backends[n] ? t.backends[n].reqs : 0), 0));
  const sum = totals.reduce((a, b) => a + b, 0);
  const shares = totals.map((t) => (sum > 0 ? t / sum : 0));

  const lastEpisode = state.episodes.length > 0 ? state.episodes[state.episodes.length - 1] : null;
  const live = attacking ? liveDetectDelay(state.ticks) : null;
  const delayText =
    live !== null
      ? live < 1 ? '<1 s' : `~${live.toFixed(0)} s`
      : lastEpisode && lastEpisode.detect_delay_s !== null
      ? `${lastEpisode.detect_delay_s} s`
      : '\u2014';
  const netStatus = !running ? 'LAB OFF' : attacking && anyBlocked ? 'ATTACK BLOCKED' : attacking ? 'UNDER ATTACK' : 'NORMAL';
  const netColor = !running ? 'var(--text-muted)' : attacking && !anyBlocked ? 'var(--red)' : 'var(--green)';

  if (state.agent !== 'online' && state.ticks.length === 0 && state.status === null) {
    return (
      <div className="card" style={{ maxWidth: 760, margin: '1rem auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="section-title">
          <Terminal size={14} />
          {state.agent === 'connecting' ? 'Connecting to the lab agent\u2026' : 'Lab agent not reachable'}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          The Mininet lab runs inside the Linux VM. Start its agent there, then this page connects automatically:
        </div>
        <pre className="mono" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12, fontSize: 'var(--text-xs)', color: 'var(--green)', overflowX: 'auto' }}>
{`cd ~
sudo python3 lab_agent.py`}
        </pre>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Also check that VirtualBox forwards <span className="mono">host port 8765 &rarr; guest port 8765</span>
          {' '}(this page is trying <span className="mono">{LAB_URL}</span>).
        </div>
      </div>
    );
  }

  return (
    <main style={{ flex: 1, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 1800, margin: '0 auto', width: '100%' }}>
      {simulated && (
        <div role="status" style={{ background: 'var(--amber-dim)', border: '1px solid var(--amber-border)', color: 'var(--amber)', borderRadius: 8, padding: '6px 12px', fontSize: 'var(--text-xs)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={14} />
          <span><b>SIMULATED PREVIEW</b> &mdash; this data is synthetic and is not a measurement. Use &ldquo;Start Mininet lab&rdquo; for real results.</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '1rem' }}>
        <Kpi
          label="Response time" icon={<Timer size={11} />}
          value={latest ? fmtMs(latest.mean_ms) : '\u2014'}
          color={latencyColor(latest ? latest.mean_ms : null)}
          sub={latest ? `p95 ${fmtMs(latest.p95_ms)}` : 'legitimate clients'}
        />
        <Kpi
          label="Completed requests" icon={<Server size={11} />}
          value={latest ? `${latest.ok}/s` : '\u2014'}
          color="var(--text-primary)"
          sub={latest ? `${latest.fail} failed this second` : 'per second'}
        />
        <Kpi
          label="Network status" icon={<ShieldCheck size={11} />}
          value={netStatus} color={netColor}
          sub={attacking && !anyBlocked && latest && latest.attacker_pps ? `${latest.attacker_pps.toLocaleString()} attack pkts/s` : anyBlocked ? 'attacker dropped at switch s1' : 'no attack in progress'}
        />
        <Kpi
          label="Last detection delay" icon={<Zap size={11} />}
          value={delayText}
          color="var(--text-primary)"
          sub="attack start to blocked"
        />
        <Kpi
          label="Load balancer" icon={<Server size={11} />}
          value={ALGO_LABEL[algo]} color="var(--blue)"
          sub={`uplink ${uplink} Mbit/s${slow ? ' \u00b7 srv1 slow' : ''}`}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1rem' }}>
        <LatencyChart ticks={state.ticks} />
        <LabControls
          agent={state.agent} health={state.health} status={state.status}
          running={running} ready={ready}
          algo={algo} slow={slow} defence={defence} attacking={attacking} anyBlocked={anyBlocked}
          busy={busy} error={actionError}
          onStart={(c) => { void start(c); }} onStop={() => { void stop(); }} onCommand={(c) => { void command(c); }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 1fr)', gap: '1rem' }}>
        <LabTopology
          running={running} attack={attacking} blocked={anyBlocked}
          uplink={uplink} algo={algo} slow={slow} defence={defence} shares={shares}
        />
        <LoadBalancerPanel ticks={state.ticks} algo={algo} slow={slow} running={running} />
        <DetectorPanel
          detector={state.detector} events={state.events} defence={defence}
          blocked={blockedList} latestTs={latest ? latest.ts : null} running={running}
        />
      </div>

      <EpisodeTable episodes={state.episodes} onClear={() => { void clearHistory(); }} />
    </main>
  );
}
