/**
 * Types for the Mininet lab agent (lab_agent.py running inside the VM).
 * The agent streams these messages to the dashboard over Server-Sent Events.
 */

export type LabAlgo = 'roundrobin' | 'leastconn';
export type LabDefence = 'off' | 'monitor' | 'protect';
export type LabAttackKind = 'udp' | 'syn' | 'icmp';
export type LabPhase = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'error';

export interface LabHealth {
  ok: boolean;
  root: boolean;
  mininet: boolean;
  haproxy: boolean;
  hping3: boolean;
  model: boolean;
  default_simulate: boolean;
  running: boolean;
  python: string;
}

export interface LabStatus {
  type: 'status';
  phase: LabPhase;
  msg: string;
  simulated: boolean;
  config?: { algo: LabAlgo; defence: LabDefence; uplink: number; slow: boolean } | null;
}

export interface LabBackendTick {
  reqs: number;   // requests completed by the legitimate clients in this second
  active: number; // connections currently open on this back-end (HAProxy)
  total: number;  // total sessions served since the lab started (HAProxy)
  up: boolean;
}

export interface LabTick {
  type: 'tick';
  t: number;      // seconds since the session started
  ts: number;     // VM clock (epoch seconds)
  ok: number;
  fail: number;
  mean_ms: number | null;
  p95_ms: number | null;
  rps: number;
  backends: Record<string, LabBackendTick>;
  algo: LabAlgo;
  slow: boolean;
  defence: LabDefence;
  uplink: number;
  attack: boolean;
  blocked: string[];
  attacker_pps: number | null;
  simulated: boolean;
}

export interface LabDetectorWindow {
  type: 'detector';
  ts: number;
  src: string;
  pkts: number;
  bytes: number;
  mean_len: number;
  syn_ratio: number;
  score: number;
  verdict: 'normal' | 'attack';
  action: 'none' | 'flagged' | 'blocked';
}

export interface LabEvent {
  type: 'event';
  ts: number;
  kind: string;
  msg: string;
  level: 'info' | 'warn' | 'alert' | 'ok';
}

export interface LabEpisode {
  type: 'episode';
  id: number;
  ts: number;
  attack: LabAttackKind | null;
  algo: LabAlgo;
  defence: string; // 'off' | 'monitor' | 'protect' | 'off>protect' ...
  uplink: number;
  slow: boolean;
  simulated: boolean;
  length_s: number;
  baseline_ms: number | null;
  attack_ms: number | null;
  attack_p95_ms: number | null;
  completed: number;
  failed: number;
  blocked: boolean;
  detect_delay_s: number | null;
  after_ms: number | null;
}

export type Severity = 'critical' | 'high' | 'medium';
export type IncidentStatus = 'active' | 'contained' | 'resolved';

export interface TimelineEntry {
  ts: number;
  kind: string;
  text: string;
}

export interface NotificationEntry {
  ts: number;
  incident: string;
  event: 'opened' | 'resolved' | 'test' | 'weekly_report';
  channel: 'email' | 'telegram' | 'in_app';
  to: string;
  stakeholder?: string;
  status: 'sent' | 'skipped' | 'failed';
  detail: string;
}

export interface Incident {
  id: string;
  seq: number;
  src: string;
  src_name: string;
  target: string;
  target_name: string;
  kind: LabAttackKind | 'scan';
  severity: Severity;
  status: IncidentStatus;
  mode: string;
  simulated: boolean;
  opened: number;
  updated: number;
  attack_started: number | null;
  blocked_at: number | null;
  resolved_at: number | null;
  ack_by: string | null;
  ack_at: number | null;
  false_positive: boolean;
  evidence: {
    peak_pps: number | null;
    normal_pps: number | null;
    ratio: number | null;
    score: number | null;
    mean_len: number | null;
    syn_ratio: number | null;
    windows: number;
  };
  impact: {
    baseline_ms: number | null;
    attack_ms: number | null;
    attack_p95_ms: number | null;
    after_ms: number | null;
    detect_delay_s: number | null;
    completed: number | null;
    failed: number | null;
  };
  timeline: TimelineEntry[];
  notifications: NotificationEntry[];
  series: [number, number | null][];
  summary: string;
}

export interface Device {
  ip: string;
  host: string;
  name: string;
  role: string;
  location: string;
  owner: string;
  critical: boolean;
}

export interface Stakeholder {
  id: string;
  name: string;
  role: string;
  email: string;
  telegram_chat_id: string;
  channels: ('email' | 'telegram')[];
  severities: Severity[];
  resolved: boolean;
  weekly_report: boolean;
}

export interface NotifyConfig {
  stakeholders: Stakeholder[];
  in_app: boolean;
  channels: {
    email: { configured: boolean; sender: string | null };
    telegram: { configured: boolean; bot: string | null };
    in_app: { configured: boolean };
  };
}

export interface LabSnapshot {
  type: 'snapshot';
  status: LabStatus;
  running: boolean;
  ticks: LabTick[];
  events: LabEvent[];
  detector: Record<string, LabDetectorWindow>;
  episodes: LabEpisode[];
  incidents?: Incident[];
  notify_log?: NotificationEntry[];
  devices?: Device[];
}

export interface LabIncidentMsg { type: 'incident'; incident: Incident; what?: string }
export interface LabNotificationMsg { type: 'notification'; entry: NotificationEntry }
export interface LabDevicesMsg { type: 'devices'; devices: Device[] }

export interface LabResetMsg { type: 'reset' }
export interface LabHistoryClearedMsg { type: 'history_cleared' }

export type LabMessage =
  | LabSnapshot
  | LabStatus
  | LabTick
  | LabDetectorWindow
  | LabEvent
  | LabEpisode
  | LabResetMsg
  | LabHistoryClearedMsg
  | LabIncidentMsg
  | LabNotificationMsg
  | LabDevicesMsg;

export interface LabStartConfig {
  algo: LabAlgo;
  defence: LabDefence;
  uplink: number;
  slow: boolean;
  simulate: boolean;
}

export type LabCommand =
  | { cmd: 'attack_start'; attack: LabAttackKind; length: number }
  | { cmd: 'attack_stop' }
  | { cmd: 'set_algo'; algo: LabAlgo }
  | { cmd: 'set_slow'; on: boolean }
  | { cmd: 'set_defence'; mode: LabDefence }
  | { cmd: 'unblock' };

export type AgentConnection = 'connecting' | 'online' | 'offline';
