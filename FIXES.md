# UMBRA repairs through Prompt 5

## What changed

- Implemented the missing React Three Fiber 3D viewport with a 512-segment height-displaced terrain, aligned texture, chase camera, independent wheel/drill animation, ground conformance, and tracked low-angle shadows. Retained the 2D overview and manual/automatic map fallback.
- The supplied GLB already has metre-sized axle coordinates. Preserve its metre scale; applying 0.015 to this particular file makes the rover effectively invisible. The view also supports a centimetre-scale model by checking its bounds.
- Ground contact follows the actual rendered terrain triangles, avoiding clipping or floating caused by differences between the full-resolution DEM and the 512-segment mesh.
- Restored the provided minerals.bin to public/ and validated binary dimensions and finite values. Removed the external CDN dependency from loading. Elevation, illumination, rover and texture were retained.
- Spectrometry shows the latest acquired core, not hidden mineral data under the rover before it drills.
- Movement and estimates now share the specified 7.5%/km, slope penalty and 0.22 m/s formulas. Animation duration reflects declared 120× time compression; fractional movement and grid-edge clipping are preserved.
- Stations retain their purpose and remain pending until requested sampling completes. Model requests include remaining station purposes, sortie samples, return phase and computed risk; history is limited to eight entries.
- HOLD pauses for a Commander response instead of generating another decision repeatedly. A bounded decision budget pauses for review. REFUSE requires an alternative and two confirmations for override; model responses are validated before application.
- RETURN initiates a return phase; Astra continues choosing navigation actions. Completion is recorded only when the rover reaches the landing site. Low power interrupts an outbound move and switches to the declared return safing mode.
- Abort signals cancel requests and queued traffic. Old mission cleanup cannot overwrite a replacement mission. Completing/aborting a sortie no longer automatically starts another Mission Control call.
- Orbital survey observations include the local landing region rather than only far-away map extrema. They include no mineral composition or recommended target. Astra still chooses destinations, headings, samples, hazards and detours; there is no pathfinding or scripted mission.
- Throttled MET store writes to four Hz, retained telemetry and comms panels, exposed asset failures instead of covering them with a permanent loading overlay, and resolved existing lint formatting failures.

## Verification

- TypeScript: `bunx tsc --noEmit`.
- Fifteen Vitest tests including approval, sampling, return arrival, HOLD polling, override confirmation, aborting late decisions, coordinate round trips, battery/ETA arithmetic, boundaries and the provided 4.1% cold-trap reading.
- Production build: `bun run build`.
- ESLint: no errors; existing React Fast Refresh export warnings remain.
- Browser: real terrain/model render, starting slope 2.9°, illumination 65%, no console errors, successful switching between 3D camera and 2D survey. Tested desktop and compact viewport.

## Live verification still required in Lovable

The local checkout has no LOVABLE_API_KEY configured. Rendering and deterministic mission lifecycle tests pass, but these do not prove live Astra reasoning quality. Reopen the connected Lovable preview after sync and run the four supplied mission goals, checking each plan before approving. AI-selected routes can vary, so computed risk and duration need not match reference figures exactly.

The server uses the existing Lovable AI Gateway integration. No key is sent to the browser. No infrastructure migration or deployment outside the existing connected project was performed.

## Interactive controls and mission activation

- Restored the original supplied lunar texture in both views; terrain elevations span 0–3,083.5 metres. The close landing-site view naturally shows a small, comparatively flat patch. Terrain Overview shows the whole relief.
- Added drag-to-orbit, wheel zoom, right-button pan, Terrain Overview and Follow Rover controls.
- Added explicit Initialize Mission Link / Enable GPT + Voice, separate Ground/Rover connection indicators, and actionable server configuration errors. Missions cannot start with an offline link.
- Supports the existing Lovable gateway or a server-only OPENAI_API_KEY in .env.local for local development. .env.example documents configuration; environment secrets are excluded from Git.
- Both AI roles retain their distinct prompts. Voice uses separate available English voices, rate 0.90, pitch 0.94 and Quindar tones; emergency hold clears queued speech. Text remains visible.
- Commander override and accepted alternative are retained in subsequent model requests. No repeated refusal for the same already-confirmed risk.
- Browser verified camera rotation and missing-credential handling. Automated tests verify movement, sample/return lifecycle, approval safeguards, provider selection and audio cancellation. Hosted live mission results are recorded separately after GitHub sync.
