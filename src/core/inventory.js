// Minimal item inventory + ItemStack helpers used by B1 (crafting/tools/smelting)
// and shared with later A4 inventory issue. Slots hold {id, count} or null.
// Stack limits come from the block/item registry (contract §BlockItemID).
import { getBlockById } from './blocks.js';
import { B1_ITEMS } from './items.js';

function stackCount(id) {
  if (B1_ITEMS[id]) return B1_ITEMS[id].stack ?? 64;
  const b = getBlockById(id);
  if (b === undefined || b === null) return 64;
  return b.stack ?? 64;
}

export class Inventory {
  constructor(size = 36) {
    this.size = size;
    this.slots = new Array(size).fill(null);
  }

  at(idx) {
    return this.slots[idx] ?? null;
  }

  set(idx, stack) {
    this.slots[idx] = stack ? { ...stack } : null;
  }

  // Merge a stack into the inventory. Returns leftover count not placed.
  add(id, count) {
    let left = count;
    const cap = stackCount(id);
    // stack into existing partial stacks first
    for (let i = 0; i < this.size && left > 0; i += 1) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < cap) {
        const room = cap - s.count;
        const take = Math.min(room, left);
        s.count += take;
        left -= take;
      }
    }
    // then into empty slots
    for (let i = 0; i < this.size && left > 0; i += 1) {
      if (!this.slots[i]) {
        const take = Math.min(cap, left);
        this.slots[i] = { id, count: take };
        left -= take;
      }
    }
    return left;
  }

  remove(id, count) {
    let left = count;
    for (let i = 0; i < this.size && left > 0; i += 1) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, left);
        s.count -= take;
        left -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return left; // 0 = fully removed
  }

  count(id) {
    return this.slots.reduce((acc, s) => acc + (s && s.id === id ? s.count : 0), 0);
  }

  // Compact representation over a range (default all).
  slice(start = 0, len = this.size) {
    return this.slots.slice(start, start + len).map((s) => (s ? { ...s } : null));
  }
}
