# test12 — Cross-Module Shared Contracts

This document is the **single source of truth** for contracts that span multiple
modules / issues in the test12 experiment. Any cross-module interface, ID,
coordinate, time, save, or config value **must** be defined here (and mirrored
in `src/core/*`) rather than living only in one agent's private memory.

> Status: **Phase A (draft baseline).** Values below are the initial shared
> contract. Later issues may extend them (save format grows, more blocks added),
> but additions must be additive and documented here; change the meaning of a
> published contract only by explicit decision + a new section/version marker.

## 1. Coordinate system

- **Unit:** 1 block = 1 world unit (meter-equivalent). Axis-aligned blocks.
- **Y axis** points up. Ground surface is at the highest non-air block.
- Coordinates are monotonically increasing integer **block positions**. A block
  at `(x, y, z)` occupies the cube `[x, x+1) × [y, y+1) × [z, z+1)`.
- Player entity position is a **float** in the same units; the containing block
  is `(floor(x), floor(y), floor(z))`.
- `0,0,0` is inside spawn-column; default spawn: `(0, 8, 0)`.

## 2. Block / Item ID registry

- Numeric IDs are **stable keys**; never reorder or reuse (they persist in
  saves). Name → numeric map lives in `src/core/blocks.js` (`BLOCKS` = placeable
  blocks, `ITEMS` = items). Block `id 0 = air`.
- Block property fields: `id, name, solid, hardness, [liquid], [light],
  [unbreakable], [color]`. Hardness `-1` = not breakable by hand.
- Item fields: `id, name, item:true, stack, [food]`.
- Adding a block/item = append a new numeric id at the END of the table.

## 3. Tick model & time units

- Simulation advances in **ticks**. **Tick rate = 20 Hz** (`tickRateHz`), so
  **1 tick = 50 ms of sim time**.
- One full day/night = **24000 ticks** (`dayLengthTicks`). `worldTime =
  tick % dayLengthTicks` wraps continuously.
- Solar clock: `tickOfDay=0` ≈ 6:00 AM; noon ≈ tick 6000; sunset ≈ 12000.
  See `tickToGameTime()` in `src/core/world.js`.
- Difficulty (`DIFFICULTY`): `peaceful / easy / normal` — each keyed by
  `{ hostileSpawn, damageScale }`.

## 4. World & chunk config

- `chunkSize = 16` (blocks per chunk edge, x/z), `chunkHeight = 64`.
- Standard (benchmark) view distance = **6 chunks** (contract standard 19).
- Chunk loading is keyed by `(chunkX, chunkZ) = (floor(x/16), floor(z/16))`.

## 5. Seeds & world generation

- All world generation uses the deterministic **mulberry32** PRNG
  (`seededRandom`) in `src/core/rng.js`; `hashSeed` folds a string seed into a
  uint32.
- The same seed must reproduce identical terrain. Reproducibility is verified
  by a **terrain fingerprint** (fixed-coordinate height sequence) **and** a
  **fixed-coordinate biome+height sample** in
  `test/smoke/fixed-seed.test.js`.
- Default / benchmark seed: `test12-phase-a`.
- **Biome tags (Phase A, A2):** `plains, forest, desert, mountains, cold_ocean,
  warm_ocean, deep_ocean, shallow_ocean`. Oceans are water-filled to
  `SEA_LEVEL = 32`. Land/ocean and temperature/humidity derive from layered
  value noise (`src/core/terrain.js#columnAt`).
- **Chunk world generation:** `src/core/worldgen.js#generateChunk(seed, cx, cz)`
  returns an immutable `Uint8Array` of block ids (`chunkSize×chunkHeight×
  chunkSize`). `blockAt(seed, x, y, z)` samples any world position from cached
  columns; the same seed yields identical chunk data. A **land-spawn fallback**
  `findLandSpawn(seed)` snaps the player to the nearest non-ocean column so the
  first-person view is above ground even when the nominal origin is ocean.

## 6. Save format (Phase A baseline)

