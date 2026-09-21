// test12 — A4 integrated client: deterministic world (A2) + player control (A3)
// + mine/place/drops/pickup/hotbar/inventory loop (A4).
//
// This is the browser entry point. Gameplay logic lives in headless-testable
// src/core/* modules; this file only wires Three.js rendering, input, and the
// shared mutable WorldState (which doubles as both the mesh source and the
// A3 AABB-collider).
import * as THREE from 'three';
import { WORLD } from './core/world.js';
import { findLandSpawn } from './core/terrain.js';
import { CHUNK } from './core/worldgen.js';
import { WorldState } from './core/worldstate.js';
import { createPlayer, PLAYER as P } from './core/physics.js';
import { createInput, createPlayerLoop, syncCamera } from './player.js';
import { raycastBlock, cameraDirection } from './core/targeting.js';
import { Breaking } from './core/breaking.js';
import { createInventory, itemName, stackCapacity } from './core/inventory.js';
import { dropForBlock, createDrop, stepDrop, canPickup } from './core/drops.js';
import { getBlockById, BLOCKS, ITEMS } from './core/blocks.js';
import { isHoeItem } from './core/items.js';
import {
  cropForSeed, cropOfBlock, stageBlockId, harvestDrops, tickCrops, isFarmland, maxStage,
} from './core/farming.js';
import { buildChunkMesh } from './render/worldmesh.js';
import { getAtlasTexture, tileUV, TILES } from './render/atlas.js';
import { recipeBook } from './core/crafting.js';

// Recipe book UI (toggle with B)
const recipePanel = document.getElementById('recipe-book');
const recipeList = document.getElementById('recipe-list');
if (recipeList) {
  recipeList.innerHTML = recipeBook().map((r) => {
    const outId = r.output[0];
    const outName = getBlockById(outId)?.name ?? String(outId);
    const spec = r.pattern ? r.pattern.map((row) => row.join(' ')).join(' / ') : `(shapeless: ${(r.ingredients || []).join('+')})`;
    return `<li><b>${r.name}</b> → ${outName} ×${r.output[1]} · ${spec}</li>`;
  }).join('');
}

const app = document.getElementById('app');
const hudState = document.getElementById('hud-state');
const seed = WORLD.seed;

// ---------- scene / camera / renderer (A2) ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d9);
scene.fog = new THREE.FogExp2(0x87b5d9, 0.008);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 320);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const light = new THREE.AmbientLight(0xf7f3e8, 0.55);
scene.add(light);
const sun = new THREE.DirectionalLight(0xfff5d7, 1.1);
sun.position.set(40, 60, 20);
scene.add(sun);

// ---------- shared mutable world (A4) ----------
const world = new WorldState(seed);

// ---------- player (A3), spawned on land ----------
const landSpawn = findLandSpawn(seed);
const player = createPlayer(landSpawn.x, landSpawn.y, landSpawn.z, 0);
const input = createInput(renderer.domElement, camera, player);
const loop = createPlayerLoop(world, player, input); // WorldState is the collider
syncCamera(camera, player);

// ---------- first-person held item (reflects selected hotbar slot) ----------
let heldMesh = null;
function refreshHeldItem() {
  if (heldMesh) {
    camera.remove(heldMesh);
    heldMesh.geometry.dispose();
    heldMesh = null;
  }
  const stack = inventory.selectedStack();
  const isBlock = getBlockById(stack.id).id !== 0;
  if (stack.count > 0 && isBlock) {
    heldMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.42),
      new THREE.MeshLambertMaterial({ map: getAtlasTexture() }),
    );
    const geo = heldMesh.geometry;
    const [hu0, hv0, hu1, hv1] = tileUV(stack.id % TILES);
    const uvAttr = geo.attributes.uv;
    for (let i = 0; i < uvAttr.count; i++) {
      uvAttr.setXY(i, hu0 + (hu1 - hu0) * uvAttr.getX(i), hv0 + (hv1 - hv0) * uvAttr.getY(i));
    }
    geo.attributes.uv.needsUpdate = true;
    heldMesh.position.set(0.55, -0.42, -0.7);
    camera.add(heldMesh);
  }
}

