import { useState } from "react";
import { SendHorizontal } from "lucide-react";
import { useMissionStore } from "../store/useMissionStore";
import { runMission } from "../sim/loop";

export function GoalInput() {
  const goal = useMissionStore((s) => s.goal);
  const setGoal = useMissionStore((s) => s.setGoal);
  const appendLog = useMissionStore((s) => s.appendLog);
  const [draft, setDraft] = useState("");

  const transmit = () => {
    const text = draft.trim();
    if (!text) return;
    setGoal(text);
    appendLog("COMMANDER", text);
    setDraft("");
    void runMission(text);
  };
  const running = useMissionStore((s) => s.running);

  return (
    <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-white/10 bg-card px-4">
      <span className="text-[11px] uppercase tracking-[0.18em] text-label">
        Capcom Uplink
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && transmit()}
        placeholder="State a mission goal in plain English…"
        className="h-9 flex-1 rounded border border-white/10 bg-well px-3 font-mono text-xs text-log placeholder:text-label/60 focus:border-telemetry/50 focus:outline-none"
      />
      <button
        onClick={transmit}
        disabled={running}
        className="flex h-9 items-center gap-2 rounded border border-telemetry/40 bg-telemetry/10 px-4 font-mono text-[11px] uppercase tracking-widest text-telemetry transition-colors hover:bg-telemetry/20 disabled:opacity-40"
      >
        Transmit ⟶ 1.28 s
        <SendHorizontal size={12} />
      </button>
      {goal && (
        <span className="hidden max-w-64 truncate font-mono text-[10px] text-label xl:inline">
          LAST: {goal}
        </span>
      )}
    </footer>
  );
}
