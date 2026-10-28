// Eldermoor authoritative game server: HTTP (static client) + WebSocket (game).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { W, G, TOWN, TOWNS, BOSS, BOSSES, CAMP, CAMPS, ISLANDS, inTown, generateWorld, generateDungeon, isSolid } from '../shared/world.js';
import {
  SEED, TICK_MS, INV_SIZE, MOBS, QUESTS, RARITY, NPCS,
  DUNGEONS, PORTAL, PORTAL2, EXIT_ID,
} from '../shared/data.js';
import {
  MAIN_MAX, JOB_MAX, POINTS_PER_LEVEL, JOB_SWITCH_MS, ATTRS, ATTR_BASE, WEAPON_TYPES, JOB_ORDER, JOBS, SKILLS, EFFECTS,
  mainXpNeeded, jobXpNeeded, barSlots, knownSkills, newProgress,
} from '../shared/jobs.js';
import {
  EQ_KEYS, KINDS, PALETTES, STARTER_KIT, emptyEq, eqKeyFor, defaultLook, validLook, kindName, visTokens, LOOK_COST,
} from '../shared/gear.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAVE_FILE = process.env.EM_SAVE || path.join(ROOT, 'data', 'saves.json');
const PORT = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------- helpers
const world = generateWorld(SEED);
const key = (x, y) => y * W + x;
const rand = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rand(a, b + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const face = (dx, dy) => (dy > 0 ? 0 : dy < 0 ? 1 : dx < 0 ? 2 : 3);
const INSTANCE_TTL = Number(process.env.EM_INSTANCE_TTL) || 60000;
const DEBUG = process.env.EM_DEBUG === '1'; // test-only teleport / god-mode messages

let nextId = 100;
const players = new Map(); // id -> player

// A zone is one self-contained map with its own monsters, loot and occupancy:
// the overworld, or a private dungeon instance.
function makeZone(id, kind, w) {
  return { id, kind, world: w, mobs: new Map(), drops: new Map(), occ: new Map(), npcs: [], emptyAt: 0 };
}
const overworld = makeZone('world', 'world', world);
overworld.npcs = [...NPCS, PORTAL, PORTAL2].map((n) => ({ ...n, k: 'n' }));
for (const n of overworld.npcs) overworld.occ.set(key(n.x, n.y), n);
const zones = new Map([[overworld.id, overworld]]);
const instances = new Map(); // party/solo key -> dungeon zone
let nextInstance = 1;
const npcByRole = (role) => overworld.npcs.find((n) => n.role === role);
const nearNpc = (p, n) => p.z === overworld && dist(p, n) <= 4.5;
const nearShop = (p) => (p.z === overworld ? overworld.npcs.find((n) => n.role === 'shop' && dist(p, n) <= 4.5) || null : null);

const solid = (z, x, y) => isSolid(z.world, x, y);
const place = (e) => e.z.occ.set(key(e.x, e.y), e);
const unplace = (e) => { if (e.z.occ.get(key(e.x, e.y)) === e) e.z.occ.delete(key(e.x, e.y)); };
const free = (z, x, y) => !solid(z, x, y) && !z.occ.has(key(x, y));
const safeAt = (z, x, y) => z.kind === 'world' && inTown(x, y); // monsters never enter, players can't be hurt
const mobFree = (z, x, y) => free(z, x, y) && !safeAt(z, x, y);

function nearestFree(z, x, y, ok = free, maxR = 6) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (ok(z, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- items
const ADJ = [
  ['Worn', 'Plain', 'Rusty', 'Crude'],
  ['Sturdy', 'Keen', 'Fine', 'Hardy'],
  ['Runed', 'Gleaming', 'Tempered', 'Honed'],
  ['Dragon-forged', 'Starlit', 'Voidtouched', 'Ancient'],
];
let uid = 1;
const ATTR_SUFFIX = { str: 'of Might', dex: 'of Agility', int: 'of Insight', vit: 'of Vigor', spr: 'of Grace' };
const SLOT_ODDS = [['weapon', 20], ['offhand', 8], ['head', 12], ['body', 14], ['legs', 10], ['boots', 10], ['gloves', 8], ['cape', 5], ['ring', 8], ['amulet', 5]];
function rollSlot() {
  let t = Math.random() * 100;
  for (const [slot, w] of SLOT_ODDS) if ((t -= w) < 0) return slot;
  return 'weapon';
}

/** Any wearable: base stats by slot, plus attribute affixes on rarer pieces. */
function mkGear(slot, lvl, r) {
  const m = RARITY[r].m, k = pick(KINDS[slot]);
  const sc = (f) => Math.max(1, Math.round((1 + lvl * f) * m));
  const it = { u: uid++, s: slot, r, l: lvl, b: k.b, atk: 0, def: 0, hp: 0 };
  if (k.pal) it.cl = pick(PALETTES[k.pal]);
  const a = {};
  const add = (attr, v) => { a[attr] = (a[attr] || 0) + v; };
  const r1 = (v) => Math.round(v * 10) / 10;
  switch (slot) {
    case 'weapon': it.atk = Math.max(1, Math.round((2 + lvl * 1.3) * m)); break;
    case 'offhand':
      if (k.b === 'shield') { it.def = sc(0.55); it.hp = Math.round(lvl * 1.2 * m); }
      else if (k.b === 'tome') { add('int', sc(0.25)); add('spr', sc(0.12)); }
      else { add('dex', sc(0.2)); it.crit = r1((1 + lvl * 0.08) * m); }
      break;
    case 'head': it.def = sc(0.4); it.hp = Math.round(lvl * m); break;
    case 'body': it.def = sc(0.75); it.hp = Math.round(lvl * 1.8 * Math.max(0.3, m - 0.4)); break;
    case 'legs': it.def = sc(0.5); break;
    case 'boots': it.def = sc(0.3); it.dodge = r1((0.5 + lvl * 0.05) * m); break;
    case 'gloves': it.def = sc(0.2); it.crit = r1((0.6 + lvl * 0.05) * m); break;
    case 'cape': it.def = sc(0.15); add('dex', sc(0.1)); it.dodge = r1((0.4 + lvl * 0.04) * m); break;
    case 'ring': it.hp = Math.round((6 + lvl * 2.5) * m); add(pick(ATTRS), sc(0.22)); break;
    default: it.hp = Math.round((10 + lvl * 3.5) * m); add(pick(ATTRS), sc(0.2)); add(pick(ATTRS), sc(0.14));
  }
  if (slot !== 'ring' && slot !== 'amulet') for (let i = 0; i < Math.min(r, 3); i++) add(pick(ATTRS), Math.max(1, Math.round((1 + lvl * 0.12) * m * 0.7)));
  if (Object.keys(a).length) it.a = a;
  const top = Object.entries(a).sort((x, y) => y[1] - x[1])[0];
  it.n = `${pick(ADJ[r])} ${k.n}${top && r >= 1 ? ` ${ATTR_SUFFIX[top[0]]}` : ''}`;
  const attrSum = Object.values(a).reduce((t, v) => t + v, 0);
  it.v = Math.max(1, Math.round((it.atk * 6 + it.def * 6 + it.hp * 0.8 + attrSum * 5 + ((it.crit || 0) + (it.dodge || 0)) * 8) * (1 + r * 0.5)));
  return it;
}

// What every new hero starts in (so each job looks the part from the first step).
const starterWeapon = (b) => ({ u: uid++, s: 'weapon', r: 0, l: 1, atk: 2, def: 0, hp: 0, b, n: `Apprentice ${b[0].toUpperCase()}${b.slice(1)}`, v: 5 });
function starterKit(job) {
  const eq = emptyEq();
  eq.weapon = starterWeapon(JOBS[job].start);
  for (const [slot, [b, cl]] of Object.entries(STARTER_KIT[job])) {
    eq[slot] = { u: uid++, s: slot, r: 0, l: 1, b, cl, atk: 0, def: 1, hp: 0, n: `Traveler's ${kindName(slot, b)}`, v: 3 };
  }
  return eq;
}
const POTIONS = [['Health Potion', 90, 12], ['Large Health Potion', 220, 40], ['Greater Health Potion', 600, 110], ['Supreme Health Potion', 1400, 300]];
const mkPotion = (tier = 0) => {
  const t = tier === true ? 1 : Math.max(0, Math.min(3, tier || 0));
  const [n, heal, v] = POTIONS[t];
  return { u: uid++, s: 'potion', r: t, l: 1, b: 'potion', n, heal, c: 1, v };
};
const potionTier = (lvl) => (lvl > 45 ? 3 : lvl > 28 ? 2 : lvl > 8 && Math.random() < 0.5 ? 1 : 0);

function rollRarity(lvl, boss) {
  if (boss) return Math.random() < 0.3 ? 3 : 2;
  const w = [70, 22 + lvl * 0.5, 7 + lvl * 0.4, 1 + lvl * 0.12];
  let t = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 4; i++) { if ((t -= w[i]) < 0) return i; }
  return 0;
}

function addItem(p, item) {
  if (item.s === 'potion') {
    const st = p.inv.find((i) => i && i.s === 'potion' && i.n === item.n && i.c < 20);
    if (st) { st.c += item.c || 1; return true; }
  }
  const i = p.inv.indexOf(null);
  if (i < 0) return false;
  p.inv[i] = item;
  return true;
}

const shopGear = (slot, lvl, b, n, cl, price) => ({ ...mkGear(slot, lvl, 0), b, n, cl, price });
const SHOP = [
  { ...mkPotion(false), price: 25 },
  { ...mkPotion(true), price: 80 },
  shopGear('weapon', 4, 'sword', "Traveler's Blade", undefined, 120),
  shopGear('body', 4, 'vest', 'Leather Vest', '#8a5a2a', 110),
  shopGear('head', 4, 'cap', "Traveler's Cap", '#3a5aa0', 60),
  shopGear('legs', 4, 'pants', 'Wanderer Trousers', '#6a4a2a', 70),
  shopGear('boots', 4, 'boots', 'Sturdy Boots', '#5a3a22', 70),
  shopGear('gloves', 4, 'gloves', 'Work Gloves', '#8a5a2a', 60),
  shopGear('cape', 4, 'cloak', "Traveler's Cloak", '#3f7a3f', 90),
  shopGear('offhand', 4, 'shield', 'Wooden Buckler', '#8a5a2a', 100),
  shopGear('offhand', 4, 'tome', 'Apprentice Tome', '#8a3a3a', 130),
  shopGear('ring', 4, 'ring', 'Copper Ring', '#ff8a2a', 150),
  shopGear('head', 6, 'horns', 'Horned Helm', '#aab2c0', 260),
  shopGear('head', 6, 'circlet', 'Silver Circlet', '#e8c04a', 300),
  shopGear('weapon', 10, 'bow', 'Ranger Longbow', undefined, 600),
  shopGear('weapon', 10, 'sword', 'Knight Longsword', undefined, 600),
  shopGear('weapon', 10, 'staff', 'Adept Staff', undefined, 600),
  shopGear('weapon', 10, 'dagger', 'Rogue Stiletto', undefined, 600),
  shopGear('weapon', 10, 'wand', 'Hexer Wand', undefined, 600),
];

// Higher-level towns stock better gear and stronger potions.
function shopStock(lvl, tier) {
  const priced = (it) => ({ ...it, price: Math.max(20, Math.round((it.v || 10) * 3)) });
  const slots = ['weapon', 'weapon', 'body', 'head', 'legs', 'boots', 'gloves', 'cape', 'offhand', 'ring', 'amulet'];
  return [priced(mkPotion(tier - 1)), priced(mkPotion(tier)), ...slots.map((sl) => priced(mkGear(sl, lvl, 1)))];
}
const SHOP_BY = new Map([[2, SHOP], [10, shopStock(22, 2)], [13, shopStock(32, 2)], [16, shopStock(44, 3)]]);

// ---------------------------------------------------------------- persistence
let saves = {};
try { saves = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); } catch { /* fresh world */ }
let savesDirty = false;
function writeSaves() {
  if (!savesDirty) return;
  savesDirty = false;
  fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
  const tmp = SAVE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(saves));
  fs.renameSync(tmp, SAVE_FILE);
}
function savePlayer(p) {
  saves[p.name.toLowerCase()] = {
    v: 3, look: p.look, name: p.name, salt: p.salt, hash: p.hash, job: p.job, jobs: p.jobs, attr: p.attr, points: p.points, bar: p.bar, lvl: p.lvl, xp: p.xp, gold: p.gold,
    inv: p.inv, eq: p.eq, quest: p.quest, x: (p.z && p.z.kind !== 'world' ? p.ret : p).x, y: (p.z && p.z.kind !== 'world' ? p.ret : p).y, hp: p.hp,
  };
  savesDirty = true;
}
// Old saves are upgraded in steps: v1 (class + level) -> v2 (jobs/attributes) -> v3 (11 gear slots + looks).
function migrateItem(it) {
  if (!it) return it;
  const o = { ...it };
  if (o.s === 'armor') { o.s = 'body'; o.b = 'vest'; }
  else if (o.s === 'trinket') o.s = o.b === 'ring' ? 'ring' : 'amulet';
  return o;
}
function migrate(save) {
  let o = { ...save };
  if (!(o.v >= 2)) {
    const job = JOBS[o.cls] ? o.cls : 'warrior';
    const np = newProgress(job);
    np.jobs[job] = { lvl: Math.max(1, Math.min(JOB_MAX, Math.ceil((o.lvl || 1) / 2))), xp: 0 };
    np.points = POINTS_PER_LEVEL * (o.lvl || 1);
    o = { ...o, ...np, v: 2 };
  }
  if (!(o.v >= 3)) {
    const eq = emptyEq();
    for (const [k, it] of Object.entries(o.eq || {})) {
      const mi = migrateItem(it);
      if (!mi) continue;
      const key = k === 'armor' ? 'body' : k === 'trinket' ? eqKeyFor(eq, mi) : k;
      if (key && key in eq) eq[key] = mi;
    }
    o.eq = eq;
    o.inv = (o.inv || []).map(migrateItem);
    o.look = o.look || defaultLook(o.name);
    o.v = 3;
  }
  return o;
}
const hashPass = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');

