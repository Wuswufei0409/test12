// Land mobs (crit 11): pig/cow/sheep/chicken (passive), zombie/spider/creeper
// (hostile). Pure, headless-testable module. Behaviours: spawn, wander-or-
// chase, attack-or-flee, hurt, death, configured drops; creeper explosion
// modifies the world via the WorldState edit overlay.
//
// A mob is a plain mutable object:
//   { type, id, x,y,z (feet float), vy, health, maxHealth, alive,
//     passive, aggro, hurtTicks, attackCooldown, fuse (creep), ... }
import { PLAYER } from './physics.js';
import { BLOCKS, ITEMS } from './blocks.js';

// name -> item id for drop resolution (blocks drop as themselves too).
const NAME_TO_ID = {};
for (const k of Object.keys(BLOCKS)) NAME_TO_ID[k] = BLOCKS[k].id;
for (const k of Object.keys(ITEMS)) NAME_TO_ID[k] = ITEMS[k].id;

const GRAVITY = 20; // m/s^2 (block units / s^2)
const GROUND_MARGIN = 0.05;

export const MOBS = {
  pig:    { name: 'pig',    passive: true,  health: 10, speed: 1.6, color: 0xe8a0a0, drops: ['raw_porkchop'], fuse: 0 },
  cow:    { name: 'cow',    passive: true,  health: 10, speed: 1.4, color: 0x8a6642, drops: ['raw_beef', 'leather'], fuse: 0 },
  sheep:  { name: 'sheep',  passive: true,  health: 8,  speed: 1.5, color: 0xe6e6e6, drops: ['wool'], fuse: 0 },
  chicken:{ name: 'chicken',passive: true,  health: 4,  speed: 1.2, color: 0xe0d8c8, drops: ['raw_chicken'], fuse: 0 },
  zombie: { name: 'zombie', passive: false, health: 20, speed: 1.4, color: 0x4a8a3c, damage: 3, drops: ['rotten_flesh'], fuse: 0 },
  spider: { name: 'spider', passive: false, health: 16, speed: 1.8, color: 0x3a3a3a, damage: 2, drops: ['string'], fuse: 0 },
  creeper:{ name: 'creeper',passive: false, health: 20, speed: 1.3, color: 0x4a9a3c, fuse: 30, drops: ['gunpowder'] },
};

export const MOB_RADIUS = 0.3; // half-width of a mob box
export const MOB_HEIGHT = 0.9;

let nextId = 1;

export function createMob(type, x, y, z) {
  const cfg = MOBS[type];
  if (!cfg) throw new Error(`unknown mob type '${type}'`);
  return {
    type,
    id: nextId++,
    x, y, z,                 // feet position (mob is a box of MOB_RADIUS up + MOB_HEIGHT tall)
    vy: 0,
    vx: 0, vz: 0,
    health: cfg.health,
    maxHealth: cfg.health,
    alive: true,
    passive: cfg.passive,
    aggro: false,
    hurtTicks: 0,
    attackCooldown: 0,
    fuse: 0,                 // creeper fuse progress (ticks), 0 = idle
    wanderTimer: 0,
    wanderDir: { x: 1, z: 0 },
    speed: cfg.speed,
  };
}

function blockAt(world, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  if (by < 0 || by >= 4000) return 1; // treat below/above world as solid floor
  return world.get(bx, by, bz);
}
function solidAt(world, x, y, z) { return world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z)); }

function onGround(world, mob) {
  return solidAt(world, mob.x - MOB_RADIUS, mob.y - GROUND_MARGIN, mob.z) ||
         solidAt(world, mob.x + MOB_RADIUS, mob.y - GROUND_MARGIN, mob.z) ||
         solidAt(world, mob.x, mob.y - GROUND_MARGIN, mob.z);
}

/**
 * Advance one mob one tick (dt in ticks, ~1). Returns events:
 *   { attack: {target:'player', damage} } when a hostile lands a melee hit
 *   { explode: {x,y,z,radius} } when a creeper detonates (caller carves world)
 * Gravity + crude ground clamp keeps mobs roughly on the terrain.
 */
