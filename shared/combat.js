// Pure combat math shared by the authoritative server and the balance simulator (scripts/balance-sim.mjs).
// Nothing here touches players, zones or randomness: callers pass plain numbers in and get plain numbers out,
// so the sim and the live server can never drift apart on the formulas.
import { ATTRS, ATTR_BASE, WEAPON_TYPES, JOBS } from './jobs.js';

/** global cooldown between any two skill casts, ms */
export const GCD_MS = 600;
/** damage-over-time and heal-over-time effects tick once a second */
export const FX_TICK_MS = 1000;

// Dexterity feeds crit, dodge and attack speed, so it is the strongest stat per point unless it is bounded.
// Per-point rates and soft limits live here (balance pass: see docs/balance.md).
export const DEX_CRIT = 0.15, DEX_DODGE = 0.07, DEX_HASTE = 0.002;
export const CRIT_CAP = 50, DODGE_CAP = 40, DEX_HASTE_CAP = 0.3;

/**
 * Derived stats of one hero.
 * attr: spent points {str,dex,int,vit,spr}; gear: summed equipment {atk,def,hp,crit,dodge,a:{attr:n}};
 * weaponBase: base type of the wielded weapon ('sword', 'bow', ...) or null; fx: active buff powers
 * {atkUp, defUp, haste, slow, dodge} (0 when absent; dodge is a 0..1 fraction).
 */
export function deriveStats({ job, lvl, jobLvl, attr = {}, gear = {}, weaponBase = null, fx = {}, dbgMul = 1 }) {
  const J = JOBS[job], jl = Math.max(1, jobLvl);
  const ga = gear.a || {};
  const A = {};
  for (const k of ATTRS) A[k] = ATTR_BASE + (attr[k] || 0) + Math.floor(jl * ((J.growth && J.growth[k]) || 0)) + (ga[k] || 0);
  const wt = WEAPON_TYPES[weaponBase || 'none'] || WEAPON_TYPES.none;
  const atkUp = fx.atkUp || 0, defUp = fx.defUp || 0, haste = fx.haste || 0, slow = fx.slow || 0, dodgeFx = fx.dodge || 0;
  const hasteMul = 1 + Math.min(DEX_HASTE_CAP, A.dex * DEX_HASTE) + haste;
  const mh = Math.round((80 + lvl * 12 + A.vit * 9 + (gear.hp || 0)) * J.hpMul);
  const def = (lvl + A.vit * 0.5 + (gear.def || 0)) * J.defMul * (1 + defUp);
  return {
    A, wAtk: gear.atk || 0, wt, mh, def, mres: A.spr * 0.9 + def * 0.3,
    dmgMul: (1 + atkUp) * (J.dmgMul || 1) * dbgMul,
    crit: Math.min(CRIT_CAP, 5 + A.dex * DEX_CRIT + (gear.crit || 0) + (J.critAdd || 0)),
    critDmg: 1.8 + (J.critDmg || 0),
    dodge: Math.min(95, Math.min(DODGE_CAP, A.dex * DEX_DODGE + (gear.dodge || 0) + (J.dodgeAdd || 0)) + dodgeFx * 100),
    haste: hasteMul, range: wt.range, atkMs: wt.ms / hasteMul,
    moveMul: Math.max(0.4, 1 + haste + (J.moveHaste || 0) - slow),
    healPow: (A.spr * 1.2 + A.int * 0.3 + lvl) * (J.healMul || 1),
    magMul: J.magMul || 1, lifesteal: J.lifesteal || 0, threat: job === 'warrior' ? 1.6 : job === 'paladin' ? 1.4 : job === 'rogue' ? 0.85 : 1,
  };
}

/** base power of an attack scaling off `scale` (str/dex/int/spr), before skill multipliers */
export const power = (st, lvl, scale) => (4 + st.A[scale] * 0.6 + st.wAtk * 0.8 + lvl * 0.8) * st.dmgMul;
/** power of a skill: magic skills get the job's magic multiplier */
export const skillPower = (st, lvl, sk) => power(st, lvl, sk.scale || 'str') * (sk.mag ? st.magMul : 1);
/** power of a weapon auto attack (before the 0.9 factor and the +-12% roll) */
export const autoPower = (st, lvl) => power(st, lvl, st.wt.scale) * (st.wt.mag ? st.magMul : 1);
export const AUTO_FACTOR = 0.9;

/** fraction of raw damage that survives armour (physical: def, magical: mres) */
export const mitigation = (res, lvl) => 1 - res / (res + 40 + lvl * 2);
/** damage a player takes from one landed hit */
export const mobHitDamage = (raw, st, lvl, mag) => Math.max(1, Math.round(raw * mitigation(mag ? st.mres : st.def, lvl)));

/** average damage multiplier from critical hits */
export const critFactor = (st) => 1 + Math.min(1, Math.max(0, st.crit / 100)) * (st.critDmg - 1);
/** number of damage/heal ticks an effect of `ms` produces (the tick at expiry is lost) */
export const fxTicks = (ms) => Math.max(0, Math.ceil(ms / FX_TICK_MS) - 1);
