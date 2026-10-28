import { TOWN, TOWNS, CAMP, CAMPS } from './world.js';

export const SEED = 20261028;
export const TICK_MS = 50;
export const MAX_LEVEL = 60;
export const INV_SIZE = 20;
export const DUNGEON_SEED = 777;
export const DUNGEON_REC_LVL = 14;
export const PORTAL_ID = 5, EXIT_ID = 6;
export const xpForLevel = (l) => Math.round(25 * Math.pow(l, 1.5));

export const RARITY = [
  { n: 'Common', c: '#c8c8c8', m: 1 },
  { n: 'Uncommon', c: '#5fd35f', m: 1.3 },
  { n: 'Rare', c: '#4aa3ff', m: 1.7 },
  { n: 'Epic', c: '#c06bff', m: 2.3 },
];

export const CLASSES = {
  warrior: {
    name: 'Warrior', hp: 100, hpL: 18, atk: 6, atkL: 2.2, range: 1.5, atkMs: 900,
    desc: 'Steel and stubbornness. Tough, close-range, hits everything around them.',
    skills: [
      { n: 'Cleave', cd: 4000, d: 'Slash every foe around you for 140% damage.' },
      { n: 'Shield Bash', cd: 8000, d: 'Smash your target for full damage and stun it for 2s.' },
      { n: 'Battle Cry', cd: 20000, d: '+35% attack for 8s and recover 15% health.' },
    ],
  },
  mage: {
    name: 'Mage', hp: 70, hpL: 12, atk: 8, atkL: 2.8, range: 6, atkMs: 1100,
    desc: 'Glass cannon with a long reach. Burns, freezes and mends.',
    skills: [
      { n: 'Fireball', cd: 3000, d: 'Hurl a fireball for 240% damage at range.' },
      { n: 'Frost Nova', cd: 10000, d: 'Blast nearby foes for 130% damage and slow them.' },
      { n: 'Mend', cd: 14000, d: 'Restore 45% of your maximum health.' },
    ],
  },
  ranger: {
    name: 'Ranger', hp: 85, hpL: 14, atk: 7, atkL: 2.4, range: 7, atkMs: 1000,
    desc: 'Quick, patient and deadly from afar. Never stays in one place.',
    skills: [
      { n: 'Power Shot', cd: 3000, d: 'A drawn arrow that hits for 230% damage.' },
      { n: 'Volley', cd: 8000, d: 'Loose arrows at up to 4 foes for 130% each.' },
      { n: 'Sprint', cd: 18000, d: 'Run much faster for 6s.' },
    ],
  },
};