// ---------- inventory / hotbar (A4) ----------
const inventory = createInventory(9);
// Small starter kit so a tester can immediately place a few blocks.
inventory.add(1, 8); // stone
inventory.add(7, 8); // planks
// B4: a hoe + seeds so farming is immediately testable in a fresh world.
inventory.add(216, 1); // wooden_hoe
inventory.add(220, 12); // wheat_seeds
inventory.add(221, 4); // carrot (plantable + edible)
inventory.add(222, 4); // potato (plantable + edible)
refreshHeldItem();

// ---------- chunk streaming (A2) but meshed from the mutable world ----------
const chunkMeshes = new Map(); // "cx,cz" -> THREE.Mesh
const viewDist = 6;
const loadQueue = [];
const dirtyChunks = new Set(); // rebuild these each frame (post-edit)
const LOAD_PER_FRAME = 3;
const chunkKey = (cx, cz) => `${cx},${cz}`;

function loadChunk(cx, cz) {
  const geo = buildChunkMesh(world, cx, cz);
  const mesh = new THREE.Mesh(geo, solidMaterial());
  mesh.position.set(cx * CHUNK.size, 0, cz * CHUNK.size);
  scene.add(mesh);
  chunkMeshes.set(chunkKey(cx, cz), mesh);
}

function unloadChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  const mesh = chunkMeshes.get(key);
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    chunkMeshes.delete(key);
  }
}

function updateChunks(centre) {
  const pcx = Math.floor(centre.x / CHUNK.size);
  const pcz = Math.floor(centre.z / CHUNK.size);
  const wanted = new Set();
  for (let dx = -viewDist; dx <= viewDist; dx++) {
    for (let dz = -viewDist; dz <= viewDist; dz++) {
      if (dx * dx + dz * dz <= viewDist * viewDist) {
        const key = chunkKey(pcx + dx, pcz + dz);
        wanted.add(key);
        if (!chunkMeshes.has(key)) loadQueue.push([pcx + dx, pcz + dz]);
      }
    }
  }
  for (const key of chunkMeshes.keys()) {
    if (!wanted.has(key)) {
      const [cx, cz] = key.split(',').map(Number);
      unloadChunk(cx, cz);
    }
  }
  const seen = new Set();
  loadQueue.splice(0, loadQueue.length, ...loadQueue.filter(([cx, cz]) => {
    const k = chunkKey(cx, cz);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }));
}

function processLoadQueue() {
  let n = 0;
  while (loadQueue.length && n < LOAD_PER_FRAME) {
    const [cx, cz] = loadQueue.shift();
    if (!chunkMeshes.has(chunkKey(cx, cz))) loadChunk(cx, cz);
    n++;
  }
}

// Rebuild the 3x3 chunk neighbourhood around an edited block so cross-border
// faces are re-culled correctly.
function markEdited(x, y, z) {
  const cx = Math.floor(x / CHUNK.size);
  const cz = Math.floor(z / CHUNK.size);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      dirtyChunks.add(chunkKey(cx + dx, cz + dz));
    }
  }
}

function processDirtyChunks() {
  for (const key of dirtyChunks) {
    const mesh = chunkMeshes.get(key);
    if (!mesh) continue;
    const [cx, cz] = key.split(',').map(Number);
    const geo = buildChunkMesh(world, cx, cz);
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }
  dirtyChunks.clear();
}

let solidMat = null;
function solidMaterial() {
  if (!solidMat) solidMat = new THREE.MeshLambertMaterial({ map: getAtlasTexture() });
  return solidMat;
}

// ---------- targeting + highlight ----------
let target = null;
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
);
highlight.visible = false;
scene.add(highlight);

function aim() {
  const dir = cameraDirection(player.yaw, player.pitch);
  const eye = { x: player.pos.x, y: player.pos.y + P.eyeHeight, z: player.pos.z };
  return raycastBlock(world, eye, dir, 6);
}

