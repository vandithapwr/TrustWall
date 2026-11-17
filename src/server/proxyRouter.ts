import express from "express";
import { handleDemoDispatch } from "./demoApp.ts";
import { mlEngine } from "./mlEngine.ts";
import { normalizeHttpRequest } from "./normalizer.ts";
import { evaluatePolicy } from "./policy.ts";
import { store } from "./storage.ts";
import { computeFeatureHash, enqueueCandidateSample } from "./trustEngine.ts";
import type { CanonicalDetectionResult, TrafficLogRecord } from "./types.ts";

export interface ProxyDispatchOutcome {
  httpStatus: number;
  detection: CanonicalDetectionResult;
  logEntry: TrafficLogRecord;
  upstreamResponse: unknown | null;
  driftTriggered: string[];
}

export function inspectAndDispatch(params: {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  rawBody: string;
  parsedBody: Record<string, unknown>;
  source?: string;
}): ProxyDispatchOutcome {
  const started = performance.now();
  const { record, safeSnippet } = normalizeHttpRequest({
    method: params.method,
    path: params.path,
    query: params.query,
    headers: params.headers,
    rawBody: params.rawBody,
    source: params.source ?? "http-proxy",
  });

  const prediction = mlEngine.predict(record as unknown as Record<string, unknown>);
  const detection = evaluatePolicy(record, prediction);
  const latencyMs = Number(Math.max(0.2, performance.now() - started).toFixed(2));

  const logEntry: TrafficLogRecord = {
    id: store.data.nextTrafficId++,
    request_id: record.request_id,
    timestamp: record.timestamp,
    method: record.method,
    path: record.path,
    decision: detection.decision,
    label: detection.label,
    confidence: detection.confidence,
    model_version: detection.model_version,
    reason: detection.reason,
    signals: detection.signals,
    safe_snippet: safeSnippet,
    latency_ms: latencyMs,
  };
  store.data.trafficLogs.unshift(logEntry);
  if (store.data.trafficLogs.length > 500) {
    store.data.trafficLogs.length = 500;
  }

  if (detection.decision === "BLOCK" || detection.decision === "REVIEW") {
    store.data.alerts.unshift({
      id: store.data.nextAlertId++,
      type: "security",
      severity: detection.decision === "BLOCK" ? "high" : "medium",
      message: `[${detection.decision}] ${record.method} ${record.path} — ${detection.reason}`,
      created_at: new Date().toISOString(),
      status: "OPEN",
      related_request_id: record.request_id,
    });
  }

  // ADWIN drift observation — change signal only, never marks traffic malicious
  const driftEvents = mlEngine.observeDrift(prediction.features);
  const driftTriggered: string[] = [];
  for (const evt of driftEvents) {
    driftTriggered.push(evt.featureName);
    store.data.driftEvents.unshift({
      id: store.data.nextDriftId++,
      detector: "ADWIN",
      observed_at: new Date().toISOString(),
      feature_name: evt.featureName,
      score_or_signal: evt.signalValue,
      status: "DETECTED",
    });
    store.data.alerts.unshift({
      id: store.data.nextAlertId++,
      type: "drift",
      severity: "medium",
      message: `ADWIN detected distribution drift on '${evt.featureName}' (signal=${evt.signalValue}). Drift is a change signal, not automatically an attack.`,
      created_at: new Date().toISOString(),
      status: "OPEN",
      related_request_id: record.request_id,
    });
  }

  // Enqueue REVIEW samples into Quarantine (never directly into training)
  if (detection.decision === "REVIEW") {
    enqueueCandidateSample({
      features: prediction.features,
      proposedLabel: "unknown",
      source: "proxy",
      anomalyScore: prediction.anomaly_score,
      requestHash: computeFeatureHash(prediction.features),
    });
  }

  store.persist();

  if (detection.decision === "BLOCK") {
    return {
      httpStatus: 403,
      detection,
      logEntry,
      upstreamResponse: null,
      driftTriggered,
    };
  }

  if (detection.decision === "REVIEW") {
    return {
      httpStatus: 202,
      detection,
      logEntry,
      upstreamResponse: null,
      driftTriggered,
    };
  }

  const upstream = handleDemoDispatch({
    method: record.method,
    path: record.path,
    query: params.query,
    body: params.parsedBody,
  });

  return {
    httpStatus: upstream.status,
    detection,
    logEntry,
    upstreamResponse: upstream.payload,
    driftTriggered,
  };
}

export const proxyRouter = express.Router();

proxyRouter.use((req, res) => {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    query[k] = String(v ?? "");
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k] = v;
  }

  const parsedBody =
    req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const rawBody =
    typeof req.body === "string"
      ? req.body
      : Object.keys(parsedBody).length > 0
        ? JSON.stringify(parsedBody)
        : "";

  try {
    const outcome = inspectAndDispatch({
      method: req.method,
      path: req.path || "/",
      query,
      headers,
      rawBody,
      parsedBody,
      source: req.ip || "http-proxy",
    });

    if (outcome.detection.decision === "BLOCK") {
      res.status(403).json(outcome.detection);
      return;
    }
    if (outcome.detection.decision === "REVIEW") {
      res.status(202).json({ ...outcome.detection, status: "held_for_review" });
      return;
    }
    res.status(outcome.httpStatus).json(outcome.upstreamResponse);
  } catch (err) {
    res.status(413).json({
      decision: "BLOCK",
      reason: err instanceof Error ? err.message : "Request rejected by guardrail",
    });
  }
});
