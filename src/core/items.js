// B1 additions to the item/tool registry (IDs 200+ to avoid collision with the
// base block/item table in blocks.js which is 0..35 blocks and 100..118 items).
// Cross-module contract lives in CONTRACT.md §BlockItemID (base) extended here.

export const TOOL_TIERS = {
  wood: { label: 'wood', color: 0x8a6f47, harvestLevel: 0, durability: 60, digSpeed: 1.0 },
  stone: { label: 'stone', color: 0x8f8f8f, harvestLevel: 1, durability: 132, digSpeed: 2.0 },
  iron: { label: 'iron', color: 0xd8d8d8, harvestLevel: 2, durability: 251, digSpeed: 3.0 },
};

// tool item id -> { material, type }
export const TOOL_ITEMS = {
  100: { material: 'wood', type: 'sword' },
  101: { material: 'stone', type: 'sword' },
  102: { material: 'iron', type: 'sword' },
  116: { material: 'wood', type: 'pickaxe' }, // wooden_pickaxe
  117: { material: 'stone', type: 'pickaxe' },
  118: { material: 'iron', type: 'pickaxe' },
  210: { material: 'wood', type: 'axe' }, // wooden_axe
  211: { material: 'stone', type: 'axe' },
  212: { material: 'iron', type: 'axe' },
  213: { material: 'wood', type: 'shovel' }, // wooden_shovel
  214: { material: 'stone', type: 'shovel' },
  215: { material: 'iron', type: 'shovel' },
  216: { material: 'wood', type: 'hoe' }, // wooden_hoe
  217: { material: 'stone', type: 'hoe' },
  218: { material: 'iron', type: 'hoe' },
};

export const B1_ITEMS = {
  wooden_axe: { id: 210, name: 'wooden_axe', stack: 1 },
  stone_axe: { id: 211, name: 'stone_axe', stack: 1 },
  iron_axe: { id: 212, name: 'iron_axe', stack: 1 },
  wooden_shovel: { id: 213, name: 'wooden_shovel', stack: 1 },
  stone_shovel: { id: 214, name: 'stone_shovel', stack: 1 },
  iron_shovel: { id: 215, name: 'iron_shovel', stack: 1 },
  kelp: { id: 200, name: 'kelp', stack: 64 },
  prismarine_shard: { id: 201, name: 'prismarine_shard', stack: 64 },
  dried_kelp: { id: 202, name: 'dried_kelp', stack: 64, food: 1 },
  // B4 farming: hoes (till dirt) + plantable/edible crops + seeds
  wooden_hoe: { id: 216, name: 'wooden_hoe', stack: 1, color: 0x8a6f47 },
  stone_hoe: { id: 217, name: 'stone_hoe', stack: 1, color: 0x8f8f8f },
  iron_hoe: { id: 218, name: 'iron_hoe', stack: 1, color: 0xd8d8d8 },
  wheat_seeds: { id: 220, name: 'wheat_seeds', stack: 64, color: 0xc8b25a },
  carrot: { id: 221, name: 'carrot', stack: 64, food: 2, color: 0xe8833a },
  potato: { id: 222, name: 'potato', stack: 64, food: 1, color: 0xb08a3a },
};

// Item ids that are hoes (used by the tilling interaction).
export const HOE_ITEMS = new Set([216, 217, 218]);
export function isHoeItem(id) {
  return HOE_ITEMS.has(id);
}

// Required tool type per placeable block id (for wrong-tool restriction).
// 'none' = mineable by hand. Ores require pickaxe of sufficient harvest level.
export const BLOCK_TOOL = {
  1: 'pickaxe', // stone
  10: 'pickaxe', // cobblestone
  11: 'pickaxe', // coal_ore
  12: 'pickaxe', // iron_ore
  13: 'pickaxe', // diamond_ore
  16: 'pickaxe', // furnace
  24: 'pickaxe', // obsidian
  7: 'axe', // planks
  8: 'axe', // log
  15: 'axe', // crafting_table
  3: 'shovel', // dirt
  5: 'shovel', // sand
  22: 'shovel', // gravel
  23: 'shovel', // clay
  20: 'shovel', // snow
};

// Minimum harvest level to obtain drops for a block (ores need iron+ etc.).
export const BLOCK_HARVEST = {
  1: 0,
  10: 0,
  11: 0, // coal ore: any pickaxe
  12: 1, // iron ore: stone+ pickaxe
  13: 2, // diamond ore: iron+ pickaxe
  24: 3, // obsidian: diamond (not reachable in wood/stone/iron chain)
};

// Ore -> drop on smelt / on mine (block drop), used by smelting + ore drops.
export const ORE_DROPS = {
  11: { dropItem: 111, name: 'coal' }, // coal_ore -> coal
  12: { dropItem: 12, name: 'iron_ore' }, // iron_ore mined as ore, smelted to ingot
};
