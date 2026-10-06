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
