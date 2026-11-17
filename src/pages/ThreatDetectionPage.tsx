import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Check } from "lucide-react";
import { api } from "../lib/api";
import type { AlertRecord, TrafficLogRecord } from "../server/types";
import { StatusText } from "../components/StatusText";

export function ThreatDetectionPage({ refreshTrigger }: { refreshTrigger: number }) {
  const [blockedRows, setBlockedRows] = useState<TrafficLogRecord[]>([]);
  const [securityAlerts, setSecurityAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [blocked, alerts] = await Promise.all([
        api.getTraffic({ decision: "BLOCK", limit: 30 }),
        api.getAlerts({ type: "security", limit: 30 }),
      ]);
      setBlockedRows(blocked.items);
      setSecurityAlerts(alerts.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load threat detections");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const handleAck = async (id: number) => {
    setError("");
    try {
      await api.acknowledgeAlert(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to acknowledge alert");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Threat Detection</h1>
          <p className="mt-1 text-sm text-slate-400">
            Blocked malicious requests and security alerts. Snippets are rendered strictly as escaped text.
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

      <div className="rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-100">Blocked Requests & Pattern Signals</h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">{blockedRows.length} blocked</span>
        </div>

        {loading && blockedRows.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">Loading threat records...</div>
        ) : blockedRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No blocked requests recorded yet. Send an SQLi or XSS payload in Live Traffic to verify blocking.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Timestamp</th>
                  <th className="px-3 py-2.5 font-medium">Endpoint</th>
                  <th className="px-3 py-2.5 font-medium">Detection Signals</th>
                  <th className="px-3 py-2.5 font-medium text-right">Confidence</th>
                  <th className="px-4 py-2.5 font-medium">Safely Escaped Snippet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {blockedRows.map((row) => (
                  <tr key={row.request_id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {new Date(row.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-200 whitespace-nowrap">
                      {row.method} {row.path}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-rose-300">
                      {row.signals.join(" · ")}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-200">
                      {(row.confidence * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-300 break-all">
                      {row.safe_snippet}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-100">Security Alerts</h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">{securityAlerts.length} alerts</span>
        </div>

        {securityAlerts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No security alerts recorded yet.</div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {securityAlerts.map((alert) => (
              <div key={alert.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <StatusText value={alert.severity} />
                    <span className="text-slate-600">·</span>
                    <StatusText value={alert.status} />
                    <span className="text-slate-600">·</span>
                    <span className="font-mono text-slate-500 tabular-nums">
                      {new Date(alert.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-200">{alert.message}</p>
                </div>

                {alert.status === "OPEN" && (
                  <button
                    type="button"
                    onClick={() => handleAck(alert.id)}
                    className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Acknowledge
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
