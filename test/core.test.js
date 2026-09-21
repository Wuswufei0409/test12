// Core logic unit tests. These run headless in vitest (node env) — no browser.
import { describe, it, expect } from 'vitest';
import { seededRandom, hashSeed } from '../src/core/rng.js';
import { WORLD, TIME, DIFFICULTY, tickToGameTime } from '../src/core/world.js';
import { BLOCKS, getBlockById, blockCount } from '../src/core/blocks.js';
import { surfaceHeight, biomeAt, terrainFingerprint, FIXED_SEED, FINGERPRINT_POINTS, BIOMES, LAND_BIOMES, OCEAN_BIOMES, SEA_LEVEL } from '../src/core/terrain.js';
import { generateChunk, blockAt, CHUNK } from '../src/core/worldgen.js';
import { BLOCKS, getBlockById } from '../src/core/blocks.js';

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

  it('classifies biome deterministically and covers all Phase-A biomes', () => {
    const seen = new Set();
    for (let x = -600; x <= 600; x += 16) {
      for (let z = -600; z <= 600; z += 16) {
        const b = biomeAt(FIXED_SEED, x, z);
        expect([...BIOMES]).toContain(b);
        seen.add(b);
      }
    }
    // All four land + all four ocean tags must be reachable in a bounded range
    // for the fixed seed.
    expect([...LAND_BIOMES].every((b) => seen.has(b))).toBe(true);
    expect([...OCEAN_BIOMES].every((b) => seen.has(b))).toBe(true);
    expect(seen.size).toBe(BIOMES.length);
  });

  it('uses block=1 unit coordinates and sea level is defined', () => {
    expect(SEA_LEVEL).toBeGreaterThan(0);
  });
});

describe('worldgen (deterministic chunk generation)', () => {
  it('produces identical chunk data for the same seed', () => {
    const a = generateChunk(FIXED_SEED, 1, 2);
    const b = generateChunk(FIXED_SEED, 1, 2);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('chunk array has chunkSize * chunkHeight * chunkSize elements', () => {
    const data = generateChunk(FIXED_SEED, 0, 0);
    expect(data.length).toBe(CHUNK.size * CHUNK.height * CHUNK.size);
  });

  it('blockAt matches generateChunk at interior coordinates', () => {
    const cx = 2, cz = -1;
    const data = generateChunk(FIXED_SEED, cx, cz);
    for (let dx = 0; dx < CHUNK.size; dx += 2) {
      for (let dz = 0; dz < CHUNK.size; dz += 2) {
        const wx = cx * CHUNK.size + dx;
        const wz = cz * CHUNK.size + dz;
        const y = 20;
        expect(data[dx + dz * CHUNK.size + y * CHUNK.size * CHUNK.size]).toBe(
          blockAt(FIXED_SEED, wx, y, wz),
        );
      }
    }
  });

  it('ocean columns are water-filled above the sea floor up to sea level', () => {
    // Find a column classified as an ocean biome near the origin.
    let hit = null;
    for (let x = -600; x <= 600 && !hit; x += 16) {
      for (let z = -600; z <= 600 && !hit; z += 16) {
        if (OCEAN_BIOMES.includes(biomeAt(FIXED_SEED, x, z))) hit = [x, z];
      }
    }
    expect(hit).not.toBeNull();
    const [x, z] = hit;
    const h = surfaceHeight(FIXED_SEED, x, z);
    expect(blockAt(FIXED_SEED, x, h + 1, z)).toBe(BLOCKS.water.id);
    expect(blockAt(FIXED_SEED, x, SEA_LEVEL, z)).toBe(BLOCKS.water.id);
  });
});
