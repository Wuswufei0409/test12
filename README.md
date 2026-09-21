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

## Project state (Phase A)

This milestone delivers the **backbone only**:

- Vite + Three.js scaffold that builds cleanly and renders a voxel ground.
- Deterministic seeded world-gen primitives (mulberry32 RNG, heightmap,
  biomes, terrain fingerprint).
- Core-logic unit tests + fixed-seed smoke test.
- CI (GitHub Actions): build + core tests + fixed-seed smoke + Pages deploy.
- Public HTTPS deployment on GitHub Pages.
- `CONTRACT.md` defining shared cross-module contracts.

The full 20-standard gameplay scope (mining/building, inventory, crafting,
survival, mobs, ocean/aquatic content, trident, saving, performance
benchmarking, final acceptance) is out of scope for this issue and is tracked
in later issues. See **Known limits** below.

## Known limits (Phase A)

1. Rendering is a minimal flat voxel ground — no chunk streaming, LOD, or
   block interaction yet.
2. No player controls, physics, or collision yet.
3. No survival/combat/crafting/inventory logic.
4. No persistence; save format is contracted but not yet used by runtime.
5. Performance benchmark (standard 19) not yet measured (no meaningful scene).

## License & assets

- Code: MIT (see `LICENSE`).
- All assets original / procedurally generated at runtime; no Minecraft assets
  are bundled. See `NOTICE.md`.
