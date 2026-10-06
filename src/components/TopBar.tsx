import { useEffect, useState } from "react";
import { DataSources } from "./OpsPanels";
import { Radio, Volume2, VolumeX } from "lucide-react";
import { unlockAudio, silence } from "../utils/radioVoice";
import { useMissionStore } from "../store/useMissionStore";
import { toLatLon, formatMET } from "../utils/coords";

export function TopBar() {
  const col = useMissionStore((s) => s.col);
  const row = useMissionStore((s) => s.row);
  const met = useMissionStore((s) => s.met);
  const tick = useMissionStore((s) => s.tick);
  const comms = useMissionStore((s) => s.commsMode);
  const [sources, setSources] = useState(false);
  const toggleComms = () => {
    const next = comms === "TEXT" ? "VOICE" : "TEXT";
    if (next === "VOICE") unlockAudio();
    else silence();
    useMissionStore.setState({ commsMode: next });
  };

  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      tick(Math.min((now - last) / 1000, 0.5));
      last = now;
    }, 250);
    return () => clearInterval(id);
  }, [tick]);

  const { latSouth, lonEast } = toLatLon(col, row);

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-4 border-b border-white/10 bg-card px-4 py-2">
      <span className="font-mono text-sm font-semibold uppercase tracking-[0.35em] text-white">
        UMBRA
      </span>
      <span className="h-5 w-px bg-white/15" />
      <span className="text-[11px] uppercase tracking-[0.2em] text-label">
        Lunar Surface Operations
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs tabular-nums">
        <span className="text-label">
          MET <span className="text-telemetry">{formatMET(met)}</span>
        </span>
        <span className="text-label">
          <span className="font-sans text-[10px] uppercase tracking-wider">
            Selenographic Position{" "}
          </span>
          <span className="text-telemetry">
            {latSouth.toFixed(4)}° S&nbsp;&nbsp;{lonEast.toFixed(3)}° E
          </span>
        </span>
        <span className="flex items-center gap-1.5 rounded border border-white/10 bg-well px-2 py-0.5 text-label">
          <Radio size={11} className="text-telemetry" />
          1.28s
        </span>
        <button
          onClick={toggleComms}
          aria-label="Toggle comms voice"
          className={`flex items-center gap-1.5 rounded border px-2 py-0.5 transition-colors ${comms === "VOICE" ? "border-telemetry/50 bg-telemetry/10 text-telemetry" : "border-white/10 bg-well text-label hover:text-log"}`}
        >
          {comms === "VOICE" ? <Volume2 size={11} /> : <VolumeX size={11} />}
          COMMS {comms === "VOICE" ? "TEXT + VOICE" : "TEXT ONLY"}
        </button>
        <span className="rounded border border-white/10 bg-well px-2 py-0.5 text-label">
          TIME ×120
        </span>
        <button
          onClick={() => setSources(true)}
          className="rounded border border-white/10 bg-well px-2 py-0.5 text-label hover:text-telemetry"
        >
          DATA SOURCES
        </button>
        <DataSources open={sources} onOpenChange={setSources} />
      </div>
    </header>
  );
}
