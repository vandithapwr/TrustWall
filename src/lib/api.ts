import type {
  AlertRecord,
  AuditEventRecord,
  DriftEventRecord,
  LearningSampleRecord,
  ModelVersionRecord,
  TrafficLabel,
  TrafficLogRecord,
  ValidationMetrics,
} from "../server/types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }

  if (!res.ok) {
    const detail = (data as { detail?: string } | null)?.detail || `Request failed (${res.status})`;
    throw new Error(detail);
  }
  return data as T;
}

export interface MetricsResponse {
  traffic: {
    total: number;
    allowed: number;
    blocked: number;
    review: number;
    avg_latency_ms: number;
  };
  alerts: {
    open: number;
    drift_events: number;
  };
  quarantine: {
    pending: number;
    approved: number;
    rejected: number;
  };
  model: {
    active_model_version: string;
    evaluation: ValidationMetrics;
  };
}

export interface ModelStatusResponse {
  active_model_version: string;
  candidate_model_version: string | null;
  status: string;
  last_validation: ValidationMetrics;
  drift_detected: boolean;
  latest_drift_feature: string | null;
}

export interface ExperimentResponse {
  test_sample_count: number;
  baseline_static_rules: ValidationMetrics;
  baseline_unverified_ml: ValidationMetrics;
  trustwall_controlled: ValidationMetrics;
  trustwall_validation_gate: ValidationMetrics;
  active_model_version: string;
}

export const api = {
  getMetrics: () => request<MetricsResponse>("/metrics"),

  getTraffic: (params: { decision?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams({ limit: String(params.limit ?? 50) });
    if (params.decision) qs.set("decision", params.decision);
    return request<{ total: number; items: TrafficLogRecord[] }>(`/traffic?${qs.toString()}`);
  },

  getAlerts: (params: { type?: string; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams({ limit: String(params.limit ?? 50) });
    if (params.type) qs.set("type", params.type);
    if (params.status) qs.set("status", params.status);
    return request<{ total: number; items: AlertRecord[] }>(`/alerts?${qs.toString()}`);
  },

  acknowledgeAlert: (id: number) =>
    request<{ id: number; status: string }>(`/alerts/${id}/acknowledge`, { method: "POST" }),

  getQuarantine: (params: { trustStatus?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams({ limit: String(params.limit ?? 50) });
    if (params.trustStatus) qs.set("trust_status", params.trustStatus);
    return request<{ total: number; items: LearningSampleRecord[] }>(`/quarantine?${qs.toString()}`);
  },

  submitQuarantineSample: (payload: {
    request_features: Record<string, unknown>;
    proposed_label: "normal" | "malicious" | "unknown";
    source: "proxy" | "admin_feedback" | "simulator";
  }) =>
    request<LearningSampleRecord>("/quarantine", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  approveSample: (
    sampleId: string,
    payload: { reviewer_id: string; verified_label: TrafficLabel; notes?: string },
    adminToken: string
  ) =>
    request<LearningSampleRecord>(`/quarantine/${sampleId}/approve`, {
      method: "POST",
      headers: { "X-Admin-Token": adminToken },
      body: JSON.stringify(payload),
    }),

  rejectSample: (
    sampleId: string,
    payload: { reviewer_id: string; notes?: string },
    adminToken: string
  ) =>
    request<LearningSampleRecord>(`/quarantine/${sampleId}/reject`, {
      method: "POST",
      headers: { "X-Admin-Token": adminToken },
      body: JSON.stringify(payload),
    }),

  getQuarantineAudit: (limit = 25) =>
    request<{ items: AuditEventRecord[] }>(`/quarantine/audit?limit=${limit}`),

  getModelStatus: () => request<ModelStatusResponse>("/model/status"),

  getModelVersions: () => request<{ items: ModelVersionRecord[] }>("/model/versions"),

  getDriftEvents: (limit = 30) => request<{ items: DriftEventRecord[] }>(`/model/drift?limit=${limit}`),

  retrainModel: (
    payload: { reviewer_id: string; simulate_bad_candidate: boolean },
    adminToken: string
  ) =>
    request<{
      outcome: "ACTIVATED" | "REJECTED";
      candidate_version: string;
      active_model_version: string;
      approved_samples_used: number;
      validation_metrics: ValidationMetrics;
      failures: string[];
    }>("/model/retrain", {
      method: "POST",
      headers: { "X-Admin-Token": adminToken },
      body: JSON.stringify(payload),
    }),

  rollbackModel: (
    payload: { reviewer_id: string; target_version?: string | null; reason?: string },
    adminToken: string
  ) =>
    request<{ outcome: string; active_model_version: string; status: string }>("/model/rollback", {
      method: "POST",
      headers: { "X-Admin-Token": adminToken },
      body: JSON.stringify(payload),
    }),

  runExperiment: () => request<ExperimentResponse>("/experiment/run"),

  simulateProxyRequest: (payload: {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    payloadBody: Record<string, unknown>;
  }) =>
    request<{
      httpStatus: number;
      detection: {
        request_id: string;
        label: TrafficLabel;
        confidence: number;
        model_version: string;
        decision: "ALLOW" | "BLOCK" | "REVIEW";
        reason: string;
        signals: string[];
      };
      logEntry: TrafficLogRecord;
      upstreamResponse: unknown | null;
      driftTriggered: string[];
    }>("/proxy-simulate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  runTrafficBurst: (mode: "mixed" | "benign" | "attacks" | "drift" = "mixed") =>
    request<{ mode: string; processed_count: number }>("/demo-traffic/burst", {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
};
