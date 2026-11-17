import { useCallback, useEffect, useState } from "react";
import { RotateCcw, RefreshCw } from "lucide-react";
import { api, type ModelStatusResponse } from "../lib/api";
import type { ModelVersionRecord } from "../server/types";
import { StatusText } from "../components/StatusText";

interface ModelRecoveryPageProps {
  reviewerId: string;
  adminToken: string;
  refreshTrigger: number;
}

export function ModelRecoveryPage({
  reviewerId,
  adminToken,
  refreshTrigger,
}: ModelRecoveryPageProps) {
  const [versions, setVersions] = useState<ModelVersionRecord[]>([]);
  const [status, setStatus] = useState<ModelStatusResponse | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, v] = await Promise.all([api.getModelStatus(), api.getModelVersions()]);
      setStatus(s);
      setVersions(v.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load model registry");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const executeRollback = async (targetVersion: string | null) => {
    if (!adminToken.trim()) {
      setError("Enter the Admin Token in the top bar before rolling back the active model.");
      return;
    }
    setError("");
    setFeedback("");
    try {
      const res = await api.rollbackModel(
        {
          reviewer_id: reviewerId || "admin-1",
          target_version: targetVersion,
          reason: "Manual recovery rollback via Model Recovery console",
        },
        adminToken
      );
      setConfirmTarget(undefined);
      setFeedback(`Rollback complete. Active model restored to ${res.active_model_version}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback failed");
    }
  };

  if (loading && !status) {
    return <div className="p-6 text-sm text-slate-400">Loading model version registry...</div>;
  }

  const lv = status?.last_validation;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Model Recovery & Registry</h1>
          <p className="mt-1 text-sm text-slate-400">
            Inspect active and archived model checkpoints, rejected candidates, and trigger immediate rollback.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
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

      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs text-slate-400">Active Production Model</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-sky-400">
              {status?.active_model_version}
            </div>
            <div className="mt-1 font-mono text-xs tabular-nums text-slate-400">
              Precision {lv?.precision ?? "—"} · Recall {lv?.recall ?? "—"} · F1 {lv?.f1 ?? "—"} · FPR{" "}
              {lv?.fpr ?? "—"}
            </div>
          </div>

          {confirmTarget === null ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-300">Confirm rollback to previous trusted model?</span>
              <button
                type="button"
                onClick={() => executeRollback(null)}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
              >
                Confirm Rollback
              </button>
              <button
                type="button"
                onClick={() => setConfirmTarget(undefined)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmTarget(null)}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-700 px-4 py-2 text-xs font-medium text-white hover:bg-amber-600"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Rollback to Previous Trusted Model
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-100">Model Version History</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="px-4 py-2.5 font-medium">Version</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Parent</th>
                <th className="px-3 py-2.5 font-medium text-right">Approved Samples</th>
                <th className="px-3 py-2.5 font-medium">Validation Metrics / Notes</th>
                <th className="px-4 py-2.5 font-medium">Recovery Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {versions.map((v) => (
                <tr key={v.version} className="hover:bg-slate-800/30">
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-100">{v.version}</td>
                  <td className="px-3 py-2.5">
                    <StatusText value={v.status} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">{v.parent_version ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-300">
                    {v.approved_samples_used}
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-slate-300">
                    P {v.metrics.precision} · R {v.metrics.recall} · F1 {v.metrics.f1} · FPR {v.metrics.fpr}
                    {v.failures && v.failures.length > 0 && (
                      <div className="mt-1 text-rose-400">Rejected: {v.failures.join(", ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {v.status === "ARCHIVED" || v.status === "ROLLED_BACK" ? (
                      confirmTarget === v.version ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => executeRollback(v.version)}
                            className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmTarget(undefined)}
                            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmTarget(v.version)}
                          className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-slate-600"
                        >
                          Restore {v.version}
                        </button>
                      )
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
