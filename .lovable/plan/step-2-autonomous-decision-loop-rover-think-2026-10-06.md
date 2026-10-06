# Step 2 — Autonomous decision loop (rover-think)

## What you'll see
Type a goal, press TRANSMIT. The rover thinks, moves across the map by itself, and fills the COMM DOWNLINK log with its reasoning and radio calls. When it hits a hazard, the log shows HALT, THINK, NOTIFY, DIVERT and an amber detour appears on the map before it moves again. It stops on RETURN, REFUSE, or below 15% battery.

## One change from the brief
The brief asks for a Supabase edge function using your own OpenAI key. This project's backend runs its own server code, and Astra is already available through Lovable's built-in AI service. So `rover-think` will be a server function calling the same model, **gpt-6-astra**, with low reasoning effort and the strict JSON schema. You don't need an OpenAI key, it stays on the server, and the browser never sees it. Usage is billed to your workspace credits. If you need it to be exactly an edge function with your own key, tell me before you approve.

## Build
1. **rover-think (server)**: takes `{ mode, goal, state, local, regional, history }`. Uses the system prompt word for word. The hazard rules from the brief (22° limit, 0.8 m lip drop, battery < distance-home × 1.3 → RETURN, illumination < 0.05 confirms a cold trap, and the HALT/THINK/NOTIFY/DIVERT sequence) go into the prompt as Astra's operating rules, not into code. Returns the strict schema: action, heading, distance, waypoints, risk, alternative, reason, transmission. `alternative` is required on REFUSE/CAUTION; the schema makes it nullable and the prompt makes it mandatory.
2. **src/sim/sensors.ts (pure)**: 
   - `local`: a 7×7 window of elevation delta, slope and illumination, plus 6 probes (centre, ±20°, at 40 m and 80 m).
   - `regional`: 5–6 features of different kinds (deepest dark basin, steep ridge, high sunlit ridge, flat low plain, crater rim and so on) found from elevation and illumination only. Each gets bearing, distance, depth and illumination. They are unranked, shuffled, and carry no minerals and no target flag.
   - `history`: last 8 log entries.
3. **src/sim/actions.ts (pure)**: MOVE moves along the chosen heading and distance and drains battery by distance and slope. DRILL reads `mineralsAt()` and adds a sample. HOLD, RETURN and REFUSE change only state. If a step drops more than 0.8 m, it's flagged as a hazard event for the log and sent to Astra on the next call; code never reroutes.
4. **src/sim/loop.ts**: on transmit, sets status to THINKING, calls rover-think, applies the action, logs reason and transmission (with risk colour), then repeats. Position animates smoothly toward the target during DRIVING and stays still only while THINKING. Hard failsafe: below 15% battery it forces RETURN and stops. Errors (credits, rate limits) appear in the log and stop the loop, with no retries that loop.
5. **Map + UI**: waypoints show as a cyan path, CAUTION/REFUSE alternatives as an amber detour. GoalInput starts the loop, and the store gets status changes.

## Explicitly not built
No A* or pathfinding, no slope-reroute rules in code, no mineral scan, no nearest-cold-trap pick, and no correcting Astra's choices. The battery failsafe is the only exception.

## Verify
Run one goal end to end in the preview and check the log and movement. Then run the same goal three times and confirm the routes differ.

## Technical notes
- `src/lib/rover-think.functions.ts` uses `createServerFn`, the AI SDK `@ai-sdk/openai` `.responses("openai/gpt-6-astra")` via the gateway, `streamText` with `Output.object` strict schema and `store:false`. Needs `LOVABLE_API_KEY`, which gets provisioned if it's missing.
- Store writes are throttled to 4 Hz during the animation.
