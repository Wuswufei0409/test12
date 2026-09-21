// Deterministic seeded noise, biome classification and heightmap generation.
// This is the single source of terrain truth for world generation. A fixed
// seed must reproduce identical terrain everywhere.
//
// SEE CONTRACT.md §Seeds / §CoordinateSystem. Adding a biome is additive and
// must be mirrored in CONTRACT.md and the worldgen module.
import { seededRandom, hashSeed } from './rng.js';

// Sea level (top water surface y). Blocks above this on land are air.
export const SEA_LEVEL = 32;

// Full Phase-A biome set. Oceans are split into cold/warm/deep/shallow.
export const BIOMES = [
  'plains',
  'forest',
  'desert',
  'mountains',
  'cold_ocean',
  'warm_ocean',
  'deep_ocean',
  'shallow_ocean',
];

export const LAND_BIOMES = ['plains', 'forest', 'desert', 'mountains'];
export const OCEAN_BIOMES = ['cold_ocean', 'warm_ocean', 'deep_ocean', 'shallow_ocean'];

// 2D value noise in [0,1) with smooth interpolation. Deterministic per seed.
function valueNoise(seed, x, z, scale) {
  const xi = Math.floor(x / scale);
  const zi = Math.floor(z / scale);
  const fx = x / scale - xi;
  const fz = z / scale - zi;
  const cell = (ix, iz) => {
    const rng = seededRandom(hashSeed(`${seed}:n:${ix}:${iz}`));
    return rng();
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const sx = smooth(fx);
  const sz = smooth(fz);
  const a = cell(xi, zi);
  const b = cell(xi + 1, zi);
  const c = cell(xi, zi + 1);
  const d = cell(xi + 1, zi + 1);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
}

// One-shot deterministic (biome, height) for a column. Both derive from the
// same elevation sample so a single count of noise cells is needed.
function classify(seed, x, z) {
  const continental = valueNoise(`${seed}:cont`, x, z, 48);
  const detail = valueNoise(`${seed}:det`, x, z, 12);
  const temp = valueNoise(`${seed}:temp`, x, z, 26);
  const humid = valueNoise(`${seed}:humid`, x, z, 26);

  let biome;
  if (continental < 0.28) biome = 'deep_ocean';
  else if (continental < 0.4) biome = temp < 0.5 ? 'cold_ocean' : 'warm_ocean';
  else if (continental < 0.48) biome = 'shallow_ocean';
  else if (continental > 0.82) biome = 'mountains';
  else if (temp > 0.66) biome = 'desert';
  else if (humid > 0.56) biome = 'forest';
  else biome = 'plains';

  const rough = detail;
  let height;
  switch (biome) {
    case 'mountains': height = Math.floor(28 + rough * 16); break;
    case 'plains': height = Math.floor(20 + rough * 8); break;
    case 'forest': height = Math.floor(22 + rough * 9); break;
    case 'desert': height = Math.floor(18 + rough * 5); break;
    case 'deep_ocean': height = Math.floor(14 + rough * 6); break;
    case 'cold_ocean': height = Math.floor(22 + rough * 4); break;
    case 'warm_ocean': height = Math.floor(23 + rough * 4); break;
    case 'shallow_ocean': height = Math.floor(26 + rough * 4); break;
    default: height = Math.floor(20 + rough * 8); break;
  }
  return { biome, height };
}

// Memoized column cache — biome+height are O(1) after first query per column.
let colCache = new Map();
const CACHE_MAX = 300000;
export function columnAt(seed, x, z) {
  const xf = Math.floor(x);
  const zf = Math.floor(z);
  const key = (xf * 73856093) ^ (zf * 19349663) ^ hashSeed(seed);
  const hit = colCache.get(key);
  if (hit) return hit;
  if (colCache.size >= CACHE_MAX) colCache = new Map();
  const out = classify(seed, xf, zf);
  colCache.set(key, out);
  return out;
}

export function biomeAt(seed, x, z) {
  return columnAt(seed, x, z).biome;
}
export function surfaceHeight(seed, x, z) {
  return columnAt(seed, x, z).height;
}

// Find the nearest land column to a target, scanning outward, so the player
// spawns above ground even if the nominal origin is ocean.
export function findLandSpawn(seed, targetX = 0, targetZ = 0) {
  for (let r = 0; r < 512; r += 8) {
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      const x = Math.round(targetX + Math.cos(rad) * r);
      const z = Math.round(targetZ + Math.sin(rad) * r);
      const { biome, height } = columnAt(seed, x, z);
      if (!OCEAN_BIOMES.includes(biome)) {
        return { x, y: Math.max(SEA_LEVEL + 1, height + 2), z };
      }
    }
  }
  return { x: targetX, y: SEA_LEVEL + 1, z: targetZ };
}

// Fixed-coordinate fingerprint for a seed: concatenation of heights along a
// route. Used by the fixed-seed smoke test to assert reproducibility.
export function terrainFingerprint(seed, points) {
  return points.map(([x, z]) => surfaceHeight(seed, x, z)).join(',');
}

// Fixed-coordinate sample (biome+height per point) — stronger reproducibility
// evidence, covering both terrain and biome determinism.
export function fixedSample(seed, points) {
  return points
    .map(([x, z]) => `${biomeAt(seed, x, z)}@${surfaceHeight(seed, x, z)}`)
    .join('|');
}

export const FIXED_SEED = 'test12-phase-a';
export const FINGERPRINT_POINTS = [
  [-16, -16],
  [0, 0],
  [8, 8],
  [16, -16],
  [-8, 24],
  [72, -72],
  [120, 120],
  [0, 40],
];
