// Deterministic chunk world generation. Produces an immutable 3D block array
// per chunk from a seed, using terrain.js height/biome logic and the block
// registry. Cross-module shapes mirror CONTRACT.md §BlockItemID / §WorldChunk.
import { BLOCKS } from './blocks.js';
import { WORLD } from './world.js';
import { OCEAN_BIOMES, SEA_LEVEL, columnAt } from './terrain.js';
import { seededRandom, hashSeed } from './rng.js';

const CS = WORLD.chunkSize;
const CH = WORLD.chunkHeight;

function bid(name) {
  const b = BLOCKS[name];
  return b ? b.id : 0;
}

// Air = id 0.
const A = bid('air');
const STONE = bid('stone');
const GRASS = bid('grass');
const DIRT = bid('dirt');
const SAND = bid('sand');
const GRAVEL = bid('gravel');
const BEDROCK = bid('bedrock');
const WATER = bid('water');
const SNOW = bid('snow');

// Build one column (all CH blocks) for a world position. Deterministic.
function buildColumn(seed, wx, wz) {
  const { biome, height } = columnAt(seed, wx, wz);
  const col = new Uint8Array(CH);
  const rng = seededRandom(hashSeed(`${seed}:col:${Math.floor(wx)}:${Math.floor(wz)}`));
  const isOcean = OCEAN_BIOMES.includes(biome);

  col[0] = BEDROCK;
  for (let y = 1; y < CH; y++) {
    if (y <= height) {
      const under = height - 3;
      if (y === height) {
        // Surface block.
        if (biome === 'desert') col[y] = SAND;
        else if (biome === 'mountains' && height > 36 && rng() < 0.5) col[y] = SNOW;
        else col[y] = GRASS;
      } else if (y === under && isOcean) {
        col[y] = rng() < 0.4 ? GRAVEL : SAND;
      } else if (y < under) {
        col[y] = STONE;
      } else {
        col[y] = DIRT;
      }
    } else if (isOcean && y <= SEA_LEVEL) {
      col[y] = WATER;
    } else {
      col[y] = A;
    }
  }
  return col;
}

// Memoized column cache keyed by world column coords (fast repeat sampling).
let colCache = new Map();
const COL_CACHE_MAX = 400000;
export function columnBlocks(seed, wx, wz) {
  const key = Math.floor(wx) * 131072 + Math.floor(wz);
  const hit = colCache.get(key);
  if (hit) return hit;
  if (colCache.size >= COL_CACHE_MAX) colCache = new Map();
  const out = buildColumn(seed, wx, wz);
  colCache.set(key, out);
  return out;
}

// Block at a world position. Deterministic, computed from the cached column.
export function blockAt(seed, wx, wy, wz) {
  const c = Math.floor(wy);
  if (c < 0 || c >= CH) return BEDROCK;
  return columnBlocks(seed, wx, wz)[c];
}

// Material metadata for meshing: true when a face should be hidden (opaque,
// not a plant/cross block, same texture on all sides).
export function isOpaque(seed, wx, wy, wz) {
  const b = blockAt(seed, wx, wy, wz);
  return b !== 0 && b !== WATER;
}

// Generate a full chunk (CS*CH*CS) as a flat Uint8Array of block ids, indexed
// [x + z*CS + y*CS*CS]. Deterministic per (seed, chunkX, chunkZ).
export function generateChunk(seed, chunkX, chunkZ) {
  const x0 = chunkX * CS;
  const z0 = chunkZ * CS;
  const data = new Uint8Array(CS * CH * CS);
  for (let dx = 0; dx < CS; dx++) {
    for (let dz = 0; dz < CS; dz++) {
      const col = columnBlocks(seed, x0 + dx, z0 + dz);
      for (let y = 0; y < CH; y++) {
        data[dx + dz * CS + y * CS * CS] = col[y];
      }
    }
  }
  return data;
}

export const CHUNK = { size: CS, height: CH };
export { CS as CHUNK_SIZE };
