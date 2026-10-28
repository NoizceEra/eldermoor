// Eldermoor authoritative game server: HTTP (static client) + WebSocket (game).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { W, G, TOWN, BOSS, CAMP, inTown, generateWorld, generateDungeon, isSolid } from '../shared/world.js';
import {
  SEED, TICK_MS, MAX_LEVEL, INV_SIZE, CLASSES, MOBS, QUESTS, RARITY, NPCS, xpForLevel,
  DUNGEON_SEED, DUNGEON_REC_LVL, PORTAL, PORTAL_ID, EXIT_ID,
} from '../shared/data.js';

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
overworld.npcs = [...NPCS, PORTAL].map((n) => ({ ...n, k: 'n' }));
for (const n of overworld.npcs) overworld.occ.set(key(n.x, n.y), n);
const zones = new Map([[overworld.id, overworld]]);
const instances = new Map(); // party/solo key -> dungeon zone
let nextInstance = 1;
const npcByRole = (role) => overworld.npcs.find((n) => n.role === role);
const nearNpc = (p, n) => p.z === overworld && dist(p, n) <= 4.5;

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
const WEAPONS = [['Sword', 'sword'], ['Staff', 'staff'], ['Bow', 'bow'], ['Axe', 'axe'], ['Mace', 'mace']];
const ARMORS = ['Tunic', 'Vest', 'Mail', 'Plate'];
const TRINKETS = [['Ring', 'ring'], ['Amulet', 'amulet'], ['Charm', 'charm']];
const ADJ = [
  ['Worn', 'Plain', 'Rusty', 'Crude'],
  ['Sturdy', 'Keen', 'Fine', 'Hardy'],
  ['Runed', 'Gleaming', 'Tempered', 'Honed'],
  ['Dragon-forged', 'Starlit', 'Voidtouched', 'Ancient'],
];
let uid = 1;

function mkGear(slot, lvl, r) {
  const m = RARITY[r].m;
  const it = { u: uid++, s: slot, r, l: lvl, atk: 0, def: 0, hp: 0 };
  if (slot === 'weapon') {
    const [nm, b] = pick(WEAPONS);
    it.b = b; it.n = `${pick(ADJ[r])} ${nm}`;
    it.atk = Math.max(1, Math.round((2 + lvl * 1.3) * m));
  } else if (slot === 'armor') {
    it.b = 'armor'; it.n = `${pick(ADJ[r])} ${pick(ARMORS)}`;
    it.def = Math.max(1, Math.round((1.5 + lvl * 0.9) * m));
    it.hp = Math.round(lvl * 2 * (m - 0.6));
  } else {
    const [nm, b] = pick(TRINKETS);
    it.b = b; it.n = `${pick(ADJ[r])} ${nm}`;
    it.hp = Math.round((8 + lvl * 4) * m);
    it.atk = Math.round(lvl * 0.3 * m);
  }
  it.v = Math.max(1, Math.round((it.atk * 6 + it.def * 6 + it.hp * 0.8) * (1 + r * 0.5)));
  return it;
}
const mkPotion = (big) => ({
  u: uid++, s: 'potion', r: big ? 1 : 0, l: 1, b: 'potion',
  n: big ? 'Large Health Potion' : 'Health Potion', heal: big ? 220 : 90, c: 1, v: big ? 40 : 12,
});

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

