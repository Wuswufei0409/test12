// Browser-side wiring: build a small test arena, capture input, run the
// physics tick loop, and position the camera from the player state.
// Gameplay logic stays in src/core/physics.js (pure + tested).
import { createPlayer, stepPlayer, PLAYER } from './core/physics.js';
import { WorldGrid } from './core/worldgrid.js';

const TICK = 1 / 20; // 20 Hz simulation, matching CONTRACT.md tick model

// A small arena demonstrating ground, a wall (collision), a step and water.
// Uses WorldGrid so the same AABB collision code is exercised as in tests.
export function buildArena(world = new WorldGrid()) {
  world.fillFloor(2, 3, -30, 30, -30, 30); // dirt ground, top at y=3
  // stone wall along z at x=7 (block collision demo)
  for (let y = 3; y <= 6; y += 1) for (let z = -3; z <= 3; z += 1) world.set(7, y, z, 1);
  // low raised ledge at x=4..5 (step-up demo)
  for (let z = -3; z <= 3; z += 1) world.set(4, 3, z, 1);
  for (let z = -3; z <= 3; z += 1) world.set(5, 3, z, 1);
  // water pool (swim demo)
  for (let x = -8; x <= -5; x += 1) for (let z = -3; z <= 3; z += 1) world.set(x, 3, z, 6);
  // platform for spawn
  return world;
}

export function createInput(canvas, camera, player) {
  const keys = {};
  let locked = false;
  const guard = (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  };
  window.addEventListener('keydown', (e) => { keys[e.code] = true; guard(e); });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  canvas.addEventListener('click', () => { if (!locked) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    player.yaw -= e.movementX * 0.0022;
    player.pitch -= e.movementY * 0.0022;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
  });

  return {
    isLocked: () => locked,
    read() {
      return {
        forward: (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0),
        strafe: (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0),
        jump: !!keys['Space'],
        sprint: !!keys['ShiftLeft'] || !!keys['ShiftRight'],
        sneak: !!keys['ControlLeft'] || !!keys['ControlRight'],
      };
    },
  };
}

// Returns a fixed-timestep updater: call render(dtSeconds) each animation frame.
export function createPlayerLoop(world, player, input) {
  let accumulator = 0;
  return function update(dtSeconds) {
    accumulator += dtSeconds;
    const maxSteps = 8;
    let steps = 0;
    while (accumulator >= TICK && steps < maxSteps) {
      stepPlayer(player, input.read(), world);
      accumulator -= TICK;
      steps += 1;
    }
    if (steps === maxSteps) accumulator = 0;
  };
}

export function syncCamera(camera, player) {
  camera.position.set(player.pos.x, player.pos.y + PLAYER.eyeHeight, player.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
}
