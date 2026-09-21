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
import { createInventory, itemName, stackCapacity, HOTBAR_SIZE, INVENTORY_SIZE } from './core/inventory.js';
import { spillInventory } from './core/death.js';
import { createInventoryPanel } from './client/inventoryUI.js';
import { dropForBlock, createDrop, stepDrop, canPickup } from './core/drops.js';
import { getBlockById, BLOCKS, ITEMS } from './core/blocks.js';
import { isHoeItem } from './core/items.js';
import {
  cropForSeed, cropOfBlock, stageBlockId, harvestDrops, tickCrops, isFarmland, maxStage,
} from './core/farming.js';
import { buildChunkMesh, buildWaterMesh, waterMaterial } from './render/worldmesh.js';
import { getAtlasTexture, tileUV, TILES } from './render/atlas.js';
import { recipeBook } from './core/crafting.js';
import { createCraftingPanel } from './client/craftingUI.js';
import { daylight, isNight, timeLabel, phase, nextDawn } from './core/daycycle.js';
import { createLiving, eatSelected, tickMetabolism, applyDamage, trackFall, foodValue } from './core/living.js';
import { MOBS, createMob, stepMob, damageMob, mobDrops, groundHeight, MOB_HEIGHT } from './core/mobs.js';
import { explode } from './core/explosion.js';
import { weaponStats, resolveMelee, armorReduction, armorSlot, COMBAT } from './core/combat.js';
import { createAir, stepAir, headInWater, underwaterVisibility, isUnderwaterCell, breakUnderwater, drowningDamage } from './core/water.js';
import { applyStructures, treasureLoot, revealTreasure } from './core/structures.js';
import { DIFFICULTY } from './core/world.js';
// B6 aquatic mobs + trident (crit 16/17)
import {
  stepMob as stepMobAquatic, mobInWater, captureWithBucket, releaseFromBucket, hurtMob,
  pufferContactDamage, spawnMobs, mobName, FISH_BUCKET, EMPTY_BUCKET, WATER_BUCKET, MOB_SPECS,
} from './core/aquatic.js';
import { createTrident, throwTrident, stepTrident, tickCooldown, consumeDurability, describeEnchants, TRIDENT_ID, TRIDENT } from './core/trident.js';
import { loadStoredSave, saveToStorage, restoreSnapshot, applyContainers } from './core/save.js';
import { createMemoryStore } from './core/save.js';
// R-08 (crit 08): integrated in-game furnace interaction (headless-tested glue).
import { createFurnaceContainer, tickFurnace, depositStack, takeFromSlot } from './core/furnaceops.js';
import { SMELTING_RECIPES } from './core/smelting.js';

// Recipe book UI (toggle with B)
const recipePanel = document.getElementById('recipe-book');
const recipeList = document.getElementById('recipe-list');
if (recipeList) {
  recipeList.innerHTML = recipeBook().map((r) => {
    const outId = r.output[0];
    const outName = itemName(outId);
    const spec = r.pattern ? r.pattern.map((row) => row.join(' ')).join(' / ') : `(shapeless: ${(r.ingredients || []).join('+')})`;
    return `<li><b>${r.name}</b> → ${outName} ×${r.output[1]} · ${spec}</li>`;
  }).join('');
}

const app = document.getElementById('app');
const hudState = document.getElementById('hud-state');
const seed = WORLD.seed;

// ---------- scene / camera / renderer (A2) ----------
const scene = new THREE.Scene();

// R-02: vertical sky gradient instead of a flat color fill, so the horizon and
// zenith read as a clean sky band (no single-colour void dominating the frame).
const SKY_GRAD = { canvas: null, ctx: null, tex: null, last: '' };
function makeSkyGradient() {
  if (SKY_GRAD.tex) return;
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  SKY_GRAD.canvas = canvas;
  SKY_GRAD.ctx = ctx;
  SKY_GRAD.tex = tex;
  return tex;
}
function setSkyGradient(horizon) {
  const tex = makeSkyGradient();
  if (!tex) return;
  const hexH = '#' + new THREE.Color(horizon).getHexString();
  // Zenith is a richer, deeper shade of the same hue; horizon is the base tone.
  const zenith = new THREE.Color(horizon).multiplyScalar(0.42);
  const hexZ = '#' + zenith.getHexString();
  const key = hexZ + '|' + hexH;
  if (SKY_GRAD.last === key) return; // avoid pointless canvas redraws each frame
  SKY_GRAD.last = key;
  const ctx = SKY_GRAD.ctx;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, hexZ);
  g.addColorStop(1, hexH);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  tex.needsUpdate = true;
}
scene.background = makeSkyGradient();
// Perf (crit 19): use linear cheap fog (three.Fog) instead of the expensive
// per-fragment exponential fog (FogExp2). Visually near-identical for a voxel
// horizon, but drastically cheaper in software rasterizers and on low-end
// integrated GPUs, keeping the game well above 30 FPS.
scene.fog = new THREE.Fog(0x87b5d9, 60, 320);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 320);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
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

// B5 air/oxygen meter (crit 14) — replenished in air, depletes underwater.
const airState = createAir();
let playerHealth = 20;

// B5 ocean structures (crit 15) are derived from the same seed, so they are
// stable per world; applying them as overlay edits keeps base terrain intact.
function applyOceanStructures(cx, cz) {
  applyStructures(world, seed, cx, cz);
}

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
const inventory = createInventory(INVENTORY_SIZE); // 9 hotbar + 27 storage (crit 06)
// Small starter kit so a tester can immediately place/survive.
inventory.add(1, 8); // stone
inventory.add(7, 8); // planks
inventory.add(BLOCKS.bed.id, 1); // bed (place on solid ground; F to sleep at night)
inventory.add(ITEMS.bread.id, 8); // food (RMB to eat when hungry)
// B4: a hoe + seeds so farming is immediately testable in a fresh world.
inventory.add(216, 1); // wooden_hoe
inventory.add(220, 12); // wheat_seeds
inventory.add(221, 4); // carrot (plantable + edible)
inventory.add(222, 4); // potato (plantable + edible)
inventory.add(112, 2); // empty buckets (B6 bucket capture)
inventory.add(TRIDENT_ID, 1); // trident (B6 crit 17 demo)
refreshHeldItem();

