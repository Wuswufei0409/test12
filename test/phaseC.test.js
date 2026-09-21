// Phase C rework (crit 07): interactive crafting table grid interaction
// consumes ingredients and produces outputs, and recipe/item output names
// resolve properly (blocks, items, and B1_ITEMS) instead of 'air'/'?'.
import { describe, it, expect } from 'vitest';
import { createInventory, itemName } from '../src/core/inventory.js';
import {
  emptyCells, paletteSelect, placeSelected, removeFromGrid, previewGrid, craftGrid, buildGrid,
} from '../src/core/craftingTable.js';

describe('interactive crafting grid (crit 07)', () => {
  it('placeSelected moves an ingredient from inventory into a grid cell (consumes it)', () => {
    const inv = createInventory(9);
    inv.add(7, 4); // planks at some slot
    paletteSelect(inv, 0); // slot 0 now holds planks
    const cells = emptyCells();
    expect(inv.stacks[0].count).toBe(4);
    expect(placeSelected(inv, cells, 0)).toBe(true);
    // inventory consumed one plank
    expect(inv.stacks[0].count).toBe(3);
    expect(buildGrid(cells)[0]).toBe(7);
  });

  it('a 2x2 pattern of 4 planks previews and crafts a crafting_table', () => {
    const inv = createInventory(9);
    inv.add(7, 40); // planks
    paletteSelect(inv, 0);
    const cells = emptyCells();
    // place planks into the top-left 2x2 of the 3x3 grid
    [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([r, c]) => {
      expect(placeSelected(inv, cells, r * 3 + c)).toBe(true);
    });
    const preview = previewGrid(cells);
    expect(preview.name).toBe('crafting_table');
    const before = inv.total();
    const out = craftGrid(inv, cells);
    expect(out.crafted).toBe(true);
    expect(out.output).toEqual({ id: 15, count: 1 });
    // grid cleared, output added (4 planks were already consumed at place-time)
    expect(cells.every((c) => c.count === 0)).toBe(true);
    expect(inv.total()).toBe(before + 1); // 36 planks left + 1 crafting_table = 37
  });

  it('crafting consumes the placed ingredients and produces the output stack', () => {
    const inv = createInventory(9);
    inv.add(7, 8); // planks
    inv.add(107, 8); // sticks
    // place a wooden_pickaxe 3x3 pattern
    const cells = emptyCells();
    // rows: [planks,planks,planks], [0,stick,0], [0,stick,0]
    const plan = [
      [7, 7, 7],
      [0, 107, 0],
      [0, 107, 0],
    ];
    // need to select the right ingredient per cell
    plan.forEach((row, r) => row.forEach((id, c) => {
      if (!id) return;
      const slotIdx = inv.stacks.findIndex((s) => s.id === id && s.count > 0);
      paletteSelect(inv, slotIdx);
      expect(placeSelected(inv, cells, r * 3 + c)).toBe(true);
    }));
    expect(previewGrid(cells).name).toBe('wooden_pickaxe');
    const out = craftGrid(inv, cells);
    expect(out.crafted).toBe(true);
    // 3 planks + 2 sticks were consumed at place-time; 5 planks + 6 sticks remain + 1 pickaxe
    expect(inv.stacks.map((s) => s.count).reduce((a, b) => a + b, 0)).toBe(5 + 6 + 1);
    expect(out.output).toEqual({ id: 116, count: 1 });
  });

  it('removeFromGrid returns a placed ingredient to the inventory', () => {
    const inv = createInventory(9);
    inv.add(7, 1);
    paletteSelect(inv, 0);
    const cells = emptyCells();
    placeSelected(inv, cells, 4);
    expect(buildGrid(cells)[4]).toBe(7);
    expect(inv.stacks[0].count).toBe(0);
    expect(removeFromGrid(inv, cells, 4)).toBe(true);
    expect(buildGrid(cells)[4]).toBe(0);
    expect(inv.stacks.filter((s) => s.id === 7).reduce((n, s) => n + s.count, 0)).toBe(1);
  });

  it('refuses to place into an occupied cell', () => {
    const inv = createInventory(9);
    inv.add(7, 3);
    inv.add(107, 3);
    paletteSelect(inv, inv.stacks.findIndex((s) => s.id === 7));
    const cells = emptyCells();
    expect(placeSelected(inv, cells, 2)).toBe(true);
    paletteSelect(inv, inv.stacks.findIndex((s) => s.id === 107));
    expect(placeSelected(inv, cells, 2)).toBe(false); // occupied
    expect(placeSelected(inv, cells, 8)).toBe(true); // empty cell ok
  });
});

describe('recipe/item output name resolution (crit 07)', () => {
  it('resolves block outputs (crafting_table)', () => {
    expect(itemName(15)).toBe('crafting_table');
  });
  it('resolves item outputs (base ITEMS: wooden_pickaxe, bow, arrow)', () => {
    expect(itemName(116)).toBe('wooden_pickaxe');
    expect(itemName(103)).toBe('bow');
    expect(itemName(104)).toBe('arrow');
  });
  it('resolves B1_ITEMS outputs (wooden_axe, dried_kelp, wooden_hoe) instead of "?"', () => {
    expect(itemName(210)).toBe('wooden_axe');
    expect(itemName(202)).toBe('dried_kelp');
    expect(itemName(216)).toBe('wooden_hoe');
  });
  it('falls back to "?" only for truly unknown ids', () => {
    expect(itemName(99999)).toBe('?');
  });
});
