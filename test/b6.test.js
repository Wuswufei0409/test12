// B6 (MUL-102) headless tests — crit 16 aquatic mobs + crit 17 trident.
import { describe, it, expect } from 'vitest';
import { BLOCKS, ITEMS } from '../src/core/blocks.js';
import { WorldGrid } from '../src/core/worldgrid.js';
import { WorldState } from '../src/core/worldstate.js';
import { WORLD } from '../src/core/world.js';
import { seededRandom } from '../src/core/rng.js';
import {
  MOB_SPECS, FISH_ITEM, FISH_BUCKET, WATER_BUCKET, EMPTY_BUCKET,
  createMob, stepMob, mobInWater, captureWithBucket, releaseFromBucket,
  hurtMob, pufferContactDamage, spawnMobs, mobName, isAquaticType,
} from '../src/core/aquatic.js';
import {
  TRIDENT, TRIDENT_ID, ENCHANTS, ENCHANT_NAMES,
  createTrident, throwTrident, stepTrident, tickCooldown, consumeDurability,
  impalingBonus, describeEnchants, parseEnchants,
} from '../src/core/trident.js';

const WATER = BLOCKS.water.id;
const AIR = 0;

// ---------- helper water grid ----------
function waterWorld() {
  const w = new WorldGrid();
  // a small ocean pool between y=1..4, solid floor at y=0
  for (let y = 1; y <= 4; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      for (let z = 0; z < 6; z += 1) w.set(x, y, z, WATER);
    }
  }
  for (let x = 0; x < 6; x += 1) for (let z = 0; z < 6; z += 1) w.set(x, 0, z, BLOCKS.stone.id);
  return w;
}

describe('crit 16 · aquatic mob registry & spawn', () => {
  it('registers all five aquatic mobs and their items', () => {
    expect(Object.keys(MOB_SPECS).sort()).toEqual([
      'cod', 'dolphin', 'pufferfish', 'salmon', 'tropical_fish',
    ]);
    expect(isAquaticType('cod')).toBe(true);
    expect(isAquaticType('zombie')).toBe(false);
    expect(FISH_ITEM.cod).toBe(220);
    expect(FISH_ITEM.salmon).toBe(221);
    expect(FISH_ITEM.tropical_fish).toBe(222);
    expect(FISH_ITEM.pufferfish).toBe(223);
    expect(FISH_BUCKET.cod).toBe(225);
    expect(FISH_BUCKET.salmon).toBe(226);
    expect(FISH_BUCKET.tropical_fish).toBe(227);
    expect(FISH_BUCKET.pufferfish).toBe(228);
    expect(WATER_BUCKET).toBe(224);
  });

  it('spawns mobs deterministically in a water body', () => {
    const w = waterWorld();
    const rng = seededRandom(42);
    const mobs = spawnMobs(w, 0, 5, 1, 4, 0, 5, 6, rng);
    expect(mobs.length).toBe(6);
    for (const m of mobs) expect(mobInWater(w, m)).toBe(true);
    // same seed repeats
    const rng2 = seededRandom(42);
    const mobs2 = spawnMobs(w, 0, 5, 1, 4, 0, 5, 6, rng2);
    expect(mobs.map((m) => [m.type, Math.round(m.x), Math.round(m.y)])).toEqual(
      mobs2.map((m) => [m.type, Math.round(m.x), Math.round(m.y)]),
    );
  });

  it('mobName helper returns human names', () => {
    expect(mobName('pufferfish')).toBe('pufferfish');
    expect(mobName('nope')).toBe('?');
  });
});

describe('crit 16 · swim behaviour & dolphin', () => {
  it('a fish swims within water and stays in the pool', () => {
    const w = waterWorld();
    const mob = createMob('cod', 2.5, 2.5, 2.5, seededRandom(1));
    const startX = mob.x;
    stepMob(mob, w, 0.1); // no player
    expect(mobInWater(w, mob)).toBe(true);
    // it moved (wander) but bounded reasonably
    expect(Math.abs(mob.x - startX)).toBeLessThan(1);
  });

  it('a fish out of water flops, then dies after ~5s', () => {
    const w = waterWorld();
    const mob = createMob('cod', 2.5, 10, 2.5, seededRandom(2)); // high up in air
    let outOfWater = false;
    for (let i = 0; i < 60; i += 1) {
      const r = stepMob(mob, w, 0.1);
      if (r.outOfWater) outOfWater = true;
      if (!mob.alive) break;
    }
    expect(mob.alive).toBe(false);
    expect(outOfWater).toBe(true);
  });

  it('dolphin is registered as a swimmer with faster speed', () => {
    expect(MOB_SPECS.dolphin.swimSpeed).toBeGreaterThan(MOB_SPECS.cod.swimSpeed);
    expect(MOB_SPECS.dolphin.bucketable).toBe(false);
  });
});

