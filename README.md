# test12

> **⚠ Unofficial, non-commercial experimental project.** This is an independent
> fan/educational re-implementation of a voxel sandbox survival game for web
> browsers, targeting the general look-and-feel of Minecraft Bedrock Edition
> 1.4.2 (Update Aquatic phase 1). It is **not affiliated with, endorsed by, or
> associated with** Mojang Studios, Microsoft, or Minecraft. All code, textures,
> and assets are original or from compatible open sources; it contains **no**
> code, textures, models, audio, or trademarks copied from Minecraft.

A first-person 3D voxel sandbox survival game that runs in the browser (no
install, no login) — playable at a public HTTPS URL. Built with Three.js and
Vite. **Phase A** is the backbone: a runnable, buildable, testable, deployable
scaffold plus the shared cross-module contract.

## Live URL

- **Public:** https://Wuswufei0409.github.io/test12/
- Opens anonymously (no login) over HTTPS in desktop Chromium.

## Quick start

```bash
npm install
npm run dev        # local dev server
npm run build      # production build -> dist/
npm run preview    # preview the production build
npm test           # run core logic tests
npm run smoke      # run fixed-seed smoke tests
```

## Repository layout

```
src/            # game source (Three.js renderer in main.js, core logic in src/core/)
  core/         # platform-independent logic: rng, world/time, blocks, terrain
test/           # vitest tests (headless, node env) + smoke/
CONTRACT.md     # cross-module shared contracts (single source of truth)
ARCHITECTURE.md # architecture overview
LICENSE         # MIT license
NOTICE.md       # unofficial-project & asset-origin notice
```

## Project state

Delivered so far:

- **Phase A backbone:** Vite+Three.js scaffold, CI (build + core tests +
  fixed-seed smoke + Pages deploy), public HTTPS on GitHub Pages,
  `CONTRACT.md` shared contracts.
- **A2 world generation & rendering:** deterministic seeded value-noise world
  with **8 biomes** (plains, forest, desert, mountains + cold/warm/deep/shallow
  oceans), chunk generation/load/unload streaming, merged mesh voxel rendering
  with face culling, procedural pixel-texture atlas (original art), first-person
  3D view, day/night sky + fog, crosshair, hotbar/HUD overlay, and a
  reproducible fixed-seed terrain fingerprint/sample.

Playable survival systems (mining/placing, inventory, crafting, mobs, ocean
content, trident, saving, performance benchmarking) are tracked by later issues.
See **Known limits** below.

## Known limits

1. Player locomotion/collision are **not** implemented here (A3's scope); a
   pointer-lock free-fly camera is provided for reviewing the generated world.
2. No physics, survival, combat, crafting, or inventory logic yet.
3. Oceans render as their sea floor; water/sky is a tinted background, not a
   translucent liquid mesh.
4. No persistence; the save format is contracted but not yet used by runtime.
5. Performance benchmark (standard 19) not yet measured (gameplay systems
   absent).

## License & assets

- Code: MIT (see `LICENSE`).
- All assets original / procedurally generated at runtime; no Minecraft assets
  are bundled. See `NOTICE.md`.
