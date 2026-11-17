// ─── Attack episodes: side-by-side comparison of runs ─────────────────────
import { History, Trash2 } from 'lucide-react';
import type { LabEpisode } from '../../api/labTypes';
import { ALGO_LABEL, fmtClock, fmtMs, latencyColor } from './labUtils';

interface Props {
  episodes: LabEpisode[];
  onClear: () => void;
}

function defenceText(d: string): string {
  if (d === 'off') return 'No defence';
  if (d === 'monitor') return 'Detect only';
  if (d === 'protect') return 'Detect + block';
  if (d === 'off>protect') return 'Off \u2192 Protect (switched mid-attack)';
  return d;
}

/** Compares the latest unprotected attack with the latest protected one (same link speed). */
function insight(eps: LabEpisode[]): string | null {
  const real = [...eps].reverse();
  const prot = real.find((e) => e.blocked && e.attack_ms !== null);
  if (!prot) return null;
  const bare = real.find((e) => !e.blocked && e.defence === 'off' && e.attack_ms !== null && e.uplink === prot.uplink && e.simulated === prot.simulated);
  if (!bare || bare.attack_ms === null || prot.attack_ms === null) return null;
  const factor = bare.attack_ms / Math.max(prot.attack_ms, 0.1);
  return `Without defence the attack pushed mean response time to ${fmtMs(bare.attack_ms)}; with ML detection and blocking it was ${fmtMs(prot.attack_ms)} (${factor.toFixed(0)}\u00d7 lower), blocked after ${prot.detect_delay_s ?? '?'} s.`;
}

export default function EpisodeTable({ episodes, onClear }: Props) {
  const rows = [...episodes].reverse().slice(0, 8);
  const note = insight(episodes);
  const th = { padding: '6px 8px', textAlign: 'left' as const, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const };
  const td = { padding: '7px 8px', fontSize: 'var(--text-xs)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' as const };

  return (
    <div className="card">
      <div className="section-header">
        <div className="section-title">
          <History size={14} />
          Attack runs (each attack you launch is recorded here)
        </div>
        <button className="btn btn-ghost" onClick={onClear} disabled={episodes.length === 0} style={{ fontSize: 'var(--text-2xs)' }}>
          <Trash2 size={11} />
          Clear
        </button>
      </div>

      {note && (
        <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--green-dim)', border: '1px solid var(--green-border)', color: 'var(--green)', fontSize: 'var(--text-xs)' }}>
          {note}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Time</th>
              <th style={th}>Attack</th>
              <th style={th}>Algorithm</th>
              <th style={th}>Defence</th>
              <th style={th}>Uplink</th>
              <th style={th}>Before</th>
              <th style={th}>During (mean)</th>
              <th style={th}>During (p95)</th>
              <th style={th}>Completed</th>
              <th style={th}>Blocked after</th>
              <th style={th}>After block</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td style={{ ...td, color: 'var(--text-muted)' }} colSpan={11}>
                  No attacks recorded yet. Launch one from the controls.
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={`${e.id}-${e.ts}`}>
                <td className="mono" style={td}>
                  {fmtClock(e.ts)}
                  {e.simulated && <span style={{ marginLeft: 6, color: 'var(--amber)', fontSize: 'var(--text-2xs)' }}>SIM</span>}
                </td>
                <td style={td}>{(e.attack ?? '-').toUpperCase()}</td>
                <td style={td}>{ALGO_LABEL[e.algo]}{e.slow ? ' (srv1 slow)' : ''}</td>
                <td style={td}>{defenceText(e.defence)}</td>
                <td className="mono" style={td}>{e.uplink} Mbit/s</td>
                <td className="mono" style={td}>{fmtMs(e.baseline_ms)}</td>
                <td className="mono" style={{ ...td, color: latencyColor(e.attack_ms), fontWeight: 700 }}>{fmtMs(e.attack_ms)}</td>
                <td className="mono" style={td}>{fmtMs(e.attack_p95_ms)}</td>
                <td className="mono" style={td}>{e.completed}</td>
                <td className="mono" style={td}>{e.detect_delay_s !== null ? `${e.detect_delay_s} s` : '\u2014'}</td>
                <td className="mono" style={{ ...td, color: latencyColor(e.after_ms) }}>{fmtMs(e.after_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