const SHOP = [
  { ...mkPotion(false), price: 25 },
  { ...mkPotion(true), price: 80 },
  { ...mkGear('weapon', 4, 0), n: "Traveler's Blade", b: 'sword', price: 120 },
  { ...mkGear('armor', 4, 0), n: 'Leather Vest', price: 110 },
  { ...mkGear('trinket', 4, 1), n: 'Copper Ring', b: 'ring', price: 150 },
  { ...mkGear('weapon', 10, 1), n: 'Ranger Longbow', b: 'bow', price: 600 },
  { ...mkGear('weapon', 10, 1), n: 'Knight Longsword', b: 'sword', price: 600 },
  { ...mkGear('weapon', 10, 1), n: 'Adept Staff', b: 'staff', price: 600 },
];

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
    name: p.name, salt: p.salt, hash: p.hash, cls: p.cls, lvl: p.lvl, xp: p.xp, gold: p.gold,
    inv: p.inv, eq: p.eq, quest: p.quest, x: (p.z && p.z.kind !== 'world' ? p.ret : p).x, y: (p.z && p.z.kind !== 'world' ? p.ret : p).y, hp: p.hp,
  };
  savesDirty = true;
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
function computeStats(p) {
  const c = CLASSES[p.cls];
  let atk = c.atk + c.atkL * p.lvl, def = p.lvl * 1.2, mh = c.hp + c.hpL * p.lvl;
  for (const it of Object.values(p.eq)) if (it) { atk += it.atk; def += it.def; mh += it.hp; }
  if (p.buffs.atk > Date.now()) atk *= 1.35;
  if (p.dbgMul) atk *= p.dbgMul; // test-only (EM_DEBUG)
  if (p.god) { def += 1e6; mh += 1e5; }
  p.st = { atk, def, mh: Math.round(mh), range: c.range };
  if (p.hp > p.st.mh) p.hp = p.st.mh;
}
const meMsg = (p) => ({
  t: 'me', id: p.id, name: p.name, cls: p.cls, lvl: p.lvl, xp: p.xp, xpn: p.lvl >= MAX_LEVEL ? 0 : xpForLevel(p.lvl),
  hp: p.hp, mh: p.st.mh, gold: p.gold, inv: p.inv, eq: p.eq, quest: p.quest,
  st: { atk: Math.round(p.st.atk), def: Math.round(p.st.def), range: p.st.range }, tg: p.target,
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
    p = { ...saved, buffs: {}, cd: {} };
  } else {
    const cls = CLASSES[m.cls] ? m.cls : 'warrior';
    const salt = crypto.randomBytes(8).toString('hex');
    const inv = Array(INV_SIZE).fill(null);
    inv[0] = { ...mkPotion(false), c: 3 };
    p = {
      name, salt, hash: hashPass(pass, salt), cls, lvl: 1, xp: 0, gold: 20, inv,
      eq: { weapon: null, armor: null, trinket: null }, quest: { i: 0, s: 0, p: 0 },
      x: 0, y: 0, hp: 1, buffs: {}, cd: {},
    };
  }
  for (const old of players.values()) if (old.name.toLowerCase() === k) { old.ws.close(4000, 'Logged in elsewhere'); dropPlayer(old); }
  p.id = nextId++; p.k = 'p'; p.ws = ws; p.f = 0; p.dead = false; p.target = null;
  p.moveAt = 0; p.atkAt = 0; p.potAt = 0; p.want = null; p.lastHit = 0; p.regenAt = 0; p.dirty = true; p.msgs = 0;
  p.chatAt = 0; p.sprintUntil = 0; p.party = 0; p.invite = null; p.invAt = 0;
  computeStats(p);
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
    classes: Object.keys(CLASSES),
  });
  send(p, meMsg(p));
  log(p, `Welcome to Eldermoor, ${p.name}.`, '#ffe066');
  sayAll(`${p.name} the ${CLASSES[p.cls].name} has arrived.`, '#9fd0ff');
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
  p.moveAt = now + (p.sprintUntil > now ? 95 : 150);
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

function giveXp(p, amount) {
  if (p.lvl >= MAX_LEVEL) return;
  p.xp += Math.round(amount);
  let up = false;
  while (p.lvl < MAX_LEVEL && p.xp >= xpForLevel(p.lvl)) {
    p.xp -= xpForLevel(p.lvl);
    p.lvl++; up = true;
  }
  if (p.lvl >= MAX_LEVEL) p.xp = 0;
  if (up) {
    computeStats(p);
    p.hp = p.st.mh;
    emit(p.z, p.x, p.y, { e: 'fx', k: 'levelup', x: p.x, y: p.y, id: p.id });
    log(p, `Level up! You are now level ${p.lvl}.`, '#ffe066');
    sayAll(`${p.name} reached level ${p.lvl}!`, '#ffe066');
  }
  p.dirty = true;
}

