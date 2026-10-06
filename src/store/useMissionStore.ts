/**
 * Mission state store. Owns rover pose, battery, MET, status, goal, plan,
 * log and samples. Never calls Astra; never holds view logic. (SPEC §2)
 */
import { create } from "zustand";
import type { TerrainData, MineralReading } from "../sim/terrain";

export type MissionStatus =
  | "IDLE"
  | "PLANNING"
  | "AWAITING_APPROVAL"
  | "DRIVING"
  | "THINKING"
  | "DRILLING"
  | "RETURNING"
  | "COMPLETE";

export interface LogEntry {
  t: number; // MET seconds
  who: "ROVER 1" | "CONTROL" | "COMMANDER" | "SYSTEM";
  text: string;
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

  setTerrain: (t: TerrainData) => void;
  tick: (realDtSeconds: number) => void;
  appendLog: (who: LogEntry["who"], text: string) => void;
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

  setTerrain: (terrain) => set({ terrain }),
  tick: (realDtSeconds) =>
    set((s) => ({ met: s.met + realDtSeconds * TIME_COMPRESSION })),
  appendLog: (who, text) =>
    set((s) => ({ log: [...s.log, { t: s.met, who, text }] })),
  setGoal: (goal) => set({ goal }),
  setStatus: (status) => set({ status }),
}));
