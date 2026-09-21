// Block / item ID registry. This is the cross-module contract for block and
// item identity. Runtime modules and tests read from here; numeric IDs are
// stable lookup keys (do NOT reorder — IDs are persisted in saves).
// SEE CONTRACT.md §BlockItemID.

const REGISTRY = {
  air: { id: 0, name: 'air', solid: false, hardness: -1 },
  stone: { id: 1, name: 'stone', solid: true, hardness: 1.5, color: 0x888888 },
  grass: { id: 2, name: 'grass', solid: true, hardness: 0.6, color: 0x6abe30 },
  dirt: { id: 3, name: 'dirt', solid: true, hardness: 0.5, color: 0x8a5a2b },
  sandstone: { id: 4, name: 'sandstone', solid: true, hardness: 0.8, color: 0xdbcfa8 },
  sand: { id: 5, name: 'sand', solid: true, hardness: 0.5, color: 0xdbcfa8 },
  water: { id: 6, name: 'water', solid: false, hardness: -1, liquid: true },
  planks: { id: 7, name: 'planks', solid: true, hardness: 2, color: 0xa97c50 },
  log: { id: 8, name: 'log', solid: true, hardness: 2, color: 0x6b4a2b },
  leaves: { id: 9, name: 'leaves', solid: false, hardness: 0.2, color: 0x3f7d26 },
  cobblestone: { id: 10, name: 'cobblestone', solid: true, hardness: 2, color: 0x7a7a7a },
  coal_ore: { id: 11, name: 'coal_ore', solid: true, hardness: 3, color: 0x2b2b2b },
  iron_ore: { id: 12, name: 'iron_ore', solid: true, hardness: 3, color: 0xd8af93 },
  diamond_ore: { id: 13, name: 'diamond_ore', solid: true, hardness: 3, color: 0x66e6d8 },
  torch: { id: 14, name: 'torch', solid: false, hardness: 0, light: 14 },
  crafting_table: { id: 15, name: 'crafting_table', solid: true, hardness: 2.5, color: 0x8a5a2b },
  furnace: { id: 16, name: 'furnace', solid: true, hardness: 3.5, color: 0x555555 },
  chest: { id: 17, name: 'chest', solid: true, hardness: 2.5, color: 0x9a6a2a },
  bed: { id: 18, name: 'bed', solid: false, hardness: 0.2, color: 0xd04a4a },
  glass: { id: 19, name: 'glass', solid: false, hardness: 0.3 },
  snow: { id: 20, name: 'snow', solid: true, hardness: 0.1, color: 0xffffff },
  ice: { id: 21, name: 'ice', solid: false, hardness: 0.5, color: 0xbfe7f5 },
  gravel: { id: 22, name: 'gravel', solid: true, hardness: 0.6, color: 0x8c8c8c },
  clay: { id: 23, name: 'clay', solid: true, hardness: 0.6, color: 0x9aa0b0 },
  obsidian: { id: 24, name: 'obsidian', solid: true, hardness: 50, color: 0x1c1330 },
  bedrock: { id: 25, name: 'bedrock', solid: true, hardness: -1, unbreakable: true, color: 0x202020 },
  ladder: { id: 26, name: 'ladder', solid: false, hardness: 0.4, color: 0xc8a968 },
  stone_bricks: { id: 27, name: 'stone_bricks', solid: true, hardness: 1.5, color: 0x9b9b9b },
  mossy_cobblestone: { id: 28, name: 'mossy_cobblestone', solid: true, hardness: 2, color: 0x6f7d62 },
  brick_block: { id: 29, name: 'brick_block', solid: true, hardness: 2, color: 0xa5574f },
  soul_sand: { id: 30, name: 'soul_sand', solid: true, hardness: 0.5, color: 0x4a3c2e },
  glowstone: { id: 31, name: 'glowstone', solid: true, hardness: 0.3, light: 15, color: 0xffe29a },
  sponge: { id: 32, name: 'sponge', solid: true, hardness: 0.6, color: 0xd8c868 },
  prismarine: { id: 33, name: 'prismarine', solid: true, hardness: 1.5, color: 0x5aa88a },
  sea_lantern: { id: 34, name: 'sea_lantern', solid: true, hardness: 0.3, light: 15, color: 0xcdeee6 },
  barrier: { id: 35, name: 'barrier', solid: true, hardness: -1, unbreakable: true, color: 0xc03040 },
  farmland: { id: 36, name: 'farmland', solid: true, hardness: 0.6, color: 0x5a3d1e },
  // Crop plant growth stages (B4). Non-solid: walk-through, near-instant harvest.
  wheat_s0: { id: 40, name: 'wheat (young)', solid: false, hardness: 0, color: 0x3f8f2a },
  wheat_s1: { id: 41, name: 'wheat (growing)', solid: false, hardness: 0, color: 0x5aa83a },
  wheat_s2: { id: 42, name: 'wheat (almost)', solid: false, hardness: 0, color: 0x87b843 },
  wheat_s3: { id: 43, name: 'wheat', solid: false, hardness: 0, color: 0xc8c24a },
  carrot_s0: { id: 44, name: 'carrot (young)', solid: false, hardness: 0, color: 0x3f8f2a },
  carrot_s1: { id: 45, name: 'carrot (growing)', solid: false, hardness: 0, color: 0x4a9a3a },
  carrot_s2: { id: 46, name: 'carrot (almost)', solid: false, hardness: 0, color: 0x5a8f2a },
  carrot_s3: { id: 47, name: 'carrot', solid: false, hardness: 0, color: 0xe8833a },
  potato_s0: { id: 48, name: 'potato (young)', solid: false, hardness: 0, color: 0x3f8f2a },
  potato_s1: { id: 49, name: 'potato (growing)', solid: false, hardness: 0, color: 0x4a9a3a },
  potato_s2: { id: 50, name: 'potato (almost)', solid: false, hardness: 0, color: 0x8a8f2a },
  potato_s3: { id: 51, name: 'potato', solid: false, hardness: 0, color: 0xb08a3a },
  wood_sword: { id: 100, name: 'wood_sword', item: true, stack: 1 },
  stone_sword: { id: 101, name: 'stone_sword', item: true, stack: 1 },
  iron_sword: { id: 102, name: 'iron_sword', item: true, stack: 1 },
  bow: { id: 103, name: 'bow', item: true, stack: 1 },
  arrow: { id: 104, name: 'arrow', item: true, stack: 64 },
  bread: { id: 105, name: 'bread', item: true, stack: 64, food: 5 },
  wheat: { id: 106, name: 'wheat', item: true, stack: 64 },
  stick: { id: 107, name: 'stick', item: true, stack: 64 },
  torch_item: { id: 108, name: 'torch', item: true, stack: 64 },
  apple: { id: 109, name: 'apple', item: true, stack: 64, food: 4 },
  iron_ingot: { id: 110, name: 'iron_ingot', item: true, stack: 64 },
  coal: { id: 111, name: 'coal', item: true, stack: 64 },
  bucket: { id: 112, name: 'bucket', item: true, stack: 16 },
  boat: { id: 113, name: 'boat', item: true, stack: 1 },
  shield: { id: 114, name: 'shield', item: true, stack: 1 },
  trident: { id: 115, name: 'trident', item: true, stack: 1 },
  wooden_pickaxe: { id: 116, name: 'wooden_pickaxe', item: true, stack: 1 },
  stone_pickaxe: { id: 117, name: 'stone_pickaxe', item: true, stack: 1 },
  iron_pickaxe: { id: 118, name: 'iron_pickaxe', item: true, stack: 1 },
};

export const BLOCKS = Object.fromEntries(
  Object.entries(REGISTRY).filter(([, v]) => !v.item).map(([k, v]) => [k, { ...v }]),
);
export const ITEMS = Object.fromEntries(
  Object.entries(REGISTRY).filter(([, v]) => v.item).map(([k, v]) => [k, { ...v }]),
);

export function getBlockById(id) {
  return Object.values(BLOCKS).find((b) => b.id === id) ?? BLOCKS.air;
}

export function blockCount() {
  return Object.values(BLOCKS).filter((b) => b.id !== 0).length;
}
