// ─── Live response-time chart (plain SVG) ─────────────────────────────────
import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Activity } from 'lucide-react';
import type { LabTick } from '../../api/labTypes';
import { fmtMs } from './labUtils';

const CAP = 120; // seconds shown
const W = 760;
const H = 280;
const M = { l: 48, r: 14, t: 16, b: 28 };

function niceMax(v: number): number {
  const steps = [10, 20, 50, 100, 200, 300, 500, 1000, 2000];
  for (const s of steps) if (v * 1.1 <= s) return s;
  return Math.ceil((v * 1.1) / 1000) * 1000;
}

interface Props {
  ticks: LabTick[];
}

export default function LatencyChart({ ticks }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const data = ticks.slice(-CAP);
  const offset = CAP - data.length;
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;
  const xAt = (i: number) => M.l + ((i + offset) / (CAP - 1)) * plotW;

  const vals = data.map((d) => d.p95_ms ?? d.mean_ms ?? 0);
  const yMax = niceMax(Math.max(10, ...vals));
  const yAt = (v: number) => M.t + plotH - (Math.min(v, yMax) / yMax) * plotH;
  const maxRps = Math.max(1, ...data.map((d) => d.rps));

  const line = (pick: (d: LabTick) => number | null): string => {
    let d = '';
    let pen = false;
    data.forEach((t, i) => {
      const v = pick(t);
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };

  // attack shading + markers
  const shades: { x1: number; x2: number }[] = [];
  const markers: { x: number; label: string; color: string }[] = [];
  data.forEach((t, i) => {
    const prev = i > 0 ? data[i - 1] : null;
    if (t.attack && (!prev || !prev.attack)) {
      shades.push({ x1: xAt(i), x2: xAt(i) });
      markers.push({ x: xAt(i), label: 'ATTACK', color: '#ef4444' });
    }
    if (t.attack && shades.length > 0) shades[shades.length - 1].x2 = xAt(i);
    if (t.blocked.length > 0 && (!prev || prev.blocked.length === 0)) {
      markers.push({ x: xAt(i), label: 'BLOCKED', color: '#22c55e' });
    }
  });

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((px - M.l) / plotW) * (CAP - 1)) - offset;
    setHover(idx >= 0 && idx < data.length ? idx : null);
  };

  const hv = hover !== null ? data[hover] : null;
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 340 }}>
      <div className="section-header">
        <div className="section-title">
          <Activity size={14} />
          Legitimate-client response time (live)
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
          <span><span style={{ color: '#3b82f6' }}>&#9632;</span> mean</span>
          <span><span style={{ color: '#f59e0b' }}>&#9632;</span> p95</span>
          <span><span style={{ color: 'rgba(129,140,248,0.6)' }}>&#9632;</span> completed req/s</span>
          <span><span style={{ color: 'rgba(239,68,68,0.5)' }}>&#9632;</span> attack</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', flex: 1 }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Response time over the last two minutes"
      >
        {grid.map((g) => {
          const y = M.t + plotH - g * plotH;
          return (
            <g key={g}>
              <line x1={M.l} x2={W - M.r} y1={y} y2={y} stroke="#1a2236" strokeWidth={1} />
              <text x={M.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#4a5a72">
                {Math.round(g * yMax)}
              </text>
            </g>
          );
        })}
        <text x={12} y={M.t + plotH / 2} fontSize={10} fill="#4a5a72" transform={`rotate(-90 12 ${M.t + plotH / 2})`} textAnchor="middle">
          ms
        </text>

        {shades.map((s, i) => (
          <rect key={i} x={s.x1} y={M.t} width={Math.max(2, s.x2 - s.x1)} height={plotH} fill="rgba(239,68,68,0.10)" />
        ))}

        {data.map((t, i) => (
          <rect
            key={i}
            x={xAt(i) - 2}
            y={M.t + plotH - (t.rps / maxRps) * plotH * 0.2}
            width={4}
            height={(t.rps / maxRps) * plotH * 0.2}
            fill="rgba(129,140,248,0.35)"
          />
        ))}

        <path d={line((t) => t.p95_ms)} fill="none" stroke="#f59e0b" strokeWidth={1.2} opacity={0.7} />
        <path d={line((t) => t.mean_ms)} fill="none" stroke="#3b82f6" strokeWidth={2.2} />

        {markers.map((m, i) => (
          <g key={i}>
            <line x1={m.x} x2={m.x} y1={M.t} y2={M.t + plotH} stroke={m.color} strokeDasharray="4 3" strokeWidth={1.2} />
            <text
              x={m.x > W - 80 ? m.x - 4 : m.x + 4}
              y={M.t + (m.label === 'BLOCKED' ? 22 : 10)}
              textAnchor={m.x > W - 80 ? 'end' : 'start'}
              fontSize={9} fontWeight={700} fill={m.color}
            >
              {m.label}
            </text>
          </g>
        ))}

        {data.length === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={12} fill="#4a5a72">
            Start the lab to see live data
          </text>
        )}

        <text x={M.l} y={H - 8} fontSize={10} fill="#4a5a72">&minus;{CAP}s</text>
        <text x={W - M.r} y={H - 8} fontSize={10} fill="#4a5a72" textAnchor="end">now</text>

        {hv && hover !== null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={M.t} y2={M.t + plotH} stroke="#8899b4" strokeWidth={1} opacity={0.6} />
            <rect x={Math.min(xAt(hover) + 8, W - 190)} y={M.t + 4} width={176} height={52} rx={5} fill="#141c2e" stroke="#22304a" />
            <text x={Math.min(xAt(hover) + 16, W - 182)} y={M.t + 20} fontSize={10} fill="#e8edf5">
              t = {hv.t.toFixed(0)} s
            </text>
            <text x={Math.min(xAt(hover) + 16, W - 182)} y={M.t + 33} fontSize={10} fill="#3b82f6">
              mean {fmtMs(hv.mean_ms)} · p95 {fmtMs(hv.p95_ms)}
            </text>
            <text x={Math.min(xAt(hover) + 16, W - 182)} y={M.t + 46} fontSize={10} fill="#8899b4">
              {hv.ok} completed{hv.fail > 0 ? `, ${hv.fail} failed` : ''}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