// moveMs = ms per tile, atkMs = ms between attacks
export const MOBS = {
  slime: { name: 'Gel Slime', lvl: 2, hp: 40, dmg: [3, 6], moveMs: 650, atkMs: 1400, range: 1.5, aggro: 4, leash: 8, xp: 14, gold: [1, 4], respawn: 18000 },
  bat: { name: 'Gloom Bat', lvl: 4, hp: 45, dmg: [5, 9], moveMs: 230, atkMs: 1000, range: 1.5, aggro: 6, leash: 10, xp: 22, gold: [2, 6], respawn: 20000 },
  wolf: { name: 'Timber Wolf', lvl: 6, hp: 90, dmg: [8, 14], moveMs: 300, atkMs: 1100, range: 1.5, aggro: 6, leash: 11, xp: 38, gold: [3, 9], respawn: 22000 },
  goblin: { name: 'Goblin Raider', lvl: 9, hp: 150, dmg: [12, 20], moveMs: 400, atkMs: 1200, range: 1.5, aggro: 6, leash: 10, xp: 60, gold: [6, 16], respawn: 24000 },
  skeleton: { name: 'Bone Archer', lvl: 13, hp: 230, dmg: [18, 30], moveMs: 430, atkMs: 1500, range: 5, aggro: 8, leash: 11, xp: 100, gold: [10, 26], respawn: 26000 },
  ghoul: { name: 'Crypt Ghoul', lvl: 15, hp: 300, dmg: [24, 36], moveMs: 380, atkMs: 1200, range: 1.5, aggro: 7, leash: 12, xp: 120, gold: [14, 30], respawn: 1e9 },
  wraith: { name: 'Grave Wraith', mag: true, lvl: 17, hp: 260, dmg: [30, 42], moveMs: 300, atkMs: 1400, range: 4.5, aggro: 8, leash: 12, xp: 150, gold: [18, 36], respawn: 1e9 },
  bonelord: { name: 'The Bone Lord', lvl: 24, hp: 4600, dmg: [55, 90], moveMs: 650, atkMs: 1800, range: 5.5, aggro: 12, leash: 22, xp: 3200, gold: [500, 800], respawn: 1e9, boss: true, mag: true,
    specials: [{ kind: 'summon', type: 'skeleton', n: 2, cd: 16000, max: 6, range: 14 }, { kind: 'drain', r: 4, cd: 11000, mult: 1.2 }, { kind: 'slam', range: 7, cd: 8000, r: 2.4, mult: 2, warnMs: 1000, stun: 800 }] },
  golem: { name: 'Moss Golem', lvl: 20, hp: 2200, dmg: [40, 70], moveMs: 700, atkMs: 2000, range: 2.2, aggro: 9, leash: 14, xp: 1200, gold: [200, 400], respawn: 120000, boss: true,
    specials: [{ kind: 'slam', range: 6, cd: 9000, r: 2.2, mult: 2.2, warnMs: 1100, stun: 1200 }] },
};

export const QUESTS = [
  { title: 'Pest Control', mob: 'slime', need: 6, xp: 80, gold: 30,
    text: 'The meadows are crawling with Gel Slimes. Clear out six of them and the farmers might sleep tonight.' },
  { title: 'Wolves at the Door', mob: 'wolf', need: 8, xp: 260, gold: 90,
    text: 'Timber Wolves have taken to the forest road. Thin the pack - eight should do it.' },
  { title: 'Raiders in the Reeds', mob: 'goblin', need: 8, xp: 700, gold: 220,
    text: 'Goblin Raiders are camped out in the deep woods and swamp. Bring me eight of their ears.' },
  { title: 'The Bone Choir', mob: 'skeleton', need: 8, xp: 1800, gold: 520,
    text: 'Bone Archers haunt the old ruins to the south-west and around the northern arena. Silence eight.' },
  { title: 'Heart of the Ruin', mob: 'golem', need: 1, xp: 5000, gold: 1500, reward: 'epic',
    text: 'The Moss Golem sleeps in the north-eastern arena. It has not stirred in a century. Make it stir - then end it.' },
];

// Portal into the Sunken Crypt (id PORTAL_ID); the exit portal inside is EXIT_ID.
export const PORTAL = { id: PORTAL_ID, key: 'portal', name: 'Sunken Crypt', role: 'portal', x: CAMP.x, y: CAMP.y };

// Fixed NPC ids; all dynamic entities start at 100.
export const NPCS = [
  { id: 1, key: 'elder', name: 'Elder Mira', role: 'quest', x: TOWN.cx - 3, y: TOWN.cy - 1 },
  { id: 2, key: 'shop', name: 'Brom the Merchant', role: 'shop', x: TOWN.cx + 3, y: TOWN.cy - 1 },
  { id: 3, key: 'guard', name: 'Guard Tolan', role: 'lore', x: TOWN.cx + 3, y: TOWN.cy - 10,
    text: 'Stay on the roads until you have a few levels. Slimes in the meadow, wolves in the forest, and worse beyond. East road leads to the Golem\'s arena.' },
  { id: 4, key: 'guard', name: 'Guard Hesk', role: 'lore', x: TOWN.cx - 3, y: TOWN.cy + 10,
    text: 'The south road runs to the old ruins. Bone Archers keep their distance - close the gap fast or break line of sight. Nobody can hurt you inside the town walls.' },
];

