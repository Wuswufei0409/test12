// Config-driven crafting: shaped (2x2/3x3) and shapeless recipes + recipe book.
// Matching is placement-agnostic: the 3x3 grid is trimmed to its occupied
// bounding box before comparison. Item IDs come from blocks.js (BLOCKS/ITEMS)
// and items.js (B1_ITEMS). Cross-module contract: CONTRACT.md §BlockItemID.
import { BLOCKS, ITEMS } from './blocks.js';
import { B1_ITEMS } from './items.js';

const NAME_TO_ID = {};
for (const k of Object.keys(BLOCKS)) NAME_TO_ID[k] = BLOCKS[k].id;
for (const k of Object.keys(ITEMS)) NAME_TO_ID[k] = ITEMS[k].id;
for (const k of Object.keys(B1_ITEMS)) NAME_TO_ID[k] = B1_ITEMS[k].id;

function resolveId(key) {
  if (typeof key === 'number') return key;
  const id = NAME_TO_ID[key];
  if (id === undefined) throw new Error(`unknown ingredient '${key}'`);
  return id;
}

// ---- recipes config ----
// output: [id, count]. shape rows ('.' = empty). ingredients: shapeless multiset.
const R_ = {
  planks: { name: 'planks', output: [7, 4], shape: [['log']] },
  stick: { name: 'stick', output: [107, 4], shape: [['planks'], ['planks']] },
  crafting_table: { name: 'crafting_table', output: [15, 1], shape: [['planks', 'planks'], ['planks', 'planks']] },
  torch: { name: 'torch', output: [14, 4], shape: [['coal'], ['stick']] },
  chest: { name: 'chest', output: [17, 1], shape: [
    ['planks', 'planks', 'planks'],
    ['planks', '.', 'planks'],
    ['planks', 'planks', 'planks'],
  ] },
  furnace: { name: 'furnace', output: [16, 1], shape: [
    ['cobblestone', 'cobblestone', 'cobblestone'],
    ['cobblestone', '.', 'cobblestone'],
    ['cobblestone', 'cobblestone', 'cobblestone'],
  ] },
  boat: { name: 'boat', output: [113, 1], shape: [
    ['planks', '.', 'planks'],
    ['planks', 'planks', 'planks'],
  ] },
  bucket: { name: 'bucket', output: [112, 1], shape: [
    ['iron_ingot', '.', 'iron_ingot'],
    ['.', 'iron_ingot', '.'],
  ] },
  bread: { name: 'bread', output: [105, 1], ingredients: ['wheat', 'wheat', 'wheat'] },
  wooden_pickaxe: { name: 'wooden_pickaxe', output: [116, 1], shape: [
    ['planks', 'planks', 'planks'],
    ['.', 'stick', '.'],
    ['.', 'stick', '.'],
  ] },
  stone_pickaxe: { name: 'stone_pickaxe', output: [117, 1], shape: [
    ['cobblestone', 'cobblestone', 'cobblestone'],
    ['.', 'stick', '.'],
    ['.', 'stick', '.'],
  ] },
  iron_pickaxe: { name: 'iron_pickaxe', output: [118, 1], shape: [
    ['iron_ingot', 'iron_ingot', 'iron_ingot'],
    ['.', 'stick', '.'],
    ['.', 'stick', '.'],
  ] },
  wooden_axe: { name: 'wooden_axe', output: [210, 1], shape: [
    ['planks', 'planks'],
    ['planks', 'stick'],
    ['.', 'stick'],
  ] },
  stone_axe: { name: 'stone_axe', output: [211, 1], shape: [
    ['cobblestone', 'cobblestone'],
    ['cobblestone', 'stick'],
    ['.', 'stick'],
  ] },
  iron_axe: { name: 'iron_axe', output: [212, 1], shape: [
    ['iron_ingot', 'iron_ingot'],
    ['iron_ingot', 'stick'],
    ['.', 'stick'],
  ] },
  wooden_shovel: { name: 'wooden_shovel', output: [213, 1], shape: [['planks'], ['stick'], ['stick']] },
  stone_shovel: { name: 'stone_shovel', output: [214, 1], shape: [['cobblestone'], ['stick'], ['stick']] },
  iron_shovel: { name: 'iron_shovel', output: [215, 1], shape: [['iron_ingot'], ['stick'], ['stick']] },
  wooden_sword: { name: 'wooden_sword', output: [100, 1], shape: [['planks'], ['planks'], ['stick']] },
  stone_sword: { name: 'stone_sword', output: [101, 1], shape: [['cobblestone'], ['cobblestone'], ['stick']] },
  iron_sword: { name: 'iron_sword', output: [102, 1], shape: [['iron_ingot'], ['iron_ingot'], ['stick']] },
  // underwater representative items
  dried_kelp: { name: 'dried_kelp', output: [202, 1], ingredients: ['kelp'] },
  sea_lantern: { name: 'sea_lantern', output: [34, 1], shape: [
    ['prismarine_shard', 'prismarine_shard'],
    ['prismarine_shard', 'prismarine_shard'],
  ] },
  // B3 combat gear (crit 12)
  bow: { name: 'bow', output: [103, 1], shape: [
    ['.', 'string', 'stick'],
    ['stick', '.', 'string'],
    ['.', 'string', 'stick'],
  ] },
  arrow: { name: 'arrow', output: [104, 4], shape: [
    ['stick'],
    ['coal'],
    ['stick'],
  ] },
  shield: { name: 'shield', output: [114, 1], shape: [
    ['planks', 'planks', 'planks'],
    ['planks', 'planks', 'planks'],
    ['planks', '.', 'planks'],
  ] },
  leather_helmet: { name: 'leather_helmet', output: [129, 1], shape: [
    ['leather', 'leather', 'leather'],
    ['leather', '.', 'leather'],
  ] },
  leather_chest: { name: 'leather_chest', output: [130, 1], shape: [
    ['leather', '.', 'leather'],
    ['leather', 'leather', 'leather'],
    ['leather', 'leather', 'leather'],
  ] },
  leather_leggings: { name: 'leather_leggings', output: [131, 1], shape: [
    ['leather', 'leather', 'leather'],
    ['leather', '.', 'leather'],
    ['leather', '.', 'leather'],
  ] },
  leather_boots: { name: 'leather_boots', output: [132, 1], shape: [
    ['leather', '.', 'leather'],
    ['leather', '.', 'leather'],
  ] },
  iron_helmet: { name: 'iron_helmet', output: [133, 1], shape: [
    ['iron_ingot', 'iron_ingot', 'iron_ingot'],
    ['iron_ingot', '.', 'iron_ingot'],
  ] },
  iron_chest: { name: 'iron_chest', output: [134, 1], shape: [
    ['iron_ingot', '.', 'iron_ingot'],
    ['iron_ingot', 'iron_ingot', 'iron_ingot'],
    ['iron_ingot', 'iron_ingot', 'iron_ingot'],
  ] },
  iron_leggings: { name: 'iron_leggings', output: [135, 1], shape: [
    ['iron_ingot', 'iron_ingot', 'iron_ingot'],
    ['iron_ingot', '.', 'iron_ingot'],
    ['iron_ingot', '.', 'iron_ingot'],
  ] },
  iron_boots: { name: 'iron_boots', output: [136, 1], shape: [
    ['iron_ingot', '.', 'iron_ingot'],
    ['iron_ingot', '.', 'iron_ingot'],
  ] },
};