// ---------------------------------------------------------------- networking helpers
const send = (p, o) => { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); };
const log = (p, m, c = '#ddd') => send(p, { t: 'log', m, c });
function emit(z, x, y, ev) {
  const s = JSON.stringify({ t: 'ev', ...ev });
  for (const p of players.values()) {
    if (p.z === z && Math.abs(p.x - x) < 32 && Math.abs(p.y - y) < 22 && p.ws.readyState === 1) p.ws.send(s);
  }
}
const sayAll = (m, c) => { for (const p of players.values()) log(p, m, c); };

// ---------------------------------------------------------------- players
// ---------------------------------------------------------------- stats, effects, progression
const hasFx = (t, id) => { const f = t.fx && t.fx[id]; return f && f.until > Date.now() ? f : null; };
const activeFx = (t) => {
  const now = Date.now(), out = [];
  for (const id in t.fx || {}) { const f = t.fx[id]; if (f.until > now) out.push({ id, ms: f.until - now, pow: Math.round(f.pow * 100) / 100 }); }
  return out;
};
const fxIds = (t) => { const now = Date.now(), out = []; for (const id in t.fx || {}) if (t.fx[id].until > now) out.push(id); return out; };

function addFx(t, id, ms, pow = 0, src = 0) {
  const now = Date.now();
  if (!t.fx) t.fx = {};
  const cur = t.fx[id];
  if (id === 'shield') t.fx[id] = { until: now + ms, pow: pow + (cur && cur.until > now ? cur.pow : 0), src };
  else t.fx[id] = { until: now + ms, pow, src, next: now + 1000 };
  if (id === 'stun') t.stunUntil = Math.max(t.stunUntil || 0, now + ms);
  if (id === 'slow' || id === 'root') t.slowUntil = Math.max(t.slowUntil || 0, now + ms);
  if (t.k === 'p') { computeStats(t); t.dirty = true; }
}

function computeStats(p) {
  const J = JOBS[p.job], jl = Math.max(1, p.jobs[p.job].lvl);
  const A = {};
  for (const k of ATTRS) A[k] = ATTR_BASE + (p.attr[k] || 0) + Math.floor(jl * ((J.growth && J.growth[k]) || 0));
  let gatk = 0, gdef = 0, ghp = 0, gcrit = 0, gdodge = 0;
  for (const it of Object.values(p.eq)) {
    if (!it) continue;
    gatk += it.atk || 0; gdef += it.def || 0; ghp += it.hp || 0; gcrit += it.crit || 0; gdodge += it.dodge || 0;
    if (it.a) for (const k of ATTRS) A[k] += it.a[k] || 0;
  }
  const wt = WEAPON_TYPES[p.eq.weapon ? p.eq.weapon.b : 'none'] || WEAPON_TYPES.none;
  const atkUp = hasFx(p, 'atkUp'), defUp = hasFx(p, 'defUp'), haste = hasFx(p, 'haste'), slow = hasFx(p, 'slow'), dodgeFx = hasFx(p, 'dodge');
  const hasteMul = 1 + A.dex * 0.003 + (haste ? haste.pow : 0);
  const mh = Math.round((80 + p.lvl * 12 + A.vit * 9 + ghp) * J.hpMul);
  const def = (p.lvl + A.vit * 0.5 + gdef) * J.defMul * (1 + (defUp ? defUp.pow : 0));
  p.st = {
    A, wAtk: gatk, wt, mh, def, mres: A.spr * 0.9 + def * 0.3,
    dmgMul: (1 + (atkUp ? atkUp.pow : 0)) * (p.dbgMul || 1),
    crit: 5 + A.dex * 0.25 + gcrit + (J.critAdd || 0),
    critDmg: 1.8 + (J.critDmg || 0),
    dodge: Math.min(95, A.dex * 0.15 + gdodge + (J.dodgeAdd || 0) + (dodgeFx ? dodgeFx.pow * 100 : 0)),
    haste: hasteMul, range: wt.range, atkMs: wt.ms / hasteMul,
    moveMul: Math.max(0.4, 1 + (haste ? haste.pow : 0) + (J.moveHaste || 0) - (slow ? slow.pow : 0)),
    healPow: (A.spr * 1.2 + A.int * 0.3 + p.lvl) * (J.healMul || 1),
    magMul: J.magMul || 1, lifesteal: J.lifesteal || 0, threat: p.job === 'warrior' ? 1.6 : p.job === 'rogue' ? 0.85 : 1,
  };
  if (p.god) { p.st.def += 1e6; p.st.mres += 1e6; p.st.mh += 1e5; }
  if (p.hp > p.st.mh) p.hp = p.st.mh;
}
const power = (p, scale) => (4 + p.st.A[scale] * 0.6 + p.st.wAtk * 0.8 + p.lvl * 0.8) * p.st.dmgMul;

const meMsg = (p) => ({
  t: 'me', id: p.id, name: p.name, look: p.look, job: p.job, jobs: p.jobs, attr: p.attr, points: p.points, bar: p.bar, slots: barSlots(p.lvl),
  lvl: p.lvl, xp: p.xp, xpn: p.lvl >= MAIN_MAX ? 0 : mainXpNeeded(p.lvl), jxpn: p.jobs[p.job].lvl >= JOB_MAX ? 0 : jobXpNeeded(p.jobs[p.job].lvl),
  hp: p.hp, mh: p.st.mh, gold: p.gold, inv: p.inv, eq: p.eq, quest: p.quest,
  st: {
    A: p.st.A, atk: Math.round(power(p, p.st.wt.scale)), def: Math.round(p.st.def), mres: Math.round(p.st.mres), crit: Math.round(p.st.crit * 10) / 10,
    critDmg: Math.round(p.st.critDmg * 100), dodge: Math.round(p.st.dodge * 10) / 10, haste: Math.round(p.st.haste * 100), range: p.st.range,
    heal: Math.round(p.st.healPow), atkMs: Math.round(p.st.atkMs), wt: p.eq.weapon ? p.eq.weapon.b : 'none',
  },
  fx: activeFx(p), tg: p.target, jobWait: Math.max(0, (p.jobSwitchAt || 0) - Date.now()),
});

function login(ws, m) {
  const name = String(m.name || '').trim();
  if (!/^[A-Za-z0-9_ ]{3,14}$/.test(name)) return send({ ws }, { t: 'err', m: 'Name must be 3-14 letters, numbers, spaces or _' });
  const pass = String(m.pass || '').slice(0, 64);
  const k = name.toLowerCase();
  const saved = saves[k];
  let p;
  if (saved) {
    if (hashPass(pass, saved.salt) !== saved.hash) return send({ ws }, { t: 'err', m: 'Wrong secret word for that hero.' });
    p = { ...migrate(saved), buffs: {}, cd: {}, fx: {} };
  } else {
    const job = JOBS[m.cls] ? m.cls : 'warrior';
    const salt = crypto.randomBytes(8).toString('hex');
    const inv = Array(INV_SIZE).fill(null);
    inv[0] = { ...mkPotion(false), c: 3 };
    p = {
      ...newProgress(job), v: 3, look: validLook(m.look) || defaultLook(name), name, salt, hash: hashPass(pass, salt), lvl: 1, xp: 0, gold: 20, inv,
      eq: starterKit(job), quest: { i: 0, s: 0, p: 0 },
      x: 0, y: 0, hp: 1, buffs: {}, cd: {}, fx: {},
    };
  }
  for (const old of players.values()) if (old.name.toLowerCase() === k) { old.ws.close(4000, 'Logged in elsewhere'); dropPlayer(old); }
  p.id = nextId++; p.k = 'p'; p.ws = ws; p.f = 0; p.dead = false; p.target = null;
  p.moveAt = 0; p.atkAt = 0; p.potAt = 0; p.want = null; p.lastHit = 0; p.regenAt = 0; p.dirty = true; p.msgs = 0;
  p.chatAt = 0; p.gcdAt = 0; p.jobSwitchAt = 0; p.stunUntil = 0; p.party = 0; p.invite = null; p.invAt = 0; p.trade = 0; p.tradeInv = null; p.trAt = 0;
  computeStats(p);
  fillBar(p);
  p.knownSeen = new Set(knownOf(p));
  if (!saved) p.hp = p.st.mh;
  p.z = overworld; p.ret = { x: CAMP.x, y: CAMP.y + 2 };
  const spot = nearestFree(overworld, saved ? p.x : world.spawn.x, saved ? p.y : world.spawn.y) || nearestFree(overworld, world.spawn.x, world.spawn.y);
  p.x = spot.x; p.y = spot.y;
  if (p.hp <= 0) p.hp = p.st.mh;
  place(p);
  players.set(p.id, p);
  ws.player = p;
  send(p, {
    t: 'welcome', id: p.id, seed: SEED, zone: zoneMsg(overworld),
    classes: JOB_ORDER,
  });
  send(p, meMsg(p));
  log(p, `Welcome to Eldermoor, ${p.name}.`, '#ffe066');
  sayAll(`${p.name} the ${JOBS[p.job].name} has arrived.`, '#9fd0ff');
  savePlayer(p);
}