describe('crit 16 · pufferfish state & contact damage', () => {
  it('pufferfish inflates near the player and deals contact damage when puffed', () => {
    const w = waterWorld();
    const mob = createMob('pufferfish', 2.5, 2.5, 2.5, seededRandom(3));
    const player = { x: 2.5, y: 2.5, z: 2.3 };
    // step several ticks with the player near -> puff grows
    for (let i = 0; i < 30; i += 1) stepMob(mob, w, 0.05, player);
    expect(mob.puff).toBeGreaterThan(0.5); // visibly inflated
    expect(pufferContactDamage(mob, player, 1.2)).toBe(MOB_SPECS.pufferfish.puffDamage);
  });

  it('pufferfish deflates when the player moves away (no damage)', () => {
    const w = waterWorld();
    const mob = createMob('pufferfish', 2.5, 2.5, 2.5, seededRandom(4));
    const close = { x: 2.5, y: 2.5, z: 2.3 };
    for (let i = 0; i < 30; i += 1) stepMob(mob, w, 0.05, close);
    expect(mob.puff).toBeGreaterThan(0.5);
    const far = { x: 20, y: 20, z: 20 };
    for (let i = 0; i < 60; i += 1) stepMob(mob, w, 0.05, far);
    expect(mob.puff).toBeLessThan(0.5);
    expect(pufferContactDamage(mob, far, 1.2)).toBe(0);
  });
});

describe('crit 16 · hurt & drops', () => {
  it('a fish drops its item when killed', () => {
    const mob = createMob('salmon', 0, 0, 0, seededRandom(5));
    const r = hurtMob(mob, 99);
    expect(r.died).toBe(true);
    expect(r.drops).toEqual([{ itemId: FISH_ITEM.salmon, count: 1 }]);
  });

  it('partial damage does not kill', () => {
    const mob = createMob('cod', 0, 0, 0, seededRandom(6));
    const r = hurtMob(mob, 1);
    expect(r.died).toBe(false);
    expect(mob.health).toBe(MOB_SPECS.cod.health - 1);
  });
});

describe('crit 16 · bucket capture/release', () => {
  it('an empty bucket captures a bucketable fish into a fish bucket', () => {
    const mob = createMob('cod', 0, 2, 0, seededRandom(7));
    const bucketItem = captureWithBucket(mob);
    expect(bucketItem).toBe(FISH_BUCKET.cod);
    expect(mob.alive).toBe(false);
  });

  it('releasing a fish bucket spawns the fish back in water', () => {
    const rng = seededRandom(8);
    const mob = releaseFromBucket(FISH_BUCKET.tropical_fish, 2.0, 2.0, 2.0, rng);
    expect(mob).not.toBeNull();
    expect(mob.type).toBe('tropical_fish');
    expect(mob.alive).toBe(true);
    expect(MOB_SPECS[mob.type].bucketable).toBe(true);
  });

  it('dolphin (and non-bucketable) cannot be captured', () => {
    const mob = createMob('dolphin', 0, 2, 0, seededRandom(9));
    expect(captureWithBucket(mob)).toBeNull();
    expect(mob.alive).toBe(true);
  });

  it('releasing a non-fish-bucket item returns null', () => {
    expect(releaseFromBucket(WATER_BUCKET, 0, 0, 0)).toBeNull();
    expect(releaseFromBucket(EMPTY_BUCKET, 0, 0, 0)).toBeNull();
  });
});

