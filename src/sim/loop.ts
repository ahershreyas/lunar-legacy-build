/**
 * Mission flow: plan → code quotes ETA/power/risk → Astra reviews → operator
 * approves → step loop (sense → ask Astra → apply → log). Code never chooses
 * where to go. Only override: hard RETURN failsafe <15%. On REFUSE/CAUTION the
 * rover holds, proposes, and waits for the Commander.
 */
import { useMissionStore, LANDING_SITE, type Pending } from "../store/useMissionStore";
import { roverThink, type RoverDecision, type GroundDecision, type ThinkInput } from "../lib/rover-think.functions";
import { buildLocal, buildRegional, surveyFeatures } from "./sensors";
import { applyMove, applyDrill, DRAIN_PER_100M } from "./actions";
import { quoteRoute, routePoints, countDrills, NATO, type Leg, type Quote } from "./estimate";
import { transmit, Aborted } from "./comms";
import { bearingDeg, gridDistanceM } from "../utils/coords";
import type { TerrainData } from "./terrain";

const MAX_STEPS = 40;
const FAILSAFE_PCT = 15;
let features: ReturnType<typeof surveyFeatures> | null = null;
let featuresFor: TerrainData | null = null;

let ctrl: AbortController | null = null;
let idleCtrl: AbortController | null = null;
let resolver: ((c: Choice) => void) | null = null;
let note = "";

// Live route tracking (absolute stations remaining) for the progress panel.
let route: { col: number; row: number }[] = [];
let drillsLeft = 0;
let doneM = 0;

export type Choice = "approve" | "reject" | "accept_alt" | "override" | "abort" | "confirm" | "proceed" | "longer";

const S = () => useMissionStore.getState();
const set = useMissionStore.setState;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    if (signal.aborted) return rej(new Aborted());
    const id = setTimeout(res, ms);
    signal.addEventListener("abort", () => { clearTimeout(id); rej(new Aborted()); }, { once: true });
  });

/** Operator button press. */
export function choose(c: Choice, reason = "") {
  note = reason;
  const r = resolver;
  resolver = null;
  set({ pending: null });
  r?.(c);
}

function awaitChoice(pending: Pending, signal: AbortSignal): Promise<Choice> {
  return new Promise((res, rej) => {
    if (signal.aborted) return rej(new Aborted());
    set({ pending });
    resolver = (c) => (signal.aborted ? rej(new Aborted()) : res(c));
    signal.addEventListener("abort", () => { resolver = null; rej(new Aborted()); }, { once: true });
  });
}

export function emergencyHold() {
  if (!ctrl) return;
  ctrl.abort();
  ctrl = null;
  resolver = null;
  S().appendLog("COMMANDER", "EMERGENCY HOLD — all motion stopped, queued traffic purged.", "abort");
  set({ status: "IDLE", running: false, pending: null, transmission: null, progress: null, quote: null });
}
export const stopMission = emergencyHold;

const home = () => ({
  home_bearing: Math.round(bearingDeg(S().col, S().row, LANDING_SITE.col, LANDING_SITE.row)),
  home_distance_m: Math.round(gridDistanceM(S().col, S().row, LANDING_SITE.col, LANDING_SITE.row)),
});

function stateOf(extra: Record<string, unknown> = {}) {
  const s = S();
  return {
    col: Math.round(s.col), row: Math.round(s.row), heading: Math.round(s.heading),
    battery: Math.round(s.battery * 10) / 10, met: Math.round(s.met),
    ...home(),
    drain_pct_per_100m: DRAIN_PER_100M,
    samples_taken: s.samples.length,
    ...extra,
  };
}

const history = () => S().log.slice(-10).map((e) => `${e.who}: ${e.text}`);

function riskBlock(q: Quote) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    riskPct: q.riskPct, band: q.band,
    components: { slopeRisk: r2(q.components.slopeRisk), powerRisk: r2(q.components.powerRisk), shadowRisk: r2(q.components.shadowRisk), rangeRisk: r2(q.components.rangeRisk) },
    raw: { peakSlopeDeg: r2(q.raw.peakSlopeDeg), batteryCostPct: r2(q.raw.batteryCostPct), shadowFraction: r2(q.raw.shadowFraction), maxDistanceFromBase_m: Math.round(q.raw.maxDistanceFromBaseM) },
    eta_s: Math.round(q.etaSeconds),
  };
}

