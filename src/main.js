// test12 — voxel sandbox scaffold (Phase A + A3 player control).
// Three.js scene + deterministic arena + player physics loop.
import * as THREE from 'three';
import { WORLD } from './core/world.js';
import { BLOCKS, getBlockById } from './core/blocks.js';
import { WorldGrid } from './core/worldgrid.js';
import { createPlayer } from './core/physics.js';
import { buildArena, createInput, createPlayerLoop, syncCamera } from './player.js';
import { recipeBook } from './core/crafting.js';
import { smeltingRecipes } from './core/smelting.js';
import { RECIPES } from './core/crafting.js';

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

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d9);
scene.fog = new THREE.Fog(0x87b5d9, 40, 160);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const light = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(light);
const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(30, 60, 20);
scene.add(sun);

// --- world ---
const world = buildArena();
const materialCache = new Map();
function materialFor(id) {
  const b = getBlockById(id);
  const color = b.color ?? 0x888888;
  const key = `${id}:${color}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshLambertMaterial({ color, transparent: id === 6, opacity: id === 6 ? 0.6 : 1 }));
  }
  return materialCache.get(key);
}
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
// render solid/liquid blocks of the arena
for (const [key, id] of world.map) {
  const [x, y, z] = key.split(',').map(Number);
  if (id === 0) continue;
  const mesh = new THREE.Mesh(boxGeo, materialFor(id));
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  scene.add(mesh);
}

// --- player ---
const player = createPlayer(0, 6, 0, 0);
const input = createInput(renderer.domElement, camera, player);
const loop = createPlayerLoop(world, player, input);
syncCamera(camera, player);

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  loop(dt);
  syncCamera(camera, player);
  renderer.render(scene, camera);
}
animate();

// toggle recipe book with B
window.addEventListener('keydown', (e) => { if (e.code === 'KeyB') recipePanel.hidden = !recipePanel.hidden; });

hudState.textContent =
  `seed=${WORLD.seed} · click to lock mouse · WASD move · Space jump · Shift sprint · Ctrl sneak · B recipes` +
  ` · pos(${player.pos.x.toFixed(1)}, ${player.pos.y.toFixed(1)}, ${player.pos.z.toFixed(1)})` +
  ` · ${player.inWater ? 'swimming' : player.onGround ? 'grounded' : 'airborne'}`;
