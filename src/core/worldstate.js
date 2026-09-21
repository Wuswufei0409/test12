// Mutable world layer over A2's deterministic procedural terrain.
//
// A2 worldgen (worldgen.js) exposes an IMMUTABLE, per-seed block lookup
// (`blockAt`) — perfect for reproducing the same terrain every load, but it
// cannot store player edits. A4 introduces an edit overlay: a small Map of
// (x,y,z) -> block id that is consulted BEFORE the procedural terrain, so a
// player can mine blocks to air and place new blocks on top of the generated
// world. With no edits the overlay is a no-op and behaviour is identical to
// the pure world generator (determinism preserved).
//
// Also implements the AABB-collider contract that A3 physics expects
// (isSolid / isLiquid at integer block coords), so the same object feeds both
// the mesher and the player collision solver.
import { blockAt } from './worldgen.js';
import { isSolidBlock, isLiquidBlock } from './physics.js';

export class WorldState {
  /**
   * @param {string} seed  world seed (drives the procedural terrain, A2).
   * @param {Map<string,number>} [edits] existing edit overlay (x,y,z -> id).
   */
  constructor(seed, edits = new Map()) {
    this.seed = seed;
    this.edits = edits;
  }

  static key(x, y, z) {
    return `${x},${y},${z}`;
  }

  /** Block id at integer coords — edit overlay first, else generated terrain. */
  get(x, y, z) {
    const k = WorldState.key(x, y, z);
    if (this.edits.has(k)) return this.edits.get(k);
    return blockAt(this.seed, x, y, z);
  }

  /**
   * Write a block edit. id 0 clears the block to air (stored explicitly so
   * mining a placed block does not "reveal" the terrain beneath it).
   */
  set(x, y, z, id) {
    this.edits.set(WorldState.key(x, y, z), id);
  }

  /** True when the value at (x,y,z) differs from untouched generated terrain. */
  isEdited(x, y, z) {
    return this.edits.has(WorldState.key(x, y, z));
  }

  // --- A3 collider contract (used by createPlayer/stepPlayer) ---
  isSolid(x, y, z) {
    return isSolidBlock(this.get(x, y, z));
  }

  isLiquid(x, y, z) {
    return isLiquidBlock(this.get(x, y, z));
  }
}
