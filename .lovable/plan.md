# UMBRA — Build Step 1: Dashboard Shell & State Layer

Step 1 of SPEC.md §9 only: store, console shell, and a 2D terrain map. No 3D, no Astra calls, no mission logic.

## Assets
- Copy the uploaded `terrain.bin`, `minerals.bin`, `illumination.bin`, `texture.jpg`, `terrain.json` into `public/`, and `rover.glb` into `public/models/` — real NASA Moon Trek data, never regenerated or substituted.

## State & simulation
- Install `zustand` and `lucide-react`.
- `src/store/useMissionStore.ts` (Zustand): rover pose `{col: 320, row: 687}` (the landing site), heading, battery 100, MET in mission seconds ticking at 60× real time, status union (`IDLE | PLANNING | AWAITING_APPROVAL | DRIVING | THINKING | DRILLING | RETURNING | COMPLETE`), goal, plan, `log[]` of `{t, who, text}`, `samples[]`, and the loaded terrain/mineral/illumination buffers.
- `src/sim/terrain.ts`: loads the three `.bin` files as Float32Arrays; exposes `heightAt`, `slopeAt` (degrees), `illuminationAt`, `mineralsAt` → `{ilmenite, plagioclase, waterIce}` — all bilinear-interpolated.
- `src/utils/coords.ts`: the only place world↔grid conversion lives, including `toLatLon(col,row)` for the lunar south polar stereographic projection exactly as specced.

## UI — single screen, no tabs, background `#08090C`
- Loading screen: UMBRA wordmark centred → `ESTABLISHING UPLINK…` → `AOS — ROVER 1 NOMINAL`.
- Top bar: `UMBRA` mono uppercase, letter-spaced, white · thin divider · `LUNAR SURFACE OPERATIONS` in `#94A3B8` · MET clock · live lat/lon from `toLatLon` · `1.28s` latency badge · `TIME ×60`.
- Left 65%: `MapView2D` canvas — shaded relief rendered from `terrain.bin`, map centred on the landing site, cyan rover dot, fading trail.
- Right 35%: three cards (`#0E1116`, `border-white/10`) — SUBSYSTEM STATUS (battery bar, slope readout), SCIENCE PAYLOAD — SPECTROMETRY (three percentage bars), COMM DOWNLINK (scrolling log).
- Bottom: CAPCOM UPLINK goal text input with a `TRANSMIT` button.
- Typography: Inter for labels/buttons; JetBrains Mono with `tabular-nums` for every number. Telemetry `#38BDF8`, labels `#94A3B8`, log body `#CBD5E1` with mono uppercase speaker tags.
- Browser tab title: `UMBRA — Lunar Surface Operations`; index route gets its own head metadata.

## Verify
- Real crater shapes visible on the map (elevation from the binary, never a PNG).
- MET ticking at 60×.
- Lat/lon reads ~89.16° S, 127.70° E at load.
- Clean build, no broken imports; screenshot check of the console.
