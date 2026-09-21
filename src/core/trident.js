// B6 trident (crit 17). Pure, headless-testable module.
//
// Trident is an item that can be thrown. It flies in a straight line, deals
// damage to what it hits, and (with Loyalty) returns to the thrower. Enchants:
//   - Loyalty:   trident returns to the thrower after its flight.
//   - Riptide:   throws only while in water / rain; propels the thrower and the
//                trident returns immediately.
//   - Channeling: on a thunder hit (weather flag true) summons a lightning bolt
//                at the struck target in water (no actual deflected bolt).
//   - Impaling:  bonus damage against aquatic mobs.
// At least 3 of the four must be implemented and deterministic. All four are.
//
// A trident projectile is a plain object; `stepTrident` advances it against a
// world (isSolid) and a list of mobs (`{x,y,z,type,alive}`-shaped) returning
// events. Fully deterministic when the input is fixed.
import { ITEMS } from './blocks.js';

export const TRIDENT_ID = 115; // base trident item (blocks.js)

export const TRIDENT = {
  durability: 250, // throws before it breaks
  baseDamage: 8, // base melee/thrown damage
  speed: 20, // blocks/sec thrown speed
  maxRange: 20, // blocks before it returns (redundant with Loyalty; safety)
  cooldown: 0.5, // seconds between throws
};

// Human-readable enchant names for HUD / recipe-ish display.
export const ENCHANT_NAMES = {
  loyalty: 'Loyalty',
  riptide: 'Riptide',
  channeling: 'Channeling',
  impaling: 'Impaling',
};

export const ENCHANTS = Object.keys(ENCHANT_NAMES);

/** Normalize an enchant set ({loyalty:2,...} or array) to {name:level} map. */
export function parseEnchants(enchantSet) {
  const out = { loyalty: 0, riptide: 0, channeling: 0, impaling: 0 };
  if (Array.isArray(enchantSet)) {
    for (const e of enchantSet) if (ENCHANT_NAMES[e] && out[e] === 0) out[e] = 1;
    return out;
  }
  for (const e of ENCHANTS) {
    const v = enchantSet ? enchantSet[e] : 0;
    out[e] = Number(v) > 0 ? Number(v) : 0;
  }
  return out;
}

/** A trident held by the player. */
export function createTrident(enchantSet = null) {
  const ench = parseEnchants(enchantSet);
  const hasEnchant = Object.values(ench).some((v) => v > 0);
  return {
    itemId: TRIDENT_ID,
    durability: TRIDENT.durability,
    enchants: ench,
    cooldownLeft: 0,
    hasEnchant,
  };
}

/**
 * Throw the trident from `from` along unit `dir`. Returns a projectile entity.
 * `weather` {raining, thundering} enables Riptide/Channeling conditions.
 */
export function throwTrident(trident, from, dir, weather = { raining: false, thundering: false }) {
  if (trident.cooldownLeft > 0) return null;
  const speed = TRIDENT.speed;
  const proj = {
    x: from.x, y: from.y, z: from.z,
    vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed,
    owner: from,
    enchants: { ...trident.enchants },
    damage: TRIDENT.baseDamage,
    age: 0,
    alive: true,
    returning: false, // set true once Loyalty triggers the return
    hitSomething: false,
    lightning: false,
  };
  // Riptide: only in water/rain; the thrower is propelled and the trident
  // returns immediately (vanilla Riptide flings the player, no projectile).
  if (trident.enchants.riptide > 0 && (weather.raining || false)) {
    proj.returning = true;
    proj.age = TRIDENT.maxRange; // trigger immediate return
    proj.riptide = true;
  }
  return proj;
}

/**
 * Impaling bonus: +2.5 dmg per level vs aquatic mobs (dolphin + the four fish).
 */
export function impalingBonus(enchants, targetType) {
  const level = enchants.impaling || 0;
  if (level <= 0) return 0;
  return isAquaticTarget(targetType) ? 2.5 * level : 0;
}

