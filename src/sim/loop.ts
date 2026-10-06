/**
 * Decision loop: sense → ask Astra → apply its action → log → repeat.
 * Code never chooses where to go. Only exception: hard RETURN failsafe <15%.
 */
import { useMissionStore, LANDING_SITE } from "../store/useMissionStore";
import { roverThink, type RoverDecision } from "../lib/rover-think.functions";
import { buildLocal, buildRegional, surveyFeatures, offset } from "./sensors";
import { applyMove, applyDrill, DRAIN_PER_100M } from "./actions";
import { bearingDeg, gridDistanceM } from "../utils/coords";
import type { TerrainData } from "./terrain";

const MAX_STEPS = 40;
const FAILSAFE_PCT = 15;
let features: ReturnType<typeof surveyFeatures> | null = null;
let featuresFor: TerrainData | null = null;
let abort = false;

const S = () => useMissionStore.getState();
const set = useMissionStore.setState;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stopMission() {
  abort = true;
}

/** Animate along a path; store writes throttled to 4 Hz, map interpolates between them. */
async function drive(path: { col: number; row: number }[], metres: number, cost: number) {
  const startBattery = S().battery;
  const duration = Math.min(8000, Math.max(1200, metres * 12));
  const t0 = performance.now();
  const segLens = path.slice(1).map((p, i) => gridDistanceM(path[i]!.col, path[i]!.row, p.col, p.row));
  const total = segLens.reduce((a, b) => a + b, 0) || 1;
  for (;;) {
    const f = Math.min(1, (performance.now() - t0) / duration);
    let d = f * total, i = 0;
    while (i < segLens.length - 1 && d > segLens[i]!) { d -= segLens[i]!; i++; }
    const a = path[i]!, b = path[i + 1] ?? a;
    const k = segLens[i] ? d / segLens[i]! : 1;
    const col = a.col + (b.col - a.col) * k, row = a.row + (b.row - a.row) * k;
    set((s) => ({
      col, row,
      heading: segLens[i] ? bearingDeg(a.col, a.row, b.col, b.row) : s.heading,
      battery: Math.max(0, startBattery - cost * f),
      trail: [...s.trail, { col, row }].slice(-400),
    }));
    if (f >= 1 || abort) break;
    await sleep(250);
  }
}

async function returnHome(t: TerrainData) {
  set({ status: "RETURNING" });
  const s = S();
  const b = bearingDeg(s.col, s.row, LANDING_SITE.col, LANDING_SITE.row);
  const dist = gridDistanceM(s.col, s.row, LANDING_SITE.col, LANDING_SITE.row);
  const mv = applyMove(t, s.col, s.row, b, dist);
  await drive(mv.path, mv.travelled, mv.batteryCost);
  set({ status: "COMPLETE", running: false });
  S().appendLog("SYSTEM", "Rover 1 at landing site. Mission sequence complete.", "nominal");
}

function pathFrom(col: number, row: number, legs: { bearing: number; distance_m: number }[]) {
  const pts = [{ col, row }];
  let c = col, r = row;
  for (const l of legs) { const p = offset(c, r, l.bearing, l.distance_m); c = p.col; r = p.row; pts.push(p); }
  return pts;
}

