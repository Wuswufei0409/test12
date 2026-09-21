// Item drop entities + the block->item drop table. Pure module.
//
// Breaking a block spawns a physics drop at its position; the player picks it
// up into the hotbar by walking near it. `dropForBlock` maps a mined block to
// the item that drops so most blocks flow mine -> inventory -> place.
import { getBlockById, BLOCKS, ITEMS } from './blocks.js';
import { PLAYER } from './physics.js';

const bid = (name) => {
  const b = BLOCKS[name];
  return b ? b.id : null;
};
const iid = (name) => {
  const i = ITEMS[name];
  return i ? i.id : null;
};

// Special drop mappings (block id -> item id). Blocks left out of this map
// drop themselves (their own placeable block id), enabling the closed loop.
const SPECIAL_DROPS = {
  // grass breaks to dirt (like vanilla) — still placeable.
  [bid('grass')]: bid('dirt'),
  [bid('leaves')]: null, // nothing (Phase A has no saplings) — silky touch later
  [bid('coal_ore')]: iid('coal'),
  [bid('iron_ore')]: iid('iron_ingot'),
  [bid('diamond_ore')]: null, // decorative in Phase A
};

/**
 * Item id dropped when a block breaks. Returns null for no-drop blocks
 * (unbreakable, liquids, non-solid plants, or explicit null mappings).
 */
export function dropForBlock(blockId) {
  const b = getBlockById(blockId);
  if (!b || b.id === 0) return null;
  if (Object.prototype.hasOwnProperty.call(SPECIAL_DROPS, blockId)) {
    return SPECIAL_DROPS[blockId];
  }
  if (!b.solid || b.liquid || b.hardness == null || b.hardness < 0 || b.unbreakable) return null;
  return b.id; // drop itself (placeable block) — the core mine->place loop
}

const GRAVITY = 9.8; // m/s^2
const RESTITUTION = 0.45;
const PICKUP_MARGIN = 0.25; // expand the player box by this when picking up
const MAX_AGE = 180; // seconds before despawning

/**
 * Spawn a drop entity at a block position (jittered, with up-hop).
 * @returns drop entity (plain object, mutable).
 */
export function createDrop(x, y, z, itemId, count = 1) {
  return {
    x: x + 0.5,
    y: y + 0.5,
    z: z + 0.5,
    vx: (Math.random() - 0.5) * 2,
    vy: 0.35,
    vz: (Math.random() - 0.5) * 2,
    itemId,
    count,
    age: 0,
    alive: true,
  };
}

/**
 * Advance drop physics one timestep. `world` needs isSolid(x,y,z). Drops fall,
 * rest on solid ground, and age out. Returns the drop (alive may flip false).
 */
export function stepDrop(drop, world, dt) {
  drop.age += dt;
  if (drop.age > MAX_AGE) {
    drop.alive = false;
    return drop;
  }

  // gravity + integrate horizontal
  drop.vy -= GRAVITY * dt;
  const nx = drop.x + drop.vx * dt;
  const ny = drop.y + drop.vy * dt;
  const nz = drop.z + drop.vz * dt;

  let grounded = false;
  // Horizontal collision (simple): bounce off solid, else allow.
  if (world.isSolid(Math.floor(drop.x), Math.floor(drop.y), Math.floor(nz)) && Math.abs(drop.vz) > 0.05) {
    drop.vz *= -RESTITUTION;
  } else {
    drop.z = nz;
  }
  if (world.isSolid(Math.floor(nx), Math.floor(drop.y), Math.floor(drop.z)) && Math.abs(drop.vx) > 0.05) {
    drop.vx *= -RESTITUTION;
  } else {
    drop.x = nx;
  }
  // Vertical: fall until resting on the top of the solid cell below.
  if (world.isSolid(Math.floor(drop.x), Math.floor(ny - 0.2), Math.floor(drop.z))) {
    drop.vy = 0;
    drop.y = Math.floor(ny - 0.2) + 1.0; // rest on the surface of the cell below
    grounded = true;
  } else {
    drop.y = ny;
    if (drop.y < -64) drop.alive = false;
  }

  if (grounded) {
    // friction on the ground so hopped items settle quickly
    drop.vx *= 0.8;
    drop.vz *= 0.8;
    if (Math.abs(drop.vx) < 0.01) drop.vx = 0;
    if (Math.abs(drop.vz) < 0.01) drop.vz = 0;
  }
  return drop;
}

/**
 * True when the drop overlaps the player's AABB (expanded by a small pickup
 * margin), i.e. the player can walk over / touch it to collect.
 * `playerPos` = {x,y,z} feet position.
 */
export function canPickup(drop, playerPos) {
  const hx = PLAYER.width / 2 + PICKUP_MARGIN;
  const y0 = playerPos.y - PICKUP_MARGIN;
  const y1 = playerPos.y + PLAYER.height + PICKUP_MARGIN;
  return (
    Math.abs(drop.x - playerPos.x) <= hx &&
    Math.abs(drop.z - playerPos.z) <= hx &&
    drop.y >= y0 &&
    drop.y <= y1
  );
}
