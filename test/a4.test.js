// A4 headless unit tests: world edit overlay, targeting, hardness breaking,
// inventory/hotbar stacking, and item drops/pickup. Run via `npm test`.
import { describe, it, expect } from 'vitest';
import { WORLD } from '../src/core/world.js';
import { BLOCKS, ITEMS } from '../src/core/blocks.js';
import { WorldState } from '../src/core/worldstate.js';
import { raycastBlock, cameraDirection } from '../src/core/targeting.js';
import { breakTimeSeconds, Breaking } from '../src/core/breaking.js';
import { createInventory, stackCapacity, HOTBAR_SIZE, itemName } from '../src/core/inventory.js';
import { dropForBlock, createDrop, stepDrop, canPickup } from '../src/core/drops.js';

const SEED = WORLD.seed;

describe('WorldState edit overlay', () => {
  it('returns the procedural generated block before any edit', () => {
    const ws = new WorldState(SEED);
    // A known solid generated block near spawn is not directly asserted; just
    // ensure the accessor returns an integer id for arbitrary typed coords.
    expect(Number.isInteger(ws.get(0, 1, 0))).toBe(true);
  });

  it('overrides terrain with edits (mine to air, place a block)', () => {
    const ws = new WorldState(SEED);
    ws.set(4, 40, 4, BLOCKS.stone.id);
    expect(ws.get(4, 40, 4)).toBe(BLOCKS.stone.id);
    ws.set(4, 40, 4, 0); // mine to air
    expect(ws.get(4, 40, 4)).toBe(0);
    expect(ws.isSolid(4, 40, 4)).toBe(false);
  });

  it('leaves untouched columns reading from generated terrain', () => {
    const ws = new WorldState(SEED);
    const untouched = ws.get(1, 30, 1);
    ws.set(1, 30, 1, BLOCKS.stone.id);
    expect(ws.get(1, 30, 1)).toBe(BLOCKS.stone.id);
    ws.set(1, 30, 1, 0);
    // back to explicit air now
    expect(ws.get(1, 30, 1)).toBe(0);
    // a different untouched column still equals the pure generator
    const pure = new WorldState(SEED);
    expect(ws.get(2, 30, 2)).toBe(pure.get(2, 30, 2));
  });

  it('satisfies the A3 collider contract (isSolid/isLiquid)', () => {
    const ws = new WorldState(SEED);
    ws.set(0, 1, 0, BLOCKS.stone.id);
    expect(ws.isSolid(0, 1, 0)).toBe(true);
    ws.set(0, 1, 0, 0);
    expect(ws.isSolid(0, 1, 0)).toBe(false);
    ws.set(0, 1, 0, BLOCKS.water.id);
    expect(ws.isLiquid(0, 1, 0)).toBe(true);
  });
});

