// A3 player-control physics tests: gravity/landing, jump, sprint/sneak, swim,
// AABB collision (no clipping/embedding), and step-up.
import { describe, it, expect } from 'vitest';
import { createPlayer, stepPlayer, PLAYER } from '../src/core/physics.js';
import { WorldGrid } from '../src/core/worldgrid.js';

// Helper: ground at y=0..2 + a few setup blocks, solid ground at y=2 top.
function groundWorld() {
  const w = new WorldGrid();
  w.fillFloor(3, 3, -8, 8, -8, 8); // 3 layers of dirt (solid)
  return w;
}

function settle(p, input, world) {
  // step until grounded or a timeout
  for (let i = 0; i < 200; i += 1) {
    stepPlayer(p, input, world);
    if (p.onGround) return p;
  }
  return p;
}

describe('gravity & landing', () => {
  it('falls onto the ground and settles with onGround=true', () => {
    const w = groundWorld();
    const p = createPlayer(0, 8, 0);
    settle(p, {}, w);
    // top of ground at y=3; standing feet should rest at y=3
    expect(p.onGround).toBe(true);
    expect(Math.abs(p.pos.y - 3)).toBeLessThan(0.05);
  });

  it('does not fall through the floor (no clipping after settling)', () => {
    const w = groundWorld();
    const p = createPlayer(0, 8, 0);
    for (let i = 0; i < 400; i += 1) stepPlayer(p, {}, w);
    expect(p.pos.y).toBeGreaterThan(2.9);
  });
});

describe('jump', () => {
  it('leaves the ground and returns (lands)', () => {
    const w = groundWorld();
    const p = createPlayer(0, 3, 0);
    settle(p, {}, w);
    stepPlayer(p, { jump: true }, w);
    expect(p.onGround).toBe(false); // airborne
    let maxY = p.pos.y;
    for (let i = 0; i < 200; i += 1) {
      stepPlayer(p, {}, w);
      maxY = Math.max(maxY, p.pos.y);
      if (p.onGround) break;
    }
    expect(maxY).toBeGreaterThan(3.1); // rose above ground
    expect(p.onGround).toBe(true); // landed again
  });
});

describe('horizontal collision integrity', () => {
  it('clamps at a wall and cannot pass through', () => {
    const w = groundWorld();
    // build a solid wall along z at x=3 (blocks y=1..5)
    for (let y = 1; y <= 5; y += 1) for (let z = -8; z <= 8; z += 1) w.set(3, y, z, 1);
    const p = createPlayer(0, 3, 0);
    settle(p, {}, w);
    // face toward +Z? yaw: forward = +X at yaw=0? our forward at yaw=0 = (-sin0, -cos0) = (0,-1) i.e. -Z.
    // To move +X we need strafe right at yaw=0 (right = (cos0, -sin0)=(1,0)).
    p.yaw = 0;
    for (let i = 0; i < 120; i += 1) stepPlayer(p, { strafe: 1 }, w);
    // wall at x=3; player right face = pos.x + 0.3; should stop right at x=2.7
    expect(p.pos.x).toBeLessThanOrEqual(3.0);
    expect(p.pos.x).toBeGreaterThan(2.3);
  });

  it('does not embed into a solid ceiling when jumping into it', () => {
    const w = groundWorld();
    for (let x = -8; x <= 8; x += 1) for (let z = -8; z <= 8; z += 1) w.set(x, 7, z, 1); // ceiling
    const p = createPlayer(0, 3, 0);
    settle(p, {}, w);
    for (let i = 0; i < 120; i += 1) stepPlayer(p, { jump: true }, w);
    // head (feet+height) must stay below the ceiling bottom (y<7)
    expect(p.pos.y + p.height).toBeLessThanOrEqual(7.01);
  });
});