// ---------------------------------------------------------------- parties
const MAX_PARTY = 4;
const parties = new Map(); // id -> { id, leader, members:Set<playerId> }
let nextParty = 1;
const partyOf = (p) => (p.party ? parties.get(p.party) : null);
const partyMsg = (pt) => ({
  t: 'party', id: pt ? pt.id : 0, leader: pt ? pt.leader : 0,
  members: pt ? [...pt.members].map((id) => players.get(id)).filter(Boolean).map((q) => ({ id: q.id, name: q.name, cls: q.cls, lvl: q.lvl })) : [],
});
function pushParty(pt) {
  const msg = partyMsg(pt);
  for (const id of pt.members) { const q = players.get(id); if (q) send(q, msg); }
}
function leaveParty(p, why = 'left the party') {
  const pt = partyOf(p);
  if (!pt) return;
  pt.members.delete(p.id); p.party = 0;
  send(p, partyMsg(null));
  if (pt.members.size < 2) {
    for (const id of pt.members) { const q = players.get(id); if (q) { q.party = 0; send(q, partyMsg(null)); log(q, `${p.name} ${why}. The party disbanded.`, '#9fd0ff'); } }
    parties.delete(pt.id);
    return;
  }
  if (pt.leader === p.id) pt.leader = pt.members.values().next().value;
  for (const id of pt.members) { const q = players.get(id); if (q) log(q, `${p.name} ${why}.`, '#9fd0ff'); }
  pushParty(pt);
}
function partyTick() {
  for (const pt of parties.values()) {
    const m = [...pt.members].map((id) => players.get(id)).filter(Boolean).map((q) => ({ id: q.id, h: q.hp, mh: q.st.mh, x: q.x, y: q.y, z: q.z.id }));
    for (const id of pt.members) { const q = players.get(id); if (q) send(q, { t: 'pm', m }); }
  }
}
const findPlayer = (name) => [...players.values()].find((q) => q.name.toLowerCase() === String(name || '').trim().toLowerCase());
function partyInvite(p, name, now) {
  if (now - (p.invAt || 0) < 2000) return;
  p.invAt = now;
  const t = findPlayer(name);
  if (!t) return log(p, 'No hero by that name is online.', '#ff8a8a');
  if (t === p) return log(p, "You can't invite yourself.", '#ff8a8a');
  const mine = partyOf(p);
  if (mine && mine.leader !== p.id) return log(p, 'Only the party leader can invite.', '#ff8a8a');
  if (mine && mine.members.size >= MAX_PARTY) return log(p, 'Your party is full.', '#ff8a8a');
  if (t.party) return log(p, `${t.name} is already in a party.`, '#ff8a8a');
  if (t.invite && t.invite.until > now) return log(p, `${t.name} already has a pending invite.`, '#ff8a8a');
  t.invite = { from: p.id, until: now + 30000 };
  send(t, { t: 'pinv', from: p.id, name: p.name });
  log(p, `Invited ${t.name} to your party.`, '#9fd0ff');
}
function partyAnswer(p, ok, now) {
  const inv = p.invite;
  p.invite = null;
  if (!inv || inv.until < now) return log(p, 'That invite has expired.', '#ff8a8a');
  const from = players.get(inv.from);
  if (!from) return log(p, 'The inviter is gone.', '#ff8a8a');
  if (!ok) return log(from, `${p.name} declined your invite.`, '#9fd0ff');
  if (p.party) return;
  let pt = partyOf(from);
  if (pt && pt.members.size >= MAX_PARTY) return log(p, 'That party is full.', '#ff8a8a');
  if (!pt) {
    pt = { id: nextParty++, leader: from.id, members: new Set([from.id]) };
    parties.set(pt.id, pt); from.party = pt.id;
  }
  pt.members.add(p.id); p.party = pt.id;
  for (const id of pt.members) { const q = players.get(id); if (q) log(q, `${p.name} joined the party.`, '#9fd0ff'); }
  pushParty(pt);
}

function dropPlayer(p) {
  if (!players.has(p.id)) return;
  leaveParty(p, 'disconnected');
  { const tr = tradeOf(p); if (tr) endTrade(tr, `${p.name} disconnected`); }
  savePlayer(p);
  writeSaves();
  unplace(p);
  players.delete(p.id);
  for (const m of p.z.mobs.values()) if (m.target === p.id) m.target = null;
  sayAll(`${p.name} has left.`, '#888');
}

function tryMove(p, dx, dy, now) {
  p.f = face(dx, dy);
  const nx = p.x + dx, ny = p.y + dy;
  if (!free(p.z, nx, ny)) return false;
  unplace(p); p.x = nx; p.y = ny; place(p);
  p.moveAt = now + 150 / p.st.moveMul;
  for (const d of p.z.drops.values()) if (d.x === nx && d.y === ny) pickup(p, d);
  return true;
}

function pickup(p, d) {
  if (d.gold) {
    p.gold += d.gold;
    log(p, `+${d.gold} gold`, '#ffd23a');
  } else if (addItem(p, d.item)) {
    log(p, `You pick up ${d.item.n}.`, RARITY[d.item.r].c);
  } else {
    return log(p, 'Your pack is full.', '#ff8a8a');
  }
  p.z.drops.delete(d.id);
  p.dirty = true;
  send(p, { t: 'ev', e: 'pickup' });
}

// ---- progression: main level + job levels; skills learned by any job work in any slot
const knownOf = (p) => knownSkills(p.jobs);
function fillBar(p) {
  const known = knownOf(p), slots = barSlots(p.lvl);
  for (let i = 0; i < 6; i++) if (i >= slots || (p.bar[i] && !known.includes(p.bar[i]))) p.bar[i] = null;
  const pool = [...known.filter((id) => SKILLS[id].job === p.job), ...known.filter((id) => SKILLS[id].job !== p.job)];
  for (let i = 0; i < slots; i++) {
    if (p.bar[i]) continue;
    const nxt = pool.find((id) => !p.bar.includes(id));
    if (nxt) p.bar[i] = nxt;
  }
}

function giveXp(p, amount, jobAmount = amount * 0.8) {
  const J = p.jobs[p.job];
  let leveled = false;
  if (J.lvl < JOB_MAX) {
    J.xp += Math.round(jobAmount);
    while (J.lvl < JOB_MAX && J.xp >= jobXpNeeded(J.lvl)) { J.xp -= jobXpNeeded(J.lvl); J.lvl++; leveled = true; log(p, `${JOBS[p.job].name} reached job level ${J.lvl}!`, '#ffd23a'); }
    if (J.lvl >= JOB_MAX) J.xp = 0;
  }
  if (p.lvl < MAIN_MAX) {
    p.xp += Math.round(amount);
    let up = false;
    while (p.lvl < MAIN_MAX && p.xp >= mainXpNeeded(p.lvl)) { p.xp -= mainXpNeeded(p.lvl); p.lvl++; p.points += POINTS_PER_LEVEL; up = true; }
    if (p.lvl >= MAIN_MAX) p.xp = 0;
    if (up) {
      computeStats(p);
      p.hp = p.st.mh;
      emit(p.z, p.x, p.y, { e: 'fx', k: 'levelup', x: p.x, y: p.y, id: p.id });
      log(p, `Level up! You are now level ${p.lvl}. (+${POINTS_PER_LEVEL} attribute points)`, '#ffe066');
      sayAll(`${p.name} reached level ${p.lvl}!`, '#ffe066');
    }
  }
  if (leveled) computeStats(p);
  fillBar(p);
  for (const id of knownOf(p)) if (!p.knownSeen.has(id)) { p.knownSeen.add(id); log(p, `Learned skill: ${SKILLS[id].name}!`, '#8be88b'); }
  p.dirty = true;
}

function switchJob(p, id, now) {
  if (!JOBS[id] || id === p.job) return;
  if (now < (p.jobSwitchAt || 0)) return log(p, `You can change jobs again in ${Math.ceil((p.jobSwitchAt - now) / 1000)}s.`, '#ff8a8a');
  if (now - p.lastHit < 5000) return log(p, "You can't change jobs in the middle of a fight.", '#ff8a8a');
  p.job = id;
  if (p.jobs[id].lvl < 1) p.jobs[id] = { lvl: 1, xp: 0 };
  p.jobSwitchAt = now + JOB_SWITCH_MS;
  computeStats(p);
  fillBar(p);
  for (const sid of knownOf(p)) p.knownSeen.add(sid);
  p.dirty = true;
  emit(p.z, p.x, p.y, { e: 'fx', k: 'heal', x: p.x, y: p.y, id: p.id });
  log(p, `You are now a ${JOBS[id].name} (job level ${p.jobs[id].lvl}). Your learned skills come with you.`, '#c06bff');
}
function setBar(p, slot, skill) {
  if (slot < 0 || slot >= barSlots(p.lvl)) return;
  if (skill !== null && skill !== undefined && !knownOf(p).includes(skill)) return;
  const sk = skill || null;
  const at = sk ? p.bar.indexOf(sk) : -1;
  if (at >= 0) p.bar[at] = p.bar[slot]; // dropping an equipped skill on another slot swaps them
  p.bar[slot] = sk;
  p.dirty = true;
}

// ---- timers (delayed telegraphed hits)
const timers = [];
const schedule = (ms, fn) => timers.push({ at: Date.now() + ms, fn });
function runTimers(now) {
  for (let i = timers.length - 1; i >= 0; i--) {
    if (timers[i].at > now) continue;
    const t = timers.splice(i, 1)[0];
    try { t.fn(); } catch (e) { console.error('timer', e); }
  }
}

// ---- damage and healing
function healPlayer(t, amt, src) {
  if (t.dead) return 0;
  amt = Math.round(Math.min(amt, t.st.mh - t.hp));
  if (amt <= 0) return 0;
  t.hp += amt; t.dirty = true;
  emit(t.z, t.x, t.y, { e: 'dmg', x: t.x, y: t.y, v: amt, k: 'h', id: t.id });
  if (src && src.k === 'p') for (const m of t.z.mobs.values()) if (!m.dead && m.threat.has(t.id)) m.threat.set(src.id, (m.threat.get(src.id) || 0) + amt * 0.5);
  return amt;
}