// ---------- interactive crafting + full-inventory UI (Phase C rework, crit 07/06) ----------
let craftingOpen = false;
let inventoryOpen = false;
function acquirePointerLock() {
  if (!document.pointerLockElement) renderer.domElement.requestPointerLock();
}
function releasePointerLock() {
  if (document.pointerLockElement) document.exitPointerLock();
}
// A crafting table within reach (looked at or nearby floor blocks) unlocks 3x3.
function nearCraftingTable() {
  if (target && target.id === BLOCKS.crafting_table.id) return true;
  const px = Math.floor(player.pos.x);
  const py = Math.floor(player.pos.y - 0.6);
  const pz = Math.floor(player.pos.z);
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -1; dy <= 2; dy += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        if (world.get(px + dx, py + dy, pz + dz) === BLOCKS.crafting_table.id) return true;
      }
    }
  }
  return false;
}
const craftingPanel = createCraftingPanel(inventory, {
  getNearCrafting: nearCraftingTable,
  onToggleLock(open) {
    craftingOpen = open;
    window.__craftingOpen = open;
    if (open) releasePointerLock();
    else { setTimeout(acquirePointerLock, 0); refreshHeldItem(); }
  },
  onCrafted() { refreshHeldItem(); },
});
const inventoryPanel = createInventoryPanel(inventory, {
  onToggleLock(open) {
    inventoryOpen = open;
    window.__inventoryOpen = open;
    if (open) releasePointerLock();
    else setTimeout(acquirePointerLock, 0);
  },
  onChanged() { refreshHeldItem(); },
});
// E toggles inventory (or crafting when near a crafting table). B recipe book stays.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE') return;
  if (craftingPanel.isOpen()) { craftingPanel.toggle(); return; }
  if (inventoryPanel.isOpen()) { inventoryPanel.toggle(); return; }
  (nearCraftingTable() ? craftingPanel : inventoryPanel).toggle();
});


// ---------- survival state (B2) ----------
const living = createLiving();
let difficulty = 'normal';
let deaths = 0;
let spawnPoint = { x: landSpawn.x, y: landSpawn.y, z: landSpawn.z };
let worldTime = 0; // absolute sim ticks; tick 0 = 6:00 day 1
let respawnTimer = 0;
let sleepingMsg = null;
let sleepMsgTimer = 0;

// ---------- mobs + combat (B3) ----------
const mobs = [];
const PASSIVE_TYPES = ['pig', 'cow', 'sheep', 'chicken'];
const HOSTILE_TYPES = ['zombie', 'spider', 'creeper'];
let mobTimer = 0;       // spawn / upkeep accumulator (ticks)
const MAX_MOBS = 40;
let meleeCooldown = 0;  // ticks until next swing
let equipped = [];      // armor item ids currently worn
let hitFeedback = null; // {amount, time} rendered for a short while
let hitFeedbackTimer = 0;

const mobGeo = new THREE.BoxGeometry(0.6, 0.9, 0.6);
const mobMatCache = new Map();
function mobMaterial(color) {
  if (!mobMatCache.has(color)) mobMatCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return mobMatCache.get(color);
}
const mobMeshes = new Map(); // mob -> Mesh
function renderMobs() {
  // remove meshes for dead/despawned mobs
  for (const [m, mesh] of mobMeshes) {
    if (!m.alive) { scene.remove(mesh); mobMeshes.delete(m); }
  }
  for (const m of mobs) {
    if (!m.alive) continue;
    let mesh = mobMeshes.get(m);
    if (!mesh) {
      mesh = new THREE.Mesh(mobGeo, mobMaterial(MOBS[m.type].color));
      scene.add(mesh);
      mobMeshes.set(m, mesh);
    }
    mesh.position.set(m.x, m.y + MOB_HEIGHT * 0.4, m.z);
    // creeper flashes as it fuses
    if (m.type === 'creeper' && m.fuse > 0) {
      mesh.material.color.set(Math.floor(m.fuse) % 2 === 0 ? 0xffffff : 0x4a9a3c);
    } else {
      mesh.material.color.set(MOBS[m.type].color);
    }
    mesh.visible = true;
  }
}

// Spawn a mob near a ground position if within loaded chunks and under cap.
function trySpawnMob() {
  if (mobs.length >= MAX_MOBS) return;
  const angle = Math.random() * Math.PI * 2;
  const dist = 14 + Math.random() * 22;
  const gx = player.pos.x + Math.cos(angle) * dist;
  const gz = player.pos.z + Math.sin(angle) * dist;
  const gy = groundHeight(world, gx, gz);
  const type = pickMobType();
  const m = createMob(type, gx, gy, gz);
  mobs.push(m);
}
function pickMobType() {
  const night = isNight(worldTime);
  const pool = [...PASSIVE_TYPES];
  if (difficulty !== 'peaceful' && night) pool.push(...HOSTILE_TYPES);
  else if (difficulty !== 'peaceful' && Math.random() < 0.25) pool.push(...HOSTILE_TYPES); // some daytime hostiles
  return pool[Math.floor(Math.random() * pool.length)];
}

// Player attacks the mob the crosshair would hit (nearest mob along aim within a cone/range).
function aimedMob() {
  const dir = cameraDirection(player.yaw, player.pitch);
  const eye = { x: player.pos.x, y: player.pos.y + P.eyeHeight, z: player.pos.z };
  let best = null, bestT = Infinity;
  for (const m of mobs) {
    if (!m.alive) continue;
    const mx = m.x, my = m.y + MOB_HEIGHT * 0.5, mz = m.z;
    const ox = mx - eye.x, oy = my - eye.y, oz = mz - eye.z;
    const t = ox * dir.x + oy * dir.y + oz * dir.z;
    if (t < 0 || t > 6) continue;
    const closest = Math.hypot(ox - dir.x * t, oy - dir.y * t, oz - dir.z * t);
    if (closest < 0.9 && t < bestT) { best = m; bestT = t; }
  }
  return best;
}

function meleeSwing(m) {
  const sel = inventory.selectedStack();
  const stats = weaponStats(sel.count > 0 ? sel.id : null);
  const res = resolveMelee(player, m, sel.count > 0 ? sel.id : null, meleeCooldown, equipped);
  if (res === null) return; // on cooldown
  if (!res.hit) return; // out of range / miss
  const dm = damageMob(m, res.damage, res.knockback);
  meleeCooldown = res.feedback.cooldown;
  hitFeedback = res.feedback;
  hitFeedbackTimer = 20;
  if (dm.killed) killMob(m);
  // durability: swords wear down; break removes item (hand stays)
  if (sel.count > 0 && weaponStats(sel.id) !== COMBAT.HAND_DAMAGE) {
    const wd = (stackDurability.get(sel) || 60) - 1;
    stackDurability.set(sel, wd);
    if (wd <= 0) { inventory.takeSelected(1); refreshHeldItem(); }
  }
}

const stackDurability = new Map(); // inventory stack -> remaining durability

// --- bow / arrows (crit 12 ranged combat) ---
const arrows = []; // {x,y,z, vx,vy,vz, age, alive}
const arrowGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6);
const arrowMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
const arrowMeshes = new Map();
const ARROW_SPEED = 34;
const ARROW_LIFE = 3.5; // seconds before despawn

function fireBow() {
  const sel = inventory.selectedStack();
  if (sel.id !== ITEMS.bow?.id && sel.id !== 103) return; // only bow fires
  if (sel.count <= 0) return;
  const dir = cameraDirection(player.yaw, player.pitch);
  const eye = { x: player.pos.x, y: player.pos.y + P.eyeHeight, z: player.pos.z };
  arrows.push({
    x: eye.x + dir.x * 0.4, y: eye.y + dir.y * 0.4, z: eye.z + dir.z * 0.4,
    vx: dir.x * ARROW_SPEED, vy: dir.y * ARROW_SPEED, vz: dir.z * ARROW_SPEED,
    age: 0, alive: true,
  });
  // needs an arrow in the inventory too; else just visual shot without consume
  for (let i = 0; i < inventory.stacks.length; i++) {
    if (inventory.stacks[i].id === 104 && inventory.stacks[i].count > 0) {
      inventory.stacks[i].count -= 1;
      break;
    }
  }
  refreshHeldItem();
}

