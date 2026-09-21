// R-08 (crit 08): integrated in-game furnace interaction — the reusable,
// HEADLESS-safe glue between the pure Furnace state machine (smelting.js) and
// the client GUI. Operates on plain JSON-safe container objects so a furnace's
// contents/state persist unchanged through the existing save format (crit 18).
import { Furnace, FUEL } from './smelting.js';

/** A fresh, empty furnace container (plain object, JSON-safe). */
export function createFurnaceContainer() {
  return { input: null, fuel: null, output: null, progress: 0, fuelTicksLeft: 0, burning: false };
}

/**
 * Advance a furnace container by `n` world ticks using the real Furnace state
 * machine (consumes fuel, advances progress, produces smelted output). Mutates
 * `container` in place and returns the tick events (e.g. [{type:'smelted',...}]).
 */
export function tickFurnace(container, n = 1) {
  const f = new Furnace();
  f.input = container.input ? { ...container.input } : null;
  f.fuel = container.fuel ? { ...container.fuel } : null;
  f.output = container.output ? { ...container.output } : null;
  f.progress = container.progress || 0;
  f.fuelTicksLeft = container.fuelTicksLeft || 0;
  f.burning = !!container.burning;
  const events = f.tick(n);
  container.input = f.input;
  container.fuel = f.fuel;
  container.output = f.output;
  container.progress = f.progress;
  container.fuelTicksLeft = f.fuelTicksLeft;
  container.burning = f.burning;
  return events;
}

/** Put a whole stack into one named slot if empty/mergeable; returns the leftover. */
export function putIntoSlot(container, which, stack) {
  if (!stack || stack.id == null || stack.count <= 0) return stack;
  if (which !== 'input' && which !== 'fuel') return stack;
  const slot = container[which];
  if (!slot) {
    container[which] = { id: stack.id, count: stack.count };
    return null;
  }
  if (slot.id !== stack.id) return stack; // different item — not accepted
  const cap = 64 - slot.count;
  if (cap <= 0) return stack;
  const take = Math.min(cap, stack.count);
  slot.count += take;
  const rest = stack.count - take;
  return rest > 0 ? { id: stack.id, count: rest } : null;
}

/**
 * Deposit a stack the way a player "clicks a hotbar slot into the furnace":
 * fuel items route to the fuel slot, anything else (ores/sand etc.) to input.
 * Returns the leftover stack (stack the player keeps) or null when fully moved.
 */
export function depositStack(container, stack) {
  if (!stack || stack.id == null || stack.count <= 0) return stack;
  const isFuel = Object.prototype.hasOwnProperty.call(FUEL, stack.id);
  return putIntoSlot(container, isFuel ? 'fuel' : 'input', stack);
}

/** Remove an entire slot's contents; returns the removed stack (or null). */
export function takeFromSlot(container, which) {
  if (which !== 'input' && which !== 'fuel' && which !== 'output') return null;
  const slot = container[which];
  container[which] = null;
  return slot || null;
}