// ======================================================================= Phase 3: three new regions
const mob = (name, lvl, o = {}) => ({
  name, lvl, hp: Math.round(Math.pow(lvl, 1.6) * 3.8 * (o.hp || 1)),
  dmg: [Math.round(lvl * 1.45 * (o.dmg || 1)), Math.round(lvl * 2.3 * (o.dmg || 1))],
  moveMs: o.mv || 420, atkMs: o.at || 1300, range: o.range || 1.5, aggro: o.aggro || 7, leash: o.leash || 12,
  xp: Math.round(Math.pow(lvl, 1.5) * 2.1 * (o.xp || 1)), gold: [Math.round(lvl * 0.8), Math.round(lvl * 1.8)],
  respawn: o.respawn || 25000, ...(o.extra || {}),
});
const SLAM = (stun, r = 2.2, mult = 2.0) => ({ kind: 'slam', range: 6, cd: 9000, r, mult, warnMs: 1100, stun });
Object.assign(MOBS, {
  // ---- Sunscar Dunes (desert, levels 18-32)
  scarab: mob('Sand Scarab', 18, { mv: 330, at: 1000, hp: 0.8 }),
  scorpion: mob('Dune Scorpion', 20, { extra: { onhit: [['poison', 6000, 0.15]] } }),
  sandviper: mob('Sand Viper', 22, { mv: 300, at: 1100, extra: { onhit: [['poison', 7000, 0.2]] } }),
  mummy: mob('Tomb Mummy', 23, { hp: 1.4, mv: 520, at: 1500, extra: { onhit: [['slow', 3000, 0.4]] } }),
  sandgolem: mob('Sand Golem', 27, { hp: 2.2, mv: 700, at: 1900, range: 2.2, extra: { specials: [SLAM(1000)] } }),
  sunking: mob('The Sun King', 32, {
    hp: 14, dmg: 1.5, mv: 650, at: 1800, range: 5.5, aggro: 12, leash: 22, xp: 6, respawn: 180000,
    extra: { boss: true, mag: true, specials: [{ kind: 'summon', type: 'scarab', n: 3, cd: 14000, max: 8, range: 14 }, SLAM(900, 2.6, 2.2), { kind: 'drain', r: 4, cd: 12000, mult: 1.2 }] },
  }),
  // ---- Frostmarch (tundra, levels 27-42)
  frostslime: mob('Rime Slime', 27, { hp: 0.9, mv: 600, at: 1400, extra: { onhit: [['slow', 3000, 0.35]] } }),
  snowwolf: mob('Snow Wolf', 29, { mv: 260, at: 1000, extra: { onhit: [['bleed', 5000, 0.12]] } }),
  frostowl: mob('Gale Owl', 30, { mv: 230, at: 1100, hp: 0.7 }),
  frostsprite: mob('Frost Sprite', 31, { range: 5, hp: 0.7, mv: 450, at: 1500, extra: { mag: true, onhit: [['slow', 3000, 0.3]] } }),
  yeti: mob('Frost Yeti', 33, { hp: 1.8, dmg: 1.2, mv: 520, at: 1500 }),
  icegolem: mob('Ice Golem', 36, { hp: 2.4, mv: 720, at: 2000, range: 2.2, extra: { specials: [SLAM(1400)] } }),
  rimefang: mob('Rimefang', 42, {
    hp: 16, dmg: 1.5, mv: 650, at: 1800, range: 5.5, aggro: 12, leash: 22, xp: 6, respawn: 180000,
    extra: { boss: true, mag: true, specials: [{ kind: 'summon', type: 'frostsprite', n: 2, cd: 15000, max: 6, range: 14 }, SLAM(1200, 2.8, 2.2), { kind: 'drain', r: 5, cd: 11000, mult: 1.3 }] },
  }),
  // ---- Cinderpeak (volcano, levels 36-54)
  imp: mob('Cinder Imp', 37, { range: 5, hp: 0.7, mv: 350, at: 1300, extra: { mag: true, onhit: [['burn', 4000, 0.18]] } }),
  magmaslime: mob('Magma Slime', 38, { hp: 1.1, mv: 600, at: 1400, extra: { onhit: [['burn', 5000, 0.2]] } }),
  lavahound: mob('Lava Hound', 41, { mv: 260, at: 1000, extra: { onhit: [['burn', 4000, 0.18]] } }),
  emberknight: mob('Ember Knight', 44, { hp: 1.6, dmg: 1.1, mv: 430, at: 1300 }),
  fireelem: mob('Fire Elemental', 46, { range: 4.5, hp: 1.2, mv: 420, at: 1500, extra: { mag: true, onhit: [['burn', 5000, 0.2]] } }),
  obsidiangolem: mob('Obsidian Golem', 48, { hp: 2.6, mv: 720, at: 2000, range: 2.2, extra: { specials: [SLAM(1000, 2.4, 2.2)] } }),
  cinderwing: mob('Cinderwing', 54, {
    hp: 18, dmg: 1.5, mv: 650, at: 1800, range: 5.5, aggro: 12, leash: 24, xp: 6, respawn: 180000,
    extra: { boss: true, mag: true, specials: [{ kind: 'summon', type: 'imp', n: 3, cd: 14000, max: 8, range: 14 }, SLAM(1000, 3.0, 2.4), { kind: 'drain', r: 5, cd: 10000, mult: 1.3 }] },
  }),
});

