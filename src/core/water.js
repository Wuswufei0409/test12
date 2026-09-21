// B5 water core mechanics (crit 14). Pure, headless-testable module.
//
// Covers: underwater visibility, oxygen bar + drowning, sprint-swim, 1x1
// waterway passability, buoyant drops, and correct water behaviour when
// placing/breaking blocks underwater (no erroneous air pockets).
//
// The `world` used throughout only needs isSolid(x,y,z) / isLiquid(x,y,z)
// (the WorldState / WorldGrid collider contract from CONTRACT.md §PlayerPhysics).
import { isLiquidBlock } from './physics.js';

export const AIR = {
  max: 15, // seconds of oxygen at full bar
  depletePerSec: 1.0, // underwater consumption
  regenPerSec: 6.0, // recovery while breathing
  panicBelow: 0.25,
};

export function createAir(maxAir = AIR.max) {
  return { air: maxAir, max: maxAir };
}

/**
 * True when the player's eye/head is inside water. `playerPos` = feet position,
 * `eyeOffset` = eye height (default standing eye height).
 */
export function headInWater(world, playerPos, eyeOffset = 1.62) {
  const x = Math.floor(playerPos.x);
  const y = Math.floor(playerPos.y + eyeOffset);
  const z = Math.floor(playerPos.z);
  return world.isLiquid(x, y, z);
}

/**
 * Advance the air meter by dt seconds. Returns { air, drowning } where
 * `drowning` is non-zero damage to apply this tick when the bar is empty.
 * Underwater depletes; in air regenerates.
 */
export function stepAir(airState, underwater, dt) {
  const s = airState;
  if (underwater) {
    s.air = Math.max(0, s.air - AIR.depletePerSec * dt);
  } else {
    s.air = Math.min(s.max, s.air + AIR.regenPerSec * dt);
  }
  let drowning = 0;
  if (underwater && s.air <= 0) drowning = 2 * dt; // 2 HP/s while drowning
  return { air: s.air, drowning };
}

/**
 * Drowning damage multiplier per difficulty (reuses DIFFICULTY shape but kept
 * local so the module is self-contained). Returns the scaled damage.
 */
export function drowningDamage(drowning, damageScale = 1) {
  return drowning * damageScale;
}

/**
 * Sprint-swim speed factor. When swimming and sprinting, the swim factor is
 * boosted beyond the normal swim factor for a faster "sprint-swim".
 */
export function sprintSwimFactor(isSwimming, sprinting, baseSwimFactor = 0.6) {
  if (!isSwimming) return 1;
  return sprinting ? baseSwimFactor * 1.7 : baseSwimFactor;
}

/**
 * Underwater visibility: returns an adjusted fog/visibility descriptor.
 * `fogDistanceMeters` is the clear-air draw distance; underwater it is
 * shortened (and tinted) to model poor underwater visibility.
 */
export function underwaterVisibility(distanceMeters, underwater) {
  if (!underwater) return { distance: distanceMeters, tint: [0.6, 0.8, 1.0], factor: 1 };
  return { distance: Math.min(distanceMeters, 24), tint: [0.29, 0.55, 0.85], factor: 0.4 };
}

/**
 * True when a 1-block-wide waterway is passable: the column above the given
 * water cell up to `height` metres has no solid obstructions (so the player
 * can swim through / pass a 1x1 water tunnel).
 */
export function waterwayClear(world, x, y, z, height = 1.8) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const yTop = Math.ceil(y + height - 1e-6);
  for (let by = Math.floor(y); by <= yTop; by += 1) {
    if (world.isSolid(x0, by, z0)) return false;
  }
  return true;
}

/**
 * Buoyant drop physics. When the drop sits in a liquid cell it floats upward
 * (reduced effective gravity, terminal velocity capped) instead of sinking,
 * until it reaches a non-liquid cell / the water surface. Reused by the drop
 * stepper so items dropped into water bob to the surface (buoyant drops).
 * @returns adjusted vertical velocity for the drop.
 */
export function buoyantVelocity(drop, world, dy, gravity = 9.8, dt = 1) {
  const x = Math.floor(drop.x);
  const z = Math.floor(drop.z);
  const inWater =
    typeof world.isLiquid === 'function' && world.isLiquid(x, Math.floor(drop.y), z);
  if (!inWater) return drop.vy - gravity * dt; // normal gravity in air
  // In water: velocity relaxes quickly toward a positive float speed, so a
  // fast-falling drop is arrested within a couple of ticks and bobs to the
  // surface (buoyant drop) instead of plunging to the sea floor.
  const floatSpeed = 0.6;
  return drop.vy + (floatSpeed - drop.vy) * 0.8;
}

/**
 * Block state transition when a block is broken. If the broken cell was inside
 * water (neighbouring water at the sides/above/below), the cell becomes water
 * (id 6) rather than air — preventing erroneous air pockets underwater.
 * @param cellWasUnderwater true when the block was immersed in water
 * @returns block id to place at the broken cell
 */
export function breakUnderwater(cellWasUnderwater, WATER_ID = 6) {
  return cellWasUnderwater ? WATER_ID : 0;
}

/**
 * True when the broken block cell is immersed in water (any axis neighbour is
 * liquid, or the cell itself is liquid-adjacent above). Used to decide whether
 * breaking should leave water behind.
 */
export function isUnderwaterCell(world, x, y, z) {
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [dx, dy, dz] of dirs) {
    if (world.isLiquid(x + dx, y + dy, z + dz)) return true;
  }
  return false;
}
