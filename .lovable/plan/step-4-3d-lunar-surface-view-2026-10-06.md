# Step 4: 3D Lunar Surface View

## Readiness gate

- Preserve the current clean, committed 2D implementation as the rollback point.
- Run the Shakedown sortie through planning, operator approval, traversal, drilling, return, and sortie summary.
- Confirm the risk panel, comms delay, emergency hold, rover trail, and existing 2D view remain error-free. If this gate fails, fix steps 1–3 before touching the 3D view.

## Build

- Install `three`, `@types/three`, `@react-three/fiber`, and `@react-three/drei` at React 19-compatible versions.
- Add a client-only `SceneView3D` that reads the existing mission store without changing mission logic or owning rover position.
- Build a 20.48 km plane with 512 segments, sample its vertex heights from the loaded terrain data, and compute vertex normals immediately after displacement.
- Apply `/texture.jpg` with its default UV layout and a matte regolith material at roughness `0.95`.
- Use the specified capture lighting exactly: directional light intensity `4.5` at `[196, 35, 17]`, shadow bias `-0.0005`, normal bias `0.05`, 2048 shadow map, ambient `0.04`, and canvas DPR `[1, 1.5]`.
- Load `/models/rover.glb` at scale `0.015`; resolve the six named wheel nodes, `Chassis`, and `DrillArm` after mount.
- In the frame loop, animate wheel spin from observed rover speed, damp the drill arm toward `0.65` radians only while drilling, and damp heading toward the store bearing.
- Conform the rover to terrain using only the specified front and rear axle sample points, seat it by `0.02 m`, and damp orientation with quaternion slerp factor `1 - exp(-12 × delta)`.
- Add a 30–60 m damped chase camera behind the rover. Keep per-frame values in refs, clamp delta, and avoid React state updates in the frame loop.
- Explicitly dispose the generated terrain geometry, terrain material, texture, and cloned rover resources during cleanup.

## Layout

- Make the 3D viewport the primary mission view.
- Keep `MapView2D` visible as a smaller overview panel showing the full 20 km terrain, rover marker, route, samples, and trail.
- Preserve all mission cards and operator controls above the visual views.

## Verification and fallback

- Verify the first render, model loading, lighting, terrain framing, wheel motion, drill motion, ground contact, heading, chase camera, and 2D overview at desktop and the current compact viewport.
- Confirm no browser, network, hydration, runtime, type, or build errors and that mission-store writes remain at the existing 4 Hz cadence.
- If the 3D view is blank, unstable, or materially harms the mission flow during verification, remove it and restore the committed 2D-first screen rather than shipping a partial 3D implementation.

## Technical constraints

- Keep all grid/world conversion in `src/utils/coords.ts`.
- Do not modify or regenerate any protected binary or image asset.
- Do not alter Astra decisions, computed drill results, mission estimates, or the human approval flow.
- The 3D scene is a visualization of the existing store, not a second simulation.