function applyMobDamage(p, m, amt, crit, kind, threatMul = 1) {
  if (m.dead) return;
  m.hp -= amt;
  m.dmgBy.set(p.id, (m.dmgBy.get(p.id) || 0) + amt);
  m.threat.set(p.id, (m.threat.get(p.id) || 0) + amt * threatMul);
  emit(m.z, m.x, m.y, { e: 'dmg', x: m.x, y: m.y, v: amt, k: crit ? 'c' : kind === 'd' ? 'd' : 'm', id: m.id });
  if (m.hp <= 0) killMob(m, p);
}

/** one hit from a player: crit, vulnerability, lifesteal and threat all live here */
function hitMob(p, m, base, o = {}) {
  if (m.dead) return 0;
  const crit = Math.random() * 100 < p.st.crit;
  let dmg = base * (crit ? p.st.critDmg : 1);
  const v = hasFx(m, 'vuln');
  if (v) dmg *= 1 + v.pow;
  dmg = Math.max(1, Math.round(dmg));
  applyMobDamage(p, m, dmg, crit, null, p.st.threat);
  const ls = (p.st.lifesteal || 0) + (o.leech || 0);
  if (ls > 0) healPlayer(p, dmg * ls, p);
  return dmg;
}

function tickFx(t, now) {
  if (!t.fx) return;
  let changed = false;
  for (const id in t.fx) {
    const f = t.fx[id];
    if (f.until <= now) { delete t.fx[id]; changed = true; continue; }
    if (f.next === undefined || now < f.next) continue;
    f.next = now + 1000;
    if (EFFECTS[id].dot) {
      if (t.k === 'm') {
        const src = players.get(f.src);
        if (src) applyMobDamage(src, t, Math.max(1, Math.round(f.pow)), false, 'd', 0.5);
        else { t.hp -= Math.max(1, Math.round(f.pow)); if (t.hp <= 0) killMob(t, { id: 0, name: 'the elements' }); }
      } else hurtPlayer(t, f.pow, EFFECTS[id].name, { noDodge: true, mag: true });
    } else if (id === 'regen' && t.k === 'p') healPlayer(t, f.pow, players.get(f.src) || t);
  }
  if (changed && t.k === 'p') { computeStats(t); t.dirty = true; }
}

function hurtPlayer(p, raw, from, o = {}) {
  if (p.dead) return;
  if (hasFx(p, 'invuln')) return emit(p.z, p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: 0, k: 'x', id: p.id });
  if (!o.noDodge && Math.random() * 100 < p.st.dodge) return emit(p.z, p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: 0, k: 'x', id: p.id });
  const res = o.mag ? p.st.mres : p.st.def;
  let amt = Math.max(1, Math.round(raw * (1 - res / (res + 40 + p.lvl * 2))));
  const sh = hasFx(p, 'shield');
  if (sh) {
    const ab = Math.min(sh.pow, amt);
    sh.pow -= ab; amt -= ab;
    if (sh.pow <= 0) delete p.fx.shield;
    p.dirty = true;
    if (amt <= 0) return emit(p.z, p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: 0, k: 'a', id: p.id });
  }
  p.hp -= amt;
  p.lastHit = Date.now();
  emit(p.z, p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: amt, k: 'p', id: p.id });
  p.dirty = true;
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.respawnAt = Date.now() + 4000; p.target = null; p.want = null; p.fx = {}; p.deathAt = { x: p.x, y: p.y, z: p.z };
    { const tr = tradeOf(p); if (tr) endTrade(tr, `${p.name} died`); }
    emit(p.z, p.x, p.y, { e: 'fx', k: 'die', x: p.x, y: p.y, id: p.id });
    log(p, `You were slain by ${from}. Returning to town...`, '#ff6a6a');
  }
}

function respawn(p) {
  unplace(p);
  const left = p.z !== overworld;
  p.z = overworld; // dying in an instance sends you back to town
  const from = p.deathAt && p.deathAt.z === overworld ? p.deathAt : world.spawn;
  const town = [...TOWNS].sort((a, b) => Math.hypot(a.cx - from.x, a.cy - from.y) - Math.hypot(b.cx - from.x, b.cy - from.y))[0];
  const s = nearestFree(overworld, town.cx, town.cy + 3);
  p.x = s.x; p.y = s.y; place(p);
  if (left) send(p, zoneMsg(overworld));
  p.dead = false; p.hp = p.st.mh; p.dirty = true;
  emit(p.z, p.x, p.y, { e: 'fx', k: 'heal', x: p.x, y: p.y, id: p.id });
}

// ---------------------------------------------------------------- mobs
function spawnMob(z, type, x, y) {
  const def = MOBS[type];
  const lvl = def.boss ? def.lvl : Math.max(1, def.lvl + ri(-1, 1));
  const m = {
    id: nextId++, k: 'm', z, type, x, y, hx: x, hy: y, f: 0, lvl,
    mh: Math.round(def.hp * (1 + (lvl - def.lvl) * 0.12)), hp: 0, target: null, returning: false,
    moveAt: 0, atkAt: 0, wanderAt: 0, stunUntil: 0, slowUntil: 0, dead: false, respawnAt: 0, dmgBy: new Map(), threat: new Map(), fx: {}, specAt: {}, owner: 0,
  };
  m.hp = m.mh;
  z.mobs.set(m.id, m);
  place(m);
  return m;
}

function populate() {
  const around = (type, n, cx, cy, r0, r1, grounds) => {
    let made = 0, tries = 0;
    while (made < n && tries++ < n * 60) {
      const a = Math.random() * Math.PI * 2, r = rand(r0, r1);
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (!mobFree(overworld, x, y)) continue;
      if (grounds && !grounds.includes(world.g[key(x, y)])) continue;
      if (world.g[key(x, y)] === G.PATH && Math.random() < 0.7) continue;
      spawnMob(overworld, type, x, y); made++;
    }
  };
  around('slime', 40, TOWN.cx, TOWN.cy, 15, 30, [G.GRASS, G.FOREST]);
  around('wolf', 30, TOWN.cx, TOWN.cy, 26, 42, [G.FOREST, G.GRASS]);
  around('bat', 16, TOWN.cx, TOWN.cy, 32, 54, [G.FOREST, G.SWAMP]);
  around('goblin', 28, TOWN.cx, TOWN.cy, 34, 52, [G.FOREST, G.SWAMP]);
  around('skeleton', 16, CAMP.x, CAMP.y, 0, 13);
  around('skeleton', 10, BOSS.x, BOSS.y, 11, 20);
  const b = nearestFree(overworld, BOSS.x, BOSS.y, mobFree);
  spawnMob(overworld, 'golem', b.x, b.y);

  // Sunscar Dunes
  const [, ne, sw, se] = ISLANDS;
  around('scarab', 36, ne.cx, ne.cy, 14, 32, [G.DUNE]);
  around('scorpion', 30, ne.cx, ne.cy, 18, 40, [G.DUNE]);
  around('sandviper', 24, ne.cx, ne.cy, 22, 46, [G.DUNE, G.SAND]);
  around('mummy', 24, ne.cx, ne.cy, 32, 56);
  around('sandgolem', 12, ne.cx, ne.cy, 38, 56);
  around('mummy', 8, CAMPS[1].x, CAMPS[1].y, 0, 9);
  around('sandgolem', 6, BOSSES[1].x, BOSSES[1].y, 11, 18);
  // Frostmarch
  around('frostslime', 34, sw.cx, sw.cy, 14, 32, [G.SNOW, G.ICE]);
  around('snowwolf', 30, sw.cx, sw.cy, 18, 40, [G.SNOW, G.ICE]);
  around('frostowl', 16, sw.cx, sw.cy, 20, 50);
  around('frostsprite', 22, sw.cx, sw.cy, 26, 46);
  around('yeti', 22, sw.cx, sw.cy, 30, 54);
  around('icegolem', 12, sw.cx, sw.cy, 36, 56);
  around('yeti', 8, CAMPS[2].x, CAMPS[2].y, 0, 9);
  around('icegolem', 6, BOSSES[2].x, BOSSES[2].y, 11, 18);
  // Cinderpeak
  around('imp', 34, se.cx, se.cy, 14, 32, [G.BASALT, G.ASH]);
  around('magmaslime', 28, se.cx, se.cy, 18, 38, [G.BASALT, G.ASH]);
  around('lavahound', 24, se.cx, se.cy, 22, 46, [G.BASALT, G.ASH]);
  around('emberknight', 22, se.cx, se.cy, 30, 52, [G.BASALT, G.ASH]);
  around('fireelem', 18, se.cx, se.cy, 30, 54, [G.BASALT, G.ASH]);
  around('obsidiangolem', 12, se.cx, se.cy, 38, 56);
  around('emberknight', 8, CAMPS[3].x, CAMPS[3].y, 0, 9);
  around('obsidiangolem', 6, BOSSES[3].x, BOSSES[3].y, 11, 18);
  for (const bs of BOSSES.slice(1)) {
    const spot = nearestFree(overworld, bs.x, bs.y, mobFree);
    if (spot) spawnMob(overworld, bs.mob, spot.x, spot.y);
  }
}

function stepMob(m, tx, ty, now) {
  const def = MOBS[m.type];
  const dx = Math.sign(tx - m.x), dy = Math.sign(ty - m.y);
  const horizFirst = Math.abs(tx - m.x) >= Math.abs(ty - m.y);
  const tries = horizFirst ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
  const side = Math.random() < 0.5 ? 1 : -1;
  tries.push(horizFirst ? [0, side] : [side, 0]);
  for (const [sx, sy] of tries) {
    if ((sx || sy) && mobFree(m.z, m.x + sx, m.y + sy)) {
      unplace(m); m.x += sx; m.y += sy; place(m); m.f = face(sx, sy);
      m.moveAt = now + def.moveMs * (m.slowUntil > now ? 1.7 : 1);
      return true;
    }
  }
  m.moveAt = now + 200;
  return false;
}

