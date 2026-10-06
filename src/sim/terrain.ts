/**
 * Pure simulation layer: loads the real NASA Moon Trek binary data and
 * exposes bilinear-interpolated sampling. Never invents numbers.
 * SPEC §1: elevation comes from the .bin files, never from a PNG.
 */
import { GRID_SIZE, METRES_PER_SAMPLE } from "../utils/coords";
import mineralsAsset from "../assets/minerals.bin.asset.json";

export interface TerrainData {
  elevation: Float32Array; // [row*1024 + col], metres
  illumination: Float32Array; // [row*1024 + col], 0..1
  minerals: Float32Array; // [ch*1048576 + row*1024 + col], ch 0..2
  minElev: number;
  maxElev: number;
}

export interface MineralReading {
  ilmenite: number;
  plagioclase: number;
  waterIce: number;
}

const N = GRID_SIZE;
const PLANE = N * N;

export type LoadProgress = (loaded: number, total: number) => void;

/** Stream a file, reporting bytes as they arrive. */
async function fetchBytes(url: string, onBytes: (n: number, total: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url} downlink ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  onBytes(0, total);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes(got, Math.max(total, got));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

export async function loadTerrain(onProgress?: LoadProgress): Promise<TerrainData> {
  const files = ["/terrain.bin", "/illumination.bin", mineralsAsset.url, "/texture.jpg"];
  const loaded = files.map(() => 0);
  const totals = files.map(() => 0);
  const report = () => onProgress?.(loaded.reduce((a, b) => a + b, 0), totals.reduce((a, b) => a + b, 0));
  const bufs = await Promise.all(files.map((f, i) => fetchBytes(f, (n, t) => { loaded[i] = n; totals[i] = t; report(); })));
  const elevation = new Float32Array(bufs[0]!);
  const illumination = new Float32Array(bufs[1]!);
  const minerals = new Float32Array(bufs[2]!);
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let i = 0; i < elevation.length; i++) {
    const v = elevation[i] ?? 0;
    if (v < minElev) minElev = v;
    if (v > maxElev) maxElev = v;
  }
  return { elevation, illumination, minerals, minElev, maxElev };
}

function sampleBilinear(grid: Float32Array, col: number, row: number): number {
  const c = Math.min(Math.max(col, 0), N - 1.001);
  const r = Math.min(Math.max(row, 0), N - 1.001);
  const c0 = Math.floor(c);
  const r0 = Math.floor(r);
  const fc = c - c0;
  const fr = r - r0;
  const i00 = r0 * N + c0;
  const v00 = grid[i00] ?? 0;
  const v10 = grid[i00 + 1] ?? 0;
  const v01 = grid[i00 + N] ?? 0;
  const v11 = grid[i00 + N + 1] ?? 0;
  const top = v00 + (v10 - v00) * fc;
  const bot = v01 + (v11 - v01) * fc;
  return top + (bot - top) * fr;
}

export function heightAt(t: TerrainData, col: number, row: number): number {
  return sampleBilinear(t.elevation, col, row);
}

/** Slope in degrees from the local elevation gradient. */
export function slopeAt(t: TerrainData, col: number, row: number): number {
  const e = t.elevation;
  const c = Math.min(Math.max(Math.round(col), 1), N - 2);
  const r = Math.min(Math.max(Math.round(row), 1), N - 2);
  const eE = e[r * N + c + 1] ?? 0;
  const eW = e[r * N + c - 1] ?? 0;
  const eS = e[(r + 1) * N + c] ?? 0;
  const eN = e[(r - 1) * N + c] ?? 0;
  const dzdx = (eE - eW) / (2 * METRES_PER_SAMPLE);
  const dzdy = (eS - eN) / (2 * METRES_PER_SAMPLE);
  return Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
}

export function illuminationAt(t: TerrainData, col: number, row: number): number {
  return sampleBilinear(t.illumination, col, row);
}

export function mineralsAt(t: TerrainData, col: number, row: number): MineralReading {
  return {
    ilmenite: sampleBilinear(t.minerals.subarray(0, PLANE), col, row),
    plagioclase: sampleBilinear(t.minerals.subarray(PLANE, 2 * PLANE), col, row),
    waterIce: sampleBilinear(t.minerals.subarray(2 * PLANE, 3 * PLANE), col, row),
  };
}