function stepArrows(dt) {
  for (const a of arrows) {
    a.age += dt;
    if (a.age > ARROW_LIFE) { a.alive = false; continue; }
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    // hit a mob
    for (const m of mobs) {
      if (!m.alive) continue;
      const dx = m.x - a.x, dy = (m.y + MOB_HEIGHT * 0.5) - a.y, dz = m.z - a.z;
      if (Math.hypot(dx, dy, dz) < 0.7) {
        const dm = damageMob(m, COMBAT.BOW_DAMAGE, { x: a.vx * 0.02, z: a.vz * 0.02 });
        hitFeedback = { amount: COMBAT.BOW_DAMAGE }; hitFeedbackTimer = 20;
        a.alive = false;
        if (dm.killed) killMob(m);
        break;
      }
    }
    // hit a solid block (rough surface check)
    if (world.isSolid(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z))) a.alive = false;
  }
  // cull dead arrows + render
  for (let i = arrows.length - 1; i >= 0; i--) { if (!arrows[i].alive) arrows.splice(i, 1); }
  for (const [a, mesh] of arrowMeshes) { if (!a.alive) { scene.remove(mesh); arrowMeshes.delete(a); } }
  for (const a of arrows) {
    let mesh = arrowMeshes.get(a);
    if (!mesh) { mesh = new THREE.Mesh(arrowGeo, arrowMat); scene.add(mesh); arrowMeshes.set(a, mesh); }
    mesh.position.set(a.x, a.y, a.z);
    mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
  }
}

function killMob(m) {
  const ds = mobDrops(m);
  for (const d of ds) {
    const drop = createDrop(m.x, m.y + 0.4, m.z, d.id, d.count);
    drops.push(drop);
  }
}

// ---------- chunk streaming (A2) but meshed from the mutable world ----------
const chunkMeshes = new Map(); // "cx,cz" -> THREE.Mesh (opaque solid)
const waterMeshes = new Map(); // "cx,cz" -> THREE.Mesh (translucent water surface)
const viewDist = 6;
const loadQueue = [];
const dirtyChunks = new Set(); // rebuild these each frame (post-edit)
const LOAD_PER_FRAME = 3;
const chunkKey = (cx, cz) => `${cx},${cz}`;

function loadChunk(cx, cz) {
  applyOceanStructures(cx, cz); // deterministic B5 ocean content (shipwreck/ruin/treasure)
  const geo = buildChunkMesh(world, cx, cz);
  const mesh = new THREE.Mesh(geo, solidMaterial());
  // buildChunkMesh emits vertices in WORLD coordinates, so the mesh itself
  // must NOT carry any per-chunk offset (R-02: fixes displaced/scattered voxels
  // that left giant voids in the first-person render).
  mesh.position.set(0, 0, 0);
  scene.add(mesh);
  chunkMeshes.set(chunkKey(cx, cz), mesh);

  // R-02: visible ocean surface so water is not an empty void.
  const waterGeo = buildWaterMesh(world, cx, cz);
  if (waterGeo) {
    const water = new THREE.Mesh(waterGeo, waterMaterial());
    water.position.set(0, 0, 0);
    scene.add(water);
    waterMeshes.set(chunkKey(cx, cz), water);
  }
}

function unloadChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  const mesh = chunkMeshes.get(key);
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    chunkMeshes.delete(key);
  }
  const water = waterMeshes.get(key);
  if (water) {
    scene.remove(water);
    water.geometry.dispose();
    waterMeshes.delete(key);
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
    const [cx, cz] = key.split(',').map(Number);
    const mesh = chunkMeshes.get(key);
    if (mesh) {
      const geo = buildChunkMesh(world, cx, cz);
      mesh.geometry.dispose();
      mesh.geometry = geo;
    }
    // Rebuild the water surface too (mining/placing edits can change it).
    const oldWater = waterMeshes.get(key);
    if (oldWater) {
      scene.remove(oldWater);
      oldWater.geometry.dispose();
      waterMeshes.delete(key);
    }
    const waterGeo = buildWaterMesh(world, cx, cz);
    if (waterGeo) {
      const water = new THREE.Mesh(waterGeo, waterMaterial());
      water.position.set(0, 0, 0);
      scene.add(water);
      waterMeshes.set(key, water);
    }
  }
  dirtyChunks.clear();
}

let solidMat = null;
function solidMaterial() {
  if (!solidMat) solidMat = new THREE.MeshLambertMaterial({ map: getAtlasTexture() });
  return solidMat;
}

// B5: trease_chest block id + treasure_map item id (block/loot wiring, crit 15).
const TREASURE_CHEST_ID = (BLOCKS.treasure_chest && BLOCKS.treasure_chest.id) ?? 41;
const TREASURE_MAP_ID = (ITEMS && ITEMS.treasure_map && ITEMS.treasure_map.id) ?? 119;
let currentDifficulty = 'normal'; // peaceful | easy | normal — scales drowning damage (crit 14)

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
  // Underwater breaks fill the cell with water (no erroneous air pockets).
  const underwater = isUnderwaterCell(world, hit.x, hit.y, hit.z);
  world.set(hit.x, hit.y, hit.z, breakUnderwater(underwater));
  markEdited(hit.x, hit.y, hit.z);
  // Buried treasure chests drop the mineable reward (coral + prismarine + diamond)
  // directly instead of the chest block itself (crit 15 loot wiring).
  if (hit.id === TREASURE_CHEST_ID) {
    for (const l of treasureLoot()) {
      drops.push(createDrop(hit.x, hit.y, hit.z, l.itemId, l.count));
    }
  } else {
    const dropId = dropForBlock(hit.id);
    if (dropId != null) {
      const d = createDrop(hit.x, hit.y, hit.z, dropId);
      drops.push(d);
    }
  }
  hudState.textContent = `broken ${getBlockById(hit.id).name} @ ${hit.x},${hit.y},${hit.z}`;
}

function shiftAndReload() {
  refreshHeldItem();
}

function isPlaceable(id) {
  const b = getBlockById(id);
  return !!b && b.id !== 0 && !b.liquid;
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
  const block = getBlockById(stack.id);
  // non-solid blocks (e.g. bed) need a solid support beneath them.
  if (!block.solid && !world.isSolid(px, py - 1, pz)) return;
  inventory.takeSelected(1);
  world.set(px, py, pz, stack.id);
  markEdited(px, py, pz);
  hudState.textContent = `placed ${block.name} @ ${px},${py},${pz}`;
  shiftAndReload();
}

// ---------- survival helpers (B2): death / respawn / sleep ----------
let didDropDeath = false;
// On death, drop the player's full inventory as world drops at the death
// location, clear the inventory, and show a visible message (crit 06).
function dropInventoryOnDeath() {
  const dropped = spillInventory(inventory);
  for (const d of dropped) {
    drops.push(createDrop(player.pos.x, player.pos.y, player.pos.z, d.id, d.count));
  }
  refreshHeldItem();
  sleepingMsg = 'You died — inventory dropped at death point';
  sleepMsgTimer = 4;
  didDropDeath = true;
}

