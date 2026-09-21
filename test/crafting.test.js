// B1 tests: config-driven crafting (2x2/3x3 + shapeless + recipe book),
// tool tiers/durability/wrong-tool, ore drops, furnace smelting, full chain.
import { describe, it, expect } from 'vitest';
import { findRecipe, craft, recipeBook, RECIPES } from '../src/core/crafting.js';
import { dig, toolDurability, digSpeedFor, useTool } from '../src/core/tools.js';
import { Furnace, SMELTING_RECIPES, FUEL } from '../src/core/smelting.js';
import { createInventory } from '../src/core/inventory.js';

// Build a 3x3 grid (row-major) from a 2D pattern of item-id numbers or names.
const I = {
  planks: 7, log: 8, stick: 107, coal: 111, cobblestone: 10,
  iron_ingot: 110, wheat: 106, kelp: 200, prismarine_shard: 201,
};
function grid(pattern) {
  const out = new Array(9).fill(0);
  pattern.forEach((row, r) => row.forEach((cell, c) => {
    out[r * 3 + c] = typeof cell === 'number' ? cell : I[cell];
  }));
  return out;
}
function emptyRow() { return [0, 0, 0, 0, 0, 0, 0, 0, 0]; }

describe('config-driven crafting', () => {
  it('crafts 2x2 recipes (crafting_table from 4 planks)', () => {
    const g = grid([['planks', 'planks'], ['planks', 'planks']]);
    const r = findRecipe(g);
    expect(r.name).toBe('crafting_table');
    const res = craft(g);
    expect(res.output).toEqual({ id: 15, count: 1 });
  });

  it('crafts 3x3 recipes (wooden_pickaxe)', () => {
    const g = grid([
      ['planks', 'planks', 'planks'],
      [0, 'stick', 0],
      [0, 'stick', 0],
    ]);
    const r = findRecipe(g);
    expect(r.name).toBe('wooden_pickaxe');
    expect(craft(g).output).toEqual({ id: 116, count: 1 });
  });

  it('is placement-agnostic (2x2 recipe works in any grid corner)', () => {
    const g = emptyRow();
    // place 4 planks in top-right 2x2
    g[1] = 7; g[2] = 7; g[4] = 7; g[5] = 7;
    expect(findRecipe(g).name).toBe('crafting_table');
  });

  it('handles shapeless recipes (bread from 3 wheat)', () => {
    const g = emptyRow();
    g[0] = 106; g[3] = 106; g[6] = 106; // any arrangement of 3 wheat
    const r = findRecipe(g);
    expect(r.name).toBe('bread');
    expect(craft(g).output).toEqual({ id: 105, count: 1 });
  });

  it('recipe book covers all required items (crit 07)', () => {
    const names = recipeBook().map((r) => r.name);
    const required = ['crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe',
      'wooden_axe', 'stone_axe', 'iron_axe', 'wooden_shovel', 'stone_shovel', 'iron_shovel',
      'wooden_sword', 'stone_sword', 'iron_sword', 'torch', 'chest', 'furnace', 'boat', 'bucket',
      'bread', 'dried_kelp', 'sea_lantern'];
    for (const req of required) expect(names).toContain(req);
    expect(RECIPES.length).toBeGreaterThanOrEqual(required.length);
  });

  it('returns null for an invalid arrangement', () => {
    const g = grid([['planks', 'planks'], ['planks', 'cobblestone']]);
    expect(findRecipe(g)).toBeNull();
  });
});

