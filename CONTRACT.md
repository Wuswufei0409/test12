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

**B7 (MUL-103) extension — format 2** (additive, `src/core/save.js`): the save
now also records `player.pos/yaw/pitch/vel`, `living` (health/hunger/
saturation/air/deaths), `spawnPoint`, `inventory.stacks+selected`, `equipped`
(armor), `worldEdits` (modified-block overlay), `containers` (chest/furnace),
`drops`, and `mobs` (entity state). `loadStoredSave` returns
`{ok:true}` / `{ok:false,kind:'missing'|'corrupt'|'invalid'}` so the client can
surface a clear error and start a fresh world without silently overwriting a
valid save. The client saves on a ~5s autosave, `beforeunload`, and
`visibilitychange` to resume after tab close.

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

## 8. Crafting / tools / smelting (added B1)

- Crafting is **config-driven**: `src/core/crafting.js` `RECIPES` holds shaped
  (2x2/3x3) and shapeless recipes; each recipe outputs `[itemId, count]`.
  Matching trims the 3x3 grid to its occupied bounding box so placement corner
  is irrelevant. Exposes `findRecipe(craftGrid)|craft(grid)|recipeBook()`.
- Item IDs: base registry (`blocks.js` BLOCKS/ITEMS, ids 0..118) plus B1 items
  (`items.js` B1_ITEMS, ids 200..215). Names must resolve via these tables only.
- Tool tiers `TOOL_TIERS`: wood (durability 60, digSpeed 1.0, harvest 0),
  stone (132, 2.0, 1), iron (251, 3.0, 2). Tool type per item in `TOOL_ITEMS`.
- Block->required tool (`BLOCK_TOOL`) and min harvest (`BLOCK_HARVEST`) enforce
  wrong-tool/harvest restrictions; wrong tool => no drop. Ore drops: coal_ore -> coal,
  iron_ore -> iron_ore (smelted). Dig time = hardness / digSpeed (see `dig()`).
- Smelting: `src/core/smelting.js` `SMELTING_RECIPES` (iron_ore->iron_ingot,
  coal_ore->coal, sand->glass) with `FUEL` tick values; `Furnace` is a pure tick
  state machine (input/fuel/output/progress). Full chain: wood pickaxe -> mine
  coal & iron -> smelt -> craft iron pickaxe, validated by test.
- Inventory uses the canonical A4 hotbar module `createInventory`
  (`src/core/inventory.js`), shared by B1 tests and A4 mechanics.

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

## 10. Survival & day/night (added B2)

- **Stats** (`src/core/living.js`): `health`/`hunger`/`saturation` (20/20/5),
  `air` (10s oxygen). Damage is applied via `applyDamage(living, amount,
  {type, difficulty})`; `type:'hostile'` scales by `DIFFICULTY.damageScale`
  (peaceful→0, easy→0.5, normal→1), while `type:'environment'` (fall, drown,
  starve) is always full. Falling below 0 HP sets `alive=false` (death → respawn
  after a short delay at the spawn point).
- **Hunger & food**: hunger drains ~1 point per 30 sim-seconds (saturation
  absorbs first). Food items (`.food` in the item registry: bread +5, apple +4)
  restore hunger via `eatSelected`; well-fed players regenerate 1 HP/4s;
  starvation (hunger 0) deals 1 environmental HP/4s.
- **Drowning**: head underwater depletes the `air` bar (10s); when empty, 1 HP
  per second. Air refills twice as fast when surfaced.
- **Fall damage**: falling more than `fallDamageThreshold = 3` blocks deals
  `floor(distance - 3)` environmental damage on landing (`trackFall`).
- **Day/night cycle** (`src/core/daycycle.js`): one day = 24000 ticks; tick 0 =
  6:00, noon 6000, dusk 12000+ (night 12000–23000, daytime undead/mob hooks).
  `daylight(tick)` smooth 0..1 drives sun/ambient/sky; `nextDawn` skips to the
  next 6:00. Difficulty and day phase are read-only today (no hostile mobs in
  B2 — that is a later issue); `hostiles` become eligible at night.
- **Sleep / spawn**: a placed **bed** (block id 18) on a solid support; pressing
  `F` on it at night skips to `nextDawn` and resets the player's respawn point to
  the bed. Respawning returns the player to the current spawn point at full
  health/hunger; deaths are counted.
- **HUD**: health/hunger/oxygen bars, day+phase+difficulty readout, death
  overlay + respawn banner; RMB eats food when the selected slot is edible,
  else places.