function respawn() {
  Object.assign(living, createLiving());
  deaths += 1;
  player.pos.x = spawnPoint.x;
  player.pos.y = spawnPoint.y;
  player.pos.z = spawnPoint.z;
  player.vel.y = 0;
  didDropDeath = false;
  sleepingMsg = 'You died — respawned at spawn point';
  sleepMsgTimer = 3;
}

function sleepNow() {
  if (!living.alive || !isNight(worldTime)) return;
  spawnPoint = { x: target.x + 0.5, y: target.y + 1, z: target.z + 0.5 };
  worldTime = nextDawn(worldTime);
  sleepingMsg = 'Slept until dawn — spawn point set at bed';
  sleepMsgTimer = 4;
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

// ---------- B6 aquatic mobs (crit 16) ----------
const aquaticMobs = [];
const mobGeoAquatic = new THREE.BoxGeometry(0.7, 0.5, 0.5);
const mobMatCacheAquatic = new Map();
function mobMaterialAquatic(color) {
  if (!mobMatCacheAquatic.has(color)) {
    mobMatCacheAquatic.set(color, new THREE.MeshLambertMaterial({ color }));
  }
  return mobMatCacheAquatic.get(color);
}
const mobMeshesAquatic = new Map(); // mob -> Mesh
function spawnNearbyMobs() {
  // Add a few aquatic mobs if none are near, sampled from nearby ocean cells.
  if (aquaticMobs.filter((m) => m.alive).length >= 12) return;
  const rng = Math.random;
  const mobs = spawnMobs(world, player.pos.x - 24, player.pos.x + 24, 34, 50, player.pos.z - 24, player.pos.z + 24, 6, rng);
  for (const m of mobs) aquaticMobs.push(m);
}
function renderAquaticMobs() {
  for (const mob of aquaticMobs) {
    if (!mob.alive) {
      const mesh = mobMeshesAquatic.get(mob);
      if (mesh) { mesh.visible = false; }
      continue;
    }
    let mesh = mobMeshesAquatic.get(mob);
    if (!mesh) {
      const spec = MOB_SPECS[mob.type];
      mesh = new THREE.Mesh(mobGeoAquatic, mobMaterialAquatic(spec.color));
      scene.add(mesh);
      mobMeshesAquatic.set(mob, mesh);
    }
    const spec = MOB_SPECS[mob.type];
    // pufferfish visibly grows when puffed (crit 16 visible state)
    const scale = mob.type === 'pufferfish'
      ? (spec.normalSize + (spec.puffedSize - spec.normalSize) * mob.puff) / spec.normalSize
      : 1;
    mesh.scale.set(scale, scale, scale);
    mesh.position.set(mob.x, mob.y, mob.z);
    mesh.visible = true;
  }
}

// ---------- B6 trident projectile (crit 17) ----------
const tridentProjects = [];
const tridentProjMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.12, 0.12, 0.7),
  new THREE.MeshLambertMaterial({ color: 0x7fd8d8 }),
);
scene.add(tridentProjMesh);
function stepTridentProjectiles(dt) {
  const alive = [];
  for (const proj of tridentProjects) {
    if (!proj.alive) continue;
    const events = stepTrident(proj, world, aquaticMobs, dt, { raining: false, thundering: false });
    if (events.hitMob) {
      hurtMob(events.hitMob, events.damage);
    }
    if (proj.alive) alive.push(proj);
  }
  tridentProjects.length = 0;
  for (const p of alive) tridentProjects.push(p);
  // show the (single, first) active projectile for a lightweight in-world cue
  tridentProjMesh.visible = false;
  for (const proj of tridentProjects) {
    if (proj.alive) { tridentProjMesh.visible = true; tridentProjMesh.position.set(proj.x, proj.y, proj.z); break; }
  }
}

// Hold a player trident + bucket state for B6 interactions.
// Channeling+Impaling+Impaling are on by default so the in-game trident shows
// bonus vs aquatic damage and thunder bolts; Loyalty/Riptide demo via keys.
let playerTrident = createTrident({ channeling: 1, impaling: 2 });
let tridentEnchantDemo = 'impaling'; // toggles between impaling/channeling/loyalty/riptide


