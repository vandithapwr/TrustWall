import { useState } from "react";
import {
  Activity,
  GitBranch,
  LayoutDashboard,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { AdaptiveLearningPage } from "./pages/AdaptiveLearningPage";
import { LiveTrafficPage } from "./pages/LiveTrafficPage";
import { ModelRecoveryPage } from "./pages/ModelRecoveryPage";
import { OverviewPage } from "./pages/OverviewPage";
import { QuarantinePage } from "./pages/QuarantinePage";
import { ThreatDetectionPage } from "./pages/ThreatDetectionPage";

type PageId = "overview" | "traffic" | "threats" | "quarantine" | "learning" | "recovery";

const NAV_ITEMS: Array<{ id: PageId; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "traffic", label: "Live Traffic", icon: Activity },
  { id: "threats", label: "Threat Detection", icon: ShieldAlert },
  { id: "quarantine", label: "Quarantine", icon: ShieldCheck },
  { id: "learning", label: "Adaptive Learning", icon: GitBranch },
  { id: "recovery", label: "Model Recovery", icon: RotateCcw },
];

export default function App() {
  const [activePage, setActivePage] = useState<PageId>("overview");
  const [reviewerId, setReviewerId] = useState("admin-1");
  const [adminToken, setAdminToken] = useState("trustwall-local-reviewer-token");
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const activeNav = NAV_ITEMS.find((item) => item.id === activePage) ?? NAV_ITEMS[0];

  return (
    <div className="flex min-h-screen bg-[#0b1120] text-slate-100">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-800 bg-[#080d1a] px-4 py-6 md:flex">
        <div className="px-2 pb-6">
          <div className="text-base font-bold tracking-wider text-slate-100">TRUSTWALL</div>
          <div className="mt-1 text-xs text-slate-400">Adaptive WAF Console</div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivePage(item.id)}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-slate-800/90 font-medium text-sky-400"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-[#0b1120] px-6 py-3.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-slate-400">TRUSTWALL</span>
            <span className="text-slate-600">/</span>
            <span className="font-medium text-slate-100 whitespace-nowrap">{activeNav.label}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label htmlFor="reviewer-input" className="text-xs text-slate-400 whitespace-nowrap">
                Reviewer
              </label>
              <input
                id="reviewer-input"
                type="text"
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
                className="w-28 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="token-input" className="text-xs text-slate-400 whitespace-nowrap">
                Admin Token
              </label>
              <input
                id="token-input"
                type="password"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder="ADMIN_REVIEW_TOKEN"
                className="w-44 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>
        </header>

        <div className="flex gap-1 overflow-x-auto border-b border-slate-800 bg-[#080d1a] px-4 py-2 md:hidden">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActivePage(item.id)}
              className={`rounded px-2.5 py-1.5 text-xs whitespace-nowrap ${
                activePage === item.id ? "bg-slate-800 font-medium text-sky-400" : "text-slate-400"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 p-6">
          {activePage === "overview" && (
            <OverviewPage
              refreshTrigger={refreshTrigger}
              onTrafficGenerated={() => setRefreshTrigger((n) => n + 1)}
            />
          )}
          {activePage === "traffic" && <LiveTrafficPage refreshTrigger={refreshTrigger} />}
          {activePage === "threats" && <ThreatDetectionPage refreshTrigger={refreshTrigger} />}
          {activePage === "quarantine" && (
            <QuarantinePage
              reviewerId={reviewerId}
              adminToken={adminToken}
              refreshTrigger={refreshTrigger}
            />
          )}
          {activePage === "learning" && (
            <AdaptiveLearningPage
              reviewerId={reviewerId}
              adminToken={adminToken}
              refreshTrigger={refreshTrigger}
            />
          )}
          {activePage === "recovery" && (
            <ModelRecoveryPage
              reviewerId={reviewerId}
              adminToken={adminToken}
              refreshTrigger={refreshTrigger}
            />
          )}
        </main>
      </div>
    </div>
  );
}