## 11. Land mobs & combat gear (added B3)

- **Mob registry** (`src/core/mobs.js`): pig/cow/sheep/chicken (passive),
  zombie/spider/creeper (hostile). A mob is a plain object with
  `{type, x,y,z (feet), vy, health, alive, passive, aggro, hurtTicks,
  attackCooldown, fuse}`. `createMob(type,x,y,z)` spawns; `stepMob` advances one
  tick; `damageMob(mob, amt, {x,z})` applies damage + knockback, sets
  `alive=false` at 0 HP; `mobDrops(mob)` returns configured drops.
- **Behaviours**: passive mobs wander or flee when hurt; hostiles wander until a
  player is within 14 blocks, then chase and melee-attack in range (attack gets a
  cooldown). Creeper walks up, fuses for `fuse=30` ticks, then emits
  `{explode:{x,y,z,radius:3}}` — the caller carves the world via
  `explode()` (`src/core/explosion.js`) which removes voxels in a radius-3 sphere
  (skipping unbreakable blocks, e.g. bedrock) and returns dropped item ids.
- **Difficulty gating**: `DIFFICULTY.peaceful.hostileSpawn=false`; hostile spawn
  is gated to night (plus a small daytime chance) and damage scales via
  `difficultyOf(name).damageScale` (peaceful→0, easy→0.5, normal→1).
- **Mob drops** (item ids, `src/core/blocks.js`): raw_porkchop 120, raw_beef 121,
  raw_mutton 122, raw_chicken 123, rotten_flesh 124, string 125, gunpowder 126,
  leather 127, wool 128. Passive mobs drop 1 of each configured drop; hostiles
  drop with a 1/8 chance. Food values let meat be eaten via the B2 system.
- **Combat gear** (`src/core/combat.js`): swords wood/stone/iron (ids 100/101/102,
  melee dmg 4/5/6, range 2.6/3.0/3.4), bow 103 (fires arrows, dmg 6, max range
  48), arrow 104. `weaponStats(id)` returns per-material stats; `resolveMelee`
  honours range + cooldown and reports `{hit, damage, knockback, feedback}`.
- **Armor** (ids 129–136: leather/iron helmet/chest/leggings/boots; armor points
  1/3/2/1 and 2/6/5/2): `armorReduction(equippedIds)` returns
  `points/(points+20)` damage fraction; the player wears up to one per slot
  (helmet/chest/leggings/boots). Press `G` to equip/unequip the selected piece.