// ---------- input wiring (A4 additions on top of A3 movement input) ----------
let lmb = false;
let useRequest = false;
document.addEventListener('mousedown', (e) => {
  if (craftingOpen || inventoryOpen) return;
  if (e.button === 0) lmb = true;
  if (e.button === 2) useRequest = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) lmb = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Hotbar selection: number keys 1-9 and mouse wheel.
window.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= HOTBAR_SIZE) {
      inventory.select(n - 1);
      refreshHeldItem();
    }
  }
  // F = use: sleep on a targeted bed at night.
  if (e.code === 'KeyF' && target && target.id === BLOCKS.bed.id) {
    sleepNow();
  }
  // G = equip/unequip selected armor piece.
  if (e.code === 'KeyG') {
    const sel = inventory.selectedStack();
    const slot = sel.count > 0 ? armorSlot(sel.id) : null;
    if (slot) {
      equipped = equipped.filter((id) => armorSlot(id) !== slot);
      equipped.push(sel.id);
      inventory.takeSelected(1);
      refreshHeldItem();
    }
  }
});
window.addEventListener('wheel', (e) => {
  const delta = Math.sign(e.deltaY);
  inventory.select((inventory.selected + delta + HOTBAR_SIZE) % HOTBAR_SIZE);
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

function drawHUD() {
  const ctx = hud.ctx;
  const w = (hud.canvas.width = window.innerWidth);
  const h = (hud.canvas.height = window.innerHeight);
  const night = isNight(worldTime);

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
  const n = HOTBAR_SIZE; // the in-world hotbar shows only the 9 hotbar slots
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

  // B5: oxygen + health bars (top-left)
  const barW2 = 150, barH2 = 9;
  const bx2 = 14, by2 = 14;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(bx2 - 3, by2 - 3, barW2 + 6, 26);
  // oxygen bar
  const oxFrac = airState.air / airState.max;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx2, by2, barW2, barH2);
  ctx.fillStyle = oxFrac > 0.25 ? 'rgba(70,180,255,0.9)' : 'rgba(255,80,80,0.9)';
  ctx.fillRect(bx2, by2, barW2 * oxFrac, barH2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
  ctx.fillText('O2', bx2, by2 - 2);
  // health bar
  const hpFrac = playerHealth / 20;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx2, by2 + barH2 + 3, barW2, barH2);
  ctx.fillStyle = hpFrac > 0.3 ? 'rgba(255,80,80,0.95)' : 'rgba(180,0,0,0.95)';
  ctx.fillRect(bx2, by2 + barH2 + 3, barW2 * hpFrac, barH2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText('HP', bx2, by2 + barH2 + 3 - 2);

  // Selected-item readout
  const sel = inventory.selectedStack();
  const selName = sel.count > 0 ? itemName(sel.id) : 'empty';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = '15px system-ui';
  ctx.fillText(`selected: ${selName}${sel.count > 0 ? ` ×${sel.count}` : ''}`, 14, h - 14);

  // Status bars (top-left): health, hunger, air.
  const bX = 14;
  const bW = 110;
  const bH = 9;
  const drawBar = (y, frac, color) => {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bX, y, bW, bH);
    ctx.fillStyle = color;
    ctx.fillRect(bX, y, Math.round(bW * Math.max(0, Math.min(1, frac))), bH);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bX, y, bW, bH);
  };
  let bY = 16;
  drawBar(bY, living.health / living.maxHealth, '#e03131');
  ctx.fillStyle = '#fff';
  ctx.font = '11px system-ui';
  ctx.fillText(`HP ${Math.ceil(living.health)}/${living.maxHealth}${living.alive ? '' : ' (dead)'}`, bX + bW + 8, bY + 9);
  bY += bH + 5;
  drawBar(bY, living.hunger / living.maxHunger, '#d9923a');
  ctx.fillText(`Hunger ${Math.floor(living.hunger)}`, bX + bW + 8, bY + 9);
  if (living.air < living.maxAir) {
    bY += bH + 5;
    drawBar(bY, living.air / living.maxAir, '#4dabf7');
    ctx.fillText('Oxygen', bX + bW + 8, bY + 9);
  }
  // Armor bar (B3): total armor points from equipped pieces.
  if (equipped.length > 0) {
    const pts = equipped.reduce((n, id) => n + (COMBAT.ARMOR[id] ? COMBAT.ARMOR[id].armorPoints : 0), 0);
    bY += bH + 5;
    drawBar(bY, Math.min(1, pts / 20), '#a678d8');
    ctx.fillText(`Armor ${pts}`, bX + bW + 8, bY + 9);
  }
  // Hit feedback (B3): brief damage amount flash when landing a swing.
  if (hitFeedbackTimer > 0 && hitFeedback) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 20px system-ui';
    ctx.fillText(`-${hitFeedback.amount}`, w / 2 + 24, h / 2 - 10);
  }

  // Time / phase / difficulty (top-right).
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = 'bold 15px system-ui';
  ctx.fillText(`${timeLabel(worldTime)} · ${night ? 'NIGHT' : phase(worldTime).toUpperCase()}`, w - 14, 22);
  ctx.font = '12px system-ui';
  ctx.fillStyle = night ? 'rgba(255,150,120,0.95)' : 'rgba(255,255,255,0.85)';
  ctx.fillText(`difficulty ${difficulty}${night ? ' · hostiles active' : ''}`, w - 14, 38);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(`spawn ${Math.round(spawnPoint.x)},${Math.round(spawnPoint.y)},${Math.round(spawnPoint.z)} · deaths ${deaths}`, w - 14, 54);
  // B6: trident enchant + aquatic readout (crit 16/17 HUD)
  if (sel.id === TRIDENT_ID) {
    ctx.fillStyle = 'rgba(140,255,220,0.95)';
    ctx.fillText(`trident [${tridentEnchantDemo}] ${describeEnchants(playerTrident.enchants)} · dur ${playerTrident.durability}`, 14, h - 30);
    ctx.fillText(`T cycles enchant; RMB throws`, 14, h - 46);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const mobAlive = aquaticMobs.filter((m) => m.alive).length;
  ctx.fillText(`aquatic mobs ${mobAlive} · empty bucket RMB captures fish · fish bucket RMB releases`, 14, h - 76);

  // B5: treasure map reveal — holding a map points to the nearest buried
  // treasure (crit 15 in-game reveal action).
  if (sel.id === TREASURE_MAP_ID && player.pos) {
    const nearest = revealTreasure(world, seed, player.pos, 128);
    ctx.fillStyle = 'rgba(255,240,160,0.95)';
    ctx.font = '14px system-ui';
    if (nearest) {
      const dirDeg = ((Math.atan2(nearest.x - player.pos.x, nearest.z - player.pos.z) * 180 / Math.PI) + 360) % 360;
      ctx.fillText(`TREASURE ${Math.round(nearest.dist)}m away — heading ${Math.round(dirDeg)}° (${Math.round(nearest.x)},${Math.round(nearest.z)})`, 14, h - 66);
    } else {
      ctx.fillText('TREASURE — no buried treasure within range', 14, h - 66);
    }
  }

  // Targeting hints
  if (target) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`target ${getBlockById(target.id).name}${Math.abs(breakingFraction) > 0.02 ? ` · breaking ${Math.round(breakingFraction * 100)}%` : ''}`, 14, h - 90);
  }
  if (!input.isLocked()) {
    ctx.fillText('click to capture mouse · LMB mine · RMB eat/place · 1-9/wheel select · E inventory · F sleep on bed', w / 2, h - 14);
    ctx.textAlign = 'center';
  }

  // Sleep / respawn banner.
  if (sleepMsgTimer > 0 && sleepingMsg) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 18px system-ui';
    ctx.fillText(sleepingMsg, w / 2, h * 0.3);
  }

  // Death overlay.
  if (!living.alive) {
    ctx.fillStyle = 'rgba(120,10,10,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px system-ui';
    ctx.fillText('You Died', w / 2, h / 2 - 20);
    ctx.font = '16px system-ui';
    ctx.fillText('Respawning…', w / 2, h / 2 + 12);
  }
}

// ---------- resize ----------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ---------- B7 persistence (crit 18): build a snapshot of all durable state ----------
const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : createMemoryStore();
function buildSnapshot() {
  return {
    seed,
    worldTime,
    difficulty,
    player: player, // pos/yaw/pitch/vel (mutated live)
    living,
    spawnPoint,
    deaths,
    inventory: {
      selected: inventory.selected,
      stacks: inventory.stacks.map((s) => ({ id: s.id, count: s.count })),
    },
    equipped,
    worldEdits: Array.from(world.edits.entries()),
    containers: worldContainers,
    drops: drops.filter((d) => d.alive).map((d) => ({ ...d })),
    mobs: mobs.filter((m) => m.alive).map((m) => ({ ...m })),
  };
}
// Active chest/furnace container state keyed by "x,y,z" (block edits persist the
// blocks themselves; this holds their contents). Client may populate as needed.
const worldContainers = {};

// ---------- R-08 furnace GUI (crit 08): integrated in-game smelting ----------
const FURNACE_ID = (BLOCKS.furnace && BLOCKS.furnace.id) ?? 16;
let activeFurnaceKey = null;
function furnaceSlotColor(id) {
  const b = getBlockById(id);
  const it = Object.values(ITEMS).find((x) => x.id === id);
  return b && b.id !== 0 ? b.color : it ? it.color : 0x999999;
}
function openFurnaceGUI(key) {
  if (!worldContainers[key]) worldContainers[key] = createFurnaceContainer();
  activeFurnaceKey = key;
  furnaceGUI.style.display = 'block';
  renderFurnaceGUI();
}
function closeFurnaceGUI() {
  activeFurnaceKey = null;
  furnaceGUI.style.display = 'none';
}
const furnaceGUI = document.createElement('div');
furnaceGUI.id = 'furnace-gui';
furnaceGUI.style.cssText = 'position:fixed;left:50%;top:56px;transform:translateX(-50%);z-index:60;' +
  'background:rgba(18,18,28,0.92);border:2px solid #555;border-radius:8px;padding:12px 16px;' +
  'color:#fff;font:14px/1.35 system-ui;display:none;text-align:center;min-width:300px;user-select:none;';
