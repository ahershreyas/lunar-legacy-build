import { useEffect, useState } from "react";

const PHASES = ["", "ESTABLISHING UPLINK…", "AOS — ROVER 1 NOMINAL"] as const;

export function LoadingScreen({ done }: { done: boolean }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 500);
    const t2 = setTimeout(() => setPhase(2), 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas transition-opacity duration-700 ${
        done && phase === 2 ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <h1 className="font-mono text-4xl font-semibold uppercase tracking-[0.5em] text-white">
        UMBRA
      </h1>
      <div className="mt-2 h-px w-40 bg-white/15" />
      <p className="mt-2 text-[11px] uppercase tracking-[0.3em] text-label">
        Lunar Surface Operations
      </p>
      <p className="mt-10 h-4 font-mono text-xs tabular-nums text-telemetry">
        {PHASES[phase]}
      </p>
    </div>
  );
}
