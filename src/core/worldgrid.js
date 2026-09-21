// Simple dense grid world used by unit tests and as the browser-side collision
// source. Coordinates are integer block positions; unknown = air (id 0).
// Adopts CONTRACT.md §CoordinateSystem. relies on blocks.js solidity/liquid.
import { isSolidBlock, isLiquidBlock } from './physics.js';

export class WorldGrid {
  constructor() {
    this.map = new Map();
  }

  set(x, y, z, blockId) {
    const key = `${x},${y},${z}`;
    if (!blockId) this.map.delete(key);
    else this.map.set(key, blockId);
  }

  get(x, y, z) {
    return this.map.get(`${x},${y},${z}`) ?? 0;
  }

  isSolid(x, y, z) {
    return isSolidBlock(this.get(x, y, z));
  }

  isLiquid(x, y, z) {
    return isLiquidBlock(this.get(x, y, z));
  }

  // Fill a solid floor slab from y=0..yMax-1 over the x/z rectangle.
  fillFloor(blockId, yMax, x0, x1, z0, z1) {
    for (let by = 0; by < yMax; by += 1) {
      for (let bx = x0; bx <= x1; bx += 1) {
        for (let bz = z0; bz <= z1; bz += 1) {
          this.set(bx, by, bz, blockId);
        }
      }
    }
  }
}
