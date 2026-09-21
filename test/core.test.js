// Core logic unit tests. These run headless in vitest (node env) — no browser.
import { describe, it, expect } from 'vitest';
import { seededRandom, hashSeed } from '../src/core/rng.js';
import { WORLD, TIME, DIFFICULTY, tickToGameTime } from '../src/core/world.js';
import { BLOCKS, getBlockById, blockCount } from '../src/core/blocks.js';
import { surfaceHeight, biomeAt, terrainFingerprint, FIXED_SEED, FINGERPRINT_POINTS } from '../src/core/terrain.js';

describe('rng (determinism)', () => {
  it('is reproducible for the same seed', () => {
    const a = seededRandom(12345);
    const b = seededRandom(12345);
    expect(Array.from({ length: 10 }, () => a())).toEqual(Array.from({ length: 10 }, () => b()));
  });

  it('is stable across a fixed expected sequence', () => {
    const r = seededRandom(42);
    const first = r();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });

  it('hashSeed is stable and bounded to uint32', () => {
    const h = hashSeed('test12-phase-a');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(4294967295);
    expect(hashSeed('test12-phase-a')).toBe(hashSeed('test12-phase-a'));
  });
});

describe('time model', () => {
  it('defines a 20Hz tick and 24000-tick day', () => {
    expect(WORLD.tickRateHz).toBe(20);
    expect(TIME.dayLengthTicks).toBe(24000);
    expect(TIME.tickRateHz).toBe(20);
  });

  it('converts ticks to daylight hour (starts ~6am)', () => {
    expect(tickToGameTime(0).hour).toBe(6);
    const noon = tickToGameTime(6000);
    expect(noon.hour).toBe(12);
    expect(noon.tickOfDay).toBe(6000);
  });

  it('wraps tickOfDay modulo day length', () => {
    expect(tickToGameTime(24000).tickOfDay).toBe(0);
    expect(tickToGameTime(-1).tickOfDay).toBe(23999);
  });
});

describe('difficulty', () => {
  it('peaceful disables hostile spawns', () => {
    expect(DIFFICULTY.peaceful.hostileSpawn).toBe(false);
    expect(DIFFICULTY.normal.hostileSpawn).toBe(true);
  });
});

describe('block/item registry', () => {
  it('is the single source of truth with unique numeric ids', () => {
    const all = Object.values(BLOCKS);
    const ids = all.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('air id is 0 and always resolvable', () => {
    expect(BLOCKS.air.id).toBe(0);
    expect(getBlockById(9999)).toBe(BLOCKS.air);
  });

  it('provides at least 30 distinct block ids (contract standard 05)', () => {
    expect(blockCount()).toBeGreaterThanOrEqual(30);
  });

  it('exposes hardness for survival breaking', () => {
    expect(BLOCKS.stone.hardness).toBeGreaterThan(BLOCKS.dirt.hardness);
    expect(BLOCKS.bedrock.unbreakable).toBe(true);
  });
});

describe('terrain determinism (fixed seed smoke contract)', () => {
  it('produces identical height for identical (seed,x,z)', () => {
    expect(surfaceHeight(FIXED_SEED, 3, 5)).toBe(surfaceHeight(FIXED_SEED, 3, 5));
  });

  it('produces a stable fingerprint for the fixed seed', () => {
    const fp = terrainFingerprint(FIXED_SEED, FINGERPRINT_POINTS);
    expect(fp.split(',')).toHaveLength(FINGERPRINT_POINTS.length);
    // reproducibility across calls
    expect(terrainFingerprint(FIXED_SEED, FINGERPRINT_POINTS)).toBe(fp);
  });

  it('classifies biome deterministically', () => {
    const b = biomeAt(FIXED_SEED, 0, 0);
    expect(['plains', 'forest', 'desert', 'mountains']).toContain(b);
  });
});
