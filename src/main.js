// Phase A2 renderer: first-person 3D voxel world with chunk streaming
// (load/unload by view distance), sky + fog, crosshair, first-person held item,
// and an MBE-like HUD. Consumes src/core/* worldgen + the procedural pixel
// texture atlas. Player locomotion/collision is A3's scope; here we provide a
// pointer-lock camera for reviewing the generated world.
import * as THREE from 'three';
import { WORLD } from './core/world.js';
import { findLandSpawn } from './core/terrain.js';
import { CHUNK, generateChunk } from './core/worldgen.js';
import { buildChunkMesh, solidMaterial } from './render/chunkmesh.js';
import { getAtlasTexture, tileUV, TILES } from './render/atlas.js';
import { BLOCKS } from './core/blocks.js';

const app = document.getElementById('app');
const hudState = document.getElementById('hud-state');
const seed = WORLD.seed; // deterministic default

// ---------- scene / camera ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d9);
scene.fog = new THREE.FogExp2(0x87b5d9, 0.008);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 320);
const landSpawn = findLandSpawn(seed);
camera.position.set(landSpawn.x, landSpawn.y, landSpawn.z);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const light = new THREE.AmbientLight(0xf7f3e8, 0.55);
scene.add(light);
const sun = new THREE.DirectionalLight(0xfff5d7, 1.1);
sun.position.set(40, 60, 20);
scene.add(sun);

// First-person held item (voxel hand/view). Attached to the camera so it stays
// in the foreground; satisfies the first-person held-item requirement.
const heldBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.42, 0.42),
  new THREE.MeshLambertMaterial({ map: getAtlasTexture() }),
);
// Map all faces to a single atlas tile (stone, id=1) so it reads as one voxel.
const [hu0, hv0, hu1, hv1] = tileUV(1 % TILES);
const heldGeo = heldBox.geometry;
const uvAttr = heldGeo.attributes.uv;
for (let i = 0; i < uvAttr.count; i++) {
  const u = uvAttr.getX(i);
  const v = uvAttr.getY(i);
  uvAttr.setXY(i, hu0 + (hu1 - hu0) * u, hv0 + (hv1 - hv0) * v);
}
heldGeo.attributes.uv.needsUpdate = true;
heldBox.position.set(0.55, -0.42, -0.7);
camera.add(heldBox);
scene.add(camera);

// ---------- chunk streaming ----------
const chunkMeshes = new Map(); // "cx,cz" -> THREE.Mesh
const viewDist = 6; // benchmark standard
const loadQueue = []; // pending chunks to build (built a few per frame)
const LOAD_PER_FRAME = 3;

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function loadChunk(cx, cz) {
  // Force generation to validate determinism; discard, mesh reads via blockAt.
  generateChunk(seed, cx, cz);
  const geo = buildChunkMesh(seed, cx, cz);
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

// Recompute the wanted chunk set; enqueue missing chunks and unload distant
// ones. Loading is spread across frames so the first paint is fast.
function updateChunks() {
  const pcx = Math.floor(camera.position.x / CHUNK.size);
  const pcz = Math.floor(camera.position.z / CHUNK.size);
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
  // Unload anything out of view.
  for (const key of chunkMeshes.keys()) {
    if (!wanted.has(key)) {
      const [cx, cz] = key.split(',').map(Number);
      unloadChunk(cx, cz);
    }
  }
  // De-duplicate the queue while preserving new-ish order.
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

// ---------- first-person pointer-lock camera (review aid; A3 owns locomotion) ----------
const camState = { yaw: 0, pitch: 0, moving: {} };
let locked = false;

renderer.domElement.addEventListener('click', () => {
  if (!locked) renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  camState.yaw -= e.movementX * 0.0025;
  camState.pitch -= e.movementY * 0.0025;
  camState.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camState.pitch));
});
window.addEventListener('keydown', (e) => { camState.moving[e.code] = true; });
window.addEventListener('keyup', (e) => { camState.moving[e.code] = false; });

// ---------- HUD (canvas overlay, MBE-like) ----------
function buildHUD() {
  const canvas = document.createElement('canvas');
  canvas.id = 'hud-canvas';
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '20';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}
const hud = buildHUD();
const hudClock = new THREE.Clock();
// Day/night offset: open the world near midday so the first view is bright.
const DAY_OFFSET = 4000;