// ---------- mining / placement (A4) ----------
const breaking = new Breaking();
let breakingFraction = 0; // per-frame smoothed progress for the HUD/overlay
let prevLmb = false;
// Tracked crops: coordKey("x,y,z") -> { type, age (sim seconds) }.
const crops = new Map();
let mining = false;
let placing = false;
function breakAt(hit) {
  // B4: harvesting a crop spawns the proper drops (mature vs immature).
  const crop = cropOfBlock(hit.id);
  if (crop) {
    const key = WorldState.key(hit.x, hit.y, hit.z);
    const mature = crop.stage === maxStage(crop.type);
    world.set(hit.x, hit.y, hit.z, 0);
    markEdited(hit.x, hit.y, hit.z);
    crops.delete(key);
    for (const it of harvestDrops(crop.type, mature)) {
      drops.push(createDrop(hit.x, hit.y, hit.z, it.itemId, it.count));
    }
    hudState.textContent = `harvested ${crop.type} @ ${hit.x},${hit.y},${hit.z}`;
    return;
  }
  const dropId = dropForBlock(hit.id);
  world.set(hit.x, hit.y, hit.z, 0);
  markEdited(hit.x, hit.y, hit.z);
  if (dropId != null) {
    const d = createDrop(hit.x, hit.y, hit.z, dropId);
    drops.push(d);
  }
  hudState.textContent = `broken ${getBlockById(hit.id).name} @ ${hit.x},${hit.y},${hit.z}`;
}

function shiftAndReload() {
  refreshHeldItem();
}

function isPlaceable(id) {
  const b = getBlockById(id);
  return !!b && b.id !== 0 && b.solid && !b.liquid;
}

// Player AABB overlap check for the placement cell (must not embed the player).
function overlapsPlayer(x, y, z) {
  const hx = P.width / 2;
  const x0 = Math.floor(player.pos.x - hx);
  const x1 = Math.floor(player.pos.x + hx);
  const z0 = Math.floor(player.pos.z - hx);
  const z1 = Math.floor(player.pos.z + hx);
  const y0 = Math.floor(player.pos.y);
  const y1 = Math.floor(player.pos.y + player.height - 1e-9);
  return x >= x0 && x <= x1 && z >= z0 && z <= z1 && y >= y0 && y <= y1;
}

function placeAt(hit) {
  const stack = inventory.selectedStack();
  if (stack.count <= 0 || !isPlaceable(stack.id)) return;
  const px = hit.nx;
  const py = hit.ny;
  const pz = hit.nz;
  const existing = world.get(px, py, pz);
  if (existing !== 0 || overlapsPlayer(px, py, pz)) return; // illegal: not air / inside player
  inventory.takeSelected(1);
  world.set(px, py, pz, stack.id);
  markEdited(px, py, pz);
  hudState.textContent = `placed ${getBlockById(stack.id).name} @ ${px},${py},${pz}`;
  shiftAndReload();
}

// B4 farming interactions with the selected item: till dirt with a hoe, or
// plant a seed on an existing farmland block. Returns true when handled.
function useSelected(hit) {
  const sel = inventory.selectedStack();
  if (sel.count <= 0) return false;

  // (1) Till dirt/grass into farmland with a hoe.
  if (isHoeItem(sel.id) && (hit.id === BLOCKS.dirt.id || hit.id === BLOCKS.grass.id) && !overlapsPlayer(hit.x, hit.y, hit.z)) {
    inventory.takeSelected(1); // consume hoe durability per use (kept simple)
    inventory.add(sel.id, 1); // restore: hoes are not consumed on till
    world.set(hit.x, hit.y, hit.z, 36); // farmland
    markEdited(hit.x, hit.y, hit.z);
    hudState.textContent = `tilled farmland @ ${hit.x},${hit.y},${hit.z}`;
    return true;
  }

  // (2) Plant a seed on a farmland block (grows into the cell above).
  const cropType = cropForSeed(sel.id);
  if (cropType && isFarmland(hit.id)) {
    const ax = hit.x;
    const ay = hit.y + 1;
    const az = hit.z;
    if (world.get(ax, ay, az) === 0 && !overlapsPlayer(ax, ay, az)) {
      inventory.takeSelected(1);
      world.set(ax, ay, az, stageBlockId(cropType, 0));
      markEdited(ax, ay, az);
      crops.set(WorldState.key(ax, ay, az), { type: cropType, age: 0 });
      hudState.textContent = `planted ${cropType} @ ${ax},${ay},${az}`;
      shiftAndReload();
      return true;
    }
  }

  return false; // fall through to normal placement
}