function hurtPlayer(p, raw, from) {
  if (p.dead) return;
  const red = p.st.def / (p.st.def + 40 + p.lvl * 2);
  const amt = Math.max(1, Math.round(raw * (1 - red)));
  p.hp -= amt;
  p.lastHit = Date.now();
  emit(p.z, p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: amt, k: 'p', id: p.id });
  p.dirty = true;
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.respawnAt = Date.now() + 4000; p.target = null; p.want = null;
    emit(p.z, p.x, p.y, { e: 'fx', k: 'die', x: p.x, y: p.y, id: p.id });
    log(p, `You were slain by ${from}. Returning to town...`, '#ff6a6a');
  }
}

function respawn(p) {
  unplace(p);
  const left = p.z !== overworld;
  p.z = overworld; // dying in an instance sends you back to town
  const s = nearestFree(overworld, world.spawn.x, world.spawn.y);
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
    moveAt: 0, atkAt: 0, wanderAt: 0, stunUntil: 0, slowUntil: 0, dead: false, respawnAt: 0, dmgBy: new Map(),
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
      m.x = s.x; m.y = s.y; m.hp = m.mh; m.dead = false; m.target = null; m.dmgBy.clear(); place(m);
    }
    return;
  }
  if (now < m.stunUntil) return;
  let t = m.target ? players.get(m.target) : null;
  if (t && (t.dead || t.z !== m.z || safeAt(m.z, t.x, t.y) || dist(m, t) > def.leash + 6 || Math.hypot(m.x - m.hx, m.y - m.hy) > def.leash + 10)) {
    t = null; m.target = null; m.returning = true;
  }
  if (!t && !m.returning) {
    let best = null, bd = def.aggro;
    for (const p of players.values()) {
      if (p.z !== m.z || p.dead || safeAt(m.z, p.x, p.y)) continue;
      const d = dist(m, p);
      if (d <= bd) { bd = d; best = p; }
    }
    if (best) { t = best; m.target = best.id; }
  }
  if (t) {
    const d = dist(m, t);
    m.f = Math.abs(t.x - m.x) >= Math.abs(t.y - m.y) ? (t.x > m.x ? 3 : 2) : (t.y > m.y ? 0 : 1);
    if (d <= def.range + 0.05) {
      if (now >= m.atkAt) {
        m.atkAt = now + def.atkMs;
        const raw = ri(def.dmg[0], def.dmg[1]) * (1 + (m.lvl - def.lvl) * 0.1);
        emit(m.z, m.x, m.y, { e: 'fx', k: def.range > 2.5 ? 'arrow' : 'swing', x: m.x, y: m.y, tx: t.x, ty: t.y, id: m.id });
        hurtPlayer(t, raw, def.name);
      }
    } else if (now >= m.moveAt) {
      stepMob(m, t.x, t.y, now);
    }
  } else if (m.returning) {
    if (Math.hypot(m.x - m.hx, m.y - m.hy) < 1.5) { m.returning = false; m.hp = m.mh; }
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
    const slot = pick(['weapon', 'armor', 'trinket']);
    put(mkGear(slot, Math.max(1, m.lvl + ri(-1, 1)), rollRarity(m.lvl, def.boss)));
    if (def.boss) put(mkGear(pick(['weapon', 'armor', 'trinket']), m.lvl + 1, rollRarity(m.lvl, true)));
  }
  if (Math.random() < 0.3) put(mkPotion(m.lvl > 8 && Math.random() < 0.5));
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
      if (q.p >= QUESTS[q.i].need) { q.s = 2; log(p, `Quest complete: ${QUESTS[q.i].title}. Return to Elder Mira.`, '#ffe066'); }
      else log(p, `${QUESTS[q.i].title}: ${q.p}/${QUESTS[q.i].need}`, '#ffe066');
    }
    p.dirty = true;
  }
  for (const p of players.values()) if (p.target === m.id) { p.target = null; p.dirty = true; }
  if (def.boss && m.z.kind === 'world') sayAll(`${killer.name} has slain the ${def.name}!`, '#ff9a3a');
  if (def.boss && m.z.kind === 'dungeon') {
    for (const q of players.values()) if (q.z === m.z) log(q, `The ${def.name} falls! The crypt falls silent. Loot the room, then leave through the exit portal.`, '#ff9a3a');
    sayAll(`${killer.name} has conquered the Sunken Crypt!`, '#ff9a3a');
  }
}