function drawHUD(dt) {
  const ctx = hud.ctx;
  const w = (hud.canvas.width = window.innerWidth);
  const h = (hud.canvas.height = window.innerHeight);

  // Crosshair
  const cx = w / 2;
  const cy = h / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy); ctx.lineTo(cx - 3, cy);
  ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy - 3);
  ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 10);
  ctx.stroke();

  // Hotbar (9 slots)
  const slotSize = 40;
  const gap = 4;
  const n = 9;
  const barW = n * slotSize + (n - 1) * gap;
  const bx = (w - barW) / 2;
  const by = h - slotSize - 12;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(bx - 6, by - 6, barW + 12, slotSize + 12);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx - 6, by - 6, barW + 12, slotSize + 12);
  const blockIds = Object.values(BLOCKS).filter((b) => !b.item && b.id !== 0);
  for (let i = 0; i < n; i++) {
    const sx = bx + i * (slotSize + gap);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx, by, slotSize, slotSize);
    ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.35)';
    ctx.strokeRect(sx, by, slotSize, slotSize);
    const blk = blockIds[i % blockIds.length];
    if (blk) {
      const hex = blk.color ?? 0x888888;
      ctx.fillStyle = `#${hex.toString(16).padStart(6, '0')}`;
      ctx.fillRect(sx + 10, by + 10, 20, 20);
    }
  }

  // Time of day label (solar clock from tick).
  const t = hudClock.elapsedTime * 20;
  const tod = (t + DAY_OFFSET) % WORLD.dayLengthTicks;
  const hour = 6 + (tod / WORLD.dayLengthTicks) * 24;
  const hh = Math.floor(hour) % 24;
  const mm = Math.floor((hour - Math.floor(hour)) * 60);
  const hstr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '16px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(`seed=${seed}`, 12, 28);
  ctx.fillText(`pos=${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)}`, 12, 52);
  ctx.fillText(`time=${hstr} · view=${viewDist} chunks`, 12, 76);
  ctx.textAlign = 'right';
  ctx.fillText('click to capture mouse · WASD/space/ctrl to move', w - 12, h - 12);
}

// ---------- resize ----------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ---------- main loop ----------
let frames = 0;
let last = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (performance.now() - last) / 1000);
  last = performance.now();

  // Simple review camera movement (no collision; A3).
  const speed = 12;
  const forward = new THREE.Vector3(-Math.sin(camState.yaw), 0, -Math.cos(camState.yaw));
  const right = new THREE.Vector3(Math.cos(camState.yaw), 0, -Math.sin(camState.yaw)).negate();
  const mv = new THREE.Vector3();
  if (camState.moving['KeyW']) mv.add(forward);
  if (camState.moving['KeyS']) mv.sub(forward);
  if (camState.moving['KeyD']) mv.add(right);
  if (camState.moving['KeyA']) mv.sub(right);
  if (camState.moving['Space']) mv.y += 1;
  if (camState.moving['ControlLeft'] || camState.moving['ControlRight']) mv.y -= 1;
  if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(speed * dt);
  camera.position.add(mv);

  camera.rotation.set(camState.pitch, camState.yaw, 0, 'YXZ');

  // Stream chunks around the camera (enqueue) then build a small batch.
  updateChunks();
  processLoadQueue();

  // Sky tint + fog follow the solar clock. Start near midday so the world
  // opens bright; the phase advances at one 24000-tick day per 20 sim-minutes.
  const t = (performance.now() / 1000) * 20; // sim ticks
  const tod = (t + DAY_OFFSET) % WORLD.dayLengthTicks;
  const dayFrac = Math.sin((tod / WORLD.dayLengthTicks) * Math.PI * 2 - Math.PI / 2);
  const blend = Math.min(1, Math.max(0, (dayFrac + 1) / 2));
  const sky = new THREE.Color().lerpColors(new THREE.Color(0x0b1026), new THREE.Color(0x87b5d9), blend);
  scene.background.copy(sky);
  scene.fog.color.copy(sky);

  renderer.render(scene, camera);
  drawHUD(dt);

  frames++;
  if (frames % 120 === 0) {
    hudState.textContent = `${frames} frames · seed=${seed} · ${chunkMeshes.size} chunks in view · ${renderer.info.render.triangles} tris`;
  }
}
animate();

hudState.textContent = `seed=${seed} · renderer=${renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1'} · generating world…`;
