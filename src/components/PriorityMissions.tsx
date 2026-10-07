import { useEffect, useRef, useState } from "react";
import { useMissionStore } from "../store/useMissionStore";
import { runMission, suggestPriorityMissions } from "../sim/loop";
import type { MissionSuggestion } from "../lib/rover-think.functions";
export function PriorityMissions() {
  const running = useMissionStore((s) => s.running);
  const link = useMissionStore((s) => s.link);
  const col = useMissionStore((s) => s.col),
    row = useMissionStore((s) => s.row);
  const [missions, setMissions] = useState<MissionSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState({ col, row });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (running) controller.current?.abort();
  }, [running]);
  const generate = async () => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    try {
      const result = await suggestPriorityMissions(c.signal);
      if (c.signal.aborted) return;
      if (!result) {
        setError(
          useMissionStore.getState().linkMessage ||
            "Unable to generate missions. Check the mission link.",
        );
        return;
      }
      setMissions(result.missions);
      setOrigin({ col, row });
    } catch {
      if (!c.signal.aborted) setError("Mission briefing interrupted. Retry.");
    } finally {
      if (controller.current === c) setBusy(false);
    }
  };
  const stale = Math.abs(col - origin.col) + Math.abs(row - origin.row) > 0.1;
  return (
    <section className="space-y-2 p-3 font-mono text-[11px]">
      <div className="text-telemetry">MISSION CONTROL · PRIORITY MISSIONS</div>
      <button
        disabled={busy || running || link !== "READY"}
        onClick={() => void generate()}
        className="w-full rounded border border-telemetry/40 bg-telemetry/10 px-3 py-2 text-telemetry disabled:opacity-40"
      >
        {busy ? "Ground is assessing telemetry…" : "GENERATE MISSIONS"}
      </button>
      {error && (
        <p role="alert" className="text-hazard">
          {error}
        </p>
      )}
      {stale && missions.length > 0 && (
        <p className="text-hazard">Rover position changed. Refresh missions before assigning.</p>
      )}
      {missions.map((m, i) => (
        <article key={i} className="space-y-2 rounded border border-white/15 bg-well/60 p-2">
          <div
            className={
              m.priority === "URGENT"
                ? "text-abort"
                : m.priority === "HIGH"
                  ? "text-hazard"
                  : "text-telemetry"
            }
          >
            {i + 1}. {m.priority} · {m.title}
          </div>
          <p className="text-label">{m.rationale}</p>
          <p className="text-log">{m.goal}</p>
          <button
            disabled={running || busy || stale || link !== "READY"}
            className="w-full rounded border border-nominal/40 p-2 text-nominal disabled:opacity-40"
            onClick={() => {
              useMissionStore.setState({ goal: m.goal, draft: "", proposal: null });
              useMissionStore
                .getState()
                .appendLog("COMMANDER", `ASSIGN MISSION — ${m.title}: ${m.goal}`);
              void runMission(m.goal);
            }}
          >
            SELECT & REQUEST ROVER PLAN
          </button>
        </article>
      ))}
      <p className="text-label">
        Select a mission; Rover 1 acknowledges and plans. Approve & Uplink authorizes execution.
      </p>
    </section>
  );
}