/** Uplink → Astra → downlink, aborting cleanly at every boundary. */
async function ask<T = RoverDecision>(signal: AbortSignal, data: ThinkInput, label: string): Promise<T | null> {
  await transmit(signal, `UPLINK · ${label}`);
  if (signal.aborted) throw new Aborted();
  const res = await roverThink({ data }).catch((e) => ({ ok: false as const, status: 0, message: String(e).slice(0, 160) }));
  if (signal.aborted) throw new Aborted();
  if (!res.ok) {
    S().appendLog("SYSTEM", `LOS — ${res.message}`, "abort");
    return null;
  }
  await transmit(signal, `DOWNLINK · ${label}`);
  return res.decision as T;
}

function quoteLegs(t: TerrainData, legs: Leg[]): Quote {
  const s = S();
  return quoteRoute(t, routePoints(s.col, s.row, legs), countDrills(legs), LANDING_SITE);
}

function updateProgress(t: TerrainData) {
  const s = S();
  while (route.length && gridDistanceM(s.col, s.row, route[0]!.col, route[0]!.row) < 30) route.shift();
  if (!route.length) { set({ progress: null }); return; }
  const q = quoteRoute(t, [{ col: s.col, row: s.row }, ...route], drillsLeft, LANDING_SITE);
  set({ progress: { remainingM: q.metres, etaS: q.etaSeconds, doneM, totalM: doneM + q.metres } });
}

function setRoute(legs: Leg[]) {
  const s = S();
  const pts = routePoints(s.col, s.row, legs);
  route = pts.slice(1);
  drillsLeft = countDrills(legs);
  set({ plannedPath: pts });
}

/** Animate along a path; store writes throttled to 4 Hz, map interpolates between them. */
async function drive(t: TerrainData, signal: AbortSignal, path: { col: number; row: number }[], metres: number, cost: number) {
  const startBattery = S().battery;
  const duration = Math.min(8000, Math.max(1200, metres * 12));
  const t0 = performance.now();
  const segLens = path.slice(1).map((p, i) => gridDistanceM(path[i]!.col, path[i]!.row, p.col, p.row));
  const total = segLens.reduce((a, b) => a + b, 0) || 1;
  let prevD = 0;
  for (;;) {
    if (signal.aborted) throw new Aborted();
    const f = Math.min(1, (performance.now() - t0) / duration);
    let d = f * total, i = 0;
    doneM += d - prevD;
    prevD = d;
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
    updateProgress(t);
    if (f >= 1) break;
    await sleep(250, signal);
  }
}

async function driveLeg(t: TerrainData, signal: AbortSignal, bearing: number, metres: number) {
  set({ status: "DRIVING" });
  const s = S();
  const mv = applyMove(t, s.col, s.row, bearing, metres);
  await drive(t, signal, mv.path, mv.travelled, mv.batteryCost);
  if (mv.lipHalt) {
    S().appendLog("SYSTEM", `HALT — ${mv.lipHalt.dropM} m drop detected at ${mv.travelled} m. Motion stopped.`, "abort");
    return { type: "crater_lip", drop_m: mv.lipHalt.dropM, bearing: Math.round(bearing), halted_after_m: mv.travelled };
  }
  return null;
}

async function returnHome(t: TerrainData, signal: AbortSignal) {
  set({ status: "RETURNING" });
  route = [{ col: LANDING_SITE.col, row: LANDING_SITE.row }];
  drillsLeft = 0;
  const s = S();
  const b = bearingDeg(s.col, s.row, LANDING_SITE.col, LANDING_SITE.row);
  const dist = gridDistanceM(s.col, s.row, LANDING_SITE.col, LANDING_SITE.row);
  const mv = applyMove(t, s.col, s.row, b, dist);
  await drive(t, signal, mv.path, mv.travelled, mv.batteryCost);
  set({ status: "COMPLETE", running: false, progress: null });
  S().appendLog("SYSTEM", "Rover 1 at landing site. Mission sequence complete.", "nominal");
}

