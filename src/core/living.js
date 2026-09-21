// Survival stats: health, hunger, saturation, damage, food, drowning,
// starvation, regeneration. Pure module, headless-testable.
//
// Difficulty gates hostile damage via the CONTRACT DIFFICULTY table
// (peaceful/easy/normal). Environmental damage (fall, drown, starve) is always
// real, matching how peaceful still deals fall damage in Minecraft.
import { DIFFICULTY } from './world.js';
import { ITEMS } from './blocks.js';

export const LIVING = {
  maxHealth: 20,
  maxHunger: 20,
  maxSaturation: 5,
  maxAir: 10, // seconds of oxygen underwater
  hungerDrainSeconds: 30, // 1 hunger point per 30 sim-seconds
  regenHungerThreshold: 18, // regenerate only when hunger >= this
  regenEverySeconds: 4, // heal 1 HP per 4s while satiated
  starvationEverySeconds: 4, // take 1 dmg per 4s while starving
  drownEverySeconds: 1, // 1 dmg per second with no air
  fallDamageThreshold: 3, // falling >3 blocks starts hurting
};

export function createLiving() {
  return {
    health: LIVING.maxHealth,
    maxHealth: LIVING.maxHealth,
    hunger: LIVING.maxHunger,
    maxHunger: LIVING.maxHunger,
    saturation: LIVING.maxSaturation,
    maxSaturation: LIVING.maxSaturation,
    alive: true,
    deaths: 0,
    air: LIVING.maxAir,
    maxAir: LIVING.maxAir,
    fallDistance: 0,
    drownTicks: 0,
    regenTimer: 0,
    starvationTimer: 0,
    drownTimer: 0,
  };
}

export function difficultyOf(name) {
  return DIFFICULTY[name] || DIFFICULTY.normal;
}

/**
 * Apply damage; returns the actual HP removed.
 * type 'hostile' is scaled by difficulty (peaceful → 0); 'environment' is full.
 */
export function applyDamage(living, amount, opts = {}) {
  if (!living.alive) return 0;
  const { type = 'environment', difficulty = 'normal' } = opts;
  let dmg = amount;
  if (type === 'hostile') {
    dmg = amount * difficultyOf(difficulty).damageScale;
  }
  living.health = Math.max(0, living.health - dmg);
  if (living.health <= 0) {
    living.health = 0;
    living.alive = false;
  }
  return dmg;
}

export function heal(living, amount) {
  if (!living.alive) return 0;
  const absorbed = Math.min(living.maxHealth - living.health, amount);
  living.health += absorbed;
  return absorbed;
}

/** Hunger points a food item restores (0 = not food / not edible now). */
export function foodValue(id) {
  const it = Object.values(ITEMS).find((x) => x.id === id);
  return it && typeof it.food === 'number' ? it.food : 0;
}

/**
 * Eat the inventory's selected slot if it is food and the living is hungry.
 * Consumes one item and restores hunger/saturation. Returns the consumed id or
 * 0 when nothing was eaten.
 */
export function eatSelected(living, inventory) {
  if (!living.alive || living.hunger >= living.maxHunger) return 0;
  const id = inventory.selectedStack().id;
  const value = foodValue(id);
  if (value <= 0) return 0;
  const take = inventory.takeSelected(1);
  if (take === 0) return 0;
  living.saturation = Math.min(living.maxSaturation, living.saturation + value);
  living.hunger = Math.min(living.maxHunger, living.hunger + value);
  return id;
}

/**
 * Metabolic tick. `dtSeconds` is the sim time since last call; `underwater`
 * tells whether the head is submerged. Advances hunger drain, regeneration,
 * starvation and drowning, and returns a list of damage events
 * [{amount, cause, type}] for the caller to apply at the end of the frame.
 */
export function tickMetabolism(living, dtSeconds, opts = {}) {
  const events = [];
  if (!living.alive) return events;
  const difficulty = opts.difficulty || 'normal';
  const underwater = !!opts.underwater;

  // --- hunger drain (saturation first) ---
  const drain = dtSeconds / LIVING.hungerDrainSeconds;
  living.saturation = Math.max(0, living.saturation - drain);
  if (living.saturation <= 0) living.hunger = Math.max(0, living.hunger - drain);

  // --- regeneration while well-fed ---
  if (living.hunger >= LIVING.regenHungerThreshold && living.health < living.maxHealth) {
    living.regenTimer += dtSeconds;
    if (living.regenTimer >= LIVING.regenEverySeconds) {
      living.regenTimer = 0;
      heal(living, 1);
    }
  } else {
    living.regenTimer = 0;
  }

  // --- starvation ---
  if (living.hunger <= 0) {
    living.starvationTimer += dtSeconds;
    if (living.starvationTimer >= LIVING.starvationEverySeconds) {
      living.starvationTimer = 0;
      events.push({ amount: 1, cause: 'starvation', type: 'environment' });
    }
  } else {
    living.starvationTimer = 0;
  }

  // --- drowning / oxygen ---
  if (underwater) {
    living.air = Math.max(0, living.air - dtSeconds);
    if (living.air <= 0) {
      living.drownTimer += dtSeconds;
      if (living.drownTimer >= LIVING.drownEverySeconds) {
        living.drownTimer = 0;
        events.push({ amount: 1, cause: 'drowning', type: 'environment' });
      }
    }
  } else {
    living.air = Math.min(LIVING.maxAir, living.air + dtSeconds * 2);
    living.drownTimer = 0;
  }

  return events;
}

/**
 * Fall damage: accumIP tallest fall in meters. Called each tick with the
 * player's downward speed / fallen distance; returns HP to remove once the
 * player lands. `fallDistance` accumulates upward while airborne and resets on
 * landing.
 */
export function trackFall(living, dtSeconds, { airborne, fallingSpeed }) {
  if (airborne) {
    living.fallDistance += Math.abs(fallingSpeed) * dtSeconds;
    return 0;
  }
  const dist = living.fallDistance;
  living.fallDistance = 0;
  if (dist > LIVING.fallDamageThreshold) {
    const dmg = Math.floor(dist - LIVING.fallDamageThreshold);
    return applyDamage(living, dmg, { type: 'environment' });
  }
  return 0;
}
