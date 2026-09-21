// B4 headless unit tests: farming — farmland, plant/grow/harvest, food crops
// (wheat/carrot/potato), and growth driven by time + light over ticks.
// Run via `npm test`.
import { describe, it, expect } from 'vitest';
import { BLOCKS } from '../src/core/blocks.js';
import { isHoeItem } from '../src/core/items.js';
import { findRecipe } from '../src/core/crafting.js';
import { WorldState } from '../src/core/worldstate.js';
import {
  FARM, CROP_TYPES, CROP_SEED_ITEM,
  cropOfBlock, isCropBlock, isFarmland, stageBlockId, cropForSeed,
  maxStage, stageForAge, harvestDrops, tickCrops,
} from '../src/core/farming.js';

describe('farming: block registry & mapping', () => {
  it('registers farmland and crop stage blocks', () => {
    expect(BLOCKS.farmland.id).toBe(36);
    expect(isFarmland(36)).toBe(true);
    expect(BLOCKS.wheat_s3.id).toBe(43);
    expect(BLOCKS.carrot_s3.id).toBe(47);
    expect(BLOCKS.potato_s3.id).toBe(51);
  });

  it('maps each stage block back to its crop type + stage', () => {
    expect(cropOfBlock(40)).toMatchObject({ type: 'wheat', stage: 0 });
    expect(cropOfBlock(43)).toMatchObject({ type: 'wheat', stage: 3 });
    expect(cropOfBlock(47)).toMatchObject({ type: 'carrot', stage: 3 });
    expect(cropOfBlock(51)).toMatchObject({ type: 'potato', stage: 3 });
    expect(isCropBlock(36)).toBe(false);
    expect(isCropBlock(43)).toBe(true);
  });

  it('maps seed items to crop types and stages to block ids', () => {
    expect(cropForSeed(220)).toBe('wheat');
    expect(cropForSeed(221)).toBe('carrot');
    expect(cropForSeed(222)).toBe('potato');
    expect(cropForSeed(1)).toBe(null);
    expect(stageBlockId('wheat', 0)).toBe(40);
    expect(stageBlockId('potato', 3)).toBe(51);
    expect(maxStage('wheat')).toBe(3);
  });

  it('hoes are recognised as till tools', () => {
    expect(isHoeItem(216)).toBe(true);
    expect(isHoeItem(217)).toBe(true);
    expect(isHoeItem(218)).toBe(true);
    expect(isHoeItem(116)).toBe(false);
  });
});

describe('farming: growth by time and light', () => {
  it('reaches maturity at full light after growSeconds', () => {
    expect(stageForAge(FARM.growSeconds, 1, 'wheat')).toBe(maxStage('wheat'));
    expect(stageForAge(FARM.growSeconds, 1, 'carrot')).toBe(3);
  });

  it('grows slower in darkness (light affects growth rate)', () => {
    const full = stageForAge(FARM.growSeconds / 2, 1, 'wheat');
    const dim = stageForAge(FARM.growSeconds / 2, 0, 'wheat');
    expect(full).toBeGreaterThan(dim); // full light outpaces darkness
    // at zero stage progression still moves at the lightMin floor
    expect(dim).toBeGreaterThanOrEqual(0);
  });

  it('never exceeds the max stage and clamps negative light', () => {
    expect(stageForAge(FARM.growSeconds * 10, 1, 'potato')).toBe(3);
    expect(stageForAge(100000, -5, 'carrot')).toBe(3);
    expect(stageForAge(0, 1, 'wheat')).toBe(0);
  });

  it('tickCrops advances a real crop block over time (deterministic)', () => {
    const world = new WorldState('farm-seed');
    world.set(0, 60, 0, 36); // farmland
    world.set(0, 61, 0, 40); // wheat stage 0
    const crops = new Map([['0,61,0', { type: 'wheat', age: 0 }]]);
    // tick half the grow time at full light, then the rest
    tickCrops(crops, world, FARM.growSeconds / 2, 1);
    const mid = world.get(0, 61, 0);
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThanOrEqual(43);
    tickCrops(crops, world, FARM.growSeconds / 2, 1);
    expect(world.get(0, 61, 0)).toBe(43); // mature
  });

  it('a crop dies when its support is no longer farmland', () => {
    const world = new WorldState('farm-seed');
    world.set(0, 60, 0, 36);
    world.set(0, 61, 0, 40);
    const crops = new Map([['0,61,0', { type: 'wheat', age: 0 }]]);
    world.set(0, 60, 0, 3); // farmland replaced by dirt
    const events = tickCrops(crops, world, 1, 1);
    expect(events.length).toBe(1);
    expect(events[0].died).toBe(true);
    expect(world.get(0, 61, 0)).toBe(0);
    expect(crops.size).toBe(0);
  });

  it('CROP_SEED_ITEM/CROP_TYPES are internally consistent', () => {
    for (const [seedItem, type] of Object.entries(CROP_SEED_ITEM)) {
      expect(CROP_TYPES[type].seedItem).toBe(Number(seedItem));
      expect(CROP_TYPES[type].stageBlocks.length).toBe(4);
    }
  });
});

describe('farming: harvest drops', () => {
  it('mature wheat drops bread-ingredient + a seed', () => {
    const drops = harvestDrops('wheat', true, () => 0);
    expect(drops).toContainEqual({ itemId: 106, count: 1 });
    expect(drops).toContainEqual({ itemId: 220, count: 1 });
  });

  it('immature wheat only returns its seed', () => {
    const drops = harvestDrops('wheat', false);
    expect(drops).toEqual([{ itemId: 220, count: 1 }]);
  });

  it('mature carrot/potato return 1..N vegetables, no separate seed', () => {
    const carrot = harvestDrops('carrot', true, () => 0);
    const potato = harvestDrops('potato', true, () => 0.999);
    expect(carrot.filter((d) => d.itemId === 221).length).toBe(1);
    expect(carrot.some((d) => d.itemId === 220)).toBe(false);
    expect(potato[0].count).toBeGreaterThanOrEqual(1);
  });
});

describe('farming: attainable via crafting (hoe recipes)', () => {
  const I = { planks: 7, stick: 107, cobblestone: 10, iron_ingot: 110 };
  function gridFrom(shape) {
    const g = new Array(9).fill(0);
    shape.forEach((row, r) => row.forEach((c, ci) => {
      if (c !== '.') g[r * 3 + ci] = I[c];
    }));
    return g;
  }
  it('wooden_hoe recipe matches the 2x3 hoe shape', () => {
    const g = gridFrom([
      ['planks', 'planks'],
      ['.', 'stick'],
      ['.', 'stick'],
    ]);
    expect(findRecipe(g).name).toBe('wooden_hoe');
  });
  it('stone_hoe recipe matches', () => {
    const g = gridFrom([
      ['cobblestone', 'cobblestone'],
      ['.', 'stick'],
      ['.', 'stick'],
    ]);
    expect(findRecipe(g).name).toBe('stone_hoe');
  });
});
