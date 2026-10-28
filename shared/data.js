import { TOWN, CAMP } from './world.js';

export const SEED = 20261028;
export const TICK_MS = 50;
export const MAX_LEVEL = 30;
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
  wraith: { name: 'Grave Wraith', lvl: 17, hp: 260, dmg: [30, 42], moveMs: 300, atkMs: 1400, range: 4.5, aggro: 8, leash: 12, xp: 150, gold: [18, 36], respawn: 1e9 },
  bonelord: { name: 'The Bone Lord', lvl: 24, hp: 4600, dmg: [55, 90], moveMs: 650, atkMs: 1800, range: 5.5, aggro: 12, leash: 22, xp: 3200, gold: [500, 800], respawn: 1e9, boss: true },
  golem: { name: 'Moss Golem', lvl: 20, hp: 2200, dmg: [40, 70], moveMs: 700, atkMs: 2000, range: 2.2, aggro: 9, leash: 14, xp: 1200, gold: [200, 400], respawn: 120000, boss: true },
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
