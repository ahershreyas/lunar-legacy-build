import { useEffect, useRef } from "react";
import { useMissionStore } from "../store/useMissionStore";
import { GRID_SIZE, METRES_PER_SAMPLE } from "../utils/coords";
import type { TerrainData } from "../sim/terrain";

/**
 * Shaded-relief map of the full 20.48 km grid, rendered from terrain.bin.
 * Rover is a cyan dot with a fading trail. (SPEC §5: the full map lives here.)
 */
export function MapView2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reliefRef = useRef<HTMLCanvasElement | null>(null);
  const terrain = useMissionStore((s) => s.terrain);
  const col = useMissionStore((s) => s.col);
  const row = useMissionStore((s) => s.row);
  const trail = useMissionStore((s) => s.trail);

  // Build the shaded relief once per terrain load (offscreen, 1024^2).
  useEffect(() => {
    if (!terrain) return;
    reliefRef.current = buildRelief(terrain);
  }, [terrain]);

  // Draw loop: blit relief, overlay trail + rover.
  useEffect(() => {
    const canvas = canvasRef.current;
    const relief = reliefRef.current;
    if (!canvas || !relief) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    ctx.fillStyle = "#08090C";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Fit the square relief into the canvas, centred.
    const side = Math.min(canvas.width, canvas.height);
    const ox = (canvas.width - side) / 2;
    const oy = (canvas.height - side) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(relief, ox, oy, side, side);

    const toPx = (c: number, r: number) => ({
      x: ox + (c / GRID_SIZE) * side,
      y: oy + (r / GRID_SIZE) * side,
    });

    // Fading trail
    if (trail.length > 1) {
      for (let i = 1; i < trail.length; i++) {
        const a = i / trail.length;
        const tp0 = trail[i - 1]!;
        const tp1 = trail[i]!;
        const p0 = toPx(tp0.col, tp0.row);
        const p1 = toPx(tp1.col, tp1.row);
        ctx.strokeStyle = `rgba(6, 182, 212, ${0.15 + a * 0.6})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }

    // Rover dot
    const p = toPx(col, row);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(6, 182, 212, 0.25)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = "#06B6D4";
    ctx.fill();
  }, [terrain, col, row, trail]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-white/10 bg-canvas">
      <canvas ref={canvasRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.2em] text-label">
        Orbital Survey — 20,480 m · {METRES_PER_SAMPLE} m/px
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
