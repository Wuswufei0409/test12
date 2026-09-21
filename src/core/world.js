// Cross-module world constants. These mirror CONTRACT.md and are the single
// source of truth used by runtime code and determinism tests.
// SEE CONTRACT.md.

export const WORLD = {
  seed: 'test12-phase-a', // deterministic default for the scaffold
  chunkSize: 16, // blocks per chunk edge (x/z)
  chunkHeight: 64, // blocks vertical
  viewDistanceChunks: 6, // standard view distance (issue 19 baseline)
  tickRateHz: 20, // ticks per second (1 tick = 50 ms)
  dayLengthTicks: 24000, // one full day/night in ticks (target Bedrock-like)
  spawn: { x: 0, y: 8, z: 0 }, // meters / block units
};

// Time model: game time is tracked in ticks. worldTime = tick % dayLengthTicks.
export const TIME = {
  tickRateHz: WORLD.tickRateHz,
  dayLengthTicks: WORLD.dayLengthTicks,
  sunriseTick: 0,
  sunsetTick: 12000,
};

export const DIFFICULTY = {
  peaceful: { hostileSpawn: false, damageScale: 0 },
  easy: { hostileSpawn: true, damageScale: 0.5 },
  normal: { hostileSpawn: true, damageScale: 1 },
};

export function tickToGameTime(tick) {
  // returns { tickOfDay, hour, minute }
  const tod = ((tick % WORLD.dayLengthTicks) + WORLD.dayLengthTicks) % WORLD.dayLengthTicks;
  const hour = 6 + (tod / WORLD.dayLengthTicks) * 24; // solar day starts ~6am
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return { tickOfDay: tod, hour: h, minute: m };
}
