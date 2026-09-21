// Tool tiers, durability, wrong-tool restriction, ore drops, and digging time.
// Per-material dig speed and durability come from TOOL_TIERS (items.js).
// Cross-module contract: block hardness lives in blocks.js; block->tool map and
// harvest levels live in items.js.
import { getBlockById } from './blocks.js';
import { TOOL_ITEMS, TOOL_TIERS, BLOCK_TOOL, BLOCK_HARVEST, ORE_DROPS } from './items.js';

// Dig result for mining a block with a held tool item (id) or null (hand).
//   timeTicks: ticks to break (hardness / effective speed)
//   drop: item id dropped (or null if wrong tool/inadequate harvest)
//   wrongTool: true when the right tool type is missing
//   insufficientHarvest: true when tool tier < required harvest level
//   durabilityLost: 1 when a tool is used and the block gives a drop
export function dig(blockId, toolItemId = null) {
  const block = getBlockById(blockId);
  if (!block || block.hardness < 0 || block.unbreakable) {
    return { timeTicks: Infinity, drop: null, wrongTool: false, insufficientHarvest: false, durabilityLost: 0 };
  }
  const requiredTool = BLOCK_TOOL[blockId] ?? 'none';
  const tool = toolItemId != null ? TOOL_ITEMS[toolItemId] : null;

  if (requiredTool === 'none') {
    // mineable by hand; tools speed it up
    const speed = tool && tool.type === 'sword' ? 0.5 : 1.0;
    const timeTicks = block.hardness / (1.0 * speed);
    const durabilityLost = tool ? 1 : 0;
    return { timeTicks, drop: blockId, wrongTool: false, insufficientHarvest: false, durabilityLost };
  }

  // A tool of the required type + sufficient harvest level is required.
  if (!tool || tool.type !== requiredTool) {
    // wrong tool: nothing dropped (hard, slow)
    return { timeTicks: block.hardness / 0.3, drop: null, wrongTool: true, insufficientHarvest: false, durabilityLost: 0 };
  }
  const tier = TOOL_TIERS[tool.material];
  const needHarvest = BLOCK_HARVEST[blockId] ?? 0;
  if (tier.harvestLevel < needHarvest) {
    return { timeTicks: block.hardness / tier.digSpeed, drop: null, wrongTool: false, insufficientHarvest: true, durabilityLost: 1 };
  }

  // correct tool + sufficient harvest -> drop
  const drop = ORE_DROPS[blockId] ? ORE_DROPS[blockId].dropItem : blockId;
  return { timeTicks: block.hardness / tier.digSpeed, drop, wrongTool: false, insufficientHarvest: false, durabilityLost: 1 };
}

// Durability helper: returns { remaining } after a use.
export function useTool(toolItemId, durability) {
  const meta = TOOL_ITEMS[toolItemId];
  if (!meta) return { broken: durability <= 0, remaining: Math.max(0, durability - (durability > 0 ? 1 : 0)) };
  const max = TOOL_TIERS[meta.material].durability;
  const after = Math.max(0, durability - 1);
  return { remaining: after, broken: after === 0, max };
}

export function toolDurability(toolItemId) {
  const meta = TOOL_ITEMS[toolItemId];
  if (!meta) return null;
  return TOOL_TIERS[meta.material].durability;
}

// Full upgrade-chain helper used by tests: confirm stone out-digs wood and iron
// out-digs stone for the same block (per-material dig speed).
export function digSpeedFor(toolItemId) {
  const meta = TOOL_ITEMS[toolItemId];
  if (!meta) return 1.0;
  return TOOL_TIERS[meta.material].digSpeed;
}
