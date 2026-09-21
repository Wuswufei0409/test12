// Farming: farmland (tilled dirt), crop plants (wheat/carrot/potato), growth
// driven by time and light, and harvest drops. Pure + headless-testable.
//
// Crop state (type + accumulated age) lives in a Map owned by the runtime; the
// growth stage is encoded in the block id so the mesher renders visible growth
// (green -> mature). Growth scales with light (faster in full daylight, slower
// at night), so it is verifiable over world ticks.
import { BLOCKS } from './blocks.js';

export const FARM = {
  farmland: 36, // block id for tilled dirt (made by right-clicking dirt/grass with a hoe)
  growSeconds: 90, // sim-seconds at full light to reach full maturity (4 stages)
  lightMin: 0.35, // growth-rate floor at night (0..1 light multiplier)
};

// Seed item id -> crop type; the same item is re-mined/planted for carrot &
// potato (like vanilla, the vegetable is the seed).
export const CROP_SEED_ITEM = {
  220: 'wheat', // wheat_seeds
  221: 'carrot', // carrot (plantable + edible)
  222: 'potato', // potato (plantable + edible)
};

export const CROP_TYPES = {
  wheat: {
    seedItem: 220,
    harvestItem: 106, // wheat
    stageBlocks: [40, 41, 42, 43],
    matureDropMin: 1,
    matureDropMax: 2,
    seedDrop: true, // mature wheat also drops a seed
  },
  carrot: {
    seedItem: 221,
    harvestItem: 221, // carrot
    stageBlocks: [44, 45, 46, 47],
    matureDropMin: 1,
    matureDropMax: 3,
    seedDrop: false,
  },
  potato: {
    seedItem: 222,
    harvestItem: 222, // potato
    stageBlocks: [48, 49, 50, 51],
    matureDropMin: 1,
    matureDropMax: 4,
    seedDrop: false,
  },
};

// Reverse map: stage block id -> { type, stage, crop }
const BLOCK_TO_CROP = {};
for (const [type, c] of Object.entries(CROP_TYPES)) {
  c.stageBlocks.forEach((b, i) => {
    BLOCK_TO_CROP[b] = { type, stage: i, crop: c };
  });
}

/** Cursor into CROP_TYPES metadata for a crop block id (null if not a crop). */
export function cropOfBlock(id) {
  return BLOCK_TO_CROP[id] || null;
}

export function isCropBlock(id) {
  return !!BLOCK_TO_CROP[id];
}

export function isFarmland(id) {
  return id === FARM.farmland;
}

export function stageBlockId(type, stage) {
  return CROP_TYPES[type].stageBlocks[stage];
}

/** Crop type whose seed is the given item id (null if not a seed). */
export function cropForSeed(itemId) {
  return CROP_SEED_ITEM[itemId] || null;
}

export function maxStage(type) {
  return CROP_TYPES[type].stageBlocks.length - 1;
}

/**
 * Growth stage from accumulated age (sim seconds) and a light factor 0..1.
 * Full light grows at the nominal rate; darkness grows at lightMin rate.
 */
export function stageForAge(age, light, type) {
  const lum = Math.max(0, Math.min(1, light));
  const effective = age * (FARM.lightMin + (1 - FARM.lightMin) * lum);
  const frac = Math.min(1, effective / FARM.growSeconds);
  return Math.floor(frac * maxStage(type));
}

/**
 * Items dropped when a crop is harvested. Mature crops yield the vegetable
 * (and wheat also a seed); immature crops only return the seed/vegetable.
 */
export function harvestDrops(type, mature, rng = Math.random) {
  const c = CROP_TYPES[type];
  const out = [];
  if (mature) {
    const n = Math.floor(c.matureDropMin + rng() * (c.matureDropMax - c.matureDropMin + 1));
    out.push({ itemId: c.harvestItem, count: n });
    if (c.seedDrop) out.push({ itemId: c.seedItem, count: 1 });
  } else {
    out.push({ itemId: c.seedItem, count: 1 });
  }
  return out;
}

/**
 * Advance every tracked crop by `simDt` seconds under the given light factor.
 * `crops` is a Map<coordKey("x,y,z"), {type, age}>. A crop whose support is no
 * longer farmland is removed. Returns events for died/removed crops.
 */
export function tickCrops(crops, world, simDt, light) {
  const events = [];
  for (const [key, c] of crops.entries()) {
    const parts = key.split(',').map(Number);
    const [x, y, z] = [parts[0], parts[1], parts[2]];
    // Dead if the block below is no longer farmland.
    if (!isFarmland(world.get(x, y - 1, z))) {
      world.set(x, y, z, 0);
      crops.delete(key);
      events.push({ x, y, z, died: true });
      continue;
    }
    c.age += simDt;
    world.set(x, y, z, stageBlockId(c.type, stageForAge(c.age, light, c.type)));
  }
  return events;
}

// farmland is the tilled block used for placement legality checks.
export function farmlandId() {
  return BLOCKS.farmland ? BLOCKS.farmland.id : FARM.farmland;
}
