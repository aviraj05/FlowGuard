// ─── Load balancer view: who gets the requests? ───────────────────────────
import { Scale } from 'lucide-react';
import type { LabAlgo, LabTick } from '../../api/labTypes';
import { ALGO_LABEL, BACKEND_COLORS, BACKEND_NAMES } from './labUtils';

interface Props {
  ticks: LabTick[];
  algo: LabAlgo;
  slow: boolean;
  running: boolean;
}

const WINDOW = 30; // seconds used for the share bars

function insight(algo: LabAlgo, slow: boolean): { text: string; color: string } {
  if (slow && algo === 'roundrobin') {
    return { text: 'Round robin ignores speed: the slow server still gets about one third of the requests.', color: 'var(--amber)' };
  }
  if (slow && algo === 'leastconn') {
    return { text: 'Least connections notices srv1 is slow (its connections stay open) and steers requests away from it.', color: 'var(--green)' };
  }
  return { text: 'With equal servers both algorithms share the load almost evenly. Slow srv1 down to see the difference.', color: 'var(--text-secondary)' };
}

export default function LoadBalancerPanel({ ticks, algo, slow, running }: Props) {
  const recent = ticks.slice(-WINDOW);
  const latest = ticks.length > 0 ? ticks[ticks.length - 1] : null;
  const totals = BACKEND_NAMES.map((n) => recent.reduce((s, t) => s + (t.backends[n]?.reqs ?? 0), 0));
  const sum = totals.reduce((a, b) => a + b, 0);
  const note = insight(algo, slow);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="section-header" style={{ marginBottom: 0 }}>
        <div className="section-title">
          <Scale size={14} />
          Load balancer (HAProxy)
        </div>
        <span
          className="mono"
          style={{
            fontSize: 'var(--text-2xs)', padding: '2px 8px', borderRadius: 4,
            background: 'var(--blue-dim)', color: 'var(--blue)', border: '1px solid var(--blue-border)',
          }}
        >
          {ALGO_LABEL[algo]}
        </span>
      </div>

      {BACKEND_NAMES.map((name, i) => {
        const pct = sum > 0 ? (totals[i] / sum) * 100 : 0;
        const bk = latest ? latest.backends[name] : undefined;
        const isSlow = slow && i === 0;
        const up = bk ? bk.up : true;
        return (
          <div key={name} className="backend-card" style={{ opacity: running ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`pulse-dot ${up ? 'healthy' : 'down'}`} />
                <span className="mono" style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{name}</span>
                <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>10.0.0.{11 + i}</span>
                {isSlow && (
                  <span
                    style={{
                      fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                      background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid var(--amber-border)',
                    }}
                  >
                    SLOW +100 ms
                  </span>
                )}
              </div>
              <span className="mono" style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: BACKEND_COLORS[i] }}>
                {pct.toFixed(0)}%
              </span>
            </div>
            <div className="progress-track" style={{ height: 6 }}>
              <div className="progress-fill" style={{ width: `${pct}%`, background: BACKEND_COLORS[i] }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
              <span>open connections: <b className="mono" style={{ color: 'var(--text-secondary)' }}>{bk ? bk.active : 0}</b></span>
              <span>served: <b className="mono" style={{ color: 'var(--text-secondary)' }}>{bk ? bk.total : 0}</b></span>
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: 'var(--text-xs)', color: note.color, lineHeight: 1.45 }}>
        {note.text}
      </div>
      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
        Share of requests completed in the last {WINDOW} s.
      </div>
    </div>
  );
}
