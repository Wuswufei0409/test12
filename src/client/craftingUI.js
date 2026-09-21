// Interactive crafting panel (Phase C rework, crit 07).
//
// Pure-DOM panel wired to the headless craftingTable logic: click an inventory
// slot to make it the active ingredient, click a grid cell to place one unit
// (consuming from inventory), right-click / middle-click a grid cell to return
// it, and click the result slot to craft. The grid is 2x2 when opened away
// from a crafting table and 3x3 when opened at/near one.
import { getBlockById, BLOCKS, ITEMS } from '../core/blocks.js';
import { itemName } from '../core/inventory.js';
import * as T from '../core/craftingTable.js';

export function createCraftingPanel(inventory, hook) {
  // hook = { onToggleLock(open), getNearCrafting() } for pointer-lock + table detection.
  const root = document.createElement('div');
  root.id = 'crafting-panel';
  root.className = 'panel';
  root.hidden = true;
  document.body.appendChild(root);

  let size = 2; // current grid size (2 or 3)
  const cells = T.emptyCells();

  const label = document.createElement('div');
  label.className = 'panel-title';
  root.appendChild(label);

  const body = document.createElement('div');
  body.className = 'craft-body';
  root.appendChild(body);

  // ---- result slot (craft button) ----
  const result = document.createElement('div');
  result.className = 'result-slot';
  result.title = 'Click to craft';
  body.appendChild(result);

  // ---- grid container ----
  const grid = document.createElement('div');
  grid.className = 'craft-grid';
  body.appendChild(grid);

  // ---- inventory palette ----
  const invLabel = document.createElement('div');
  invLabel.className = 'inv-label';
  invLabel.textContent = 'Inventory — click a slot to select ingredient';
  body.appendChild(invLabel);
  const invRow = document.createElement('div');
  invRow.className = 'inv-row';
  body.appendChild(invRow);

  const hint = document.createElement('div');
  hint.className = 'panel-hint';
  root.appendChild(hint);

  // ---- rendering ----
  function colorFor(id) {
    const b = id !== 0 ? getBlockById(id) : null;
    if (b && b.id !== 0) return b.color;
    const it = Object.values(ITEMS).find((x) => x.id === id);
    return it ? it.color : 0x999999;
  }
  function iconHTML(id, count, sel = false) {
    if (!id || count <= 0) return '<span class="cell-empty"/>';
    const col = colorFor(id);
    const name = itemName(id);
    return `<div class="cell-fill" style="background:#${(col ?? 0x999999).toString(16).padStart(6, '0')}"><span class="cell-name">${name}</span><span class="cell-count">×${count}</span></div>${sel ? '<div class="cell-sel"/>' : ''}`;
  }

  function renderInventory() {
    invRow.innerHTML = '';
    for (let i = 0; i < inventory.size; i++) {
      const s = inventory.stacks[i];
      const slot = document.createElement('div');
      slot.className = 'inv-slot' + (i === inventory.selected ? ' selected' : '');
      slot.innerHTML = iconHTML(s.id, s.count, i === inventory.selected);
      slot.onclick = (ev) => { ev.stopPropagation(); T.paletteSelect(inventory, i); renderAll(); };
      invRow.appendChild(slot);
    }
  }

  function renderGrid() {
    grid.innerHTML = '';
    const n = size;
    grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const idx = r * 3 + c;
        const inRange = r < n && c < n;
        const cell = document.createElement('div');
        cell.className = 'grid-slot' + (inRange ? '' : ' hidden');
        if (inRange) {
          const s = cells[idx];
          cell.innerHTML = iconHTML(s.id, s.count);
          cell.onclick = (ev) => {
            ev.stopPropagation();
            if (T.placeSelected(inventory, cells, idx)) renderAll();
            else if (s.count > 0) { T.removeFromGrid(inventory, cells, idx); renderAll(); }
          };
          cell.oncontextmenu = (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            if (T.removeFromGrid(inventory, cells, idx)) renderAll();
          };
        }
        grid.appendChild(cell);
      }
    }
  }

  function renderResult() {
    const rec = T.previewGrid(cells);
    result.innerHTML = '';
    if (rec) {
      const [outId, count] = rec.output;
      result.innerHTML = `${iconHTML(outId, count)}<div class="result-name">${itemName(outId)}</div>`;
      result.title = `Craft ${rec.name}`;
      result.onclick = (ev) => {
        ev.stopPropagation();
        const out = T.craftGrid(inventory, cells);
        if (out.crafted) { renderAll(); hook && hook.onCrafted && hook.onCrafted(out); }
      };
    } else {
      result.innerHTML = '<span class="result-empty">no recipe</span>';
      result.title = '';
      result.onclick = null;
    }
  }

  function renderAll() {
    label.textContent = `Crafting ${size}x${size} — E/close · B recipe book`;
    hint.textContent = 'Click inventory to pick ingredient · click grid to place · right-click grid to return · click result to craft';
    renderGrid();
    renderResult();
    renderInventory();
  }

  function open() {
    size = (hook && hook.getNearCrafting && hook.getNearCrafting()) ? 3 : 2;
    renderAll();
    root.hidden = false;
    if (hook && hook.onToggleLock) hook.onToggleLock(true);
  }

  function close() {
    // return anything still sitting in the grid to the inventory
    for (let i = 0; i < 9; i++) T.removeFromGrid(inventory, cells, i);
    root.hidden = true;
    if (hook && hook.onToggleLock) hook.onToggleLock(false);
  }

  function isOpen() { return !root.hidden; }
  function toggle() { if (isOpen()) close(); else open(); }

  return { open, close, toggle, isOpen, cells, el: root };
}
