# Steps 3 + 3B: approval flow, Mission Control persona, comms

Both uploaded briefs are built together, in order (3, then 3B). No changes to assets, coords, terrain or the drill path.

## Step 3 — human-on-the-loop approval
- **Plan first**: transmitting a goal calls Astra in "plan" mode, which returns waypoints (named Station Alpha/Bravo/Charlie), a risk level and a strategy. Nothing moves yet.
- **Code-computed numbers** (never from the model): ETA (0.22 m/s, slope penalty `1 + (meanSlope/22)^1.8`, 45 s per drill), battery cost (7.5%/km × slope penalty + 1.5%/drill), and risk % from the four weighted components (slope, power, shadow, range) with LOW/MODERATE/HIGH/SEVERE bands. riskPct and the components are passed to Astra so it reasons about them.
- **Mission card (AWAITING_APPROVAL)**: target + bearing, strategy, duration "1 h 46 m", power % of full charge, risk gauge with four labelled bars and raw figures, APPROVE & UPLINK / REJECT. Reject → IDLE and logs the reason.
- **1.28 s delay** on every uplink and downlink, with a progress bar.
- **EMERGENCY HOLD**: one AbortController per mission; every queued transmission and pending decision checks `signal.aborted` before running.
- **Three preset goal buttons** under the goal input.
- **REFUSE → HOLDING** (new status): rover stops; card shows reason, Astra's alternative, ACCEPT ALTERNATE / OVERRIDE — ACCEPT RISK / ABORT SORTIE. Override sends one more call where the rover restates the risk and asks for explicit confirmation (CONFIRM button) before moving; log records "Commander accepted the risk".
- **CAUTION**: shows the concern plus PROCEED / TAKE THE LONGER ROUTE (+ its code-computed time cost). The loop pauses awaiting the operator.

## Step 3B — Mission Control persona and comms
- **Ground mode**: a second Astra persona (Flight Director), run only at three moments: on IDLE (proposes a sortie: target, bearing, distance, rationale, transmission), after a rover hazard/detour (confirms or questions), after a sample (acknowledges science, recommends next phase).
- **Proposal card**: ACCEPT PROPOSAL fills the goal input; DISMISS hides it. Operator can always type their own goal.
- **Radio register**: both system prompts get the fixed grammar, brevity code and the exact five example transmissions.
- **Log**: every entry shows MET, mono uppercase speaker tag (ROVER 1 / CONTROL), body.
- **COMMS toggle** in the top bar: TEXT ONLY (default) / TEXT + VOICE. Voice uses browser speech with Quindar tones (2525 Hz in, 2475 Hz out, 80 ms, gain 0.12 exponential decay), plus a 1850 Hz bandpass feel and faint white noise only while transmitting. Text always stays.
- **Live progress while DRIVING**: distance remaining (m), ETA "52 m 10 s", traversed bar — recomputed every step from the actual remaining waypoints, so reroutes visibly grow the ETA.

## Technical details
- `rover-think.functions.ts`: mode `"plan" | "step" | "confirm" | "ground"`; separate strict schemas per mode (ground has its own); input gains `risk` block. Same model, same gateway call.
- New `src/sim/estimate.ts` (pure): ETA, battery cost, risk components, formatters. Uses coords helpers for distances.
- New `src/sim/comms.ts`: `transmit(signal, fn)` 1.28 s delay with progress in the store; aborts cleanly.
- `loop.ts` becomes a staged flow: plan → await approval promise → drive; REFUSE/CAUTION/override await operator choices via store-resolved promises; failsafe unchanged.
- Store: statuses add HOLDING; fields for quote, risk, pendingChoice, transmission progress, controlProposal, commsMode, liveProgress; LogEntry.who adds "CONTROL".
- New components: MissionCard, RiskGauge, DecisionCard (refuse/caution/override), ControlProposalCard, LiveProgress, TransmissionBar, PresetGoals; voice in `src/utils/radioVoice.ts` (Web Audio + speechSynthesis; speech can't truly route through Web Audio, so the bandpass applies to the noise/tone bed only).
- AGENTS.md updated for the estimate/comms modules.
