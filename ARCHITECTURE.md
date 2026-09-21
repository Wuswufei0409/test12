# Architecture (Phase A)

## Overview

| Layer | Tech | Purpose |
|-------|------|---------|
| Render | Three.js | WebGL scene, camera, lights, meshes |
| Build/Dev | Vite | dev server, bundling, base path for GitHub Pages |
| Logic | `src/core/` | platform-independent pure modules (RNG, world/time, blocks, terrain) |
| Test | Vitest | headless unit + smoke tests |
| CI/CD | GitHub Actions | build + test + Pages deploy |

The design keeps **core logic free of Three.js/DOM dependencies** so it can be
unit-tested headlessly and reused across renderers.

## Module graph

```
src/core/rng.js        seeded PRNG (mulberry32) + string hash
src/core/world.js      WORLD/TIME/DIFFICULTY constants + time conversion
src/core/blocks.js     block/item ID registry (single source of truth)
src/core/terrain.js    deterministic value noise + 8 biomes + heightmap +
                       column cache + fixed-seed fingerprint/sample
src/core/worldgen.js   deterministic chunk worldgen (blockAt, generateChunk,
                       chunk column cache)
        ^
        +-- used by -- src/main.js (renderer), src/render/*, test/*
src/render/atlas.js    procedural pixel-texture atlas (original, generated)
src/render/chunkmesh.js merged chunk geometry with face culling (A2, pure)
src/render/worldmesh.js merged chunk geometry reading a mutable WorldState (A4)
src/core/worldstate.js  A4 edit-overlay world (mine/place) over A2 terrain; also
                        the A3 collider (isSolid/isLiquid)
src/core/targeting.js   DDA voxel raycast (crosshair target + place cell)
src/core/breaking.js    hardness-based break time + progress
src/core/inventory.js   9-slot hotbar with stacking + selection
src/core/drops.js       block->item drop table + drop physics + pickup
src/core/daycycle.js    day/night cycle: daylight, isNight, phase, nextDawn
src/core/living.js      survival: health/hunger/damage/food/drowning/fall/death
src/core/mobs.js        land mobs: spawn/wander-chase/attack-flee/hurt/death/drops (B3)
src/core/explosion.js   creeper explosion: carve world sphere + drop collection (B3)
src/core/combat.js      combat gear: melee/bow/armor/durability, knockback, cooldown (B3)
```

- `main.js` is the only browser-coupled module: sets up the Three.js scene,
  streams chunks around the player (load/unload by view distance), renders sky
  + fog, runs the A3 player physics loop, and draws the crosshair/hotbar/HUD
  overlay. It also wires A4 mining/placing/drop-pickup against the shared
  `WorldState`, and B2 survival (health/hunger/damage/death/respawn), the
  day/night light cycle and bed sleep against `daycycle`/`living`. It consumes
  `src/core/*` and `src/render/*`.
- Chunk meshing reads the precomputed chunk array (A2 `chunkmesh`) for pure
  generation; `worldmesh` reads the mutable `WorldState` so mined/placed blocks
  appear once the 3x3 chunk neighbourhood is rebuilt. Both sample neighbours
  to cull interior faces and keep determinism with low cost.
- Cross-module contracts live in `CONTRACT.md` and are mirrored by
  `src/core/*` constants; tests assert determinism / invariants.

## Deploy pipeline (GitHub Actions)

`.github/workflows/ci.yml` runs on push/PR to `main`:

1. `npm ci`
2. `npm run build` (must pass)
3. `npm test` (core logic + fixed-seed smoke)
4. Deploy `dist/` to GitHub Pages via `actions/deploy-pages`.

Pages source = **GitHub Actions**, base = `/test12/` (set in `vite.config.js`).

## Why (non-goals in Phase A)

No game engine (Unity/Unreal/Godot). Only render libraries. Runtime assets are
procedurally generated → no Minecraft/commercial assets. Phase A explicitly
deferks gameplay systems to later issues.
