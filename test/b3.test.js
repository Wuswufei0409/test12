// B3 tests: land mobs (crit 11) + combat gear (crit 12).
import { describe, it, expect } from 'vitest';
import { recipeBook, findRecipe } from '../src/core/crafting.js';
import { MOBS, createMob, stepMob, damageMob, mobDrops, groundHeight } from '../src/core/mobs.js';
import { explode } from '../src/core/explosion.js';
import { weaponStats, resolveMelee, armorReduction, armorSlot, useWeapon, WEAPON_DAMAGE, HAND_DAMAGE } from '../src/core/combat.js';
import { WorldState } from '../src/core/worldstate.js';

// Flat test world: a solid floor at y=0 (block 0 = air, block id 3 = dirt floor).
class FlatWorld {
  constructor() { this.edits = new Map(); }
  get(x, y, z) { return y <= 0 ? 3 : 0; }
  isSolid(x, y, z) { return y <= 0; }
  isLiquid() { return false; }
  set(x, y, z, id) {
    const k = `${x},${y},${z}`;
    if (id === 0) this.edits.set(k, 0); else this.edits.set(k, id);
  }
}

const player = () => ({
  pos: { x: 0, y: 2, z: 0 },
  alive: true,
});

describe('MOBS registry', () => {
  it('defines the seven land mob types', () => {
    expect(['pig', 'cow', 'sheep', 'chicken', 'zombie', 'spider', 'creeper'].every((t) => MOBS[t])).toBe(true);
  });
  it('marks passive and hostile correctly', () => {
    expect(MOBS.pig.passive).toBe(true);
    expect(MOBS.zombie.passive).toBe(false);
    expect(MOBS.creeper.passive).toBe(false);
  });
});

describe('createMob / spawn', () => {
  it('creates a living zombie with full health', () => {
    const m = createMob('zombie', 5, 1, 5);
    expect(m.alive).toBe(true);
    expect(m.health).toBe(MOBS.zombie.health);
  });
  it('rejects unknown mob types', () => {
    expect(() => createMob('dragon', 0, 1, 0)).toThrow();
  });
});

describe('wander-or-chase / attack-or-flee', () => {
  it('passive mob flees when hurt', () => {
    const world = new FlatWorld();
    const m = createMob('pig', 3, 1, 0);
    const p = player();
    const dxBefore = m.x - p.pos.x;
    damageMob(m, 2); // hurt sets hurtTicks = 8
    stepMob(m, world, p, 1);
    const dxAfter = m.x - p.pos.x;
    // fleeing moves away: distance from player should increase
    expect(Math.abs(dxAfter)).toBeGreaterThan(Math.abs(dxBefore));
  });

  it('hostile zombie chases a nearby player', () => {
    const world = new FlatWorld();
    const m = createMob('zombie', 6, 1, 0);
    const p = player(); // at x=0
    // step several ticks toward player
    for (let i = 0; i < 40; i++) stepMob(m, world, p, 1);
    expect(m.x).toBeLessThan(6); // moved toward x=0
  });

  it('hostile attacks player in melee range (normal difficulty)', () => {
    const world = new FlatWorld();
    const m = createMob('zombie', 1.2, 1, 0);
    const p = player();
    m.aggro = true;
    const ev = [];
    for (let i = 0; i < 25; i++) ev.push(...stepMob(m, world, p, 1, 'normal'));
    const atk = ev.find((e) => e.attack);
    expect(atk).toBeTruthy();
    expect(atk.attack.damage).toBe(MOBS.zombie.damage);
  });

  it('peaceful difficulty deals no hostile damage', () => {
    const world = new FlatWorld();
    const m = createMob('zombie', 1.2, 1, 0);
    const p = player();
    m.aggro = true;
    const ev = [];
    for (let i = 0; i < 25; i++) ev.push(...stepMob(m, world, p, 1, 'peaceful'));
    const atk = ev.find((e) => e.attack);
    // damaging events may exist (peaceful->0), but effective damage is 0
    expect(atk ? atk.attack.damage : -1).toBe(0);
  });
});

describe('hurting and death', () => {
  it('damageMob reduces health and reports killed', () => {
    const m = createMob('chicken', 0, 1, 0); // 4 hp
    const r1 = damageMob(m, 2);
    expect(r1).toEqual({ killed: false, damage: 2 });
    expect(m.health).toBe(2);
    const r2 = damageMob(m, 5);
    expect(r2.killed).toBe(true);
    expect(m.alive).toBe(false);
  });
  it('damageMob on a dead mob is a no-op', () => {
    const m = createMob('cow', 0, 1, 0);
    damageMob(m, 99);
    const r = damageMob(m, 5);
    expect(r).toEqual({ killed: false, damage: 0 });
  });
});

describe('configured drops', () => {
  it('passive mob drops its configured item(s)', () => {
    const m = createMob('cow', 0, 1, 0);
    m.alive = true;
    const drops = mobDrops(m);
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.every((d) => typeof d.id === 'number')).toBe(true);
  });
  it('hostile drop has a chance but ids resolve', () => {
    const m = createMob('zombie', 0, 1, 0);
    const drops = mobDrops(m);
    // rotten_flesh id 124
    expect(drops.every((d) => typeof d.id === 'number')).toBe(true);
  });
});

