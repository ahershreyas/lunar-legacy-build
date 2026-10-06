# Step 3C: flight-ops labelling, push-to-talk, sortie complete

Built strictly from the 3C brief. Assets, coordinates helper and decision logic are unchanged except where noted.

## 1. Flight-operations labelling
- Top bar: MET clock, SELENOGRAPHIC POSITION label on coordinates, TIME ×120, new DATA SOURCES link.
- SUBSYSTEM STATUS header value is computed: NOMINAL / CAUTION / OFF-NOMINAL (from consumables, slope, current hold/abort state). CONSUMABLES label kept.
- SCIENCE PAYLOAD — SPECTROMETRY rows: FeTiO3 (ILMENITE), PLAGIOCLASE, VOLATILES / H2O.
- COMM DOWNLINK log; speakers ROVER 1 and MISSION CONTROL (the "CONTROL" tag displays as MISSION CONTROL).
- CAPCOM UPLINK with "TRANSMIT → 1.28 s"; EMERGENCY HOLD unchanged.
- Mission card titled PROPOSED SORTIE — SORTIE-01 (number increments per sortie), buttons APPROVE & UPLINK and DECLINE PLAN; route row labelled TRAVERSE PLAN listing each STATION.
- Drill status shown as ACQUIRE CORE SAMPLE.
- Sitrep tags prefixed in the log, set by code from what actually happened: OBSTACLE_AVOIDANCE (caution/divert/lip halt), CORE_ACQUIRED (drill), SLOPE_LIMIT_EXCEEDED (slope > 22° on a leg), CONSUMABLES_MARGIN (failsafe), RETURN_INITIATED (return home), BOUNDARY_LIMIT (see 5).
- Sweep the UI for app words (Send, Loading, Error, Settings, Dashboard) and replace them (e.g. terrain failure reads "LOS — TERRAIN DOWNLINK FAILED").

## 2. Live MISSION RISK ASSESSMENT
- The risk gauge becomes its own panel that stays visible during the sortie (above the progress panel), recomputed in code from the remaining route each time progress updates, so reroutes move the number.

## 3. PUSH TO TALK
- Button beside the uplink box using the browser's built-in speech recognition. Hold to capture, release to transcribe into the goal field — never auto-sends.
- Pulsing "● RECEIVING UPLINK" while held.
- Hidden when the browser lacks support or the microphone permission is denied.

## 4. SORTIE COMPLETE card
- Shown when the rover returns home: each sample with its composition, distance traversed, consumables remaining, total mission duration. Dismissable.

## 5. Grid boundary clamp
- Any move that would leave 0–1023 is clipped at the edge, and a BOUNDARY_LIMIT sitrep is logged.

## 6. Loading state
- Loading screen shows "ESTABLISHING UPLINK…" with a real byte-progress bar across terrain.bin, illumination.bin, minerals.bin and texture.jpg, then "AOS — ROVER 1 NOMINAL" when all are in.

## 7. Attribution and DATA SOURCES
- One dim 11px line in #64748B in its own strip at the bottom (below the uplink bar, never over the map): the exact attribution text from the brief.
- DATA SOURCES opens a panel listing each file with instrument, resolution and processing: elevation destriped; illumination ray-cast to the horizon in 24 directions; mineral composition modelled from illumination, not measured, because no 20 m polar mineral map exists.

## Technical details
- `TIME_COMPRESSION` → 120 in the store.
- `loadTerrain(onProgress)` streams each response body to report bytes; texture.jpg fetched in the same pass.
- Clamp lives in `applyMove` (returns `boundaryHit`); the loop logs the sitrep. Uses existing GRID_SIZE.
- New store field `missionSummary` set by `returnHome`; `sortieNo` counter.
- New components: RiskPanel (reuses RiskGauge), PushToTalk, SortieCompleteCard, DataSourcesPanel (uses existing Sheet), Attribution.
- Attribution colour added as a design token rather than hardcoded in the component.
