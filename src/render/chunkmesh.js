// Builds merged THREE.BufferGeometry for a chunk, culling faces against
// neighbors so only visible voxel faces are emitted. Uses the procedural
// pixel-texture atlas for UVs and per-block tile colors.
//
// Interior face culling reads the precomputed chunk block array (fast); only
// blocks touching a chunk border consult the (slower) worldgen blockAt for the
// neighbor column. This keeps chunk rebuilds cheap while staying deterministic.
import * as THREE from 'three';
import { CHUNK, generateChunk, blockAt } from '../core/worldgen.js';
import { getBlockById } from '../core/blocks.js';
import { getAtlasTexture, tileUV, TILES } from './atlas.js';

const CS = CHUNK.size;
const CH = CHUNK.height;

const FACES = [
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, // +x
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] }, // -x
  { dir: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] }, // +y top
  { dir: [0, -1, 0], corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] }, // -y bottom
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, // +z
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }, // -z
];

// Index into the chunk flat array for a block-local (x,y,z).
const idx = (x, y, z) => x + z * CS + y * CS * CS;

// Neighbor block id. Uses the chunk array when inside it, otherwise worldgen.
function neighborId(seed, arr, x0, z0, wx, wy, wz, dx, dz) {
  const lx = wx - x0;
  const lz = wz - z0;
  if (lx >= 0 && lx < CS && lz >= 0 && lz < CS) {
    return arr[idx(lx, wy, lz)];
  }
  return blockAt(seed, wx, wy, wz);
}

// Build geometry for one chunk at (chunkX, chunkZ).
export function buildChunkMesh(seed, chunkX, chunkZ) {
  const x0 = chunkX * CS;
  const z0 = chunkZ * CS;
  const arr = generateChunk(seed, chunkX, chunkZ);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vi = 0;

  for (let lx = 0; lx < CS; lx++) {
    for (let wy = 0; wy < CH; wy++) {
      for (let lz = 0; lz < CS; lz++) {
        const id = arr[idx(lx, wy, lz)];
        const block = getBlockById(id);
        if (!block || block.id === 0 || block.liquid) continue;
        const wx = x0 + lx;
        const wz = z0 + lz;
        const tile = block.id % TILES;
        const [u0, v0, u1, v1] = tileUV(tile);

        for (const face of FACES) {
          const nx = wx + face.dir[0];
          const ny = wy + face.dir[1];
          const nz = wz + face.dir[2];
          const neigh = getBlockById(neighborId(seed, arr, x0, z0, nx, ny, nz, face.dir[0], face.dir[2]));
          // Show a face when neighbor is air, liquid, or non-solid.
          if (neigh && neigh.id !== 0 && neigh.solid) continue;

          for (const c of face.corners) {
            positions.push(wx + c[0], wy + c[1], wz + c[2]);
            normals.push(face.dir[0], face.dir[1], face.dir[2]);
            uvs.push(c[0] === 1 ? u1 : u0, c[2] === 1 ? v0 : v1);
          }
          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          vi += 4;
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export { generateChunk };

// A reusable material for solid-chunk meshes.
let solidMat = null;
export function solidMaterial() {
  if (!solidMat) {
    solidMat = new THREE.MeshLambertMaterial({ map: getAtlasTexture() });
  }
  return solidMat;
}