function damageMob(p, m, amount, crit = false) {
  if (m.dead) return;
  const amt = Math.max(1, Math.round(amount));
  m.hp -= amt;
  m.dmgBy.set(p.id, (m.dmgBy.get(p.id) || 0) + amt);
  if (!m.target || Math.random() < 0.15) { m.target = p.id; m.returning = false; }
  emit(m.z, m.x, m.y, { e: 'dmg', x: m.x, y: m.y, v: amt, k: crit ? 'c' : 'm', id: m.id });
  if (m.hp <= 0) killMob(m, p);
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
  const c = CLASSES[p.cls];
  p.atkAt = now + c.atkMs;
  const crit = Math.random() < 0.1;
  const dmg = p.st.atk * (0.85 + Math.random() * 0.3) * (crit ? 1.8 : 1);
  const k = p.cls === 'warrior' ? 'swing' : p.cls === 'mage' ? 'bolt' : 'arrow';
  p.f = Math.abs(m.x - p.x) >= Math.abs(m.y - p.y) ? (m.x > p.x ? 3 : 2) : (m.y > p.y ? 0 : 1);
  emit(p.z, p.x, p.y, { e: 'fx', k, x: p.x, y: p.y, tx: m.x, ty: m.y, id: p.id });
  damageMob(p, m, dmg, crit);
}