describe('creeper explosion modifies world (crit 11)', () => {
  it('explode empties voxels within radius and leaves outer blocks', () => {
    const world = new WorldState('test-seed');
    // pre-place solid voxels via the edit overlay inside and outside radius
    world.set(2, 1, 0, 1); // stone at radius distance
    world.set(0, 1, 0, 1); // centre
    const dropped = explode(world, 0, 1, 0, 3);
    expect(world.get(0, 1, 0)).toBe(0); // centre air
    expect(world.get(2, 1, 0)).toBe(0); // inside radius
    // a far block far outside radius is untouched
    expect(world.get(12, 1, 0)).not.toBe(0);
    expect(Array.isArray(dropped)).toBe(true);
  });
  it('does not remove unbreakable bedrock', () => {
    const world = new WorldState('test-seed');
    world.set(0, 0, 0, 25); // bedrock
    explode(world, 0, 0, 0, 5);
    expect(world.get(0, 0, 0)).toBe(25);
  });
});

describe('groundHeight helper', () => {
  it('returns the surface y above a solid column', () => {
    const m = createMob('cow', 0, 1, 0);
    const h = groundHeight(new FlatWorld(), 0, 0);
    expect(typeof h).toBe('number');
  });
});

describe('combat gear (crit 12)', () => {
  it('weaponStats reports per-material melee damage', () => {
    expect(weaponStats(102).melee).toBe(WEAPON_DAMAGE.iron.melee);
    expect(weaponStats(100).melee).toBe(WEAPON_DAMAGE.wood.melee);
  });
  it('hand has low base damage', () => {
    expect(weaponStats(null).melee).toBe(HAND_DAMAGE.melee);
  });
  it('armorReduction rises with armor points', () => {
    const no = armorReduction([]);
    const some = armorReduction([134, 133, 135, 136]); // full iron
    expect(some).toBeGreaterThan(no);
    const full = armorReduction([130, 129, 131, 132]); // full leather
    expect(full).toBeGreaterThan(no);
  });
  it('armorSlot maps items to slots', () => {
    expect(armorSlot(134)).toBe('chest');
    expect(armorSlot(133)).toBe('helmet');
    expect(armorSlot(136)).toBe('boots');
    expect(armorSlot(100)).toBe(null); // sword is not armor
  });
  it('useWeapon consumes durability toward a floor of 0', () => {
    const r = useWeapon(100, 3);
    expect(r.broken).toBe(false);
    expect(r.remaining).toBe(2);
    const broken = useWeapon(100, 1);
    expect(broken.remaining).toBe(0);
  });
  it('resolveMelee respects cooldown', () => {
    const mob = createMob('zombie', 1, 1, 0);
    const res = resolveMelee({ pos: { x: 0, y: 1, z: 0 } }, mob, 102, 5);
    expect(res).toBe(null);
  });
  it('resolveMelee reports hit feedback and knockback in range', () => {
    const mob = createMob('zombie', 1, 1, 0);
    const res = resolveMelee({ pos: { x: 0, y: 1, z: 0 } }, mob, 102, 0);
    expect(res.hit).toBe(true);
    expect(res.damage).toBe(WEAPON_DAMAGE.iron.melee);
    expect(res.feedback.cooldown).toBeGreaterThan(0);
    expect(typeof res.knockback.x).toBe('number');
  });
  it('resolveMelee reports out-of-range miss', () => {
    const mob = createMob('zombie', 50, 1, 50);
    const res = resolveMelee({ pos: { x: 0, y: 1, z: 0 } }, mob, 102, 0);
    expect(res.hit).toBe(false);
    expect(res.reason).toBe('range');
  });
});

describe('combat gear crafting (crit 12)', () => {
  const names = new Set(recipeBook().map((r) => r.name));
  it('recipe book includes bow/arrow/shield/armor', () => {
    for (const n of ['bow', 'arrow', 'shield', 'leather_helmet', 'iron_chest']) {
      expect(names.has(n), `missing recipe ${n}`).toBe(true);
    }
  });
  it('bow recipe resolves (pattern matches)', () => {
    const ids = (k) => { const i = { bow: 103, string: 125, stick: 107 }[k]; return i; };
    const grid = [
      [0, ids('string'), ids('stick')],
      [ids('stick'), 0, ids('string')],
      [0, ids('string'), ids('stick')],
    ].flat();
    const r = findRecipe(grid);
    expect(r).toBeTruthy();
    expect(r.name).toBe('bow');
  });
  it('iron helmet recipe resolves', () => {
    const ig = 110; // iron_ingot
    const grid = [
      [ig, ig, ig],
      [ig, 0, ig],
      [0, 0, 0],
    ].flat();
    const r = findRecipe(grid);
    expect(r).toBeTruthy();
    expect(r.name).toBe('iron_helmet');
  });
});
