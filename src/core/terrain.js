// Deterministic heightmap generation keyed by (seed, x, z). Returns surface
// height and biome tag. This is the basis for the fixed-seed smoke test and
// for later real chunk terrain. SEE CONTRACT.md §Seeds / §CoordinateSystem.
import { seededRandom, hashSeed } from './rng.js';

const BIOMES = ['plains', 'forest', 'desert', 'mountains'];

export function biomeAt(seed, x, z) {
  const rng = seededRandom(hashSeed(`${seed}:biome:${Math.floor(x / 8)}:${Math.floor(z / 8)}`));
  const r = rng();
  return BIOMES[Math.min(BIOMES.length - 1, Math.floor(r * BIOMES.length))];
}

export function surfaceHeight(seed, x, z) {
  const rng = seededRandom(hashSeed(`${seed}:h:${Math.floor(x) * 73856093 ^ Math.floor(z) * 19349663}`));
  // smooth-ish deterministic noise via layered values
  const n1 = rng();
  const n2 = rng();
  const h = Math.floor((n1 + n2 * 0.5) * 6 + 1); // 1..8
  return h;
}

// Fixed-coordinate fingerprint for a seed: concatenation of heights along a
// route. Used by the fixed-seed smoke test to assert reproducibility.
export function terrainFingerprint(seed, points) {
  return points.map(([x, z]) => surfaceHeight(seed, x, z)).join(',');
}

export const FIXED_SEED = 'test12-phase-a';
export const FINGERPRINT_POINTS = [
  [-16, -16],
  [0, 0],
  [8, 8],
  [16, -16],
  [-8, 24],
];
