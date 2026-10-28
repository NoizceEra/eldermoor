// Eldermoor balance simulator: a deterministic, headless calculator (no network, no RNG).
//
//   node scripts/balance-sim.mjs            readable tables
//   node scripts/balance-sim.mjs --md       markdown tables (for docs/balance.md)
//   node scripts/balance-sim.mjs --json     raw numbers
//   flags: --gear=starter|geared|both (default both)  --job=<id>  --brief (summary + outliers only)
//
// It models every job at main levels 10/20/30/45/60 with job level 10/20, a points split that follows the job's
// `growth` weights, and either starter-quality or level-appropriate gear. All hit/crit/dodge/mitigation maths comes
// from shared/combat.js, the same module the live server uses, so a formula change moves both together. Randomness is
// replaced by expected values (crit chance becomes an average multiplier, damage rolls their mean, dodge a fraction).
//
// What it measures per job and level:
//   dps1/dps3/dps6  sustained damage per second (60 s) on 1, 3 and 6 clustered targets, with the best bar the job can slot
//   burst           damage in the first 10 s, every cooldown ready (best bar)
//   ehp             health / (armour mitigation x dodge) against the level-appropriate monster
//   ttk / ttk4      kill time of one regular monster / clear time of a four-monster pull (fight sim, best bar, 50 ms steps)
//   lose4           health lost on that pull
//   grind           regular-monster experience per minute chain-pulling four at a time and resting between pulls
//   pack6           six regular monsters at once: health left, or the second the hero fell
//   boss            solo kill time of the nearest boss (or "dead@t"): shows who could ever out-sustain a boss
//   hps / hpsP      healing per second on one tank / spread over a party of five (healers and hybrids only)
import { pathToFileURL } from 'node:url';
import {
  JOBS, JOB_ORDER, SKILLS as RAW_SKILLS, EFFECTS, ATTRS, POINTS_PER_LEVEL, WEAPON_TYPES, barSlots, JOB_MAX,
} from '../shared/jobs.js';
import { MOBS, RARITY } from '../shared/data.js';
import { STARTER_KIT } from '../shared/gear.js';
import {
  GCD_MS, deriveStats, skillPower, autoPower, AUTO_FACTOR, mobHitDamage, critFactor, fxTicks,
} from '../shared/combat.js';

const SKILLS = Object.fromEntries(Object.entries(RAW_SKILLS).map(([id, sk]) => [id, { ...sk, id }]));
const DT = 50; // simulation step, same as the server tick
export const COLUMNS = [ // [main level, job level]
  [10, 10], [20, 10], [20, 20], [30, 20], [45, 20], [60, 20],
];
export const ROLE = {
  warrior: 'tank', paladin: 'tank',
  mage: 'dps', ranger: 'dps', rogue: 'dps', warlock: 'dps', necromancer: 'dps', monk: 'dps',
  cleric: 'healer', druid: 'healer',
};
const WEAPON_CHOICES = { // what a sensible player of each job wields (every job can wield anything)
  warrior: ['sword', 'axe', 'mace'], paladin: ['sword', 'axe', 'mace'], mage: ['staff', 'wand'], ranger: ['bow'],
  cleric: ['mace', 'staff', 'wand'], rogue: ['dagger'], warlock: ['wand', 'staff'], druid: ['staff', 'wand'],
  necromancer: ['wand', 'staff'], monk: ['dagger', 'mace'],
};
const EXEC_PROB = 0.3; // sustained numbers: assume the target spends this share of its life under an execute threshold
const WALK_S = 4, REGEN_PER_S = 0.02, TELEGRAPH_HIT = 0.5; // between kills; out-of-combat regen; share of telegraphed slams that land

// ------------------------------------------------------------------ the hero
const round1 = (v) => Math.round(v * 10) / 10;

/** weights of the points/affix split: the job's growth, normalised */
function weights(job) {
  const g = JOBS[job].growth, sum = Object.values(g).reduce((a, b) => a + b, 0);
  return Object.fromEntries(ATTRS.map((k) => [k, (g[k] || 0) / sum]));
}

/** expected equipment sums (mirrors mkGear in server/index.js, minus the random rolls) */
export function gearFor(job, lvl, tier, weaponBase) {
  const g = { atk: 0, def: 0, hp: 0, crit: 0, dodge: 0, a: {} };
  if (tier === 'starter') {
    g.atk = 2; g.def = Object.keys(STARTER_KIT[job]).length;
    return g;
  }
  const r = lvl >= 30 ? 2 : 1, m = RARITY[r].m; // typical drops: uncommon until 30, rare after
  const sc = (f) => Math.max(1, Math.round((1 + lvl * f) * m));
  const w = weights(job);
  // affixes roll a random attribute; a player keeps the better pieces, so half the affix budget lands on the build's
  // attributes (split by the job's growth) and half is spread evenly over all five
  const give = (v) => { for (const k of ATTRS) g.a[k] = (g.a[k] || 0) + v * (0.5 * w[k] + 0.5 * 0.2); };
  g.atk = Math.max(1, Math.round((2 + lvl * 1.3) * m));
  const primary = Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
  const off = primary === 'str' ? 'shield' : primary === 'dex' ? 'quiver' : 'tome';
  if (off === 'shield') { g.def += sc(0.55); g.hp += Math.round(lvl * 1.2 * m); }
  else if (off === 'tome') { g.a.int = (g.a.int || 0) + sc(0.25); g.a.spr = (g.a.spr || 0) + sc(0.12); }
  else { g.a.dex = (g.a.dex || 0) + sc(0.2); g.crit += round1((1 + lvl * 0.08) * m); }
  g.def += sc(0.4) + sc(0.75) + sc(0.5) + sc(0.3) + sc(0.2) + sc(0.15); // head body legs boots gloves cape
  g.hp += Math.round(lvl * m) + Math.round(lvl * 1.8 * Math.max(0.3, m - 0.4));
  g.dodge += round1((0.5 + lvl * 0.05) * m) + round1((0.4 + lvl * 0.04) * m);
  g.crit += round1((0.6 + lvl * 0.05) * m);
  g.a.dex = (g.a.dex || 0) + sc(0.1); // cape
  g.hp += 2 * Math.round((6 + lvl * 2.5) * m) + Math.round((10 + lvl * 3.5) * m); // two rings, amulet
  give(2 * sc(0.22) + sc(0.2) + sc(0.14));
  // affixes on the eight non-jewellery pieces (weapon, offhand, head, body, legs, boots, gloves, cape)
  give(8 * Math.min(r, 3) * Math.max(1, Math.round((1 + lvl * 0.12) * m * 0.7)));
  return g;
}