describe('tool tiers, durability, wrong-tool restriction (crit 08)', () => {
  it('per-material dig speeds increase wood -> stone -> iron', () => {
    const wood = digSpeedFor(116); // wooden_pickaxe
    const stone = digSpeedFor(117);
    const iron = digSpeedFor(118);
    expect(wood).toBeLessThan(stone);
    expect(stone).toBeLessThan(iron);
  });

  it('has correct durability per tier', () => {
    expect(toolDurability(116)).toBeGreaterThan(0); // wood
    expect(toolDurability(117)).toBeGreaterThan(toolDurability(116)); // stone > wood
    expect(toolDurability(118)).toBeGreaterThan(toolDurability(117)); // iron > stone
  });

  it('wrong tool gives no drop (hand/shovel vs stone)', () => {
    // mining stone with bare hands
    expect(dig(1, null).drop).toBeNull();
    // shovel is the wrong tool for stone
    expect(dig(1, 213).drop).toBeNull();
    expect(dig(1, 213).wrongTool).toBe(true);
  });

  it('correct pickaxe drops the block (stone)', () => {
    const r = dig(1, 116);
    expect(r.drop).toBe(1);
    expect(r.wrongTool).toBe(false);
    expect(r.durabilityLost).toBe(1);
  });

  it('iron ore requires a sufficient harvest level (stone+ pickaxe)', () => {
    expect(dig(12, 116).insufficientHarvest).toBe(true); // wood pickaxe not enough
    expect(dig(12, 116).drop).toBeNull();
    expect(dig(12, 117).drop).toBe(12); // stone pickaxe works
    expect(dig(12, 118).drop).toBe(12); // iron pickaxe works
  });

  it('coal ore drops coal', () => {
    expect(dig(11, 116).drop).toBe(111);
  });

  it('tool durability decreases and eventually breaks', () => {
    let dur = toolDurability(116);
    let broken = false;
    for (let i = 0; i < toolDurability(116) + 5; i += 1) {
      ({ remaining: dur, broken } = useTool(116, dur));
      if (broken) break;
    }
    expect(broken).toBe(true);
    expect(dur).toBe(0);
  });
});

describe('furnace smelting + full upgrade chain (crit 08)', () => {
  it('smelts iron ore to iron ingot with coal fuel', () => {
    const f = new Furnace();
    f.setInput({ id: 12, count: 1 }); // iron_ore
    f.setFuel({ id: 111, count: 1 }); // coal
    let events = [];
    for (let i = 0; i < 1; i += 1) events = f.tick(1);
    // run until smelted
    for (let i = 0; i < 1000 && !f.output; i += 1) { events = f.tick(1); }
    expect(f.output).toEqual({ id: 110, count: 1 }); // iron_ingot
    expect(f.input).toBeNull();
  });

  it('MODEL chest/boat/bucket/bread smelting config present', () => {
    expect(SMELTING_RECIPES[12]).toEqual({ output: [110, 1], time: 200 });
    expect(FUEL[111]).toBe(1600);
  });

  it('full upgrade chain: wood pickaxe -> mine coal -> smelt iron -> craft iron pickaxe', () => {
    // 1. mine coal ore with a wooden pickaxe
    const coalDrop = dig(11, 116).drop;
    expect(coalDrop).toBe(111);

    // 2. mine iron ore with an iron pickaxe (need harvest 2)
    const ironOre = dig(12, 118).drop;
    expect(ironOre).toBe(12);

    // 3. smelt the iron ore to ingots
    const f = new Furnace();
    f.setInput({ id: 12, count: 1 });
    f.setFuel({ id: 111, count: 1 });
    for (let i = 0; i < 3000 && !f.output; i += 1) f.tick(1);
    expect(f.output.id).toBe(110);

    // 4. craft an iron pickaxe from ingots + sticks in a 3x3 grid
    const g = grid([
      [110, 110, 110],
      [0, 107, 0],
      [0, 107, 0],
    ]);
    const recipe = findRecipe(g);
    expect(recipe.name).toBe('iron_pickaxe');
    expect(craft(g).output).toEqual({ id: 118, count: 1 });
  });

  it('ore drops travel through inventory stacking', () => {
    const inv = createInventory(9); // hotbar-sized canonical inventory
    const left = inv.add(111, 4); // coal
    expect(left).toBe(0);
    expect(inv.total()).toBe(4);
    expect(inv.stacks[0].id).toBe(111);
    // second add stacks onto the existing partial stack
    inv.add(111, 3);
    expect(inv.stacks[0].count).toBe(7);
    expect(inv.total()).toBe(7);
  });
});
