/**
 * Pure sensor layer: builds the compact observations sent to Astra.
 * Never sends the raw grid, never minerals, never ranks or recommends.
 */
import type { TerrainData } from "./terrain";
import { heightAt, slopeAt, illuminationAt } from "./terrain";
import { GRID_SIZE, METRES_PER_SAMPLE, bearingDeg, gridDistanceM } from "../utils/coords";

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export { offset } from "../utils/coords";
import { offset } from "../utils/coords";

export function buildLocal(
  t: TerrainData,
  col: number,
  row: number,
  heading: number,
  wide = false,
) {
  const h0 = heightAt(t, col, row);
  const window: [number, number, number][][] = [];
  for (let dr = -3; dr <= 3; dr++) {
    const line: [number, number, number][] = [];
    for (let dc = -3; dc <= 3; dc++) {
      const c = col + dc,
        r = row + dr;
      line.push([r1(heightAt(t, c, r) - h0), r1(slopeAt(t, c, r)), r2(illuminationAt(t, c, r))]);
    }
    window.push(line);
  }
  const arcs = wide ? [-60, -40, -20, 0, 20, 40, 60] : [-20, 0, 20];
  const probes = [];
  for (const a of arcs) {
    for (const d of [40, 80]) {
      const bearing = (((heading + a) % 360) + 360) % 360;
      const p = offset(col, row, bearing, d);
      probes.push({
        bearing: Math.round(bearing),
        distance_m: d,
        elev_delta_m: r1(heightAt(t, p.col, p.row) - h0),
        slope_deg: r1(slopeAt(t, p.col, p.row)),
        illumination: r2(illuminationAt(t, p.col, p.row)),
      });
    }
  }
  return {
    here: { slope_deg: r1(slopeAt(t, col, row)), illumination: r2(illuminationAt(t, col, row)) },
    window,
    probes,
  };
}

interface Feature {
  type: string;
  col: number;
  row: number;
  depth_m: number;
  illumination: number;
}

/** Survey features from elevation + illumination only. Computed once per terrain. */
export function surveyFeatures(t: TerrainData, origin = { col: 320, row: 687 }): Feature[] {
  const B = 32; // 640 m blocks
  const nb = GRID_SIZE / B;
  const blocks: {
    col: number;
    row: number;
    mean: number;
    min: number;
    max: number;
    illum: number;
    darkCol: number;
    darkRow: number;
    darkIllum: number;
    slope: number;
  }[] = [];
  for (let br = 0; br < nb; br++)
    for (let bc = 0; bc < nb; bc++) {
      let sum = 0,
        mn = Infinity,
        mx = -Infinity,
        il = 0,
        sl = 0,
        n = 0;
      let observed = { col: bc * B + B / 2, row: br * B + B / 2, illumination: Infinity };
      for (let r = br * B; r < (br + 1) * B; r += 4)
        for (let c = bc * B; c < (bc + 1) * B; c += 4) {
          const e = t.elevation[r * GRID_SIZE + c] ?? 0;
          sum += e;
          mn = Math.min(mn, e);
          mx = Math.max(mx, e);
          const light = t.illumination[r * GRID_SIZE + c] ?? 0;
          if (light < observed.illumination) observed = { col: c, row: r, illumination: light };
          il += light;
          sl += slopeAt(t, c, r);
          n++;
        }
      blocks.push({
        col: bc * B + B / 2,
        row: br * B + B / 2,
        darkCol: observed.col,
        darkRow: observed.row,
        darkIllum: observed.illumination,
        mean: sum / n,
        min: mn,
        max: mx,
        illum: il / n,
        slope: sl / n,
      });
    }
  const nearby = blocks.filter((b) => gridDistanceM(origin.col, origin.row, b.col, b.row) < 2500);
  const candidates = nearby.length ? nearby : blocks;
  const globalMean = blocks.reduce((a, b) => a + b.mean, 0) / blocks.length;
  const pick = (score: (b: (typeof blocks)[number]) => number) =>
    candidates.reduce((best, b) => (score(b) > score(best) ? b : best), candidates[0]!);
  const mk = (type: string, b: (typeof blocks)[number]): Feature => ({
    type,
    col: /cold_trap|shadowed/.test(type) ? b.darkCol : b.col,
    row: /cold_trap|shadowed/.test(type) ? b.darkRow : b.row,
    depth_m: Math.round(globalMean - b.min),
    illumination: r2(
      illuminationAt(
        t,
        /cold_trap|shadowed/.test(type) ? b.darkCol : b.col,
        /cold_trap|shadowed/.test(type) ? b.darkRow : b.row,
      ),
    ),
  });
  return [
    mk(
      "cold_trap",
      pick((b) => -b.darkIllum * 2000 - b.mean / 3),
    ),
    mk(
      "sunlit_ridge",
      pick((b) => b.illum * 2000 + b.mean / 3),
    ),
    mk(
      "steep_massif",
      pick((b) => b.slope),
    ),
    mk(
      "flat_lowland",
      pick((b) => -b.slope * 40 - b.mean / 10 + b.illum * 50),
    ),
    mk(
      "crater_rim",
      pick((b) => b.max - b.min),
    ),
    mk(
      "shadowed_crater_floor",
      pick((b) => (b.darkIllum < 0.2 ? b.max - b.min : -1e9)),
    ),
  ];
}

/** Features relative to the rover, shuffled so order carries no meaning. */
export function buildRegional(features: Feature[], col: number, row: number) {
  const out = features.map((f) => ({
    type: f.type,
    bearing: Math.round(bearingDeg(col, row, f.col, f.row)),
    distance_m: Math.round(gridDistanceM(col, row, f.col, f.row)),
    depth_m: f.depth_m,
    illumination: f.illumination,
  }));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
