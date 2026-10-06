import { useEffect } from "react";
import { Radio } from "lucide-react";
import { useMissionStore } from "../store/useMissionStore";
import { toLatLon, formatMET } from "../utils/coords";

export function TopBar() {
  const col = useMissionStore((s) => s.col);
  const row = useMissionStore((s) => s.row);
  const met = useMissionStore((s) => s.met);
  const tick = useMissionStore((s) => s.tick);

  useEffect(() => {
    let last = performance.now();
    let raf: number;
    const loop = (now: number) => {
      tick((now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tick]);

  const { latSouth, lonEast } = toLatLon(col, row);

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-white/10 bg-card px-4">
      <span className="font-mono text-sm font-semibold uppercase tracking-[0.35em] text-white">
        UMBRA
      </span>
      <span className="h-5 w-px bg-white/15" />
      <span className="text-[11px] uppercase tracking-[0.2em] text-label">
        Lunar Surface Operations
      </span>

      <div className="ml-auto flex items-center gap-5 font-mono text-xs tabular-nums">
        <span className="text-label">
          MET{" "}
          <span className="text-telemetry">{formatMET(met)}</span>
        </span>
        <span className="text-label">
          <span className="text-telemetry">
            {latSouth.toFixed(4)}° S&nbsp;&nbsp;{lonEast.toFixed(3)}° E
          </span>
        </span>
        <span className="flex items-center gap-1.5 rounded border border-white/10 bg-well px-2 py-0.5 text-label">
          <Radio size={11} className="text-telemetry" />
          1.28s
        </span>
        <span className="rounded border border-white/10 bg-well px-2 py-0.5 text-label">
          TIME ×60
        </span>
      </div>
    </header>
  );
}
