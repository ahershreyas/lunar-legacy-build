/**
 * Pure mission arithmetic: ETA, battery cost and risk %. Always computed in
 * code from terrain along the route — never produced by the model.
 */
import type { TerrainData } from "./terrain";
import { slopeAt, illuminationAt } from "./terrain";
import { gridDistanceM } from "../utils/coords";
import { offset } from "./sensors";

export const SPEED = 0.22; // m/s
export const DRILL = 45; // s per drill
export const NATO = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett"];

export interface Leg { bearing: number; distance_m: number; purpose?: string }
type Pt = { col: number; row: number };

export type RiskBand = "LOW" | "MODERATE" | "HIGH" | "SEVERE";

export interface Quote {
  etaSeconds: number;
  batteryCostPct: number;
  metres: number;
  drills: number;
  riskPct: number;
  band: RiskBand;
  components: { slopeRisk: number; powerRisk: number; shadowRisk: number; rangeRisk: number };
  raw: { peakSlopeDeg: number; batteryCostPct: number; shadowFraction: number; maxDistanceFromBaseM: number };
}

export function routePoints(col: number, row: number, legs: Leg[]): Pt[] {
  const pts: Pt[] = [{ col, row }];
  let c = col, r = row;
  for (const l of legs) {
    const p = offset(c, r, l.bearing, l.distance_m);
    c = p.col; r = p.row;
    pts.push(p);
  }
  return pts;
}

export const countDrills = (legs: Leg[]) => legs.filter((l) => /drill|core|sample/i.test(l.purpose ?? "")).length;

export function riskBand(p: number): RiskBand {
  return p < 25 ? "LOW" : p < 50 ? "MODERATE" : p < 75 ? "HIGH" : "SEVERE";
}

/** Quote a polyline of grid points (first = start). */
export function quoteRoute(t: TerrainData, pts: Pt[], drills: number, base: Pt): Quote {
  let eta = 0, batt = 0, peak = 0, cells = 0, dark = 0, maxR = 0, metres = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const m = gridDistanceM(a.col, a.row, b.col, b.row);
    const n = Math.max(1, Math.ceil(m / 20));
    let sum = 0;
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      const c = a.col + (b.col - a.col) * f, r = a.row + (b.row - a.row) * f;
      const s = slopeAt(t, c, r);
      sum += s;
      peak = Math.max(peak, s);
      if (illuminationAt(t, c, r) < 0.1) dark++;
      cells++;
      maxR = Math.max(maxR, gridDistanceM(base.col, base.row, c, r));
    }
    const pen = 1 + Math.pow(sum / (n + 1) / 22, 1.8);
    eta += (m / SPEED) * pen;
    batt += (m / 1000) * 7.5 * pen;
    metres += m;
  }
  eta += drills * DRILL;
  batt += drills * 1.5;
  const slopeRisk = Math.min(peak / 22, 1.5);
  const powerRisk = batt / 85;
  const shadowRisk = cells ? dark / cells : 0;
  const rangeRisk = Math.min(maxR / 5000, 1);
  const riskPct = Math.round(100 * Math.min(0.35 * slopeRisk + 0.35 * powerRisk + 0.15 * shadowRisk + 0.15 * rangeRisk, 1));
  return {
    etaSeconds: eta,
    batteryCostPct: batt,
    metres,
    drills,
    riskPct,
    band: riskBand(riskPct),
    components: { slopeRisk, powerRisk, shadowRisk, rangeRisk },
    raw: { peakSlopeDeg: peak, batteryCostPct: batt, shadowFraction: shadowRisk, maxDistanceFromBaseM: maxR },
  };
}

/** "1 h 46 m" */
export function formatDuration(s: number) {
  const total = Math.max(0, Math.round(s / 60));
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h} h ${m} m` : `${m} m`;
}

/** "52 m 10 s" */
export function formatEta(s: number) {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h} h ${m} m ${sec} s` : `${m} m ${sec} s`;
}
