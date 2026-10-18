// ─── Traffic & Routing Panel ──────────────────────────────────────────────
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { TrafficDataPoint, BackendServer } from '../types';
import { formatTime } from '../utils/helpers';

interface TrafficPanelProps {
  history: TrafficDataPoint[];
  backends: BackendServer[];
  totalRps: number;
}

// Each backend gets a consistent, distinct color
const BACKEND_COLORS = ['#22c55e', '#3b82f6', '#f59e0b'] as const;
const BACKEND_KEYS = ['backendA', 'backendB', 'backendC'] as const;

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-muted)',
      borderRadius: 'var(--radius-md)',
      padding: '8px 12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      minWidth: 130,
    }}>
      <div className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 6 }}>
        {formatTime(label)}
      </div>
      {payload.map((entry: any) => (
        <div key={entry.name} style={{
          display: 'flex', justifyContent: 'space-between',
          gap: 14, marginBottom: 2,
        }}>
          <span style={{ fontSize: 'var(--text-xs)', color: entry.color }}>{entry.name}</span>
          <span className="mono" style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: entry.color }}>
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Load distribution bars — shows each backend's current share */
function DistributionBars({ backends }: { backends: BackendServer[] }) {
  const activeTotal = backends.reduce((s, b) => s + (b.status !== 'down' ? b.requestsPerSec : 0), 0) || 1;

  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
      {backends.map((b, i) => {
        const pct = b.status === 'down' ? 0 : (b.requestsPerSec / activeTotal) * 100;
        const color = BACKEND_COLORS[i];
        const isDown = b.status === 'down';
        return (
          <div key={b.id} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 500 }}>
                {b.label}
              </span>
              <span className="mono" style={{
                fontSize: 'var(--text-xs)',
                color: isDown ? 'var(--red)' : color,
                fontWeight: 600,
              }}>
                {isDown ? 'offline' : `${b.requestsPerSec}`}
              </span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${pct}%`,
                  background: color,
                  opacity: isDown ? 0.25 : 1,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TrafficPanel({ history, backends, totalRps }: TrafficPanelProps) {
  const chartData = history.map(p => ({ ...p, time: p.timestamp }));

  return (
    <section className="card" aria-label="Real-time traffic panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
      {/* Header */}
      <div className="section-header" style={{ marginBottom: 0 }}>
        <h2 className="section-title">
          <TrendingUp size={13} />
          Traffic Distribution
        </h2>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span className="mono" style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
            {totalRps.toLocaleString()}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            req/s
          </span>
        </div>
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 2, right: 2, bottom: 0, left: -22 }}>
            <defs>
              {BACKEND_KEYS.map((key, i) => (
                <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={BACKEND_COLORS[i]} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={BACKEND_COLORS[i]} stopOpacity={0.01} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="time"
              tickFormatter={(v) => formatTime(v)}
              tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={false}
              interval={14}
            />
            <YAxis
              tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} />
            {BACKEND_KEYS.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={backends[i]?.label ?? key}
                stroke={BACKEND_COLORS[i]}
                strokeWidth={1.5}
                fill={`url(#grad-${key})`}
                dot={false}
                activeDot={{ r: 3, fill: BACKEND_COLORS[i], strokeWidth: 0 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Distribution bars */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-3)' }}>
        <DistributionBars backends={backends} />
      </div>
    </section>
  );
}
