/**
 * Demo dataset shown when the lab agent is not reachable.
 * Numbers mirror the measured testbed results in the project report,
 * and every screen labels this data as DEMO.
 */
import type { Device, Incident, LabEpisode, LabTick, NotificationEntry, Severity } from '../api/labTypes';

export const DEMO_DEVICES: Device[] = [
  { ip: '10.0.0.1', host: 'client', name: 'Student laptop', role: 'client', location: 'Hostel Wi-Fi', owner: 'Students', critical: false },
  { ip: '10.0.0.2', host: 'attacker', name: 'Lab-3 PC-14', role: 'workstation', location: 'Computer Lab 3', owner: 'CS Department', critical: false },
  { ip: '10.0.0.10', host: 'lb', name: 'Campus gateway', role: 'gateway', location: 'Server room', owner: 'IT Services', critical: true },
  { ip: '10.0.0.11', host: 'srv1', name: 'Exam portal', role: 'server', location: 'Server room', owner: 'Exam Cell', critical: true },
  { ip: '10.0.0.12', host: 'srv2', name: 'ERP', role: 'server', location: 'Server room', owner: 'Admin Office', critical: true },
  { ip: '10.0.0.13', host: 'srv3', name: 'LMS', role: 'server', location: 'Server room', owner: 'Academics', critical: false },
];

const HOUR = 3600;

