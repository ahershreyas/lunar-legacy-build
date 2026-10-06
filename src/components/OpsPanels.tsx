import { useEffect, useRef, useState } from "react";
import { Mic, X } from "lucide-react";
import { useMissionStore } from "../store/useMissionStore";
import { formatDuration } from "../sim/estimate";
import { RiskGauge } from "./RiskGauge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";

/** MISSION RISK ASSESSMENT — visible through the sortie, recomputed from the remaining route. */
export function RiskPanel() {
  const q = useMissionStore((s) => s.liveRisk);
  const running = useMissionStore((s) => s.running);
  const pending = useMissionStore((s) => s.pending);
  if (!q || !running || pending?.kind === "approve") return null;
  return (
    <section className="rounded-md border border-white/10 bg-card px-3 py-2">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-label">Mission Risk Assessment</h2>
      <RiskGauge q={q} />
    </section>
  );
}

export function SortieCompleteCard() {
  const s = useMissionStore((st) => st.summary);
  if (!s) return null;
  return (
    <section className="pointer-events-auto w-[380px] max-w-full space-y-2 rounded-md border border-nominal/40 bg-card/95 p-3 font-mono text-[11px] shadow-lg backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-nominal">
          ◆ Sortie Complete — SORTIE-{String(s.sortieNo).padStart(2, "0")}
        </span>
        <button aria-label="Close summary" onClick={() => useMissionStore.setState({ summary: null })} className="text-label hover:text-log">
          <X size={12} />
        </button>
      </div>
      <Line k="Distance traversed" v={`${Math.round(s.distanceM).toLocaleString()} m`} />
      <Line k="Consumables remaining" v={`${s.consumables.toFixed(1)}%`} />
      <Line k="Mission duration" v={formatDuration(s.durationS)} />
      <div className="pt-1 text-[10px] uppercase tracking-wider text-label">Samples acquired · {s.samples.length}</div>
      {s.samples.length === 0 && <div className="text-label">No cores acquired.</div>}
      {s.samples.map((x, i) => (
        <div key={i} className="rounded bg-well px-2 py-1 text-log">
          CORE {i + 1} · FeTiO3 {x.reading.ilmenite.toFixed(1)}% · PLAG {x.reading.plagioclase.toFixed(1)}% · H2O {x.reading.waterIce.toFixed(2)}%
        </div>
      ))}
    </section>
  );
}

const Line = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between">
    <span className="uppercase tracking-wider text-label">{k}</span>
    <span className="tabular-nums text-telemetry">{v}</span>
  </div>
);

/* ---------- PUSH TO TALK (browser speech recognition, never auto-sends) ---------- */
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function PushToTalk({ disabled }: { disabled: boolean }) {
  const [supported, setSupported] = useState(false);
  const [held, setHeld] = useState(false);
  const rec = useRef<Rec | null>(null);
  const text = useRef("");

  useEffect(() => {
    const w = window as unknown as { webkitSpeechRecognition?: new () => Rec; SpeechRecognition?: new () => Rec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      text.current = Array.from(e.results).map((res) => res[0]?.transcript ?? "").join(" ").trim();
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setSupported(false);
      setHeld(false);
    };
    r.onend = () => {
      setHeld(false);
      if (text.current) useMissionStore.setState({ draft: text.current });
    };
    rec.current = r;
    setSupported(true);
  }, []);

  if (!supported) return null;
  const down = () => {
    if (disabled || !rec.current) return;
    text.current = "";
    try { rec.current.start(); setHeld(true); } catch { /* already started */ }
  };
  const up = () => { if (held) rec.current?.stop(); };

  return (
    <div className="flex items-center gap-2">
      <button
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={up}
        disabled={disabled}
        aria-label="Push to talk"
        className={`flex h-9 select-none items-center gap-2 rounded border px-3 font-mono text-[11px] uppercase tracking-widest transition-colors disabled:opacity-40 ${held ? "border-abort/60 bg-abort/15 text-abort" : "border-white/15 bg-well text-label hover:text-log"}`}
      >
        <Mic size={12} /> Push to Talk
      </button>
      {held && <span className="animate-pulse font-mono text-[10px] uppercase tracking-widest text-abort">● Receiving Uplink</span>}
    </div>
  );
}

/* ---------- DATA SOURCES ---------- */
const SOURCES = [
  { file: "terrain.bin", inst: "CNSA/CLEP Chang'e-2 CCD stereo DEM (via NASA Moon Trek)", res: "1024 × 1024 Float32 · 20 m/sample · 20.48 km square", proc: "Polar-stereographic crop of the south pole; elevation destriped to remove along-track banding; metres relative to the lowest cell." },
  { file: "illumination.bin", inst: "Derived from the DEM above", res: "1024 × 1024 Float32 · 20 m/sample · 0–1", proc: "Computed by ray-casting the horizon in 24 directions for each cell and integrating the Sun's elevation track; permanently shadowed cells read near 0." },
  { file: "minerals.bin", inst: "Modelled — not an instrument product", res: "3 × 1024 × 1024 Float32 · 20 m/sample", proc: "Ilmenite, plagioclase and water-ice fractions modelled from the illumination map and local terrain, not measured: no polar mineral map exists at 20 m." },
  { file: "texture.jpg", inst: "NASA/GSFC/Arizona State University LROC (via NASA Moon Trek, JPL-Caltech)", res: "Orthoimage co-registered to the DEM grid", proc: "Reprojected and cropped to the same polar-stereographic frame as terrain.bin." },
];

export function DataSources({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[440px] border-white/10 bg-card sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle className="font-mono text-xs uppercase tracking-[0.2em] text-telemetry">Data Sources</SheetTitle>
          <SheetDescription className="font-mono text-[11px] text-label">Files loaded by this console, their origin and processing.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3 overflow-y-auto font-mono text-[11px]">
          {SOURCES.map((s) => (
            <div key={s.file} className="space-y-1 rounded border border-white/10 bg-well p-2">
              <div className="text-telemetry">{s.file}</div>
              <div className="text-log"><span className="text-label">INSTRUMENT </span>{s.inst}</div>
              <div className="text-log"><span className="text-label">RESOLUTION </span>{s.res}</div>
              <div className="text-log"><span className="text-label">PROCESSING </span>{s.proc}</div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Attribution() {
  return (
    <div className="shrink-0 truncate bg-canvas px-4 py-1 font-mono text-[11px] text-attribution">
      DECISION ENGINE: GPT-6 Astra · TERRAIN: CNSA/CLEP Chang'e-2 DEM · IMAGERY: NASA/GSFC/Arizona State University (LROC) · NASA Moon Trek, JPL-Caltech
    </div>
  );
}