function logRover(d: RoverDecision, prefix?: string) {
  const tone = d.risk === "HIGH" ? "abort" : d.risk === "MEDIUM" ? "hazard" : "nominal";
  S().appendLog("ROVER 1", prefix ? `${prefix} — ${d.reason}` : `[${d.action} · ${d.risk}] ${d.reason}`, tone);
  S().appendLog("ROVER 1", d.transmission, tone, true);
}

/** Mission Control (second Astra) — only at hazard/detour and sample moments, plus IDLE. */
async function groundCall(signal: AbortSignal, moment: "hazard" | "sample", goal: string, event: unknown) {
  const g = await ask<GroundDecision>(signal, {
    mode: "ground", moment, goal, event, state: stateOf(), history: history(),
  }, "CONTROL");
  if (g) S().appendLog("CONTROL", g.transmission, g.verdict === "QUESTION" ? "hazard" : "nominal", true);
}

export async function controlIdleProposal() {
  const s = S();
  if (!s.terrain || s.running || idleCtrl || s.proposal) return;
  if (featuresFor !== s.terrain) { features = surveyFeatures(s.terrain); featuresFor = s.terrain; }
  idleCtrl = new AbortController();
  const signal = idleCtrl.signal;
  try {
    const g = await ask<GroundDecision>(signal, {
      mode: "ground", moment: "idle", goal: "", state: stateOf(),
      regional: buildRegional(features!, s.col, s.row), history: history(),
    }, "CONTROL");
    if (g && !signal.aborted) {
      S().appendLog("CONTROL", g.transmission, "nominal", true);
      set({ proposal: { target: g.target, bearing: Math.round(g.bearing), distance_m: Math.round(g.distance_m), rationale: g.rationale, transmission: g.transmission } });
    }
  } catch { /* aborted */ } finally {
    if (idleCtrl?.signal === signal) idleCtrl = null;
  }
}

/** REFUSE / CAUTION → hold, propose, wait. Returns legs to drive, or null if the sortie is aborted. */
async function negotiate(t: TerrainData, signal: AbortSignal, goal: string, d: RoverDecision, legs: Leg[]): Promise<Leg[] | null> {
  const q = legs.length ? quoteLegs(t, legs) : null;
  if (d.action === "REFUSE") {
    set({ status: "HOLDING" });
    const alt = d.alternative ? [{ bearing: d.alternative.bearing, distance_m: d.alternative.distance_m, purpose: d.alternative.description }] : [];
    const c = await awaitChoice({
      kind: "refuse", reason: d.reason, transmission: d.transmission,
      alternative: d.alternative, altQuote: alt.length ? quoteLegs(t, alt) : null,
    }, signal);
    if (c === "abort") { S().appendLog("COMMANDER", "ABORT SORTIE.", "abort"); return null; }
    if (c === "accept_alt") { S().appendLog("COMMANDER", `ACCEPT ALTERNATE — ${d.alternative?.description ?? ""}`); return alt; }
    S().appendLog("COMMANDER", "OVERRIDE — ACCEPT RISK. Requesting rover confirmation.", "hazard");
    const conf = await ask(signal, {
      mode: "confirm", goal, state: stateOf(), risk: q ? riskBlock(q) : null,
      proposed_waypoints: legs, history: history(),
    }, "OVERRIDE");
    if (!conf) return null;
    logRover(conf, "RISK RESTATED");
    const c2 = await awaitChoice({ kind: "confirm", reason: conf.reason, transmission: conf.transmission, riskPct: q?.riskPct ?? null }, signal);
    if (c2 !== "confirm") { S().appendLog("COMMANDER", "Override withdrawn. Sortie aborted.", "abort"); return null; }
    S().appendLog("COMMANDER", "Commander accepted the risk. Override confirmed — proceed.", "hazard");
    return legs.length ? legs : [{ bearing: d.heading, distance_m: d.distance }];
  }
  if (d.action === "CAUTION") {
    set({ status: "HOLDING" });
    const alt = d.alternative ? [{ bearing: d.alternative.bearing, distance_m: d.alternative.distance_m, purpose: d.alternative.description }] : null;
    const timeCostS = alt && q ? quoteLegs(t, alt).etaSeconds - q.etaSeconds : null;
    const c = await awaitChoice({ kind: "caution", reason: d.reason, alternative: d.alternative, timeCostS }, signal);
    if (c === "longer" && alt) { S().appendLog("COMMANDER", "TAKE THE LONGER ROUTE."); return alt; }
    S().appendLog("COMMANDER", "PROCEED on current route.");
    return legs.length ? legs : alt;
  }
  return legs;
}