export const RECIPES = Object.values(R_);

const RESOLVED = RECIPES.map((r) => {
  if (r.shape) {
    return {
      ...r,
      kind: 'shaped',
      pattern: r.shape.map((row) => row.map((c) => (c === '.' ? 0 : resolveId(c)))),
    };
  }
  return { ...r, kind: 'shapeless', ingredientIds: r.ingredients.map(resolveId).sort() };
});

// grid: array of 9 cells (3x3), 0 = empty. Returns matched recipe or null.
export function findRecipe(grid) {
  const flat = grid.map((c) => (Number.isInteger(c) ? c : 0));
  const trimmed = trim(flat);
  for (const r of RESOLVED) {
    if (r.kind === 'shaped') {
      const shapeFlat = patternFlat(r.pattern);
      if (sameShape(trimmed, trim(shapeFlat))) return r;
    } else {
      const cells = trimmed.filter((x) => x !== 0);
      if ([...cells].sort().join(',') === r.ingredientIds.join(',')) return r;
    }
  }
  return null;
}

// Craft: clears matched cells. Returns { recipe, output, remainingGrid }.
export function craft(grid) {
  const recipe = findRecipe(grid);
  if (!recipe) return { recipe: null, output: null, remainingGrid: grid.map(() => 0) };
  const [outId, count] = recipe.output;
  return { recipe, output: { id: outId, count }, remainingGrid: grid.map(() => 0) };
}

// Recipe book for UI / docs.
export function recipeBook() {
  return RESOLVED.map((r) => ({
    name: r.name,
    kind: r.kind,
    output: r.output,
    pattern: r.shape || null,
    ingredients: r.ingredients || null,
  }));
}

// ---- grid helpers ----
function patternFlat(pattern) {
  const out = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) out.push(r < pattern.length && c < pattern[r].length ? pattern[r][c] : 0);
  }
  return out;
}
function trim(flat) {
  const rows = [];
  for (let r = 0; r < 3; r += 1) rows.push(flat.slice(r * 3, r * 3 + 3));
  let minR = 3, maxR = -1, minC = 3, maxC = -1;
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) {
    if (rows[r][c] !== 0) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  }
  const out = new Array(9).fill(0);
  for (let r = minR; r <= maxR; r += 1) {
    for (let c = minC; c <= maxC; c += 1) {
      out[(r - minR) * 3 + (c - minC)] = rows[r][c];
    }
  }
  return out;
}
function sameShape(a, b) {
  for (let i = 0; i < 9; i += 1) {
    if ((a[i] === 0) !== (b[i] === 0)) return false;
  }
  for (let i = 0; i < 9; i += 1) if (a[i] !== 0 && a[i] !== b[i]) return false;
  return true;
}