describe('crit 17 · trident throw & flight', () => {
  it('throwTrident launches along a direction at base speed', () => {
    const t = createTrident();
    const proj = throwTrident(t, { x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(proj).not.toBeNull();
    expect(proj.vz).toBe(TRIDENT.speed);
    expect(proj.damage).toBe(TRIDENT.baseDamage);
    expect(proj.alive).toBe(true);
  });

  it('cooldown blocks rapid rethrows', () => {
    const t = createTrident();
    expect(t.cooldownLeft).toBe(0);
    t.cooldownLeft = 0.3;
    expect(tickCooldown(t, 0.1)).toBe(false);
    expect(tickCooldown(t, 0.3)).toBe(true);
  });

  it('durability decrements and breaks at zero', () => {
    const t = createTrident();
    const start = t.durability;
    expect(consumeDurability(t)).toBe(false);
    expect(t.durability).toBe(start - 1);
    t.durability = 1;
    expect(consumeDurability(t)).toBe(true);
  });

  it('a trident stops on a solid block', () => {
    const w = new WorldGrid();
    w.set(5, 2, 0, BLOCKS.stone.id);
    const t = createTrident();
    const proj = throwTrident(t, { x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 });
    // fly many small steps until it lands
    let landed = false;
    for (let i = 0; i < 200 && !landed; i += 1) {
      const e = stepTrident(proj, w, [], 0.05);
      if (e.landed || e.hitSolid) { landed = true; expect(e.hitSolid).toBe(true); }
    }
    expect(landed).toBe(true);
  });

  it('a trident hits a mob and deals base damage', () => {
    const w = waterWorld();
    const mob = createMob('cod', 3.0, 2.5, 0, seededRandom(10));
    const t = createTrident();
    const proj = throwTrident(t, { x: 0, y: 2.5, z: 0 }, { x: 1, y: 0, z: 0 });
    let hit = null;
    for (let i = 0; i < 200 && !hit; i += 1) {
      const e = stepTrident(proj, w, [mob], 0.05);
      if (e.hitMob) hit = e;
    }
    expect(hit).not.toBeNull();
    expect(hit.damage).toBe(TRIDENT.baseDamage); // no impaling on un-enchanted
  });
});

describe('crit 17 · enchantments', () => {
  it('has at least 3 of Loyalty/Riptide/Channeling/Impaling implemented', () => {
    // all four are defined
    for (const e of ['loyalty', 'riptide', 'channeling', 'impaling']) {
      expect(ENCHANT_NAMES[e]).toBeTruthy();
    }
    expect(ENCHANTS.length).toBe(4);
  });

  it('Loyalty makes the trident return after its flight', () => {
    const t = createTrident({ loyalty: 3 });
    const proj = throwTrident(t, { x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 });
    let returned = false;
    for (let i = 0; i < 400 && !returned; i += 1) {
      const e = stepTrident(proj, waterWorld(), [], 0.05);
      if (e.returnTriggered) returned = true;
    }
    // Loyalty trident returns rather than just landing (returning flag set)
    expect(returned).toBe(true);
  });

  it('Impaling adds bonus damage vs aquatic mobs only', () => {
    const t = createTrident({ impaling: 2 });
    const bonus = impalingBonus(t.enchants, 'pufferfish');
    expect(bonus).toBeCloseTo(5.0); // 2.5 * 2
    // non-aquatic target gets no bonus
    expect(impalingBonus(t.enchants, 'zombie')).toBe(0);
  });

  it('Channeling triggers a lightning event on a thundering aquatic hit', () => {
    const w = waterWorld();
    const mob = createMob('pufferfish', 3.0, 2.5, 0, seededRandom(11));
    const t = createTrident({ channeling: 1 });
    const proj = throwTrident(t, { x: 0, y: 2.5, z: 0 }, { x: 1, y: 0, z: 0 });
    let bolt = false;
    for (let i = 0; i < 200 && !bolt; i += 1) {
      const e = stepTrident(proj, w, [mob], 0.05, { raining: true, thundering: true });
      if (e.lightning) bolt = true;
    }
    expect(bolt).toBe(true);
  });

  it('Riptide returns immediately and propels (no projectile body)', () => {
    const t = createTrident({ riptide: 1 });
    const proj = throwTrident(t, { x: 0, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }, { raining: true });
    expect(proj).not.toBeNull();
    const e = stepTrident(proj, waterWorld(), [], 0.05, { raining: true });
    expect(e.propelled).toBe(true);
    expect(e.returnTriggered).toBe(true);
    expect(proj.alive).toBe(false);
  });

  it('parseEnchants/describeEnchants normalize enchant sets', () => {
    const p = parseEnchants({ loyalty: 3, impaling: 2 });
    expect(p.loyalty).toBe(3);
    expect(p.impaling).toBe(2);
    expect(describeEnchants({ loyalty: 1 })).toBe('Loyalty');
    expect(describeEnchants({})).toBe('none');
  });

  it('an enchanted createTrident records hasEnchant', () => {
    expect(createTrident({ channeling: 1 }).hasEnchant).toBe(true);
    expect(createTrident().hasEnchant).toBe(false);
  });
});
