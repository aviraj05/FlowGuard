import type { Incident, LabAttackKind, Severity } from '../api/labTypes';

export const ATTACK_NAMES: Record<string, string> = {
  udp: 'UDP flood', syn: 'SYN flood', icmp: 'ICMP flood', scan: 'Port scan',
};

export function attackName(kind: LabAttackKind | 'scan' | null | undefined): string {
  return kind ? ATTACK_NAMES[kind] ?? 'Traffic flood' : 'Traffic flood';
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v >= 10 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`;
}

export function secs(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(1)} s`;
}

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return Math.round(v).toLocaleString('en-IN');
}

export function clock(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function dateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = Date.now() / 1000 - ts;
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
}

export function duration(from: number | null, to: number | null): string {
  if (!from) return '—';
  const d = Math.max(0, (to ?? Date.now() / 1000) - from);
  if (d < 60) return `${Math.round(d)} s`;
  if (d < 3600) return `${Math.floor(d / 60)} min ${Math.round(d % 60)} s`;
  return `${Math.floor(d / 3600)} h ${Math.round((d % 3600) / 60)} min`;
}

export function incidentTitle(i: Incident): string {
  const verb = i.blocked_at ? 'blocked' : 'detected';
  return `${attackName(i.kind)} ${verb} from ${i.src_name}`;
}

export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium' };

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