// ---- town NPCs (ids 10+). Each town has a shop, a quest giver and a guard with hints.
const T = (id) => TOWNS.find((t) => t.id === id);
const [DH, FW, EH] = [T('dunehaven'), T('frostwatch'), T('emberhold')];
NPCS.push(
  { id: 10, key: 'shop', name: 'Safiya the Trader', role: 'shop', x: DH.cx + 3, y: DH.cy - 1 },
  { id: 11, key: 'scout', name: 'Scout Amira', role: 'quest', x: DH.cx - 3, y: DH.cy - 1 },
  { id: 12, key: 'guard', name: 'Guard Nadir', role: 'lore', x: DH.cx + 3, y: DH.cy + 7, text: 'Welcome to Dunehaven. Scarabs and scorpions in the dunes, mummies in the Tombfields, and the Sun King in the pyramid to the north. Bring water and a healer.' },
  { id: 13, key: 'shop', name: 'Old Hjalmar', role: 'shop', x: FW.cx + 3, y: FW.cy - 1 },
  { id: 14, key: 'warden', name: 'Warden Brynn', role: 'quest', x: FW.cx - 3, y: FW.cy - 1 },
  { id: 15, key: 'guard', name: 'Guard Ivar', role: 'lore', x: FW.cx + 3, y: FW.cy + 7, text: 'Frostwatch holds the line. Wolves and owls on the snow, yetis deeper in, and Rimefang sleeps in the south-west ruin. Slow effects hurt out there: keep moving.' },
  { id: 16, key: 'shop', name: 'Cinder the Smith', role: 'shop', x: EH.cx + 3, y: EH.cy - 1 },
  { id: 17, key: 'forgemaster', name: 'Forgemaster Kael', role: 'quest', x: EH.cx - 3, y: EH.cy - 1 },
  { id: 18, key: 'guard', name: 'Guard Sorrel', role: 'lore', x: EH.cx + 3, y: EH.cy + 7, text: 'Emberhold is the last safe place. Burning effects stack, so cleanse or kill fast. Cinderwing roosts in the crater to the south-east.' },
);

