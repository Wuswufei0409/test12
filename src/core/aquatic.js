// B6 aquatic mobs (crit 16). Pure, headless-testable module.
//
// Model for dolphin / cod / salmon / tropical fish / pufferfish: spawn, swim
// behaviour, bucket capture/release, pufferfish visible state + contact damage,
// hurt/death drops. The `world` only needs isSolid(x,y,z)/isLiquid(x,y,z),
// matching the collider contract.
import { getBlockById, ITEMS } from './blocks.js';

// --- item ids (from blocks.js B6 registry) ---
const IID = (name) => {
  const i = ITEMS[name];
  return i ? i.id : null;
};
export const FISH_ITEM = {
  cod: IID('cod'),
  salmon: IID('salmon'),
  tropical_fish: IID('tropical_fish'),
  pufferfish: IID('pufferfish_item'),
};
export const FISH_BUCKET = {
  cod: IID('cod_bucket'),
  salmon: IID('salmon_bucket'),
  tropical_fish: IID('tropical_fish_bucket'),
  pufferfish: IID('pufferfish_bucket'),
};
export const WATER_BUCKET = IID('water_bucket');
export const EMPTY_BUCKET = 112; // base bucket item

// Reverse: bucket item id -> fish type.
const BUCKET_TO_TYPE = {};
for (const [type, bid] of Object.entries(FISH_BUCKET)) {
  if (bid != null) BUCKET_TO_TYPE[bid] = type;
}

export const MOB_SPECS = {
  dolphin: {
    name: 'dolphin',
    health: 10,
    swimSpeed: 4, // blocks/sec swim
    color: 0x6f8fa8,
    size: [1.2, 0.6, 0.6],
    bucketable: false,
    hostile: false,
    drop: [], // no drops on death
  },
  cod: {
    name: 'cod',
    health: 3,
    swimSpeed: 1.4,
    color: 0xbb9f6a,
    size: [0.5, 0.35, 0.25],
    bucketable: true,
    drop: [{ itemId: FISH_ITEM.cod, count: 1 }],
  },
  salmon: {
    name: 'salmon',
    health: 3,
    swimSpeed: 1.6,
    color: 0xd8876a,
    size: [0.7, 0.4, 0.3],
    bucketable: true,
    drop: [{ itemId: FISH_ITEM.salmon, count: 1 }],
  },
  tropical_fish: {
    name: 'tropical_fish',
    health: 3,
    swimSpeed: 1.8,
    color: 0x4a9ad8,
    size: [0.5, 0.4, 0.3],
    bucketable: true,
    drop: [{ itemId: FISH_ITEM.tropical_fish, count: 1 }],
  },
  pufferfish: {
    name: 'pufferfish',
    health: 3,
    swimSpeed: 1.0,
    color: 0xd8c84a,
    size: [0.4, 0.4, 0.4],
    bucketable: true,
    drop: [{ itemId: FISH_ITEM.pufferfish, count: 1 }],
    // pufferfish inflate state + contact damage near the player
    puffRadius: 3.0,
    puffDamage: 1,
    normalSize: 0.4,
    puffedSize: 0.9,
  },
};

export function isAquaticType(type) {
  return Object.prototype.hasOwnProperty.call(MOB_SPECS, type);
}

/** Mob at integer block (or float) position. */
export function createMob(type, x, y, z, rng = Math.random) {
  const spec = MOB_SPECS[type];
  if (!spec) throw new Error(`unknown aquatic mob type: ${type}`);
  return {
    type,
    x, y, z,
    vx: 0, vy: 0, vz: 0,
    health: spec.health,
    maxHealth: spec.health,
    age: 0,
    alive: true,
    // pufferfish: 0 = deflated, 1 = fully puffed (visible state)
    puff: 0,
    targetedBy: null, // trident that is targeting this mob (unused now)
    seed: rng(),
    // wander phase for natural-looking drift
    phase: rng() * Math.PI * 2,
  };
}

/** True when the mob is inside liquid (fish must stay in water to live). */
export function mobInWater(world, mob) {
  if (typeof world.isLiquid !== 'function') return false;
  const hx = mob.x, hy = mob.y + (MOB_SPECS[mob.type].size ? MOB_SPECS[mob.type].size[1] / 2 : 0.3);
  return world.isLiquid(Math.floor(hx), Math.floor(hy), Math.floor(mob.z));
}

/**
 * Swim behaviour for a passive aquatic mob. Returns an updated mob (mutates +
 * returns). Fish drift within water, bobbing; they despawn (sink + drop) if
 * stuck on land for too long. Pufferfish inflate when the player comes within
 * puffRadius and deal contact damage on touch.
 */