furnaceGUI.innerHTML = `
  <div style="font-weight:bold;margin-bottom:6px">Furnace<span id="furnace-pos" style="color:#888;font-weight:normal;font-size:11px;margin-left:8px"></span></div>
  <div style="display:flex;justify-content:center;gap:16px;margin:6px 0">
    ${['input', 'fuel', 'output'].map((w) => `<div class="fslot" data-which="${w}" title="${w} (click to take)" style="cursor:pointer"><div style="font-size:11px;color:#aaa">${w}</div><div class="fitem" data-which="${w}" style="min-height:34px;line-height:34px;font-size:12px">—</div></div>`).join('')}
  </div>
  <div style="margin:6px 0">
    <div id="furnace-status" style="font-size:12px;color:#aaa">idle</div>
    <div style="height:12px;border:1px solid #444;border-radius:4px;background:#151520;margin-top:4px;overflow:hidden">
      <div id="furnace-progress" style="height:100%;width:0%;background:#3f9fd8;transition:width .1s linear"></div>
    </div>
  </div>
  <div id="furnace-hotbar" style="display:flex;justify-content:center;gap:4px;margin-top:8px"></div>
  <div style="display:flex;justify-content:center;gap:10px;margin-top:10px">
    <button id="furnace-close" style="cursor:pointer;padding:4px 14px;border:1px solid #666;border-radius:4px;background:#2a2a3a;color:#fff">Close</button>
  </div>`;
document.body.appendChild(furnaceGUI);

document.getElementById('furnace-close').addEventListener('click', closeFurnaceGUI);
furnaceGUI.querySelectorAll('.fslot').forEach((slot) => {
  slot.addEventListener('click', () => {
    if (!activeFurnaceKey) return;
    const c = worldContainers[activeFurnaceKey];
    const taken = takeFromSlot(c, slot.dataset.which);
    if (taken) {
      const leftover = inventory.add(taken.id, taken.count);
      if (leftover > 0) c[slot.dataset.which] = { id: taken.id, count: leftover };
    }
    renderFurnaceGUI();
    refreshHeldItem();
  });
});
furnaceGUI.querySelector('#furnace-hotbar').addEventListener('click', (e) => {
  const btn = e.target.closest('.fhslot');
  if (!btn || !activeFurnaceKey) return;
  const i = Number(btn.dataset.i);
  const st = inventory.stacks[i];
  if (!st || st.count <= 0) return;
  const moved = { id: st.id, count: st.count };
  const c = worldContainers[activeFurnaceKey];
  const leftover = depositStack(c, moved);
  if (leftover) { st.id = leftover.id; st.count = leftover.count; }
  else { st.id = 0; st.count = 0; }
  renderFurnaceGUI();
  refreshHeldItem();
});
function renderFurnaceGUI() {
  if (!activeFurnaceKey) return;
  const c = worldContainers[activeFurnaceKey];
  if (!c) return;
  const pos = document.getElementById('furnace-pos');
  if (pos) pos.textContent = `@ ${activeFurnaceKey}`;
  for (const which of ['input', 'fuel', 'output']) {
    const el = furnaceGUI.querySelector(`.fitem[data-which="${which}"]`);
    if (!el) continue;
    const s = c[which];
    if (s && s.count > 0) {
      el.textContent = `${itemName(s.id)}×${s.count}`;
      el.style.color = '#fff';
      el.style.background = `#${(furnaceSlotColor(s.id) || 0x999999).toString(16).padStart(6, '0')}55`;
    } else { el.textContent = '—'; el.style.background = 'transparent'; el.style.color = '#777'; }
  }
  const r = c.input && SMELTING_RECIPES[c.input.id] ? SMELTING_RECIPES[c.input.id] : null;
  const frac = r ? Math.min(1, (c.progress || 0) / r.time) : 0;
  const pbar = document.getElementById('furnace-progress');
  if (pbar) pbar.style.width = `${Math.round(frac * 100)}%`;
  const st = document.getElementById('furnace-status');
  if (st) st.textContent = c.burning ? 'burning' : 'idle';
  const hb = document.getElementById('furnace-hotbar');
  if (hb) {
    hb.innerHTML = '';
    for (let i = 0; i < inventory.stacks.length; i += 1) {
      const s = inventory.stacks[i];
      const b = document.createElement('button');
      b.className = 'fhslot'; b.dataset.i = String(i);
      b.style.cssText = 'width:42px;height:42px;border:1px solid #666;border-radius:4px;background:#222;color:#fff;font-size:10px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.15;padding:2px';
      b.title = `move to furnace (fuel items -> fuel, else -> input)`;
      b.innerHTML = s.count > 0 ? `${itemName(s.id).slice(0, 10)}<span style="opacity:.8">×${s.count}</span>` : String(i + 1);
      hb.appendChild(b);
    }
  }
}

function saveGame() {
  return saveToStorage(storage, buildSnapshot());
}

// Boot-time restore: resume after tab close, without silently overwriting a
// valid save on corrupt/missing data (crit 18).
function restoreGame() {
  const loaded = loadStoredSave(storage);
  if (!loaded.ok) {
    if (loaded.kind === 'corrupt' || loaded.kind === 'invalid') {
      // Clear error + safe fallback to a fresh world; leave the blob on disk
      // so a future repair never destroys the player's data.
      console.error(`[save] ${loaded.reason} — starting a fresh world (existing save preserved)`);
      hudState.textContent = `SAVE ERROR: ${loaded.reason} — started fresh; do NOT overwrite your save.`;
    }
    return;
  }
  const s = restoreSnapshot(loaded);
  if (!s) return;
  // Rebuild the shared world from the saved seed + edit overlay.
  world.seed = s.seed;
  world.edits = s.worldEdits;
  // Restore player position + orientation + velocity.
  player.pos.x = s.player.pos.x; player.pos.y = s.player.pos.y; player.pos.z = s.player.pos.z;
  player.yaw = s.player.yaw; player.pitch = s.player.pitch;
  player.vel.x = s.player.vel.x; player.vel.y = s.player.vel.y; player.vel.z = s.player.vel.z;
  // Inventory stacks + selected slot + equipped armor.
  if (Array.isArray(s.inventory.stacks)) {
    for (let i = 0; i < inventory.stacks.length && i < s.inventory.stacks.length; i++) {
      inventory.stacks[i].id = s.inventory.stacks[i].id;
      inventory.stacks[i].count = s.inventory.stacks[i].count;
    }
    inventory.selected = s.inventory.selected;
  }
  equipped = s.equipped || [];
  // Survival + time + difficulty + spawn.
  Object.assign(living, s.living);
  worldTime = s.worldTime || 0;
  difficulty = s.difficulty || 'normal';
  deaths = s.deaths || 0;
  spawnPoint = s.spawnPoint || spawnPoint;
  // Drops + mobs entities.
  drops.length = 0;
  for (const d of s.drops) drops.push(d);
  mobs.length = 0;
  for (const m of s.mobs) mobs.push(m);
  // Chest/furnace container contents must survive a reload too (crit 18):
  // replace the live worldContainers from the saved state before gameplay resumes.
  applyContainers(worldContainers, s.containers);
  refreshHeldItem();
}
restoreGame();

