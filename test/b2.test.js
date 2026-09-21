// B2 headless unit tests: day/night cycle + survival (health/hunger/damage/
// food/drowning/fall/death/sleep). Run via `npm test`.
import { describe, it, expect } from 'vitest';
import { BLOCKS, ITEMS } from '../src/core/blocks.js';
import { createInventory } from '../src/core/inventory.js';
import {
  tickOfDay, daylight, isNight, phase, timeLabel, nextDawn,
} from '../src/core/daycycle.js';
import {
  createLiving, applyDamage, heal, foodValue, eatSelected, tickMetabolism,
  trackFall, LIVING,
} from '../src/core/living.js';

describe('day/night cycle', () => {
  it('tickOfDay wraps within a 24000-tick day', () => {
    expect(tickOfDay(24000)).toBe(0);
    expect(tickOfDay(-1)).toBe(23999);
    expect(tickOfDay(6000)).toBe(6000);
  });

  it('daylight is ~1 at noon, ~0 at midnight, mid at dawn', () => {
    expect(daylight(6000)).toBeCloseTo(1);
    expect(daylight(18000)).toBeCloseTo(0);
    expect(daylight(0)).toBeGreaterThan(0.3);
  });

  it('isNight covers dusk->dawn and is false midday', () => {
    expect(isNight(12000)).toBe(true);
    expect(isNight(20000)).toBe(true);
    expect(isNight(6000)).toBe(false);
  });

  it('phase labels dawn/day/dusk/night', () => {
    expect(phase(6000)).toBe('day');
    expect(phase(12500)).toBe('dusk');
    expect(phase(16000)).toBe('night');
    expect(phase(23500)).toBe('dawn');
  });

  it('timeLabel advances day and clock', () => {
    expect(timeLabel(0)).toContain('Day 1');
    expect(timeLabel(0)).toContain('06:00');
    expect(timeLabel(6000)).toContain('12:00');
    expect(timeLabel(24000)).toContain('Day 2');
  });

  it('nextDawn skips to the next 06:00 morning', () => {
    expect(nextDawn(6000)).toBe(24000);
    expect(nextDawn(24000)).toBe(48000);
    expect(tickOfDay(nextDawn(18000))).toBe(0);
  });
});

describe('survival: damage & difficulty', () => {
  it('environmental damage is not scaled by difficulty', () => {
    const l = createLiving();
    applyDamage(l, 5, { type: 'environment', difficulty: 'normal' });
    expect(l.health).toBe(15);
  });

  it('hostile damage scales with difficulty (peaceful 0, easy 0.5)', () => {
    const p = createLiving();
    applyDamage(p, 10, { type: 'hostile', difficulty: 'peaceful' });
    expect(p.health).toBe(20);
    const e = createLiving();
    applyDamage(e, 10, { type: 'hostile', difficulty: 'easy' });
    expect(e.health).toBe(15);
    const n = createLiving();
    applyDamage(n, 10, { type: 'hostile', difficulty: 'normal' });
    expect(n.health).toBe(10);
  });

  it('damage that reaches 0 sets alive=false', () => {
    const l = createLiving();
    applyDamage(l, 99, { type: 'environment' });
    expect(l.alive).toBe(false);
    expect(l.health).toBe(0);
  });

  it('heal restores health up to the cap', () => {
    const l = createLiving();
    applyDamage(l, 8);
    expect(heal(l, 3)).toBe(3);
    expect(l.health).toBe(15);
    expect(heal(l, 100)).toBe(5);
    expect(l.health).toBe(20);
  });
});

describe('survival: food & hunger', () => {
  it('foodValue reads the item food field', () => {
    expect(foodValue(ITEMS.bread.id)).toBe(5);
    expect(foodValue(ITEMS.apple.id)).toBe(4);
    expect(foodValue(BLOCKS.stone.id)).toBe(0);
  });

  it('eatSelected restores hunger and consumes one item', () => {
    const l = createLiving();
    l.hunger = 10;
    const inv = createInventory();
    inv.add(ITEMS.bread.id, 3);
    inv.select(0);
    const ate = eatSelected(l, inv);
    expect(ate).toBe(ITEMS.bread.id);
    expect(l.hunger).toBe(15); // +5 bread
    expect(inv.stacks[0].count).toBe(2);
  });

  it('does not eat when hunger is full', () => {
    const l = createLiving();
    const inv = createInventory();
    inv.add(ITEMS.bread.id, 2);
    inv.select(0);
    expect(eatSelected(l, inv)).toBe(0);
    expect(inv.stacks[0].count).toBe(2);
  });

  it('hunger drains over time (saturation first, then hunger)', () => {
    const l = createLiving();
    // 400 sim-seconds: saturation (5 pts) drains in 150s, hunger drains the rest.
    tickMetabolism(l, 400, { difficulty: 'normal', underwater: false });
    expect(l.hunger).toBeLessThan(l.maxHunger);
  });

  it('regenerates health when well-fed', () => {
    const l = createLiving();
    applyDamage(l, 5);
    const start = l.health;
    tickMetabolism(l, 5, { difficulty: 'normal', underwater: false });
    expect(l.health).toBeGreaterThan(start);
  });

  it('starves (environmental damage) when hunger hits 0', () => {
    const l = createLiving();
    l.hunger = 0;
    const start = l.health;
    const events = tickMetabolism(l, 5, { difficulty: 'normal', underwater: false });
    expect(events.some((e) => e.cause === 'starvation')).toBe(true);
    for (const e of events) applyDamage(l, e.amount, { type: e.type });
    expect(l.health).toBeLessThan(start);
  });
});

describe('survival: drowning & fall', () => {
  it('drowning depletes oxygen then damages', () => {
    const l = createLiving();
    const start = l.health;
    const events = tickMetabolism(l, LIVING.maxAir + 2, { difficulty: 'normal', underwater: true });
    expect(l.air).toBe(0);
    expect(events.some((e) => e.cause === 'drowning')).toBe(true);
    for (const e of events) applyDamage(l, e.amount, { type: e.type });
    expect(l.health).toBeLessThan(start);
  });

  it('oxygen refills when above water', () => {
    const l = createLiving();
    l.air = 2;
    tickMetabolism(l, 1, { difficulty: 'normal', underwater: false });
    expect(l.air).toBeGreaterThan(2);
  });

  it('fall damage applies only beyond the threshold', () => {
    const l = createLiving();
    trackFall(l, 1, { airborne: true, fallingSpeed: -9 });
    // accumulate 9m airborne, no damage yet
    expect(l.health).toBe(20);
    const dmg = trackFall(l, 0.1, { airborne: false, fallingSpeed: 0 });
    expect(dmg).toBe(6); // floor(9-3)
    expect(l.health).toBe(14);
  });

  it('small falls cause no damage', () => {
    const l = createLiving();
    trackFall(l, 1, { airborne: true, fallingSpeed: -2 });
    expect(trackFall(l, 0.1, { airborne: false, fallingSpeed: 0 })).toBe(0);
    expect(l.health).toBe(20);
  });
});
