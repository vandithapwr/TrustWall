import { useCallback, useEffect, useState } from "react";
import { Download, FlaskConical, Play, RefreshCw } from "lucide-react";
import { api, type ExperimentResponse, type MetricsResponse, type ModelStatusResponse } from "../lib/api";
import { downloadCsv } from "../lib/csv";
import type { DriftEventRecord } from "../server/types";
import { StatusText } from "../components/StatusText";

interface AdaptiveLearningPageProps {
  reviewerId: string;
  adminToken: string;
  refreshTrigger: number;
}

export function AdaptiveLearningPage({
  reviewerId,
  adminToken,
  refreshTrigger,
}: AdaptiveLearningPageProps) {
  const [modelStatus, setModelStatus] = useState<ModelStatusResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [driftEvents, setDriftEvents] = useState<DriftEventRecord[]>([]);
  const [simulateBad, setSimulateBad] = useState(false);
  const [retraining, setRetraining] = useState(false);
  const [retrainOutcome, setRetrainOutcome] = useState<Awaited<ReturnType<typeof api.retrainModel>> | null>(
    null
  );
  const [experiment, setExperiment] = useState<ExperimentResponse | null>(null);
  const [runningExp, setRunningExp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [status, m, d] = await Promise.all([
        api.getModelStatus(),
        api.getMetrics(),
        api.getDriftEvents(30),
      ]);
      setModelStatus(status);
      setMetrics(m);
      setDriftEvents(d.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load adaptive learning data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const handleRetrain = async () => {
    if (!adminToken.trim()) {
      setError("Enter the Admin Token in the top bar before running candidate retraining.");
      return;
    }
    setRetraining(true);
    setError("");
    setRetrainOutcome(null);
    try {
      const res = await api.retrainModel(
        { reviewer_id: reviewerId || "admin-1", simulate_bad_candidate: simulateBad },
        adminToken
      );
      setRetrainOutcome(res);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retraining failed");
    } finally {
      setRetraining(false);
    }
  };

  const handleRunExperiment = async () => {
    setRunningExp(true);
    setError("");
    try {
      const res = await api.runExperiment();
      setExperiment(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run comparison experiment");
    } finally {
      setRunningExp(false);
    }
  };

  if (loading && !modelStatus) {
    return <div className="p-6 text-sm text-slate-400">Loading drift & adaptation state...</div>;
  }

  const handleExportDriftCsv = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsv(
      `trustwall-drift-events-${timestamp}.csv`,
      ["id", "observed_at", "detector", "feature_name", "score_or_signal", "status"],
      driftEvents.map((d) => [
        d.id,
        d.observed_at,
        d.detector,
        d.feature_name,
        d.score_or_signal,
        d.status,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Adaptive Learning & Drift</h1>
          <p className="mt-1 text-sm text-slate-400">
            ADWIN monitors numeric request streams for traffic drift. Retraining trains strictly on APPROVED samples and passes a fixed validation gate.
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

      {retrainOutcome && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            retrainOutcome.outcome === "ACTIVATED"
              ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
              : "border-rose-500/40 bg-rose-950/30 text-rose-200"
          }`}
        >
          <div className="font-semibold">
            Retrain Outcome: {retrainOutcome.outcome} — Candidate {retrainOutcome.candidate_version} · Active Model{" "}
            {retrainOutcome.active_model_version} · Approved Samples Used {retrainOutcome.approved_samples_used}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums">
            Validation: Precision {retrainOutcome.validation_metrics.precision} · Recall{" "}
            {retrainOutcome.validation_metrics.recall} · F1 {retrainOutcome.validation_metrics.f1} · FPR{" "}
            {retrainOutcome.validation_metrics.fpr}
          </div>
          {retrainOutcome.failures.length > 0 && (
            <div className="mt-1 text-xs">Gate Failures: {retrainOutcome.failures.join("; ")}</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs font-medium text-slate-400">Active Model</div>
          <div className="mt-2 font-mono text-xl font-semibold text-sky-400">
            {modelStatus?.active_model_version}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs font-medium text-slate-400">Approved Samples Ready</div>
          <div className="mt-2 font-mono text-xl font-semibold tabular-nums text-emerald-400">
            {metrics?.quarantine?.approved ?? 0}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs font-medium text-slate-400">ADWIN Drift Events</div>
          <div className="mt-2 font-mono text-xl font-semibold tabular-nums text-sky-400">
            {driftEvents.length}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs font-medium text-slate-400">Drift Signal State</div>
          <div className="mt-2">
            <StatusText value={modelStatus?.drift_detected ? "DETECTED" : "ACTIVE"} />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
        <h2 className="text-sm font-semibold text-slate-100">Controlled Candidate Retraining & Validation Gate</h2>
        <p className="mt-1 text-xs text-slate-400">
          Acceptance Thresholds: Precision ≥ 0.85 · Recall ≥ 0.85 · F1 ≥ 0.85 · FPR ≤ 0.10 on held-out validation split.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={simulateBad}
              onChange={(e) => setSimulateBad(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950"
            />
            Simulate failing candidate (inverted-label validation gate test)
          </label>
          <button
            type="button"
            disabled={retraining}
            onClick={handleRetrain}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {retraining ? "Training & Validating..." : "Run Controlled Retraining"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Baseline Comparison Experiment (Held-Out Test Set)</h2>
            <p className="mt-1 text-xs text-slate-400">
              Compares Static Rules vs. Unverified Adaptive ML (accepting poisoned feedback) vs. TRUSTWALL on 240 held-out samples.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunExperiment}
            disabled={runningExp}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:border-slate-600 disabled:opacity-50"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            {runningExp ? "Evaluating..." : "Run Comparison Experiment"}
          </button>
        </div>

        {experiment && (
          <div className="mt-4 overflow-x-auto border-t border-slate-800 pt-4">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-4 font-medium">Configuration</th>
                  <th className="px-3 py-2 font-medium text-right">Precision</th>
                  <th className="px-3 py-2 font-medium text-right">Recall</th>
                  <th className="px-3 py-2 font-medium text-right">F1 Score</th>
                  <th className="pl-3 py-2 font-medium text-right">FPR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
                <tr>
                  <td className="py-2.5 pr-4 font-sans text-slate-200">Baseline 1 · Static Pattern Rules</td>
                  <td className="px-3 py-2.5 text-right text-slate-200">{experiment.baseline_static_rules.precision}</td>
                  <td className="px-3 py-2.5 text-right text-slate-200">{experiment.baseline_static_rules.recall}</td>
                  <td className="px-3 py-2.5 text-right text-slate-200">{experiment.baseline_static_rules.f1}</td>
                  <td className="pl-3 py-2.5 text-right text-slate-200">{experiment.baseline_static_rules.fpr}</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 font-sans text-rose-300">
                    Baseline 2 · Unverified Adaptive ML (Poisoned Feedback)
                  </td>
                  <td className="px-3 py-2.5 text-right text-rose-300">{experiment.baseline_unverified_ml.precision}</td>
                  <td className="px-3 py-2.5 text-right text-rose-300">{experiment.baseline_unverified_ml.recall}</td>
                  <td className="px-3 py-2.5 text-right text-rose-300">{experiment.baseline_unverified_ml.f1}</td>
                  <td className="pl-3 py-2.5 text-right text-rose-300">{experiment.baseline_unverified_ml.fpr}</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 font-sans font-semibold text-emerald-400">
                    TRUSTWALL · Quarantine + Validation Gate ({experiment.active_model_version})
                  </td>
                  <td className="px-3 py-2.5 text-right text-emerald-400">{experiment.trustwall_controlled.precision}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-400">{experiment.trustwall_controlled.recall}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-400">{experiment.trustwall_controlled.f1}</td>
                  <td className="pl-3 py-2.5 text-right text-emerald-400">{experiment.trustwall_controlled.fpr}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-100">ADWIN Drift Events (Change Signal Only)</h2>
          <button
            type="button"
            onClick={handleExportDriftCsv}
            disabled={driftEvents.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>

        {driftEvents.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No distribution drift detected yet. Dispatch requests to /api/v2/catalog to trigger ADWIN drift.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Observed At</th>
                  <th className="px-3 py-2.5 font-medium">Detector</th>
                  <th className="px-3 py-2.5 font-medium">Monitored Stream</th>
                  <th className="px-3 py-2.5 font-medium text-right">Signal Value</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {driftEvents.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2 font-mono tabular-nums text-slate-400">
                      {new Date(d.observed_at).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-200">{d.detector}</td>
                    <td className="px-3 py-2 font-mono text-slate-200">{d.feature_name}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
                      {d.score_or_signal}
                    </td>
                    <td className="px-4 py-2">
                      <StatusText value={d.status} />
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
