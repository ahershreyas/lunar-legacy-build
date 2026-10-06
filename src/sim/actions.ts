/** Pure application of model-selected actions; no navigation or hazard decisions. */
import type { TerrainData, MineralReading } from "./terrain";
import { mineralsAt } from "./terrain";
import { GRID_SIZE, gridDistanceM, offset } from "../utils/coords";
import { quoteRoute } from "./estimate";

export const DRAIN_PER_100M = 0.75;
export const DRILL_COST = 1.5;
export interface MoveResult {
  path: { col: number; row: number }[];
  end: { col: number; row: number };
  travelled: number;
  batteryCost: number;
  durationS: number;
  lipHalt: null;
  boundaryHit: boolean;
  peakSlope: number;
}
export function applyMove(
  t: TerrainData,
  col: number,
  row: number,
  bearing: number,
  metres: number,
): MoveResult {
  const start = { col, row };
  const requested = offset(col, row, bearing, Math.max(0, metres));
  const dx = requested.col - col,
    dy = requested.row - row;
  let fraction = 1;
  for (const [v, d] of [
    [col, dx],
    [row, dy],
  ] as [number, number][]) {
    if (d > 0) fraction = Math.min(fraction, (GRID_SIZE - 1 - v!) / d!);
    if (d < 0) fraction = Math.min(fraction, -v! / d!);
  }
  fraction = Math.max(0, fraction);
  const end = { col: col + dx * fraction, row: row + dy * fraction };
  const travelled = gridDistanceM(col, row, end.col, end.row);
  const path = [start];
  for (let m = 20; m < travelled; m += 20) path.push(offset(col, row, bearing, m));
  path.push(end);
  const q = quoteRoute(t, [start, end], 0, start);
  return {
    path,
    end,
    travelled,
    batteryCost: q.batteryCostPct,
    durationS: q.etaSeconds,
    boundaryHit: fraction < 1,
    peakSlope: q.raw.peakSlopeDeg,
    lipHalt: null,
  };
}
export function applyDrill(
  t: TerrainData,
  col: number,
  row: number,
): { reading: MineralReading; batteryCost: number } {
  return { reading: mineralsAt(t, col, row), batteryCost: DRILL_COST };
}
