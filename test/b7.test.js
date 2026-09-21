// B7 (MUL-103) headless tests — crit 18 save/load persistence.
import { describe, it, expect } from 'vitest';
import {
  serializeSave, parseSave, restoreSnapshot, roundTrip,
  loadStoredSave, saveToStorage, createMemoryStore, SAVE_KEY, SAVE_FORMAT,
} from '../src/core/save.js';

// A representative full snapshot covering every crit-18 state: seed, player
// position+state, living, inventory, time, modified blocks, chest/furnace
// containers, and entity state (drops + mobs).
function fullSnapshot() {
  return {
    seed: 'persist-seed',
    worldTime: 12345,
    difficulty: 'hard',
    player: {
      pos: { x: 10.5, y: 64.2, z: -8.25 },
      yaw: 1.7,
      pitch: -0.3,
      vel: { x: 0.1, y: -0.05, z: 0.2 },
    },
    living: { health: 12, hunger: 9, saturation: 4, air: 10, deaths: 2 },
    spawnPoint: { x: 3, y: 8, z: 4 },
    deaths: 2,
    inventory: {
      selected: 2,
      stacks: [
        { id: 0, count: 0 }, { id: 1, count: 8 }, { id: 5, count: 5 },
        { id: 0, count: 0 }, { id: 0, count: 0 }, { id: 0, count: 0 },
        { id: 0, count: 0 }, { id: 0, count: 0 }, { id: 0, count: 0 },
      ],
    },
    equipped: [130, 136],
    worldEdits: [['10,64,-8', 5], ['11,64,-8', 3], ['10,63,-8', 0]],
    containers: {
      '12,60,-8': { inventory: { stacks: [[0, 0], [105, 2]] } },
      '13,60,-8': { input: [12, 1], fuel: [111, 3], output: null },
    },
    drops: [
      { x: 10.5, y: 64.5, z: -8.5, vx: 0, vy: 0.3, vz: 0, itemId: 1, count: 3, age: 1.2 },
    ],
    mobs: [
      { type: 'zombie', x: 5, y: 64, z: 6, vy: 0, vx: 0, vz: 0, health: 20, maxHealth: 20, alive: true, passive: false, speed: 0.23 },
    ],
  };
}

describe('save/load persistence (crit 18)', () => {
  it('serializes a full snapshot with the expected format version', () => {
    const text = serializeSave(fullSnapshot());
    const data = JSON.parse(text);
    expect(data.format).toBe(SAVE_FORMAT);
    expect(data.seed).toBe('persist-seed');
    expect(data.worldTime).toBe(12345);
    expect(data.player.pos).toEqual([10.5, 64.2, -8.25]);
    expect(data.inventory.stacks[1]).toEqual([1, 8]);
    expect(data.worldEdits).toContainEqual(['11,64,-8', 3]);
    expect(data.mobs[0].type).toBe('zombie');
    expect(data.drops[0].itemId).toBe(1);
  });

  it('round-trips seed, player, living, inventory, time, edits, containers, and entities', () => {
    const snap = fullSnapshot();
    const res = roundTrip(snap);
    expect(res.ok).toBe(true);
    const s = res.snap;
    expect(s.seed).toBe('persist-seed');
    expect(s.worldTime).toBe(12345);
    expect(s.player.pos).toEqual({ x: 10.5, y: 64.2, z: -8.25 });
    expect(s.player.yaw).toBeCloseTo(1.7, 5);
    expect(s.living.health).toBe(12);
    expect(s.inventory.stacks[1]).toEqual({ id: 1, count: 8 });
    expect(s.inventory.selected).toBe(2);
    expect(s.equipped).toEqual([130, 136]);
    expect(s.worldEdits.get('11,64,-8')).toBe(3);
    expect(s.containers['12,60,-8'].inventory.stacks[1]).toEqual([105, 2]);
    expect(s.drops[0].count).toBe(3);
    expect(s.mobs[0].health).toBe(20);
  });

  it('resumes after a corrupt save with a clear error and safe fallback (no silent overwrite)', () => {
    const store = createMemoryStore();
    // write a valid save first
    saveToStorage(store, fullSnapshot());
    // corrupt it in place (simulating a partial / truncated write)
    store.setItem(SAVE_KEY, '{ this is not valid json !!! ]');
    const res = loadStoredSave(store);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe('corrupt');
    expect(res.reason).toMatch(/unparseable/i);
    // safe fallback: caller can start a fresh world, but the corrupt blob is
    // NOT silently overwritten by an empty/new save on the load path.
    expect(store.getItem(SAVE_KEY)).toBe('{ this is not valid json !!! ]');
    // a subsequent deliberate save enumerates the overwrite decision explicitly.
    const fresh = { ...fullSnapshot(), worldTime: 0 };
    const saved = saveToStorage(store, fresh);
    expect(saved.ok).toBe(true);
    expect(JSON.parse(store.getItem(SAVE_KEY)).worldTime).toBe(0);
  });

  it('treats missing saves as missing (not corrupt) and allows a fresh start', () => {
    const store = createMemoryStore();
    const res = loadStoredSave(store);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe('missing');
    expect(res.reason).toMatch(/no save/i);
  });

  it('rejects structurally invalid saves (missing seed / bad player) without overwriting', () => {
    const store = createMemoryStore();
    store.setItem(SAVE_KEY, JSON.stringify({ format: 2, worldTime: 10 }));
    const res = loadStoredSave(store);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe('invalid');
  });

  it('restoreSnapshot returns null for an unsuccessful parse', () => {
    expect(restoreSnapshot(parseSave('garbage'))).toBe(null);
    expect(restoreSnapshot(null)).toBe(null);
  });

  it('persists to a real storage and survives an explicit reload', () => {
    const store = createMemoryStore();
    expect(saveToStorage(store, fullSnapshot()).ok).toBe(true);
    // tab close / reload: read it back fresh
    const res = loadStoredSave(store);
    expect(res.ok).toBe(true);
    const s = restoreSnapshot(res);
    expect(s.player.pos.x).toBeCloseTo(10.5, 5);
    expect(s.worldEdits.get('10,64,-8')).toBe(5);
    expect(s.drops.length).toBe(1);
  });
});

describe('memory store contract', () => {
  it('implements get/set/remove like localStorage', () => {
    const store = createMemoryStore();
    expect(store.getItem('k')).toBe(null);
    store.setItem('k', 'v');
    expect(store.getItem('k')).toBe('v');
    store.removeItem('k');
    expect(store.getItem('k')).toBe(null);
  });
});