async function sortie(t: TerrainData, signal: AbortSignal, goal: string) {
  // 1. Plan.
  set({ status: "PLANNING" });
  const s0 = S();
  const plan = await ask(signal, {
    mode: "plan", goal, state: stateOf(),
    local: buildLocal(t, s0.col, s0.row, s0.heading), regional: buildRegional(features!, s0.col, s0.row), history: history(),
  }, "PLAN");
  if (!plan) return set({ status: "IDLE", running: false });
  logRover(plan);

  let legs: Leg[] = plan.waypoints;
  let verdict: RoverDecision = plan;

  // 2. Code computes the quote; Astra reviews its own plan against the numbers.
  if (plan.action !== "REFUSE" && legs.length) {
    setRoute(legs);
    const q = quoteLegs(t, legs);
    const review = await ask(signal, {
      mode: "plan", goal, state: stateOf(), risk: riskBlock(q), proposed_waypoints: legs, history: history(),
    }, "RISK REVIEW");
    if (!review) return set({ status: "IDLE", running: false });
    logRover(review, "REVIEW");
    verdict = review;
    if (review.waypoints.length && review.action === "PLAN") legs = review.waypoints;
  }

  // 3. Hold-and-propose on REFUSE / CAUTION; else the mission card.
  if (verdict.action === "REFUSE" || verdict.action === "CAUTION") {
    const chosen = await negotiate(t, signal, goal, verdict, legs);
    if (!chosen || !chosen.length) { set({ status: "IDLE", running: false, plannedPath: [], detour: null }); return; }
    legs = chosen;
  } else {
    if (!legs.length) return set({ status: "IDLE", running: false });
    setRoute(legs);
    const q = quoteLegs(t, legs);
    const s = S();
    // Target = the station farthest from the rover (a loop ends at home, so not the last one).
    const pts = routePoints(s.col, s.row, legs).slice(1);
    let ti = 0;
    pts.forEach((p, i) => { if (gridDistanceM(s.col, s.row, p.col, p.row) > gridDistanceM(s.col, s.row, pts[ti]!.col, pts[ti]!.row)) ti = i; });
    const end = pts[ti]!;
    const lastName = (legs[ti]?.purpose ?? "").match(/Station\s+(\w+)/i)?.[1] ?? NATO[ti] ?? "Final";
    set({
      status: "AWAITING_APPROVAL",
      quote: {
        ...q, strategy: verdict.reason, legs,
        target: { name: `Station ${lastName}`, bearing: Math.round(bearingDeg(s.col, s.row, end.col, end.row)), distance_m: Math.round(gridDistanceM(s.col, s.row, end.col, end.row)) },
      },
    });
    const c = await awaitChoice({ kind: "approve" }, signal);
    set({ quote: null });
    if (c === "reject") {
      S().appendLog("COMMANDER", `REJECT — ${note || "plan not approved"}.`, "hazard");
      set({ status: "IDLE", running: false, plannedPath: [] });
      return;
    }
    S().appendLog("COMMANDER", "APPROVE & UPLINK — sortie is go.");
    await transmit(signal, "UPLINK · SORTIE GO");
  }

  setRoute(legs);
  set({ detour: null });
  updateProgress(t);
  await stepLoop(t, signal, goal);
}

