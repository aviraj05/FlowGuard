// ─── Cache Metrics Panel ──────────────────────────────────────────────────
import { Database, HardDrive, RefreshCw, Timer, TrendingUp } from 'lucide-react';
import type { CacheMetrics } from '../types';
import { formatBytes } from '../utils/helpers';

interface CacheMetricsPanelProps {
  metrics: CacheMetrics;
  isLiveMode?: boolean;
}

/** Circular gauge for cache hit ratio */
function HitRatioGauge({ ratio }: { ratio: number }) {
  const size = 108;
  const strokeW = 7;
  const r = (size - strokeW * 2) / 2;
  const circ = 2 * Math.PI * r;
  const filled = circ * Math.min(ratio, 1);
  const pct = Math.round(ratio * 100);

  const color =
    ratio >= 0.8 ? 'var(--green)'
    : ratio >= 0.6 ? 'var(--blue)'
    : ratio >= 0.4 ? 'var(--amber)'
    : 'var(--red)';

  return (
    <div
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Cache hit ratio: ${pct}%`}
      style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }} aria-hidden>
        {/* Track */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="var(--border-muted)" strokeWidth={strokeW}
        />
        {/* Fill */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={strokeW}
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.55s cubic-bezier(0.4,0,0.2,1), stroke 0.4s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 1,
      }}>
        <span className="mono" style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color, lineHeight: 1 }}>
          {pct}%
        </span>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          hit ratio
        </span>
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{
      padding: '8px 10px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-inset)',
      border: '1px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-dim)' }}>
        {icon}
        <span style={{ fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
          {label}
        </span>
      </div>
      <span className="mono" style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: color || 'var(--text-primary)', lineHeight: 1 }}>
        {value}
      </span>
    </div>
  );
}

function ByteBar({ cache, backend }: { cache: number; backend: number }) {
  const total = cache + backend;
  const cachePct = total > 0 ? (cache / total) * 100 : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 500 }}>
          Bytes Served
        </span>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
          Total: {formatBytes(total)}
        </span>
      </div>

      {/* Segmented bar */}
      <div style={{ height: 4, borderRadius: 'var(--radius-full)', background: 'var(--border-subtle)', overflow: 'hidden', display: 'flex' }}>
        <div style={{
          width: `${cachePct}%`,
          background: 'var(--green)',
          transition: 'width 0.55s cubic-bezier(0.4,0,0.2,1)',
        }} />
        <div style={{ flex: 1, background: 'var(--blue)', opacity: 0.5 }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--green)' }}>
          ● Cache  {formatBytes(cache)}  ({cachePct.toFixed(0)}%)
        </span>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--blue)', opacity: 0.8 }}>
          ● Backend  {formatBytes(backend)}
        </span>
      </div>
    </div>
  );
}

export default function CacheMetricsPanel({ metrics, isLiveMode }: CacheMetricsPanelProps) {
  return (
    <section className="card" aria-label="Cache metrics" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-4)' }}>

      {/* Header */}
      <div className="section-header" style={{ marginBottom: 0 }}>
        <h2 className="section-title">
          <Database size={13} />
          Cache Performance
        </h2>
        {isLiveMode ? (
          <span
            className="mono"
            style={{
              fontSize: 'var(--text-2xs)', color: 'var(--amber)',
              background: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
              padding: '1px 6px', borderRadius: 3, fontWeight: 600,
            }}
          >
            UNINSTRUMENTED IN LIVE
          </span>
        ) : (
          <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            {metrics.totalEntries.toLocaleString()} entries (simulated)
          </span>
        )}
      </div>

      {/* Gauge + stat grid */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
        <HitRatioGauge ratio={metrics.hitRatio} />
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
          <StatTile
            icon={<TrendingUp size={10} />}
            label="Hits"
            value={metrics.totalHits.toLocaleString()}
            color="var(--green)"
          />
          <StatTile
            icon={<RefreshCw size={10} />}
            label="Misses"
            value={metrics.totalMisses.toLocaleString()}
          />
          <StatTile
            icon={<Timer size={10} />}
            label="TTL Exp."
            value={metrics.ttlExpirations.toLocaleString()}
            color="var(--amber)"
          />
          <StatTile
            icon={<HardDrive size={10} />}
            label="Evictions"
            value={metrics.evictions.toLocaleString()}
            color="var(--violet)"
          />
        </div>
      </div>

      {/* Spacer + byte comparison */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-3)', marginTop: 'auto' }}>
        <ByteBar cache={metrics.bytesFromCache} backend={metrics.bytesFromBackend} />
      </div>
    </section>
  );
}
