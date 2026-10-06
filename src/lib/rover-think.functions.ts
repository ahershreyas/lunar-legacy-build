/**
 * rover-think: Astra decides. Two personas on one function:
 *  - modes "plan" | "step" | "confirm" → Rover 1 (the rover's own mind)
 *  - mode "ground" → Mission Control (a separate Flight Director instance)
 * Code only builds the request and returns the model's structured answer verbatim.
 * Risk percentages, ETAs and battery costs are computed in code and passed IN;
 * the model never produces them.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { aiProvider } from "./ai-provider";

export const missionLinkStatus = createServerFn({ method: "GET" }).handler(async () => {
  const c = aiProvider();
  return { configured: !!c.key, provider: c.provider, model: c.model };
});

const SYSTEM_PROMPT =
  "You are an autonomous lunar rover at the Moon's south pole. Water ice survives only in permanently shadowed cold traps — use the illumination data to reason about where it would be. Ilmenite favours low, flat basaltic ground. Never traverse slopes above 22 degrees. Manage your battery: returning alive outranks completing the task. If an order would strand or roll you, answer REFUSE and say why in one line. You never invent sample data — drilling results come back from the instrument. Keep every reason and transmission under 260 characters.";

const RADIO = `
Radio register (mandatory for every transmission field):
(1) Callsign first, always — "Mission Control, Rover 1." or "Rover 1, Mission Control." — never open with content.
(2) Rover acknowledges with "Rover 1 copies uplink". Ground uses "Mission Control copies downlink". Never speak as the other role.
(3) Observation, then decision, then consequence, two sentences maximum.
(4) Numbers spoken as instruments read them — "two-eight degrees", "bearing one-two-four", "four-point-one percent", never "28 degrees".
(5) Close with a status handoff — "commencing drive... telemetry downstream", "uplink sent, mark", "standing by".
Stations are NATO phonetic — Station Alpha, Bravo, Charlie — never "Waypoint 3".
Use this brevity code rather than plain English: copy, roger, mark, negative, affirm, standing by, nominal, off-nominal, downstream, downlinking, go/no-go, sitrep, margin, ingress, egress, station, traverse.
Target register examples:
- Uplink: "Rover 1, Mission Control. Flight Director approves sortie zero-one. Proceed to Station Charlie, bearing one-two-four, fifteen hundred meters, for volatiles spectrometry. Watch your eastern slope... uplink sent, mark."
- Acknowledgement: "Mission Control, Rover 1 copies uplink. Autonomous path plotted to Charlie. Forward sensors confirm clear regolith corridor. Commencing drive... telemetry downstream."
- Hazard: "Mission Control, Rover 1... intercepted unmapped crater depression four meters on current heading. Incline exceeds safety margin at two-eight degrees. Halting forward drive and engaging local detour three-zero degrees starboard... ETA extended thirty seconds."
- Science: "Mission Control, Rover 1. Core acquired at thirty centimeters. Spectrometry returns volatiles at four-point-one percent by weight. Confirming water ice signature... downlinking now."
- Refusal: "Negative, Commander. Eight kilometers round trip exceeds my power margin by three-seven percent. I would not get back. Request a closer target... standing by."
All transmissions and reasons must stay under 260 characters. Examples show cadence; compress them to this limit.`;

const OPERATING_RULES = `
Operating rules (you apply them; nobody else will):
- state.commander_accepted_risk means the Commander completed BOTH override confirmations. Continue the authorized route while reporting its risk; do not repeatedly ask for the same confirmation. A materially different new hazard can require a new hold. The declared 15% power safing mode remains active.
- state.approved_alternative records the Commander's accepted substitute destination. It replaces the original destination while retaining the original science objective.
- Slope above 22 degrees means rollover risk: reroute or REFUSE.
- A drop greater than 0.8 m in one step is a crater lip: halt and divert.
- If battery % is below (home_distance_m / 100) * 1.3 * drain_pct_per_100m, RETURN regardless of the goal.
- Illumination below 0.05 at the target confirms a cold trap worth drilling.
- On a hazard the sequence is HALT, THINK, NOTIFY, DIVERT. If state.hazard is present you have halted: reason over a wider arc, NOTIFY with a sitrep, and DIVERT via a CAUTION with an alternative.
- REFUSE and CAUTION MUST include a non-null alternative (a way forward). Other actions set alternative to null.
- Bearings are degrees clockwise from grid north. MOVE/CAUTION distance is metres for this leg (typically 40–400 m). DRILL samples the current cell.
- PLAN lists waypoints; MOVE drives heading/distance now.
Input fields: local.window is a 7x7 grid (20 m spacing, row 0 = north) of [elevation delta m, slope deg, illumination]; local.probes are look-ahead samples along your heading; their elev_delta_m is total change over 40 or 80 m, not a single step. Use elevation delta and distance to reason about terrain; the code will not choose a hazard response for you. regional lists orbital-survey features in no particular order.
Mode rules:
- mode "plan" (no input.risk): return action PLAN with the full sortie as waypoints. Each waypoint purpose starts with its station name ("Station Alpha — ...", then Bravo, Charlie...) and says "drill" if you will drill there. reason = your strategy in one line. If the goal cannot be done safely, REFUSE with an alternative AND include the requested route in waypoints so code can compute its risk.
- mode "plan" with input.risk present: you are reviewing your own plan against the code-computed risk (riskPct and four components, with raw figures). Accept with action PLAN (same waypoints), or CAUTION with a longer/safer alternative leg, or REFUSE with an alternative. Cite the figures; never invent or restate a different risk percentage.
- mode "confirm": the Commander has overridden your refusal. Action HOLD. Restate the risk using input.risk figures and request explicit confirmation before you move. Do not move.
- mode "step": state.approved_route lists absolute stations, each bearing/distance measured from your CURRENT position, with purpose and grid coordinates. These are not cumulative legs. Follow the first station, sample if its purpose requests a core, then advance. Never repeat a sample. Return waypoints ONLY to replace the remaining route with an intentional reroute; they are cumulative legs from your current pose.
- phase RETURNING: navigate home with MOVE actions chosen from the current home bearing/distance and local probes. RETURN signals intent only; it does not drive you. Do not keep returning RETURN. Completion is measured only at the actual landing site.
- When the requested work is finished and you are already home (home_distance_m <= 1), emit RETURN to close the sortie and produce its completion summary. There is no COMPLETE action. Do not emit HOLD to mean mission complete.
- HOLD pauses for human input. Use MOVE for normal navigation, DRILL only at a science station, RETURN after the requested work is done. You can use steps up to 400 m if sensors and orbital survey support them.
- Sample readings in state.samples and input.event are measured percentages, not fractions. You may report those readings, never invent them.
- Report significant route changes and unsuitable drill slopes to Mission Control before acting. Ground responses in history are uplinks to consider, not your own speech. Do not invent rock hardness: no hardness sensor is supplied. If the drill site is unsafe, propose a nearby safe substitute and explain the science tradeoff.
- No raw mineral grid or hidden target composition is available. Infer prospects from orbital illumination.
- Plan the full round trip, including return to the landing site and station purposes. Never omit the return leg from power budgeting.`;

const GROUND_PROMPT = `You are Mission Control — the Flight Director for a lunar south-pole rover sortie. You are a separate person from the rover, on Earth, 1.28 seconds away. You never drive the rover; you advise, propose, confirm or question. The human Flight Commander approves and vetoes. Call the rover "Rover 1".
Moments (input.moment):
- "dispatch": turn input.goal into a concise actionable uplink for Rover 1. Preserve the requested limits and science objective, include return to the staging site, verdict PROPOSE. Do not approve motion on behalf of the human.
- "idle": read input.regional (orbital survey) and input.state, and propose one sortie unprompted: target (a feature name), bearing (deg from the rover), distance_m, rationale (<=260 chars). verdict PROPOSE.
- "hazard": the rover reported a hazard or detour (input.event). Acknowledge it and either CONFIRM or QUESTION the rover's decision. target "", bearing 0, distance_m 0.
- "sample": the rover returned a core (input.event.reading, percentages 0-100). Acknowledge the science and recommend the next phase in rationale. verdict ACK.
For idle proposals choose a local reconnaissance/core sortie within 120 metres of home, using orbital terrain and illumination, followed by return. Never require traversal above 22 degrees.
Prefer cold traps (illumination < 0.05) for water ice within safe range; respect the 22 degree slope limit and battery margin.`;

const ROVER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "heading",
    "distance",
    "waypoints",
    "risk",
    "alternative",
    "reason",
    "transmission",
  ],
  properties: {
    action: {
      type: "string",
      enum: ["PLAN", "MOVE", "DRILL", "HOLD", "RETURN", "REFUSE", "CAUTION"],
    },
    heading: { type: "number" },
    distance: { type: "number" },
    waypoints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["bearing", "distance_m", "purpose"],
        properties: {
          bearing: { type: "number" },
          distance_m: { type: "number" },
          purpose: { type: "string" },
        },
      },
    },
    risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    alternative: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["bearing", "distance_m", "description", "costDelta"],
          properties: {
            bearing: { type: "number" },
            distance_m: { type: "number" },
            description: { type: "string" },
            costDelta: { type: "number" },
          },
        },
      ],
    },
    reason: { type: "string" },
    transmission: { type: "string" },
  },
} as const;

const GROUND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "target", "bearing", "distance_m", "rationale", "transmission"],
  properties: {
    verdict: { type: "string", enum: ["PROPOSE", "CONFIRM", "QUESTION", "ACK"] },
    target: { type: "string" },
    bearing: { type: "number" },
    distance_m: { type: "number" },
    rationale: { type: "string" },
    transmission: { type: "string" },
  },
} as const;

export interface Alternative {
  bearing: number;
  distance_m: number;
  description: string;
  costDelta: number;
}

export interface RoverDecision {
  action: "PLAN" | "MOVE" | "DRILL" | "HOLD" | "RETURN" | "REFUSE" | "CAUTION";
  heading: number;
  distance: number;
  waypoints: { bearing: number; distance_m: number; purpose: string }[];
  risk: "LOW" | "MEDIUM" | "HIGH";
  alternative: Alternative | null;
  reason: string;
  transmission: string;
}

export interface GroundDecision {
  verdict: "PROPOSE" | "CONFIRM" | "QUESTION" | "ACK";
  target: string;
  bearing: number;
  distance_m: number;
  rationale: string;
  transmission: string;
}

export type ThinkResult =
  | { ok: true; decision: RoverDecision | GroundDecision }
  | { ok: false; status: number; message: string };

export interface ThinkInput {
  mode: "plan" | "step" | "confirm" | "ground";
  goal: string;
  state: Record<string, unknown>;
  local?: unknown;
  regional?: unknown;
  history: string[];
  risk?: unknown;
  proposed_waypoints?: unknown;
  moment?: "idle" | "hazard" | "sample" | "dispatch";
  event?: unknown;
}

const legValidator = z.object({
  bearing: z.number().finite(),
  distance_m: z.number().finite().nonnegative(),
  purpose: z.string(),
});
const alternativeValidator = z.object({
  bearing: z.number().finite(),
  distance_m: z.number().finite().nonnegative(),
  description: z.string(),
  costDelta: z.number().finite(),
});
const roverValidator = z
  .object({
    action: z.enum(["PLAN", "MOVE", "DRILL", "HOLD", "RETURN", "REFUSE", "CAUTION"]),
    heading: z.number().finite(),
    distance: z.number().finite().nonnegative(),
    waypoints: z.array(legValidator),
    risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
    alternative: alternativeValidator.nullable(),
    reason: z.string(),
    transmission: z.string(),
  })
  .refine(
    (d) => !["REFUSE", "CAUTION"].includes(d.action) || d.alternative !== null,
    "A hold must include an alternative",
  );
const groundValidator = z.object({
  verdict: z.enum(["PROPOSE", "CONFIRM", "QUESTION", "ACK"]),
  target: z.string(),
  bearing: z.number().finite(),
  distance_m: z.number().finite().nonnegative(),
  rationale: z.string(),
  transmission: z.string(),
});

const MODES = ["plan", "step", "confirm", "ground"];

export const roverThink = createServerFn({ method: "POST" })
  .inputValidator((d: ThinkInput) => {
    if (!d || typeof d.goal !== "string" || d.goal.length > 500 || !MODES.includes(d.mode))
      throw new Error("bad input");
    return { ...d, history: (d.history ?? []).slice(-8) };
  })
  .handler(async ({ data }): Promise<ThinkResult> => {
    const provider = aiProvider();
    const apiKey = provider.key;
    if (!apiKey)
      return {
        ok: false,
        status: 401,
        message:
          "Mission link unavailable — no server AI credential. Initialize the link for setup instructions.",
      };
    const ground = data.mode === "ground";

    const res = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider.provider === "Lovable"
          ? { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" }
          : {}),
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: provider.model,
        instructions: ground
          ? GROUND_PROMPT + "\n" + RADIO
          : SYSTEM_PROMPT + "\n" + OPERATING_RULES + "\n" + RADIO,
        input: [{ role: "user", content: JSON.stringify(data) }],
        reasoning: { effort: "low" },
        store: false,
        stream: true,
        text: {
          format: ground
            ? { type: "json_schema", name: "control_call", strict: true, schema: GROUND_SCHEMA }
            : { type: "json_schema", name: "rover_decision", strict: true, schema: ROVER_SCHEMA },
        },
      }),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      console.error("rover-think gateway", res.status, body.slice(0, 500));
      let message = `Uplink error ${res.status}.`;
      if (res.status === 402)
        message = "AI credits exhausted — top up in Settings → Plans & credits.";
      else if (res.status === 429) message = "Uplink rate-limited. Stand by and retransmit.";
      else {
        try {
          const j = JSON.parse(body);
          if (j?.error?.message) message = String(j.error.message).slice(0, 200);
        } catch {
          /* keep default */
        }
      }
      return { ok: false, status: res.status, message };
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let refusal = "";
    let failed = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const ev = JSON.parse(payload);
            if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
            else if (ev.type === "response.refusal.delta") refusal += ev.delta ?? "";
            else if (ev.type === "response.failed" || ev.type === "error")
              failed = ev.response?.error?.message ?? ev.message ?? "Response failed";
          } catch {
            /* partial */
          }
        }
      }
    }
    if (refusal) return { ok: false, status: 200, message: `Refused: ${refusal.slice(0, 200)}` };
    if (failed) return { ok: false, status: 500, message: failed.slice(0, 200) };
    try {
      const parsed = JSON.parse(text);
      const decision = ground ? groundValidator.parse(parsed) : roverValidator.parse(parsed);
      return { ok: true, decision };
    } catch {
      return { ok: false, status: 500, message: "Garbled downlink — no decision decoded." };
    }
  });

