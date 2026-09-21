// B7 save/load persistence (crit 18). Pure, headless-testable module.
//
// Serializes a full game snapshot to a versioned JSON string and restores it,
// so a player can close the tab and resume exactly where they left off.
// The format is versioned (additive) — later fields may be added without
// changing `format`.
//
// Missing/corrupt saves are NOT silently overwritten: load returns an explicit
// `{ ok:false, reason, kind }` (kind = 'missing' | 'corrupt' | 'invalid') so
// the caller can present a clear error and fall back to a fresh world while
// preserving any existing valid save on disk.
//
// Snapshot covers every piece of durable runtime state named by crit 18:
//   - seed
//   - player position + state (pos, yaw, pitch, vel)
//   - living state (health, hunger, saturation, air, deaths)
//   - inventory (stacks + selected slot) and equipped armor
//   - time (absolute worldTime ticks)
//   - modified blocks (world edit overlay)
//   - chest/furnace container state
//   - entity state (drops + mobs)
//   - difficulty + spawn point

export const SAVE_FORMAT = 2; // phase-B save format (extends CONTRACT §6 baseline)

/**
 * Serialize a snapshot to a compact versioned JSON string.
 * @param {object} snap shape (see `makeSnapshot`/`restoreSnapshot`).
 * @returns {string}
 */
export function serializeSave(snap) {
  return JSON.stringify(
    {
      format: SAVE_FORMAT,
      seed: snap.seed,
      worldTime: snap.worldTime,
      difficulty: snap.difficulty || 'normal',
      player: {
        pos: [snap.player.pos.x, snap.player.pos.y, snap.player.pos.z],
        yaw: snap.player.yaw || 0,
        pitch: snap.player.pitch || 0,
        vel: snap.player.vel ? [snap.player.vel.x, snap.player.vel.y, snap.player.vel.z] : [0, 0, 0],
      },
      living: snap.living,
      spawnPoint: snap.spawnPoint || { x: 0, y: 8, z: 0 },
      deaths: snap.deaths || 0,
      inventory: {
        selected: snap.inventory.selected || 0,
        stacks: snap.inventory.stacks.map((s) => [s.id, s.count]),
      },
      equipped: (snap.equipped || []).slice(),
      worldEdits: Array.from(snap.worldEdits || []), // [[key,id], ...]
      containers: snap.containers || {},             // key -> {inventory?, ...}
      drops: (snap.drops || []).map((d) => ({
        x: d.x, y: d.y, z: d.z,
        vx: d.vx || 0, vy: d.vy || 0, vz: d.vz || 0,
        itemId: d.itemId, count: d.count || 1, age: d.age || 0,
      })),
      mobs: (snap.mobs || []).map((m) => ({
        type: m.type,
        x: m.x, y: m.y, z: m.z,
        vy: m.vy || 0, vx: m.vx || 0, vz: m.vz || 0,
        health: m.health, maxHealth: m.maxHealth,
        alive: m.alive !== false,
        passive: !!m.passive, aggro: !!m.aggro,
        hurtTicks: m.hurtTicks || 0, attackCooldown: m.attackCooldown || 0,
        fuse: m.fuse || 0, wanderTimer: m.wanderTimer || 0,
        speed: m.speed,
      })),
    },
    null,
    0,
  );
}

/**
 * Parse + validate a save string. Returns one of:
 *   { ok:true, save }                       — valid, restored snapshot
 *   { ok:false, kind:'missing', reason }    — no data / empty input
 *   { ok:false, kind:'corrupt', reason }    — JSON parse failure or wrong type
 *   { ok:false, kind:'invalid', reason }    — structurally invalid fields
 */
