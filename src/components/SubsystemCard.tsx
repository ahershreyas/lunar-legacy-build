import { Activity } from "lucide-react";
import { useMissionStore } from "../store/useMissionStore";
import { slopeAt, illuminationAt } from "../sim/terrain";

export function SubsystemCard() {
  const battery = useMissionStore((s) => s.battery);
  const status = useMissionStore((s) => s.status);
  const terrain = useMissionStore((s) => s.terrain);
  const col = useMissionStore((s) => s.col);
  const row = useMissionStore((s) => s.row);

  const slope = terrain ? slopeAt(terrain, col, row) : 0;
  const illum = terrain ? illuminationAt(terrain, col, row) : 0;

  return (
    <section className="rounded-md border border-white/10 bg-card p-3">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-label">
          <Activity size={12} className="text-telemetry" />
          Subsystem Status
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-nominal">
          Nominal
        </span>
      </header>

      <div className="space-y-3 font-mono text-xs tabular-nums">
        <div>
          <div className="mb-1 flex justify-between text-label">
            <span className="font-sans text-[11px] uppercase tracking-wider">Consumables</span>
            <span className="text-telemetry">{battery.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-well">
            <div
              className="h-full rounded-full bg-nominal transition-[width] duration-300"
              style={{ width: `${battery}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Readout label="Slope" value={`${slope.toFixed(1)}°`} warn={slope > 18} />
          <Readout label="Illum" value={`${Math.round(illum * 100)}%`} />
          <Readout label="State" value={status} small />
        </div>
      </div>
    </section>
  );
}

function Readout({
  label,
  value,
  warn,
  small,
}: {
  label: string;
  value: string;
  warn?: boolean;
  small?: boolean;
}) {
  return (
    <div className="rounded bg-well px-2 py-1.5">
      <div className="font-sans text-[9px] uppercase tracking-wider text-label">{label}</div>
      <div
        className={`${small ? "text-[10px]" : "text-sm"} ${warn ? "text-hazard" : "text-telemetry"}`}
      >
        {value}
      </div>
    </div>
  );
}