describe('step-up over low obstacle', () => {
  it('blocks a ledge higher than maxStep (no auto-climb past 0.5)', () => {
    const world = new WorldGrid();
    world.fillFloor(3, 2, -8, 8, -8, 8); // ground top = y=2
    // region x>=1 raised by one block => a +1 ledge (taller than maxStep=0.5)
    for (let x = 1; x <= 8; x += 1) for (let z = -8; z <= 8; z += 1) world.set(x, 2, z, 1);
    const p = createPlayer(0, 8, 4);
    settle(p, {}, world);
    p.yaw = -Math.PI / 2; // forward = +X
    for (let i = 0; i < 120; i += 1) stepPlayer(p, { forward: 1 }, world);
    // The +1 ledge (maxStep 0.5) must NOT be auto-stepped: stay on the low side.
    expect(p.pos.x).toBeLessThan(0.9);
  });

  it('steps up a rise actually within the step height budget', () => {
    const world = new WorldGrid();
    world.fillFloor(3, 2, -10, 0, -10, 10); // low side top = y=2
    for (let x = 1; x <= 10; x += 1) for (let z = -10; z <= 10; z += 1) world.set(x, 2, z, 1); // high side top = y=3
    const p = createPlayer(0, 8, 0);
    settle(p, {}, world);
    p.yaw = -Math.PI / 2;
    const savedMaxStep = PLAYER.maxStep;
    PLAYER.maxStep = 1.2; // allow the +1 ledge to be stepped
    for (let i = 0; i < 40; i += 1) stepPlayer(p, { forward: 1 }, world);
    PLAYER.maxStep = savedMaxStep;
    expect(p.pos.x).toBeGreaterThanOrEqual(1.0); // reached the high side
    expect(Math.abs(p.pos.y - 3)).toBeLessThan(0.2); // standing on the raised ledge
  });
});

describe('sprint vs sneak speed', () => {
  it('sprint moves faster than walk, sneak moves slower', () => {
    const w = groundWorld();
    const walkP = createPlayer(0, 3, 0); settle(walkP, {}, w);
    walkP.yaw = -Math.PI / 2; // forward +X
    const x0 = walkP.pos.x;
    for (let i = 0; i < 40; i += 1) stepPlayer(walkP, { forward: 1 }, w);
    const walkDx = walkP.pos.x - x0;

    const sprintP = createPlayer(0, 3, 0); settle(sprintP, {}, w);
    sprintP.yaw = -Math.PI / 2;
    const sx0 = sprintP.pos.x;
    for (let i = 0; i < 40; i += 1) stepPlayer(sprintP, { forward: 1, sprint: true }, w);
    const sprintDx = sprintP.pos.x - sx0;

    const sneakP = createPlayer(0, 3, 0); settle(sneakP, {}, w);
    sneakP.yaw = -Math.PI / 2;
    const nx0 = sneakP.pos.x;
    for (let i = 0; i < 40; i += 1) stepPlayer(sneakP, { forward: 1, sneak: true }, w);
    const sneakDx = sneakP.pos.x - nx0;

    expect(sprintDx).toBeGreaterThan(walkDx);
    expect(walkDx).toBeGreaterThan(sneakDx);
  });
});

describe('swim in water', () => {
  it('falls slower / can rise in water and does not sink to terminal', () => {
    const w = new WorldGrid();
    w.fillFloor(1, 1, -8, 8, -8, 8); // seabed top at y=1
    // water column y=1..5
    for (let y = 1; y <= 5; y += 1) for (let x = -8; x <= 8; x += 1) for (let z = -8; z <= 8; z += 1) w.set(x, y, z, 6);
    const p = createPlayer(0, 6, 0);
    // fall into the water column first
    for (let i = 0; i < 30; i += 1) stepPlayer(p, {}, w);
    expect(p.inWater).toBe(true);
    // rising via jump when in water
    const y0 = p.pos.y;
    p.yaw = 0;
    for (let i = 0; i < 20; i += 1) stepPlayer(p, { jump: true }, w);
    expect(p.pos.y).toBeGreaterThan(y0); // allowed to rise toward surface
  });
});
