// Jobs, attributes, skills and progression curves. Shared by server (rules) and client (UI).
// Multiclassing model: main level (all kills) + one level per job (only while that job is active).
// A skill is learned when its job reaches the unlock level and then works in ANY bar slot under ANY job.

export const MAIN_MAX = 60;
export const JOB_MAX = 20;
export const POINTS_PER_LEVEL = 3;
export const JOB_SWITCH_MS = 15000;
export const ATTRS = ['str', 'dex', 'int', 'vit', 'spr'];
export const ATTR_INFO = {
  str: ['Strength', 'Melee power (swords, axes, maces)'],
  dex: ['Dexterity', 'Bow and dagger power, critical chance, dodge, haste'],
  int: ['Intellect', 'Magic power (staves, wands)'],
  vit: ['Vitality', 'Maximum health'],
  spr: ['Spirit', 'Healing power and magic resistance'],
};
export const ATTR_BASE = 5;

export const mainXpNeeded = (l) => Math.round(25 * Math.pow(l, 1.5));
export const jobXpNeeded = (l) => Math.round(30 * Math.pow(l, 1.6));
export const barSlots = (lvl) => (lvl >= 30 ? 6 : lvl >= 20 ? 5 : lvl >= 10 ? 4 : 3);

// Weapon base -> auto attack behaviour. Any job can wield any weapon.
export const WEAPON_TYPES = {
  sword: { range: 1.5, ms: 900, scale: 'str', fx: 'swing', mag: false },
  axe: { range: 1.5, ms: 1100, scale: 'str', fx: 'swing', mag: false },
  mace: { range: 1.5, ms: 1000, scale: 'str', fx: 'swing', mag: false },
  dagger: { range: 1.5, ms: 650, scale: 'dex', fx: 'swing', mag: false },
  bow: { range: 7, ms: 1000, scale: 'dex', fx: 'arrow', mag: false },
  staff: { range: 6, ms: 1100, scale: 'int', fx: 'bolt', mag: true },
  wand: { range: 6, ms: 800, scale: 'int', fx: 'bolt', mag: true },
  none: { range: 1.5, ms: 900, scale: 'str', fx: 'swing', mag: false },
};

export const JOB_ORDER = ['warrior', 'mage', 'ranger', 'cleric', 'rogue', 'warlock'];
export const JOBS = {
  warrior: {
    name: 'Warrior', role: 'Tank / melee', color: '#c03a3a', hpMul: 1.15, defMul: 1.1,
    growth: { str: 0.5, vit: 0.5 }, start: 'sword',
    desc: 'Steel and stubbornness. Soaks damage and punishes everything within reach.',
    trait: 'Iron Will: +15% max health, +10% defense.',
  },
  mage: {
    name: 'Mage', role: 'Ranged magic', color: '#8a5af0', hpMul: 0.85, defMul: 1,
    growth: { int: 0.7, spr: 0.2 }, start: 'staff', magMul: 1.2,
    desc: 'A glass cannon with the longest reach. Burns, freezes and blinks away.',
    trait: 'Arcane Focus: +20% magic damage.',
  },
  ranger: {
    name: 'Ranger', role: 'Ranged physical', color: '#3f9a4f', hpMul: 1, defMul: 1,
    growth: { dex: 0.7, vit: 0.2 }, start: 'bow', critAdd: 8, moveHaste: 0.1,
    desc: 'Quick, patient and deadly from afar. Never stays in one place.',
    trait: "Hunter's Eye: +8% crit chance, +10% movement speed.",
  },
  cleric: {
    name: 'Cleric', role: 'Healer / support', color: '#f0d060', hpMul: 1.05, defMul: 1.05,
    growth: { spr: 0.7, vit: 0.25 }, start: 'mace', healMul: 1.25, regen: 0.01,
    desc: 'Keeps the party standing and smites the wicked. The best friend of a Warrior.',
    trait: 'Devotion: +25% healing and slow health regeneration in combat.',
  },
  rogue: {
    name: 'Rogue', role: 'Melee burst', color: '#6a6a8a', hpMul: 0.95, defMul: 0.95,
    growth: { dex: 0.6, str: 0.25 }, start: 'dagger', critDmg: 0.35, dodgeAdd: 5,
    desc: 'Fast knives and faster feet. Wins fights in the first three seconds.',
    trait: 'Assassin: +35% critical damage, +5% dodge.',
  },
  warlock: {
    name: 'Warlock', role: 'Curses / sustain', color: '#a03aa0', hpMul: 0.95, defMul: 1,
    growth: { int: 0.55, vit: 0.3 }, start: 'wand', lifesteal: 0.08,
    desc: 'Trades in curses, pain and borrowed health. Hard to kill, harder to forget.',
    trait: 'Dark Bargain: heal for 8% of damage dealt.',
  },
};

