import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { useMissionStore } from "../store/useMissionStore";
import { GRID_SIZE, METRES_PER_SAMPLE } from "../utils/coords";
import type { TerrainData } from "../sim/terrain";

const DEFAULT_ZOOM = 4;
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;

/**
 * Shaded-relief map of the full 20.48 km grid, rendered from terrain.bin.
 * Rover is a cyan dot with a fading trail. (SPEC §5: the full map lives here.)
 */
export function MapView2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reliefRef = useRef<HTMLCanvasElement | null>(null);
  const zoomRef = useRef(DEFAULT_ZOOM);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const terrain = useMissionStore((s) => s.terrain);

  const updateZoom = (next: number) => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    zoomRef.current = clamped;
    setZoom(clamped);
  };

  // Build the shaded relief once per terrain load (offscreen, 1024^2).
  useEffect(() => {
    if (!terrain) return;
    reliefRef.current = buildRelief(terrain);
  }, [terrain]);

  // Draw loop: rAF so the rover glides between 4 Hz store updates.
  useEffect(() => {
    if (!terrain) return;
    let raf = 0;
    let disp: { col: number; row: number } | null = null;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const canvas = canvasRef.current;
      const relief = reliefRef.current;
      if (!canvas || !relief) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const st = useMissionStore.getState();
      disp = disp ?? { col: st.col, row: st.row };
      disp.col += (st.col - disp.col) * 0.12;
      disp.row += (st.row - disp.row) * 0.12;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.fillStyle = "#08090C";
      ctx.fillRect(0, 0, w, h);
      const side = Math.min(w, h);
      const ox = (w - side) / 2, oy = (h - side) / 2;
      const scale = (side / GRID_SIZE) * zoomRef.current;
      const mapX = ox + side / 2 - disp.col * scale;
      const mapY = oy + side / 2 - disp.row * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, side, side);
      ctx.clip();
      ctx.drawImage(relief, mapX, mapY, GRID_SIZE * scale, GRID_SIZE * scale);
      const toPx = (c: number, r: number) => ({ x: mapX + c * scale, y: mapY + r * scale });

      const line = (pts: { col: number; row: number }[], color: string, dash: number[]) => {
        if (pts.length < 2) return;
        ctx.setLineDash(dash.map((d) => d * dpr));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        pts.forEach((q, i) => { const p = toPx(q.col, q.row); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.stroke();
        ctx.setLineDash([]);
      };
      line(st.plannedPath, "rgba(56, 189, 248, 0.7)", [4, 4]);
      if (st.detour) line(st.detour, "#F59E0B", [6, 3]);

      const trail = st.trail;
      for (let i = 1; i < trail.length; i++) {
        const a = i / trail.length;
        const p0 = toPx(trail[i - 1]!.col, trail[i - 1]!.row);
        const p1 = toPx(trail[i]!.col, trail[i]!.row);
        ctx.strokeStyle = `rgba(6, 182, 212, ${0.15 + a * 0.6})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      for (const sm of st.samples) {
        const p = toPx(sm.col, sm.row);
        ctx.strokeStyle = "#10B981"; ctx.lineWidth = 1.5 * dpr;
        ctx.strokeRect(p.x - 3 * dpr, p.y - 3 * dpr, 6 * dpr, 6 * dpr);
      }
      const p = toPx(disp.col, disp.row);
      ctx.strokeStyle = "rgba(6, 182, 212, 0.5)";
      ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.arc(p.x, p.y, 9 * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(6, 182, 212, 0.32)"; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "#06B6D4"; ctx.fill();
      ctx.restore();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [terrain]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-border bg-canvas">
      <canvas ref={canvasRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.2em] text-label">
        Rover Survey — {Math.round((GRID_SIZE * METRES_PER_SAMPLE) / zoom).toLocaleString()} m across · {zoom}×
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-md border border-border bg-card/90 p-1 shadow-lg backdrop-blur-sm">
        <Button
          aria-label="Zoom in on rover"
          title="Zoom in on rover"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-telemetry hover:bg-well hover:text-telemetry"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => updateZoom(zoom * 2)}
        >
          <Plus aria-hidden="true" />
        </Button>
        <div className="h-px bg-border" />
        <Button
          aria-label="Zoom out from rover"
          title="Zoom out from rover"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-telemetry hover:bg-well hover:text-telemetry"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => updateZoom(zoom / 2)}
        >
          <Minus aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function buildRelief(t: TerrainData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = GRID_SIZE;
  c.height = GRID_SIZE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(GRID_SIZE, GRID_SIZE);
  const e = t.elevation;
  const range = t.maxElev - t.minElev || 1;
  const N = GRID_SIZE;
  // Sun from the north-west for hillshading.
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;

  for (let r = 0; r < N; r++) {
    for (let q = 0; q < N; q++) {
      const i = r * N + q;
      const l = e[r * N + Math.max(q - 1, 0)] ?? 0;
      const rt = e[r * N + Math.min(q + 1, N - 1)] ?? 0;
      const u = e[Math.max(r - 1, 0) * N + q] ?? 0;
      const d = e[Math.min(r + 1, N - 1) * N + q] ?? 0;
      const dzdx = (rt - l) / (2 * METRES_PER_SAMPLE);
      const dzdy = (d - u) / (2 * METRES_PER_SAMPLE);
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      let shade =
        Math.sin(alt) * Math.cos(slope) +
        Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect);
      shade = Math.max(0, Math.min(1, shade));

      const h = ((e[i] ?? 0) - t.minElev) / range;
      // Dark regolith base, lifted by elevation, modulated by hillshade.
      const base = 26 + h * 90;
      const v = Math.round(base * (0.45 + 0.55 * shade));
      const o = i * 4;
      img.data[o] = v;
      img.data[o + 1] = v + 2;
      img.data[o + 2] = v + 5;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
