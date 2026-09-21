// Fixed-seed smoke test — asserts a fixed fingerprint so CI can detect world
// generation regressions. Run explicitly via `npm run smoke`.
import { describe, it, expect } from 'vitest';
import { terrainFingerprint, FIXED_SEED, FINGERPRINT_POINTS } from '../../src/core/terrain.js';

describe('fixed-seed smoke', () => {
  it('locks terrain fingerprint for LOCKED_SEED', () => {
    // Golden value: if world-gen changes, update after confirming intentional.
    const expected = '2,7,4,3,8';
    expect(terrainFingerprint(FIXED_SEED, FINGERPRINT_POINTS)).toBe(expected);
  });
});