/** the hero for one table cell */
export function makeHero(job, lvl, jobLvl, tier) {
  const w = weights(job), total = POINTS_PER_LEVEL * lvl;
  const attr = Object.fromEntries(ATTRS.map((k) => [k, Math.floor(total * w[k])]));
  const left = total - Object.values(attr).reduce((a, b) => a + b, 0);
  const top = Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
  attr[top] += left;
  // wield the weapon with the best auto-attack output among the job's usual choices
  let best = null;
  for (const wb of WEAPON_CHOICES[job]) {
    const gear = gearFor(job, lvl, tier, wb);
    const st = deriveStats({ job, lvl, jobLvl, attr, gear, weaponBase: wb });
    const dps = autoPower(st, lvl) * AUTO_FACTOR * critFactor(st) / (st.atkMs / 1000);
    if (!best || dps > best.dps * 1.0001) best = { wb, dps };
  }
  const gear = gearFor(job, lvl, tier, best.wb);
  return { job, lvl, jobLvl, attr, gear, weaponBase: best.wb, tier };
}

const statsOf = (h, fx = {}) => deriveStats({ job: h.job, lvl: h.lvl, jobLvl: h.jobLvl, attr: h.attr, gear: h.gear, weaponBase: h.weaponBase, fx });
const knownOf = (h) => Object.keys(SKILLS).filter((id) => SKILLS[id].job === h.job && SKILLS[id].lvl <= h.jobLvl);

// ------------------------------------------------------------------ skill classification
const isDamage = (sk) => ['aoe_self', 'melee_st', 'charge', 'ranged_st', 'multi', 'aoe_target', 'nova_heal', 'cc_aoe'].includes(sk.kind) && (sk.mult || 0) > 0;
const fxIds = (sk) => (sk.fx || []).map((f) => f[0]);
const isOffBuff = (sk) => ['buff_self', 'buff_party', 'sacrifice'].includes(sk.kind) && fxIds(sk).some((f) => f === 'atkUp' || f === 'haste');
const isDpsRelevant = (sk) => isDamage(sk) || isOffBuff(sk);
const isSelfHeal = (sk) => ['heal', 'hot', 'hot_party'].includes(sk.kind) || (sk.heal && sk.heal > 0);
const isDefensive = (sk) => sk.kind === 'shield' || isSelfHeal(sk) || fxIds(sk).some((f) => f === 'defUp' || f === 'invuln' || f === 'dodge');

// ------------------------------------------------------------------ monsters
function makeMob(id, def) {
  return { id, def, mh: def.hp, hp: def.hp, fx: {}, atkAt: 0, contactAt: 0, dead: false };
}
export function pickMobs(level) {
  const entries = Object.entries(MOBS);
  const regular = entries.filter(([, d]) => !d.boss && !d.specials && !d.onhit);
  const withHit = entries.filter(([, d]) => !d.boss && !d.specials);
  const near = (list) => list.slice().sort((a, b) => Math.abs(a[1].lvl - level) - Math.abs(b[1].lvl - level) || a[1].lvl - b[1].lvl)[0];
  const reg = near(regular.length ? regular : withHit);
  const bosses = entries.filter(([, d]) => d.boss);
  const boss = near(bosses);
  return { regular: reg, boss: boss && Math.abs(boss[1].lvl - level) <= 12 ? boss : null };
}
/** average damage per second a monster deals before armour (autos + the average of its telegraphed specials) */
function mobAvg(def) { return (def.dmg[0] + def.dmg[1]) / 2; }

// ------------------------------------------------------------------ the fight engine
/**
 * One fight in 50 ms steps. mode 'dps': dummies that never fight back (infinite health unless `hp` given).
 * mode 'solo': monsters attack the hero and the hero uses the full defensive/offensive policy.
 * Returns damage totals, per-source breakdown, time, and the hero's state.
 */
