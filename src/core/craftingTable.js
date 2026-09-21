// Interactive crafting table logic (Phase C rework, crit 07).
//
// Pure, headless-testable layer that couples the player inventory (an
// createInventory instance) to a 3x3 crafting grid (each cell holds 0..N of a
// single item id, but shaped recipes only need 1 per occupied cell). Matching
// reuses the placement-agnostic findRecipe/craft from crafting.js.
//
// Consumption model: the player moves items OUT of the inventory into the grid
// (placeSelected decreases the inventory) and, when crafting, the grid's items
// are combined and the output is added to the inventory. Removing a cell
// returns its item to the inventory. This guarantees ingredients are consumed
// once and outputs are produced into stacks correctly.
import { findRecipe, craft } from './crafting.js';

export function emptyCells() {
  return Array.from({ length: 9 }, () => ({ id: 0, count: 0 }));
}

// Reduce cell state to the 9-cell id grid crafting.js expects (0 = empty).
export function buildGrid(cells) {
  return cells.map((c) => (c && c.count > 0 ? c.id : 0));
}

// Select which inventory slot is the active ingredient palette.
export function paletteSelect(inventory, index) {
  inventory.select(index);
}

// Move 1 unit of the selected inventory slot into grid cell `index`.
// Returns true on success (inventory consumed), false otherwise.
export function placeSelected(inventory, cells, index) {
  const sel = inventory.selectedStack();
  if (!sel || sel.count <= 0 || !sel.id) return false;
  const cell = cells[index];
  if (cell && cell.count > 0) return false; // cell occupied
  const id = sel.id;
  const removed = inventory.takeSelected(1);
  if (removed <= 0) return false;
  cells[index] = { id, count: 1 };
  return true;
}

// Return 1 unit of grid cell `index` to the inventory. Returns true on success.
export function removeFromGrid(inventory, cells, index) {
  const cell = cells[index];
  if (!cell || cell.count <= 0) return false;
  inventory.add(cell.id, 1);
  cell.count -= 1;
  if (cell.count <= 0) cells[index] = { id: 0, count: 0 };
  return true;
}

// Preview what the current grid would craft (recipe or null).
export function previewGrid(cells) {
  return findRecipe(buildGrid(cells));
}

// Craft the current grid: clear it and add the output stack to the inventory.
// Returns { crafted, recipeName, output, leftover }.
export function craftGrid(inventory, cells) {
  const res = craft(buildGrid(cells));
  if (!res.recipe || !res.output) return { crafted: false, recipeName: null, output: null, leftover: null };
  for (let i = 0; i < 9; i += 1) cells[i] = { id: 0, count: 0 };
  const leftover = inventory.add(res.output.id, res.output.count);
  return { crafted: true, recipeName: res.recipe.name, output: res.output, leftover };
}