// Autosave every few seconds and on tab close / hide, so progress survives a
// tab close (crit 18: resume after tab close).
let autosaveAccum = 0;
window.addEventListener('beforeunload', () => saveGame());
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

// ---------- main loop ----------
let elapsed = 0;

// ---------- B8 performance sampler (crit 19) ----------
// Lightweight headless-safe per-frame sampler. Only active when the URL has
// `?perf=1` (or the build is run from the perf harness), so normal play is
// untouched. Records per-frame deltas and a periodic JS heap-probe, keeps
// about 1s of trailing frames for an instant FPS, and exposes accumulated
// stats on `window.__test12Perf` for the perf harness to read out.
function createPerfSampler() {
  const data = { starts: [], frames: [], memory: [], on: false };
  const sampler = {
    data,
    start() { data.on = true; },
    record(now, dt, renderer) {
      if (!data.on) return;
      data.starts.push(now);
      data.frames.push(dt * 1000); // store frame time in milliseconds
      if (data.frames.length > 6000) { data.frames.shift(); data.starts.shift(); }
      if (data.memory.length < 4000 && now - (data._lastMem || 0) > 250) {
        data._lastMem = now;
        let heap = null;
        try { heap = performance.memory && performance.memory.usedJSHeapSize; } catch (e) { /* safari */ }
        data.memory.push({ t: now, heap, tris: renderer ? renderer.info.render.triangles : null });
      }
    },
    stats() {
      if (data.frames.length < 2) return null;
      const sorted = [...data.frames].sort((a, b) => a - b);
      const n = sorted.length;
      const avg = sorted.reduce((s, x) => s + x, 0) / n;
      const p95 = sorted[Math.floor(n * 0.95)];
      return { n, avgMs: avg, fps: 1000 / avg, p95Ms: p95, minFps: 1000 / Math.max(...sorted), maxMs: sorted[n - 1] };
    },
    drain() { const d = data; data.frames = []; data.starts = []; data.memory = []; return d; },
    reset() { data.frames = []; data.starts = []; data.memory = []; data._lastMem = 0; },
  };
  window.__test12Perf = sampler;
  return sampler;
}
const perfSampler = /[?&]perf=1/.test(location.search) ? createPerfSampler() : null;
if (perfSampler) perfSampler.start();

