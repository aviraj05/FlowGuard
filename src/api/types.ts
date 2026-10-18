/**
 * API Data Transfer Objects (DTOs) for FlowGuard FastAPI backend.
 * Kept strictly separate from frontend presentation types.
 */

export interface HealthDTO {
  status: string;
  service: string;
  model_loaded: boolean;
  model_version: string;
  schema_version: string;
  os_environment: string;
  mininet_supported: boolean;
  collector_mode: string;
  uptime_seconds: number;
}

export interface ModelInfoDTO {
  model_name: string;
  model_version: string;
  schema_version: string;
  feature_count: number;
  feature_columns: string[];
  categorical_features: string[];
  classes: number[];
  label_semantics: Record<number, string>;
  historical_f1_score: number;
  historical_score_verified: boolean;
  notes: string;
  tree_metrics: {
    max_depth: number | null;
    node_count: number | null;
    n_leaves: number | null;
  };
}

export interface EventItemDTO {
  event_id: string;
  timestamp: string;
  src_ip: string;
  dst_ip: string;
  src_port: number;
  dst_port: number;
  proto: string;
  service: string;
  label: number; // 0 = Normal, 1 = Attack
  label_name: string; // 'NORMAL' | 'ATTACK'
  risk_score: number;
  action: string; // 'ALLOW' | 'ALERT'
  severity: string; // 'LOW' | 'MEDIUM' | 'HIGH'
  source_type: string; // 'replay' | 'api' | 'batch'
}

export interface BackendDTO {
  id: string;
  name: string;
  ip: string;
  weight: number;
  status: string;
  failed: boolean;
}

export interface DashboardSnapshotDTO {
  status: string;
  model_version: string;
  total_events: number;
  normal_count: number;
  attack_count: number;
  last_update: string;
  backends: BackendDTO[];
  recent_events: EventItemDTO[];
}

export interface LabActionDTO {
  status: string;
  backend_id: string;
  failed: boolean;
  isolated_lab_only: boolean;
  timestamp: string;
  message: string;
}

export interface ReplayStatusDTO {
  is_running: boolean;
  interval_seconds: number;
  total_replayed: number;
  scenario_length: number;
}