function mobAI(m, now) {
  const def = MOBS[m.type];
  if (m.dead) {
    if (now >= m.respawnAt) {
      const s = nearestFree(m.z, m.hx, m.hy, mobFree, 3);
      if (!s) { m.respawnAt = now + 2000; return; }
      m.x = s.x; m.y = s.y; m.hp = m.mh; m.dead = false; m.target = null; m.dmgBy.clear(); m.threat.clear(); m.fx = {}; m.stunUntil = 0; m.slowUntil = 0; place(m);
    }
    return;
  }
  const fear = hasFx(m, 'fear');
  if (fear) {
    const src = players.get(fear.src);
    if (src && now >= m.moveAt) stepMob(m, m.x * 2 - src.x, m.y * 2 - src.y, now);
    return;
  }
  if (now < m.stunUntil) return;
  // threat table: the highest valid threat is the target; proximity only starts a fight
  let t = null;
  if (m.threat.size) {
    let best = 0;
    for (const [pid, th] of m.threat) {
      const q = players.get(pid);
      if (!q || q.dead || q.z !== m.z || safeAt(m.z, q.x, q.y) || dist(m, q) > def.leash + 6) { m.threat.delete(pid); continue; }
      if (th > best) { best = th; t = q; }
    }
    if (!t) { m.target = null; m.returning = true; }
  }
  if (t && Math.hypot(m.x - m.hx, m.y - m.hy) > def.leash + 10) { t = null; m.threat.clear(); m.target = null; m.returning = true; }
  if (!t && !m.returning) {
    let best = null, bd = def.aggro;
    for (const p of players.values()) {
      if (p.z !== m.z || p.dead || safeAt(m.z, p.x, p.y)) continue;
      const d = dist(m, p);
      if (d <= bd) { bd = d; best = p; }
    }
    if (best) { t = best; m.threat.set(best.id, 1); }
  }
  m.target = t ? t.id : null;
  if (t) {
    const d = dist(m, t);
    if (def.specials && mobSpecial(m, t, now)) return;
    m.f = Math.abs(t.x - m.x) >= Math.abs(t.y - m.y) ? (t.x > m.x ? 3 : 2) : (t.y > m.y ? 0 : 1);
    if (d <= def.range + 0.05) {
      if (now >= m.atkAt) {
        m.atkAt = now + def.atkMs;
        const raw = ri(def.dmg[0], def.dmg[1]) * (1 + (m.lvl - def.lvl) * 0.1);
        emit(m.z, m.x, m.y, { e: 'fx', k: def.range > 2.5 ? 'arrow' : 'swing', x: m.x, y: m.y, tx: t.x, ty: t.y, id: m.id });
        hurtPlayer(t, raw, def.name, { mag: !!def.mag });
        if (def.onhit && !t.dead && Math.random() < 0.6) {
          for (const [fid, ms, pow] of def.onhit) addFx(t, fid, ms, EFFECTS[fid].dot ? pow * ((def.dmg[0] + def.dmg[1]) / 2) : pow, m.id);
        }
      }
    } else if (now >= m.moveAt) {
      stepMob(m, t.x, t.y, now);
    }
  } else if (m.returning) {
    if (Math.hypot(m.x - m.hx, m.y - m.hy) < 1.5) { m.returning = false; m.hp = m.mh; m.threat.clear(); m.fx = {}; }
    else if (now >= m.moveAt) stepMob(m, m.hx, m.hy, now);
  } else if (now >= m.wanderAt) {
    m.wanderAt = now + rand(2000, 6000);
    const sx = pick([-1, 0, 1]), sy = sx ? 0 : pick([-1, 1]);
    const nx = m.x + sx, ny = m.y + sy;
    if (Math.hypot(nx - m.hx, ny - m.hy) <= 5 && mobFree(m.z, nx, ny)) {
      unplace(m); m.x = nx; m.y = ny; place(m); m.f = face(sx, sy);
    }
  }
}

function dropLoot(m) {
  const def = MOBS[m.type];
  const put = (item, gold) => {
    const s = nearestFree(m.z, m.x, m.y, (z, x, y) => !solid(z, x, y) && ![...z.drops.values()].some((d) => d.x === x && d.y === y), 3) || { x: m.x, y: m.y };
    const d = { id: nextId++, x: s.x, y: s.y, exp: Date.now() + 90000, gold, item };
    m.z.drops.set(d.id, d);
  };
  put(null, ri(def.gold[0], def.gold[1]));
  if (Math.random() < (def.boss ? 1 : 0.28)) {
    const slot = rollSlot();
    put(mkGear(slot, Math.max(1, m.lvl + ri(-1, 1)), rollRarity(m.lvl, def.boss)));
    if (def.boss) put(mkGear(rollSlot(), m.lvl + 1, rollRarity(m.lvl, true)));
  }
  if (Math.random() < 0.3) put(mkPotion(potionTier(m.lvl)));
}

function killMob(m, killer) {
  const def = MOBS[m.type];
  m.dead = true; m.respawnAt = m.z.kind === 'dungeon' ? Infinity : Date.now() + def.respawn; unplace(m);
  emit(m.z, m.x, m.y, { e: 'fx', k: 'die', x: m.x, y: m.y, id: m.id });
  dropLoot(m);
  let total = 0;
  for (const v of m.dmgBy.values()) total += v;
  // XP share per player. Party members in range split the kill (with a group bonus), contributor or not.
  const credit = new Map();
  for (const [pid, dmg] of m.dmgBy) {
    const p = players.get(pid);
    if (!p || p.dead || p.z !== m.z || dist(p, m) > 25) continue;
    const pt = partyOf(p);
    if (pt) {
      const near = [...pt.members].map((id) => players.get(id)).filter((q) => q && !q.dead && q.z === m.z && dist(q, m) <= 25);
      for (const q of near) if (!credit.has(q.id)) credit.set(q.id, (1 + 0.1 * (near.length - 1)) / near.length);
    } else {
      credit.set(pid, pid === killer.id ? 1 : Math.min(0.6, dmg / Math.max(1, total)));
    }
  }
  for (const [pid, share] of credit) {
    const p = players.get(pid);
    const factor = Math.min(1.5, Math.max(0.2, 1 + (m.lvl - p.lvl) * 0.1));
    giveXp(p, def.xp * factor * (m.lvl / def.lvl) * share);
    const q = p.quest;
    if (q.s === 1 && QUESTS[q.i].mob === m.type) {
      q.p++;
      if (q.p >= QUESTS[q.i].need) { q.s = 2; log(p, `Quest complete: ${QUESTS[q.i].title}. Return to ${(NPCS.find((x) => x.id === QUESTS[q.i].giver) || { name: 'the quest giver' }).name}.`, '#ffe066'); }
      else log(p, `${QUESTS[q.i].title}: ${q.p}/${QUESTS[q.i].need}`, '#ffe066');
    }
    p.dirty = true;
  }
  for (const p of players.values()) if (p.target === m.id) { p.target = null; p.dirty = true; }
  if (def.boss && m.z.kind === 'world') sayAll(`${killer.name} has slain the ${def.name}!`, '#ff9a3a');
  if (def.boss && m.z.kind === 'dungeon') {
    for (const q of players.values()) if (q.z === m.z) log(q, `The ${def.name} falls! The crypt falls silent. Loot the room, then leave through the exit portal.`, '#ff9a3a');
    sayAll(`${killer.name} has conquered ${m.z.def.name}!`, '#ff9a3a');
  }
}

// ---------------------------------------------------------------- combat & skills
const liveMobs = (z) => [...z.mobs.values()].filter((m) => !m.dead);
function nearestMob(p, range) {
  let best = null, bd = range;
  for (const m of liveMobs(p.z)) { const d = dist(p, m); if (d <= bd) { bd = d; best = m; } }
  return best;
}
const targetOf = (p) => { const m = p.target && p.z.mobs.get(p.target); return m && !m.dead ? m : null; };

function basicAttack(p, m, now) {
  const st = p.st, wt = st.wt;
  p.atkAt = now + st.atkMs;
  const base = power(p, wt.scale) * 0.9 * (wt.mag ? st.magMul : 1) * rand(0.88, 1.12);
  p.f = Math.abs(m.x - p.x) >= Math.abs(m.y - p.y) ? (m.x > p.x ? 3 : 2) : (m.y > p.y ? 0 : 1);
  emit(p.z, p.x, p.y, { e: 'fx', k: wt.fx, x: p.x, y: p.y, tx: m.x, ty: m.y, id: p.id });
  hitMob(p, m, base);
}

// ---- boss / monster special attacks (telegraphed: players get a warning circle)
function mobSpecial(m, t, now) {
  const def = MOBS[m.type];
  for (const s of def.specials) {
    if (now < (m.specAt[s.kind] || 0)) continue;
    if (s.kind === 'slam') {
      if (dist(m, t) > s.range) continue;
      m.specAt[s.kind] = now + s.cd;
      const cx = t.x, cy = t.y, z = m.z;
      emit(z, cx, cy, { e: 'fx', k: 'warn', x: cx, y: cy, r: s.r, ms: s.warnMs });
      schedule(s.warnMs, () => {
        if (m.dead) return;
        emit(z, cx, cy, { e: 'fx', k: 'burst', x: cx, y: cy, r: s.r, col: '#ff6a3a' });
        for (const q of players.values()) {
          if (q.z !== z || q.dead || Math.hypot(q.x - cx, q.y - cy) > s.r + 0.4) continue;
          hurtPlayer(q, ri(def.dmg[0], def.dmg[1]) * s.mult, def.name, { noDodge: true });
          if (s.stun) addFx(q, 'stun', s.stun, 0, m.id);
        }
      });
      m.atkAt = Math.max(m.atkAt, now + 900);
      return true;
    }
    if (s.kind === 'summon') {
      let alive = 0;
      for (const o of m.z.mobs.values()) if (o.owner === m.id && !o.dead) alive++;
      if (alive >= s.max || dist(m, t) > s.range) continue;
      m.specAt[s.kind] = now + s.cd;
      for (let i = 0; i < s.n; i++) {
        const spot = nearestFree(m.z, m.x, m.y, mobFree, 4);
        if (!spot) break;
        const add = spawnMob(m.z, s.type, spot.x, spot.y);
        add.owner = m.id; add.threat.set(t.id, 1);
      }
      emit(m.z, m.x, m.y, { e: 'fx', k: 'ring', x: m.x, y: m.y, r: 3, col: '#6aff8a' });
      m.atkAt = Math.max(m.atkAt, now + 900);
      return true;
    }
    if (s.kind === 'drain') {
      if (dist(m, t) > s.r) continue;
      m.specAt[s.kind] = now + s.cd;
      emit(m.z, m.x, m.y, { e: 'fx', k: 'ring', x: m.x, y: m.y, r: s.r, col: '#a03aa0' });
      for (const q of players.values()) {
        if (q.z !== m.z || q.dead || dist(m, q) > s.r) continue;
        hurtPlayer(q, ri(def.dmg[0], def.dmg[1]) * s.mult, def.name, { mag: true });
        m.hp = Math.min(m.mh, m.hp + m.mh * 0.02);
      }
      m.atkAt = Math.max(m.atkAt, now + 900);
      return true;
    }
  }
  return false;
}

// ---- player skills: resolved from the shared skill table by kind
function useSkill(p, n, now) {
  if (p.dead || (p.stunUntil || 0) > now || n < 1 || n > barSlots(p.lvl)) return;
  const id = p.bar[n - 1], sk = id && SKILLS[id];
  if (!sk || now < (p.gcdAt || 0) || (p.cd[id] || 0) > now) return;
  if (!castSkill(p, sk)) return;
  p.cd[id] = now + sk.cd; p.gcdAt = now + 600; p.lastHit = now; p.dirty = true;
  send(p, { t: 'ev', e: 'cd', id, ms: sk.cd });
}

