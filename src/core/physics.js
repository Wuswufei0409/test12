// Player physics: AABB collision, gravity, jump/sprint/sneak/swim, step-up,
// and landing. This is a PURE module (no DOM/Three) so it is unit-testable.
// Adopts CONTRACT.md coordinate conventions (1 block = 1 unit, +Y up).
// SEE CONTRACT.md §PlayerPhysics / §TickModel.
import { getBlockById } from './blocks.js';

export const PLAYER = {
  width: 0.6, // full width of the AABB (half = 0.3)
  height: 1.8, // standing standing height
  sneakHeight: 1.5, // height while sneaking
  eyeHeight: 1.62, // camera offset from feet
  maxStep: 0.5, // max step-up height over stairs/slabs (blocks)
  gravity: 0.08, // blocks/tick^2 @ 20Hz (tuned origin)
  jumpSpeed: 0.42, // initial jump velocity (up)
  walkSpeed: 0.098, // blocks/tick @ 20Hz (~2 m/s)
  sprintFactor: 1.3,
  sneakFactor: 0.3,
  swimFactor: 0.6,
  swimBuoyancy: 0.4, // fraction of gravity applied while swimming
  terminalFall: 0.4, // max downward velocity
};

export function isSolidBlock(id) {
  const b = getBlockById(id);
  return !!b && b.solid === true;
}

export function isLiquidBlock(id) {
  const b = getBlockById(id);
  return !!b && b.liquid === true;
}

// World adapter contract: object exposing isSolid(x,y,z) and isLiquid(x,y,z).
// AABB test: does any solid block overlap the player box?
function overlapsSolid(world, x, z, feetY, height, hx) {
  const x0 = Math.floor(x - hx);
  const x1 = Math.floor(x + hx);
  const z0 = Math.floor(z - hx);
  const z1 = Math.floor(z + hx);
  const y0 = Math.floor(feetY);
  const y1 = Math.floor(feetY + height - 1e-9);
  for (let bx = x0; bx <= x1; bx += 1) {
    for (let by = y0; by <= y1; by += 1) {
      for (let bz = z0; bz <= z1; bz += 1) {
        if (world.isSolid(bx, by, bz)) return true;
      }
    }
  }
  return false;
}

function inWaterAt(world, x, z, feetY, height, hx) {
  const y0 = Math.floor(feetY + 0.1);
  const y1 = Math.floor(feetY + height - 0.2);
  for (let by = y0; by <= y1; by += 1) {
    if (world.isLiquid(Math.floor(x), by, Math.floor(z))) return true;
  }
  return false;
}

function moveX(state, dx, world) {
  const hx = PLAYER.width / 2;
  const start = state.pos.x;
  state.pos.x += dx;
  if (overlapsSolid(world, state.pos.x, state.pos.z, state.pos.y, state.height, hx)) {
    if (dx > 0) state.pos.x = Math.floor(state.pos.x + hx) - hx - 1e-4;
    else state.pos.x = Math.ceil(state.pos.x - hx) + hx + 1e-4;
    return false;
  }
  return true;
}

function moveZ(state, dz, world) {
  const hx = PLAYER.width / 2;
  state.pos.z += dz;
  if (overlapsSolid(world, state.pos.x, state.pos.z, state.pos.y, state.height, hx)) {
    if (dz > 0) state.pos.z = Math.floor(state.pos.z + hx) - hx - 1e-4;
    else state.pos.z = Math.ceil(state.pos.z - hx) + hx + 1e-4;
    return false;
  }
  return true;
}

function moveY(state, dy, world) {
  const hx = PLAYER.width / 2;
  const startY = state.pos.y;
  state.pos.y += dy;
  const hit = overlapsSolid(world, state.pos.x, state.pos.z, state.pos.y, state.height, hx);
  if (hit) {
    if (dy > 0) state.pos.y = Math.floor(state.pos.y + state.height - 1e-9) - state.height - 0.0001;
    else state.pos.y = Math.ceil(state.pos.y) + 0.0001;
  }
  return { hit, movingDown: dy < 0 };
}

