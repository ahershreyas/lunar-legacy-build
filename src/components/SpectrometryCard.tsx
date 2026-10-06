import { FlaskConical } from "lucide-react";
import { useMissionStore } from "../store/useMissionStore";
import { mineralsAt } from "../sim/terrain";

const RANGES = {
  ilmenite: { min: 2, max: 24, label: "FeTiO₃ (Ilmenite)" },
  plagioclase: { min: 45, max: 92, label: "Plagioclase" },
  waterIce: { min: 0, max: 9, label: "Volatiles / H₂O" },
} as const;

export function SpectrometryCard() {
  const terrain = useMissionStore((s) => s.terrain);
  const col = useMissionStore((s) => s.col);
  const row = useMissionStore((s) => s.row);
  const samples = useMissionStore((s) => s.samples);

  const reading = terrain ? mineralsAt(terrain, col, row) : null;

  return (
    <section className="rounded-md border border-white/10 bg-card p-3">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-label">
          <FlaskConical size={12} className="text-telemetry" />
          Science Payload — Spectrometry
        </h2>
        <span className="font-mono text-[10px] tabular-nums text-label">
          {samples.length} CORE{samples.length === 1 ? "" : "S"}
        </span>
      </header>

      <div className="space-y-2.5">
        {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => {
          const spec = RANGES[k];
          const v = reading ? reading[k] : 0;
          const pct = Math.max(0, Math.min(1, (v - spec.min) / (spec.max - spec.min)));
          return (
            <div key={k}>
              <div className="mb-1 flex justify-between font-mono text-xs tabular-nums">
                <span className="font-sans text-[11px] uppercase tracking-wider text-label">
                  {spec.label}
                </span>
                <span className="text-telemetry">{v.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-well">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${
                    k === "waterIce" ? "bg-path" : "bg-telemetry/70"
                  }`}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