/** Neural radio audio through the same server-only provider. Never expose its key. */
export const radioSpeech = createServerFn({ method: "POST" })
  .inputValidator((d: { role: "CONTROL" | "ROVER 1"; text: string }) => {
    if (
      !d ||
      !["CONTROL", "ROVER 1"].includes(d.role) ||
      typeof d.text !== "string" ||
      d.text.length > 600
    )
      throw new Error("Invalid radio text");
    return d;
  })
  .handler(async ({ data }) => {
    const provider = aiProvider();
    if (!provider.key) return { ok: false as const, message: "Neural radio is not configured" };
    const res = await fetch(provider.url.replace(/responses$/, "audio/speech"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.key}`,
        ...(provider.provider === "Lovable"
          ? { "Lovable-API-Key": provider.key, "X-Lovable-AIG-SDK": "fetch" }
          : {}),
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: provider.provider === "Lovable" ? "openai/gpt-4o-mini-tts" : "gpt-4o-mini-tts",
        voice: data.role === "CONTROL" ? "onyx" : "nova",
        input: data.text,
        response_format: "mp3",
        speed: 1,
        instructions:
          "Speak as a calm, real human mission operator over a clear radio. Natural conversational cadence, warm and composed. No robotic monotone, no exaggerated announcer voice. Callsigns and numbers clear; brief natural pauses.",
      }),
    });
    if (!res.ok) return { ok: false as const, message: `Neural radio unavailable (${res.status})` };
    const audio = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { ok: true as const, audio, voice: data.role === "CONTROL" ? "Onyx" : "Nova" };
  });
