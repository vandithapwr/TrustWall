import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { api } from "../lib/api";
import type { TrafficLogRecord } from "../server/types";
import { StatusText } from "../components/StatusText";

interface PresetScenario {
  id: string;
  label: string;
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
}

const PRESETS: PresetScenario[] = [
  {
    id: "benign-search",
    label: "Benign Search",
    method: "GET",
    path: "/search",
    query: { q: "books" },
    body: {},
  },
  {
    id: "benign-login",
    label: "Benign Login (Redaction Check)",
    method: "POST",
    path: "/login",
    query: {},
    body: { username: "alice", password: "SecretUserPassword!" },
  },
  {
    id: "sqli-login",
    label: "SQLi Payload",
    method: "POST",
    path: "/login",
    query: {},
    body: { username: "' OR 1=1 --", password: "x" },
  },
  {
    id: "xss-search",
    label: "XSS Payload",
    method: "GET",
    path: "/search",
    query: { q: "<script>alert(1)</script>" },
    body: {},
  },
  {
    id: "traversal",
    label: "Path Traversal",
    method: "GET",
    path: "/search",
    query: { file: "../../etc/passwd" },
    body: {},
  },
  {
    id: "drift-route",
    label: "New Route (/api/v2/catalog)",
    method: "GET",
    path: "/api/v2/catalog",
    query: { sort: "price", page: "1" },
    body: {},
  },
];

export function LiveTrafficPage({ refreshTrigger }: { refreshTrigger: number }) {
  const [decisionFilter, setDecisionFilter] = useState<string>("");
  const [rows, setRows] = useState<TrafficLogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Interactive Proxy Request Console state
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/search");
  const [queryText, setQueryText] = useState('{"q": "books"}');
  const [bodyText, setBodyText] = useState("{}");
  const [sending, setSending] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<Awaited<ReturnType<typeof api.simulateProxyRequest>> | null>(null);

  const loadTraffic = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getTraffic({ decision: decisionFilter, limit: 50 });
      setRows(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load traffic");
    } finally {
      setLoading(false);
    }
  }, [decisionFilter]);

  useEffect(() => {
    loadTraffic();
  }, [loadTraffic, refreshTrigger]);

  const applyPreset = (p: PresetScenario) => {
    setMethod(p.method);
    setPath(p.path);
    setQueryText(JSON.stringify(p.query));
    setBodyText(JSON.stringify(p.body));
  };

  const handleDispatch = async () => {
    setSending(true);
    setError("");
    try {
      const parsedQuery = queryText.trim() ? JSON.parse(queryText) : {};
      const parsedBody = bodyText.trim() ? JSON.parse(bodyText) : {};
      const res = await api.simulateProxyRequest({
        method,
        path,
        query: parsedQuery,
        headers: { accept: "application/json", "content-type": "application/json" },
        payloadBody: parsedBody,
      });
      setLastOutcome(res);
      await loadTraffic();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dispatch proxy request");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Live Traffic & Proxy Console</h1>
        <p className="mt-1 text-sm text-slate-400">
          Dispatch HTTP requests through the TRUSTWALL reverse proxy into the protected TrustShop demo target.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">Interactive Proxy Request Tester</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-sky-500/50 hover:text-white whitespace-nowrap"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs text-slate-400">Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="mb-1 block text-xs text-slate-400">Target Path</label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>

          <div className="md:col-span-3">
            <label className="mb-1 block text-xs text-slate-400">Query JSON</label>
            <input
              type="text"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>

          <div className="md:col-span-3">
            <label className="mb-1 block text-xs text-slate-400">Body JSON</label>
            <input
              type="text"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>

          <div className="flex items-end md:col-span-1">
            <button
              type="button"
              onClick={handleDispatch}
              disabled={sending}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
          </div>
        </div>

        {lastOutcome && (
          <div className="mt-4 border-t border-slate-800 pt-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-slate-300">
              <span>HTTP {lastOutcome.httpStatus}</span>
              <span className="text-slate-600">·</span>
              <StatusText value={lastOutcome.detection.decision} />
              <span className="text-slate-600">·</span>
              <span className="font-mono tabular-nums">
                Confidence {(lastOutcome.detection.confidence * 100).toFixed(1)}%
              </span>
              <span className="text-slate-600">·</span>
              <span className="font-mono text-slate-400">{lastOutcome.detection.model_version}</span>
              <span className="text-slate-600">·</span>
              <span>{lastOutcome.detection.reason}</span>
            </div>
            {lastOutcome.upstreamResponse !== null && (
              <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-950 p-2.5 font-mono text-xs text-slate-300">
                {JSON.stringify(lastOutcome.upstreamResponse, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-100">Inspected Traffic Log</h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">{total} entries</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border border-slate-800 bg-slate-950 p-0.5">
              {["", "ALLOW", "BLOCK", "REVIEW"].map((opt) => (
                <button
                  key={opt || "ALL"}
                  type="button"
                  onClick={() => setDecisionFilter(opt)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    decisionFilter === opt
                      ? "bg-slate-800 text-sky-400"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {opt || "All"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={loadTraffic}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">Loading traffic records...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No traffic records match this filter. Use the Proxy Request Tester above to dispatch live requests.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">Method</th>
                  <th className="px-3 py-2.5 font-medium">Path</th>
                  <th className="px-3 py-2.5 font-medium">Decision</th>
                  <th className="px-3 py-2.5 font-medium text-right">Confidence</th>
                  <th className="px-3 py-2.5 font-medium">Model</th>
                  <th className="px-4 py-2.5 font-medium">Reason & Redacted Snippet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {rows.map((r) => (
                  <tr key={r.request_id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {new Date(r.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-slate-200">{r.method}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-200">{r.path}</td>
                    <td className="px-3 py-2.5">
                      <StatusText value={r.decision} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-200">
                      {(r.confidence * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-400 whitespace-nowrap">{r.model_version}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-200">{r.reason}</div>
                      {r.safe_snippet && (
                        <div className="mt-1 font-mono text-[11px] text-slate-400 break-all">
                          {r.safe_snippet}
                        </div>
                      )}
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