function runFight({ hero, bar, mobs, T, mode = 'dps', execExpected = true, approach = 0 }) {
  const S = {
    t: 0, hero, lvl: hero.lvl, bar, cd: {}, gcdAt: 0, atkAt: 0, fx: {}, regen: [], hp: 0, st: null,
    mobs, dmg: 0, by: {}, healed: 0, events: [], dead: false, deathAt: null, lowHp: 1, dirtyFx: true, lsHeal: 0,
  };
  const refresh = () => {
    const f = {};
    for (const id of ['atkUp', 'defUp', 'haste', 'dodge', 'slow']) { const e = S.fx[id]; if (e && e.until > S.t) f[id] = e.pow; }
    S.st = statsOf(hero, f); S.dirtyFx = false;
  };
  refresh();
  S.hp = S.st.mh;
  const regularWeapon = WEAPON_TYPES[hero.weaponBase];
  const vulnOf = (m) => { const e = m.fx.vuln; return e && e.until > S.t ? e.pow : 0; };
  const has = (m, ids) => ids.some((id) => m.fx[id] && m.fx[id].until > S.t);
  const alive = () => S.mobs.filter((m) => !m.dead);
  const record = (src, amt) => { S.dmg += amt; S.by[src] = (S.by[src] || 0) + amt; };
  const damageMob = (m, amt, src) => {
    if (m.dead) return;
    const a = Number.isFinite(m.hp) ? Math.min(m.hp, amt) : amt;
    record(src, a);
    if (Number.isFinite(m.hp)) { m.hp -= amt; if (m.hp <= 0) { m.dead = true; m.diedAt = S.t; } }
  };
  const healHero = (amt) => {
    amt = Math.min(amt, S.st.mh - S.hp);
    if (amt > 0) { S.hp += amt; S.healed += amt; }
  };
  const addHeroFx = (id, ms, pow) => {
    if (id === 'shield') { const cur = S.fx.shield; S.fx.shield = { until: S.t + ms, pow: pow + (cur && cur.until > S.t ? cur.pow : 0) }; return; }
    S.fx[id] = { until: S.t + ms, pow }; S.dirtyFx = true;
  };
  const hurtHero = (raw, mag, noDodge) => {
    if (S.fx.invuln && S.fx.invuln.until > S.t) return;
    let amt = mobHitDamage(raw, S.st, hero.lvl, mag);
    if (!noDodge) amt *= 1 - S.st.dodge / 100; // expected value of the dodge roll
    const sh = S.fx.shield;
    if (sh && sh.until > S.t && sh.pow > 0) { const ab = Math.min(sh.pow, amt); sh.pow -= ab; amt -= ab; }
    S.hp -= amt;
    S.lowHp = Math.min(S.lowHp, S.hp / S.st.mh);
    if (S.hp <= 0 && !S.dead) { S.dead = true; S.deathAt = S.t; }
  };
  const mobDpsEstimate = () => alive().reduce((a, m) => a + mobHitDamage(mobAvg(m.def), S.st, hero.lvl, !!m.def.mag) / (m.def.atkMs / 1000), 0);

  // --- what one skill cast does. `commit` false returns only its estimated damage value.
  const resolve = (sk, commit) => {
    const st = S.st, cf = critFactor(st), pw = skillPower(st, hero.lvl, sk), live = alive();
    let value = 0;
    const vulnFor = (m) => 1 + vulnOf(m);
    const hit = (m, mult, leech) => {
      const a = pw * mult * cf * vulnFor(m);
      value += a;
      if (commit) {
        damageMob(m, a, sk.id);
        const ls = (st.lifesteal || 0) + (leech || 0);
        if (ls > 0) healHero(a * ls);
      }
    };
    const applyFx = (m) => {
      for (const [id, ms, pow] of sk.fx || []) {
        if (EFFECTS[id].dot) {
          const total = fxTicks(ms) * pow * pw;
          const old = m.fx[id] && m.fx[id].until > S.t ? Math.max(0, Math.ceil((m.fx[id].until - S.t) / 1000) - 1) * m.fx[id].pow : 0;
          value += Math.max(0, total - old);
          if (commit) m.fx[id] = { until: S.t + ms, pow: pow * pw, next: S.t + 1000, src: sk.id };
        } else if (['stun', 'root', 'fear', 'slow', 'vuln'].includes(id)) {
          if (commit) {
            m.fx[id] = { until: S.t + ms, pow };
            if (S.t < m.contactAt && (id === 'stun' || id === 'root' || id === 'fear')) m.contactAt += ms; // held before reaching us
            else if (S.t < m.contactAt && id === 'slow') m.contactAt += ms * pow;
          }
          if (id === 'vuln') value += 0.15 * pw * 4; // curses are worth casting early
          else value += 0.01;
        }
      }
    };
    switch (sk.kind) {
      case 'aoe_self': case 'cc_aoe': case 'nova_heal': {
        if (!live.length) return null;
        for (const m of live) { hit(m, sk.mult); applyFx(m); }
        if (sk.kind === 'nova_heal' && commit) healHero(S.st.healPow * sk.healMult * (S.hp < S.st.mh ? 1 : 0));
        return { value };
      }
      case 'melee_st': case 'charge': {
        const m = live[0];
        if (!m) return null;
        let mult = sk.mult;
        if (sk.bonusIf && has(m, sk.bonusIf)) mult *= sk.bonusMult;
        if (sk.execute) {
          if (Number.isFinite(m.hp)) { if (m.hp / m.mh < sk.execute[0]) mult *= sk.execute[1]; }
          else if (execExpected) mult *= 1 + EXEC_PROB * (sk.execute[1] - 1);
        }
        for (let i = 0; i < (sk.hits || 1); i++) hit(m, mult);
        applyFx(m);
        return { value };
      }
      case 'ranged_st': {
        const m = live[0];
        if (!m) return null;
        hit(m, sk.mult, sk.leech); applyFx(m);
        if (sk.chain) for (let i = 1; i <= sk.chain && i < live.length; i++) hit(live[i], sk.mult * 0.7);
        return { value };
      }
      case 'multi': {
        if (!live.length) return null;
        for (const m of live.slice(0, sk.n)) { hit(m, sk.mult); applyFx(m); }
        return { value };
      }
      case 'aoe_target': {
        const m = live[0];
        if (!m) return null;
        // expected value now; the real hit lands after the warning, on whatever is still standing
        const stNow = st;
        for (const o of live) value += pw * sk.mult * cf * vulnFor(o);
        if (commit) {
          S.events.push({ at: S.t + sk.warnMs, run: () => {
            const pwl = skillPower(S.st, hero.lvl, sk), cfl = critFactor(S.st);
            void stNow;
            for (const o of alive()) { damageMob(o, pwl * sk.mult * cfl * (1 + vulnOf(o)), sk.id); }
          } });
        }
        return { value };
      }
      case 'buff_self': case 'buff_party': case 'sacrifice': {
        if (sk.kind === 'sacrifice') {
          const cost = Math.round(S.st.mh * sk.hpPct);
          if (S.hp <= cost + 1) return null;
          if (commit) S.hp -= cost;
        }
        if (sk.heal && commit) healHero(S.st.mh * sk.heal);
        if (commit) for (const [id, ms, pow] of sk.fx || []) addHeroFx(id, ms, pow);
        return { value: 0 };
      }
      case 'shield': {
        if (commit) { addHeroFx('shield', sk.ms, S.st.mh * sk.pct); for (const [id, ms, pow] of sk.fx || []) addHeroFx(id, ms, pow); }
        return { value: 0 };
      }
      case 'heal': {
        if (S.hp >= S.st.mh - 1) return null;
        if (commit) healHero(S.st.healPow * sk.mult);
        return { value: 0 };
      }
      case 'hot': case 'hot_party': {
        if (commit) S.regen.push({ until: S.t + sk.ms, next: S.t + 1000, pow: S.st.healPow * sk.mult });
        return { value: 0 };
      }
      case 'taunt': {
        if (!live.length) return null;
        if (commit) for (const [id, ms, pow] of sk.fx || []) addHeroFx(id, ms, pow);
        return { value: 0 };
      }
      default: return null; // dash/blink and the like do nothing in a stationary fight
    }
  };

  // --- hero decision each global cooldown
  const act = () => {
    const ready = S.bar.map((id) => SKILLS[id]).filter((sk) => sk && (S.cd[sk.id] || 0) <= S.t);
    if (!ready.length) return;
    const live = alive();
    if (!live.length) return;
    const hpf = S.hp / S.st.mh;
    const cast = (sk) => {
      const r = resolve(sk, true);
      if (!r) return false;
      S.cd[sk.id] = S.t + sk.cd; S.gcdAt = S.t + GCD_MS;
      return true;
    };
    const buffActive = (sk) => fxIds(sk).every((id) => S.fx[id] && S.fx[id].until > S.t);
    if (mode === 'solo') {
      const byKind = (pred) => ready.filter(pred);
      if (hpf < 0.5) {
        const order = [
          (sk) => fxIds(sk).includes('invuln'), (sk) => sk.kind === 'shield', (sk) => sk.kind === 'heal', (sk) => sk.heal > 0,
          (sk) => sk.kind === 'hot' || sk.kind === 'hot_party', (sk) => fxIds(sk).includes('dodge'), (sk) => fxIds(sk).includes('defUp'),
        ];
        for (const pred of order) { const c = byKind(pred)[0]; if (c && cast(c)) return; }
      }
      if (hpf < 0.85 || live.length >= 2) {
        for (const sk of byKind((s) => s.kind === 'shield' || (fxIds(s).includes('defUp') && !fxIds(s).includes('atkUp')) || s.kind === 'taunt')) {
          if (sk.kind === 'taunt' && live.length < 2) continue;
          if (cast(sk)) return;
        }
      }
      if (hpf < 0.75) { const c = byKind((s) => s.kind === 'heal' || s.kind === 'hot')[0]; if (c && cast(c)) return; }
    }
    // offensive buffs and curses first
    const focus = live[0];
    const worth = Number.isFinite(focus.hp) ? focus.hp / focus.mh > 0.35 || live.length > 1 : true;
    if (worth) {
      for (const sk of ready.filter(isOffBuff)) { if (!buffActive(sk) && cast(sk)) return; }
    }
    // control on the closest monster
    if (mode === 'solo') {
      for (const sk of ready.filter((s) => fxIds(s).some((f) => ['stun', 'fear', 'root'].includes(f)) && !s.mult)) { if (cast(sk)) return; }
    }
    // damage by value
    let best = null, bv = 0;
    for (const sk of ready) {
      if (!isDamage(sk) && !(sk.fx || []).some((f) => f[0] === 'vuln')) continue;
      const r = resolve(sk, false);
      if (!r) continue;
      let v = r.value;
      if (mode === 'solo' && (sk.fx || []).some((f) => ['stun', 'fear', 'root'].includes(f[0]))) v += 0.4 * mobDpsEstimate();
      if (v > bv) { bv = v; best = sk; }
    }
    if (best) cast(best);
  };

  // monsters start engaged after the approach
  for (const m of S.mobs) { m.contactAt = approach; m.atkAt = approach; }
  const specials = (m) => m.def.specials || [];
  for (const m of S.mobs) { m.spec = {}; for (const s of specials(m)) if (s.kind === 'slam' || s.kind === 'drain') m.spec[s.kind] = approach + s.cd * 0.5; }

  for (S.t = 0; S.t <= T && !S.dead; S.t += DT) {
    const t = S.t;
    // effects expire
    for (const id of Object.keys(S.fx)) if (S.fx[id].until <= t) { delete S.fx[id]; if (id !== 'shield') S.dirtyFx = true; }
    if (S.dirtyFx) { const mh0 = S.st.mh; refresh(); void mh0; }
    // damage over time on monsters
    for (const m of S.mobs) {
      if (m.dead) continue;
      for (const id of Object.keys(m.fx)) {
        const f = m.fx[id];
        if (f.until <= t) { delete m.fx[id]; continue; }
        if (EFFECTS[id].dot && t >= f.next) { f.next = t + 1000; damageMob(m, Math.max(1, Math.round(f.pow)), `${f.src}~dot`); }
      }
    }
    // heal over time on the hero
    S.regen = S.regen.filter((r) => r.until > t);
    for (const r of S.regen) if (t >= r.next) { r.next = t + 1000; healHero(r.pow); }
    if (mode === 'solo' && t % 1000 === 0 && JOBS[hero.job].regen) healHero(S.st.mh * JOBS[hero.job].regen);
    if (!alive().length) break;
    // timed events (meteor impacts)
    for (const e of S.events.slice()) if (e.at <= t) { e.run(); S.events.splice(S.events.indexOf(e), 1); }
    // monsters act
    if (mode === 'solo') {
      for (const m of alive()) {
        const stunned = (m.fx.stun && m.fx.stun.until > t) || (m.fx.fear && m.fx.fear.until > t);
        if (t < m.contactAt || stunned) continue;
        const def = m.def, avg = mobAvg(def);
        if (t >= m.atkAt) {
          m.atkAt = t + def.atkMs;
          hurtHero(avg, !!def.mag, false);
        }
        for (const s of specials(m)) {
          if (!m.spec[s.kind] || t < m.spec[s.kind]) continue;
          if (s.kind === 'slam') { m.spec.slam = t + s.cd; hurtHero(avg * s.mult * TELEGRAPH_HIT, false, true); }
          else if (s.kind === 'drain') { m.spec.drain = t + s.cd; hurtHero(avg * s.mult, true, false); }
        }
      }
      // damage over time that monsters leave on the hero (averaged, once a second)
      if (t % 1000 === 0) {
        for (const m of alive()) {
          if (t < m.contactAt) continue;
          for (const [fid, ms, pow] of m.def.onhit || []) {
            if (!EFFECTS[fid].dot) continue;
            const up = Math.min(1, 1 - Math.pow(0.4, ms / m.def.atkMs));
            hurtHero(pow * mobAvg(m.def) * up, true, true);
          }
        }
      }
      if (S.dead) break;
    }
    // hero auto attack on the first living monster
    const tgt = alive()[0];
    if (tgt && t >= S.atkAt) {
      S.atkAt = t + S.st.atkMs;
      const a = autoPower(S.st, hero.lvl) * AUTO_FACTOR * critFactor(S.st) * (1 + vulnOf(tgt));
      damageMob(tgt, a, 'auto');
      const ls = S.st.lifesteal || 0;
      if (ls > 0) healHero(a * ls);
    }
    if (t >= S.gcdAt) act();
  }
  S.endT = Math.min(S.t, T);
  S.stFinal = S.st;
  void regularWeapon;
  return S;
}

