import { useCallback, useEffect, useState } from "react";
import { Download, Plus, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { downloadCsv } from "../lib/csv";
import type { AuditEventRecord, LearningSampleRecord, TrafficLabel } from "../server/types";
import { StatusText } from "../components/StatusText";

interface QuarantinePageProps {
  reviewerId: string;
  adminToken: string;
  refreshTrigger: number;
}

export function QuarantinePage({ reviewerId, adminToken, refreshTrigger }: QuarantinePageProps) {
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [samples, setSamples] = useState<LearningSampleRecord[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [labelOverrides, setLabelOverrides] = useState<Record<string, TrafficLabel>>({});
  const [confirmingId, setConfirmingId] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  // Submit sample quick form
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [newPath, setNewPath] = useState("/api/v2/catalog");
  const [newQuery, setNewQuery] = useState("sort=price&page=3");
  const [newProposedLabel, setNewProposedLabel] = useState<"normal" | "malicious" | "unknown">("normal");
  const [newSource, setNewSource] = useState<"admin_feedback" | "simulator">("simulator");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [qData, aData] = await Promise.all([
        api.getQuarantine({ trustStatus: statusFilter, limit: 50 }),
        api.getQuarantineAudit(20),
      ]);
      setSamples(qData.items);
      setAuditEvents(aData.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quarantine samples");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const handleSubmitCandidate = async () => {
    setError("");
    setFeedback("");
    try {
      const queryObj: Record<string, string> = {};
      if (newQuery.trim()) {
        for (const pair of newQuery.split("&")) {
          const [k, v] = pair.split("=");
          if (k) queryObj[k.trim()] = (v ?? "").trim();
        }
      }
      const created = await api.submitQuarantineSample({
        request_features: {
          method: "GET",
          path: newPath,
          query: queryObj,
          body_features: {},
        },
        proposed_label: newProposedLabel,
        source: newSource,
      });
      setFeedback(`Submitted sample ${created.sample_id.slice(0, 8)} into PENDING quarantine.`);
      setShowSubmitForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit candidate sample");
    }
  };

  const executeApprove = async (sample: LearningSampleRecord) => {
    if (!adminToken.trim()) {
      setError("Enter the Admin Token in the top bar before approving samples.");
      return;
    }
    const chosenLabel: TrafficLabel =
      labelOverrides[sample.sample_id] ||
      (sample.proposed_label !== "unknown" ? sample.proposed_label : "normal");

    setError("");
    setFeedback("");
    try {
      const updated = await api.approveSample(
        sample.sample_id,
        { reviewer_id: reviewerId || "admin-1", verified_label: chosenLabel, notes: "Approved via console" },
        adminToken
      );
      setConfirmingId(null);
      setFeedback(`Approved sample ${updated.sample_id.slice(0, 8)} as '${updated.proposed_label}'.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve sample");
    }
  };

  const executeReject = async (sample: LearningSampleRecord) => {
    if (!adminToken.trim()) {
      setError("Enter the Admin Token in the top bar before rejecting samples.");
      return;
    }
    setError("");
    setFeedback("");
    try {
      const updated = await api.rejectSample(
        sample.sample_id,
        { reviewer_id: reviewerId || "admin-1", notes: "Rejected via console" },
        adminToken
      );
      setConfirmingId(null);
      setFeedback(`Rejected sample ${updated.sample_id.slice(0, 8)} and excluded it from retraining.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject sample");
    }
  };

  const handleExportCsv = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = statusFilter ? statusFilter.toLowerCase() : "all";
    downloadCsv(
      `trustwall-quarantine-${suffix}-${timestamp}.csv`,
      [
        "sample_id",
        "created_at",
        "source",
        "proposed_label",
        "trust_status",
        "anomaly_score",
        "trust_signals",
        "reviewer_id",
        "reviewed_at",
        "request_hash",
        "request_features",
      ],
      samples.map((s) => [
        s.sample_id,
        s.created_at,
        s.source,
        s.proposed_label,
        s.trust_status,
        s.anomaly_score,
        s.trust_signals.join("; "),
        s.reviewer_id ?? "",
        s.reviewed_at ?? "",
        s.request_hash,
        s.request_features,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Learning Sample Quarantine</h1>
          <p className="mt-1 text-sm text-slate-400">
            Only APPROVED samples enter candidate retraining. PENDING and REJECTED samples remain isolated.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSubmitForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600"
          >
            <Plus className="h-3.5 w-3.5" />
            Submit Sample
          </button>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-950/30 px-4 py-3 text-sm text-sky-200">
          {feedback}
        </div>
      )}

      {showSubmitForm && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-100">Submit Candidate Learning Sample</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Request Path</label>
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Query Params</label>
              <input
                type="text"
                value={newQuery}
                onChange={(e) => setNewQuery(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Proposed Label</label>
              <select
                value={newProposedLabel}
                onChange={(e) => setNewProposedLabel(e.target.value as "normal" | "malicious" | "unknown")}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
              >
                <option value="normal">normal</option>
                <option value="malicious">malicious</option>
                <option value="unknown">unknown</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Source</label>
              <select
                value={newSource}
                onChange={(e) => setNewSource(e.target.value as "admin_feedback" | "simulator")}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
              >
                <option value="simulator">simulator</option>
                <option value="admin_feedback">admin_feedback</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowSubmitForm(false)}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmitCandidate}
              className="rounded-md bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
            >
              Enqueue to Quarantine
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-100">Quarantined Samples</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-md border border-slate-800 bg-slate-950 p-0.5">
              {["PENDING", "APPROVED", "REJECTED", ""].map((st) => (
                <button
                  key={st || "ALL"}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    statusFilter === st ? "bg-slate-800 text-sky-400" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {st || "All"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={samples.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 disabled:opacity-40 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {loading && samples.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">Loading quarantine queue...</div>
        ) : samples.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No samples in {statusFilter || "quarantine"}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Sample ID</th>
                  <th className="px-3 py-2.5 font-medium">Source</th>
                  <th className="px-3 py-2.5 font-medium">Proposed</th>
                  <th className="px-3 py-2.5 font-medium text-right">Anomaly Score</th>
                  <th className="px-3 py-2.5 font-medium">Trust Signals</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Reviewer Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {samples.map((s) => {
                  const selectedLabel: TrafficLabel =
                    labelOverrides[s.sample_id] ||
                    (s.proposed_label !== "unknown" ? s.proposed_label : "normal");
                  const isConfirming = confirmingId?.id === s.sample_id;

                  return (
                    <tr key={s.sample_id} className="hover:bg-slate-800/30">
                      <td className="px-4 py-2.5 font-mono text-slate-300">{s.sample_id.slice(0, 10)}</td>
                      <td className="px-3 py-2.5 text-slate-300">{s.source}</td>
                      <td className="px-3 py-2.5">
                        <StatusText value={s.proposed_label} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-200">
                        {s.anomaly_score.toFixed(3)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-slate-400">
                        {s.trust_signals.join(" · ")}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusText value={s.trust_status} />
                      </td>
                      <td className="px-4 py-2.5">
                        {s.trust_status === "PENDING" ? (
                          isConfirming ? (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-300">
                                Confirm {confirmingId.action} ({selectedLabel})?
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  confirmingId.action === "approve" ? executeApprove(s) : executeReject(s)
                                }
                                className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingId(null)}
                                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <select
                                value={selectedLabel}
                                onChange={(e) =>
                                  setLabelOverrides((prev) => ({
                                    ...prev,
                                    [s.sample_id]: e.target.value as TrafficLabel,
                                  }))
                                }
                                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                              >
                                <option value="normal">normal</option>
                                <option value="malicious">malicious</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => setConfirmingId({ id: s.sample_id, action: "approve" })}
                                className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingId({ id: s.sample_id, action: "reject" })}
                                className="rounded bg-rose-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-600"
                              >
                                Reject
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="font-mono text-slate-400">
                            Reviewed by {s.reviewer_id ?? "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-100">Quarantine & Adaptation Audit Trail</h2>
        </div>

        {auditEvents.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No audit events recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">Actor</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 font-medium">Entity</th>
                  <th className="px-4 py-2.5 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {auditEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{ev.actor}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-slate-200">{ev.action}</td>
                    <td className="px-3 py-2 font-mono text-slate-400">
                      {ev.entity_type}:{ev.entity_id.slice(0, 14)}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-400 break-all">
                      {JSON.stringify(ev.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
