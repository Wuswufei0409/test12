// Combat gear (crit 12): melee, bow, armor, item durability with observable
// hit feedback, knockback, cooldown, range, death resolution. Pure module,
// headless-testable.
//
// Weapon/armor durability lives on inventory stacks via a parallel `durability`
// map keyed by stack object identity (or an item-level dict keyed by slot).
// Helmet/chest/leggings/boots slots reduce incoming damage.
import { TOOL_TIERS, TOOL_ITEMS } from './items.js';
import { ITEMS } from './blocks.js';

// ---- weapon damage (per material) ----
export const WEAPON_DAMAGE = {
  wood: { melee: 4, range: 2.6, cooldown: 10, knockback: 2 },
  stone: { melee: 5, range: 3.0, cooldown: 10, knockback: 2.4 },
  iron: { melee: 6, range: 3.4, cooldown: 10, knockback: 2.8 },
};
export const HAND_DAMAGE = { melee: 1, range: 2.4, cooldown: 12, knockback: 1 };
export const BOW_DAMAGE = 6;
export const BOW_MAX_RANGE = 48;

function swordMaterial(id) {
  const t = TOOL_ITEMS[id];
  return t && t.type === 'sword' ? t.material : null;
}

/** Melee weapon stats for a held item id (hand if not a sword). */
export function weaponStats(id) {
  const mat = swordMaterial(id);
  return mat ? WEAPON_DAMAGE[mat] : HAND_DAMAGE;
}

const ARMOR_SLOTS = ['helmet', 'chest', 'leggings', 'boots'];
// armor item id -> { slot, material, durability, armorPoints }
const ARMOR = {};
{
  // Build from ITEMS armorFactor + name suffix.
  for (const name of Object.keys(ITEMS)) {
    const it = ITEMS[name];
    if (!isArmorName(name)) continue;
    const slot = slotOf(name);
    const iron = name.startsWith('iron');
    ARMOR[it.id] = {
      slot,
      material: iron ? 'iron' : 'leather',
      durability: iron ? 165 : 60,
      armorPoints: it.armorFactor || 1,
    };
  }
}
function isArmorName(n) { return n.endsWith('_helmet') || n.endsWith('_chest') || n.endsWith('_leggings') || n.endsWith('_boots'); }
function slotOf(n) {
  if (n.endsWith('_helmet')) return 'helmet';
  if (n.endsWith('_chest')) return 'chest';
  if (n.endsWith('_leggings')) return 'leggings';
  return 'boots';
}
export function armorSlot(id) { const a = ARMOR[id]; return a ? a.slot : null; }
export function armorDurability(id) { const a = ARMOR[id]; return a ? a.durability : null; }

/**
 * Damage reduction factor in [0,1) from equipped armor stack ids.
 * armorPoints total -> reduction fraction = total / (total + 20) (MC-like).
 */
export function armorReduction(equipped) {
  let pts = 0;
  for (const id of equipped) { const a = ARMOR[id]; if (a) pts += a.armorPoints; }
  return pts / (pts + 20);
}

/** True when within range of a melee hit (stats.range is block units). */
export function meleeInRange(mobX, mobZ, playerX, playerZ, stats) {
  return Math.hypot(mobX - playerX, mobZ - playerZ) <= stats.range;
}

/**
 * Resolve one melee swing when the weapon's cooldown allows it.
 * @returns { hit, damage, killed, knockback:{x,z}, feedback } or null when on cooldown.
 */
export function resolveMelee(player, mob, weaponId, cooldownLeft, equipped = []) {
  const stats = weaponStats(weaponId);
  if (cooldownLeft > 0) return null;
  if (!meleeInRange(mob.x, mob.z, player.pos.x, player.pos.z, stats)) {
    return { hit: false, reason: 'range' };
  }
  const reduction = armorEquippedBy(equipped); // player attacking: no armor on target here
  let dmg = stats.melee;
  return {
    hit: true,
    damage: dmg,
    killed: false, // caller applies damageMob and reads .killed
    knockback: { x: Math.sign(mob.x - player.pos.x) * stats.knockback * 0.3, z: Math.sign(mob.z - player.pos.z) * stats.knockback * 0.3 },
    feedback: { amount: dmg, cooldown: stats.cooldown },
  };
}

// eslint-disable-next-line no-unused-vars
function armorEquippedBy(equipped) { return 0; }

/** Consume 1 durability from a weapon; returns {remaining, broken}. */
export function useWeapon(weaponId, durability) {
  const stats = weaponStats(weaponId);
  const max = stats === HAND_DAMAGE ? 1 : 60; // hand never degrades materially
  const remaining = Math.max(0, durability - 1);
  return { remaining, broken: remaining <= 0 && durability > 0, max };
}

export const COMBAT = { WEAPON_DAMAGE, HAND_DAMAGE, BOW_DAMAGE, BOW_MAX_RANGE, ARMOR_SLOTS, ARMOR, armorReduction };
