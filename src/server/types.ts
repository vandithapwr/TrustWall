export type DecisionType = "ALLOW" | "BLOCK" | "REVIEW";
export type TrafficLabel = "normal" | "malicious";
export type ProposedLabel = "normal" | "malicious" | "unknown";
export type TrustStatus = "PENDING" | "APPROVED" | "REJECTED";
export type SampleSource = "proxy" | "admin_feedback" | "simulator";
export type ModelStatusType = "ACTIVE" | "CANDIDATE" | "REJECTED" | "ARCHIVED" | "ROLLED_BACK";

export interface CanonicalRequestRecord {
  request_id: string;
  timestamp: string;
  method: string;
  path: string;
  query: Record<string, string>;
  headers_safe: Record<string, string>;
  body_features: Record<string, number>;
  source: string;
}

export interface CanonicalDetectionResult {
  request_id: string;
  label: TrafficLabel;
  confidence: number;
  model_version: string;
  decision: DecisionType;
  reason: string;
  signals: string[];
}

export interface TrafficLogRecord {
  id: number;
  request_id: string;
  timestamp: string;
  method: string;
  path: string;
  decision: DecisionType;
  label: TrafficLabel;
  confidence: number;
  model_version: string;
  reason: string;
  signals: string[];
  safe_snippet: string;
  latency_ms: number;
}

export interface AlertRecord {
  id: number;
  type: "security" | "drift" | "validation";
  severity: "low" | "medium" | "high";
  message: string;
  created_at: string;
  status: "OPEN" | "ACKNOWLEDGED";
  related_request_id: string | null;
}

export interface LearningSampleRecord {
  sample_id: string;
  request_features: Record<string, number>;
  proposed_label: ProposedLabel;
  source: SampleSource;
  trust_status: TrustStatus;
  anomaly_score: number;
  trust_signals: string[];
  request_hash: string;
  created_at: string;
  reviewer_id: string | null;
  reviewed_at: string | null;
}

export interface AuditEventRecord {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface ValidationMetrics {
  precision: number;
  recall: number;
  f1: number;
  fpr: number;
  confusion_matrix?: {
    tn: number;
    fp: number;
    fn: number;
    tp: number;
  };
}

export interface ModelVersionRecord {
  id: number;
  version: string;
  status: ModelStatusType;
  created_at: string;
  metrics: ValidationMetrics;
  failures?: string[];
  parent_version: string | null;
  approved_samples_used: number;
}

export interface DriftEventRecord {
  id: number;
  detector: "ADWIN";
  observed_at: string;
  feature_name: string;
  score_or_signal: number;
  status: "DETECTED" | "RESOLVED";
}
