/** Lightweight SVG charts (no chart library). */
import { useEffect, useRef, useState } from 'react';

export interface Series {
  name: string;
  color: string;
  points: [number, number | null][];
  area?: boolean;
}

export interface Band {
  from: number;
  to: number;
  label?: string;
  tone?: 'danger' | 'ok';
}

export interface Marker {
  x: number;
  label: string;
  tone?: 'danger' | 'ok' | 'muted';
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function LineChart({
  series, height = 240, bands = [], markers = [], unit = '', xFormat, yMin = 0, emptyText = 'Waiting for data…',
}: {
  series: Series[]; height?: number; bands?: Band[]; markers?: Marker[]; unit?: string;
  xFormat: (x: number) => string; yMin?: number; emptyText?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]).filter((v): v is number => v !== null);

  const geo = (() => {
    if (!xs.length) return null;
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs, x0 + 1);
    const y1 = niceMax(Math.max(...ys, 1) * 1.08);
    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * iw;
    const sy = (y: number) => pad.t + ih - ((y - yMin) / (y1 - yMin)) * ih;
    return { x0, x1, y1, iw, ih, sx, sy };
  })();

  if (!geo) {
    return <div ref={ref} className="chart-empty" style={{ height }}>{emptyText}</div>;
  }
  const { x0, x1, y1, ih, sx, sy } = geo;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (y1 - yMin));
  const xTicks = Array.from({ length: 5 }, (_, i) => x0 + (i / 4) * (x1 - x0));

  const pathFor = (pts: [number, number | null][]) => {
    let d = '';
    let pen = false;
    for (const [x, y] of pts) {
      if (y === null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const ref0 = series[0]?.points ?? [];
  const hoverPt = hover !== null ? ref0[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    let best = 0;
    let bd = Infinity;
    ref0.forEach((p, i) => {
      const d = Math.abs(sx(p[0]) - x);
      if (d < bd) { bd = d; best = i; }
    });
    setHover(ref0.length ? best : null);
  };

  return (
    <div ref={ref} className="chart" style={{ height }}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`g-${i}-${s.color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {bands.map((b, i) => {
          const a = Math.max(sx(b.from), sx(x0));
          const z = Math.min(sx(b.to), sx(x1));
          if (z <= a) return null;
          return (
            <g key={i}>
              <rect x={a} y={pad.t} width={z - a} height={ih} className={`band band-${b.tone ?? 'danger'}`} />
              {b.label && <text x={a + 6} y={pad.t + 14} className="band-label">{b.label}</text>}
            </g>
          );
        })}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={width - pad.r} y1={sy(v)} y2={sy(v)} className="grid" />
            <text x={pad.l - 8} y={sy(v) + 4} className="axis" textAnchor="end">{y1 < 10 ? Number(v.toFixed(1)) : Math.round(v)}</text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <text key={i} x={sx(v)} y={height - 6} className="axis"
            textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{xFormat(v)}</text>
        ))}
        {series.map((s, i) => s.area && (
          <path key={`a${i}`} fill={`url(#g-${i}-${s.color.replace('#', '')})`}
            d={`${pathFor(s.points)}L${sx(s.points[s.points.length - 1][0])},${sy(yMin)}L${sx(s.points[0][0])},${sy(yMin)}Z`} />
        ))}
        {series.map((s, i) => (
          <path key={`l${i}`} d={pathFor(s.points)} fill="none" stroke={s.color} strokeWidth={1.75} strokeLinejoin="round" />
        ))}
        {markers.map((m, i) => (
          <g key={`m${i}`}>
            <line x1={sx(m.x)} x2={sx(m.x)} y1={pad.t} y2={pad.t + ih} className={`marker marker-${m.tone ?? 'muted'}`} />
            <text x={sx(m.x) + 5} y={pad.t + ih - 6} className={`marker-label marker-${m.tone ?? 'muted'}`}>{m.label}</text>
          </g>
        ))}
        {hoverPt && (
          <line x1={sx(hoverPt[0])} x2={sx(hoverPt[0])} y1={pad.t} y2={pad.t + ih} className="hover-line" />
        )}
        {hover !== null && series.map((s, i) => {
          const p = s.points[hover];
          return p && p[1] !== null ? <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r={3.5} fill={s.color} className="hover-dot" /> : null;
        })}
      </svg>
      {hoverPt && (
        <div className="tooltip" style={{ left: Math.min(sx(hoverPt[0]) + 12, width - 170), top: 12 }}>
          <div className="tooltip-title">{xFormat(hoverPt[0])}</div>
          {series.map((s, i) => {
            const p = s.points[hover!];
            return (
              <div key={i} className="tooltip-row">
                <span className="dot" style={{ background: s.color }} />
                <span>{s.name}</span>
                <b>{p && p[1] !== null ? `${p[1] >= 10 ? Math.round(p[1]) : p[1].toFixed(1)}${unit}` : '—'}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, color = 'var(--accent)', width = 96, height = 28 }: {
  values: number[]; color?: string; width?: number; height?: number;
}) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} className="spark">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
