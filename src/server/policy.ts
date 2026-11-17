import type {
  CanonicalDetectionResult,
  CanonicalRequestRecord,
  DecisionType,
  TrafficLabel,
} from "./types.ts";

const BLOCK_CONFIDENCE_THRESHOLD = 0.72;
const REVIEW_CONFIDENCE_THRESHOLD = 0.55;

export interface PredictionOutput {
  label: TrafficLabel;
  confidence: number;
  model_version: string;
  anomaly_score: number;
  is_anomaly: boolean;
  features: Record<string, number>;
  signals: string[];
}

export function evaluatePolicy(
  record: CanonicalRequestRecord,
  prediction: PredictionOutput
): CanonicalDetectionResult {
  let label: TrafficLabel = prediction.label;
  const confidence = prediction.confidence;
  const signals = [...prediction.signals];
  const f = prediction.features;

  const hasExplicitAttackPattern =
    (f.sqli_keyword_hits ?? 0) > 0 ||
    (f.xss_keyword_hits ?? 0) > 0 ||
    (f.traversal_hits ?? 0) > 0 ||
    (f.cmd_injection_hits ?? 0) > 0;

  const unfamiliarRoute = (f.is_known_route ?? 1) === 0;

  let decision: DecisionType = "ALLOW";
  let reason = "Request classified as normal traffic.";

  if (label === "malicious" && confidence >= BLOCK_CONFIDENCE_THRESHOLD) {
    decision = "BLOCK";
    reason = `Blocked malicious request (confidence=${confidence.toFixed(2)}, signals=${signals.join(",")}).`;
  } else if (hasExplicitAttackPattern && (label === "malicious" || confidence < 0.9)) {
    decision = "BLOCK";
    label = "malicious";
    if (!signals.includes("policy_signature")) {
      signals.push("policy_signature");
    }
    reason = `Blocked by policy + pattern guardrail (signals=${signals.join(",")}).`;
  } else if (label === "malicious") {
    decision = "REVIEW";
    reason = `Low-confidence malicious prediction held for review (confidence=${confidence.toFixed(2)}).`;
  } else if (confidence < REVIEW_CONFIDENCE_THRESHOLD) {
    decision = "REVIEW";
    if (!signals.includes("low_confidence")) {
      signals.push("low_confidence");
    }
    reason = `Low-confidence prediction held for review (confidence=${confidence.toFixed(2)}).`;
  } else if (unfamiliarRoute && prediction.is_anomaly) {
    decision = "REVIEW";
    if (!signals.includes("policy_unfamiliar_review")) {
      signals.push("policy_unfamiliar_review");
    }
    reason = "Unfamiliar route with anomaly signal held for review (not labelled malicious).";
  } else if (unfamiliarRoute) {
    decision = "ALLOW";
    reason = "Allowed new/unfamiliar route pattern; monitored for traffic drift.";
  }

  return {
    request_id: record.request_id,
    label,
    confidence: Number(confidence.toFixed(4)),
    model_version: prediction.model_version,
    decision,
    reason,
    signals,
  };
}