// ------------------------------------------------------------------ bar search
function combos(arr, k) {
  if (k >= arr.length) return [arr.slice()];
  if (k <= 0) return [[]];
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

function dummies(n) { return Array.from({ length: n }, (_, i) => makeMob(i, { hp: Infinity, dmg: [0, 0], atkMs: 1e9, lvl: 1 })); }

function bestBar(hero, pool, score, slots) {
  let best = null;
  for (const bar of combos(pool, Math.min(slots, pool.length))) {
    const s = score(bar);
    if (!best || s.score > best.score) best = { bar, ...s };
  }
  return best || { bar: [], score: 0 };
}

/** damage-per-second figures on n clustered dummies */
export function dpsFigures(hero) {
  const slots = barSlots(hero.lvl), pool = knownOf(hero).filter((id) => isDpsRelevant(SKILLS[id]));
  const run = (n, T) => bestBar(hero, pool, (bar) => {
    const r = runFight({ hero, bar, mobs: dummies(n), T: T * 1000, mode: 'dps' });
    return { score: r.dmg / T, by: r.by };
  }, slots);
  const one = run(1, 60), three = run(3, 60), six = run(6, 60), burst = run(1, 10);
  const auto = runFight({ hero, bar: [], mobs: dummies(1), T: 60000, mode: 'dps' }).dmg / 60;
  return { dps1: one.score, dps3: three.score, dps6: six.score, burst: burst.score * 10, auto, bars: { one: one.bar, three: three.bar, six: six.bar, burst: burst.bar }, by: { one: one.by, six: six.by, burst: burst.by } };
}

function approachMs(hero, def) {
  const st = statsOf(hero);
  return Math.max(0, (Math.min(st.range, 6) - def.range)) * def.moveMs + 600;
}

/** one solo fight vs `n` copies of a monster, best bar by `score` */
function soloFight(hero, def, n, T, scoreFn) {
  const slots = barSlots(hero.lvl), pool = knownOf(hero);
  let best = null;
  for (const bar of combos(pool, Math.min(slots, pool.length))) {
    const mobs = Array.from({ length: n }, (_, i) => makeMob(i, def));
    const r = runFight({ hero, bar, mobs, T, mode: 'solo', approach: approachMs(hero, def) });
    const s = scoreFn(r, mobs);
    if (!best || s > best.s) best = { s, r, bar, mobs };
  }
  return best;
}

export function survival(hero, mobs) {
  const out = {};
  const st = statsOf(hero), reg = mobs.regular;
  const def = reg[1];
  out.mob = `${def.name} L${def.lvl}`;
  const hitPhys = mobHitDamage(mobAvg(def), st, hero.lvl, !!def.mag);
  out.ehp = st.mh * (mobAvg(def) / hitPhys) / (1 - st.dodge / 100);
  out.mh = st.mh;
  // clear a pull of n monsters at once: fastest clear wins, tie broken by health lost
  const pull = (n) => {
    const f = soloFight(hero, def, n, 180000, (r, ms) => {
      const kills = ms.filter((m) => m.dead).length;
      if (r.dead) return kills * 100 + r.deathAt / 1000 * 0.1;
      return kills === n ? 10000 - r.endT / 1000 * 10 - (1 - r.hp / r.st.mh) * 50 : 1000 + kills;
    });
    const kills = f.mobs.filter((m) => m.dead).length;
    const won = !f.r.dead && kills === n;
    return { won, kills, bar: f.bar, ttk: won ? Math.max(...f.mobs.map((m) => m.diedAt)) / 1000 : Infinity, lose: won ? Math.max(0, 1 - f.r.hp / f.r.st.mh) * 100 : 100, deadAt: f.r.dead ? f.r.deathAt / 1000 : null, hpLeft: Math.max(0, f.r.hp / f.r.st.mh * 100) };
  };
  const one = pull(1);
  out.ttk = one.ttk; out.lose = one.lose; out.bar = one.bar;
  // levelling feel: chain-pull four monsters, walk to the next group, rest at 2%/s
  const four = pull(4);
  out.ttk4 = four.ttk; out.lose4 = four.lose;
  out.grind = four.won ? 4 * def.xp * 60 / (four.ttk + WALK_S + (four.lose / 100) / REGEN_PER_S) : 0;
  out.xp = def.xp;
  // six at once: a camp
  const six = pull(6);
  out.pack6 = six.won ? { dead: false, hp: six.hpLeft, ttk: six.ttk } : { dead: true, at: six.deadAt, kills: six.kills };
  // boss
  if (mobs.boss) {
    const bdef = mobs.boss[1];
    const b = soloFight(hero, bdef, 1, 300000, (r, ms) => (ms[0].dead && !r.dead ? 10000 - ms[0].diedAt / 1000 : r.dead ? (1 - ms[0].hp / ms[0].mh) * 1000 + r.deathAt / 1000 * 0.01 : (1 - ms[0].hp / ms[0].mh) * 1000));
    const killedBoss = b.mobs[0].dead && !b.r.dead;
    out.boss = { name: bdef.name, ttk: killedBoss ? b.mobs[0].diedAt / 1000 : Infinity, deadAt: b.r.dead ? b.r.deathAt / 1000 : null, dealt: (1 - Math.max(0, b.mobs[0].hp) / b.mobs[0].mh) * 100 };
  } else out.boss = null;
  return out;
}

// ------------------------------------------------------------------ healing
/** healing per second on a single tank and spread over five hurt party members */
export function healing(hero) {
  const pool = knownOf(hero).filter((id) => ['heal', 'hot', 'hot_party', 'nova_heal'].includes(SKILLS[id].kind));
  if (!pool.length) return null;
  const st = statsOf(hero), run = (allies) => {
    let best = 0;
    for (const bar of combos(pool, Math.min(barSlots(hero.lvl), pool.length))) {
      let t = 0, total = 0, gcd = 0; const cd = {}; const hots = [];
      for (; t < 60000; t += DT) {
        for (const h of hots) if (t >= h.next && t < h.until) { h.next += 1000; total += h.pow; }
        if (t < gcd) continue;
        // choose the largest immediate or total value among ready skills
        let pick = null, pv = 0;
        for (const id of bar) {
          const sk = SKILLS[id];
          if ((cd[id] || 0) > t) continue;
          let v = 0;
          if (sk.kind === 'heal') v = st.healPow * sk.mult;
          else if (sk.kind === 'hot') v = fxTicks(sk.ms) * st.healPow * sk.mult;
          else if (sk.kind === 'hot_party') v = fxTicks(sk.ms) * st.healPow * sk.mult * allies;
          else if (sk.kind === 'nova_heal') v = st.healPow * sk.healMult * allies;
          if (v > pv) { pv = v; pick = sk; }
        }
        if (!pick) continue;
        cd[pick.id] = t + pick.cd; gcd = t + GCD_MS;
        if (pick.kind === 'heal') total += st.healPow * pick.mult;
        else if (pick.kind === 'hot') hots.push({ next: t + 1000, until: t + pick.ms, pow: st.healPow * pick.mult });
        else if (pick.kind === 'hot_party') for (let i = 0; i < allies; i++) hots.push({ next: t + 1000, until: t + pick.ms, pow: st.healPow * pick.mult });
        else if (pick.kind === 'nova_heal') total += st.healPow * pick.healMult * allies;
      }
      best = Math.max(best, total / 60);
    }
    return best;
  };
  // for a single tank, area heals only count once
  return { hps: run(1), hpsP: run(5), healPow: st.healPow };
}

// ------------------------------------------------------------------ whole table
export function evaluate({ gears = ['geared'], jobs = JOB_ORDER } = {}) {
  const res = {};
  for (const tier of gears) {
    res[tier] = {};
    for (const job of jobs) {
      res[tier][job] = COLUMNS.map(([lvl, jl]) => {
        const hero = makeHero(job, lvl, jl, tier);
        const mobs = pickMobs(lvl);
        const d = dpsFigures(hero), s = survival(hero, mobs), h = healing(hero);
        return { lvl, jl, hero, ...d, ...s, heal: h };
      });
    }
  }
  return res;
}

// ------------------------------------------------------------------ skill value table
export function skillTable(tier = 'geared') {
  const rows = [];
  for (const job of JOB_ORDER) {
    const hero = makeHero(job, 60, 20, tier);
    const st = statsOf(hero);
    const dps = dpsFigures(hero);
    const dpsHero = makeHero(job, 60, 20, tier);
    void dpsHero;
    for (const id of Object.keys(SKILLS).filter((i) => SKILLS[i].job === job)) {
      const sk = SKILLS[id], pw = skillPower(st, 60, sk), cf = critFactor(st);
      let per = 0, kind = 'utility', note = '';
      if (isDamage(sk)) {
        per = pw * sk.mult * cf * (sk.hits || 1);
        for (const [fid, ms, pow] of sk.fx || []) if (EFFECTS[fid].dot) per += fxTicks(ms) * pow * pw;
        if (sk.execute) per *= 1 + EXEC_PROB * (sk.execute[1] - 1);
        kind = 'damage';
      }
      const targets = ['aoe_self', 'cc_aoe', 'aoe_target', 'nova_heal'].includes(sk.kind) ? 3 : sk.kind === 'multi' ? Math.min(sk.n, 3) : sk.chain ? 1 + Math.min(sk.chain, 2) * 0.7 : 1;
      const per3 = per * targets;
      if (sk.kind === 'shield') { per = st.mh * sk.pct; kind = 'shield'; note = `${Math.round(st.mh * sk.pct)} absorb`; }
      if (sk.kind === 'heal') { per = st.healPow * sk.mult; kind = 'heal'; }
      if (sk.kind === 'hot') { per = fxTicks(sk.ms) * st.healPow * sk.mult; kind = 'heal'; }
      if (sk.kind === 'hot_party') { per = fxTicks(sk.ms) * st.healPow * sk.mult; kind = 'heal'; note = 'per ally'; }
      if (sk.heal) { per += st.mh * sk.heal; if (kind === 'utility') kind = 'buff'; }
      if (['buff_self', 'buff_party', 'sacrifice', 'taunt'].includes(sk.kind) && kind === 'utility') kind = 'buff';
      const inBar = Object.values(dps.bars).some((b) => b.includes(id));
      const shareOf = (by) => { const tot = Object.values(by).reduce((a, b) => a + b, 0) || 1; return ((by[id] || 0) + (by[`${id}~dot`] || 0)) / tot * 100; };
      const share = Math.max(shareOf(dps.by.one), shareOf(dps.by.six), shareOf(dps.by.burst));
      rows.push({ job, id, name: sk.name, lvl: sk.lvl, cd: sk.cd / 1000, kind, per, perSec: per / (sk.cd / 1000), perSec3: per3 / (sk.cd / 1000), inBar, share, fx: fxIds(sk).join('+'), note });
    }
  }
  return rows;
}

// ------------------------------------------------------------------ reporting
const med = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const fmt = (v, d = 0) => (v === Infinity ? 'inf' : v === null || v === undefined || Number.isNaN(v) ? '-' : v.toFixed(d));
const colName = ([l, j]) => `L${l}/j${j}`;

export function outliers(res) {
  const flags = [];
  const tier = 'geared';
  const R = res[tier];
  if (!R) return flags;
  const dpsJobs = JOB_ORDER.filter((j) => ROLE[j] === 'dps');
  const metrics = [['dps1', 'single-target DPS'], ['dps3', '3-target DPS'], ['dps6', '6-target DPS'], ['burst', '10s burst']];
  COLUMNS.forEach((c, ci) => {
    for (const [mk, label] of metrics) {
      const m = med(dpsJobs.map((j) => R[j][ci][mk]));
      for (const j of dpsJobs) {
        const r = R[j][ci][mk] / m;
        if (r > 1.25 || r < 0.75) flags.push({ job: j, col: colName(c), what: label, ratio: r, kind: r > 1 ? 'high' : 'low' });
      }
    }
    // tanks and healers: offence relative to dps median, tank durability
    const m1 = med(dpsJobs.map((j) => R[j][ci].dps1));
    for (const j of JOB_ORDER.filter((x) => ROLE[x] !== 'dps')) {
      const r = R[j][ci].dps1 / m1, floor = ROLE[j] === 'tank' ? 0.6 : 0.4;
      if (r < floor) flags.push({ job: j, col: colName(c), what: `kill power vs dps median (${ROLE[j]} floor ${floor})`, ratio: r, kind: 'low' });
      if (r > 1.0) flags.push({ job: j, col: colName(c), what: 'support out-damages the dps median', ratio: r, kind: 'high' });
    }
    const tanks = JOB_ORDER.filter((j) => ROLE[j] === 'tank');
    const allEhp = JOB_ORDER.map((j) => R[j][ci].ehp), me = med(allEhp);
    for (const j of JOB_ORDER) {
      const r = R[j][ci].ehp / me;
      if (ROLE[j] === 'tank' && r < 1.15) flags.push({ job: j, col: colName(c), what: 'tank durability vs all-job median EHP', ratio: r, kind: 'low' });
      if (ROLE[j] !== 'tank' && r > 1.4) flags.push({ job: j, col: colName(c), what: 'non-tank is tankier than a tank would be', ratio: r, kind: 'high' });
    }
    void tanks;
    const healers = JOB_ORDER.filter((j) => R[j][ci].heal);
    if (healers.length > 1 && c[1] >= 20) {
      const hm = med(healers.map((j) => R[j][ci].heal.hpsP));
      for (const j of healers) {
        const r = R[j][ci].heal.hpsP / hm;
        if (ROLE[j] === 'healer' && (r > 1.3 || r < 0.7)) flags.push({ job: j, col: colName(c), what: 'party healing vs healer median', ratio: r, kind: r > 1 ? 'high' : 'low' });
      }
    }
    const gm = med(JOB_ORDER.map((j) => R[j][ci].grind));
    for (const j of JOB_ORDER) {
      const r = R[j][ci].grind / gm;
      // levelling speed is quantised by the 600 ms global cooldown (clears take 1-6 s), so only large gaps count
      if (r > 1.6 || r < 0.55) flags.push({ job: j, col: colName(c), what: 'solo levelling speed vs all-job median', ratio: r, kind: r > 1 ? 'high' : 'low' });
    }
  });
  return flags;
}

function printTable(title, rows, head, md) {
  const out = [];
  if (md) {
    out.push(`**${title}**`, '', `| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`);
    for (const r of rows) out.push(`| ${r.join(' | ')} |`);
    out.push('');
  } else {
    const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
    out.push(title, head.map((h, i) => (i === 0 ? h.padEnd(w[i]) : h.padStart(w[i]))).join('  '));
    for (const r of rows) out.push(r.map((c, i) => (i === 0 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join('  '));
    out.push('');
  }
  return out.join('\n');
}

export function report(res, { md = false, brief = false } = {}) {
  const parts = [];
  const head = ['job', ...COLUMNS.map(colName)];
  const metric = (tier, title, fn, d = 0) => {
    const rows = Object.keys(res[tier]).map((j) => [JOBS[j].name, ...res[tier][j].map((c) => fmt(fn(c), d))]);
    parts.push(printTable(`${title} [${tier} gear]`, rows, head, md));
  };
  for (const tier of Object.keys(res)) {
    metric(tier, 'Single-target sustained DPS', (c) => c.dps1);
    metric(tier, '3-target AoE DPS (total)', (c) => c.dps3);
    metric(tier, '6-target AoE DPS (total)', (c) => c.dps6);
    metric(tier, '10 s burst damage', (c) => c.burst);
    metric(tier, 'Effective HP vs level-appropriate monster', (c) => c.ehp);
    if (!brief) {
      metric(tier, 'Max HP', (c) => c.mh);
      metric(tier, 'Solo kill time of one regular monster (s)', (c) => c.ttk, 1);
      metric(tier, 'Clear time of a four-monster pull (s)', (c) => c.ttk4, 1);
      metric(tier, 'Health lost on a four-monster pull (%)', (c) => c.lose4, 0);
    }
    metric(tier, 'Levelling speed: XP per minute chain-pulling four regular monsters', (c) => c.grind);
    const rowsP = Object.keys(res[tier]).map((j) => [JOBS[j].name, ...res[tier][j].map((c) => (c.pack6.dead ? `dead@${fmt(c.pack6.at)}s (${c.pack6.kills}k)` : `${fmt(c.pack6.hp)}% left`))]);
    parts.push(printTable(`Six monsters at once [${tier} gear]`, rowsP, head, md));
    const rowsB = Object.keys(res[tier]).map((j) => [JOBS[j].name, ...res[tier][j].map((c) => (c.boss ? (c.boss.ttk < Infinity ? `${fmt(c.boss.ttk)}s` : `dead@${fmt(c.boss.deadAt)}s (${fmt(c.boss.dealt)}%)`) : 'n/a'))]);
    parts.push(printTable(`Solo boss (kill time, or time of death and boss % removed) [${tier} gear]`, rowsB, head, md));
    const hj = Object.keys(res[tier]).filter((j) => res[tier][j][0].heal);
    if (hj.length) {
      parts.push(printTable(`Healing per second on one tank [${tier} gear]`, hj.map((j) => [JOBS[j].name, ...res[tier][j].map((c) => fmt(c.heal && c.heal.hps))]), head, md));
      parts.push(printTable(`Healing per second across a party of five [${tier} gear]`, hj.map((j) => [JOBS[j].name, ...res[tier][j].map((c) => fmt(c.heal && c.heal.hpsP))]), head, md));
    }
  }
  const mobsUsed = COLUMNS.map(([l]) => { const m = pickMobs(l); return `L${l}: ${m.regular[1].name} (L${m.regular[1].lvl}, ${m.regular[1].hp} hp)${m.boss ? ` / boss ${m.boss[1].name} (L${m.boss[1].lvl}, ${m.boss[1].hp} hp)` : ''}`; });
  parts.push(`${md ? '' : ''}Monsters used: ${mobsUsed.join('; ')}\n`);
  const fl = outliers(res);
  const byJob = {};
  for (const f of fl) (byJob[f.job] = byJob[f.job] || []).push(f);
  const lines = [];
  for (const j of JOB_ORDER) {
    if (!byJob[j]) continue;
    lines.push(`- ${JOBS[j].name}: ${byJob[j].map((f) => `${f.what} ${f.kind} (${fmt(f.ratio, 2)}x at ${f.col})`).join('; ')}`);
  }
  parts.push(`${md ? '**Outliers (geared)**\n' : 'Outliers (geared)'}\n${lines.length ? lines.join('\n') : '- none'}\n`);
  return parts.join('\n');
}

export function skillReport({ md = false } = {}) {
  const all = skillTable();
  const rows = all.map((r) => [JOBS[r.job].name, r.name, `${r.lvl}`, `${r.cd}`, r.kind, fmt(r.per), fmt(r.perSec, 1), fmt(r.perSec3, 1), r.kind === 'damage' ? fmt(r.share, 1) : '-', r.fx]);
  const weak = all.filter((r) => r.kind === 'damage' && r.share < 3 && !/stun|slow|root|fear|vuln/.test(r.fx));
  const dom = [];
  for (const job of JOB_ORDER) { // a skill that out-values its job's other damage skills per second of cooldown by more than 2.5x the median
    const d = all.filter((r) => r.job === job && r.kind === 'damage');
    const m = med(d.map((r) => r.perSec));
    for (const r of d) if (m && r.perSec > m * 2.5 && r.cd > 3) dom.push(r); // 3 s fillers are the rotation backbone by design
  }
  const note = `Skills under 3% of their job's damage with no control role: ${weak.length ? weak.map((r) => `${r.name} (${JOBS[r.job].name}, ${fmt(r.share, 1)}%)`).join(', ') : 'none'}.\nSkills on a cooldown over 3 s that are worth over 2.5x their job's median damage per second of cooldown: ${dom.length ? dom.map((r) => `${r.name} (${JOBS[r.job].name}, ${fmt(r.perSec, 0)}/s)`).join(', ') : 'none'}.\n`;
  return printTable('Skill value at L60/j20, geared (amount per cast, per second of cooldown, per second on 3 targets, share of the job damage in its best bar)', rows, ['job', 'skill', 'lvl', 'cd s', 'kind', 'per cast', 'per s', 'per s x3', 'dmg %', 'fx'], md) + note;
}

// ------------------------------------------------------------------ cli
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
  const gearArg = args.gear || 'both';
  const gears = gearArg === 'both' ? ['starter', 'geared'] : [gearArg];
  const jobs = args.job ? [args.job] : JOB_ORDER;
  const t0 = Date.now();
  const res = evaluate({ gears, jobs });
  if (args.json) {
    const slim = JSON.parse(JSON.stringify(res, (k, v) => (k === 'hero' ? undefined : v === Infinity ? 'inf' : v)));
    console.log(JSON.stringify(slim, null, 1));
  } else {
    console.log(report(res, { md: !!args.md, brief: !!args.brief }));
    if (!args.brief) console.log(skillReport({ md: !!args.md }));
    console.error(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}
void JOB_MAX;
