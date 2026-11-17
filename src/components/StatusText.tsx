const COLOR_MAP: Record<string, string> = {
  ALLOW: "text-emerald-400",
  APPROVED: "text-emerald-400",
  ACTIVE: "text-emerald-400",
  ACTIVATED: "text-emerald-400",
  normal: "text-emerald-400",
  BLOCK: "text-rose-400",
  REJECTED: "text-rose-400",
  malicious: "text-rose-400",
  high: "text-rose-400",
  REVIEW: "text-amber-400",
  PENDING: "text-amber-400",
  ROLLED_BACK: "text-amber-400",
  medium: "text-amber-400",
  DETECTED: "text-sky-400",
  drift: "text-sky-400",
  validation: "text-amber-400",
  security: "text-rose-400",
  ARCHIVED: "text-slate-400",
  OPEN: "text-amber-400",
  ACKNOWLEDGED: "text-slate-400",
};

export function StatusText({ value }: { value: string }) {
  const color = COLOR_MAP[value] || "text-slate-300";
  return <span className={`font-mono text-xs font-semibold tracking-wide ${color}`}>{value}</span>;
}
