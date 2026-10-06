/**
 * Pure action application: the arithmetic that follows from Astra's choice.
 * No route selection, no corrections.
 */
import type { TerrainData, MineralReading } from "./terrain";
import { heightAt, slopeAt, mineralsAt } from "./terrain";
import { GRID_SIZE } from "../utils/coords";
import { offset } from "./sensors";

/** Battery % drained per 100 m on flat ground; slope adds load. */
export const DRAIN_PER_100M = 0.6;
export const DRILL_COST = 1.5;

export interface MoveResult {
  path: { col: number; row: number }[]; // 1 m resolution endpoints, sparse
  end: { col: number; row: number };
  travelled: number;
  batteryCost: number;
  lipHalt: { dropM: number } | null;
}

/** Drive along bearing for metres. A physical >0.8 m drop in one metre is a lip: motion stops there. */
export function applyMove(t: TerrainData, col: number, row: number, bearing: number, metres: number): MoveResult {
  const dist = Math.max(0, metres);
  const path = [{ col, row }];
  let prevH = heightAt(t, col, row);
  let cost = 0;
  let travelled = 0;
  let lipHalt: MoveResult["lipHalt"] = null;
  let end = { col, row };
  for (let m = 1; m <= dist; m++) {
    const p = offset(col, row, bearing, m);
    if (p.col < 1 || p.row < 1 || p.col > GRID_SIZE - 2 || p.row > GRID_SIZE - 2) break; // map edge
    const h = heightAt(t, p.col, p.row);
    if (prevH - h > 0.8) { lipHalt = { dropM: Math.round((prevH - h) * 10) / 10 }; break; }
    cost += (DRAIN_PER_100M / 100) * (1 + slopeAt(t, p.col, p.row) / 15);
    prevH = h;
    travelled = m;
    end = p;
    if (m % 20 === 0) path.push(p);
  }
  path.push(end);
  return { path, end, travelled, batteryCost: cost, lipHalt };
}

export function applyDrill(t: TerrainData, col: number, row: number): { reading: MineralReading; batteryCost: number } {
  return { reading: mineralsAt(t, col, row), batteryCost: DRILL_COST };
}
