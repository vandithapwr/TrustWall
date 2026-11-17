import express, { type NextFunction, type Request, type Response } from "express";
import { mlEngine } from "./mlEngine.ts";
import { inspectAndDispatch } from "./proxyRouter.ts";
import { store } from "./storage.ts";
import {
  approveQuarantineSample,
  enqueueCandidateSample,
  getApprovedTrainingSamples,
  rejectQuarantineSample,
} from "./trustEngine.ts";
import type { ProposedLabel, SampleSource, TrafficLabel } from "./types.ts";

const ADMIN_TOKEN = process.env.ADMIN_REVIEW_TOKEN || "trustwall-local-reviewer-token";

function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const token = req.header("x-admin-token");
  if (!token || token !== ADMIN_TOKEN) {
    res.status(401).json({ detail: "Invalid or missing X-Admin-Token header." });
    return;
  }
  next();
}

export const apiRouter = express.Router();

apiRouter.get("/health", (_req, res) => {
  const active = mlEngine.getActiveBundle();
  res.json({
    status: "ok",
    service: "trustwall-control-plane",
    active_model_version: active.version,
  });
});

apiRouter.get("/traffic", (req, res) => {
  const decision = String(req.query.decision ?? "").toUpperCase();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));

  let items = store.data.trafficLogs;
  if (decision) {
    items = items.filter((item) => item.decision === decision);
  }

  res.json({
    total: items.length,
    limit,
    offset,
    items: items.slice(offset, offset + limit),
  });
});

apiRouter.get("/alerts", (req, res) => {
  const alertType = String(req.query.type ?? "").toLowerCase();
  const status = String(req.query.status ?? "").toUpperCase();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));

  let items = store.data.alerts;
  if (alertType) items = items.filter((a) => a.type === alertType);
  if (status) items = items.filter((a) => a.status === status);

  res.json({
    total: items.length,
    items: items.slice(0, limit),
  });
});

apiRouter.post("/alerts/:id/acknowledge", (req, res) => {
  const alertId = Number(req.params.id);
  const row = store.data.alerts.find((a) => a.id === alertId);
  if (!row) {
    res.status(404).json({ detail: "Alert not found" });
    return;
  }
  row.status = "ACKNOWLEDGED";
  store.persist();
  res.json({ id: row.id, status: row.status });
});

apiRouter.get("/metrics", (_req, res) => {
  const logs = store.data.trafficLogs;
  const total = logs.length;
  const allowed = logs.filter((l) => l.decision === "ALLOW").length;
  const blocked = logs.filter((l) => l.decision === "BLOCK").length;
  const review = logs.filter((l) => l.decision === "REVIEW").length;
  const avgLatency =
    total > 0 ? Number((logs.reduce((acc, l) => acc + l.latency_ms, 0) / total).toFixed(2)) : 0;

  const openAlerts = store.data.alerts.filter((a) => a.status === "OPEN").length;
  const driftEvents = store.data.driftEvents.length;

  const q = store.data.learningSamples;
  const pendingQ = q.filter((s) => s.trust_status === "PENDING").length;
  const approvedQ = q.filter((s) => s.trust_status === "APPROVED").length;
  const rejectedQ = q.filter((s) => s.trust_status === "REJECTED").length;

  const activeRow = store.data.modelVersions.find((m) => m.status === "ACTIVE");
  const activeBundle = mlEngine.getActiveBundle();

  res.json({
    traffic: {
      total,
      allowed,
      blocked,
      review,
      avg_latency_ms: avgLatency,
    },
    alerts: {
      open: openAlerts,
      drift_events: driftEvents,
    },
    quarantine: {
      pending: pendingQ,
      approved: approvedQ,
      rejected: rejectedQ,
    },
    model: {
      active_model_version: activeRow?.version ?? activeBundle.version,
      evaluation: activeRow?.metrics ?? activeBundle.valMetrics,
    },
  });
});

