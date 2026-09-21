// R-08 (MUL-114) headless tests — crit 08 integrated furnace interaction.
// Covers the client GUI glue: hotbar->input/fuel routing, real Furnace state
// machine ticking (fuel consumption + progress -> output), output->inventory,
// and save round-trip persistence of a burning furnace (crit 18 containers).
import { describe, it, expect } from 'vitest';
import {
  createFurnaceContainer, tickFurnace, depositStack, putIntoSlot, takeFromSlot,
} from '../src/core/furnaceops.js';
import { FUEL, SMELTING_RECIPES } from '../src/core/smelting.js';
import { roundTrip } from '../src/core/save.js';

describe('furnace GUI transfer glue (crit 08)', () => {
  it('routes fuel items to the fuel slot and ores to the input slot', () => {
    const c = createFurnaceContainer();
    expect(depositStack(c, { id: 111, count: 3 })).toBeNull(); // coal -> fuel
    expect(c.fuel).toEqual({ id: 111, count: 3 });
    expect(depositStack(c, { id: 12, count: 2 })).toBeNull(); // iron_ore -> input
    expect(c.input).toEqual({ id: 12, count: 2 });
    expect(c.output).toBeNull();
  });

  it('keeps the leftover when a slot is full or holds a different item', () => {
    const c = createFurnaceContainer();
    putIntoSlot(c, 'input', { id: 12, count: 63 });
    const rest = putIntoSlot(c, 'input', { id: 12, count: 5 });
    expect(rest).not.toBeNull();
    expect(c.input.count).toBe(64);
    expect(rest.count).toBe(4);
    // different item is refused
    expect(putIntoSlot(c, 'input', { id: 5, count: 1 })).toEqual({ id: 5, count: 1 });
  });

  it('ticks consume fuel, advance progress and produce output into the slot', () => {
    const c = createFurnaceContainer();
    depositStack(c, { id: 111, count: 1 }); // coal = 1600 ticks
    depositStack(c, { id: 12, count: 1 }); // iron_ore -> iron_ingot (200 ticks)
    // partial progress
    tickFurnace(c, 100);
    expect(c.burning).toBe(true);
    expect(c.progress).toBeGreaterThanOrEqual(100);
    expect(c.fuelTicksLeft).toBe(1600 - 100);
    expect(c.output).toBeNull();
    // finish the smelt
    tickFurnace(c, 100);
    expect(c.output).toEqual({ id: 110, count: 1 });
    expect(c.input).toBeNull(); // ore consumed
    expect(c.progress).toBe(0);
  });

  it('output moves to the player inventory via takeFromSlot', () => {
    const c = createFurnaceContainer();
    c.output = { id: 110, count: 2 };
    const taken = takeFromSlot(c, 'output');
    expect(taken).toEqual({ id: 110, count: 2 });
    expect(c.output).toBeNull();
  });

  it('stops burning with no fuel and does not consume input', () => {
    const c = createFurnaceContainer();
    depositStack(c, { id: 12, count: 1 });
    tickFurnace(c, 50);
    expect(c.burning).toBe(false);
    expect(c.progress).toBe(0);
    expect(c.input).toEqual({ id: 12, count: 1 });
  });
});

describe('furnace persistence through save (crit 18)', () => {
  it('a burning furnace container round-trips unchanged through serialize+restore', () => {
    const c = createFurnaceContainer();
    depositStack(c, { id: 111, count: 2 });
    depositStack(c, { id: 12, count: 3 });
    tickFurnace(c, 120);
    c.output = { id: 110, count: 1 };

    const snap = {
      seed: 'furnace-persist',
      worldTime: 1234,
      difficulty: 'normal',
      player: { pos: { x: 0, y: 34, z: 0 }, yaw: 0, pitch: 0, vel: { x: 0, y: 0, z: 0 } },
      living: { health: 20, hunger: 20 },
      inventory: { selected: 0, stacks: [] },
      equipped: [],
      worldEdits: [['0,32,0', 16]],
      containers: { '0,32,0': c },
      drops: [],
      mobs: [],
    };
    const res = roundTrip(snap);
    expect(res.ok).toBe(true);
    const restored = res.snap.containers['0,32,0'];
    expect(restored).toEqual(c);
    // it is still a working furnace (keeps burning state, can finish smelting)
    expect(restored.burning).toBe(true);
    expect(restored.progress).toBe(120);
    tickFurnace(restored, 80);
    expect(restored.output).toEqual({ id: 110, count: 2 });
  });
});