function useSkill(p, n, now) {
  const c = CLASSES[p.cls];
  const sk = c.skills[n - 1];
  if (!sk || p.dead) return;
  if ((p.cd[n] || 0) > now) return;
  let t = targetOf(p);
  const need = (range) => {
    if (!t || dist(p, t) > range) {
      t = nearestMob(p, range);
      if (t) { p.target = t.id; p.dirty = true; }
    }
    if (!t) { log(p, 'No target in range.', '#ff8a8a'); return false; }
    p.f = Math.abs(t.x - p.x) >= Math.abs(t.y - p.y) ? (t.x > p.x ? 3 : 2) : (t.y > p.y ? 0 : 1);
    return true;
  };
  const around = (r) => liveMobs(p.z).filter((m) => dist(p, m) <= r);
  const atk = p.st.atk;
  let ok = false;
  const cls = p.cls;
  if (cls === 'warrior') {
    if (n === 1) {
      const hit = around(1.9);
      if (!hit.length) { log(p, 'No enemies nearby.', '#ff8a8a'); return; }
      emit(p.z, p.x, p.y, { e: 'fx', k: 'cleave', x: p.x, y: p.y, id: p.id });
      for (const m of hit) damageMob(p, m, atk * 1.4 * rand(0.9, 1.1));
      ok = true;
    } else if (n === 2) {
      if (!need(1.6)) return;
      emit(t.z, t.x, t.y, { e: 'fx', k: 'bash', x: t.x, y: t.y, id: p.id });
      t.stunUntil = now + 2000;
      damageMob(p, t, atk * rand(0.95, 1.1)); ok = true;
    } else {
      p.buffs.atk = now + 8000; computeStats(p);
      p.hp = Math.min(p.st.mh, p.hp + Math.round(p.st.mh * 0.15));
      emit(p.z, p.x, p.y, { e: 'fx', k: 'cry', x: p.x, y: p.y, id: p.id }); ok = true;
    }
  } else if (cls === 'mage') {
    if (n === 1) {
      if (!need(7)) return;
      emit(p.z, p.x, p.y, { e: 'fx', k: 'fire', x: p.x, y: p.y, tx: t.x, ty: t.y, id: p.id });
      damageMob(p, t, atk * 2.4 * rand(0.9, 1.1)); ok = true;
    } else if (n === 2) {
      const hit = around(3.2);
      if (!hit.length) { log(p, 'No enemies nearby.', '#ff8a8a'); return; }
      emit(p.z, p.x, p.y, { e: 'fx', k: 'nova', x: p.x, y: p.y, id: p.id });
      for (const m of hit) { m.slowUntil = now + 4000; damageMob(p, m, atk * 1.3 * rand(0.9, 1.1)); }
      ok = true;
    } else {
      const h = Math.round(p.st.mh * 0.45);
      p.hp = Math.min(p.st.mh, p.hp + h);
      emit(p.z, p.x, p.y, { e: 'fx', k: 'heal', x: p.x, y: p.y, id: p.id });
      emit(p.z, p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: h, k: 'h', id: p.id }); ok = true;
    }
  } else {
    if (n === 1) {
      if (!need(8)) return;
      emit(p.z, p.x, p.y, { e: 'fx', k: 'arrow', x: p.x, y: p.y, tx: t.x, ty: t.y, id: p.id, big: 1 });
      damageMob(p, t, atk * 2.3 * rand(0.9, 1.1)); ok = true;
    } else if (n === 2) {
      const hit = around(7).sort((a, b) => dist(p, a) - dist(p, b)).slice(0, 4);
      if (!hit.length) { log(p, 'No enemies in range.', '#ff8a8a'); return; }
      for (const m of hit) {
        emit(p.z, p.x, p.y, { e: 'fx', k: 'arrow', x: p.x, y: p.y, tx: m.x, ty: m.y, id: p.id });
        damageMob(p, m, atk * 1.3 * rand(0.9, 1.1));
      }
      ok = true;
    } else {
      p.sprintUntil = now + 6000;
      emit(p.z, p.x, p.y, { e: 'fx', k: 'dash', x: p.x, y: p.y, id: p.id }); ok = true;
    }
  }
  if (ok) {
    p.cd[n] = now + sk.cd;
    send(p, { t: 'ev', e: 'cd', n, ms: sk.cd });
    p.lastHit = now;
    p.dirty = true;
  }
}

// ---------------------------------------------------------------- zones & dungeon instances
const zoneMsg = (z) => ({
  t: 'zone', id: z.id, kind: z.kind, seed: z.seed || SEED, name: z.kind === 'dungeon' ? 'The Sunken Crypt' : 'Eldermoor',
  npcs: z.npcs.map(({ id, key: kk, name, role, x, y }) => ({ id, key: kk, name, role, x, y })),
});

function moveToZone(p, z, x, y) {
  unplace(p);
  p.z = z; p.x = x; p.y = y; place(p);
  p.target = null; p.want = null; p.dirty = true;
  send(p, zoneMsg(z));
}

function populateDungeon(z) {
  const fill = (rm, type) => {
    for (let tries = 0; tries < 40; tries++) {
      const x = rm.x + 1 + Math.floor(Math.random() * (rm.w - 2)), y = rm.y + 1 + Math.floor(Math.random() * (rm.h - 2));
      if (mobFree(z, x, y)) { spawnMob(z, type, x, y); return; }
    }
  };
  const mixes = [null, ['skeleton', 'ghoul'], ['skeleton', 'ghoul'], ['ghoul', 'wraith'], ['ghoul', 'wraith'], ['wraith', 'skeleton'], ['wraith', 'ghoul']];
  z.world.rooms.forEach((rm, i) => {
    if (rm.entry) return;
    if (rm.boss) {
      const b = nearestFree(z, rm.cx, rm.cy, mobFree, 4);
      spawnMob(z, 'bonelord', b.x, b.y);
      for (let k = 0; k < 6; k++) fill(rm, k % 2 ? 'skeleton' : 'wraith');
      return;
    }
    for (let k = 0; k < 4 + (i >> 1); k++) fill(rm, mixes[i][k % 2]);
  });
}