apiRouter.get("/quarantine", (req, res) => {
  const trustStatus = String(req.query.trust_status ?? "").toUpperCase();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));

  let items = store.data.learningSamples;
  if (trustStatus) {
    items = items.filter((s) => s.trust_status === trustStatus);
  }
  res.json({
    total: items.length,
    items: items.slice(0, limit),
  });
});

apiRouter.post("/quarantine", (req, res) => {
  const body = (req.body ?? {}) as {
    request_features?: Record<string, unknown>;
    proposed_label?: ProposedLabel;
    source?: SampleSource;
    request_hash?: string;
  };
  if (!body.request_features || typeof body.request_features !== "object") {
    res.status(400).json({ detail: "request_features object is required." });
    return;
  }

  const created = enqueueCandidateSample({
    features: body.request_features,
    proposedLabel: body.proposed_label ?? "unknown",
    source: body.source ?? "admin_feedback",
    requestHash: body.request_hash,
  });
  res.status(201).json(created);
});

apiRouter.post("/quarantine/:id/approve", requireAdminToken, (req, res) => {
  const body = (req.body ?? {}) as {
    reviewer_id?: string;
    verified_label?: TrafficLabel;
    notes?: string;
  };
  if (!body.reviewer_id || body.reviewer_id.trim().length < 2) {
    res.status(400).json({ detail: "reviewer_id is required." });
    return;
  }
  try {
    const updated = approveQuarantineSample({
      sampleId: req.params.id,
      reviewerId: body.reviewer_id.trim(),
      verifiedLabel: body.verified_label,
      notes: body.notes,
    });
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to approve sample";
    res.status(msg.includes("not found") ? 404 : 400).json({ detail: msg });
  }
});

apiRouter.post("/quarantine/:id/reject", requireAdminToken, (req, res) => {
  const body = (req.body ?? {}) as { reviewer_id?: string; notes?: string };
  if (!body.reviewer_id || body.reviewer_id.trim().length < 2) {
    res.status(400).json({ detail: "reviewer_id is required." });
    return;
  }
  try {
    const updated = rejectQuarantineSample({
      sampleId: req.params.id,
      reviewerId: body.reviewer_id.trim(),
      notes: body.notes,
    });
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reject sample";
    res.status(404).json({ detail: msg });
  }
});

apiRouter.get("/quarantine/audit", (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)));
  res.json({ items: store.data.auditEvents.slice(0, limit) });
});

apiRouter.get("/model/status", (_req, res) => {
  const activeRow = store.data.modelVersions.find((m) => m.status === "ACTIVE");
  const rejectedRow = store.data.modelVersions.find((m) => m.status === "REJECTED");
  const latestDrift = store.data.driftEvents[0] ?? null;
  const activeBundle = mlEngine.getActiveBundle();

  res.json({
    active_model_version: activeRow?.version ?? activeBundle.version,
    candidate_model_version: rejectedRow?.version ?? null,
    status: activeRow?.status ?? "ACTIVE",
    last_validation: activeRow?.metrics ?? activeBundle.valMetrics,
    drift_detected: store.data.driftEvents.some((d) => d.status === "DETECTED"),
    latest_drift_feature: latestDrift?.feature_name ?? null,
  });
});

apiRouter.get("/model/versions", (_req, res) => {
  res.json({ items: store.data.modelVersions });
});

apiRouter.get("/model/drift", (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30)));
  res.json({ items: store.data.driftEvents.slice(0, limit) });
});

