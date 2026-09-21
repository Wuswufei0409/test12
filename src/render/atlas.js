// Procedural pixel texture atlas. Generates a single canvas texture holding a
// 16x16 pixel tile per block id. Purely procedural (seeded dithering) so no
// Minecraft assets are used — this is original art reproducing the pixel look.
import * as THREE from 'three';
import { BLOCKS } from '../core/blocks.js';
import { seededRandom, hashSeed } from '../core/rng.js';

export const TILE = 16; // px per tile
export const ATLAS = 16; // tiles per row
export const TILES = 64; // total tiles (plenty for the current registry)

function makeAtlasTexture() {
  const canvas = document.createElement('canvas');
  const px = ATLAS * TILE;
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const entries = Object.values(BLOCKS).filter((b) => b.id !== 0);
  for (const b of entries) {
    const tileIndex = b.id % TILES;
    const tx = (tileIndex % ATLAS) * TILE;
    const ty = Math.floor(tileIndex / ATLAS) * TILE;
    drawTile(ctx, tx, ty, b);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Draw one 16x16 procedurally dithered tile for a block definition.
function drawTile(ctx, ox, oy, block) {
  const base = block.color ?? 0x808080;
  const r = (base >> 16) & 255;
  const g = (base >> 8) & 255;
  const b = base & 255;
  const rng = seededRandom(hashSeed(`tile:${block.name}`));
  const variation = block.solid ? 0.85 : 0.7;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = 0.7 + rng() * variation;
      ctx.fillStyle = `rgb(${Math.min(255, r * v) | 0},${Math.min(255, g * v) | 0},${Math.min(255, b * v) | 0})`;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
  // Subtle darker edge to read as voxel pixels.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(ox, oy, TILE, 1);
  ctx.fillRect(ox, oy + TILE - 1, TILE, 1);
}

let cached = null;
export function getAtlasTexture() {
  if (!cached) cached = makeAtlasTexture();
  return cached;
}

// UV quad for a tile index in the atlas.
export function tileUV(index) {
  const tx = (index % ATLAS) * TILE;
  const ty = Math.floor(index / ATLAS) * TILE;
  const u0 = tx / (ATLAS * TILE);
  const v0 = 1 - (ty + TILE) / (ATLAS * TILE);
  const u1 = (tx + TILE) / (ATLAS * TILE);
  const v1 = 1 - ty / (ATLAS * TILE);
  return [u0, v0, u1, v1];
}
