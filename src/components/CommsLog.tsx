import { useEffect, useRef } from "react";
import { Satellite } from "lucide-react";
import { useMissionStore } from "../store/useMissionStore";
import { formatMET } from "../utils/coords";
import { speak } from "../utils/radioVoice";

export function CommsLog() {
  const log = useMissionStore((s) => s.log);
  const scrollRef = useRef<HTMLDivElement>(null);
  const spoken = useRef(-1);

  useEffect(() => {
    if (spoken.current < 0) { spoken.current = log.length; return; }
    const mode = useMissionStore.getState().commsMode;
    for (let i = spoken.current; i < log.length; i++) {
      const e = log[i]!;
      if (mode === "VOICE" && e.voice) speak(e.who, e.text);
    }
    spoken.current = log.length;
  }, [log]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-md border border-white/10 bg-card p-3">
      <header className="mb-2 flex items-center gap-2">
        <Satellite size={12} className="text-telemetry" />
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-label">
          Comm Downlink
        </h2>
      </header>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 font-mono text-[11px] leading-relaxed"
      >
        {log.length === 0 && (
          <p className="text-label">— Channel open. No traffic. —</p>
        )}
        {log.map((e, i) => (
          <div key={i} className="text-log">
            <span className="text-label">{formatMET(e.t)}</span>{" "}
            <span
              className={`uppercase tracking-wider ${
                e.who === "ROVER 1"
                  ? "text-path"
                  : e.who === "CONTROL"
                    ? "text-telemetry"
                    : e.who === "COMMANDER"
                      ? "text-hazard"
                      : "text-label"
              }`}
            >
              {e.who}
            </span>{" "}
            <span className={e.tone === "abort" ? "text-abort" : e.tone === "hazard" ? "text-hazard" : ""}>{e.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