apiRouter.post("/model/retrain", requireAdminToken, (req, res) => {
  const body = (req.body ?? {}) as {
    reviewer_id?: string;
    simulate_bad_candidate?: boolean;
  };
  const reviewerId = body.reviewer_id?.trim() || "admin";
  const simulateBad = Boolean(body.simulate_bad_candidate);

  const approved = getApprovedTrainingSamples();
  const activeRow = store.data.modelVersions.find((m) => m.status === "ACTIVE");
  const parentVersion = activeRow?.version ?? "model-v1";
  const candidateVersion = `model-v${store.data.modelVersions.length + 1}`;

  const { bundle, passed, failures } = mlEngine.retrainVersion(
    candidateVersion,
    approved,
    simulateBad
  );

  if (passed) {
    if (activeRow) activeRow.status = "ARCHIVED";
    store.data.modelVersions.unshift({
      id: store.data.nextModelId++,
      version: candidateVersion,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      metrics: bundle.valMetrics,
      parent_version: parentVersion,
      approved_samples_used: approved.length,
    });
    store.data.auditEvents.unshift({
      id: store.data.nextAuditId++,
      actor: reviewerId,
      action: "MODEL_ACTIVATE",
      entity_type: "model_version",
      entity_id: candidateVersion,
      timestamp: new Date().toISOString(),
      details: { parent_version: parentVersion, approved_samples_used: approved.length, metrics: bundle.valMetrics },
    });
    store.persist();

    res.json({
      outcome: "ACTIVATED",
      candidate_version: candidateVersion,
      active_model_version: candidateVersion,
      approved_samples_used: approved.length,
      validation_metrics: bundle.valMetrics,
      failures: [],
    });
    return;
  }

  store.data.modelVersions.unshift({
    id: store.data.nextModelId++,
    version: candidateVersion,
    status: "REJECTED",
    created_at: new Date().toISOString(),
    metrics: bundle.valMetrics,
    failures,
    parent_version: parentVersion,
    approved_samples_used: approved.length,
  });
  store.data.alerts.unshift({
    id: store.data.nextAlertId++,
    type: "validation",
    severity: "high",
    message: `Candidate ${candidateVersion} failed validation gate and was rejected: ${failures.join(", ")}`,
    created_at: new Date().toISOString(),
    status: "OPEN",
    related_request_id: null,
  });
  store.data.auditEvents.unshift({
    id: store.data.nextAuditId++,
    actor: reviewerId,
    action: "MODEL_REJECT",
    entity_type: "model_version",
    entity_id: candidateVersion,
    timestamp: new Date().toISOString(),
    details: { failures, metrics: bundle.valMetrics },
  });
  store.persist();

  res.json({
    outcome: "REJECTED",
    candidate_version: candidateVersion,
    active_model_version: parentVersion,
    approved_samples_used: approved.length,
    validation_metrics: bundle.valMetrics,
    failures,
  });
});

apiRouter.post("/model/rollback", requireAdminToken, (req, res) => {
  const body = (req.body ?? {}) as {
    reviewer_id?: string;
    target_version?: string | null;
    reason?: string;
  };
  const reviewerId = body.reviewer_id?.trim() || "admin";
  const current = store.data.modelVersions.find((m) => m.status === "ACTIVE");

  const target = body.target_version
    ? store.data.modelVersions.find((m) => m.version === body.target_version)
    : store.data.modelVersions.find(
        (m) =>
          (m.status === "ARCHIVED" || m.status === "ROLLED_BACK") &&
          m.version !== current?.version
      );

  if (!target) {
    res.status(400).json({ detail: "No previous trusted model version available for rollback." });
    return;
  }

  if (current) {
    current.status = "ROLLED_BACK";
  }
  target.status = "ACTIVE";
  mlEngine.setActiveVersion(target.version);

  store.data.alerts.unshift({
    id: store.data.nextAlertId++,
    type: "validation",
    severity: "medium",
    message: `Rolled back active model from ${current?.version ?? "none"} to ${target.version}.`,
    created_at: new Date().toISOString(),
    status: "OPEN",
    related_request_id: null,
  });
  store.data.auditEvents.unshift({
    id: store.data.nextAuditId++,
    actor: reviewerId,
    action: "MODEL_ROLLBACK",
    entity_type: "model_version",
    entity_id: target.version,
    timestamp: new Date().toISOString(),
    details: {
      rolled_back_from: current?.version ?? null,
      restored_version: target.version,
      reason: body.reason ?? "Manual rollback",
    },
  });
  store.persist();

  res.json({
    outcome: "ROLLED_BACK",
    active_model_version: target.version,
    status: target.status,
  });
});

