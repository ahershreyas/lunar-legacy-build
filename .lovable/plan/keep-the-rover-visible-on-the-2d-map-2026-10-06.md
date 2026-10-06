# Keep the rover visible on the 2D map

## Goal
Make the rover immediately visible when the map opens and keep it in view during missions, with simple zoom controls.

## Changes
- Start the 2D map at a closer, rover-centered scale instead of showing the entire 20.48 km survey.
- Add compact `+` and `−` icon buttons over the map using the existing control style, with accessible labels and tooltips.
- Zoom toward or away from the rover, enforce sensible minimum and maximum scales, and keep the rover centered as it moves so it remains visible.
- Continue drawing the real terrain, planned route, trail, sample markers, and rover marker through the same viewport transform.
- Make the rover marker more legible at every zoom level without representing it at an unrealistic terrain scale.
- Update the survey scale label so it reflects the currently visible area rather than always describing the full map.

## Verification
- Confirm the initial view is centered close enough to identify the rover marker.
- Confirm `+` and `−` change scale without losing the rover.
- Confirm the view follows a moving rover and all route/trail overlays remain aligned to terrain.
- Check the current desktop preview size and a narrower viewport for clipping or overlapping controls.
- Confirm the preview builds cleanly and has no browser errors.

## Technical details
- Keep zoom and framing as local display state inside `MapView2D`; mission position remains exclusively in the Zustand mission store.
- Apply one shared grid-to-screen transform to relief and every overlay so coordinates remain consistent.
- Use the existing `Button` component and Lucide `Plus`/`Minus` icons.
