import type { Device, Incident, LabTick } from '../api/labTypes';
import type { Band, Marker } from '../ui/Chart';
import { median } from './format';

export const SERVERS = ['srv1', 'srv2', 'srv3'] as const;

export function attackBands(ticks: LabTick[]): Band[] {
  const out: Band[] = [];
  let start: number | null = null;
  for (const t of ticks) {
    if (t.attack && start === null) start = t.ts - 0.5;
    if (!t.attack && start !== null) {
      out.push({ from: start, to: t.ts - 0.5, label: 'attack' });
      start = null;
    }
  }
  if (start !== null && ticks.length) out.push({ from: start, to: ticks[ticks.length - 1].ts + 0.5, label: 'attack' });
  return out;
}

export function blockMarkers(ticks: LabTick[]): Marker[] {
  const out: Marker[] = [];
  for (let i = 1; i < ticks.length; i++) {
    if (ticks[i].blocked.length > ticks[i - 1].blocked.length) out.push({ x: ticks[i].ts, label: 'blocked', tone: 'ok' });
  }
  return out;
}

export interface ServerStat {
  id: string;
  name: string;
  owner: string;
  share: number;
  reqs: number;
  active: number;
  total: number;
  up: boolean;
  slow: boolean;
}

export function serverStats(ticks: LabTick[], devices: Device[], window = 30): ServerStat[] {
  const recent = ticks.slice(-window);
  const last = ticks[ticks.length - 1];
  const totals: Record<string, number> = {};
  for (const t of recent) for (const s of SERVERS) totals[s] = (totals[s] ?? 0) + (t.backends[s]?.reqs ?? 0);
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  return SERVERS.map((s) => {
    const d = devices.find((x) => x.host === s);
    return {
      id: s, name: d?.name ?? s, owner: d?.owner ?? '',
      share: (totals[s] ?? 0) / sum, reqs: totals[s] ?? 0,
      active: last?.backends[s]?.active ?? 0, total: last?.backends[s]?.total ?? 0,
      up: last?.backends[s]?.up ?? true, slow: s === 'srv1' && !!last?.slow,
    };
  });
}

export function inRange(incidents: Incident[], seconds: number): Incident[] {
  const from = Date.now() / 1000 - seconds;
  return incidents.filter((i) => i.opened >= from);
}

export function rangeStats(incidents: Incident[]) {
  const blocked = incidents.filter((i) => i.blocked_at && !i.false_positive);
  const delays = blocked.map((i) => i.impact.detect_delay_s).filter((v): v is number => v !== null);
  const protectedReqs = blocked.reduce((a, i) => a + (i.impact.completed ?? 0), 0);
  return {
    total: incidents.length,
    blocked: blocked.length,
    medianDelay: median(delays),
    protectedReqs,
    open: incidents.filter((i) => i.status !== 'resolved').length,
  };
}

export function latencySeries(ticks: LabTick[]) {
  return {
    mean: ticks.map((t) => [t.ts, t.mean_ms] as [number, number | null]),
    p95: ticks.map((t) => [t.ts, t.p95_ms] as [number, number | null]),
  };
}

export function deviceStatus(d: Device, last: LabTick | null, flagged: Set<string>): 'blocked' | 'flagged' | 'ok' | 'slow' {
  if (last?.blocked.includes(d.ip)) return 'blocked';
  if (flagged.has(d.ip)) return 'flagged';
  if (d.host === 'srv1' && last?.slow) return 'slow';
  return 'ok';
}
