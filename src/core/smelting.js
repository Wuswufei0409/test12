// Furnace smelting: config-driven recipes, fuel, progress in ticks, output.
// Cross-module: ore items from blocks.js/blocks registry; fuel values are game
// ticks. Testable as a pure tick state machine.
import { getBlockById } from './blocks.js';

export const SMELTING_RECIPES = {
  // input block/item id -> { output:[id,count], time }
  12: { output: [110, 1], time: 200 }, // iron_ore -> iron_ingot
  11: { output: [111, 1], time: 200 }, // coal_ore -> coal
  5: { output: [22, 1], time: 200 }, // sand -> glass (representative)
};

export const FUEL = {
  111: 1600, // coal burns 1600 ticks
  8: 300, // log burns 300 ticks
  7: 300, // planks burn 300 ticks
};

export class Furnace {
  constructor() {
    this.input = null; // {id, count}
    this.fuel = null; // {id, count}
    this.output = null; // {id, count}
    this.progress = 0; // ticks
    this.fuelTicksLeft = 0;
    this.burning = false;
  }

  setInput(stack) { this.input = stack ? { ...stack } : null; }
  setFuel(stack) { this.fuel = stack ? { ...stack } : null; }
  setOutput(stack) { this.output = stack ? { ...stack } : null; }

  canSmelt() {
    if (!this.input || this.input.count <= 0) return null;
    const r = SMELTING_RECIPES[this.input.id];
    if (!r) return null;
    // output slot must accept result
    if (this.output && this.output.id !== r.output[0]) return false;
    if (this.output && this.output.count + r.output[1] > 64) return false;
    return r;
  }

  // Advance by n ticks. Returns events: [{type:'smelted',id,count}, ...]
  tick(n = 1) {
    const events = [];
    for (let i = 0; i < n; i += 1) {
      const r = this.canSmelt();
      if (!r) { this.burning = false; continue; }
      if (this.fuelTicksLeft <= 0) {
        // consume fuel
        const f = this.pickFuel();
        if (!f) { this.burning = false; continue; }
        this.fuelTicksLeft = f;
      }
      this.burning = true;
      this.progress += 1;
      this.fuelTicksLeft -= 1;
      if (this.progress >= r.time) {
        this.progress = 0;
        this.input.count -= 1;
        if (this.input.count <= 0) this.input = null;
        if (this.output) this.output.count += r.output[1];
        else this.output = { id: r.output[0], count: r.output[1] };
        events.push({ type: 'smelted', id: r.output[0], count: r.output[1] });
      }
    }
    return events;
  }

  pickFuel() {
    if (this.fuel && this.fuel.count > 0) {
      const burn = FUEL[this.fuel.id];
      if (!burn) return 0;
      this.fuel.count -= 1;
      if (this.fuel.count <= 0) this.fuel = null;
      return burn;
    }
    return 0;
  }
}

export function smeltingRecipes() {
  return Object.entries(SMELTING_RECIPES).map(([inp, r]) => ({
    input: Number(inp),
    inputName: getBlockById(Number(inp)).name,
    output: r.output,
    time: r.time,
  }));
}