// perf harness hook: force the world to carry a target live-mob population so
// the 30-active-entity scenario is reproducible (crit 19).
if (perfSampler) {
  window.__test12ForceMobs = (n = 30) => {
    const want = Math.min(MAX_MOBS, n || 30);
    let guard = 0;
    while (mobs.filter((m) => m.alive).length < want && guard++ < 400) trySpawnMob();
    // keep only `want` alive mobs (drop extras) for a stable population
    while (mobs.filter((m) => m.alive).length > want) {
      const m = mobs.find((x) => x.alive);
      if (m) m.alive = false;
    }
    return mobs.filter((m) => m.alive).length;
  };
}
let lastUpdate = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastUpdate) / 1000);
  lastUpdate = now;

  // perf sampling (crit 19): record frame deltas + a lightweight memory probe.
  if (perfSampler) perfSampler.record(now, dt, renderer);

  // Physics (A3) — WorldState collider includes player edits.
  loop(dt);
  syncCamera(camera, player);

  // --- B2 survival: world time + metabolism ---
  worldTime += dt * WORLD.tickRateHz;
  const metaEvents = tickMetabolism(living, dt, { difficulty, underwater: player.inWater });
  for (const ev of metaEvents) applyDamage(living, ev.amount, { type: ev.type, difficulty });
  applyDamage(living, trackFall(living, dt, { airborne: !player.onGround, fallingSpeed: player.vel.y }), { type: 'environment' });

  // Death / respawn after a short delay.
  if (!living.alive && respawnTimer <= 0) {
    if (!didDropDeath) dropInventoryOnDeath();
    respawnTimer = 3.0;
  }
  if (!living.alive && respawnTimer > 0) {
    respawnTimer -= dt;
    if (respawnTimer <= 0) respawn();
  }
  if (sleepMsgTimer > 0) sleepMsgTimer -= dt;
  // B5: oxygen meter + drowning, scaled by difficulty (crit 14).
  const underWater = headInWater(world, player.pos, P.eyeHeight);
  const { drowning } = stepAir(airState, underWater, dt);
  const drowningScale = DIFFICULTY[currentDifficulty] ? DIFFICULTY[currentDifficulty].damageScale : 1;
  const scaledDrowning = drowningDamage(drowning, drowningScale);
  if (scaledDrowning > 0) playerHealth = Math.max(0, playerHealth - scaledDrowning);

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

  // B6 aquatic mobs (crit 16): spawn near ocean, step swim/puff, hurt player.
  spawnNearbyMobs();
  for (const mob of aquaticMobs) {
    stepMobAquatic(mob, world, dt, player.pos);
    const contact = pufferContactDamage(mob, player.pos, 1.2);
    if (contact > 0) playerHealth = Math.max(0, playerHealth - contact);
  }

  // B6 trident projectile flight (crit 17).
  tickCooldown(playerTrident, dt);
  stepTridentProjectiles(dt);

  // Use / interact (RMB): eat food, farm, throw trident, capture/release fish, else place.
  if (useRequest && !lmb && input.isLocked()) {
    useRequest = false;
    const sel = inventory.selectedStack();
    if (foodValue(sel.id) > 0 && living.hunger < living.maxHunger) {
      if (eatSelected(living, inventory)) refreshHeldItem();
    } else if (target) {
      if (target.id === FURNACE_ID) {
        openFurnaceGUI(`${target.x},${target.y},${target.z}`);
      } else if (sel.id === TRIDENT_ID && sel.count > 0) {
        if (playerTrident.cooldownLeft <= 0) {
          const dir = cameraDirection(player.yaw, player.pitch);
          const eye = { x: player.pos.x, y: player.pos.y + P.eyeHeight, z: player.pos.z };
          const proj = throwTrident(playerTrident, eye, dir, { raining: false, thundering: false });
          if (proj) tridentProjects.push(proj);
          playerTrident.cooldownLeft = TRIDENT.cooldown;
          consumeDurability(playerTrident);
        }
      } else if (sel.id === EMPTY_BUCKET && sel.count > 0) {
        const eye = { x: player.pos.x, y: player.pos.y + P.eyeHeight, z: player.pos.z };
        let nearest = null, best = 9;
        for (const mob of aquaticMobs) {
          if (!mob.alive) continue;
          const d = Math.hypot(mob.x - eye.x, mob.y - eye.y, mob.z - eye.z);
          if (d < best) { best = d; nearest = mob; }
        }
        if (nearest) {
          const bucketItem = captureWithBucket(nearest);
          if (bucketItem != null) {
            inventory.takeSelected(1);
            inventory.add(bucketItem, 1);
            refreshHeldItem();
          }
        }
      } else if (FISH_BUCKET && Object.values(FISH_BUCKET).includes(sel.id) && sel.count > 0) {
        const px = target.nx, py = target.ny, pz = target.nz;
        if (world.isLiquid(px, py, pz) || true) {
          const mob = releaseFromBucket(sel.id, px + 0.5, py + 0.5, pz + 0.5, Math.random);
          if (mob) {
            aquaticMobs.push(mob);
            inventory.takeSelected(1);
            inventory.add(EMPTY_BUCKET, 1);
            refreshHeldItem();
          }
        }
      } else if (!useSelected(target)) {
        placeAt(target);
      }
    }
  }
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
  renderMobs();
  renderAquaticMobs();

  // --- B3 mobs: step AI, creeper explosions, melee attacks ---
  if (meleeCooldown > 0) meleeCooldown -= dt;
  if (hitFeedbackTimer > 0) hitFeedbackTimer -= dt;
  mobTimer += dt;
  if (mobTimer > 60) { mobTimer = 0; trySpawnMob(); }

  // LMB is mining when targeting a block, melee when targeting a mob.
  const mobTarget = aimedMob();
  const selId = inventory.selectedStack().id;
  const holdingBow = selId === 103;
  if (lmb && input.isLocked()) {
    if (holdingBow) { fireBow(); }       // bow fires in aim direction
    else if (!target && mobTarget) { meleeSwing(mobTarget); }
  }

  for (const m of [...mobs]) {
    if (!m.alive) continue;
    player.alive = living.alive; // expose survival alive to mob AI
    const ev = stepMob(m, world, player, dt * WORLD.tickRateHz, difficulty);
    for (const e of ev) {
      if (e.attack && e.attack.target === 'player' && living.alive) {
        // armor reduces incoming damage
        const reduction = armorReduction(equipped);
        applyDamage(living, e.attack.damage * (1 - reduction), { type: 'hostile', difficulty });
      }
      if (e.explode) {
        // creeper explosion modifies the world + damages nearby player & mobs
        const dropped = explode(world, e.explode.x, e.explode.y, e.explode.z, e.explode.radius);
        markEdited(Math.floor(e.explode.x), Math.floor(e.explode.y), Math.floor(e.explode.z));
        for (const id of dropped) drops.push(createDrop(e.explode.x, e.explode.y, e.explode.z, id));
        const pDist = Math.hypot(player.pos.x - e.explode.x, player.pos.z - e.explode.z);
        if (pDist < e.explode.radius + 1.5 && living.alive) {
          const dmg = (e.explode.radius + 1.5 - pDist) * 4;
          applyDamage(living, Math.max(1, dmg), { type: 'hostile', difficulty });
        }
      }
    }
    // knockback impulse integration
    if (Math.abs(m.vx) > 0.001 || Math.abs(m.vz) > 0.001) {
      m.x += m.vx * dt;
      m.z += m.vz * dt;
      m.vx *= 0.9; m.vz *= 0.9;
    }
    if (!m.alive) killMob(m);
  }
  // prune dead/despawned mobs
  for (let i = mobs.length - 1; i >= 0; i--) if (!mobs[i].alive) mobs.splice(i, 1);
  renderMobs();
  stepArrows(dt);

  // --- day/night lighting (B2): sun + ambient follow the solar clock ---
  const day = daylight(worldTime);
  const night = isNight(worldTime);
  sun.intensity = 0.12 + day * 0.95;
  light.intensity = 0.28 + day * 0.62;
  const ang = (worldTime / WORLD.dayLengthTicks) * Math.PI * 2;
  sun.position.set(Math.cos(ang) * 40, Math.sin(ang) * 50 + 12, 20);
  const skyDay = new THREE.Color(0x87b5d9);
  const skyNight = new THREE.Color(0x070b1a);
  const skyDawn = new THREE.Color(0xc98a5a);
  let sky;
  if (day < 0.15) sky = skyNight.clone().lerp(skyDay, day / 0.15);
  else if (day < 0.55) sky = skyDawn.clone().lerp(skyDay, (day - 0.15) / 0.4);
  else sky = skyDay.clone().lerp(skyNight, (day - 0.55) / 0.45);
  // R-02: sky gradient driven by the day/night sky colour; a flat backdrop
  // would read as one dominating colour band around the horizon.
  setSkyGradient(sky);
  scene.fog.color.copy(sky);

  // B4: advance all crops by this frame's sim-time under current daylight.
  tickCrops(crops, world, dt, day);
  // B5: underwater visibility — shorter, blue-tinted fog when diving.
  const vis = underwaterVisibility(320, underWater);
  scene.fog = new THREE.FogExp2(new THREE.Color(vis.tint[0], vis.tint[1], vis.tint[2]), vis.factor > 0.4 ? 0.008 : 0.05);
  if (underWater) scene.background = new THREE.Color(vis.tint[0], vis.tint[1], vis.tint[2]);
  else scene.background = SKY_GRAD.tex;

  // R-08: run every furnace on world ticks (the focused one is kept live; any
  // burning one keeps smelting even with the GUI closed / across reloads).
  const fTicks = Math.max(1, Math.round(dt * WORLD.tickRateHz));
  for (const key of Object.keys(worldContainers)) {
    const c = worldContainers[key];
    if (c && (c.burning || key === activeFurnaceKey)) {
      tickFurnace(c, fTicks);
    }
  }
  if (activeFurnaceKey) renderFurnaceGUI();

  // B7: periodic autosave (every ~5s) — tab-close persistence.
  autosaveAccum += dt;
  if (autosaveAccum >= 5) { autosaveAccum = 0; saveGame(); }

  renderer.render(scene, camera);
  drawHUD();

  elapsed += dt;
  if (elapsed >= 1) {
    hudState.textContent =
      `seed=${seed} · ${chunkMeshes.size} chunks · ${renderer.info.render.triangles} tris · ` +
      `HP ${Math.ceil(living.health)}/${living.maxHealth} · hunger ${Math.floor(living.hunger)} · ` +
      `${timeLabel(worldTime)} (${isNight(worldTime) ? 'night' : phase(worldTime)})`;
    elapsed = 0;
  }
}
animate();

// toggle recipe book with B
window.addEventListener('keydown', (e) => { if (e.code === 'KeyB') recipePanel.hidden = !recipePanel.hidden; });

// B6: cycle trident enchants with T (demo all four: Loyalty/Riptide/Channeling/Impaling).
const ENCHANT_CYCLE = ['loyalty', 'riptide', 'channeling', 'impaling'];
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyT') return;
  const next = (ENCHANT_CYCLE.indexOf(tridentEnchantDemo) + 1) % ENCHANT_CYCLE.length;
  tridentEnchantDemo = ENCHANT_CYCLE[next];
  const ench = { loyalty: 0, riptide: 0, channeling: 0, impaling: 0 };
  if (tridentEnchantDemo === 'loyalty') ench.loyalty = 3;
  else if (tridentEnchantDemo === 'riptide') ench.riptide = 1;
  else if (tridentEnchantDemo === 'channeling') ench.channeling = 1;
  else if (tridentEnchantDemo === 'impaling') ench.impaling = 3;
  playerTrident = createTrident(ench);
});

hudState.textContent =
  `seed=${seed} · generating world… · click to capture mouse · LMB mine · RMB place/eat · 1-9/wheel select · E inventory · B recipes · F sleep`;
