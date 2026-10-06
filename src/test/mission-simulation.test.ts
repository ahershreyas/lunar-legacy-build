import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { applyMove, applyDrill } from "../sim/actions";
import { quoteRoute } from "../sim/estimate";
import { heightAt, mineralsAt, type TerrainData } from "../sim/terrain";
import { gridToScene, sceneToGrid } from "../utils/coords";
import { useMissionStore, LANDING_SITE } from "../store/useMissionStore";

const think = vi.hoisted(() => vi.fn());
vi.mock("../lib/rover-think.functions", () => ({ roverThink: think }));
vi.mock("../sim/comms", async (load) => {
  const actual = await load<typeof import("../sim/comms")>();
  return {
    ...actual,
    transmit: async (signal: AbortSignal) => {
      if (signal.aborted) throw new actual.Aborted();
    },
  };
});
import { runMission, choose, emergencyHold } from "../sim/loop";
const N = 1024 * 1024;
const flat: TerrainData = {
  elevation: new Float32Array(N),
  illumination: new Float32Array(N).fill(0.65),
  minerals: new Float32Array(3 * N).fill(4.1),
  minElev: 0,
  maxElev: 0,
};
const decision = (action: string, extra = {}) => ({
  action,
  heading: 90,
  distance: 20,
  waypoints: [],
  risk: "LOW",
  alternative: null,
  reason: "test",
  transmission: "Mission Control, Rover 1. Standing by.",
  ...extra,
});
const initial = useMissionStore.getState();
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  think.mockReset();
  useMissionStore.setState({
    ...initial,
    timeCompression: 120,
    terrain: flat,
    link: "READY",
    trail: [{ ...LANDING_SITE }],
  });
});
afterEach(() => {
  emergencyHold();
  vi.useRealTimers();
});

describe("Simulation arithmetic", () => {
  it("uses exactly the same flat power and duration in the quote and movement", () => {
    const m = applyMove(flat, 320, 687, 90, 1000.5);
    const q = quoteRoute(flat, [{ ...LANDING_SITE }, m.end], 0, LANDING_SITE);
    expect(m.travelled).toBeCloseTo(1000.5);
    expect(m.batteryCost).toBeCloseTo(7.50375);
    expect(m.batteryCost).toBe(q.batteryCostPct);
    expect(m.durationS).toBe(q.etaSeconds);
  });
  it("clips at the actual boundary, retaining fractional movement", () => {
    const m = applyMove(flat, 1022.5, 500, 90, 40);
    expect(m.boundaryHit).toBe(true);
    expect(m.end.col).toBe(1023);
    expect(m.travelled).toBeCloseTo(10);
    expect(heightAt(flat, 1023, 1023)).toBe(0);
  });
  it("uses a single reversible scene coordinate convention", () => {
    for (const p of [{ col: 0, row: 0 }, LANDING_SITE, { col: 1023, row: 1023 }]) {
      const w = gridToScene(p.col, p.row);
      expect(sceneToGrid(w.x, w.z)).toEqual(p);
    }
  });
  it("reads the supplied cold-trap mineral data instead of generated telemetry", () => {
    const f32 = (name: string) => {
      const b = readFileSync(`public/${name}`);
      return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    };
    const t = {
      ...flat,
      elevation: f32("terrain.bin"),
      minerals: f32("minerals.bin"),
      illumination: f32("illumination.bin"),
    };
    expect(mineralsAt(t, 382, 729).waterIce).toBeCloseTo(4.1, 1);
    expect(applyDrill(t, 382, 729).reading).toEqual(mineralsAt(t, 382, 729));
  });
});