// ---------- drops (A4) ----------
const drops = [];
const dropGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
const dropColorCache = new Map();
function dropMaterial(id) {
  if (!dropColorCache.has(id)) {
    const b = getBlockById(id);
    const item = Object.values(ITEMS).find((i) => i.id === id);
    const color = b && b.id !== 0 ? b.color : item ? item.color : 0xbbbbbb;
    dropColorCache.set(id, new THREE.MeshLambertMaterial({ color: color ?? 0xbbbbbb }));
  }
  return dropColorCache.get(id);
}
const dropMeshes = new Map(); // entity -> Mesh
function renderDrops() {
  for (const d of drops) {
    let m = dropMeshes.get(d);
    if (!m) {
      m = new THREE.Mesh(dropGeo, dropMaterial(d.itemId));
      scene.add(m);
      dropMeshes.set(d, m);
    }
    m.position.set(d.x, d.y, d.z);
    m.visible = d.alive;
  }
}

// ---------- input wiring (A4 additions on top of A3 movement input) ----------
let lmb = false;
let rmb = false;
document.addEventListener('mousedown', (e) => {
  if (e.button === 0) lmb = true;
  if (e.button === 2) rmb = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) lmb = false;
  if (e.button === 2) rmb = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Hotbar selection: number keys 1-9 and mouse wheel.
window.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= inventory.size) {
      inventory.select(n - 1);
      refreshHeldItem();
    }
  }
});
window.addEventListener('wheel', (e) => {
  const delta = Math.sign(e.deltaY);
  inventory.select((inventory.selected + delta + inventory.size) % inventory.size);
  refreshHeldItem();
});

// ---------- HUD (canvas overlay, family of the A2 HUD) ----------
function buildHUD() {
  const canvas = document.createElement('canvas');
  canvas.id = 'hud-canvas';
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '20';
  document.body.appendChild(canvas);
  return { canvas, ctx: canvas.getContext('2d') };
}
const hud = buildHUD();
const hudClock = new THREE.Clock();
const DAY_OFFSET = 4000;

function drawHUD() {
  const ctx = hud.ctx;
  const w = (hud.canvas.width = window.innerWidth);
  const h = (hud.canvas.height = window.innerHeight);

  // Crosshair
  const cx = w / 2;
  const cy = h / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
    ctx.moveTo(cx + dx * 10, cy + dy * 10);
    ctx.lineTo(cx + dx * 3, cy + dy * 3);
  }
  ctx.stroke();

  // Hotbar (9 real inventory slots)
  const slotSize = 42;
  const gap = 4;
  const n = inventory.size;
  const barW = n * slotSize + (n - 1) * gap;
  const bx = (w - barW) / 2;
  const by = h - slotSize - 14;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(bx - 6, by - 6, barW + 12, slotSize + 12);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx - 6, by - 6, barW + 12, slotSize + 12);

  for (let i = 0; i < n; i++) {
    const sx = bx + i * (slotSize + gap);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx, by, slotSize, slotSize);
    ctx.strokeStyle = i === inventory.selected ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = i === inventory.selected ? 3 : 1;
    ctx.strokeRect(sx, by, slotSize, slotSize);

    const s = inventory.stacks[i];
    if (s.count > 0) {
      const b = getBlockById(s.id);
      const it = Object.values(ITEMS).find((x) => x.id === s.id);
      const color = b && b.id !== 0 ? b.color : it ? it.color : 0x999999;
      ctx.fillStyle = `#${(color ?? 0x999999).toString(16).padStart(6, '0')}`;
      ctx.fillRect(sx + 9, by + 9, 24, 24);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = 'bold 13px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(String(s.count), sx + slotSize - 4, by + slotSize - 5);
    }
  }

  // Selected-item readout
  const sel = inventory.selectedStack();
  const selName = sel.count > 0 ? itemName(sel.id) : 'empty';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = '15px system-ui';
  ctx.fillText(`selected: ${selName}${sel.count > 0 ? ` ×${sel.count}` : ''}`, 14, h - 14);

  // Targeting hints
  if (target) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`target ${getBlockById(target.id).name}${Math.abs(breakingFraction) > 0.02 ? ` · breaking ${Math.round(breakingFraction * 100)}%` : ''}`, 14, h - 90);
  }
  if (!input.isLocked()) {
    ctx.fillText('click to capture mouse · LMB mine · RMB place · 1-9/wheel select', w / 2, h - 14);
    ctx.textAlign = 'center';
  }
}

