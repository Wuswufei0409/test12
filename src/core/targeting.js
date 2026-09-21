// DDA voxel raycasting: turn a camera ray into the exact block under the
// crosshair plus the face it entered. Pure module (no Three/DOM) so it is
// headless-unit-testable.
//
// Amanatides & Woo voxel traversal. `world` only needs a `.get(x,y,z)`
// accessor (WorldState satisfies it). Returns:
//   { x, y, z, id, faceX, faceY, faceZ, nx, ny, nz }
// where (nx,ny,nz) = (x+faceX, y+faceY, z+faceZ) is the air cell adjacent to
// the hit face — the legal placement position. Returns null when nothing solid
// is hit within `maxDist`.
import { isSolidBlock } from './physics.js';

export function raycastBlock(world, origin, dir, maxDist = 6) {
  // guard against zero vectors
  const dx = dir.x || 1e-9;
  const dy = dir.y || 1e-9;
  const dz = dir.z || 1e-9;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;

  const tDeltaX = Math.abs(1 / dx);
  const tDeltaY = Math.abs(1 / dy);
  const tDeltaZ = Math.abs(1 / dz);

  let tMaxX = (dx > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX;
  let tMaxY = (dy > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY;
  let tMaxZ = (dz > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ;

  let faceX = 0;
  let faceY = 0;
  let faceZ = 0;

  // Empirically bounded walk (chunk-scale) so a malformed ray never hangs.
  for (let i = 0; i < 256; i++) {
    if (isSolidBlock(world.get(x, y, z))) {
      return {
        x,
        y,
        z,
        id: world.get(x, y, z),
        faceX,
        faceY,
        faceZ,
        // The face the ray entered points back at the viewer; the legal place
        // cell is the empty cell adjacent on the near side (x - face*).
        nx: x - faceX,
        ny: y - faceY,
        nz: z - faceZ,
      };
    }

    // Step to the next voxel boundary along the nearest axis.
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      if (tMaxX > maxDist) break;
      x += stepX;
      tMaxX += tDeltaX;
      faceX = stepX;
      faceY = 0;
      faceZ = 0;
    } else if (tMaxY < tMaxZ) {
      if (tMaxY > maxDist) break;
      y += stepY;
      tMaxY += tDeltaY;
      faceY = stepY;
      faceX = 0;
      faceZ = 0;
    } else {
      if (tMaxZ > maxDist) break;
      z += stepZ;
      tMaxZ += tDeltaZ;
      faceZ = stepZ;
      faceX = 0;
      faceY = 0;
    }
  }
  return null;
}

// Continuous camera direction (unit vector) derived from yaw/pitch.
// yaw=0 faces -Z; pitch up positive. Mirrors the A3 camera convention.
export function cameraDirection(yaw, pitch) {
  const cp = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}
