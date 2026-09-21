// Creeper explosion (crit 11): carves a sphere out of the WorldState edit
// overlay, dropping excavated blocks as item drops where possible. Pure module.
import { getBlockById } from './blocks.js';
import { dropForBlock } from './drops.js';

/**
 * Detonate at (x,y,z) with `radius`. Removes voxels whose centre is within the
 * radius, writing air via world.set (so edits persist over procedural terrain)
 * and skipping unbreakable blocks (bedrock/barrier/obsidian-like).
 * @returns array of dropped item ids to spawn (each repeatable).
 */
export function explode(world, x, y, z, radius) {
  const dropped = [];
  const r = Math.ceil(radius);
  for (let dx = -r; dx <= r; dx += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        const bx = Math.floor(x) + dx;
        const by = Math.floor(y) + dy;
        const bz = Math.floor(z) + dz;
        if (Math.hypot(dx, dy, dz) > radius) continue;
        const id = world.get(bx, by, bz);
        const b = getBlockById(id);
        if (!b || b.id === 0) continue;
        if (b.unbreakable || b.hardness == null || b.hardness < 0) continue;
        world.set(bx, by, bz, 0);
        const d = dropForBlock(id);
        if (d != null) dropped.push(d);
      }
    }
  }
  return dropped;
}
