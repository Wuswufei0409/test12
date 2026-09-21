// Edit-aware chunk meshing for A4. Builds merged BufferGeometry for one chunk
// by reading a mutable world accessor (WorldState) instead of the pure A2
// worldgen lookup, so mined/placed blocks are reflected as soon as a chunk
// mesh is rebuilt. Interior faces are culled against neighbours exactly like
// the A2 mesher, keeping the baseline look identical when no edits exist.
//
// Determinism: with an untouched WorldState, world.get() === blockAt(), so the
// generated mesh is byte-identical to the A2 pure mesher.
import * as THREE from 'three';
import { CHUNK } from '../core/worldgen.js';
import { getBlockById } from '../core/blocks.js';
import { getAtlasTexture, tileUV, TILES } from './atlas.js';

const CS = CHUNK.size;
const CH = CHUNK.height;

const FACES = [
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/**
 * Build geometry for the chunk at (chunkX, chunkZ) from `world.get(x,y,z)`.
 * @param {object} world  WorldState (or any object with get(x,y,z)).
 * @param {number} chunkX
 * @param {number} chunkZ
 */
export function buildChunkMesh(world, chunkX, chunkZ) {
  const x0 = chunkX * CS;
  const z0 = chunkZ * CS;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vi = 0;

  for (let dx = 0; dx < CS; dx++) {
    for (let y = 0; y < CH; y++) {
      for (let dz = 0; dz < CS; dz++) {
        const wx = x0 + dx;
        const wz = z0 + dz;
        const id = world.get(wx, y, wz);
        const block = getBlockById(id);
        if (!block || block.id === 0 || block.liquid) continue;

        const tile = id % TILES;
        const [u0, v0, u1, v1] = tileUV(tile);

        for (const face of FACES) {
          const nb = getBlockById(world.get(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]));
          if (nb && nb.id !== 0 && nb.solid) continue; // hidden face

          for (const c of face.corners) {
            positions.push(wx + c[0], y + c[1], wz + c[2]);
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