/**
 * kind decides how the server resolves it. Common fields: cd (ms), mult (x power), scale (attribute),
 * range (tiles), r (radius), fx (status effects on hit: [id, ms, pow]), ic ([glyph, colour]).
 */
export const SKILLS = {
  // ---- Warrior
  cleave: { job: 'warrior', lvl: 1, name: 'Cleave', cd: 4000, kind: 'aoe_self', r: 1.9, mult: 1.4, scale: 'str', vis: 'cleave', ic: ['slash', '#e8e8f0'], desc: 'Slash every foe around you for 140% damage.' },
  bash: { job: 'warrior', lvl: 3, name: 'Shield Bash', cd: 8000, kind: 'melee_st', range: 1.7, mult: 1.0, scale: 'str', vis: 'bash', fx: [['stun', 2000, 0]], ic: ['shield', '#7a8ab0'], desc: 'Smash your target and stun it for 2s.' },
  warcry: { job: 'warrior', lvl: 6, name: 'Battle Cry', cd: 20000, kind: 'buff_self', heal: 0.15, fx: [['atkUp', 8000, 0.35]], vis: 'cry', ic: ['horn', '#e8c04a'], desc: '+35% damage for 8s and recover 15% health.' },
  provoke: { job: 'warrior', lvl: 9, name: 'Provoke', cd: 12000, kind: 'taunt', r: 6, fx: [['defUp', 6000, 0.3]], vis: 'ring', col: '#ff6a3a', ic: ['eye', '#ff6a3a'], desc: 'Force nearby enemies to attack you and harden your armor.' },
  whirl: { job: 'warrior', lvl: 13, name: 'Whirlwind', cd: 14000, kind: 'aoe_self', r: 2.5, mult: 2.0, scale: 'str', vis: 'cleave', fx: [['bleed', 6000, 0.35]], ic: ['spin', '#ff8a5a'], desc: 'Spin for 200% damage and leave enemies bleeding.' },
  bulwark: { job: 'warrior', lvl: 17, name: 'Bulwark', cd: 45000, kind: 'shield', pct: 0.3, ms: 8000, fx: [['defUp', 8000, 0.3]], vis: 'cry', ic: ['shield', '#ffd23a'], desc: 'Gain a barrier worth 30% of your health and +30% defense for 8s.' },
  // ---- Mage
  fireball: { job: 'mage', lvl: 1, name: 'Fireball', cd: 3000, kind: 'ranged_st', range: 7, mult: 2.4, scale: 'int', mag: true, vis: 'fire', fx: [['burn', 4000, 0.25]], ic: ['flame', '#ff8a2a'], desc: 'Hurl a fireball for 240% damage. Sets the target ablaze.' },
  frostnova: { job: 'mage', lvl: 3, name: 'Frost Nova', cd: 10000, kind: 'aoe_self', r: 3.2, mult: 1.3, scale: 'int', mag: true, vis: 'nova', fx: [['slow', 4000, 0.5]], ic: ['snow', '#8fe0ff'], desc: 'Blast nearby foes for 130% damage and slow them.' },
  blink: { job: 'mage', lvl: 6, name: 'Blink', cd: 15000, kind: 'dash', dist: 5, blink: true, vis: 'dash', ic: ['star', '#c8a8ff'], desc: 'Teleport up to 5 tiles in the direction you face.' },
  chain: { job: 'mage', lvl: 9, name: 'Chain Lightning', cd: 9000, kind: 'ranged_st', range: 7, mult: 1.6, scale: 'int', mag: true, chain: 2, vis: 'lightning', ic: ['bolt', '#ffe866'], desc: 'Lightning that jumps to 2 more enemies.' },
  meteor: { job: 'mage', lvl: 13, name: 'Meteor', cd: 25000, kind: 'aoe_target', range: 8, r: 2.6, mult: 4.0, scale: 'int', mag: true, warnMs: 1200, vis: 'meteor', ic: ['meteor', '#ff5a2a'], desc: 'Call a meteor onto the target area after a short delay: 400% damage.' },
  barrier: { job: 'mage', lvl: 17, name: 'Arcane Barrier', cd: 40000, kind: 'shield', pct: 0.25, ms: 10000, fx: [['haste', 10000, 0.2]], vis: 'nova', ic: ['shield', '#b08aff'], desc: 'Absorb damage worth 25% of your health and gain haste.' },
  // ---- Ranger
  powershot: { job: 'ranger', lvl: 1, name: 'Power Shot', cd: 3000, kind: 'ranged_st', range: 8, mult: 2.3, scale: 'dex', vis: 'arrow', big: 1, ic: ['arrow', '#d8d8e0'], desc: 'A drawn arrow for 230% damage.' },
  volley: { job: 'ranger', lvl: 3, name: 'Volley', cd: 8000, kind: 'multi', range: 7, n: 4, mult: 1.3, scale: 'dex', vis: 'arrow', ic: ['arrows', '#d8d8e0'], desc: 'Loose arrows at up to 4 foes for 130% each.' },
  sprint: { job: 'ranger', lvl: 6, name: 'Sprint', cd: 18000, kind: 'buff_self', fx: [['haste', 6000, 0.5]], vis: 'dash', ic: ['boot', '#8a5a2a'], desc: 'Run much faster for 6s.' },
  snare: { job: 'ranger', lvl: 9, name: 'Ensnare', cd: 14000, kind: 'ranged_st', range: 8, mult: 0.8, scale: 'dex', vis: 'arrow', fx: [['slow', 5000, 0.7]], ic: ['web', '#c8c8a0'], desc: 'Pin a target in place: heavy slow for 5s.' },
  venom: { job: 'ranger', lvl: 13, name: 'Venom Arrow', cd: 12000, kind: 'ranged_st', range: 8, mult: 1.0, scale: 'dex', vis: 'arrow', fx: [['poison', 9000, 0.3]], ic: ['drop', '#6aff4a'], desc: 'Poison that deals 30% damage every second for 9s.' },
  rain: { job: 'ranger', lvl: 17, name: 'Arrow Rain', cd: 22000, kind: 'aoe_target', range: 8, r: 3.0, mult: 3.2, scale: 'dex', warnMs: 800, vis: 'rain', ic: ['arrows', '#ffd23a'], desc: 'Arrows fall over an area after a short delay: 320% damage.' },
  // ---- Cleric
  smite: { job: 'cleric', lvl: 1, name: 'Smite', cd: 3000, kind: 'ranged_st', range: 6, mult: 1.9, scale: 'spr', mag: true, vis: 'holy', ic: ['sun', '#fff2a0'], desc: 'Holy damage at range: 190% (scales with Spirit).' },
  heal: { job: 'cleric', lvl: 3, name: 'Heal', cd: 6000, kind: 'heal', range: 8, mult: 3.0, vis: 'heal', ic: ['cross', '#6aff8a'], desc: 'Heal yourself or the most wounded party member in range.' },
  bless: { job: 'cleric', lvl: 6, name: 'Blessing', cd: 25000, kind: 'buff_party', r: 8, fx: [['atkUp', 12000, 0.2], ['defUp', 12000, 0.2]], vis: 'cry', ic: ['star', '#fff2a0'], desc: '+20% damage and defense for you and nearby party members for 12s.' },
  renew: { job: 'cleric', lvl: 9, name: 'Renew', cd: 16000, kind: 'hot', range: 8, mult: 0.6, ms: 10000, vis: 'heal', ic: ['cross', '#aaffcc'], desc: 'Heal over 10s: 60% of your healing power every second.' },
  holynova: { job: 'cleric', lvl: 13, name: 'Holy Nova', cd: 15000, kind: 'nova_heal', r: 3.5, mult: 1.6, scale: 'spr', mag: true, healMult: 1.5, vis: 'nova', ic: ['sun', '#ffffff'], desc: 'Damage nearby enemies and heal nearby allies.' },
  aegis: { job: 'cleric', lvl: 17, name: 'Divine Shield', cd: 50000, kind: 'buff_self', fx: [['invuln', 4000, 0]], vis: 'heal', ic: ['shield', '#fff2a0'], desc: 'Become invulnerable for 4s.' },
  // ---- Rogue
  stab: { job: 'rogue', lvl: 1, name: 'Quick Stab', cd: 2500, kind: 'melee_st', range: 1.7, mult: 1.7, scale: 'dex', vis: 'swing', ic: ['dagger', '#d8d8e0'], desc: 'A fast stab for 170% damage.' },
  backstab: { job: 'rogue', lvl: 3, name: 'Backstab', cd: 6000, kind: 'melee_st', range: 1.7, mult: 2.0, scale: 'dex', vis: 'swing', bonusIf: ['stun', 'slow', 'bleed', 'poison'], bonusMult: 1.6, ic: ['dagger', '#ff6a6a'], desc: '200% damage, +60% against stunned, slowed or bleeding targets.' },
  evade: { job: 'rogue', lvl: 6, name: 'Evade', cd: 18000, kind: 'buff_self', fx: [['dodge', 3000, 1.0], ['haste', 3000, 0.3]], vis: 'dash', ic: ['boot', '#6a6a8a'], desc: 'Dodge everything for 3s and run faster.' },
  rupture: { job: 'rogue', lvl: 9, name: 'Rupture', cd: 10000, kind: 'melee_st', range: 1.7, mult: 1.0, scale: 'dex', vis: 'swing', fx: [['bleed', 8000, 0.35]], ic: ['drop', '#c03a3a'], desc: 'Open a wound that bleeds for 35% damage a second for 8s.' },
  smoke: { job: 'rogue', lvl: 13, name: 'Smoke Bomb', cd: 25000, kind: 'cc_aoe', r: 3.2, mult: 0.6, scale: 'dex', fx: [['slow', 4000, 0.4]], dropThreat: true, vis: 'nova', col: '#9a9aaa', ic: ['bomb', '#9a9aaa'], desc: 'Blind nearby enemies: they slow down and forget you.' },
  assassinate: { job: 'rogue', lvl: 17, name: 'Assassinate', cd: 30000, kind: 'melee_st', range: 1.7, mult: 5.0, scale: 'dex', vis: 'swing', execute: [0.3, 3.0], ic: ['skull', '#ff4a4a'], desc: '500% damage; triples against targets under 30% health.' },
  // ---- Warlock
  shadowbolt: { job: 'warlock', lvl: 1, name: 'Shadow Bolt', cd: 3000, kind: 'ranged_st', range: 6, mult: 2.0, scale: 'int', mag: true, vis: 'shadow', ic: ['orb', '#a03aa0'], desc: 'A bolt of shadow for 200% damage.' },
  drain: { job: 'warlock', lvl: 3, name: 'Drain Life', cd: 8000, kind: 'ranged_st', range: 6, mult: 1.4, scale: 'int', mag: true, vis: 'shadow', leech: 1.0, ic: ['drop', '#d060d0'], desc: 'Damage the target and heal yourself for the same amount.' },
  curse: { job: 'warlock', lvl: 6, name: 'Curse of Frailty', cd: 16000, kind: 'ranged_st', range: 7, mult: 0.5, scale: 'int', mag: true, vis: 'shadow', fx: [['vuln', 10000, 0.25]], ic: ['skull', '#8a3a8a'], desc: 'The target takes 25% more damage from everyone for 10s.' },
  terrify: { job: 'warlock', lvl: 9, name: 'Terrify', cd: 20000, kind: 'cc_aoe', r: 4, mult: 0.4, scale: 'int', fx: [['fear', 3000, 0]], vis: 'nova', col: '#a03aa0', ic: ['eye', '#c060c0'], desc: 'Nearby enemies flee in terror for 3s.' },
  soulburn: { job: 'warlock', lvl: 13, name: 'Soul Burn', cd: 12000, kind: 'ranged_st', range: 6, mult: 1.0, scale: 'int', mag: true, vis: 'shadow', fx: [['burn', 10000, 0.4]], ic: ['flame', '#b050ff'], desc: 'Burns the soul for 40% damage a second for 10s.' },
  pact: { job: 'warlock', lvl: 17, name: 'Dark Pact', cd: 40000, kind: 'sacrifice', hpPct: 0.2, fx: [['atkUp', 10000, 0.5]], vis: 'cry', ic: ['skull', '#ff3aff'], desc: 'Sacrifice 20% of your health for +50% damage for 10s.' },
};

