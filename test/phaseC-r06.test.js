// Phase C rework (crit 06): full inventory (36-slot) model with stack/split/swap
// across hotbar + storage, and death-drops-all-and-respawn-clear behaviour.
import { describe, it, expect } from 'vitest';
import { createInventory, INVENTORY_SIZE, HOTBAR_SIZE, STORAGE_SLOTS } from '../src/core/inventory.js';
import { spillInventory, clearForRespawn } from '../src/core/death.js';

describe('full 36-slot inventory model (crit 06)', () => {
  it('creates a 9 hotbar + 27 storage inventory', () => {
    expect(INVENTORY_SIZE).toBe(36);
    expect(STORAGE_SLOTS).toBe(27);
    const inv = createInventory(INVENTORY_SIZE);
    expect(inv.stacks.length).toBe(36);
    expect(inv.size).toBe(36);
    expect(inv.total()).toBe(0);
  });

  it('add stacks items across the full model (hotbar + storage)', () => {
    const inv = createInventory(INVENTORY_SIZE);
    expect(inv.add(7, 40)).toBe(0); // planks: 64-cap, 40 fits in one slot
    expect(inv.total()).toBe(40);
    // fill many distinct stacks into storage slots
    for (let i = 0; i < 30; i++) inv.add(1, 64); // stone
    expect(inv.total()).toBe(40 + 30 * 64);
    // all 36 slots account for the items with proper stacking
    const cap = inv.stacks.reduce((n, s) => n + (s.id === 1 ? 1 : 0), 0);
    expect(cap).toBeGreaterThanOrEqual(29); // storage 27 + leftover hotbar
    expect(inv.stacks.some((s) => s.id === 7)).toBe(true);
  });
});

describe('moveTo / swap / split across slots (crit 06)', () => {
  it('moveTo moves a whole stack into an empty target', () => {
    const inv = createInventory(INVENTORY_SIZE);
    inv.stacks[0] = { id: 7, count: 5 }; // 5 planks in hotbar slot 0
    inv.moveTo(0, 9); // storage slot 9 empty
    expect(inv.stacks[0]).toEqual({ id: 0, count: 0 });
    expect(inv.stacks[9]).toEqual({ id: 7, count: 5 });
    expect(inv.total()).toBe(5);
  });

  it('moveTo stacks same ids up to capacity and leaves the rest', () => {
    const inv = createInventory(INVENTORY_SIZE);
    inv.stacks[0] = { id: 7, count: 60 };
    inv.stacks[9] = { id: 7, count: 10 }; // room for 54 more (cap 64)
    const leftover = inv.moveTo(0, 9);
    expect(inv.stacks[9].count).toBe(64);
    expect(inv.stacks[0].count).toBe(6);
    expect(leftover).toBe(6);
  });

  it('moveTo swaps two slots of different item types', () => {
    const inv = createInventory(INVENTORY_SIZE);
    inv.stacks[0] = { id: 7, count: 4 };   // planks
    inv.stacks[9] = { id: 107, count: 2 }; // sticks
    inv.moveTo(0, 9);
    expect(inv.stacks[0]).toEqual({ id: 107, count: 2 });
    expect(inv.stacks[9]).toEqual({ id: 7, count: 4 });
  });

  it('swapSlots exchanges two slots directly', () => {
    const inv = createInventory(INVENTORY_SIZE);
    inv.stacks[1] = { id: 105, count: 3 }; // bread
    inv.stacks[10] = { id: 220, count: 12 };// seeds
    inv.swapSlots(1, 10);
    expect(inv.stacks[1]).toEqual({ id: 220, count: 12 });
    expect(inv.stacks[10]).toEqual({ id: 105, count: 3 });
  });

  it('splitHalf splits ~half of a stack into an empty slot', () => {
    const inv = createInventory(INVENTORY_SIZE);
    inv.stacks[0] = { id: 1, count: 64 }; // stone
    expect(inv.splitHalf(0, 9)).toBe(true);
    expect(inv.stacks[0].count).toBe(32);
    expect(inv.stacks[9]).toEqual({ id: 1, count: 32 });
    expect(inv.total()).toBe(64);
  });
});

describe('death-drops-all-and-respawn-clear (crit 06)', () => {
  it('spillInventory returns every stack as drops and clears the inventory', () => {
    const inv = createInventory(INVENTORY_SIZE);
    inv.stacks[0] = { id: 7, count: 20 };
    inv.stacks[3] = { id: 1, count: 64 };
    inv.stacks[12] = { id: 105, count: 8 };
    inv.stacks[31] = { id: 210, count: 1 };
    inv.selected = 3;

    const dropped = spillInventory(inv);
    expect(dropped).toEqual([
      { id: 7, count: 20 },
      { id: 1, count: 64 },
      { id: 105, count: 8 },
      { id: 210, count: 1 },
    ]);
    // inventory fully cleared and selection reset
    expect(inv.total()).toBe(0);
    expect(inv.selected).toBe(0);
    expect(inv.stacks.every((s) => s.id === 0 && s.count === 0)).toBe(true);
  });

  it('clears and then respawn allows walking back to repickup (items re-addable)', () => {
    const inv = createInventory(INVENTORY_SIZE);
    inv.stacks[0] = { id: 7, count: 20 };
    const dropped = spillInventory(inv);
    // simulate the respawn + repickup loop
    clearForRespawn(inv);
    expect(inv.total()).toBe(0);
    for (const d of dropped) inv.add(d.id, d.count);
    expect(inv.total()).toBe(20);
    expect(inv.stacks.some((s) => s.id === 7 && s.count === 20)).toBe(true);
  });

  it('clears a fresh inventory without error (empty spill)', () => {
    const inv = createInventory(INVENTORY_SIZE);
    expect(spillInventory(inv)).toEqual([]);
  });
});
