/**
 * Mission state store. Owns rover pose, battery, MET, status, goal, plan,
 * log and samples. Never calls Astra; never holds view logic. (SPEC §2)
 */
import { create } from "zustand";
import type { TerrainData, MineralReading } from "../sim/terrain";
import type { Quote, Leg } from "../sim/estimate";
import type { Alternative } from "../lib/rover-think.functions";

export type MissionStatus =
  | "IDLE"
  | "PLANNING"
  | "AWAITING_APPROVAL"
  | "DRIVING"
  | "THINKING"
  | "DRILLING"
  | "HOLDING"
  | "RETURNING"
  | "COMPLETE";

export interface LogEntry {
  t: number; // MET seconds
  who: "ROVER 1" | "CONTROL" | "COMMANDER" | "SYSTEM";
  text: string;
  tone?: "nominal" | "hazard" | "abort" | undefined;
  voice?: boolean | undefined; // a spoken radio transmission
}

export interface MissionQuote extends Quote {
  strategy: string;
  legs: Leg[];
  target: { name: string; bearing: number; distance_m: number };
}

export type Pending =
  | { kind: "approve" }
  | { kind: "refuse"; reason: string; transmission: string; alternative: Alternative | null; altQuote: Quote | null }
  | { kind: "caution"; reason: string; alternative: Alternative | null; timeCostS: number | null }
  | { kind: "confirm"; reason: string; transmission: string; riskPct: number | null };

export interface ControlProposal {
  target: string;
  bearing: number;
  distance_m: number;
  rationale: string;
  transmission: string;
}

export interface Sample {
  met: number;
  col: number;
  row: number;
  reading: MineralReading;
}

export interface MissionPlan {
  summary: string;
  waypoints: { bearing: number; distance_m: number; purpose: string }[];
  etaSeconds: number;
  batteryCostPct: number;
  riskPct: number;
}

export const LANDING_SITE = { col: 320, row: 687 } as const;
export const TIME_COMPRESSION = 60;

interface MissionState {
  terrain: TerrainData | null;
  col: number;
  row: number;
  heading: number; // degrees
  battery: number; // percent
  met: number; // mission elapsed seconds (60x real time)
  status: MissionStatus;
  goal: string;
  plan: MissionPlan | null;
  log: LogEntry[];
  samples: Sample[];
  trail: { col: number; row: number }[];
  plannedPath: { col: number; row: number }[];
  detour: { col: number; row: number }[] | null;
  running: boolean;
  quote: MissionQuote | null;
  pending: Pending | null;
  transmission: { label: string; progress: number } | null;
  proposal: ControlProposal | null;
  commsMode: "TEXT" | "VOICE";
  progress: { remainingM: number; etaS: number; doneM: number; totalM: number } | null;
  draft: string;

  setTerrain: (t: TerrainData) => void;
  tick: (realDtSeconds: number) => void;
  appendLog: (who: LogEntry["who"], text: string, tone?: LogEntry["tone"], voice?: boolean) => void;
  setGoal: (goal: string) => void;
  setStatus: (status: MissionStatus) => void;
}

export const useMissionStore = create<MissionState>((set) => ({
  terrain: null,
  col: LANDING_SITE.col,
  row: LANDING_SITE.row,
  heading: 0,
  battery: 100,
  met: 0,
  status: "IDLE",
  goal: "",
  plan: null,
  log: [],
  samples: [],
  trail: [{ col: LANDING_SITE.col, row: LANDING_SITE.row }],
  plannedPath: [],
  detour: null,
  running: false,
  quote: null,
  pending: null,
  transmission: null,
  proposal: null,
  commsMode: "TEXT",
  progress: null,
  draft: "",

  setTerrain: (terrain) => set({ terrain }),
  tick: (realDtSeconds) =>
    set((s) => ({ met: s.met + realDtSeconds * TIME_COMPRESSION })),
  appendLog: (who, text, tone, voice) =>
    set((s) => ({ log: [...s.log, { t: s.met, who, text, tone, voice }] })),
  setGoal: (goal) => set({ goal }),
  setStatus: (status) => set({ status }),
}));