export function parseSave(text) {
  if (text == null || text === '' || text === undefined) {
    return { ok: false, kind: 'missing', reason: 'no save present' };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, kind: 'corrupt', reason: `unparseable save: ${e.message}` };
  }
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, kind: 'corrupt', reason: 'save is not a JSON object' };
  }
  if (typeof data.format !== 'number') {
    return { ok: false, kind: 'invalid', reason: 'save missing numeric format' };
  }
  if (data.seed == null || typeof data.seed !== 'string') {
    return { ok: false, kind: 'invalid', reason: 'save missing valid seed' };
  }
  if (data.player == null || !Array.isArray(data.player.pos) || data.player.pos.length !== 3) {
    return { ok: false, kind: 'invalid', reason: 'save missing valid player position' };
  }
  if (data.worldEdits != null && !Array.isArray(data.worldEdits)) {
    return { ok: false, kind: 'invalid', reason: 'worldEdits must be an array' };
  }
  return { ok: true, save: data };
}

/**
 * Restore/rebuild a mutable snapshot object from a parsed save (for the client
 * to rebind onto world/player/inventory). Returns `null` if not a valid save.
 */
export function restoreSnapshot(save) {
  if (!save || save.ok === false) return null;
  const d = save.save || save;
  const edits = new Map();
  if (Array.isArray(d.worldEdits)) {
    for (const [k, id] of d.worldEdits) edits.set(String(k), id);
  }
  return {
    seed: d.seed,
    worldTime: d.worldTime || 0,
    difficulty: d.difficulty || 'normal',
    player: {
      pos: { x: d.player.pos[0], y: d.player.pos[1], z: d.player.pos[2] },
      yaw: d.player.yaw || 0,
      pitch: d.player.pitch || 0,
      vel: d.player.vel ? { x: d.player.vel[0], y: d.player.vel[1], z: d.player.vel[2] } : { x: 0, y: 0, z: 0 },
    },
    living: d.living || {},
    spawnPoint: d.spawnPoint || { x: 0, y: 8, z: 0 },
    deaths: d.deaths || 0,
    inventory: {
      selected: d.inventory?.selected ?? 0,
      stacks: (d.inventory?.stacks || []).map((s) => ({ id: s[0], count: s[1] })),
    },
    equipped: Array.isArray(d.equipped) ? d.equipped.slice() : [],
    worldEdits: edits,
    containers: d.containers || {},
    drops: Array.isArray(d.drops) ? d.drops : [],
    mobs: Array.isArray(d.mobs) ? d.mobs : [],
  };
}

/**
 * Convenience: round-trip a full snapshot through serialize+parse+restore.
 * Returns { ok:true, snap } or { ok:false, reason }.
 */
export function roundTrip(snapshot) {
  const text = serializeSave(snapshot);
  const parsed = parseSave(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return { ok: true, snap: restoreSnapshot(parsed) };
}

export const SAVE_KEY = 'test12.save.v2';

/** Read + validate a save from a storage-like object (localStorage contract). */
export function loadStoredSave(storage) {
  let raw;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch (e) {
    return { ok: false, kind: 'unavailable', reason: `storage read failed: ${e.message}` };
  }
  return parseSave(raw);
}

/**
 * Persist a snapshot to storage. Only overwrites when we are deliberately
 * saving (explicit save or clean shutdown); corrupt/data-loss paths never call
 * this blindly. Returns { ok:true } or { ok:false, reason }.
 */
export function saveToStorage(storage, snapshot) {
  const text = serializeSave(snapshot);
  try {
    storage.setItem(SAVE_KEY, text);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `storage write failed: ${e.message}` };
  }
}

/**
 * Safe in-memory fallback store implementing the storage contract, used by the
 * client when localStorage is unavailable and by headless tests.
 */
export function createMemoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    _map: map,
  };
}

/**
 * Copy a container-state map (keyed by "x,y,z") onto a live target object,
 * replacing its previous contents. Used by the client during boot restore so
 * chest/furnace contents survive a reload (crit 18). Pure + testable.
 */
export function applyContainers(target, containers) {
  const dest = target || {};
  for (const k of Object.keys(dest)) delete dest[k];
  if (containers && typeof containers === 'object') {
    for (const k of Object.keys(containers)) dest[k] = containers[k];
  }
  return dest;
}
