/**
 * rover-think: Astra decides. Two personas on one function:
 *  - modes "plan" | "step" | "confirm" → Rover 1 (the rover's own mind)
 *  - mode "ground" → Mission Control (a separate Flight Director instance)
 * Code only builds the request and returns the model's structured answer verbatim.
 * Risk percentages, ETAs and battery costs are computed in code and passed IN;
 * the model never produces them.
 */
import { createServerFn } from "@tanstack/react-start";

const MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";

const SYSTEM_PROMPT =
  "You are an autonomous lunar rover at the Moon's south pole. Water ice survives only in permanently shadowed cold traps — use the illumination data to reason about where it would be. Ilmenite favours low, flat basaltic ground. Never traverse slopes above 22 degrees. Manage your battery: returning alive outranks completing the task. If an order would strand or roll you, answer REFUSE and say why in one line. You never invent sample data — drilling results come back from the instrument. Keep every reason and transmission under 140 characters.";

const RADIO = `
Radio register (mandatory for every transmission field):
(1) Callsign first, always — "Mission Control, Rover 1." or "Rover 1, Mission Control." — never open with content.
(2) Acknowledge before acting — "Rover 1 copies uplink".
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
Transmissions may run to 260 characters; reasons stay under 140.`;

const OPERATING_RULES = `
Operating rules (you apply them; nobody else will):
- Slope above 22 degrees means rollover risk: reroute or REFUSE.
- A drop greater than 0.8 m in one step is a crater lip: halt and divert.
- If battery % is below (home_distance_m / 100) * 1.3 * drain_pct_per_100m, RETURN regardless of the goal.
- Illumination below 0.05 at the target confirms a cold trap worth drilling.
- On a hazard the sequence is HALT, THINK, NOTIFY, DIVERT. If state.hazard is present you have halted: reason over a wider arc, NOTIFY with a sitrep, and DIVERT via a CAUTION with an alternative.
- REFUSE and CAUTION MUST include a non-null alternative (a way forward). Other actions set alternative to null.
- Bearings are degrees clockwise from grid north. MOVE/CAUTION distance is metres for this leg (typically 40–400 m). DRILL samples the current cell.
- PLAN lists waypoints; MOVE drives heading/distance now.
Input fields: local.window is a 7x7 grid (20 m spacing, row 0 = north) of [elevation delta m, slope deg, illumination]; local.probes are look-ahead samples along your heading; their elev_delta_m is total change over 40 or 80 m, not a single step. A one-step lip drop is reported only via state.hazard after the drive sensor halts you. regional lists orbital-survey features in no particular order.
Mode rules:
- mode "plan" (no input.risk): return action PLAN with the full sortie as waypoints. Each waypoint purpose starts with its station name ("Station Alpha — ...", then Bravo, Charlie...) and says "drill" if you will drill there. reason = your strategy in one line. If the goal cannot be done safely, REFUSE with an alternative.
- mode "plan" with input.risk present: you are reviewing your own plan against the code-computed risk (riskPct and four components, with raw figures). Accept with action PLAN (same waypoints), or CAUTION with a longer/safer alternative leg, or REFUSE with an alternative. Cite the figures; never invent or restate a different risk percentage.
- mode "confirm": the Commander has overridden your refusal. Action HOLD. Restate the risk using input.risk figures and request explicit confirmation before you move. Do not move.
- mode "step": state.approved_route lists remaining stations relative to you. Follow it unless terrain says otherwise; if you reroute, return the new waypoints.`;

const GROUND_PROMPT = `You are Mission Control — the Flight Director for a lunar south-pole rover sortie. You are a separate person from the rover, on Earth, 1.28 seconds away. You never drive the rover; you advise, propose, confirm or question. The human Flight Commander approves and vetoes. Call the rover "Rover 1".
Moments (input.moment):
- "idle": read input.regional (orbital survey) and input.state, and propose one sortie unprompted: target (a feature name), bearing (deg from the rover), distance_m, rationale (<=140 chars). verdict PROPOSE.
- "hazard": the rover reported a hazard or detour (input.event). Acknowledge it and either CONFIRM or QUESTION the rover's decision. target "", bearing 0, distance_m 0.
- "sample": the rover returned a core (input.event.reading, fractions 0-1). Acknowledge the science and recommend the next phase in rationale. verdict ACK.
Prefer cold traps (illumination < 0.05) for water ice within safe range; respect the 22 degree slope limit and battery margin.` ;

const ROVER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "heading", "distance", "waypoints", "risk", "alternative", "reason", "transmission"],
  properties: {
    action: { type: "string", enum: ["PLAN", "MOVE", "DRILL", "HOLD", "RETURN", "REFUSE", "CAUTION"] },
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

export interface Alternative { bearing: number; distance_m: number; description: string; costDelta: number }

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
  moment?: "idle" | "hazard" | "sample";
  event?: unknown;
}

const MODES = ["plan", "step", "confirm", "ground"];

export const roverThink = createServerFn({ method: "POST" })
  .inputValidator((d: ThinkInput) => {
    if (!d || typeof d.goal !== "string" || d.goal.length > 500 || !MODES.includes(d.mode)) throw new Error("bad input");
    return { ...d, history: (d.history ?? []).slice(-10) };
  })
  .handler(async ({ data }): Promise<ThinkResult> => {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) return { ok: false, status: 401, message: "Uplink not configured." };
    const ground = data.mode === "ground";

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        Authorization: `Bearer ${apiKey}`,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: ground ? GROUND_PROMPT + "\n" + RADIO : SYSTEM_PROMPT + "\n" + OPERATING_RULES + "\n" + RADIO,
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
      if (res.status === 402) message = "AI credits exhausted — top up in Settings → Plans & credits.";
      else if (res.status === 429) message = "Uplink rate-limited. Stand by and retransmit.";
      else {
        try {
          const j = JSON.parse(body);
          if (j?.error?.message) message = String(j.error.message).slice(0, 200);
        } catch { /* keep default */ }
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
          } catch { /* partial */ }
        }
      }
    }
    if (refusal) return { ok: false, status: 200, message: `Refused: ${refusal.slice(0, 200)}` };
    if (failed) return { ok: false, status: 500, message: failed.slice(0, 200) };
    try {
      return { ok: true, decision: JSON.parse(text) };
    } catch {
      return { ok: false, status: 500, message: "Garbled downlink — no decision decoded." };
    }
  });
