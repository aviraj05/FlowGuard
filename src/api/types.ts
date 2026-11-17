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

export interface ExperimentRunDTO {
  id: number;
  run_id: string;
  scenario_id: string;
  description: string;
  created_at: string;
  completed_at?: string;
  status: string;
  ground_truth_label?: number;
  ground_truth_name?: string;
  config?: Record<string, any>;
  metrics?: Record<string, any>;
}

export interface EvaluationReportDTO {
  report_id: string;
  generated_at: string;
  executive_summary: {
    status: 'PASSED' | 'FAILED' | 'UNLABELED' | 'INSUFFICIENT_SAMPLES';
    message: string;
    total_flows: number;
    labeled_flows: number;
    unlabeled_flows: number;
  };
  model_provenance: {
    model_version: string;
    schema_version: string;
    artifact_hashes_sha256: Record<string, string>;
    runtime_environment: Record<string, string>;
    historical_score_note: string;
  };
  evaluation: {
    evaluation_status: string;
    message: string;
    total_records: number;
    labeled_count: number;
    unlabeled_count: number;
    class_support?: {
      normal: number;
      attack: number;
      unlabeled: number;
    };
    confusion_matrix?: {
      true_negatives: number;
      false_positives: number;
      false_negatives: number;
      true_positives: number;
    };
    metrics?: {
      accuracy?: number;
      balanced_accuracy?: number;
      precision?: number;
      attack_recall?: number;
      attack_recall_ci_95?: [number, number];
      benign_false_positive_rate?: number;
      benign_fpr_ci_95?: [number, number];
      specificity?: number;
      f1_score?: number;
    };
    operational_telemetry: {
      latency: {
        count: number;
        mean_ms?: number;
        p50_ms?: number;
        p95_ms?: number;
      };
      avg_imputation_rate?: number;
    };
    gate_results?: Record<string, { target: string; value: number | null; passed: boolean }>;
  };
  flow_records: Array<Record<string, any>>;
  limitations: string[];
}