export async function runMission(goal: string) {
  const t = S().terrain;
  if (!t || S().running) return;
  if (featuresFor !== t) { features = surveyFeatures(t); featuresFor = t; }
  abort = false;
  set({ running: true, goal, detour: null, plannedPath: [] });
  let hazard: Record<string, unknown> | null = null;

  for (let step = 0; step < MAX_STEPS && !abort; step++) {
    const s = S();
    if (s.battery < FAILSAFE_PCT) {
      s.appendLog("SYSTEM", `FAILSAFE — consumables ${s.battery.toFixed(0)}%. Safing: forced RETURN.`, "abort");
      return returnHome(t);
    }
    set({ status: "THINKING" });
    if (hazard) s.appendLog("ROVER 1", "THINK — re-evaluating over a wider arc.", "hazard");
    const res = await roverThink({
      data: {
        mode: "step",
        goal,
        state: {
          col: Math.round(s.col), row: Math.round(s.row), heading: Math.round(s.heading),
          battery: Math.round(s.battery * 10) / 10, met: Math.round(s.met),
          home_bearing: Math.round(bearingDeg(s.col, s.row, LANDING_SITE.col, LANDING_SITE.row)),
          home_distance_m: Math.round(gridDistanceM(s.col, s.row, LANDING_SITE.col, LANDING_SITE.row)),
          drain_pct_per_100m: DRAIN_PER_100M,
          samples_taken: s.samples.length,
          ...(hazard ? { hazard } : {}),
        },
        local: buildLocal(t, s.col, s.row, s.heading, hazard !== null),
        regional: buildRegional(features!, s.col, s.row),
        history: s.log.slice(-8).map((e) => `${e.who}: ${e.text}`),
      },
    }).catch((e) => ({ ok: false as const, status: 0, message: String(e).slice(0, 160) }));

    if (abort) break;
    if (!res.ok) {
      S().appendLog("SYSTEM", `LOS — ${res.message}`, "abort");
      set({ status: "IDLE", running: false });
      return;
    }
    const d: RoverDecision = res.decision;
    const tone = d.risk === "HIGH" ? "abort" : d.risk === "MEDIUM" ? "hazard" : "nominal";
    if (hazard) S().appendLog("ROVER 1", `NOTIFY — ${d.reason}`, "hazard");
    else S().appendLog("ROVER 1", `[${d.action} · ${d.risk}] ${d.reason}`, tone);
    S().appendLog("ROVER 1", d.transmission, tone);
    hazard = null;

    const now = S();
    if (d.waypoints.length) set({ plannedPath: pathFrom(now.col, now.row, d.waypoints) });
    set({ detour: d.alternative ? pathFrom(now.col, now.row, [d.alternative]) : null });

    switch (d.action) {
      case "MOVE":
      case "CAUTION": {
        if (d.action === "CAUTION" && d.alternative)
          S().appendLog("ROVER 1", `DIVERT — ${d.alternative.description}`, "hazard");
        const bearing = d.action === "CAUTION" && d.alternative ? d.alternative.bearing : d.heading;
        const metres = d.action === "CAUTION" && d.alternative ? d.alternative.distance_m : d.distance;
        set({ status: "DRIVING" });
        const mv = applyMove(t, now.col, now.row, bearing, metres);
        await drive(mv.path, mv.travelled, mv.batteryCost);
        if (mv.lipHalt) {
          hazard = { type: "crater_lip", drop_m: mv.lipHalt.dropM, bearing: Math.round(bearing), halted_after_m: mv.travelled };
          S().appendLog("SYSTEM", `HALT — ${mv.lipHalt.dropM} m drop detected at ${mv.travelled} m. Motion stopped.`, "abort");
        }
        break;
      }
      case "DRILL": {
        set({ status: "DRILLING" });
        await sleep(1500);
        const r = applyDrill(t, now.col, now.row);
        set((st) => ({
          battery: Math.max(0, st.battery - r.batteryCost),
          samples: [...st.samples, { met: st.met, col: now.col, row: now.row, reading: r.reading }],
        }));
        S().appendLog(
          "SYSTEM",
          `INSTRUMENT — FeTiO₃ ${(r.reading.ilmenite).toFixed(2)} · Plag ${(r.reading.plagioclase).toFixed(2)} · H₂O ${(r.reading.waterIce).toFixed(2)}`,
          "nominal",
        );
        break;
      }
      case "PLAN":
      case "HOLD":
        await sleep(600);
        break;
      case "RETURN":
        return returnHome(t);
      case "REFUSE":
        set({ status: "IDLE", running: false });
        return;
    }
  }
  set({ status: "IDLE", running: false });
}
