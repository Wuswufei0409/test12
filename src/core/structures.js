// B5 ocean content structures (crit 15). Pure, deterministic module.
//
// Generates shipwrecks, underwater ruins, and buried treasure within ocean
// chunks. Placement is driven by a per-(seed,chunk) hash so the same seed
// reproduces the same structures — consistent with the reproducibility goal
// (§Seeds). A treasure_map item reveals/points to a nearby buried treasure
// whose chest can be mined for a reward (coral + prismarine shards).
import { seededRandom, hashSeed } from './rng.js';
import { BLOCKS } from './blocks.js';

const bid = (name) => {
  const b = BLOCKS[name];
  return b ? b.id : 0;
};
const PLANKS = bid('planks');
const LOG = bid('log');
const STONE_BRICKS = bid('stone_bricks');
const PRISMARINE = bid('prismarine');
const SAND = bid('sand');
const WATER = bid('water');
const TREASURE_CHEST = bid('treasure_chest');
const CORAL_BLOCK = bid('coral_block');
const PRISMARINE_SHARD = 201; // items.js prismarine_shard
const CORAL = 120; // coral item (blocks.js)
const DIAMOND = 13; // diamond_ore block id

// Chance gates per chunk (per-seed-deterministic).
const SHIPWRECK_RATE = 0.08;
const RUIN_RATE = 0.1;
const TREASURE_RATE = 0.07;

function chunkRng(seed, cx, cz, salt) {
  return seededRandom(hashSeed(`${seed}:${salt}:${cx}:${cz}`));
}

/**
 * Deterministic structure placement decision for a chunk.
 * @returns one of 'shipwreck' | 'ruin' | 'treasure' | null
 */
export function structureAt(seed, cx, cz) {
  const r = chunkRng(seed, cx, cz, 'struct');
  const roll = r();
  if (roll < SHIPWRECK_RATE) return 'shipwreck';
  if (roll < SHIPWRECK_RATE + RUIN_RATE) return 'ruin';
  if (roll < SHIPWRECK_RATE + RUIN_RATE + TREASURE_RATE) return 'treasure';
  return null;
}

/** Treasure location (relative world col within a chunk). Deterministic. */
export function treasureColumn(seed, cx, cz) {
  const rng = chunkRng(seed, cx, cz, 'treasure');
  return { x: cx * 16 + 2 + Math.floor(rng() * 12), z: cz * 16 + 2 + Math.floor(rng() * 12) };
}

/**
 * Apply ocean structures for one chunk into a mutable world (`state.get/set`).
 * Structures only spawn where the chunk is ocean (the floor cell is water or
 * sand under water) so they do not appear on land.
 */
export function applyStructures(state, seed, cx, cz) {
  const kind = structureAt(seed, cx, cz);
  if (!kind) return kind;

  // Probe the chunk centre column; only build in water.
  const probeX = cx * 16 + 8;
  const probeZ = cz * 16 + 8;
  const probs = state.get(probeX, 24, probeZ);
  const isOcean = probs === WATER || probs === 0;
  if (!isOcean) return null;

  if (kind === 'treasure') {
    const t = treasureColumn(seed, cx, cz);
    const surf = surfaceY(state, t.x, t.z);
    // bury the chest under sand/sandstone near the sea floor
    const by = Math.max(8, surf - 3);
    state.set(t.x, by, t.z, TREASURE_CHEST);
    state.set(t.x, by + 1, t.z, SAND);
    return kind;
  }
  if (kind === 'shipwreck') {
    const x0 = cx * 16 + 3;
    const z0 = cz * 16 + 3;
    for (let dx = 0; dx < 4; dx += 1) {
      for (let dz = 0; dz < 2; dz += 1) {
        const sy = surfaceY(state, x0 + dx, z0 + dz);
        for (let k = 0; k < 2; k += 1) {
          const y = Math.max(4, sy - k);
          const cur = state.get(x0 + dx, y, z0 + dz);
          if (cur === WATER || cur === 0) state.set(x0 + dx, y, z0 + dz, dx % 2 === 0 ? PLANKS : LOG);
        }
      }
    }
    return kind;
  }
  if (kind === 'ruin') {
    const x0 = cx * 16 + 4;
    const z0 = cz * 16 + 4;
    for (let dx = 0; dx < 3; dx += 1) {
      for (let dz = 0; dz < 3; dz += 1) {
        const sy = surfaceY(state, x0 + dx, z0 + dz);
        const y = Math.max(4, sy);
        const cur = state.get(x0 + dx, y, z0 + dz);
        if (cur === WATER || cur === 0) {
          state.set(x0 + dx, y, z0 + dz, (dx + dz) % 3 === 0 ? STONE_BRICKS : PRISMARINE);
        }
      }
    }
    return kind;
  }
  return null;
}

function surfaceY(state, x, z) {
  // first non-air/non-water solid from the top of the ocean down
  for (let y = 40; y > 2; y -= 1) {
    const b = state.get(x, y, z);
    if (b !== WATER && b !== 0) {
      // top of the solid block -> next cell up is the water floor cell
      return y + 1;
    }
  }
  return 26;
}

/**
 * Treasure reward for mining the buried chest: coral + prismarine shards +
 * a rare diamond (mirrors a "mineable reward" from the treasure map).
 */
export function treasureLoot() {
  return [
    { itemId: CORAL, count: 4 },
    { itemId: PRISMARINE_SHARD, count: 3 },
    { itemId: DIAMOND, count: 1 },
  ];
}

/**
 * Treasure map: given the player position, reveal the nearest buried treasure
 * within `radius` (deterministically searched chunk-by-chunk) with direction +
 * distance, i.e. the map "points to" a mineable reward.
 */
export function revealTreasure(state, seed, playerPos, radius = 64) {
  const pcx = Math.floor(playerPos.x / 16);
  const pcz = Math.floor(playerPos.z / 16);
  const r = Math.max(1, Math.ceil(radius / 16));
  let best = null;
  for (let dx = -r; dx <= r; dx += 1) {
    for (let dz = -r; dz <= r; dz += 1) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      if (structureAt(seed, cx, cz) !== 'treasure') continue;
      const t = treasureColumn(seed, cx, cz);
      const dist = Math.hypot(t.x - playerPos.x, t.z - playerPos.z);
      if (dist <= radius && (!best || dist < best.dist)) {
        best = { x: t.x, z: t.z, dist };
      }
    }
  }
  return best;
}