function makeDungeon(k) {
  const seed = DUNGEON_SEED + (nextInstance % 7);
  const z = makeZone(`crypt${nextInstance++}`, 'dungeon', generateDungeon(seed));
  z.seed = seed; z.key = k;
  const e = z.world.exit;
  z.npcs = [{ id: EXIT_ID, k: 'n', key: 'portal', name: 'Exit', role: 'portal', x: e.x, y: e.y }];
  for (const n of z.npcs) z.occ.set(key(n.x, n.y), n);
  populateDungeon(z);
  zones.set(z.id, z); instances.set(k, z);
  return z;
}

// One instance per party (or per solo hero): party members who step through later share it.
function enterDungeon(p) {
  if (p.dead) return;
  const k = p.party ? `p${p.party}` : `u${p.id}`;
  const z = instances.get(k) || makeDungeon(k);
  z.emptyAt = 0;
  const s = nearestFree(z, z.world.spawn.x, z.world.spawn.y);
  if (p.lvl < DUNGEON_REC_LVL) log(p, `The crypt is deadly below level ${DUNGEON_REC_LVL}. Tread carefully.`, '#ff9a3a');
  moveToZone(p, z, s.x, s.y);
  log(p, 'You step through the portal into the Sunken Crypt...', '#c06bff');
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
  if (m.god) p.god = true;
  if (m.lvl) p.lvl = Math.max(1, Math.min(MAX_LEVEL, m.lvl | 0));
  computeStats(p);
  if (m.god || m.lvl) p.hp = p.st.mh;
  p.dirty = true;
}