- **Durability**: swords/armor wear with use; a broken tool item is consumed from
  the hotbar (hand has no tool loss). Melee `/ arrow hits and bow shots are
  accompanied by a short HUD damage flash (observable hit feedback).

## 12. Farming (added B4)

- **Farmland**: right-click dirt/grass with a hoe (`wooden_hoe 216`, `stone_hoe
  217`, `iron_hoe 218`, crafted via hoe recipes) turns the block into farmland
  (`farmland 36`, solid). Farming logic lives in `src/core/farming.js`.
- **Crops & planting**: wheat seeds `220`, carrot `221`, potato `222` each map
  to a crop (`CROP_SEED_ITEM`). Right-click an existing farmland block with a
  seed plants the stage-0 crop in the cell above. Crops are non-solid (walkable,
  instant-harvest) with growth encoded in block ids:
  wheat `40..43`, carrot `44..47`, potato `48..51` (4 stages each).
- **Growth over ticks**: `tickCrops(crops, world, dt, light)` advances a
  runtime `Map<"x,y,z",{type,age}>` each frame by sim-time under a light factor
  (0..1 from the solar clock). Growth rate = `age * (0.35 + 0.65*light)` over
  `FARM.growSeconds`, so crops grow faster in daylight and can be verified over
  world ticks. A crop dies (removed) if its support is no longer farmland.
- **Harvest**: left-click harvests instantly (`harvestDrops`). Mature crops drop
  the vegetable (`wheat 106` + a seed for wheat); immature crops return only the
  seed/vegetable. Carrot/potato are edible (`food: 2`/`1`); wheat feeds the B1
  `bread` recipe — the B4 "grow -> harvest -> food prep" loop.
- **Integration**: `src/main.js` seeds the starter kit with a hoe + seeds and
  wires tilling/planting into the RMB handler, instant crop harvest into the LMB
  handler, and `tickCrops` into the per-frame loop (B4 §-tests in
  `test/b4.test.js`).

## B5 — Water core & ocean content (crit 14, 15)

- **Blocks/items**: ocean blocks 52..57 (coral_block, coral_plant, kelp,
  seagrass, iceberg, treasure_chest) and items 119/200/201 (treasure_map, coral,
  prismarine_shard). Note: renumbered to free ids on Phase B2 integration to
  avoid collision with Phase-B blocks 36-51 and items 120-136. Sources
  `src/core/blocks.js`.
- **Water mechanics** (`src/core/water.js`): head-in-water detection, oxygen
  bar with underwater depletion / in-air regeneration, drowning damage once the
  bar empties (scaled by difficulty), sprint-swim speed, reduced underwater
  visibility, 1x1 waterway passability, buoyant drops (water drag + float-to-
  surface), and underwater block breaks fill the cell with water (no erroneous
  air pockets).
- **Ocean worldgen** (`src/core/worldgen.js`): deterministic kelp/seagrass/coral
  placement in the water column and iceberg shelves in cold oceans — additive,
  does not change the land heightmap/fingerprint.
- **Structures** (`src/core/structures.js`): per-(seed,chunk) deterministic
  shipwrecks, underwater ruins and buried treasure; a treasure_map reveals and
  the chest drops a mineable reward (coral + prismarine + diamond).
- **Integration**: `src/main.js` applies ocean structures per loaded chunk,
  draws O2/HP bars in the HUD, and switches fog/background underwater.

## B6 — Aquatic mobs & trident (crit 16, 17)

- **Item ids (blocks.js, ids 220..231)**: cod(220), salmon(221),
  tropical_fish(222), pufferfish_item(223), water_bucket(224),
  cod_bucket(225), salmon_bucket(226), tropical_fish_bucket(227),
  pufferfish_bucket(228). Empty bucket = 112 (base); trident = 115 (base).
- **Aquatic mobs (`src/core/aquatic.js`)**: dolphin / cod / salmon / tropical
  fish / pufferfish with spawn (deterministic over water cells), swim/wander,
  out-of-water flop->death, hurt/death drops, and pufferfish inflate state that
  visibly grows near the player and deals contact damage. Bucket capture
  (empty bucket -> "bucket of <fish>") and release (fish bucket -> mob spawn).
- **Trident (`src/core/trident.js`)**: throw/return/durability/damage with four
  enchants — Loyalty (returns after flight), Riptide (returns instantly +
  propels), Channeling (lightning bolt on thunder aquatic hit), Impaling
  (+2.5/level vs aquatic). All four implemented; at least 3 required by the
  criterion. Deterministic flight/hit/return scenarios are unit-tested.
- **Integration** (`src/main.js`): nearby aquatic mobs spawn in ocean, swim and
  puff each frame, rendered as colored boxes; pufferfish contact damage drains
  health; holding a trident RMB throws it, empty bucket RMB captures a near
  fish, a fish-bucket RMB releases it; `T` cycles trident enchants; HUD shows
  trident enchant/durability and aquatic mob count. Build clean, `npm test`
  113/113 (26 new B6).
## B8 — Performance sampling (crit 19)

- **Harness** (`perf/measure.mjs`): headless-Chromium measurement of the
  production build. Scene = view-distance 6 chunks + 30 forced live mobs
  (`?perf=1` hook in main.js). Samples per-frame rAF deltas (steady-state,
  after chunk-build/spawn warm-up) and OS RSS of the Chromium process tree
  (headless Chromium stubs `performance.memory`). Run:
  `node perf/measure.mjs [seconds] [outDir]`.
- **Instrumentation** (`src/main.js`): a `?perf=1`-only per-frame sampler
  (rolls a 6000-frame window, exposes `window.__test12Perf`), plus a
  `window.__test12ForceMobs(n)` hook to make the 30-entity scenario
  reproducible. Normal play is completely untouched (perf flag absent).
- **Optimizations** that raised steady-state FPS well above target:
  linear fog (`THREE.Fog`) instead of per-fragment exponential fog
  (`FogExp2`), and MSAA disabled (`powerPreference: 'high-performance'`).
  Both are visually near-identical and cheaper on low-end GPUs.
- **Result (300 s)**: avg 32.8 FPS, P95 34.8 ms, 0 errors, RSS Δ −115.8 MB
  (no unbounded growth). Raw data in `perf/results/` + `perf/README.md`.
