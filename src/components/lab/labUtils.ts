import type { LabAlgo } from '../../api/labTypes';

export const BACKEND_NAMES = ['srv1', 'srv2', 'srv3'] as const;
export const BACKEND_COLORS = ['#22c55e', '#3b82f6', '#f59e0b'] as const;

export const ALGO_LABEL: Record<LabAlgo, string> = {
  roundrobin: 'Round robin',
  leastconn: 'Least connections',
};

/** Colour for a response time: green = healthy, amber = slow, red = degraded. */
export function latencyColor(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'var(--text-muted)';
  if (ms < 25) return 'var(--green)';
  if (ms < 100) return 'var(--amber)';
  return 'var(--red)';
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '\u2014';
  return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
}

export function fmtClock(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toLocaleTimeString([], { hour12: false });
}

export function roleOf(ip: string): string {
  if (ip === '10.0.0.2') return 'Attacker';
  if (ip === '10.0.0.1') return 'Client';
  return 'Host';
}