export const SKILL_ORDER = Object.keys(SKILLS);
export const skillsOfJob = (job) => SKILL_ORDER.filter((id) => SKILLS[id].job === job);

/** ids of every skill learned across all jobs (jobs = { warrior: { lvl, xp }, ... }) */
export function knownSkills(jobs) {
  return SKILL_ORDER.filter((id) => jobs[SKILLS[id].job] && jobs[SKILLS[id].job].lvl >= SKILLS[id].lvl);
}

export const EFFECTS = {
  stun: { name: 'Stunned', col: '#ffe066', bad: true }, slow: { name: 'Slowed', col: '#8fe0ff', bad: true },
  root: { name: 'Rooted', col: '#c8c8a0', bad: true }, fear: { name: 'Feared', col: '#c060c0', bad: true },
  burn: { name: 'Burning', col: '#ff8a2a', bad: true, dot: true }, poison: { name: 'Poisoned', col: '#6aff4a', bad: true, dot: true },
  bleed: { name: 'Bleeding', col: '#c03a3a', bad: true, dot: true }, vuln: { name: 'Vulnerable', col: '#8a3a8a', bad: true },
  atkUp: { name: 'Empowered', col: '#ff9a3a' }, defUp: { name: 'Fortified', col: '#7a9aff' }, haste: { name: 'Hasted', col: '#8aff8a' },
  regen: { name: 'Regenerating', col: '#6aff8a' }, shield: { name: 'Barrier', col: '#ffe8a0' }, dodge: { name: 'Evasive', col: '#9a9aff' },
  invuln: { name: 'Invulnerable', col: '#ffffff' },
};

/** Fresh progression for a new hero. */
export function newProgress(job) {
  return {
    job,
    jobs: Object.fromEntries(JOB_ORDER.map((j) => [j, { lvl: j === job ? 1 : 0, xp: 0 }])),
    attr: { str: 0, dex: 0, int: 0, vit: 0, spr: 0 },
    points: POINTS_PER_LEVEL,
    bar: [null, null, null, null, null, null],
  };
}
