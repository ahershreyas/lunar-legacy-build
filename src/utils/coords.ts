/**
 * The single source of truth for world <-> grid coordinate conversion.
 * SPEC §8 rule 4: convert in one place or the rover reports minerals from
 * ground it is not on.
 */

export const GRID_SIZE = 1024;
export const METRES_PER_SAMPLE = 20;
export const SPAN_METRES = GRID_SIZE * METRES_PER_SAMPLE; // 20,480

// Lunar south polar stereographic projection bounds (Moon Trek subset)
export const PROJ_LEFT = 13760;
export const PROJ_TOP = -1838;
export const LUNAR_RADIUS = 1737400;

const RAD2DEG = 180 / Math.PI;

/** Grid cell -> real selenographic coordinates. */
export function toLatLon(col: number, row: number): {
  latSouth: number;
  lonEast: number;
} {
  const x = PROJ_LEFT + (col + 0.5) * METRES_PER_SAMPLE;
  const y = PROJ_TOP - (row + 0.5) * METRES_PER_SAMPLE;
  const rho = Math.hypot(x, y);
  return {
    latSouth: Math.abs(2 * (Math.atan(rho / (2 * LUNAR_RADIUS)) * RAD2DEG - 45)),
    lonEast: ((Math.atan2(x, y) * RAD2DEG) + 360) % 360,
  };
}

/** Grid -> world metres, origin at grid (0,0), +x = east(col), +z = south(row). */
export function gridToWorld(col: number, row: number): { x: number; z: number } {
  return { x: col * METRES_PER_SAMPLE, z: row * METRES_PER_SAMPLE };
}

/** World metres -> grid. */
export function worldToGrid(x: number, z: number): { col: number; row: number } {
  return { col: x / METRES_PER_SAMPLE, row: z / METRES_PER_SAMPLE };
}

/** Distance in metres between two grid points. */
export function gridDistanceM(
  colA: number,
  rowA: number,
  colB: number,
  rowB: number,
): number {
  return Math.hypot(colB - colA, rowB - rowA) * METRES_PER_SAMPLE;
}

/** Bearing in degrees (0 = north / -row, clockwise) from A to B. */
export function bearingDeg(
  colA: number,
  rowA: number,
  colB: number,
  rowB: number,
): number {
  const dCol = colB - colA;
  const dRow = rowB - rowA;
  return ((Math.atan2(dCol, -dRow) * RAD2DEG) + 360) % 360;
}

/** Format mission elapsed seconds as MET HH:MM:SS. */
export function formatMET(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(sec)}`;
}
