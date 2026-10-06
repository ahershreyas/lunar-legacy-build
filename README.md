# Lunar Legacy Build

> I've attached SPEC.md. It's the single source of truth for this build — read it fully

> before writing anything.

>

> Four binary assets are already in /public and must never be regenerated, re-fetched, or

> replaced with procedural substitutes: terrain.bin, minerals.bin, illumination.bin and

> texture.jpg, plus /public/models/rover.glb. They're real NASA Moon Trek data and a

> prepared rover model.

>

> Build strictly what each message asks for and nothing beyond it. Don't scaffold ahead.

>

> Confirm you've read SPEC.md by telling me, in three lines: the terrain dimensions and

> metres-per-sample, the rover's six wheel node names, and what "Astra decides, code

> computes" means for drill results. Then stop and wait. Don't build yet.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f8e20626-d7ab-4b36-92a3-6825d6128f55).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