describe("Mission lifecycle", () => {
  const legs = [
    { bearing: 90, distance_m: 20, purpose: "Station Alpha — drill core" },
    { bearing: 270, distance_m: 20, purpose: "Landing site" },
  ];
  const setup = (steps: ReturnType<typeof decision>[]) => {
    let i = 0;
    think.mockImplementation(async ({ data }) => {
      if (data.mode === "ground")
        return {
          ok: true,
          decision: {
            verdict: "ACK",
            transmission: "Rover 1, Mission Control. Copy.",
            rationale: "",
            target: "",
            bearing: 0,
            distance_m: 0,
          },
        };
      if (data.mode === "plan")
        return { ok: true, decision: decision("PLAN", { waypoints: legs }) };
      return { ok: true, decision: steps[i++] ?? decision("HOLD") };
    });
  };
  it("never moves before approval and stops API polling when Astra holds", async () => {
    setup([decision("HOLD")]);
    const task = runMission("sample");
    await flush();
    expect(useMissionStore.getState().pending?.kind).toBe("approve");
    expect(useMissionStore.getState().col).toBe(320);
    expect(think.mock.calls[0]![0].data.moment).toBe("dispatch");
    choose("approve");
    await flush();
    expect(useMissionStore.getState().pending?.kind).toBe("pause");
    const calls = think.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(think).toHaveBeenCalledTimes(calls);
    choose("abort");
    await task;
  });
  it("turns gradually without translating and aborts immediately during a turn", async () => {
    setup([decision("MOVE")]);
    useMissionStore.setState({ heading: 0, timeCompression: 1 });
    const task = runMission("turn check");
    await flush();
    choose("approve");
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(useMissionStore.getState().status).toBe("TURNING");
    expect(useMissionStore.getState().heading).toBeCloseTo(30, 0);
    expect(useMissionStore.getState().col).toBe(320);
    emergencyHold();
    await task;
    const stopped = useMissionStore.getState().heading;
    await vi.advanceTimersByTimeAsync(1000);
    expect(useMissionStore.getState().heading).toBe(stopped);
  });
  it("drives at lunar pace and applies speed changes during a leg", async () => {
    setup([decision("MOVE"), decision("HOLD")]);
    useMissionStore.setState({ timeCompression: 1, heading: 90 });
    const task = runMission("speed check");
    await flush();
    choose("approve");
    await flush();
    await vi.advanceTimersByTimeAsync(10000);
    expect((useMissionStore.getState().col - 320) * 20).toBeCloseTo(2.2, 1);
    useMissionStore.setState({ timeCompression: 4 });
    await vi.advanceTimersByTimeAsync(10000);
    expect((useMissionStore.getState().col - 320) * 20).toBeCloseTo(11, 1);
    emergencyHold();
    await task;
  });
  it("retains a science station until drilling and completes only after arrival home", async () => {
    setup([
      decision("MOVE"),
      decision("DRILL"),
      decision("RETURN"),
      decision("MOVE", { heading: 270 }),
    ]);
    const task = runMission("sample");
    await flush();
    choose("approve");
    await flush();
    await vi.advanceTimersByTimeAsync(20000);
    await task;
    const s = useMissionStore.getState();
    expect(s.status).toBe("COMPLETE");
    expect(s.col).toBeCloseTo(320);
    expect(s.row).toBeCloseTo(687);
    expect(s.samples).toHaveLength(1);
    expect(s.summary?.distanceM).toBeCloseTo(40);
    const sampleInput = think.mock.calls.find(
      ([input]) =>
        input.data.mode === "step" &&
        input.data.state.samples_taken === 0 &&
        input.data.state.col === 321,
    )?.[0];
    expect(sampleInput.data.state.approved_route[0].purpose).toMatch(/drill/);
  });
  it("requires a second confirmation after an unsafe mission override", async () => {
    think.mockImplementation(async ({ data }) => ({
      ok: true,
      decision:
        data.mode === "plan"
          ? decision("REFUSE", {
              waypoints: legs,
              alternative: {
                bearing: 90,
                distance_m: 10,
                description: "Closer science site",
                costDelta: -1,
              },
            })
          : decision("HOLD"),
    }));
    const task = runMission("unsafe sortie");
    await flush();
    expect(useMissionStore.getState().pending?.kind).toBe("refuse");
    choose("override");
    await flush();
    expect(useMissionStore.getState().pending?.kind).toBe("confirm");
    expect(useMissionStore.getState().col).toBe(320);
    choose("abort");
    await task;
    expect(useMissionStore.getState().samples).toHaveLength(0);
  });
  it("does not claim completion while the rover is still away from home", async () => {
    setup([decision("MOVE"), decision("RETURN"), decision("HOLD")]);
    const task = runMission("sample");
    await flush();
    choose("approve");
    await flush();
    await vi.advanceTimersByTimeAsync(6000);
    expect(useMissionStore.getState().pending?.kind).toBe("pause");
    expect(useMissionStore.getState().col).toBeCloseTo(321);
    expect(useMissionStore.getState().summary).toBeNull();
    choose("abort");
    await task;
  });
  it("does not start a sortie when the mission link is offline", async () => {
    useMissionStore.setState({ link: "OFFLINE" });
    await runMission("go east");
    expect(think).not.toHaveBeenCalled();
    expect(useMissionStore.getState().col).toBe(320);
  });
  it("purges a late decision after emergency hold", async () => {
    let resolve!: (v: unknown) => void;
    think.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const task = runMission("sample");
    await flush();
    emergencyHold();
    resolve({ ok: true, decision: decision("MOVE", { distance: 400 }) });
    await task;
    expect(useMissionStore.getState().col).toBe(320);
    expect(useMissionStore.getState().pending).toBeNull();
    expect(useMissionStore.getState().status).toBe("HOLDING");
  });
});
