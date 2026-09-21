// Day / night cycle math (pure, headless-testable). Mirrors CONTRACT.md §TickModel.
//
// One full day = 24000 ticks. tickOfDay=0 ≈ 6:00 AM, noon ≈ 6000,
// sunset ≈ 12000, midnight ≈ 18000. `daylight` is a smooth 0..1 ambient
// brightness driven by the sun's elevation over the course of the day.
import { WORLD } from './world.js';

const DAY = WORLD.dayLengthTicks;
const DAY_START = 0; // 6:00
const NOON = 6000;
const SUNSET = 12000;
const MIDNIGHT = 18000;

/** tickOfDay (0..DAY-1) for any possibly-negative tick. */
export function tickOfDay(tick) {
  return ((tick % DAY) + DAY) % DAY;
}

/**
 * Smooth daylight factor 0..1: 1 at clear noon, 0 at deepest night,
 * rising/falling across dusk and dawn. drivable for lights + sky.
 */
export function daylight(tick) {
  const t = tickOfDay(tick);
  // angle runs 0 at 6am, pi/2 at noon, pi at midnight.
  const angle = (t / DAY) * Math.PI * 2;
  const elevation = Math.sin(angle); // +1 noon, -1 midnight
  return Math.min(1, Math.max(0, (elevation + 0.55) / 1.55));
}

/** True during the night span (sunset..dawn). */
export function isNight(tick) {
  const t = tickOfDay(tick);
  return t >= SUNSET && t < DAY - 1000; // [12000, 23000): sunset to just before 6am
}

/** Current phase label: 'dawn'|'day'|'dusk'|'night'. */
export function phase(tick) {
  const t = tickOfDay(tick);
  if (t < 2000) return 'dawn'; // 6:00–7:40
  if (t < 11000) return 'day';
  if (t < 13000) return 'dusk';
  if (t < 23000) return 'night';
  return 'dawn';
}

/** "Day N · 14:30" style label from the running tick counter. */
export function timeLabel(tick) {
  const t = tickOfDay(tick);
  const day = Math.floor(tick / DAY) + 1;
  const hour = (6 + (t / DAY) * 24) % 24;
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  return `Day ${day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * World time offset to skip to the next dawn (~6:00) after sleeping.
 * Returns the absolute tick that starts the next morning.
 */
export function nextDawn(tick) {
  const t = tickOfDay(tick);
  const delta = (DAY - t) % DAY; // to next 0 (6:00)
  return tick + (delta === 0 ? DAY : delta);
}

export const CYCLE = { DAY_START, NOON, SUNSET, MIDNIGHT, DAY };
