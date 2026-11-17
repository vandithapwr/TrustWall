import crypto from "crypto";
import { extractFeatures } from "./features.ts";
import { mlEngine } from "./mlEngine.ts";
import { store } from "./storage.ts";
import type { LearningSampleRecord, ProposedLabel, SampleSource, TrafficLabel } from "./types.ts";

const ALLOWED_SOURCES = new Set<SampleSource>(["proxy", "admin_feedback", "simulator"]);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_SOURCE = 30;

export function computeFeatureHash(features: Record<string, number>): string {
  const ordered = Object.keys(features)
    .sort()
    .reduce<Record<string, number>>((acc, k) => {
      acc[k] = features[k];
      return acc;
    }, {});
  return crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

export function enqueueCandidateSample(params: {
  features: Record<string, unknown>;
  proposedLabel?: ProposedLabel;
  source?: SampleSource;
  anomalyScore?: number;
  requestHash?: string;
}): LearningSampleRecord {
  const cleanFeatures = extractFeatures(params.features);
  const source: SampleSource = params.source && ALLOWED_SOURCES.has(params.source) ? params.source : "admin_feedback";
  const fHash = params.requestHash ?? computeFeatureHash(cleanFeatures);
  const signals: string[] = [];

  if (!params.source || !ALLOWED_SOURCES.has(params.source)) {
    signals.push("unrecognized_source");
  }

  // 1. Duplicate / replay signal
  const isDuplicate = store.data.learningSamples.some((s) => s.request_hash === fHash);
  if (isDuplicate) {
    signals.push("duplicate_or_replay_sample");
  }

  // 2. Per-source rate limit check
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  const recentCount = store.data.learningSamples.filter(
    (s) => s.source === source && new Date(s.created_at).getTime() >= cutoff
  ).length;
  if (recentCount >= RATE_LIMIT_MAX_PER_SOURCE) {
    signals.push("source_rate_limit_exceeded");
  }

  // 3. Anomaly score signal (treated strictly as risk signal, never proof of poisoning)
  let score = params.anomalyScore;
  if (score === undefined) {
    const pred = mlEngine.predict(cleanFeatures);
    score = pred.anomaly_score;
    if (pred.is_anomaly) {
      signals.push("anomaly_signal_high");
    }
  } else if (score > 2.2) {
    signals.push("anomaly_signal_high");
  }

  if (signals.length === 0) {
    signals.push("pending_human_verification");
  }

  const sample: LearningSampleRecord = {
    sample_id: crypto.randomUUID(),
    request_features: cleanFeatures,
    proposed_label: params.proposedLabel ?? "unknown",
    source,
    trust_status: "PENDING",
    anomaly_score: Number((score ?? 0).toFixed(4)),
    trust_signals: signals,
    request_hash: fHash,
    created_at: new Date().toISOString(),
    reviewer_id: null,
    reviewed_at: null,
  };

  store.data.learningSamples.unshift(sample);
  store.data.auditEvents.unshift({
    id: store.data.nextAuditId++,
    actor: source,
    action: "QUARANTINE_ENQUEUE",
    entity_type: "learning_sample",
    entity_id: sample.sample_id,
    timestamp: new Date().toISOString(),
    details: { proposed_label: sample.proposed_label, signals },
  });
  store.persist();

  return sample;
}

export function approveQuarantineSample(params: {
  sampleId: string;
  reviewerId: string;
  verifiedLabel?: TrafficLabel;
  notes?: string;
}): LearningSampleRecord {
  const sample = store.data.learningSamples.find((s) => s.sample_id === params.sampleId);
  if (!sample) {
    throw new Error("Sample not found");
  }

  const finalLabel = params.verifiedLabel ?? (sample.proposed_label === "unknown" ? null : sample.proposed_label);
  if (finalLabel !== "normal" && finalLabel !== "malicious") {
    throw new Error("Cannot approve sample with 'unknown' label; specify verified_label ('normal' or 'malicious').");
  }

  sample.proposed_label = finalLabel;
  sample.trust_status = "APPROVED";
  sample.reviewer_id = params.reviewerId;
  sample.reviewed_at = new Date().toISOString();

  store.data.auditEvents.unshift({
    id: store.data.nextAuditId++,
    actor: params.reviewerId,
    action: "QUARANTINE_APPROVE",
    entity_type: "learning_sample",
    entity_id: sample.sample_id,
    timestamp: new Date().toISOString(),
    details: { verified_label: finalLabel, notes: params.notes ?? "" },
  });
  store.persist();
  return sample;
}

export function rejectQuarantineSample(params: {
  sampleId: string;
  reviewerId: string;
  notes?: string;
}): LearningSampleRecord {
  const sample = store.data.learningSamples.find((s) => s.sample_id === params.sampleId);
  if (!sample) {
    throw new Error("Sample not found");
  }

  sample.trust_status = "REJECTED";
  sample.reviewer_id = params.reviewerId;
  sample.reviewed_at = new Date().toISOString();

  store.data.auditEvents.unshift({
    id: store.data.nextAuditId++,
    actor: params.reviewerId,
    action: "QUARANTINE_REJECT",
    entity_type: "learning_sample",
    entity_id: sample.sample_id,
    timestamp: new Date().toISOString(),
    details: { notes: params.notes ?? "" },
  });
  store.persist();
  return sample;
}

export function getApprovedTrainingSamples(): Array<{ features: Record<string, number>; label: TrafficLabel }> {
  // INVARIANT: Strictly returns APPROVED samples with verified binary labels only.
  return store.data.learningSamples
    .filter(
      (s) =>
        s.trust_status === "APPROVED" &&
        (s.proposed_label === "normal" || s.proposed_label === "malicious")
    )
    .map((s) => ({
      features: s.request_features,
      label: s.proposed_label as TrafficLabel,
    }));
}