// ---------- resize ----------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ---------- main loop ----------
let elapsed = 0;
let lastUpdate = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastUpdate) / 1000);
  lastUpdate = now;

  // Physics (A3) — WorldState collider includes player edits.
  loop(dt);
  syncCamera(camera, player);

  // Stream + rebuild chunks.
  updateChunks(player.pos);
  processLoadQueue();
  processDirtyChunks();

  // Target the block under the crosshair.
  target = aim();
  if (target) {
    highlight.visible = true;
    highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  } else {
    highlight.visible = false;
    breaking.reset();
    breakingFraction = 0;
  }

  // Mining (LMB, hardness-based); crops are harvested instantly on click.
  const cropT = target ? cropOfBlock(target.id) : null;
  if (cropT) {
    if (lmb && !prevLmb && input.isLocked()) breakAt(target);
    breaking.reset();
    breakingFraction = 0;
  } else if (target && lmb && input.isLocked()) {
    if (breaking.update(target, getBlockById(target.id), dt)) {
      breakAt(target);
    }
  } else if (!lmb) {
    breaking.reset();
  }
  prevLmb = lmb;
  breakingFraction = breaking.progressOf(target);

  // Placement (RMB) — B4 farming interactions get first dibs, else place.
  if (target && rmb && !lmb && input.isLocked()) {
    if (!useSelected(target)) placeAt(target);
  }

  // Drops: physics + pickup into inventory.
  for (const d of drops) {
    if (d.alive) stepDrop(d, world, dt);
    if (d.alive && canPickup(d, player.pos)) {
      const leftover = inventory.add(d.itemId, d.count);
      if (leftover === 0) d.alive = false;
      else d.count = leftover;
      refreshHeldItem();
    }
  }
  renderDrops();

  // Sky tint + fog follow the solar clock (A2).
  const t = now / 1000 * 20;
  const tod = (t + DAY_OFFSET) % WORLD.dayLengthTicks;
  const dayFrac = Math.sin((tod / WORLD.dayLengthTicks) * Math.PI * 2 - Math.PI / 2);
  const blend = Math.min(1, Math.max(0, (dayFrac + 1) / 2));
  const sky = new THREE.Color().lerpColors(new THREE.Color(0x0b1026), new THREE.Color(0x87b5d9), blend);
  scene.background.copy(sky);
  scene.fog.color.copy(sky);

  // B4: advance all crops by this frame's sim-time under current daylight.
  tickCrops(crops, world, dt, blend);

  renderer.render(scene, camera);
  drawHUD();

  elapsed += dt;
  if (elapsed >= 1) {
    hudState.textContent =
      `seed=${seed} · ${chunkMeshes.size} chunks · ${renderer.info.render.triangles} tris · ` +
      `inv ${inventory.total()} items · ${drops.filter((d) => d.alive).length} drops`;
    elapsed = 0;
  }
}
animate();

// toggle recipe book with B
window.addEventListener('keydown', (e) => { if (e.code === 'KeyB') recipePanel.hidden = !recipePanel.hidden; });

hudState.textContent =
  `seed=${seed} · click to capture mouse · LMB mine · RMB place · 1-9/wheel select · B recipes`;