// ---------------------------------------------------------------- npc interaction
function talk(p, id) {
  const n = p.z.npcs.find((x) => x.id === id);
  if (!n || dist(p, n) > 4.5) return;
  if (n.role === 'portal') return p.z === overworld ? enterDungeon(p) : leaveDungeon(p);
  if (n.role === 'lore') return send(p, { t: 'dialog', npc: n.id, name: n.name, text: n.text });
  if (n.role === 'shop') {
    return send(p, {
      t: 'dialog', npc: n.id, name: n.name, text: 'Potions, blades, baubles - and I buy what you carry out of the wilds.',
      shop: SHOP.map((s) => ({ ...s })),
    });
  }
  const q = p.quest;
  if (q.i >= QUESTS.length) return send(p, { t: 'dialog', npc: n.id, name: n.name, text: 'You have done more for Eldermoor than any hero in living memory. Rest easy, champion.' });
  const Q = QUESTS[q.i];
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
      const n = npcByRole('quest');
      if (!nearNpc(p, n) || p.quest.i >= QUESTS.length || p.quest.s !== 0) return;
      p.quest.s = 1; p.quest.p = 0; p.dirty = true;
      log(p, `Quest accepted: ${QUESTS[p.quest.i].title}`, '#ffe066');
      break;
    }
    case 'questTurnIn': {
      const n = npcByRole('quest'), q = p.quest;
      if (!nearNpc(p, n) || q.i >= QUESTS.length || q.s !== 2) return;
      const Q = QUESTS[q.i];
      if (Q.reward && !p.inv.includes(null)) return log(p, 'Make room in your pack first.', '#ff8a8a');
      p.gold += Q.gold;
      giveXp(p, Q.xp);
      if (Q.reward) addItem(p, mkGear(pick(['weapon', 'armor', 'trinket']), 20, 3));
      log(p, `Quest complete! +${Q.xp} XP, +${Q.gold} gold.`, '#ffe066');
      q.i++; q.s = 0; q.p = 0; p.dirty = true;
      break;
    }
    case 'buy': {
      const n = npcByRole('shop'), it = SHOP[m.i | 0];
      if (!it || !nearNpc(p, n)) return;
      if (p.gold < it.price) return log(p, 'Not enough gold.', '#ff8a8a');
      const { price, ...base } = it;
      if (!addItem(p, { ...base, u: uid++, c: 1 })) return log(p, 'Your pack is full.', '#ff8a8a');
      p.gold -= it.price; p.dirty = true;
      send(p, { t: 'ev', e: 'coin' });
      break;
    }
    case 'sell': {
      const n = npcByRole('shop'), it = p.inv[m.slot | 0];
      if (!it || !nearNpc(p, n)) return;
      const gold = Math.max(1, Math.floor(it.v * 0.5)) * (it.c || 1);
      p.gold += gold; p.inv[m.slot | 0] = null; p.dirty = true;
      log(p, `Sold ${it.n} for ${gold} gold.`, '#ffd23a');
      send(p, { t: 'ev', e: 'coin' });
      break;
    }
    case 'equip': {
      const i = m.slot | 0, it = p.inv[i];
      if (!it || !(it.s in p.eq)) return;
      const req = Math.max(1, it.l - 2);
      if (p.lvl < req) return log(p, `You need level ${req} to use that.`, '#ff8a8a');
      p.inv[i] = p.eq[it.s]; p.eq[it.s] = it;
      computeStats(p); p.dirty = true;
      break;
    }
    case 'unequip': {
      const it = p.eq[m.s];
      if (!it) return;
      const i = p.inv.indexOf(null);
      if (i < 0) return log(p, 'Your pack is full.', '#ff8a8a');
      p.inv[i] = it; p.eq[m.s] = null;
      computeStats(p); p.dirty = true;
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
      const w = o.eq.weapon, a = o.eq.armor;
      ents.push({ i: o.id, k: 'p', x: o.x, y: o.y, f: o.f, h: o.hp, mh: o.st.mh, n: o.name, l: o.lvl, c: o.cls, d: o.dead ? 1 : 0, w: w ? w.b : '', wr: w ? w.r : 0, ar: a ? a.r : -1, sp: o.sprintUntil > now ? 1 : 0 });
    }
    for (const m of p.z.mobs.values()) {
      if (m.dead || Math.abs(m.x - p.x) > VX || Math.abs(m.y - p.y) > VY) continue;
      ents.push({ i: m.id, k: 'm', s: m.type, x: m.x, y: m.y, f: m.f, h: m.hp, mh: m.mh, l: m.lvl, st: m.stunUntil > now ? 1 : 0 });
    }
    for (const d of p.z.drops.values()) {
      if (Math.abs(d.x - p.x) > VX || Math.abs(d.y - p.y) > VY) continue;
      ents.push({ i: d.id, k: 'd', x: d.x, y: d.y, g: d.gold ? 1 : 0, b: d.item ? d.item.b : '', r: d.item ? d.item.r : 0, n: d.item ? d.item.n : `${d.gold} gold` });
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
    if (p.want && now >= p.moveAt) {
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
    if (p.buffs.atk && p.buffs.atk < now) { delete p.buffs.atk; computeStats(p); p.dirty = true; }
    if (now >= p.regenAt) {
      p.regenAt = now + 1000;
      if (p.hp < p.st.mh && now - p.lastHit > 5000) { p.hp = Math.min(p.st.mh, p.hp + Math.max(1, Math.round(p.st.mh * (safeAt(p.z, p.x, p.y) ? 0.08 : 0.02)))); p.dirty = true; }
    }
  }
  for (const z of zones.values()) {
    if (z !== overworld && z.emptyAt) continue; // an empty instance sleeps until its timeout
    for (const m of z.mobs.values()) mobAI(m, now);
    for (const d of z.drops.values()) if (now > d.exp) z.drops.delete(d.id);
  }
  if (tickN % 20 === 0) reapInstances(now);
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
    return res.end(JSON.stringify({ name: 'eldermoor', online: players.size, parties: parties.size, instances: instances.size, mobs: liveMobs(overworld).length, uptime: Math.round(process.uptime()) }));
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