- Versioned JSON, keyed by a format version integer. Phase A baseline shape:

```jsonc
{
  "format": 1,
  "seed": "test12-phase-a",
  "worldTime": 6000,
  "player": { "pos": [0, 8, 0], "hp": 20, "hunger": 20 },
  "difficulty": "normal"
}
```

- Later issues extend with inventory, modified blocks, chests/furnaces, and
  entity state — **additively**, never breaking `format`.
- Corrupt/unreadable saves must surface a clear error and fall back safely
  (never silently overwrite a valid save).

## 7. Player physics (added A3)

- Player is an axis-aligned box: width `0.6`, standing height `1.8`, eye height `1.62`; sneak height `1.5`. Half-width `0.3`.
- Collision is AABB-vs-solid-block resolved per axis (X, Z, then Y); players cannot pass through or stably embed in solid blocks.
- Gravity `0.08` blocks/tick² ; jump `0.42`; velocities are per-tick at 20 Hz (see `src/core/physics.js` `PLAYER`).
- Movement: WASD relative to yaw; sprint `1.3x`, sneak `0.3x`, swim `0.6x`, low buoyancy (`0.4` of gravity) with climb/dive.
- Step-up: horizontal moves auto-step obstacles up to `maxStep = 0.5` while grounded (stairs/slabs); taller ledges block.
- Landing sets `onGround` and zeroes vertical velocity. Implemented in `createPlayer/stepPlayer` (pure, tested).
- Arena/world adapter for collision: `src/core/worldgrid.js` `WorldGrid` (`isSolid/isLiquid`).

## 8. Artifact & versioning

- Releases are tagged and CI builds are immutable per commit.
- The deploy is GitHub Pages at `https://Wuswufei0409.github.io/test12/`.

## 9. Mining, placement, drops & inventory (added A4)

- **World edits** are an overlay on deterministic terrain: `WorldState`
  (`src/core/worldstate.js`) answers `get(x,y,z)` from an edit Map first, else
  the pure A2 generator. With no edits it is byte-identical to worldgen
  (determinism preserved). It also implements the A3 collider contract
  (`isSolid`/`isLiquid`), so the same object drives meshing and player physics.
- **Targeting**: `raycastBlock` (DDA voxel traversal, `src/core/targeting.js`) or
  the crosshair; returns the hit block `{x,y,z}` and place cell `{nx,ny,nz}` on
  the near face within `maxDist = 6`.
- **Breaking**: block hardness drives break time — `breakTime = hardness*1.5 +
  0.1`s by hand (`src/core/breaking.js`). `hardness < 0` / `unbreakable` /
  non-solid / liquid never break. Progress accumulates while the crosshair holds
  the block and resets on retarget.
- **Drops**: `dropForBlock` maps a mined block to an item id. Most breakable
  solid blocks drop themselves (so mining -> inventory -> placing is a real
  loop); `grass->dirt`, `coal_ore->coal`, `iron_ore->iron_ingot`, an
  `leaves`/`diamond_ore` drop nothing. Drops are physics entities
  (`src/core/drops.js`) with gravity, ground friction/rest, and shelf life;
  picked up when the player AABB overlaps them.
- **Hotbar / inventory**: 9 hotbar slots (`HOTBAR_SIZE`, `src/core/inventory.js`).
  Items stack to `stack` limit (blocks and items default 64; tools/weapons 1).
  Adding first stacks partial slots then fills empties; leftover is returned.
  Selected slot drives placement; `1-9` keys / mouse wheel select.
- **Placement**: right-click places the selected hotbar block at the near-face
  cell when (a) it is air, (b) the selected slot holds a solid, non-liquid
  placeable block, (c) the cell does not overlap the player AABB. One item is
  consumed per placement.
- **Integration**: `src/main.js` wires A2 chunk streaming + A3 player loop + A4
  mechanics; mined/placed chunks (3x3 neighbourhood) rebuild their mesh from
  `WorldState` (`src/render/worldmesh.js`).
