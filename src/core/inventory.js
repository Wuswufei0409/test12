// Hotbar + basic inventory with stacking. Pure module, headless-testable.
//
// The inventory is a fixed set of slots (9 hotbar slots by default, matching
// the CONTRACT hotbar). Adding an item first stacks onto existing matching
// slots up to that item's stack limit, then fills empty slots. Selected slot
// drives what the player can place.
import { getBlockById, BLOCKS, ITEMS } from './blocks.js';

export const HOTBAR_SIZE = 9;

/** Maximum items per slot for a given id (blocks stack 64; items use .stack). */
export function stackCapacity(id) {
  const asItem = Object.values(ITEMS).find((i) => i.id === id);
  if (asItem) return asItem.stack || 64;
  return 64; // blocks and unknown stack to 64
}

/** Human-readable name for an id (search both block and item registries). */
export function itemName(id) {
  const b = getBlockById(id);
  if (b && b.id !== 0) return b.name;
  const i = Object.values(ITEMS).find((x) => x.id === id);
  return i ? i.name : '?';
}

/**
 * @param {number} [size] number of hotbar slots; default 9.
 */
export function createInventory(size = HOTBAR_SIZE) {
  const stacks = Array.from({ length: size }, () => ({ id: 0, count: 0 }));
  return {
    size,
    stacks,
    selected: 0,

    /** Select a hotbar slot (clamped to range). */
    select(index) {
      if (Number.isInteger(index) && index >= 0 && index < size) this.selected = index;
    },

    selectedStack() {
      return this.stacks[this.selected];
    },

    /** Add `count` of `id`, stacking first then filling empties. Returns leftover (0 = all stored). */
    add(id, count) {
      if (count <= 0) return 0;
      const cap = stackCapacity(id);
      let remaining = count;
      // stack onto existing partial stacks
      for (const s of this.stacks) {
        if (remaining <= 0) break;
        if (s.id === id && s.count > 0 && s.count < cap) {
          const take = Math.min(cap - s.count, remaining);
          s.count += take;
          remaining -= take;
        }
      }
      // fill empty slots
      for (const s of this.stacks) {
        if (remaining <= 0) break;
        if (s.count === 0) {
          const take = Math.min(cap, remaining);
          s.id = id;
          s.count = take;
          remaining -= take;
        }
      }
      return remaining;
    },

    /** True when the selected slot holds at least `count` of `id`. */
    hasSelected(id, count = 1) {
      const s = this.stacks[this.selected];
      return s.id === id && s.count >= count;
    },

    /** Remove up to `count` from the selected slot. Returns amount removed. */
    takeSelected(count = 1) {
      const s = this.stacks[this.selected];
      if (s.count <= 0) return 0;
      const take = Math.min(s.count, count);
      s.count -= take;
      if (s.count === 0) s.id = 0;
      return take;
    },

    /** Total items in all slots (test helper). */
    total() {
      return this.stacks.reduce((n, s) => n + s.count, 0);
    },

    /** Is the selected slot empty? */
    selectedEmpty() {
      return this.stacks[this.selected].count === 0;
    },
  };
}
