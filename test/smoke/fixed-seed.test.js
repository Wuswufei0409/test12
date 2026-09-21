// Fixed-seed smoke test — asserts a fixed fingerprint so CI can detect world
// generation regressions. Run explicitly via `npm run smoke`.
import { describe, it, expect } from 'vitest';
import {
  terrainFingerprint,
  fixedSample,
  FIXED_SEED,
  FINGERPRINT_POINTS,
} from '../../src/core/terrain.js';

describe('fixed-seed smoke', () => {
  it('locks terrain fingerprint for LOCKED_SEED', () => {
    // Golden value: if world-gen changes, update after confirming intentional.
    const expected = '26,14,15,24,28,16,23,23';
    expect(terrainFingerprint(FIXED_SEED, FINGERPRINT_POINTS)).toBe(expected);
  });

  it('locks fixed-coordinate biome+height sample (reproducibility evidence)', () => {
    // Pins biome AND surface height at fixed coordinates: strong evidence that
    // the same seed reproduces the same terrain and biomes.
    const expected =
      'warm_ocean@26|deep_ocean@14|deep_ocean@15|warm_ocean@24|shallow_ocean@28|deep_ocean@16|warm_ocean@23|forest@23';
    expect(fixedSample(FIXED_SEED, FINGERPRINT_POINTS)).toBe(expected);
  });

  it('is reproducible across repeated calls within a process', () => {
    // Determinism across calls (guards against cache-order coupling).
    const a = fixedSample(FIXED_SEED, FINGERPRINT_POINTS);
    const b = fixedSample(FIXED_SEED, FINGERPRINT_POINTS);
    expect(b).toBe(a);
  });
});
