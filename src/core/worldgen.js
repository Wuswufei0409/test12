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
const ICE = bid('ice');
const KELP = bid('kelp_block');
const SEAGRASS = bid('seagrass');
const CORAL_BLOCK = bid('coral_block');
const CORAL_PLANT = bid('coral_plant');
const ICE_BERG = bid('ice_berg');

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

  // --- B5 ocean content decoration (deterministic per column) ---
  if (isOcean) {
    const depth = SEA_LEVEL - height; // water depth above the floor
    const floor = height + 1;         // first water cell above the sea floor
    // seagrass on the sea floor (shallow-ish)
    if (depth >= 1 && depth <= 14 && rng() < 0.55) {
      col[Math.min(floor, CH - 1)] = SEAGRASS;
    }
    // coral cluster in warm ocean, near the floor
    if (biome === 'warm_ocean' && depth >= 2 && depth <= 12 && rng() < 0.6) {
      const cb = Math.min(floor, CH - 1);
      col[cb] = rng() < 0.5 ? CORAL_PLANT : CORAL_BLOCK;
      if (cb + 1 <= SEA_LEVEL) col[cb + 1] = CORAL_PLANT;
    }
    // kelp column growing up within the water
    if (depth >= 2 && rng() < 0.35) {
      const kelpLen = 1 + Math.floor(rng() * Math.min(4, depth));
      for (let k = 0; k < kelpLen; k += 1) {
        const ky = floor + k;
        if (ky > SEA_LEVEL) break;
        if (col[ky] === WATER || col[ky] === A) col[ky] = KELP;
      }
    }
    // iceberg shelf in cold ocean: frozen surface blocks poking above water
    if (biome === 'cold_ocean' && depth <= 4 && rng() < 0.25) {
      for (let k = 0; k <= 2; k += 1) {
        const y = Math.min(SEA_LEVEL + k, CH - 1);
        col[y] = k === 0 ? ICE_BERG : (rng() < 0.7 ? ICE_BERG : SNOW);
      }
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
  // Air, water, and non-solid foliage (kelp/seagrass/coral plant) do not
  // hide adjacent faces — they render as translucent/cross geometry.
  const def = blockDefById(b);
  if (!def) return false;
  return def.solid === true && b !== WATER;
}

function blockDefById(id) {
  return Object.values(BLOCKS).find((x) => x.id === id);
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
