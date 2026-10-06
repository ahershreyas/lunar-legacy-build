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

async function fetchF32(url: string): Promise<Float32Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return new Float32Array(await res.arrayBuffer());
}

export async function loadTerrain(): Promise<TerrainData> {
  const [elevation, illumination, minerals] = await Promise.all([
    fetchF32("/terrain.bin"),
    fetchF32("/illumination.bin"),
    fetchF32(mineralsAsset.url),
  ]);
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
