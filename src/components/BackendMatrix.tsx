// ─── Backend Health Matrix ────────────────────────────────────────────────
import { AlertTriangle, Cpu, Gauge, PowerOff, RefreshCw, Server, Zap } from 'lucide-react';
import type { BackendServer } from '../types';

interface BackendMatrixProps {
  backends: BackendServer[];
  onToggleFail: (id: string) => void;
}

const BACKEND_COLORS = ['#22c55e', '#3b82f6', '#f59e0b'] as const;

function MetricRow({
  icon, label, value, valueColor, trackValue, trackMax = 100,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor: string;
  trackValue: number;
  trackMax?: number;
}) {
  const pct = Math.min((trackValue / trackMax) * 100, 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {icon} {label}
        </span>
        <span className="mono" style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: valueColor }}>
          {value}
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%`, background: valueColor }} />
      </div>
    </div>
  );
}

function BackendCard({
  backend, index, onToggleFail,
}: {
  backend: BackendServer;
  index: number;
  onToggleFail: (id: string) => void;
}) {
  const accentColor = BACKEND_COLORS[index] ?? '#8899b4';
  const isDown = backend.status === 'down';

  const cpuColor = backend.cpuPercent > 85 ? 'var(--red)' : backend.cpuPercent > 65 ? 'var(--amber)' : 'var(--green)';
  const latencyColor = backend.latencyMs > 500 ? 'var(--red)' : backend.latencyMs > 200 ? 'var(--amber)' : 'var(--green)';
  const errColor = backend.errorRate > 5 ? 'var(--red)' : backend.errorRate > 2 ? 'var(--amber)' : 'var(--text-secondary)';

  return (
    <article
      className={`backend-card ${backend.status}`}
      id={`backend-card-${backend.id}`}
      aria-label={`${backend.label} — ${backend.status}`}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span className={`pulse-dot ${backend.status}`} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              {backend.label}
            </span>
            <span className={`status-label ${backend.status}`}>{backend.status}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
              {backend.ip}:{backend.port}
            </span>
            {/* Weight dots */}
            <div
              aria-label={`Load weight: ${backend.weight}`}
              style={{ display: 'flex', gap: 2, alignItems: 'center' }}
            >
              {Array.from({ length: 5 }).map((_, j) => (
                <div
                  key={j}
                  style={{
                    width: 4, height: 4, borderRadius: 1,
                    background: j < backend.weight ? accentColor : 'var(--border-muted)',
                    opacity: j < backend.weight ? 0.9 : 0.3,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <button
          id={`fail-toggle-${backend.id}`}
          onClick={() => onToggleFail(backend.id)}
          className={backend.manuallyFailed ? 'btn btn-success' : 'btn btn-danger'}
          title={backend.manuallyFailed ? 'Restore this backend' : 'Simulate a failure'}
          aria-label={backend.manuallyFailed ? `Restore ${backend.label}` : `Fail ${backend.label}`}
          style={{ flexShrink: 0 }}
        >
          {backend.manuallyFailed
            ? <><RefreshCw size={10} /> Restore</>
            : <><PowerOff size={10} /> Fail</>
          }
        </button>
      </div>

      {/* Metrics — only when not fully down */}
      {!isDown ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <MetricRow
            icon={<Gauge size={10} />}
            label="Latency"
            value={`${backend.latencyMs}ms`}
            valueColor={latencyColor}
            trackValue={backend.latencyMs}
            trackMax={1000}
          />
          <MetricRow
            icon={<Cpu size={10} />}
            label="CPU"
            value={`${backend.cpuPercent.toFixed(0)}%`}
            valueColor={cpuColor}
            trackValue={backend.cpuPercent}
            trackMax={100}
          />

          {/* Inline stats row */}
          <div style={{ display: 'flex', gap: 6, paddingTop: 2 }}>
            <div style={{
              flex: 1, padding: '5px 8px', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                <Zap size={9} /> RPS
              </div>
              <span className="mono" style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>
                {backend.requestsPerSec}
              </span>
            </div>
            <div style={{
              flex: 1, padding: '5px 8px', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                <AlertTriangle size={9} /> Err%
              </div>
              <span className="mono" style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: errColor }}>
                {backend.errorRate.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          padding: '10px 12px', borderRadius: 'var(--radius-sm)',
          background: 'var(--red-dim)',
          border: '1px dashed var(--red-border)',
          display: 'flex', alignItems: 'center', gap: 7,
        }}>
          <PowerOff size={12} color="var(--red)" />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--red)', fontWeight: 500 }}>
            {backend.manuallyFailed ? 'Manually taken offline' : 'Connection refused'}
          </span>
        </div>
      )}
    </article>
  );
}

export default function BackendMatrix({ backends, onToggleFail }: BackendMatrixProps) {
  const healthyCount = backends.filter(b => b.status === 'healthy').length;
  const downCount    = backends.filter(b => b.status === 'down').length;

  return (
    <section className="card" aria-label="Backend health matrix" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-4)' }}>

      {/* Panel header */}
      <div className="section-header" style={{ marginBottom: 0 }}>
        <h2 className="section-title">
          <Server size={13} />
          Backend Health
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--green)', fontWeight: 500 }}>
            {healthyCount} healthy
          </span>
          {downCount > 0 && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--red)', fontWeight: 500 }}>
              · {downCount} down
            </span>
          )}
        </div>
      </div>

      {/* Backend cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1 }}>
        {backends.map((b, i) => (
          <BackendCard key={b.id} backend={b} index={i} onToggleFail={onToggleFail} />
        ))}
      </div>

      {/* Load-balancing algorithm footer */}
      <div style={{
        borderTop: '1px solid var(--border-subtle)',
        paddingTop: 'var(--space-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          Weighted Round-Robin
        </span>
        {/* Weight visualization */}
        <div aria-label="Weight distribution" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {backends.map((b, i) => (
            <div key={b.id} style={{ display: 'flex', gap: 2 }}>
              {Array.from({ length: b.weight }).map((_, j) => (
                <div
                  key={j}
                  style={{
                    width: 5, height: 8, borderRadius: 2,
                    background: b.status === 'down'
                      ? 'var(--border-subtle)'
                      : BACKEND_COLORS[i],
                    opacity: b.status === 'down' ? 0.3 : 0.75,
                    transition: 'background var(--duration-slow) ease',
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