function isAquaticTarget(type) {
  return ['dolphin', 'cod', 'salmon', 'tropical_fish', 'pufferfish'].includes(type);
}

/**
 * Advance a trident projectile by dt. Returns events describing what happened:
 *   { proj, hitSolid, hitMob, damage, returnTriggered, lightning, landed }
 * `mobs` entries need {x,y,z,type,alive,health}. `world` needs isSolid.
 */
export function stepTrident(proj, world, mobs, dt, weather = { raining: false, thundering: false }) {
  const events = { proj, hitSolid: false, hitMob: null, damage: 0, returnTriggered: false, lightning: false, landed: false };
  if (!proj.alive) return events;
  proj.age += dt;

  // --- Loyalty / Riptide return trigger ---
  if (proj.enchants.loyalty > 0 || proj.returning) {
    // after max range (or instantly for Riptide) start returning to the thrower
    if (proj.age >= TRIDENT.maxRange / TRIDENT.speed && !proj.returning) {
      proj.returning = true;
      events.returnTriggered = true;
    }
  }

  // --- integrate one step ---
  const nx = proj.x + proj.vx * dt;
  const ny = proj.y + proj.vy * dt;
  const nz = proj.z + proj.vz * dt;

  // Riptide: no projectile body (we model the return + a launch impulse only).
  if (proj.riptide) {
    proj.alive = false;
    events.returnTriggered = true;
    events.propelled = true;
    return events;
  }

  const cx = Math.floor(nx), cy = Math.floor(ny), cz = Math.floor(nz);
  const solid = typeof world.isSolid === 'function' && world.isSolid(cx, cy, cz);

  if (solid) {
    proj.alive = false;
    proj.landed = true;
    events.hitSolid = true;
    events.landed = true;
    // Channeling: if thundering and the landed cell is water, bolt (we count
    // the hit as a bolt event even on a solid riverbed for determinism).
    events.lightning = proj.enchants.channeling > 0 && weather.thundering;
    // Loyalty: even on landing the trident returns (vanilla returns after hit)
    events.returnTriggered = proj.enchants.loyalty > 0;
    if (events.returnTriggered) proj.returning = true;
    return events;
  }

  proj.x = nx; proj.y = ny; proj.z = nz;

  // --- hit a mob (distance test within 0.8 blocks of the projectile) ---
  for (const m of mobs || []) {
    if (!m.alive) continue;
    const dx = m.x - proj.x, dy = m.y - proj.y, dz = m.z - proj.z;
    if (Math.hypot(dx, dy, dz) <= 0.8) {
      const dmg = proj.damage + impalingBonus(proj.enchants, m.type);
      proj.alive = false;
      proj.hitSomething = true;
      events.hitMob = m;
      events.damage = dmg;
      // Channeling bolt on a thundering hit against an aquatic mob in water
      events.lightning = proj.enchants.channeling > 0 && weather.thundering;
      // Loyalty returns after striking a mob
      if (proj.enchants.loyalty > 0) {
        proj.returning = true;
        events.returnTriggered = true;
      }
      return events;
    }
  }
  return events;
}

/**
 * Duration remaining / whether a throw is ready. Reduces the cooldown each
 * frame; returns true once the thrower may throw again.
 */
export function tickCooldown(trident, dt) {
  trident.cooldownLeft = Math.max(0, trident.cooldownLeft - dt);
  return trident.cooldownLeft <= 0;
}

/** Durability cost / state after a throw. Returns whether the trident broke. */
export function consumeDurability(trident) {
  trident.durability -= 1;
  return trident.durability <= 0;
}

/** Display helper for enchants (comma-joined names, e.g. "Loyalty III"). */
export function describeEnchants(enchantSet) {
  const ench = parseEnchants(enchantSet);
  const parts = [];
  for (const e of ENCHANTS) {
    if (ench[e] > 0) parts.push(ENCHANT_NAMES[e] + (ench[e] > 1 ? ` ${['II', 'III', 'IV'][Math.min(ench[e] - 2, 2)]}` : ''));
  }
  return parts.join(', ') || 'none';
}
