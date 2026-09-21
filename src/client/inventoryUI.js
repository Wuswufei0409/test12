// Full-inventory UI panel (Phase C rework, crit 06).
//
// DOM overlay toggled with E. Shows the whole 36-slot inventory (9 hotbar + 27
// storage) with stack counts, selected-item highlight, and click-to-move/swap
// between hotbar and storage. Shift+click splits a stack in half. All mutation
// goes through the pure methods on the core inventory (moveTo/swapSlots/splitHalf).
import { getBlockById, ITEMS } from '../core/blocks.js';
import { itemName, HOTBAR_SIZE } from '../core/inventory.js';

export function createInventoryPanel(inventory, hook) {
  // hook = { onToggleLock(open), getSelected() } for pointer-lock coordination.
  const root = document.createElement('div');
  root.id = 'inventory-panel';
  root.className = 'panel';
  root.hidden = true;
  document.body.appendChild(root);

  let grabbed = null; // index of the currently-held stack, or null

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Inventory — E/close';
  root.appendChild(title);

  const body = document.createElement('div');
  body.className = 'inv-panel-body';
  root.appendChild(body);

  const hotbarLabel = document.createElement('div');
  hotbarLabel.className = 'inv-sec-label';
  hotbarLabel.textContent = 'Hotbar (1-9)';
  body.appendChild(hotbarLabel);
  const hotbarRow = document.createElement('div');
  hotbarRow.className = 'inv-grid';
  body.appendChild(hotbarRow);

  const storageLabel = document.createElement('div');
  storageLabel.className = 'inv-sec-label';
  storageLabel.textContent = 'Storage (27)';
  body.appendChild(storageLabel);
  const storageGrid = document.createElement('div');
  storageGrid.className = 'inv-grid';
  body.appendChild(storageGrid);

  const hint = document.createElement('div');
  hint.className = 'panel-hint';
  hint.textContent = 'Click a slot to grab it, click another to move/swap · shift+click to split a stack · click the grabbed slot to cancel';
  root.appendChild(hint);

  function colorFor(id) {
    const b = id !== 0 ? getBlockById(id) : null;
    if (b && b.id !== 0) return b.color;
    const it = Object.values(ITEMS).find((x) => x.id === id);
    return it ? it.color : 0x999999;
  }
  function slotInnerHTML(i, s, isGrabbed) {
    if (s.count <= 0 || !s.id) return '<span class="slot-empty"/>' + (isGrabbed ? '<div class="slot-grab"/>' : '');
    const col = colorFor(s.id);
    const isSel = i < HOTBAR_SIZE && i === inventory.selected;
    return [
      `<div class="slot-fill" style="background:#${(col ?? 0x999999).toString(16).padStart(6, '0')}"></div>`,
      `<span class="slot-name">${itemName(s.id)}</span>`,
      `<span class="slot-count">×${s.count}</span>`,
      isGrabbed ? '<div class="slot-grab"/>' : '',
      isSel ? '<div class="slot-sel"/>' : '',
    ].join('');
  }

  function makeSlot(i) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    slot.dataset.idx = String(i);
    slot.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const idx = Number(slot.dataset.idx);
      const isShift = ev.shiftKey;
      handleClick(idx, isShift);
    });
    return slot;
  }

  function handleClick(idx, isShift) {
    const s = inventory.stacks[idx];
    if (grabbed === null) {
      // grab a non-empty slot (or start a split from it)
      if (isShift) {
        // find an empty slot to split into
        const empty = inventory.stacks.findIndex((x, i) => x.count === 0 && i !== idx);
        if (empty >= 0) inventory.splitHalf(idx, empty);
      } else if (s.count > 0) {
        grabbed = idx;
      }
    } else {
      if (grabbed === idx) {
        grabbed = null; // cancel
      } else if (isShift) {
        inventory.splitHalf(grabbed, idx);
        grabbed = null;
      } else {
        inventory.moveTo(grabbed, idx);
        grabbed = null;
      }
    }
    render();
    if (hook && hook.onChanged) hook.onChanged();
  }

  function render() {
    hotbarRow.innerHTML = '';
    storageGrid.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = makeSlot(i);
      slot.innerHTML = slotInnerHTML(i, inventory.stacks[i], grabbed === i);
      hotbarRow.appendChild(slot);
    }
    for (let i = HOTBAR_SIZE; i < inventory.size; i++) {
      const slot = makeSlot(i);
      slot.innerHTML = slotInnerHTML(i, inventory.stacks[i], grabbed === i);
      storageGrid.appendChild(slot);
    }
    // live-update the selected highlight on the in-world hotbar too
    if (hook && hook.onChanged) hook.onChanged();
  }

  function open() {
    grabbed = null;
    render();
    root.hidden = false;
    if (hook && hook.onToggleLock) hook.onToggleLock(true);
  }
  function close() {
    grabbed = null;
    root.hidden = true;
    if (hook && hook.onToggleLock) hook.onToggleLock(false);
  }
  function isOpen() { return !root.hidden; }
  function toggle() { if (isOpen()) close(); else open(); }

  return { open, close, toggle, isOpen, el: root };
}
