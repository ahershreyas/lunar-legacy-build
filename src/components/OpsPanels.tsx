import { useEffect, useRef, useState } from "react";
import { requestMicrophone } from "../utils/microphone";
import { transcribeUplink } from "../lib/rover-think.functions";
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
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-label">
        Mission Risk Assessment
      </h2>
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
        <button
          aria-label="Close summary"
          onClick={() => useMissionStore.setState({ summary: null })}
          className="text-label hover:text-log"
        >
          <X size={12} />
        </button>
      </div>
      <Line k="Distance traversed" v={`${Math.round(s.distanceM).toLocaleString()} m`} />
      <Line k="Consumables remaining" v={`${s.consumables.toFixed(1)}%`} />
      <Line k="Mission duration" v={formatDuration(s.durationS)} />
      <div className="pt-1 text-[10px] uppercase tracking-wider text-label">
        Samples acquired · {s.samples.length}
      </div>
      {s.samples.length === 0 && <div className="text-label">No cores acquired.</div>}
      {s.samples.map((x, i) => (
        <div key={i} className="rounded bg-well px-2 py-1 text-log">
          CORE {i + 1} · FeTiO3 {x.reading.ilmenite.toFixed(1)}% · PLAG{" "}
          {x.reading.plagioclase.toFixed(1)}% · H2O {x.reading.waterIce.toFixed(2)}%
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

/* Voice recording works without browser-specific SpeechRecognition. */
export function PushToTalk({ disabled }: { disabled: boolean }) {
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "transcribing">("idle");
  const [message, setMessage] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const permission = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      permission.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  const toggle = async () => {
    if (phase === "requesting") {
      permission.current?.abort();
      return;
    }
    if (phase === "recording") {
      recorder.current?.stop();
      return;
    }
    if (disabled || phase !== "idle") return;
    setMessage("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage(
        "Microphone recording unavailable in this browser. Open the app preview in a browser or type your mission.",
      );
      return;
    }
    setPhase("requesting");
    try {
      const controller = new AbortController();
      permission.current = controller;
      const input = await requestMicrophone(controller.signal);
      if (!mounted.current) {
        input.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = input;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const recording = new MediaRecorder(input, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.current = recording;
      recording.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recording.onstop = async () => {
        if (timer.current) clearTimeout(timer.current);
        input.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        setPhase("transcribing");
        try {
          const blob = new Blob(chunks, { type: recording.mimeType });
          if (!blob.size) throw new Error("No audio captured. Check your microphone and retry.");
          const audio = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
            reader.readAsDataURL(blob);
          });
          const result = await transcribeUplink({
            data: { audio, mime: recording.mimeType.split(";")[0] ?? "audio/webm" },
          });
          if (!mounted.current) return;
          if (result.ok) {
            useMissionStore.setState({ draft: result.text });
            setMessage("Speech ready — review the mission, then Transmit.");
          } else setMessage(result.message);
        } catch (e) {
          if (mounted.current)
            setMessage(
              e instanceof Error ? e.message : "Unable to transcribe. Retry or type your mission.",
            );
        } finally {
          if (mounted.current) setPhase("idle");
        }
      };
      recording.onerror = () => {
        input.getTracks().forEach((t) => t.stop());
        setPhase("idle");
        setMessage("Microphone recording failed. Check microphone access and retry.");
      };
      recording.start();
      setPhase("recording");
      timer.current = setTimeout(() => {
        if (recording.state === "recording") recording.stop();
      }, 30000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setPhase("idle");
      if (mounted.current)
        setMessage(
          e instanceof Error
            ? e.message
            : "Microphone unavailable. Check your input device and retry.",
        );
    }
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={
          (disabled && phase !== "recording" && phase !== "requesting") || phase === "transcribing"
        }
        aria-label="Push to talk"
        aria-pressed={phase === "recording"}
        className={`flex h-9 items-center gap-2 rounded border px-3 font-mono text-[11px] uppercase disabled:opacity-40 ${phase === "recording" ? "border-abort bg-abort/20 text-abort" : "border-white/20 bg-well text-label"}`}
      >
        <Mic size={12} />
        {phase === "recording"
          ? "Stop recording"
          : phase === "transcribing"
            ? "Transcribing…"
            : phase === "requesting"
              ? "Cancel microphone request"
              : "Push to talk"}
      </button>
      {(message || phase === "recording") && (
        <div
          role="status"
          className="absolute bottom-full right-0 z-50 mb-2 w-64 rounded border border-telemetry/40 bg-card p-3 font-mono text-[11px] text-log"
        >
          {phase === "recording" ? "Recording · click again to stop (30 s maximum)." : message}
        </div>
      )}
    </div>
  );
}

/* ---------- DATA SOURCES ---------- */
const SOURCES = [
  {
    file: "terrain.bin",
    inst: "CNSA/CLEP Chang'e-2 CCD stereo DEM (via NASA Moon Trek)",
    res: "1024 × 1024 Float32 · 20 m/sample · 20.48 km square",
    proc: "Lunar south polar stereographic projection, 88.65° S to 89.54° S. Elevation destriped to remove along-track banding.",
  },
  {
    file: "illumination.bin",
    inst: "Derived from the DEM above",
    res: "1024 × 1024 Float32 · 20 m/sample · fraction of lunar day lit (0–1)",
    proc: "Computed from the DEM by ray-casting the horizon in 24 directions for each cell; permanently shadowed cells read near 0.",
  },
  {
    file: "minerals.bin",
    inst: "Modelled — not an instrument product",
    res: "3 × 1024 × 1024 Float32 · 20 m/sample · percent",
    proc: "Ilmenite, plagioclase and water-ice composition modelled from the illumination map, not measured — no polar mineral map exists at 20 m.",
  },
  {
    file: "texture.jpg",
    inst: "NASA/GSFC/Arizona State University LROC (via NASA Moon Trek, JPL-Caltech)",
    res: "2048 × 2048 albedo · 10 m/pixel",
    proc: "Pixel-aligned to the terrain grid in the same polar stereographic frame.",
  },
];

export function DataSources({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[440px] border-white/10 bg-card sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle className="font-mono text-xs uppercase tracking-[0.2em] text-telemetry">
            Data Sources
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px] text-label">
            Files loaded by this console, their origin and processing.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3 overflow-y-auto font-mono text-[11px]">
          {SOURCES.map((s) => (
            <div key={s.file} className="space-y-1 rounded border border-white/10 bg-well p-2">
              <div className="text-telemetry">{s.file}</div>
              <div className="text-log">
                <span className="text-label">INSTRUMENT </span>
                {s.inst}
              </div>
              <div className="text-log">
                <span className="text-label">RESOLUTION </span>
                {s.res}
              </div>
              <div className="text-log">
                <span className="text-label">PROCESSING </span>
                {s.proc}
              </div>
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
      DECISION ENGINE: GPT-6 Astra · TERRAIN: CNSA/CLEP Chang'e-2 DEM · IMAGERY: NASA/GSFC/Arizona
      State University (LROC) · NASA Moon Trek, JPL-Caltech
    </div>
  );
}
