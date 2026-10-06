/**
 * rover-think: Astra decides the rover's next action. Code only builds the
 * request and returns the model's structured answer verbatim.
 */
import { createServerFn } from "@tanstack/react-start";

const MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";

const SYSTEM_PROMPT =
  "You are an autonomous lunar rover at the Moon's south pole. Water ice survives only in permanently shadowed cold traps — use the illumination data to reason about where it would be. Ilmenite favours low, flat basaltic ground. Never traverse slopes above 22 degrees. Manage your battery: returning alive outranks completing the task. If an order would strand or roll you, answer REFUSE and say why in one line. You never invent sample data — drilling results come back from the instrument. Keep every reason and transmission under 140 characters.";

const OPERATING_RULES = `
Operating rules (you apply them; nobody else will):
- Slope above 22 degrees means rollover risk: reroute or REFUSE.
- A drop greater than 0.8 m in one step is a crater lip: halt and divert.
- If battery % is below (home_distance_m / 100) * 1.3 * drain_pct_per_100m, RETURN regardless of the goal.
- Illumination below 0.05 at the target confirms a cold trap worth drilling.
- On a hazard the sequence is HALT, THINK, NOTIFY, DIVERT. If state.hazard is present you have halted: reason over a wider arc, NOTIFY with a sitrep, and DIVERT via a CAUTION with an alternative.
- REFUSE and CAUTION MUST include a non-null alternative (a way forward). Other actions set alternative to null.
- Bearings are degrees clockwise from grid north. MOVE/CAUTION distance is metres for this leg (typically 40–400 m). DRILL samples the current cell.
- PLAN lists waypoints; MOVE drives heading/distance now. Output reason and transmission <=140 chars; transmission in terse mission-radio voice.
Input fields: local.window is a 7x7 grid (20 m spacing, row 0 = north) of [elevation delta m, slope deg, illumination]; local.probes are look-ahead samples along your heading; their elev_delta_m is total change over 40 or 80 m, not a single step. A one-step lip drop is reported only via state.hazard after the drive sensor halts you. regional lists orbital-survey features in no particular order.`;

const SCHEMA = {
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

export interface RoverDecision {
  action: "PLAN" | "MOVE" | "DRILL" | "HOLD" | "RETURN" | "REFUSE" | "CAUTION";
  heading: number;
  distance: number;
  waypoints: { bearing: number; distance_m: number; purpose: string }[];
  risk: "LOW" | "MEDIUM" | "HIGH";
  alternative: { bearing: number; distance_m: number; description: string; costDelta: number } | null;
  reason: string;
  transmission: string;
}

export type ThinkResult =
  | { ok: true; decision: RoverDecision }
  | { ok: false; status: number; message: string };

interface ThinkInput {
  mode: "plan" | "step";
  goal: string;
  state: Record<string, unknown>;
  local: unknown;
  regional: unknown;
  history: string[];
}

export const roverThink = createServerFn({ method: "POST" })
  .inputValidator((d: ThinkInput) => {
    if (!d || typeof d.goal !== "string" || d.goal.length > 500) throw new Error("bad input");
    return { ...d, history: (d.history ?? []).slice(-8) };
  })
  .handler(async ({ data }): Promise<ThinkResult> => {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) return { ok: false, status: 401, message: "Uplink not configured." };

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
        instructions: SYSTEM_PROMPT + "\n" + OPERATING_RULES,
        input: [{ role: "user", content: JSON.stringify(data) }],
        reasoning: { effort: "low" },
        store: false,
        stream: true,
        text: { format: { type: "json_schema", name: "rover_decision", strict: true, schema: SCHEMA } },
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

    // Consume the SSE stream server-side, accumulating output text.
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
      return { ok: true, decision: JSON.parse(text) as RoverDecision };
    } catch {
      return { ok: false, status: 500, message: "Garbled downlink — no decision decoded." };
    }
  });