// ---- quest chain: every quest names its giver (NPC id); the next one may be in another town
QUESTS.forEach((q) => { q.giver = 1; });
const Q = (title, mob, need, giver, text, extra = {}) => ({
  title, mob, need, giver, text, xp: Math.round(need * MOBS[mob].xp * 1.3), gold: Math.round(need * MOBS[mob].gold[1] * 3), ...extra,
});
QUESTS.push(
  Q('Scarab Swarm', 'scarab', 10, 11, 'Cross the east bridge to Dunehaven and speak to me. The dunes are crawling with scarabs. Clear ten.'),
  Q('Venom in the Dunes', 'scorpion', 10, 11, 'Dune Scorpions have poisoned our wells. Ten of them, and mind the sting.'),
  Q('Sandslither', 'sandviper', 8, 11, 'Vipers strike from the sand. Kill eight before the caravans come.'),
  Q('The Tombs Stir', 'mummy', 8, 11, 'The Tomb Mummies are waking. Put eight back to rest.'),
  Q('The Sun King', 'sunking', 1, 11, 'The Sun King holds the pyramid in the north. End his reign.', { reward: 'epic', rewardLvl: 32 }),
  Q('Frostbite', 'snowwolf', 10, 14, 'South across the bridge lies Frostwatch. Snow Wolves harry our patrols. Ten pelts.'),
  Q('Gale Owls', 'frostowl', 8, 14, 'Owls strike our scouts from above. Bring down eight.'),
  Q('Yeti Season', 'yeti', 8, 14, 'The yetis are restless. Cull eight of them.'),
  Q('Cold Hearts', 'icegolem', 6, 14, 'Ice Golems wander the Rimewood. Shatter six.'),
  Q('Rimefang', 'rimefang', 1, 14, 'Rimefang sleeps in the south-west ruin. Wake it, and finish it.', { reward: 'epic', rewardLvl: 42 }),
  Q('Imps in the Forge', 'imp', 12, 17, 'Beyond Frostwatch lies Emberhold. Imps have overrun my forge: twelve to clear.'),
  Q('Hounds of the Pit', 'lavahound', 10, 17, 'Lava Hounds pour from the vents. Ten of them.'),
  Q('Knights of Cinder', 'emberknight', 8, 17, 'The Ember Knights serve the dragon. Break eight.'),
  Q('Obsidian Titans', 'obsidiangolem', 5, 17, 'Obsidian Golems guard the crater road. Five must fall.'),
  Q('Cinderwing', 'cinderwing', 1, 17, 'Cinderwing roosts in the crater. Slay the dragon and the realm is safe.', { reward: 'epic', rewardLvl: 54 }),
);

// ======================================================================= Dungeons (instanced, one per party or solo hero)
Object.assign(MOBS, {
  glacius: mob('Glacius, the Frozen King', 44, {
    hp: 15, dmg: 1.5, mv: 650, at: 1800, range: 5.5, aggro: 12, leash: 22, xp: 5, respawn: 1e9,
    extra: { boss: true, mag: true, specials: [{ kind: 'summon', type: 'frostsprite', n: 3, cd: 15000, max: 8, range: 14 }, SLAM(1200, 2.8, 2.2), { kind: 'drain', r: 5, cd: 11000, mult: 1.3 }] },
  }),
});
export const PORTAL2_ID = 7;
export const PORTAL2 = { id: PORTAL2_ID, key: 'portal', name: 'The Frozen Depths', role: 'portal', x: CAMPS[2].x, y: CAMPS[2].y };
export const DUNGEONS = [
  {
    id: 'crypt', name: 'The Sunken Crypt', theme: 'crypt', seed: DUNGEON_SEED, npcId: PORTAL_ID, portal: { x: CAMP.x, y: CAMP.y }, rec: DUNGEON_REC_LVL,
    boss: 'bonelord', bossAdds: ['wraith', 'skeleton'],
    mixes: [null, ['skeleton', 'ghoul'], ['skeleton', 'ghoul'], ['ghoul', 'wraith'], ['ghoul', 'wraith'], ['wraith', 'skeleton'], ['wraith', 'ghoul']],
  },
  {
    id: 'frozen', name: 'The Frozen Depths', theme: 'ice', seed: 4242, npcId: PORTAL2_ID, portal: { x: CAMPS[2].x, y: CAMPS[2].y }, rec: 34,
    boss: 'glacius', bossAdds: ['frostsprite', 'icegolem'],
    mixes: [null, ['frostslime', 'snowwolf'], ['snowwolf', 'frostsprite'], ['frostsprite', 'yeti'], ['yeti', 'snowwolf'], ['yeti', 'frostsprite'], ['icegolem', 'frostsprite'], ['icegolem', 'yeti'], ['yeti', 'icegolem'], ['icegolem', 'frostsprite']],
  },
];