// Attempt a horizontal move; if blocked, try stepping up over a low obstacle
// (stairs/slabs up to PLAYER.maxStep). Returns { blocked, stepped }.
function moveHorizontal(state, dx, dz, world, onGround) {
  const hx = PLAYER.width / 2;
  const origX = state.pos.x;
  const origZ = state.pos.z;
  const origY = state.pos.y;

  state.pos.x += dx;
  state.pos.z += dz;
  let hit = overlapsSolid(world, state.pos.x, state.pos.z, state.pos.y, state.height, hx);
  if (!hit) return { blocked: false, stepped: false };

  // Step-up: retry the horizontal move from a raised origin (on ground only).
  if (onGround) {
    for (let s = PLAYER.maxStep; s > 0.001; s -= 0.125) {
      state.pos.y = origY + s;
      state.pos.x = origX + dx;
      state.pos.z = origZ + dz;
      if (!overlapsSolid(world, state.pos.x, state.pos.z, state.pos.y, state.height, hx)) {
        return { blocked: false, stepped: true, stepY: s };
      }
    }
  }

  // Revert horizontal move.
  state.pos.x = origX;
  state.pos.z = origZ;
  state.pos.y = origY;
  return { blocked: true, stepped: false };
}

export function createPlayer(x = 0, y = 4, z = 0, yaw = 0) {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    height: PLAYER.height,
    onGround: false,
    inWater: false,
    sneak: false,
    landed: false,
  };
}

// Advance simulation by one tick (dt=1 tick @ 20Hz). input:
//   { forward, strafe, jump, sprint, sneak }
//   forward: +1 = toward facing, -1 = back. strafe: +1 = right, -1 = left.
// Returns events so tests can assert { landed, blocked, stepped, onGround }.
export function stepPlayer(state, input, world, dt = 1) {
  const hx = PLAYER.width / 2;
  state.sneak = !!input.sneak;
  state.height = state.sneak ? PLAYER.sneakHeight : PLAYER.height;
  state.inWater = inWaterAt(world, state.pos.x, state.pos.z, state.pos.y, state.height, hx);
  state.landed = false;

  // --- speed ---
  let speed = PLAYER.walkSpeed;
  if (input.sprint && !input.sneak) speed *= PLAYER.sprintFactor;
  if (input.sneak) speed *= PLAYER.sneakFactor;
  if (state.inWater) speed *= PLAYER.swimFactor;

  // --- desired horizontal velocity (world space) ---
  const yaw = state.yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  let dx = fx * (input.forward || 0) + rx * (input.strafe || 0);
  let dz = fz * (input.forward || 0) + rz * (input.strafe || 0);
  const len = Math.hypot(dx, dz) || 1;
  dx = (dx / len) * speed * dt;
  dz = (dz / len) * speed * dt;

  // --- vertical ---
  let vy = state.vel.y;
  if (state.inWater) {
    vy -= PLAYER.gravity * PLAYER.swimBuoyancy * dt;
    vy = Math.max(vy, -0.25);
    if (input.jump) vy = Math.max(vy, 0.3);
    if (input.sneak && !input.sprint) vy = Math.min(vy, -0.3);
  } else {
    vy -= PLAYER.gravity * dt;
  }
  if (input.jump && state.onGround && !state.inWater) {
    vy = PLAYER.jumpSpeed;
    state.onGround = false;
  }
  vy = Math.max(vy, -PLAYER.terminalFall);
  state.vel.y = vy;

  // --- integrate axes ---
  const horiz = moveHorizontal(state, dx, dz, world, state.onGround);
  if (horiz.blocked) {
    // blocked: kill horizontal velocity so player cannot jitter through walls
    state.vel.x = 0;
    state.vel.z = 0;
  } else {
    state.vel.x = dx;
    state.vel.z = dz;
  }

  const yRes = moveY(state, state.vel.y * dt, world);
  if (yRes.hit) {
    if (yRes.movingDown) {
      state.onGround = true;
      state.landed = !!state.vel.y; // was falling
      state.vel.y = 0;
    } else {
      state.vel.y = 0;
      state.onGround = false;
    }
  } else if (yRes.movingDown) {
    state.onGround = false;
  }

  return {
    onGround: state.onGround,
    inWater: state.inWater,
    landed: state.landed,
    blocked: horiz.blocked,
    stepped: horiz.stepped,
    pos: { ...state.pos },
    vel: { ...state.vel },
  };
}
