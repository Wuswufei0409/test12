// Hardness-based block breaking. Pure module, headless-testable.
//
// A block breaks after the player accumulates enough "break time" while the
// crosshair holds on it. Unbreakable blocks (hardness < 0, e.g. bedrock /
// barrier) and liquid/air are never breakable.
import { getBlockById } from './blocks.js';

/**
 * Seconds of sustained crosshair contact to break `block` by hand.
 * Simple model: hardness * 1.5s + 0.1s base. dirt(0.5)->0.85s, stone(1.5)->
 * 2.35s, plant/leaves near-instant. Infinity when unbreakable.
 */
export function breakTimeSeconds(block) {
  if (!block || block.id === 0) return Infinity;
  if (block.hardness == null || block.hardness < 0 || block.unbreakable) return Infinity;
  if (!block.solid) return Infinity; // liquids / non-solid (torch, bed) don't break as blocks
  return block.hardness * 1.5 + 0.1;
}

/**
 * Tracks per-target break progress. `update` accumulates and returns true on
 * the frame the block completes breaking, then resets. Retargeting any block
 * (different coords) restarts progress from zero.
 */
export class Breaking {
  constructor() {
    this.target = null;
    this.progress = 0;
  }

  reset() {
    this.target = null;
    this.progress = 0;
  }

  /** @returns {boolean} true when break completes this frame. */
  update(target, block, dt) {
    if (!target) {
      this.reset();
      return false;
    }
    const time = breakTimeSeconds(block);
    if (!Number.isFinite(time)) {
      this.reset();
      return false;
    }
    const key = `${target.x},${target.y},${target.z}`;
    if (!this.target || this.target !== key) {
      this.target = key;
      this.progress = 0;
    }
    this.progress += dt / time;
    if (this.progress >= 1) {
      this.reset();
      return true;
    }
    return false;
  }

  /** 0..1 progress fraction for the current target (HUD/particle feedback). */
  progressOf(target) {
    if (!target) return 0;
    if (!this.target || this.target !== `${target.x},${target.y},${target.z}`) return 0;
    return Math.min(1, this.progress);
  }
}
