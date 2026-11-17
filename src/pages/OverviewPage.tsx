import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Play } from "lucide-react";
import { api, type MetricsResponse } from "../lib/api";
import type { AlertRecord } from "../server/types";
import { StatusText } from "../components/StatusText";

interface OverviewPageProps {
  refreshTrigger: number;
  onTrafficGenerated: () => void;
}

export function OverviewPage({ refreshTrigger, onTrafficGenerated }: OverviewPageProps) {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningBurst, setRunningBurst] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [m, a] = await Promise.all([api.getMetrics(), api.getAlerts({ limit: 8 })]);
      setMetrics(m);
      setAlerts(a.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const handleSeedTraffic = async () => {
    setRunningBurst(true);
    setError("");
    try {
      await api.runTrafficBurst("mixed");
      await loadData();
      onTrafficGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate demo traffic");
    } finally {
      setRunningBurst(false);
    }
  };

  if (loading && !metrics) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-800 bg-slate-900/60" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg border border-slate-800 bg-slate-900/60" />
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200">
        {error}
      </div>
    );
  }

  const t = metrics?.traffic ?? { total: 0, allowed: 0, blocked: 0, review: 0, avg_latency_ms: 0 };
  const q = metrics?.quarantine ?? { pending: 0, approved: 0, rejected: 0 };
  const evalM = metrics?.model?.evaluation;

  const bars = [
    { label: "Allowed", value: t.allowed, color: "#34d399" },
    { label: "Blocked", value: t.blocked, color: "#fb7185" },
    { label: "Review", value: t.review, color: "#fbbf24" },
    { label: "Quarantine Pending", value: q.pending, color: "#38bdf8" },
  ];
  const maxVal = Math.max(1, ...bars.map((b) => b.value));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Security & Adaptation Overview</h1>
          <p className="mt-1 text-sm text-slate-400">
            Live proxy inspection counts, quarantine queue status, and active classifier evaluation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSeedTraffic}
            disabled={runningBurst}
            className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5" />
            {runningBurst ? "Simulating..." : "Run Mixed Traffic Burst"}
          </button>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800 whitespace-nowrap shrink-0"
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs font-medium text-slate-400">Total Inspected Requests</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-100">{t.total}</div>
          <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
            Avg latency {t.avg_latency_ms} ms
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs font-medium text-slate-400">Blocked Threats</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-rose-400">{t.blocked}</div>
          <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
            Allowed {t.allowed} · Held {t.review}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs font-medium text-slate-400">Quarantine Queue</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-amber-400">{q.pending}</div>
          <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
            Approved {q.approved} · Rejected {q.rejected}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs font-medium text-slate-400">Active Model</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-sky-400">
            {metrics?.model?.active_model_version ?? "model-v1"}
          </div>
          <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
            F1 {evalM?.f1 ?? "—"} · FPR {evalM?.fpr ?? "—"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Traffic & Quarantine Distribution</h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {metrics?.alerts?.drift_events ?? 0} ADWIN drift events
            </span>
          </div>

          <div className="space-y-4 pt-2">
            {bars.map((bar) => {
              const pct = Math.round((bar.value / maxVal) * 100);
              return (
                <div key={bar.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{bar.label}</span>
                    <span className="font-mono font-medium tabular-nums text-slate-100">{bar.value}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-sm bg-slate-800">
                    <div
                      className="h-full transition-all duration-300"
                      style={{ width: `${Math.max(bar.value > 0 ? 4 : 0, pct)}%`, backgroundColor: bar.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Recent Alerts</h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {metrics?.alerts?.open ?? 0} open
            </span>
          </div>

          {alerts.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-400">
                No security or drift alerts yet. Send traffic through the reverse proxy to observe real-time decisions.
              </p>
              <button
                type="button"
                onClick={handleSeedTraffic}
                className="mt-4 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600"
              >
                Run Mixed Traffic Burst
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {alerts.map((alert) => (
                <div key={alert.id} className="flex items-start justify-between gap-4 py-2.5 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusText value={alert.type} />
                      <span className="text-slate-600">·</span>
                      <StatusText value={alert.severity} />
                      <span className="text-slate-600">·</span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {new Date(alert.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-slate-300 leading-relaxed">{alert.message}</p>
                  </div>
                  <StatusText value={alert.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