export function stepMob(mob, world, dt, playerPos = null) {
  const spec = MOB_SPECS[mob.type];
  mob.age += dt;
  const inWater = mobInWater(world, mob);

  // Fish on land: flop for a few seconds, then die (drop fish item).
  if (!inWater && spec.bucketable) {
    mob.seed += dt;
    if (mob.seed > 5) {
      mob.alive = false;
      return { mob, outOfWater: true };
    }
    // flop horizontally
    mob.x += Math.sin(mob.phase + mob.age * 6) * dt * 0.4;
    mob.z += Math.cos(mob.phase + mob.age * 7) * dt * 0.4;
    return { mob };
  }

  if (inWater) {
    // gentle wander within / just below the water column, dolphin swims faster
    const speed = spec.swimSpeed;
    const wander = Math.sin(mob.age * 0.6 + mob.phase);
    mob.vx = Math.cos(mob.phase + mob.age * 0.9) * speed * 0.3;
    mob.vz = Math.sin(mob.phase + mob.age * 0.8) * speed * 0.3;
    // vertical bob (dolphin surfaces more actively)
    mob.vy = (spec.name === 'dolphin' ? 0.6 : 0.25) * wander;
    mob.x += mob.vx * dt;
    mob.y += mob.vy * dt;
    mob.z += mob.vz * dt;
  } else {
    // dolphin out of water still "swims" but more slowly
    mob.x += Math.cos(mob.phase + mob.age) * dt * 0.2;
    mob.z += Math.sin(mob.phase + mob.age) * dt * 0.2;
  }

  // Pufferfish: inflate state depends on player distance (visible + damage).
  if (mob.type === 'pufferfish') {
    let near = false;
    if (playerPos) {
      const dx = playerPos.x - mob.x;
      const dy = playerPos.y - mob.y;
      const dz = playerPos.z - mob.z;
      near = Math.hypot(dx, dy, dz) <= spec.puffRadius;
    }
    mob.puff = near ? Math.min(1, mob.puff + dt * 2.5) : Math.max(0, mob.puff - dt * 3);
    if (mob.puff > 0.05 && playerPos) {
      mob.vy += dt * 2; // inflated fish rises a little (visible)
    }
  }

  return { mob };
}

/** Damage applied to the player on contact with a puffed pufferfish. */
export function pufferContactDamage(mob, playerPos, contactDist = 1.1) {
  if (mob.type !== 'pufferfish') return 0;
  if (mob.puff < 0.5) return 0; // only a fully (visibly) inflated fish harms
  const d = Math.hypot(playerPos.x - mob.x, playerPos.y - mob.y, playerPos.z - mob.z);
  if (d <= contactDist) return MOB_SPECS.pufferfish.puffDamage;
  return 0;
}

/** Apply damage to a mob; returns {mob, died, drops}. */
export function hurtMob(mob, damage) {
  if (!mob.alive) return { mob, died: false, drops: [] };
  mob.health -= damage;
  if (mob.health <= 0) {
    mob.health = 0;
    mob.alive = false;
    const spec = MOB_SPECS[mob.type];
    return { mob, died: true, drops: spec.drop || [] };
  }
  return { mob, died: false, drops: [] };
}

/**
 * Bucket capture: an empty bucket used on a bucketable fish captures it into a
 * "bucket of <fish>" item (removing the mob). Returns the new bucket item id,
 * or null when the mob isn't bucketable.
 */
export function captureWithBucket(mob) {
  const spec = MOB_SPECS[mob.type];
  if (!spec || !spec.bucketable || !mob.alive) return null;
  const bucketItem = FISH_BUCKET[mob.type];
  if (bucketItem == null) return null;
  mob.alive = false;
  return bucketItem;
}

/**
 * Release a fish from a "bucket of <fish>" into water at (x,y,z). Returns the
 * created mob (or null if the item isn't a fish bucket).
 */
export function releaseFromBucket(bucketItemId, x, y, z, rng = Math.random) {
  const type = BUCKET_TO_TYPE[bucketItemId];
  if (!type) return null;
  return createMob(type, x, y, z + 0.2, rng);
}

/** The fish item id dropped when a mob dies (for drops list). */
export function mobDropItem(type) {
  const drops = MOB_SPECS[type].drop;
  return drops && drops.length ? drops[0].itemId : null;
}

/**
 * Spawn `count` aquatic mobs within an area of the world, choosing water cells
 * (blocks whose cell is liquid) deterministically. Returns an array of mobs.
 * `rng` defaults to Math.random; pass a seeded rng for determinism.
 */
export function spawnMobs(world, xMin, xMax, yMin, yMax, zMin, zMax, count = 5, rng = Math.random) {
  const mobs = [];
  const cells = [];
  for (let x = xMin; x <= xMax; x += 1) {
    for (let y = yMin; y <= yMax; y += 1) {
      for (let z = zMin; z <= zMax; z += 1) {
        if (world.isLiquid(x, y, z)) cells.push([x, y, z]);
      }
    }
  }
  if (cells.length === 0) return mobs;
  for (let i = 0; i < count; i += 1) {
    const [cx, cy, cz] = cells[Math.floor(rng() * cells.length)];
    const type = ['cod', 'salmon', 'tropical_fish', 'pufferfish', 'dolphin'][Math.floor(rng() * 5)];
    mobs.push(createMob(type, cx + 0.5, cy + 0.4, cz + 0.5, rng));
  }
  return mobs;
}

/** Display name helper (for HUD). */
export function mobName(type) {
  const spec = MOB_SPECS[type];
  return spec ? spec.name : '?';
}