function rnd(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function demoTick(t: number, ts: number, r: () => number): LabTick {
  const mean = 3 + r() * 1.4;
  const n = 28 + Math.floor(r() * 5);
  const a = Math.floor(n * (0.31 + r() * 0.04));
  const b = Math.floor(n * (0.31 + r() * 0.04));
  return {
    type: 'tick', t, ts, ok: n, fail: 0, mean_ms: Math.round(mean * 10) / 10, p95_ms: Math.round(mean * 1.9 * 10) / 10,
    rps: n,
    backends: {
      srv1: { reqs: a, active: 1 + Math.floor(r() * 3), total: 4200 + t * 10, up: true },
      srv2: { reqs: b, active: 1 + Math.floor(r() * 3), total: 4180 + t * 10, up: true },
      srv3: { reqs: n - a - b, active: 1 + Math.floor(r() * 3), total: 4190 + t * 10, up: true },
    },
    algo: 'leastconn', slow: false, defence: 'protect', uplink: 10, attack: false, blocked: [],
    attacker_pps: null, simulated: true,
  };
}

export function demoTicks(now: number): LabTick[] {
  const r = rnd(11);
  const out: LabTick[] = [];
  for (let i = 0; i < 180; i++) out.push(demoTick(i, now - (180 - i), r));
  return out;
}

function mkIncident(
  seq: number, opened: number, kind: 'udp' | 'syn' | 'icmp', severity: Severity, pps: number,
  delay: number, base: number, during: number, after: number, opts: Partial<Incident> = {},
): Incident {
  const blocked = opened + 0.05;
  const resolved = opened + 25;
  const names: Record<string, string> = { udp: 'UDP', syn: 'SYN', icmp: 'ICMP' };
  const series: [number, number | null][] = [];
  const r = rnd(seq);
  for (let i = -10; i < 40; i++) {
    const ts = opened - delay + i;
    const v = i < 0 ? base + r() : i <= Math.ceil(delay) ? during * (0.7 + r() * 0.5) : after + r() * 2;
    series.push([ts, Math.round(v * 10) / 10]);
  }
  return {
    id: `INC-${seq}`, seq, src: '10.0.0.2', src_name: 'Lab-3 PC-14', target: '10.0.0.10', target_name: 'Campus gateway',
    kind, severity, status: 'resolved', mode: 'protect', simulated: true, opened, updated: resolved,
    attack_started: opened - delay, blocked_at: blocked, resolved_at: resolved, ack_by: 'IT Admin (on-call)', ack_at: opened + 40,
    false_positive: false,
    evidence: { peak_pps: pps, normal_pps: 47, ratio: Math.round((pps / 47) * 10) / 10, score: 0.99, mean_len: kind === 'syn' ? 0 : 1000, syn_ratio: kind === 'syn' ? 1 : 0, windows: 2 },
    impact: { baseline_ms: base, attack_ms: during, attack_p95_ms: during * 1.2, after_ms: after, detect_delay_s: delay, completed: 572, failed: 0 },
    timeline: [
      { ts: opened - delay, kind: 'traffic', text: 'Unusual traffic started from Lab-3 PC-14' },
      { ts: opened, kind: 'detected', text: 'Detector classified Lab-3 PC-14 as ATTACK' },
      { ts: blocked, kind: 'blocked', text: 'Blocked Lab-3 PC-14 with a drop rule on switch s1' },
      { ts: resolved, kind: 'resolved', text: 'Attack ended after 25 s' },
      { ts: opened + 40, kind: 'ack', text: 'Acknowledged by IT Admin (on-call)' },
    ],
    notifications: [
      { ts: opened + 0.2, incident: `INC-${seq}`, event: 'opened', channel: 'in_app', to: 'Dashboard', status: 'sent', detail: '' },
      { ts: opened + 1.1, incident: `INC-${seq}`, event: 'opened', channel: 'telegram', to: 'IT Admin (on-call)', status: 'sent', detail: 'chat 51234' },
      { ts: opened + 2.4, incident: `INC-${seq}`, event: 'opened', channel: 'email', to: 'IT Admin (on-call)', status: 'sent', detail: 'it-admin@campus.edu' },
      { ts: opened + 2.6, incident: `INC-${seq}`, event: 'opened', channel: 'email', to: 'Exam Cell', status: 'sent', detail: 'exam-cell@campus.edu' },
    ],
    series,
    summary:
      `Lab-3 PC-14 (10.0.0.2) sent about ${pps.toLocaleString('en-IN')} packets/s of ${names[kind]} traffic at the Campus gateway, roughly ${Math.round(pps / 47)}x its normal rate. ` +
      `FlowGuard blocked it at the switch ${delay.toFixed(1)} s after the attack began. Response time for users went from ${base} ms to ${during} ms during the attack and was back to ${after} ms after the block. The attack has ended.`,
    ...opts,
  };
}

export function demoIncidents(now: number): Incident[] {
  return [
    mkIncident(1001, now - 5 * 24 * HOUR, 'syn', 'high', 980, 1.4, 3.2, 41, 3.9),
    mkIncident(1002, now - 2 * 24 * HOUR - 3 * HOUR, 'icmp', 'high', 1100, 1.2, 3.4, 96, 4.4),
    mkIncident(1003, now - 20 * HOUR, 'udp', 'critical', 1480, 1.18, 3.5, 269.4, 7.1),
    mkIncident(1004, now - 2 * HOUR, 'udp', 'critical', 1390, 1.1, 3.1, 245, 3.6, {
      ack_by: null, ack_at: null,
      timeline: [
        { ts: now - 2 * HOUR - 1.1, kind: 'traffic', text: 'Unusual traffic started from Lab-3 PC-14' },
        { ts: now - 2 * HOUR, kind: 'detected', text: 'Detector classified Lab-3 PC-14 as ATTACK' },
        { ts: now - 2 * HOUR + 0.05, kind: 'blocked', text: 'Blocked Lab-3 PC-14 with a drop rule on switch s1' },
        { ts: now - 2 * HOUR + 25, kind: 'resolved', text: 'Attack ended after 25 s' },
      ],
    }),
  ];
}

export function demoEpisodes(now: number): LabEpisode[] {
  const base = { type: 'episode' as const, algo: 'leastconn' as const, uplink: 10, slow: false, simulated: true, length_s: 25 };
  return [
    { ...base, id: 1, ts: now - 26 * HOUR, attack: 'udp', defence: 'off', baseline_ms: 3.5, attack_ms: 269.4, attack_p95_ms: 330.7, completed: 189, failed: 0, blocked: false, detect_delay_s: null, after_ms: null },
    { ...base, id: 2, ts: now - 20 * HOUR, attack: 'udp', defence: 'protect', baseline_ms: 3.5, attack_ms: 7.1, attack_p95_ms: 6.0, completed: 572, failed: 0, blocked: true, detect_delay_s: 1.18, after_ms: 2.8 },
    { ...base, id: 3, ts: now - 2 * HOUR, attack: 'udp', defence: 'protect', baseline_ms: 3.1, attack_ms: 6.4, attack_p95_ms: 5.9, completed: 560, failed: 0, blocked: true, detect_delay_s: 1.1, after_ms: 3.6 },
  ];
}

export function demoNotifyLog(incidents: Incident[]): NotificationEntry[] {
  return incidents.flatMap((i) => i.notifications).sort((a, b) => a.ts - b.ts);
}
