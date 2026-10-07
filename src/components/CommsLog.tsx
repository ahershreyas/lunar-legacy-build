import { useEffect, useRef, useSyncExternalStore } from "react";
import { Satellite } from "lucide-react";
import { useMissionStore } from "../store/useMissionStore";
import { formatMET } from "../utils/coords";
import { speak, unlockAudio, getRadioStatus, subscribeRadio } from "../utils/radioVoice";

export function CommsLog() {
  const radio = useSyncExternalStore(subscribeRadio, getRadioStatus, () => "RADIO STANDBY");
  const log = useMissionStore((s) => s.log);
  const scrollRef = useRef<HTMLDivElement>(null);
  const spoken = useRef(-1);

  useEffect(() => {
    if (spoken.current < 0) {
      spoken.current = log.length;
      return;
    }
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
    <section className="flex min-h-40 flex-1 flex-col rounded-md border border-white/10 bg-card p-3">
      <header className="mb-2 flex items-center gap-2">
        <Satellite size={12} className="text-telemetry" />
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-label">
          Comm Downlink
        </h2>
      </header>
      <div className="mb-2 grid grid-cols-2 gap-2">
        {(["MISSION CONTROL", "ROVER 1"] as const).map((role) => {
          const active = radio.startsWith(`${role} SPEAKING`);
          return (
            <button
              type="button"
              key={role}
              aria-label={`Play ${role} radio voice`}
              title={`Play ${role} voice (Lovable neural · ${role === "MISSION CONTROL" ? "Onyx" : "Nova"})`}
              onClick={() => {
                unlockAudio();
                const last = [...useMissionStore.getState().log]
                  .reverse()
                  .find((e) => e.who === (role === "MISSION CONTROL" ? "CONTROL" : "ROVER 1"));
                speak(
                  role === "MISSION CONTROL" ? "CONTROL" : "ROVER 1",
                  last?.text ??
                    (role === "MISSION CONTROL"
                      ? "Rover One, Mission Control. Radio check, how copy? Over."
                      : "Mission Control, Rover One. Read you loud and clear. Standing by. Over."),
                );
              }}
              className={`rounded border p-2 text-left hover:bg-white/5 ${role === "MISSION CONTROL" ? "border-sky-400/25 text-sky-400" : "border-emerald-400/25 text-emerald-400"}`}
            >
              <span className="block text-[9px] tracking-widest">
                ▶ {role} · {active ? "TRANSMITTING" : "STANDBY"} ·{" "}
                {role === "MISSION CONTROL" ? "ONYX" : "NOVA"}
              </span>
              <div
                aria-label={`${role} voice activity`}
                className="flex h-7 items-center gap-[3px]"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      height: active ? `${20 + ((i * 37) % 80)}%` : "8%",
                      animation: active
                        ? `radio-wave ${0.35 + (i % 5) * 0.09}s ease-in-out ${i * 0.03}s infinite alternate`
                        : "none",
                    }}
                    className="w-[3px] rounded bg-current opacity-80"
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>
      <style>{`@keyframes radio-wave {from {transform:scaleY(0.2);opacity:0.4} to {transform:scaleY(1);opacity:1}}`}</style>
      <p className="mb-1 text-[9px] text-label">
        AUTO RADIO · MISSION HANDOFF ONLY · LIVE TELEMETRY ABOVE ROVER
      </p>
      <p role="status" className="mb-2 text-[10px] text-telemetry">
        {radio}
      </p>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 font-mono text-[11px] leading-relaxed"
      >
        {log.length === 0 && <p className="text-label">— Channel open. No traffic. —</p>}
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
              {e.who === "CONTROL" ? "MISSION CONTROL" : e.who}
            </span>{" "}
            {e.voice && (
              <button
                aria-label={`Replay ${e.who === "CONTROL" ? "Mission Control" : "Rover 1"} transmission ${i + 1}`}
                className="mr-1 text-telemetry"
                onClick={() => {
                  unlockAudio();
                  speak(e.who, e.text);
                }}
              >
                ▶
              </button>
            )}
            <span
              className={
                e.tone === "abort" ? "text-abort" : e.tone === "hazard" ? "text-hazard" : ""
              }
            >
              {e.text}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