describe('targeting (DDA voxel raycast)', () => {
  function stubWorld(blocks) {
    // blocks: Map of "x,y,z" -> id; everything else air (0)
    return {
      get: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? 0,
    };
  }

  it('cameraDirection stays a unit vector and faces -Z at yaw 0', () => {
    const d = cameraDirection(0, 0);
    expect(d.z).toBeLessThan(0);
    const len = Math.hypot(d.x, d.y, d.z);
    expect(len).toBeCloseTo(1);
  });

  it('hits the first solid block along the ray and yields the place cell', () => {
    const world = stubWorld(new Map([['5,1,5', BLOCKS.stone.id]]));
    // Start at (0,1,0.5) looking toward +x so the walk crosses (5,1,5).
    const hit = raycastBlock(world, { x: 0, y: 1, z: 5.5 }, { x: 1, y: 0, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit.x).toBe(5);
    expect(hit.y).toBe(1);
    expect(hit.z).toBe(5);
    // hit from -x face, so place cell is just before it (x-1)
    expect(hit.nx).toBe(4);
  });

  it('returns null when nothing solid is within max distance', () => {
    const world = stubWorld(new Map([['100,1,0', BLOCKS.stone.id]]));
    const hit = raycastBlock(world, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 6);
    expect(hit).toBeNull();
  });
});

describe('hardness-based breaking', () => {
  it('dirt breaks faster than stone by hardness', () => {
    expect(breakTimeSeconds(BLOCKS.dirt)).toBeLessThan(breakTimeSeconds(BLOCKS.stone));
  });

  it('unbreakable blocks have infinite break time', () => {
    expect(breakTimeSeconds(BLOCKS.bedrock)).toBe(Infinity);
    expect(breakTimeSeconds(BLOCKS.air)).toBe(Infinity);
  });

  it('accumulates progress and completes only after hardness time', () => {
    const b = new Breaking();
    const target = { x: 1, y: 1, z: 1 };
    const time = breakTimeSeconds(BLOCKS.stone);
    let completed = false;
    const steps = Math.ceil(time / 0.05);
    for (let i = 0; i < steps; i++) {
      completed = b.update(target, BLOCKS.stone, 0.05);
    }
    expect(completed).toBe(true);
  });

  it('resets progress when retargeting a different block', () => {
    const b = new Breaking();
    const t1 = { x: 1, y: 1, z: 1 };
    const t2 = { x: 2, y: 1, z: 1 };
    b.update(t1, BLOCKS.stone, 0.4);
    expect(b.progressOf(t1)).toBeGreaterThan(0);
    b.update(t2, BLOCKS.stone, 0.4);
    expect(b.progressOf(t2)).toBeCloseTo(0.4 / breakTimeSeconds(BLOCKS.stone), 5);
    expect(b.progressOf(t1)).toBe(0);
  });
});

describe('inventory / hotbar stacking', () => {
  it('has 9 hotbar slots and empty initial state', () => {
    expect(HOTBAR_SIZE).toBe(9);
    const inv = createInventory();
    expect(inv.stacks).toHaveLength(9);
    expect(inv.total()).toBe(0);
    expect(inv.selectedEmpty()).toBe(true);
  });

  it('stacks up to the stack limit and then fills new slots', () => {
    const inv = createInventory();
    const stone = BLOCKS.stone.id;
    expect(stackCapacity(stone)).toBe(64);
    // 9 slots * 64 = 576 capacity; 600 pushes 24 over.
    const leftover = inv.add(stone, 600);
    expect(leftover).toBe(24);
    expect(inv.total()).toBe(576);
    expect(inv.stacks[0].count).toBe(64);
    expect(inv.stacks[8].count).toBe(64);
  });

  it('merges onto an existing partial stack before new slots', () => {
    const inv = createInventory();
    const stone = BLOCKS.stone.id;
    inv.add(stone, 10);
    inv.add(stone, 10);
    expect(inv.stacks[0].count).toBe(20);
    expect(inv.stacks[1].count).toBe(0);
  });

  it('respects per-item stack limits (tools stack to 1)', () => {
    expect(stackCapacity(ITEMS.wood_sword.id)).toBe(1);
  });

  it('select/takeSelected decrements the selected slot', () => {
    const inv = createInventory();
    const stone = BLOCKS.stone.id;
    inv.add(stone, 10);
    inv.select(0);
    expect(inv.hasSelected(stone, 3)).toBe(true);
    inv.takeSelected(3);
    expect(inv.stacks[0].count).toBe(7);
  });

  it('naming resolves both blocks and items', () => {
    expect(itemName(BLOCKS.stone.id)).toBe('stone');
    expect(itemName(ITEMS.coal.id)).toBe('coal');
  });
});

describe('item drops + pickup', () => {
  it('drops a placeable block for itself (mine->inventory->place)', () => {
    expect(dropForBlock(BLOCKS.stone.id)).toBe(BLOCKS.stone.id);
    expect(dropForBlock(BLOCKS.dirt.id)).toBe(BLOCKS.dirt.id);
    expect(dropForBlock(BLOCKS.sand.id)).toBe(BLOCKS.sand.id);
  });

  it('maps special drops (grass->dirt, ores->resources)', () => {
    expect(dropForBlock(BLOCKS.grass.id)).toBe(BLOCKS.dirt.id);
    expect(dropForBlock(BLOCKS.coal_ore.id)).toBe(ITEMS.coal.id);
    expect(dropForBlock(BLOCKS.iron_ore.id)).toBe(ITEMS.iron_ingot.id);
  });

  it('returns null for leaves/liquids/unbreakable', () => {
    expect(dropForBlock(BLOCKS.leaves.id)).toBeNull();
    expect(dropForBlock(BLOCKS.water.id)).toBeNull();
    expect(dropForBlock(BLOCKS.bedrock.id)).toBeNull();
  });

  it('drops fall, rest on ground, stay alive < shelf life', () => {
    // ground at y=0 (solid floor below)
    const world = { isSolid: (x, y, z) => y <= 0 };
    const drop = createDrop(3, 10, 3, BLOCKS.stone.id);
    for (let i = 0; i < 300; i++) stepDrop(drop, world, 1 / 20);
    expect(drop.alive).toBe(true);
    expect(drop.vy).toBeCloseTo(0, 5); // resting
    expect(drop.y).toBeGreaterThan(0);
  });

  it('canPickup is true within pickup radius and false far away', () => {
    const drop = createDrop(0, 5, 0, BLOCKS.stone.id);
    drop.x = 10;
    drop.y = 4;
    drop.z = 10;
    expect(canPickup(drop, { x: 10, y: 4, z: 10 })).toBe(true);
    expect(canPickup(drop, { x: 10, y: 4, z: 30 })).toBe(false);
  });
});
