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

export interface LabSnapshot {
  type: 'snapshot';
  status: LabStatus;
  running: boolean;
  ticks: LabTick[];
  events: LabEvent[];
  detector: Record<string, LabDetectorWindow>;
  episodes: LabEpisode[];
}

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
  | LabHistoryClearedMsg;

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