async function stepLoop(t: TerrainData, signal: AbortSignal, goal: string) {
  let hazard: Record<string, unknown> | null = null;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) throw new Aborted();
    const s = S();
    if (s.battery < FAILSAFE_PCT) {
      s.appendLog("SYSTEM", `FAILSAFE — consumables ${s.battery.toFixed(0)}%. Safing: forced RETURN.`, "abort");
      return returnHome(t, signal);
    }
    set({ status: "THINKING" });
    if (hazard) s.appendLog("ROVER 1", "THINK — re-evaluating over a wider arc.", "hazard");
    const approved_route = route.map((p) => ({
      bearing: Math.round(bearingDeg(s.col, s.row, p.col, p.row)),
      distance_m: Math.round(gridDistanceM(s.col, s.row, p.col, p.row)),
    }));
    const d = await ask(signal, {
      mode: "step", goal,
      state: stateOf({ approved_route, ...(hazard ? { hazard } : {}) }),
      local: buildLocal(t, s.col, s.row, s.heading, hazard !== null),
      regional: buildRegional(features!, s.col, s.row),
      history: history(),
    }, "TELEMETRY");
    if (!d) return set({ status: "IDLE", running: false });
    logRover(d, hazard ? "NOTIFY" : undefined);
    hazard = null;

    if (d.waypoints.length) setRoute(d.waypoints);
    const now = S();
    set({ detour: d.alternative ? routePoints(now.col, now.row, [d.alternative]) : null });
    updateProgress(t);

    switch (d.action) {
      case "MOVE":
        hazard = await driveLeg(t, signal, d.heading, d.distance);
        break;
      case "CAUTION":
      case "REFUSE": {
        const legs = await negotiate(t, signal, goal, d, [{ bearing: d.heading, distance_m: d.distance }]);
        if (!legs) return returnHome(t, signal);
        if (d.action === "CAUTION" && d.alternative)
          S().appendLog("ROVER 1", `DIVERT — ${d.alternative.description}`, "hazard");
        for (const l of legs) {
          hazard = await driveLeg(t, signal, l.bearing, l.distance_m);
          if (hazard) break;
        }
        await groundCall(signal, "hazard", goal, { rover_action: d.action, reason: d.reason, hazard });
        break;
      }
      case "DRILL": {
        set({ status: "DRILLING" });
        await sleep(1500, signal);
        const r = applyDrill(t, now.col, now.row);
        set((st) => ({
          battery: Math.max(0, st.battery - r.batteryCost),
          samples: [...st.samples, { met: st.met, col: now.col, row: now.row, reading: r.reading }],
        }));
        drillsLeft = Math.max(0, drillsLeft - 1);
        S().appendLog(
          "SYSTEM",
          `INSTRUMENT — FeTiO₃ ${r.reading.ilmenite.toFixed(2)} · Plag ${r.reading.plagioclase.toFixed(2)} · H₂O ${r.reading.waterIce.toFixed(2)}`,
          "nominal",
        );
        await groundCall(signal, "sample", goal, { reading: r.reading });
        break;
      }
      case "PLAN":
      case "HOLD":
        await sleep(600, signal);
        break;
      case "RETURN":
        return returnHome(t, signal);
    }
    if (hazard) await groundCall(signal, "hazard", goal, { hazard });
    updateProgress(t);
  }
  set({ status: "IDLE", running: false });
}

export async function runMission(goal: string) {
  const t = S().terrain;
  if (!t || S().running) return;
  if (featuresFor !== t) { features = surveyFeatures(t); featuresFor = t; }
  idleCtrl?.abort();
  idleCtrl = null;
  ctrl = new AbortController();
  const signal = ctrl.signal;
  route = []; doneM = 0; drillsLeft = 0;
  set({ running: true, goal, detour: null, plannedPath: [], proposal: null, quote: null, progress: null });
  try {
    await sortie(t, signal, goal);
  } catch (e) {
    if (!(e instanceof Aborted)) {
      S().appendLog("SYSTEM", `LOS — ${String(e).slice(0, 120)}`, "abort");
      set({ status: "IDLE", running: false });
    }
  } finally {
    if (ctrl?.signal === signal) ctrl = null;
    set({ pending: null, transmission: null, running: false, progress: null });
    void controlIdleProposal();
  }
}