export function stepMob(mob, world, player, dt = 1, difficulty = 'normal') {
  const cfg = MOBS[mob.type];
  const events = [];

  if (!mob.alive) return events;
  if (mob.hurtTicks > 0) mob.hurtTicks -= dt;
  if (mob.attackCooldown > 0) mob.attackCooldown -= dt;

  const dx = player.pos.x - mob.x;
  const dz = player.pos.z - mob.z;
  const horiz = Math.hypot(dx, dz);
  const dist = Math.hypot(horiz, (player.pos.y) - mob.y);

  // --- aggro logic ---
  const nightAggro = cfg.fuse > 0; // creeper; hostiles aggro regardless of time here
  if (!mob.passive) {
    if (mob.hurtTicks > 0 || horiz < 14) mob.aggro = true;
    if (horiz > 30) mob.aggro = false;
  }

  // --- pick movement direction ---
  let dirX = 0, dirZ = 0;
  if (mob.passive) {
    if (mob.hurtTicks > 0) {
      // flee from player (attack-or-flee)
      dirX = -dx / (horiz || 1);
      dirZ = -dz / (horiz || 1);
    } else {
      // wander: pick a new random direction periodically
      mob.wanderTimer -= dt;
      if (mob.wanderTimer <= 0) {
        mob.wanderTimer = 60 + Math.random() * 80;
        const a = Math.random() * Math.PI * 2;
        mob.wanderDir = { x: Math.cos(a), z: Math.sin(a) };
      }
      dirX = mob.wanderDir.x;
      dirZ = mob.wanderDir.z;
    }
  } else if (mob.aggro && player.alive) {
    dirX = dx / (horiz || 1);
    dirZ = dz / (horiz || 1);
  } else {
    mob.wanderTimer -= dt;
    if (mob.wanderTimer <= 0) {
      mob.wanderTimer = 60 + Math.random() * 80;
      const a = Math.random() * Math.PI * 2;
      mob.wanderDir = { x: Math.cos(a), z: Math.sin(a) };
    }
    dirX = mob.wanderDir.x;
    dirZ = mob.wanderDir.z;
  }

  // --- integrate movement (simple axis move with collision) ---
  const mv = mob.speed * dt * 0.05; // block-units per tick
  const stepAxis = (d) => {
    if (d === 0) return;
    let nx = mob.x + d;
    if (solidAt(world, nx, mob.y, mob.z) && !solidAt(world, nx, mob.y + 1, mob.z)) {
      // step up one block (like player step-up); else blocked
      if (!solidAt(world, nx, mob.y + 1.5, mob.z)) { mob.y += 1; }
    }
    if (!solidAt(world, nx + Math.sign(d) * MOB_RADIUS, mob.y + 0.2, mob.z) &&
        !solidAt(world, nx + Math.sign(d) * MOB_RADIUS, mob.y + MOB_HEIGHT - 0.2, mob.z)) {
      mob.x = nx;
    }
  };
  stepAxis(dirX * mv);
  stepAxis(dirZ * mv);

  // --- gravity + ground clamp ---
  if (onGround(world, mob)) {
    mob.vy = 0;
  } else {
    mob.vy -= GRAVITY * dt * 0.05;
    const ny = mob.y + mob.vy;
    if (!solidAt(world, mob.x, ny, mob.z)) mob.y = ny;
  }
  if (mob.y < -20) { mob.alive = false; return events; }

  // --- attacks ---
  if (!mob.passive && mob.aggro && player.alive) {
    // creeper fuses and detonates in melee range
    if (cfg.fuse > 0) {
      if (dist < 2.0) {
        mob.fuse += dt;
        if (mob.fuse >= cfg.fuse) {
          events.push({ explode: { x: mob.x, y: mob.y, z: mob.z, radius: 3 } });
          mob.alive = false;
          return events;
        }
      } else {
        mob.fuse = Math.max(0, mob.fuse - dt * 2);
      }
    } else if (dist < 1.8 && mob.attackCooldown <= 0) {
      mob.attackCooldown = 20;
      const dmg = difficulty === 'peaceful' ? 0 : cfg.damage * (difficulty === 'easy' ? 0.5 : 1);
      events.push({ attack: { target: 'player', damage: dmg } });
    }
  }

  return events;
}

/**
 * Damage a mob. `knockback` is {x,z} impulse in world space. Returns
 * { killed, damage } — dropped items are separate (mobDrops).
 */
export function damageMob(mob, amount, knockback = { x: 0, z: 0 }) {
  if (!mob.alive) return { killed: false, damage: 0 };
  const dealt = Math.min(mob.health, amount);
  mob.health -= amount;
  mob.hurtTicks = 8;
  if (!mob.passive) mob.aggro = true;
  mob.vx = knockback.x;
  mob.vz = knockback.z;
  mob.x += knockback.x * 0.25;
  mob.z += knockback.z * 0.25;
  if (mob.health <= 0) {
    mob.health = 0;
    mob.alive = false;
    return { killed: true, damage: dealt };
  }
  return { killed: false, damage: dealt };
}

/**
 * Configured item drops for a dead mob: returns array of {id, count}.
 * Hostile mobs may drop 0-1 of their drop (chance 1/8); passive drop 1.
 */
export function mobDrops(mob) {
  const cfg = MOBS[mob.type];
  const out = [];
  for (const name of cfg.drops || []) {
    if (mob.passive || Math.random() < 0.125) {
      const id = NAME_TO_ID[name];
      if (id !== undefined) out.push({ id, count: 1 });
    }
  }
  return out;
}

/** Ground-truth height at (x,z): the highest surface y the mob stands on. */
export function groundHeight(world, x, z) {
  for (let hy = 62; hy >= 0; hy -= 1) {
    if (world.isSolid(Math.floor(x), hy, Math.floor(z))) return hy + 1;
  }
  return 0;
}
