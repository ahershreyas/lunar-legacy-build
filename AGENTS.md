<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## UMBRA architecture
- All world/grid coordinate conversion lives only in src/utils/coords.ts (SPEC rule: one helper or the rover samples the wrong ground).
- minerals.bin (12MB) is CDN-hosted via src/assets/minerals.bin.asset.json; terrain.bin/illumination.bin/texture.jpg stay in public/.
- Mission state lives in src/store/useMissionStore.ts (Zustand); sim/ modules are pure and never touch the network.
- Rover decisions come only from the rover-think server function (src/lib/rover-think.functions.ts, Lovable AI Gateway, strict JSON schema); src/sim/loop.ts only senses, applies and logs — the sole code-side override is the <15% battery RETURN failsafe. Why: "Astra decides, code computes."
- ETA, battery cost and risk % are computed only in src/sim/estimate.ts and passed INTO rover-think; the model never produces them. Why: numbers must be interrogable, not trusted.
- Every rover-think call goes through ask() in loop.ts with the 1.28 s transmit() delay (src/sim/comms.ts) and one AbortController per mission; REFUSE/CAUTION hold via awaitChoice() until the operator presses a button. Why: human-on-the-loop, EMERGENCY HOLD must purge everything.
- Mission Control is rover-think mode "ground", called only on IDLE, hazard/detour and sample moments. Why: the rover acts alone between those moments.
