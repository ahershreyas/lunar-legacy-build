import { SendHorizontal, OctagonX } from "lucide-react";
import { useMissionStore } from "../store/useMissionStore";
import { runMission, emergencyHold } from "../sim/loop";

const PRESETS = [
  { label: "Ice core", goal: "Survey the nearest permanently shadowed cold trap, drill one core for water ice, then return to base." },
  { label: "Ilmenite", goal: "Traverse to the closest flat lowland, drill for ilmenite, then come home with a healthy margin." },
  { label: "Shakedown", goal: "Short shakedown: a 500 metre loop around the landing site with one drill, then return." },
];

export function GoalInput() {
  const goal = useMissionStore((s) => s.goal);
  const draft = useMissionStore((s) => s.draft);
  const running = useMissionStore((s) => s.running);
  const appendLog = useMissionStore((s) => s.appendLog);
  const setDraft = (d: string) => useMissionStore.setState({ draft: d });

  const transmit = (text = draft.trim()) => {
    if (!text || running) return;
    useMissionStore.setState({ goal: text, draft: "" });
    appendLog("COMMANDER", text);
    void runMission(text);
  };

  return (
    <footer className="flex shrink-0 flex-col gap-2 border-t border-white/10 bg-card px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-label">Presets</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            disabled={running}
            onClick={() => transmit(p.goal)}
            title={p.goal}
            className="rounded border border-white/10 bg-well px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-label transition-colors hover:text-telemetry disabled:opacity-40"
          >
            {p.label}
          </button>
        ))}
        {goal && (
          <span className="ml-auto hidden max-w-96 truncate font-mono text-[10px] text-label xl:inline">LAST: {goal}</span>
        )}
      </div>
      <div className="flex h-9 items-center gap-3">
        <span className="text-[11px] uppercase tracking-[0.18em] text-label">Capcom Uplink</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && transmit()}
          placeholder="State a mission goal in plain English…"
          className="h-9 flex-1 rounded border border-white/10 bg-well px-3 font-mono text-xs text-log placeholder:text-label/60 focus:border-telemetry/50 focus:outline-none"
        />
        <button
          onClick={() => transmit()}
          disabled={running}
          className="flex h-9 items-center gap-2 rounded border border-telemetry/40 bg-telemetry/10 px-4 font-mono text-[11px] uppercase tracking-widest text-telemetry transition-colors hover:bg-telemetry/20 disabled:opacity-40"
        >
          Transmit ⟶ 1.28 s
          <SendHorizontal size={12} />
        </button>
        <button
          onClick={emergencyHold}
          disabled={!running}
          className="flex h-9 items-center gap-2 rounded border border-abort/60 bg-abort/15 px-4 font-mono text-[11px] font-semibold uppercase tracking-widest text-abort transition-colors hover:bg-abort/25 disabled:opacity-30"
        >
          <OctagonX size={13} />
          Emergency Hold
        </button>
      </div>
    </footer>
  );
}
