// Phase A scaffold: renders a simple three.js voxel-ish ground with a cube.
// This is intentionally minimal; richer world/chunk rendering lands in later issues.
import * as THREE from 'three';
import { seededRandom } from './core/rng.js';
import { WORLD } from './core/world.js';

const app = document.getElementById('app');
const hudState = document.getElementById('hud-state');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d9);
scene.fog = new THREE.Fog(0x87b5d9, 24, 80);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(WORLD.spawn.x, WORLD.spawn.y, WORLD.spawn.z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);

const light = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(light);
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(20, 40, 10);
scene.add(sun);

// Simple world: a flat ground of voxels derived from the seeded RNG so the
// fixed-seed smoke test can assert deterministic terrain.
const rng = seededRandom(WORLD.seed);
const groundGeo = new THREE.BoxGeometry(1, 1, 1);
const grassMat = new THREE.MeshLambertMaterial({ color: 0x6abe30 });
const dirtMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
const stoneMat = new THREE.MeshLambertMaterial({ color: 0x888888 });

for (let x = -16; x <= 16; x++) {
  for (let z = -16; z <= 16; z++) {
    const h = Math.floor(rng() * 3); // 0..2 height variation
    for (let y = 0; y <= h; y++) {
      const mat = y === h ? grassMat : y === 0 ? stoneMat : dirtMat;
      const box = new THREE.Mesh(groundGeo, mat);
      box.position.set(x, y - 0.5, z);
      scene.add(box);
    }
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  camera.position.y = WORLD.spawn.y + Math.sin(t * 0.5) * 0.4;
  camera.lookAt(0, 1, 0);
  renderer.render(scene, camera);
}
animate();

hudState.textContent = `seed=${WORLD.seed} · renderer=${renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1'}`;