apiRouter.get("/experiment/run", (_req, res) => {
  res.json(mlEngine.runComparisonExperiment());
});

apiRouter.post("/proxy-simulate", (req, res) => {
  const body = (req.body ?? {}) as {
    method?: string;
    path?: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    payloadBody?: Record<string, unknown>;
  };

  const method = String(body.method ?? "GET").toUpperCase();
  const path = String(body.path ?? "/search");
  const query = body.query ?? {};
  const headers = body.headers ?? {};
  const parsedBody = body.payloadBody ?? {};
  const rawBody = Object.keys(parsedBody).length > 0 ? JSON.stringify(parsedBody) : "";

  try {
    const outcome = inspectAndDispatch({
      method,
      path,
      query,
      headers,
      rawBody,
      parsedBody,
      source: "proxy-console",
    });
    res.json(outcome);
  } catch (err) {
    res.status(413).json({ detail: err instanceof Error ? err.message : "Guardrail violation" });
  }
});

apiRouter.post("/demo-traffic/burst", (req, res) => {
  const mode = String((req.body as { mode?: string } | undefined)?.mode ?? "mixed");
  const results: Array<{ path: string; decision: string; status: number }> = [];

  if (mode === "mixed" || mode === "benign") {
    for (const q of ["books", "security", "keyboard", "usb", "cryptography"]) {
      const out = inspectAndDispatch({
        method: "GET",
        path: "/search",
        query: { q },
        headers: { accept: "application/json" },
        rawBody: "",
        parsedBody: {},
        source: "traffic-generator",
      });
      results.push({ path: `/search?q=${q}`, decision: out.detection.decision, status: out.httpStatus });
    }
  }

  if (mode === "mixed" || mode === "attacks") {
    const attacks: Array<{
      method: string;
      path: string;
      query: Record<string, string>;
      body: Record<string, unknown>;
    }> = [
      {
        method: "POST",
        path: "/login",
        query: {},
        body: { username: "' OR 1=1 --", password: "x" },
      },
      {
        method: "GET",
        path: "/search",
        query: { q: "<script>alert(1)</script>" },
        body: {},
      },
      {
        method: "GET",
        path: "/search",
        query: { file: "../../etc/passwd" },
        body: {},
      },
    ];
    for (const atk of attacks) {
      const out = inspectAndDispatch({
        method: atk.method,
        path: atk.path,
        query: atk.query,
        headers: { "content-type": "application/json" },
        rawBody: Object.keys(atk.body).length > 0 ? JSON.stringify(atk.body) : "",
        parsedBody: atk.body,
        source: "traffic-generator",
      });
      results.push({ path: atk.path, decision: out.detection.decision, status: out.httpStatus });
    }
  }

  if (mode === "mixed" || mode === "drift") {
    for (let i = 0; i < 28; i++) {
      const out = inspectAndDispatch({
        method: "GET",
        path: "/api/v2/catalog",
        query: { sort: i % 2 === 0 ? "price" : "name", page: String(i + 1) },
        headers: { accept: "application/json" },
        rawBody: "",
        parsedBody: {},
        source: "traffic-generator",
      });
      if (i === 0 || i === 27 || out.driftTriggered.length > 0) {
        results.push({ path: `/api/v2/catalog?page=${i + 1}`, decision: out.detection.decision, status: out.httpStatus });
      }
    }
  }

  if (mode === "mixed" || mode === "quarantine") {
    enqueueCandidateSample({
      features: {
        method: "GET",
        path: "/api/v2/catalog",
        query: { sort: "price", page: "2" },
        body_features: {},
      },
      proposedLabel: "normal",
      source: "simulator",
    });
  }

  res.json({
    mode,
    processed_count: results.length,
    sample_outcomes: results.slice(0, 12),
  });
});

apiRouter.post("/system/reset", requireAdminToken, (_req, res) => {
  store.resetAll();
  res.json({ status: "reset_complete" });
});
