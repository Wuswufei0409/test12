// Death-drop handling (Phase C rework, crit 06). Pure + headless-testable.
//
// On death the full inventory contents are spilled as drops (returned as a
// list so the caller can spawn world drops at the death location) and the
// inventory is cleared for respawn. On respawn the fields are cleared so the
// next death drops fresh.
export function spillInventory(inventory) {
  const dropped = [];
  for (let i = 0; i < inventory.stacks.length; i += 1) {
    const s = inventory.stacks[i];
    if (s.count > 0) dropped.push({ id: s.id, count: s.count });
  }
  clearForRespawn(inventory);
  return dropped;
}

export function clearForRespawn(inventory) {
  for (let i = 0; i < inventory.stacks.length; i += 1) {
    inventory.stacks[i].id = 0;
    inventory.stacks[i].count = 0;
  }
  inventory.selected = 0;
}