function castSkill(p, sk) {
  const st = p.st;
  const pw = () => power(p, sk.scale || 'str') * (sk.mag ? st.magMul : 1);
  const dmg = (mult = sk.mult) => pw() * mult * rand(0.92, 1.08);
  const applyFx = (t) => { for (const [id, ms, pow] of sk.fx || []) addFx(t, id, ms, EFFECTS[id].dot ? pow * pw() : pow, p.id); };
  const fail = (msg) => { log(p, msg, '#ff8a8a'); return false; };
  const fxAt = (e, o = {}) => emit(p.z, e.x, e.y, { e: 'fx', k: sk.vis || 'ring', x: e.x, y: e.y, id: p.id, r: sk.r, col: sk.col, ...o });
  let tgt = targetOf(p);
  const need = (range) => {
    if (!tgt || dist(p, tgt) > range) { tgt = nearestMob(p, range); if (tgt) { p.target = tgt.id; p.dirty = true; } }
    if (!tgt) return false;
    p.f = Math.abs(tgt.x - p.x) >= Math.abs(tgt.y - p.y) ? (tgt.x > p.x ? 3 : 2) : (tgt.y > p.y ? 0 : 1);
    return true;
  };
  const near = (r, from = p) => liveMobs(p.z).filter((m) => Math.hypot(m.x - from.x, m.y - from.y) <= r);
  const allies = (r) => {
    const out = [p], pt = partyOf(p);
    if (pt) for (const id of pt.members) { const q = players.get(id); if (q && q !== p && q.z === p.z && !q.dead && dist(p, q) <= r) out.push(q); }
    return out;
  };
  const proj = (from, to, vis = sk.vis) => emit(p.z, from.x, from.y, { e: 'fx', k: 'proj', vis, x: from.x, y: from.y, tx: to.x, ty: to.y, id: p.id, big: sk.big });

  switch (sk.kind) {
    case 'aoe_self': {
      const hit = near(sk.r);
      if (!hit.length) return fail('No enemies nearby.');
      fxAt(p);
      for (const m of hit) { hitMob(p, m, dmg()); applyFx(m); }
      return true;
    }
    case 'melee_st': {
      if (!need(sk.range)) return fail('No target in range.');
      let mult = sk.mult;
      if (sk.bonusIf && sk.bonusIf.some((f) => hasFx(tgt, f))) mult *= sk.bonusMult;
      if (sk.execute && tgt.hp / tgt.mh < sk.execute[0]) mult *= sk.execute[1];
      emit(p.z, tgt.x, tgt.y, { e: 'fx', k: sk.vis || 'swing', x: p.x, y: p.y, tx: tgt.x, ty: tgt.y, id: p.id });
      hitMob(p, tgt, dmg(mult)); applyFx(tgt);
      return true;
    }
    case 'ranged_st': {
      if (!need(sk.range)) return fail('No target in range.');
      proj(p, tgt);
      hitMob(p, tgt, dmg(), { leech: sk.leech }); applyFx(tgt);
      if (sk.chain) {
        const seen = new Set([tgt.id]);
        let from = { x: tgt.x, y: tgt.y };
        for (let i = 0; i < sk.chain; i++) {
          const nxt = near(4.5, from).filter((m) => !seen.has(m.id)).sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
          if (!nxt) break;
          seen.add(nxt.id); proj(from, nxt);
          hitMob(p, nxt, dmg(sk.mult * 0.7)); from = { x: nxt.x, y: nxt.y };
        }
      }
      return true;
    }
    case 'multi': {
      const hit = near(sk.range).sort((a, b) => dist(p, a) - dist(p, b)).slice(0, sk.n);
      if (!hit.length) return fail('No enemies in range.');
      for (const m of hit) { proj(p, m); hitMob(p, m, dmg()); applyFx(m); }
      return true;
    }
    case 'aoe_target': {
      if (!need(sk.range)) return fail('No target in range.');
      const cx = tgt.x, cy = tgt.y, zone = p.z;
      emit(zone, cx, cy, { e: 'fx', k: 'warn', x: cx, y: cy, r: sk.r, ms: sk.warnMs, col: '#ffb030' });
      schedule(sk.warnMs, () => {
        emit(zone, cx, cy, { e: 'fx', k: sk.vis, x: cx, y: cy, r: sk.r, id: p.id });
        for (const m of liveMobs(zone).filter((o) => Math.hypot(o.x - cx, o.y - cy) <= sk.r + 0.4)) { hitMob(p, m, dmg()); applyFx(m); }
      });
      return true;
    }
    case 'buff_self':
      if (sk.heal) healPlayer(p, st.mh * sk.heal, p);
      applyFx(p); fxAt(p);
      return true;
    case 'buff_party':
      for (const q of allies(sk.r)) { applyFx(q); fxAt(q); }
      return true;
    case 'taunt': {
      const hit = near(sk.r);
      if (!hit.length) return fail('No enemies nearby.');
      for (const m of hit) { let mx = 0; for (const v of m.threat.values()) mx = Math.max(mx, v); m.threat.set(p.id, mx * 1.25 + 100); }
      applyFx(p); fxAt(p, { k: 'ring' });
      return true;
    }
    case 'shield':
      addFx(p, 'shield', sk.ms, st.mh * sk.pct, p.id); applyFx(p); fxAt(p);
      return true;
    case 'dash': {
      const [dx, dy] = [[0, 1], [0, -1], [-1, 0], [1, 0]][p.f];
      let x = p.x, y = p.y;
      for (let i = 0; i < sk.dist; i++) { if (!free(p.z, x + dx, y + dy)) break; x += dx; y += dy; }
      if (x === p.x && y === p.y) return fail('Something blocks the way.');
      fxAt(p, { k: 'dash' });
      unplace(p); p.x = x; p.y = y; place(p);
      for (const d of p.z.drops.values()) if (d.x === x && d.y === y) pickup(p, d);
      fxAt(p, { k: 'dash' });
      return true;
    }
    case 'heal': {
      const c = allies(sk.range).filter((q) => q.hp < q.st.mh).sort((a, b) => a.hp / a.st.mh - b.hp / b.st.mh)[0];
      if (!c) return fail('Nobody needs healing.');
      healPlayer(c, st.healPow * sk.mult * rand(0.95, 1.05), p); fxAt(c);
      return true;
    }
    case 'hot': {
      const c = allies(sk.range).sort((a, b) => a.hp / a.st.mh - b.hp / b.st.mh)[0];
      addFx(c, 'regen', sk.ms, st.healPow * sk.mult, p.id); fxAt(c);
      return true;
    }
    case 'nova_heal': {
      const hit = near(sk.r), friends = allies(sk.r).filter((q) => q.hp < q.st.mh);
      if (!hit.length && !friends.length) return fail('Nothing to affect.');
      fxAt(p);
      for (const m of hit) hitMob(p, m, dmg());
      for (const q of friends) healPlayer(q, st.healPow * sk.healMult, p);
      return true;
    }
    case 'cc_aoe': {
      const hit = near(sk.r);
      if (!hit.length) return fail('No enemies nearby.');
      fxAt(p);
      for (const m of hit) {
        hitMob(p, m, dmg()); applyFx(m);
        if (sk.dropThreat) { m.threat.delete(p.id); if (m.target === p.id) m.target = null; }
      }
      return true;
    }
    case 'sacrifice': {
      const cost = Math.round(st.mh * sk.hpPct);
      if (p.hp <= cost + 1) return fail('You are too wounded.');
      p.hp -= cost;
      emit(p.z, p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: cost, k: 'p', id: p.id });
      applyFx(p); fxAt(p);
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------- zones & dungeon instances
const zoneMsg = (z) => ({
  t: 'zone', id: z.id, kind: z.kind, seed: z.seed || SEED, theme: z.def ? z.def.theme : 'world', name: z.def ? z.def.name : 'Eldermoor',
  npcs: z.npcs.map(({ id, key: kk, name, role, x, y }) => ({ id, key: kk, name, role, x, y })),
});

function moveToZone(p, z, x, y) {
  { const tr = tradeOf(p); if (tr) endTrade(tr, 'you left the area'); }
  unplace(p);
  p.z = z; p.x = x; p.y = y; place(p);
  p.target = null; p.want = null; p.dirty = true;
  send(p, zoneMsg(z));
}

function populateDungeon(z) {
  const def = z.def;
  const fill = (rm, type) => {
    for (let tries = 0; tries < 40; tries++) {
      const x = rm.x + 1 + Math.floor(Math.random() * (rm.w - 2)), y = rm.y + 1 + Math.floor(Math.random() * (rm.h - 2));
      if (mobFree(z, x, y)) { spawnMob(z, type, x, y); return; }
    }
  };
  z.world.rooms.forEach((rm, i) => {
    if (rm.entry) return;
    if (rm.boss) {
      const b = nearestFree(z, rm.cx, rm.cy, mobFree, 4);
      spawnMob(z, def.boss, b.x, b.y);
      for (let k = 0; k < 6; k++) fill(rm, def.bossAdds[k % def.bossAdds.length]);
      return;
    }
    const mix = def.mixes[Math.min(i, def.mixes.length - 1)];
    for (let k = 0; k < 4 + (i >> 1); k++) fill(rm, mix[k % mix.length]);
  });
}

function makeDungeon(def, k) {
  const seed = def.seed + (nextInstance % 7);
  const z = makeZone(`${def.id}${nextInstance++}`, 'dungeon', generateDungeon(seed, def.theme));
  z.seed = seed; z.def = def; z.key = `${def.id}:${k}`;
  const e = z.world.exit;
  z.npcs = [{ id: EXIT_ID, k: 'n', key: 'portal', name: 'Exit', role: 'portal', x: e.x, y: e.y }];
  for (const n of z.npcs) z.occ.set(key(n.x, n.y), n);
  populateDungeon(z);
  zones.set(z.id, z); instances.set(z.key, z);
  return z;
}

// One instance per dungeon and party (or solo hero): party members who step through later share it.
function enterDungeon(p, def) {
  if (p.dead || !def) return;
  const k = p.party ? `p${p.party}` : `u${p.id}`;
  const z = instances.get(`${def.id}:${k}`) || makeDungeon(def, k);
  z.emptyAt = 0;
  const s = nearestFree(z, z.world.spawn.x, z.world.spawn.y);
  if (p.lvl < def.rec) log(p, `${def.name} is deadly below level ${def.rec}. Tread carefully.`, '#ff9a3a');
  p.ret = { x: def.portal.x, y: def.portal.y + 2 };
  moveToZone(p, z, s.x, s.y);
  log(p, `You step through the portal into ${def.name}...`, '#c06bff');
}

function leaveDungeon(p) {
  const s = nearestFree(overworld, p.ret.x, p.ret.y);
  moveToZone(p, overworld, s.x, s.y);
  log(p, 'You return to the surface.', '#c06bff');
}

function reapInstances(now) {
  for (const z of zones.values()) {
    if (z === overworld) continue;
    if ([...players.values()].some((p) => p.z === z)) { z.emptyAt = 0; continue; }
    if (!z.emptyAt) z.emptyAt = now;
    else if (now - z.emptyAt > INSTANCE_TTL) { zones.delete(z.id); instances.delete(z.key); }
  }
}

// Only reachable when the server is started with EM_DEBUG=1 (used by the tests).
function debugCmd(p, m) {
  if (Array.isArray(m.tp)) {
    const x = m.tp[0] | 0, y = m.tp[1] | 0;
    if (free(p.z, x, y)) { unplace(p); p.x = x; p.y = y; place(p); }
  }
  if (m.atkMul) p.dbgMul = Number(m.atkMul) || 0;
  if (m.gold) p.gold += m.gold | 0;
  if (m.give) for (let i = 0; i < (m.n || 1); i++) addItem(p, m.give === 'potion' ? mkPotion(false) : mkGear(m.give === 'armor' ? 'body' : m.give === 'trinket' ? 'ring' : m.give, 10, Number.isInteger(m.r) ? m.r : 2));
  if (m.god) p.god = true;
  if (m.lvl) p.lvl = Math.max(1, Math.min(MAIN_MAX, m.lvl | 0));
  if (m.jobLvl) { p.jobs[p.job].lvl = Math.max(1, Math.min(JOB_MAX, m.jobLvl | 0)); fillBar(p); for (const id of knownOf(p)) p.knownSeen.add(id); }
  if (m.points) p.points += m.points | 0;
  if (m.quest !== undefined) p.quest = { i: m.quest | 0, s: 0, p: 0 };
  if (m.job && JOBS[m.job]) { p.job = m.job; if (p.jobs[m.job].lvl < 1) p.jobs[m.job] = { lvl: 1, xp: 0 }; fillBar(p); }
  computeStats(p);
  fillBar(p);
  if (m.god || m.lvl) p.hp = p.st.mh;
  p.dirty = true;
}

// ---------------------------------------------------------------- trading
// Two-phase, server-authoritative: both sides set offers, both LOCK, both CONFIRM, then one synchronous
// swap re-validates everything. Any offer change clears every lock/confirm. Items are named by their
// unique id (u) and looked up in the owner's pack at swap time, so nothing the client says is trusted.
const trades = new Map();
let nextTrade = 1;
const MAX_OFFER = 6, TRADE_RANGE = 10;
const tradeOf = (p) => (p.trade ? trades.get(p.trade) : null);
const sideOf = (t, p) => (t.a === p.id ? t.sa : t.sb);
const otherOf = (t, p) => players.get(t.a === p.id ? t.b : t.a);

function tradeView(t, viewer) {
  const mk = (q, side) => ({
    id: q.id, name: q.name, gold: side.gold, lock: side.lock, ok: side.ok,
    items: side.items.map((uid) => q.inv.find((i) => i && i.u === uid)).filter(Boolean),
  });
  const o = otherOf(t, viewer);
  return { t: 'trade', me: mk(viewer, sideOf(t, viewer)), them: mk(o, sideOf(t, o)) };
}
function pushTrade(t) {
  for (const id of [t.a, t.b]) { const q = players.get(id); if (q) send(q, tradeView(t, q)); }
}
function endTrade(t, why, done = false) {
  trades.delete(t.id);
  for (const id of [t.a, t.b]) {
    const q = players.get(id);
    if (!q) continue;
    q.trade = 0;
    send(q, { t: 'trade_end', why, ok: done });
    log(q, done ? why : `Trade cancelled: ${why}`, done ? '#6aff8a' : '#ff9a6a');
  }
}
const canTrade = (a, b) => a && b && a !== b && !a.dead && !b.dead && a.z === b.z && dist(a, b) <= TRADE_RANGE;

function tradeRequest(p, name, now) {
  if (now - (p.trAt || 0) < 2000) return;
  p.trAt = now;
  const t = findPlayer(name);
  if (!t) return log(p, 'No hero by that name is online.', '#ff8a8a');
  if (t === p) return log(p, "You can't trade with yourself.", '#ff8a8a');
  if (p.trade || t.trade) return log(p, p.trade ? 'You are already trading.' : `${t.name} is already trading.`, '#ff8a8a');
  if (!canTrade(p, t)) return log(p, `${t.name} is too far away.`, '#ff8a8a');
  if (t.tradeInv && t.tradeInv.until > now) return log(p, `${t.name} already has a trade request.`, '#ff8a8a');
  t.tradeInv = { from: p.id, until: now + 30000 };
  send(t, { t: 'trade_inv', from: p.id, name: p.name });
  log(p, `Trade request sent to ${t.name}.`, '#9fd0ff');
}
function tradeAnswer(p, ok, now) {
  const inv = p.tradeInv;
  p.tradeInv = null;
  if (!inv || inv.until < now) return log(p, 'That trade request has expired.', '#ff8a8a');
  const from = players.get(inv.from);
  if (!from) return log(p, 'The other hero is gone.', '#ff8a8a');
  if (!ok) return log(from, `${p.name} declined to trade.`, '#9fd0ff');
  if (p.trade || from.trade) return log(p, 'Someone is already trading.', '#ff8a8a');
  if (!canTrade(p, from)) return log(p, 'You are too far apart.', '#ff8a8a');
  const t = { id: nextTrade++, a: from.id, b: p.id, sa: { items: [], gold: 0, lock: false, ok: false }, sb: { items: [], gold: 0, lock: false, ok: false } };
  trades.set(t.id, t); from.trade = p.trade = t.id;
  pushTrade(t);
}
function tradeOffer(p, items, gold) {
  const t = tradeOf(p);
  if (!t) return;
  const uids = [];
  for (const raw of Array.isArray(items) ? items.slice(0, 20) : []) {
    const u = Number(raw);
    if (!Number.isInteger(u) || uids.includes(u) || !p.inv.some((i) => i && i.u === u)) continue; // owned, no duplicates
    uids.push(u);
    if (uids.length >= MAX_OFFER) break;
  }
  const side = sideOf(t, p);
  side.items = uids;
  side.gold = Math.max(0, Math.min(p.gold, Math.floor(Number(gold) || 0)));
  t.sa.lock = t.sb.lock = t.sa.ok = t.sb.ok = false; // any change resets both sides
  pushTrade(t);
}
function tradeLock(p) {
  const t = tradeOf(p);
  if (!t) return;
  const s = sideOf(t, p);
  s.lock = true; s.ok = false;
  pushTrade(t);
}
function tradeConfirm(p) {
  const t = tradeOf(p);
  if (!t || !(t.sa.lock && t.sb.lock)) return;
  sideOf(t, p).ok = true;
  if (t.sa.ok && t.sb.ok) executeTrade(t); else pushTrade(t);
}

function executeTrade(t) {
  const A = players.get(t.a), B = players.get(t.b);
  if (!canTrade(A, B)) return endTrade(t, 'you are no longer in range');
  const pull = (q, side) => side.items.map((uid) => q.inv.findIndex((i) => i && i.u === uid));
  const ia = pull(A, t.sa), ib = pull(B, t.sb);
  if (ia.includes(-1) || ib.includes(-1)) return endTrade(t, 'an offered item is no longer in the pack');
  if (A.gold < t.sa.gold || B.gold < t.sb.gold) return endTrade(t, 'not enough gold');
  const freeAfter = (q, out, inc) => q.inv.filter((i) => i === null).length + out.length >= inc.length;
  if (!freeAfter(A, ia, ib) || !freeAfter(B, ib, ia)) return endTrade(t, 'not enough pack space');
  const fromA = ia.map((i) => A.inv[i]), fromB = ib.map((i) => B.inv[i]);
  for (const i of ia) A.inv[i] = null;
  for (const i of ib) B.inv[i] = null;
  for (const it of fromB) addItem(A, it);
  for (const it of fromA) addItem(B, it);
  A.gold += t.sb.gold - t.sa.gold;
  B.gold += t.sa.gold - t.sb.gold;
  A.dirty = B.dirty = true;
  savePlayer(A); savePlayer(B); writeSaves();
  console.log(`[trade] ${A.name} gave ${fromA.map((i) => i.n).join(', ') || '-'} + ${t.sa.gold}g; ${B.name} gave ${fromB.map((i) => i.n).join(', ') || '-'} + ${t.sb.gold}g`);
  endTrade(t, 'Trade complete.', true);
}

function checkTrades() {
  for (const t of [...trades.values()]) {
    const A = players.get(t.a), B = players.get(t.b);
    if (!A || !B) endTrade(t, 'the other hero left');
    else if (!canTrade(A, B)) endTrade(t, 'you moved too far apart');
  }
}

// ---------------------------------------------------------------- npc interaction
function talk(p, id) {
  const n = p.z.npcs.find((x) => x.id === id);
  if (!n || dist(p, n) > 4.5) return;
  if (n.role === 'portal') return p.z === overworld ? enterDungeon(p, DUNGEONS.find((dg) => dg.npcId === n.id)) : leaveDungeon(p);
  if (n.role === 'lore') return send(p, { t: 'dialog', npc: n.id, name: n.name, text: n.text });
  if (n.role === 'shop') {
    return send(p, {
      t: 'dialog', npc: n.id, name: n.name, text: 'Potions, blades, baubles - and I buy what you carry out of the wilds.',
      shop: (SHOP_BY.get(n.id) || SHOP).map((x) => ({ ...x })),
    });
  }
  const q = p.quest;
  if (q.i >= QUESTS.length) return send(p, { t: 'dialog', npc: n.id, name: n.name, text: 'You have done more for Eldermoor than any hero in living memory. Rest easy, champion.' });
  const Q = QUESTS[q.i];
  if (n.id !== Q.giver) {
    const g = NPCS.find((x) => x.id === Q.giver);
    return send(p, { t: 'dialog', npc: n.id, name: n.name, text: g ? `Your next task is with ${g.name}. Seek them out.` : 'Safe travels.' });
  }
  if (q.s === 0) return send(p, { t: 'dialog', npc: n.id, name: n.name, title: Q.title, text: Q.text, reward: `${Q.xp} XP, ${Q.gold} gold${Q.reward ? ', epic gear' : ''}`, opts: [{ k: 'accept', l: 'Accept quest' }] });
  if (q.s === 1) return send(p, { t: 'dialog', npc: n.id, name: n.name, title: Q.title, text: `Still at it? ${q.p}/${Q.need} so far.` });
  send(p, { t: 'dialog', npc: n.id, name: n.name, title: Q.title, text: 'You did it! Eldermoor is in your debt.', reward: `${Q.xp} XP, ${Q.gold} gold${Q.reward ? ', epic gear' : ''}`, opts: [{ k: 'turnin', l: 'Claim reward' }] });
}

// ---------------------------------------------------------------- client messages
function onMessage(ws, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'login') { if (!ws.player) login(ws, m); return; }
  const p = ws.player;
  if (!p || !players.has(p.id)) return;
  if (++p.msgs > 400) return; // flood guard, reset every second
  const now = Date.now();
  // anything that changes the pack is frozen while a trade is open (the swap re-validates anyway)
  if (p.trade && ['drop', 'sell', 'equip', 'unequip', 'use', 'buy'].includes(m.t)) return log(p, 'Finish or cancel your trade first.', '#ff8a8a');
  switch (m.t) {
    case 'move': {
      if (p.dead) return;
      const dx = Math.sign(m.dx | 0), dy = Math.sign(m.dy | 0);
      if ((dx && dy) || (!dx && !dy)) return;
      p.want = { dx, dy, at: now };
      break;
    }
    case 'target': {
      const id = m.id | 0;
      p.target = id && p.z.mobs.has(id) && !p.z.mobs.get(id).dead ? id : null;
      p.dirty = true;
      break;
    }
    case 'skill': if (!p.dead) useSkill(p, m.n | 0, now); break;
    case 'attr': {
      const n = Math.max(1, Math.min(10, m.n | 0 || 1));
      if (!ATTRS.includes(m.k) || p.points < n) return;
      p.attr[m.k] += n; p.points -= n; computeStats(p); p.dirty = true;
      break;
    }
    case 'respec': {
      const cost = 25 * p.lvl;
      if (p.gold < cost) return log(p, `Resetting attributes costs ${cost} gold.`, '#ff8a8a');
      p.gold -= cost; p.attr = { str: 0, dex: 0, int: 0, vit: 0, spr: 0 }; p.points = POINTS_PER_LEVEL * p.lvl;
      computeStats(p); p.dirty = true;
      log(p, 'Your attributes have been reset.', '#c06bff');
      break;
    }
    case 'job': switchJob(p, String(m.id), now); break;
    case 'bar': setBar(p, m.slot | 0, m.skill); break;
    case 'chat': {
      let text = String(m.m || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
      if (!text || now - p.chatAt < 600) return;
      p.chatAt = now;
      if (text === '/who') return log(p, `Online: ${[...players.values()].map((x) => `${x.name} (L${x.lvl})`).join(', ')}`, '#9fd0ff');
      if (m.ch === 'party') {
        const pt = partyOf(p);
        if (!pt) return log(p, 'You are not in a party.', '#ff8a8a');
        for (const id of pt.members) { const o = players.get(id); if (o) send(o, { t: 'chat', n: p.name, m: text, id: p.id, ch: 'party' }); }
        break;
      }
      for (const o of players.values()) send(o, { t: 'chat', n: p.name, m: text, id: p.id });
      break;
    }
    case 'pinvite': partyInvite(p, m.name, now); break;
    case 'pgo': partyAnswer(p, !!m.ok, now); break;
    case 'pleave': leaveParty(p); break;
    case 'pkick': {
      const pt = partyOf(p), t = players.get(m.id | 0);
      if (!pt || pt.leader !== p.id || !t || t === p || t.party !== pt.id) return;
      leaveParty(t, 'was removed from the party');
      break;
    }
    case 'talk': talk(p, m.id | 0); break;
    case 'questAccept': {
      const gq = QUESTS[p.quest.i], n = gq && overworld.npcs.find((x) => x.id === gq.giver);
      if (!n || !nearNpc(p, n) || p.quest.s !== 0) return;
      p.quest.s = 1; p.quest.p = 0; p.dirty = true;
      log(p, `Quest accepted: ${QUESTS[p.quest.i].title}`, '#ffe066');
      break;
    }
    case 'questTurnIn': {
      const q = p.quest, Q = QUESTS[q.i], n = Q && overworld.npcs.find((x) => x.id === Q.giver);
      if (!n || !nearNpc(p, n) || q.s !== 2) return;
      if (Q.reward && !p.inv.includes(null)) return log(p, 'Make room in your pack first.', '#ff8a8a');
      p.gold += Q.gold;
      giveXp(p, Q.xp);
      if (Q.reward) addItem(p, mkGear(rollSlot(), Q.rewardLvl || 20, 3));
      log(p, `Quest complete! +${Q.xp} XP, +${Q.gold} gold.`, '#ffe066');
      q.i++; q.s = 0; q.p = 0; p.dirty = true;
      break;
    }
    case 'buy': {
      const sh = nearShop(p), it = sh && (SHOP_BY.get(sh.id) || SHOP)[m.i | 0];
      if (!it) return;
      if (p.gold < it.price) return log(p, 'Not enough gold.', '#ff8a8a');
      const { price, ...base } = it;
      if (!addItem(p, { ...base, u: uid++, c: 1 })) return log(p, 'Your pack is full.', '#ff8a8a');
      p.gold -= it.price; p.dirty = true;
      send(p, { t: 'ev', e: 'coin' });
      break;
    }
    case 'sell': {
      const it = p.inv[m.slot | 0];
      if (!it || !nearShop(p)) return;
      const gold = Math.max(1, Math.floor(it.v * 0.5)) * (it.c || 1);
      p.gold += gold; p.inv[m.slot | 0] = null; p.dirty = true;
      log(p, `Sold ${it.n} for ${gold} gold.`, '#ffd23a');
      send(p, { t: 'ev', e: 'coin' });
      break;
    }
    case 'equip': {
      const i = m.slot | 0, it = p.inv[i], key = eqKeyFor(p.eq, it);
      if (!it || !key) return;
      const req = Math.max(1, it.l - 2);
      if (p.lvl < req) return log(p, `You need level ${req} to use that.`, '#ff8a8a');
      p.inv[i] = p.eq[key]; p.eq[key] = it;
      computeStats(p); p.dirty = true;
      break;
    }
    case 'unequip': {
      const it = EQ_KEYS.includes(m.s) ? p.eq[m.s] : null;
      if (!it) return;
      const i = p.inv.indexOf(null);
      if (i < 0) return log(p, 'Your pack is full.', '#ff8a8a');
      p.inv[i] = it; p.eq[m.s] = null;
      computeStats(p); p.dirty = true;
      break;
    }
    case 'look': {
      const L = validLook(m.look);
      if (!L) return;
      if (!safeAt(p.z, p.x, p.y)) return log(p, 'Visit the town square to change your look.', '#ff8a8a');
      if (L.every((v, i) => v === p.look[i])) return;
      if (p.gold < LOOK_COST) return log(p, `A new look costs ${LOOK_COST} gold.`, '#ff8a8a');
      p.gold -= LOOK_COST; p.look = L; p.dirty = true;
      log(p, 'You look like a new hero.', '#c06bff');
      break;
    }
    case 'use': {
      const i = m.slot | 0, it = p.inv[i];
      if (!it || it.s !== 'potion' || p.dead) return;
      if (now < p.potAt) return log(p, 'Potion on cooldown.', '#ff8a8a');
      if (p.hp >= p.st.mh) return log(p, 'Already at full health.', '#ff8a8a');
      p.potAt = now + 6000;
      const h = Math.min(it.heal, p.st.mh - p.hp);
      p.hp += h;
      if (--it.c <= 0) p.inv[i] = null;
      emit(p.z, p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: h, k: 'h', id: p.id });
      emit(p.z, p.x, p.y, { e: 'fx', k: 'heal', x: p.x, y: p.y, id: p.id });
      send(p, { t: 'ev', e: 'pot', ms: 6000 });
      p.dirty = true;
      break;
    }
    case 'trade_req': tradeRequest(p, m.name, now); break;
    case 'trade_ans': tradeAnswer(p, !!m.ok, now); break;
    case 'trade_offer': tradeOffer(p, m.items, m.gold); break;
    case 'trade_lock': tradeLock(p); break;
    case 'trade_confirm': tradeConfirm(p); break;
    case 'trade_cancel': { const t = tradeOf(p); if (t) endTrade(t, `${p.name} cancelled`); break; }
    case 'dbg': if (DEBUG) debugCmd(p, m); break;
    case 'drop': {
      const i = m.slot | 0;
      if (p.inv[i]) { p.inv[i] = null; p.dirty = true; }
      break;
    }
    default:
  }
}

// ---------------------------------------------------------------- main loop
let tickN = 0;
const VX = 32, VY = 20;
function broadcast(now) {
  for (const p of players.values()) {
    const ents = [];
    for (const o of players.values()) {
      if (o.z !== p.z || Math.abs(o.x - p.x) > VX || Math.abs(o.y - p.y) > VY) continue;
      ents.push({ i: o.id, k: 'p', x: o.x, y: o.y, f: o.f, h: o.hp, mh: o.st.mh, n: o.name, l: o.lvl, c: o.job, lk: o.look, vs: visTokens(o.eq), fx: fxIds(o), d: o.dead ? 1 : 0, sp: o.st.moveMul > 1.2 ? 1 : 0 });
    }
    for (const m of p.z.mobs.values()) {
      if (m.dead || Math.abs(m.x - p.x) > VX || Math.abs(m.y - p.y) > VY) continue;
      ents.push({ i: m.id, k: 'm', s: m.type, x: m.x, y: m.y, f: m.f, h: m.hp, mh: m.mh, l: m.lvl, st: m.stunUntil > now ? 1 : 0, fx: fxIds(m) });
    }
    for (const d of p.z.drops.values()) {
      if (Math.abs(d.x - p.x) > VX || Math.abs(d.y - p.y) > VY) continue;
      ents.push({ i: d.id, k: 'd', x: d.x, y: d.y, g: d.gold ? 1 : 0, b: d.item ? d.item.b : '', r: d.item ? d.item.r : 0, cl: d.item ? d.item.cl || '' : '', n: d.item ? d.item.n : `${d.gold} gold` });
    }
    send(p, { t: 's', e: ents, tm: now });
    if (p.dirty) { send(p, meMsg(p)); p.dirty = false; }
  }
}

function tick() {
  const now = Date.now();
  tickN++;
  for (const p of players.values()) {
    if (tickN % 20 === 0) p.msgs = 0;
    if (p.dead) { if (now >= p.respawnAt) respawn(p); continue; }
    // movement
    if (p.want && now >= p.moveAt && (p.stunUntil || 0) <= now) {
      if (now - p.want.at < 350) tryMove(p, p.want.dx, p.want.dy, now);
      p.want = null;
    }
    // auto attack
    const t = targetOf(p);
    if (p.target && !t) { p.target = null; p.dirty = true; }
    if (t) {
      const d = dist(p, t);
      if (d > 24) { p.target = null; p.dirty = true; }
      else if (d <= p.st.range + 0.05 && now >= p.atkAt) basicAttack(p, t, now);
    }
    // buffs & regen
    tickFx(p, now);
    if (now >= p.regenAt) {
      p.regenAt = now + 1000;
      const calm = now - p.lastHit > 5000;
      const rate = calm ? (safeAt(p.z, p.x, p.y) ? 0.08 : 0.02) : (JOBS[p.job].regen || 0);
      if (rate && p.hp < p.st.mh) { p.hp = Math.min(p.st.mh, p.hp + Math.max(1, Math.round(p.st.mh * rate))); p.dirty = true; }
    }
  }
  for (const z of zones.values()) {
    if (z !== overworld && z.emptyAt) continue; // an empty instance sleeps until its timeout
    for (const m of z.mobs.values()) { if (!m.dead) tickFx(m, now); mobAI(m, now); }
    for (const d of z.drops.values()) if (now > d.exp) z.drops.delete(d.id);
  }
  runTimers(now);
  if (tickN % 20 === 0) reapInstances(now);
  if (tickN % 10 === 0) checkTrades();
  if (tickN % 2 === 0) broadcast(now);
  if (tickN % 10 === 0) partyTick();
}

// ---------------------------------------------------------------- http + ws
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/client/index.html';
  if (url === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ name: 'eldermoor', online: players.size, parties: parties.size, instances: instances.size, trades: trades.size, mobs: liveMobs(overworld).length, uptime: Math.round(process.uptime()) }));
  }
  if (!url.startsWith('/client/') && !url.startsWith('/shared/')) { res.writeHead(404); return res.end('not found'); }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws) => {
  ws.on('message', (d) => onMessage(ws, d.toString()));
  ws.on('close', () => { if (ws.player) dropPlayer(ws.player); });
  ws.on('error', () => {});
});

populate();
setInterval(tick, TICK_MS);
setInterval(() => { for (const p of players.values()) savePlayer(p); writeSaves(); }, 20000);
const shutdown = () => { for (const p of players.values()) savePlayer(p); writeSaves(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.listen(PORT, () => console.log(`Eldermoor listening on http://localhost:${PORT}  (${overworld.mobs.size} monsters)`));
