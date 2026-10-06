import type { Quote } from "../sim/estimate";

const bandTone = (b: Quote["band"]) =>
  b === "LOW" ? "text-path" : b === "MODERATE" ? "text-telemetry" : b === "HIGH" ? "text-hazard" : "text-abort";
const barTone = (b: Quote["band"]) =>
  b === "LOW" ? "bg-path" : b === "MODERATE" ? "bg-telemetry" : b === "HIGH" ? "bg-hazard" : "bg-abort";

/** Code-computed risk, broken out so it can be interrogated. */
export function RiskGauge({ q }: { q: Quote }) {
  const rows = [
    { label: "Slope", w: 0.35, v: q.components.slopeRisk, max: 1.5, raw: `peak ${q.raw.peakSlopeDeg.toFixed(1)}° / 22°` },
    { label: "Power", w: 0.35, v: q.components.powerRisk, max: 1.2, raw: `${q.raw.batteryCostPct.toFixed(1)}% / 85%` },
    { label: "Shadow", w: 0.15, v: q.components.shadowRisk, max: 1, raw: `${(q.raw.shadowFraction * 100).toFixed(0)}% cells < 0.10` },
    { label: "Range", w: 0.15, v: q.components.rangeRisk, max: 1, raw: `${Math.round(q.raw.maxDistanceFromBaseM).toLocaleString()} m / 5,000 m` },
  ];
  const angle = (q.riskPct / 100) * 180;
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3">
        <svg viewBox="0 0 100 56" className="h-14 w-24 shrink-0">
          <path d="M8 50 A42 42 0 0 1 92 50" fill="none" stroke="currentColor" strokeWidth="8" className="text-white/10" />
          <path
            d="M8 50 A42 42 0 0 1 92 50"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            pathLength={180}
            strokeDasharray={`${angle} 180`}
            className={bandTone(q.band)}
          />
        </svg>
        <div className="font-mono">
          <div className={`text-2xl tabular-nums ${bandTone(q.band)}`}>{q.riskPct}%</div>
          <div className={`text-[10px] uppercase tracking-widest ${bandTone(q.band)}`}>{q.band} risk</div>
        </div>
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[52px_1fr_auto] items-center gap-2 font-mono text-[10px]">
            <span className="uppercase tracking-wider text-label">{r.label}</span>
            <div className="h-1.5 rounded bg-white/10">
              <div className={`h-full rounded ${barTone(q.band)}`} style={{ width: `${Math.min(100, (r.v / r.max) * 100)}%` }} />
            </div>
            <span className="tabular-nums text-log">
              {r.v.toFixed(2)} × {r.w} · <span className="text-label">{r.raw}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
