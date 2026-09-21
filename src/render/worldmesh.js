// Edit-aware chunk meshing for A4. Builds merged BufferGeometry for one chunk
// by reading a mutable world accessor (WorldState) instead of the pure A2
// worldgen lookup, so mined/placed blocks are reflected as soon as a chunk
// mesh is rebuilt. Interior faces are culled against neighbours exactly like
// the A2 mesher, keeping the baseline look identical when no edits exist.
//
// Determinism: with an untouched WorldState, world.get() === blockAt(), so the
// generated mesh is byte-identical to the A2 pure mesher.
//
// R-02 (crit 02) visual fixes:
//  - side faces now project the full tile texture (u along the face's
//    horizontal axis, v along its vertical axis) instead of a 1-D stretched
//    row/column that made block faces look corrupted/banded;
//  - liquid (water) cells are emitted as a separate translucent water mesh so
//    large oceans render a visible surface instead of an empty void.
import * as THREE from 'three';
import { CHUNK } from '../core/worldgen.js';
import { getBlockById } from '../core/blocks.js';
import { getAtlasTexture, tileUV, TILES } from './atlas.js';

const CS = CHUNK.size;
const CH = CHUNK.height;

// `uAxis`/`vAxis` are the corner-component indices (0=x,1=y,2=z) that drive the
// texture u/v so every face projects the full tile (side faces stretch v along
// y and u along the horizontal axis; top/bottom stretch u along x, v along z).
const FACES = [
  { dir: [1, 0, 0], uAxis: 2, vAxis: 1, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, // +x
  { dir: [-1, 0, 0], uAxis: 2, vAxis: 1, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] }, // -x
  { dir: [0, 1, 0], uAxis: 0, vAxis: 2, corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] }, // +y top
  { dir: [0, -1, 0], uAxis: 0, vAxis: 2, corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] }, // -y bottom
  { dir: [0, 0, 1], uAxis: 0, vAxis: 1, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, // +z
  { dir: [0, 0, -1], uAxis: 0, vAxis: 1, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }, // -z
];

const AIR = 0;

/**
 * Build the opaque solid geometry for the chunk at (chunkX, chunkZ).
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
            uvs.push(c[face.uAxis] === 1 ? u1 : u0, c[face.vAxis] === 1 ? v0 : v1);
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

/**
 * Build a translucent water-volume geometry for the chunk. Every liquid cell
 * emits its top surface and any vertical perimeter/side face whose neighbour
 * is not water (the shore front and the far edge of the basin), so oceans read
 * as a filled blue volume from a coastal view instead of an empty void. The
 * bottom face is skipped (it sits on the sea floor). Result is null when the
 * chunk has no water to render.
 */
export function buildWaterMesh(world, chunkX, chunkZ) {
  const x0 = chunkX * CS;
  const z0 = chunkZ * CS;
  const positions = [];
  const normals = [];
  const indices = [];
  let vi = 0;
  let emitted = false;

  for (let dx = 0; dx < CS; dx++) {
    for (let y = 0; y < CH; y++) {
      for (let dz = 0; dz < CS; dz++) {
        const wx = x0 + dx;
        const wz = z0 + dz;
        const id = world.get(wx, y, wz);
        const block = getBlockById(id);
        if (!block || !block.liquid) continue;

        for (let fi = 0; fi < FACES.length; fi++) {
          const face = FACES[fi];
          // Skip the downward face (sits on the sea floor / buried).
          if (face.dir[1] === -1) continue;
          const nid = world.get(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]);
          const nb = getBlockById(nid);
          if (nb && nb.liquid) continue; // interior of the water volume

          for (const c of face.corners) {
            positions.push(wx + c[0], y + c[1], wz + c[2]);
            normals.push(face.dir[0], face.dir[1], face.dir[2]);
          }
          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          vi += 4;
          emitted = true;
        }
      }
    }
  }

  if (!emitted) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

// A reusable translucent water material (shared across chunks).
let waterMat = null;
export function waterMaterial() {
  if (!waterMat) {
    waterMat = new THREE.MeshLambertMaterial({
      color: 0x3a7fd6,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
  }
  return waterMat;
}
