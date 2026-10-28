// Eldermoor authoritative game server: HTTP (static client) + WebSocket (game).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { W, G, TOWN, BOSS, CAMP, inTown, generateWorld, isSolid } from '../shared/world.js';
import {
  SEED, TICK_MS, MAX_LEVEL, INV_SIZE, CLASSES, MOBS, QUESTS, RARITY, NPCS, xpForLevel,
} from '../shared/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAVE_FILE = path.join(ROOT, 'data', 'saves.json');
const PORT = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------- helpers
const world = generateWorld(SEED);
const key = (x, y) => y * W + x;
const solid = (x, y) => isSolid(world, x, y);
const rand = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rand(a, b + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const face = (dx, dy) => (dy > 0 ? 0 : dy < 0 ? 1 : dx < 0 ? 2 : 3);

let nextId = 100;
const players = new Map(); // id -> player
const mobs = new Map();
const drops = new Map();
const occ = new Map(); // tile -> entity (players, mobs, npcs)
const npcs = NPCS.map((n) => ({ ...n, k: 'n' }));
for (const n of npcs) occ.set(key(n.x, n.y), n);

const place = (e) => occ.set(key(e.x, e.y), e);
const unplace = (e) => { if (occ.get(key(e.x, e.y)) === e) occ.delete(key(e.x, e.y)); };
const free = (x, y) => !solid(x, y) && !occ.has(key(x, y));
const mobFree = (x, y) => free(x, y) && !inTown(x, y);

function nearestFree(x, y, ok = free, maxR = 6) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (ok(x + dx, y + dy)) return { x: x + dx, y: y + dy };
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
    inv: p.inv, eq: p.eq, quest: p.quest, x: p.x, y: p.y, hp: p.hp,
  };
  savesDirty = true;
}
const hashPass = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');

// ---------------------------------------------------------------- networking helpers
const send = (p, o) => { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); };
const log = (p, m, c = '#ddd') => send(p, { t: 'log', m, c });
function emit(x, y, ev) {
  const s = JSON.stringify({ t: 'ev', ...ev });
  for (const p of players.values()) {
    if (Math.abs(p.x - x) < 32 && Math.abs(p.y - y) < 22 && p.ws.readyState === 1) p.ws.send(s);
  }
}
const sayAll = (m, c) => { for (const p of players.values()) log(p, m, c); };

// ---------------------------------------------------------------- players
function computeStats(p) {
  const c = CLASSES[p.cls];
  let atk = c.atk + c.atkL * p.lvl, def = p.lvl * 1.2, mh = c.hp + c.hpL * p.lvl;
  for (const it of Object.values(p.eq)) if (it) { atk += it.atk; def += it.def; mh += it.hp; }
  if (p.buffs.atk > Date.now()) atk *= 1.35;
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
  p.chatAt = 0; p.sprintUntil = 0;
  computeStats(p);
  if (!saved) p.hp = p.st.mh;
  const spot = nearestFree(saved ? p.x : world.spawn.x, saved ? p.y : world.spawn.y) || nearestFree(world.spawn.x, world.spawn.y);
  p.x = spot.x; p.y = spot.y;
  if (p.hp <= 0) p.hp = p.st.mh;
  place(p);
  players.set(p.id, p);
  ws.player = p;
  send(p, {
    t: 'welcome', id: p.id, seed: SEED, npcs: npcs.map(({ id, key: kk, name: nn, role, x, y }) => ({ id, key: kk, name: nn, role, x, y })),
    classes: Object.keys(CLASSES),
  });
  send(p, meMsg(p));
  log(p, `Welcome to Eldermoor, ${p.name}.`, '#ffe066');
  sayAll(`${p.name} the ${CLASSES[p.cls].name} has arrived.`, '#9fd0ff');
  savePlayer(p);
}

function dropPlayer(p) {
  if (!players.has(p.id)) return;
  savePlayer(p);
  writeSaves();
  unplace(p);
  players.delete(p.id);
  for (const m of mobs.values()) if (m.target === p.id) m.target = null;
  sayAll(`${p.name} has left.`, '#888');
}

function tryMove(p, dx, dy, now) {
  p.f = face(dx, dy);
  const nx = p.x + dx, ny = p.y + dy;
  if (!free(nx, ny)) return false;
  unplace(p); p.x = nx; p.y = ny; place(p);
  p.moveAt = now + (p.sprintUntil > now ? 95 : 150);
  for (const d of drops.values()) if (d.x === nx && d.y === ny) pickup(p, d);
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
  drops.delete(d.id);
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
    emit(p.x, p.y, { e: 'fx', k: 'levelup', x: p.x, y: p.y, id: p.id });
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
  emit(p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: amt, k: 'p', id: p.id });
  p.dirty = true;
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.respawnAt = Date.now() + 4000; p.target = null; p.want = null;
    emit(p.x, p.y, { e: 'fx', k: 'die', x: p.x, y: p.y, id: p.id });
    log(p, `You were slain by ${from}. Returning to town...`, '#ff6a6a');
  }
}

function respawn(p) {
  unplace(p);
  const s = nearestFree(world.spawn.x, world.spawn.y);
  p.x = s.x; p.y = s.y; place(p);
  p.dead = false; p.hp = p.st.mh; p.dirty = true;
  emit(p.x, p.y, { e: 'fx', k: 'heal', x: p.x, y: p.y, id: p.id });
}

// ---------------------------------------------------------------- mobs
function spawnMob(type, x, y) {
  const def = MOBS[type];
  const lvl = def.boss ? def.lvl : Math.max(1, def.lvl + ri(-1, 1));
  const m = {
    id: nextId++, k: 'm', type, x, y, hx: x, hy: y, f: 0, lvl,
    mh: Math.round(def.hp * (1 + (lvl - def.lvl) * 0.12)), hp: 0, target: null, returning: false,
    moveAt: 0, atkAt: 0, wanderAt: 0, stunUntil: 0, slowUntil: 0, dead: false, respawnAt: 0, dmgBy: new Map(),
  };
  m.hp = m.mh;
  mobs.set(m.id, m);
  place(m);
  return m;
}

function populate() {
  const around = (type, n, cx, cy, r0, r1, grounds) => {
    let made = 0, tries = 0;
    while (made < n && tries++ < n * 60) {
      const a = Math.random() * Math.PI * 2, r = rand(r0, r1);
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (!mobFree(x, y) || inTown(x, y)) continue;
      if (grounds && !grounds.includes(world.g[key(x, y)])) continue;
      if (world.g[key(x, y)] === G.PATH && Math.random() < 0.7) continue;
      spawnMob(type, x, y); made++;
    }
  };
  around('slime', 40, TOWN.cx, TOWN.cy, 15, 30, [G.GRASS, G.FOREST]);
  around('wolf', 30, TOWN.cx, TOWN.cy, 26, 42, [G.FOREST, G.GRASS]);
  around('bat', 16, TOWN.cx, TOWN.cy, 32, 54, [G.FOREST, G.SWAMP]);
  around('goblin', 28, TOWN.cx, TOWN.cy, 34, 52, [G.FOREST, G.SWAMP]);
  around('skeleton', 16, CAMP.x, CAMP.y, 0, 13);
  around('skeleton', 10, BOSS.x, BOSS.y, 11, 20);
  const b = nearestFree(BOSS.x, BOSS.y, mobFree);
  spawnMob('golem', b.x, b.y);
}

function stepMob(m, tx, ty, now) {
  const def = MOBS[m.type];
  const dx = Math.sign(tx - m.x), dy = Math.sign(ty - m.y);
  const horizFirst = Math.abs(tx - m.x) >= Math.abs(ty - m.y);
  const tries = horizFirst ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
  const side = Math.random() < 0.5 ? 1 : -1;
  tries.push(horizFirst ? [0, side] : [side, 0]);
  for (const [sx, sy] of tries) {
    if ((sx || sy) && mobFree(m.x + sx, m.y + sy)) {
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
      const s = nearestFree(m.hx, m.hy, mobFree, 3);
      if (!s) { m.respawnAt = now + 2000; return; }
      m.x = s.x; m.y = s.y; m.hp = m.mh; m.dead = false; m.target = null; m.dmgBy.clear(); place(m);
    }
    return;
  }
  if (now < m.stunUntil) return;
  let t = m.target ? players.get(m.target) : null;
  if (t && (t.dead || inTown(t.x, t.y) || dist(m, t) > def.leash + 6 || Math.hypot(m.x - m.hx, m.y - m.hy) > def.leash + 10)) {
    t = null; m.target = null; m.returning = true;
  }
  if (!t && !m.returning) {
    let best = null, bd = def.aggro;
    for (const p of players.values()) {
      if (p.dead || inTown(p.x, p.y)) continue;
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
        emit(m.x, m.y, { e: 'fx', k: def.range > 2.5 ? 'arrow' : 'swing', x: m.x, y: m.y, tx: t.x, ty: t.y, id: m.id });
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
    if (Math.hypot(nx - m.hx, ny - m.hy) <= 5 && mobFree(nx, ny)) {
      unplace(m); m.x = nx; m.y = ny; place(m); m.f = face(sx, sy);
    }
  }
}

function dropLoot(m) {
  const def = MOBS[m.type];
  const put = (item, gold) => {
    const s = nearestFree(m.x, m.y, (x, y) => !solid(x, y) && ![...drops.values()].some((d) => d.x === x && d.y === y), 3) || { x: m.x, y: m.y };
    const d = { id: nextId++, x: s.x, y: s.y, exp: Date.now() + 90000, gold, item };
    drops.set(d.id, d);
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
  m.dead = true; m.respawnAt = Date.now() + def.respawn; unplace(m);
  emit(m.x, m.y, { e: 'fx', k: 'die', x: m.x, y: m.y, id: m.id });
  dropLoot(m);
  let total = 0;
  for (const v of m.dmgBy.values()) total += v;
  for (const [pid, dmg] of m.dmgBy) {
    const p = players.get(pid);
    if (!p || p.dead || dist(p, m) > 25) continue;
    const share = pid === killer.id ? 1 : Math.min(0.6, dmg / Math.max(1, total));
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
  if (def.boss) sayAll(`${killer.name} has slain the ${def.name}!`, '#ff9a3a');
}

function damageMob(p, m, amount, crit = false) {
  if (m.dead) return;
  const amt = Math.max(1, Math.round(amount));
  m.hp -= amt;
  m.dmgBy.set(p.id, (m.dmgBy.get(p.id) || 0) + amt);
  if (!m.target || Math.random() < 0.15) { m.target = p.id; m.returning = false; }
  emit(m.x, m.y, { e: 'dmg', x: m.x, y: m.y, v: amt, k: crit ? 'c' : 'm', id: m.id });
  if (m.hp <= 0) killMob(m, p);
}

// ---------------------------------------------------------------- combat & skills
const liveMobs = () => [...mobs.values()].filter((m) => !m.dead);
function nearestMob(p, range) {
  let best = null, bd = range;
  for (const m of liveMobs()) { const d = dist(p, m); if (d <= bd) { bd = d; best = m; } }
  return best;
}
const targetOf = (p) => { const m = p.target && mobs.get(p.target); return m && !m.dead ? m : null; };

function basicAttack(p, m, now) {
  const c = CLASSES[p.cls];
  p.atkAt = now + c.atkMs;
  const crit = Math.random() < 0.1;
  const dmg = p.st.atk * (0.85 + Math.random() * 0.3) * (crit ? 1.8 : 1);
  const k = p.cls === 'warrior' ? 'swing' : p.cls === 'mage' ? 'bolt' : 'arrow';
  p.f = Math.abs(m.x - p.x) >= Math.abs(m.y - p.y) ? (m.x > p.x ? 3 : 2) : (m.y > p.y ? 0 : 1);
  emit(p.x, p.y, { e: 'fx', k, x: p.x, y: p.y, tx: m.x, ty: m.y, id: p.id });
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
  const around = (r) => liveMobs().filter((m) => dist(p, m) <= r);
  const atk = p.st.atk;
  let ok = false;
  const cls = p.cls;
  if (cls === 'warrior') {
    if (n === 1) {
      const hit = around(1.9);
      if (!hit.length) { log(p, 'No enemies nearby.', '#ff8a8a'); return; }
      emit(p.x, p.y, { e: 'fx', k: 'cleave', x: p.x, y: p.y, id: p.id });
      for (const m of hit) damageMob(p, m, atk * 1.4 * rand(0.9, 1.1));
      ok = true;
    } else if (n === 2) {
      if (!need(1.6)) return;
      emit(t.x, t.y, { e: 'fx', k: 'bash', x: t.x, y: t.y, id: p.id });
      t.stunUntil = now + 2000;
      damageMob(p, t, atk * rand(0.95, 1.1)); ok = true;
    } else {
      p.buffs.atk = now + 8000; computeStats(p);
      p.hp = Math.min(p.st.mh, p.hp + Math.round(p.st.mh * 0.15));
      emit(p.x, p.y, { e: 'fx', k: 'cry', x: p.x, y: p.y, id: p.id }); ok = true;
    }
  } else if (cls === 'mage') {
    if (n === 1) {
      if (!need(7)) return;
      emit(p.x, p.y, { e: 'fx', k: 'fire', x: p.x, y: p.y, tx: t.x, ty: t.y, id: p.id });
      damageMob(p, t, atk * 2.4 * rand(0.9, 1.1)); ok = true;
    } else if (n === 2) {
      const hit = around(3.2);
      if (!hit.length) { log(p, 'No enemies nearby.', '#ff8a8a'); return; }
      emit(p.x, p.y, { e: 'fx', k: 'nova', x: p.x, y: p.y, id: p.id });
      for (const m of hit) { m.slowUntil = now + 4000; damageMob(p, m, atk * 1.3 * rand(0.9, 1.1)); }
      ok = true;
    } else {
      const h = Math.round(p.st.mh * 0.45);
      p.hp = Math.min(p.st.mh, p.hp + h);
      emit(p.x, p.y, { e: 'fx', k: 'heal', x: p.x, y: p.y, id: p.id });
      emit(p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: h, k: 'h', id: p.id }); ok = true;
    }
  } else {
    if (n === 1) {
      if (!need(8)) return;
      emit(p.x, p.y, { e: 'fx', k: 'arrow', x: p.x, y: p.y, tx: t.x, ty: t.y, id: p.id, big: 1 });
      damageMob(p, t, atk * 2.3 * rand(0.9, 1.1)); ok = true;
    } else if (n === 2) {
      const hit = around(7).sort((a, b) => dist(p, a) - dist(p, b)).slice(0, 4);
      if (!hit.length) { log(p, 'No enemies in range.', '#ff8a8a'); return; }
      for (const m of hit) {
        emit(p.x, p.y, { e: 'fx', k: 'arrow', x: p.x, y: p.y, tx: m.x, ty: m.y, id: p.id });
        damageMob(p, m, atk * 1.3 * rand(0.9, 1.1));
      }
      ok = true;
    } else {
      p.sprintUntil = now + 6000;
      emit(p.x, p.y, { e: 'fx', k: 'dash', x: p.x, y: p.y, id: p.id }); ok = true;
    }
  }
  if (ok) {
    p.cd[n] = now + sk.cd;
    send(p, { t: 'ev', e: 'cd', n, ms: sk.cd });
    p.lastHit = now;
    p.dirty = true;
  }
}

// ---------------------------------------------------------------- npc interaction
function talk(p, id) {
  const n = npcs.find((x) => x.id === id);
  if (!n || dist(p, n) > 4.5) return;
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
      p.target = id && mobs.has(id) && !mobs.get(id).dead ? id : null;
      p.dirty = true;
      break;
    }
    case 'skill': if (!p.dead) useSkill(p, m.n | 0, now); break;
    case 'chat': {
      let text = String(m.m || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
      if (!text || now - p.chatAt < 600) return;
      p.chatAt = now;
      if (text === '/who') return log(p, `Online: ${[...players.values()].map((x) => `${x.name} (L${x.lvl})`).join(', ')}`, '#9fd0ff');
      for (const o of players.values()) send(o, { t: 'chat', n: p.name, m: text, id: p.id });
      break;
    }
    case 'talk': talk(p, m.id | 0); break;
    case 'questAccept': {
      const n = npcs[0];
      if (dist(p, n) > 4.5 || p.quest.i >= QUESTS.length || p.quest.s !== 0) return;
      p.quest.s = 1; p.quest.p = 0; p.dirty = true;
      log(p, `Quest accepted: ${QUESTS[p.quest.i].title}`, '#ffe066');
      break;
    }
    case 'questTurnIn': {
      const n = npcs[0], q = p.quest;
      if (dist(p, n) > 4.5 || q.i >= QUESTS.length || q.s !== 2) return;
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
      const n = npcs[1], it = SHOP[m.i | 0];
      if (!it || dist(p, n) > 4.5) return;
      if (p.gold < it.price) return log(p, 'Not enough gold.', '#ff8a8a');
      const { price, ...base } = it;
      if (!addItem(p, { ...base, u: uid++, c: 1 })) return log(p, 'Your pack is full.', '#ff8a8a');
      p.gold -= it.price; p.dirty = true;
      send(p, { t: 'ev', e: 'coin' });
      break;
    }
    case 'sell': {
      const n = npcs[1], it = p.inv[m.slot | 0];
      if (!it || dist(p, n) > 4.5) return;
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
      emit(p.x, p.y, { e: 'dmg', x: p.x, y: p.y, v: h, k: 'h', id: p.id });
      emit(p.x, p.y, { e: 'fx', k: 'heal', x: p.x, y: p.y, id: p.id });
      send(p, { t: 'ev', e: 'pot', ms: 6000 });
      p.dirty = true;
      break;
    }
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
      if (Math.abs(o.x - p.x) > VX || Math.abs(o.y - p.y) > VY) continue;
      const w = o.eq.weapon, a = o.eq.armor;
      ents.push({ i: o.id, k: 'p', x: o.x, y: o.y, f: o.f, h: o.hp, mh: o.st.mh, n: o.name, l: o.lvl, c: o.cls, d: o.dead ? 1 : 0, w: w ? w.b : '', wr: w ? w.r : 0, ar: a ? a.r : -1, sp: o.sprintUntil > now ? 1 : 0 });
    }
    for (const m of mobs.values()) {
      if (m.dead || Math.abs(m.x - p.x) > VX || Math.abs(m.y - p.y) > VY) continue;
      ents.push({ i: m.id, k: 'm', s: m.type, x: m.x, y: m.y, f: m.f, h: m.hp, mh: m.mh, l: m.lvl, st: m.stunUntil > now ? 1 : 0 });
    }
    for (const d of drops.values()) {
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
      if (p.hp < p.st.mh && now - p.lastHit > 5000) { p.hp = Math.min(p.st.mh, p.hp + Math.max(1, Math.round(p.st.mh * (inTown(p.x, p.y) ? 0.08 : 0.02)))); p.dirty = true; }
    }
  }
  for (const m of mobs.values()) mobAI(m, now);
  for (const d of drops.values()) if (now > d.exp) drops.delete(d.id);
  if (tickN % 2 === 0) broadcast(now);
}

// ---------------------------------------------------------------- http + ws
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/client/index.html';
  if (url === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ name: 'eldermoor', online: players.size, mobs: liveMobs().length, uptime: Math.round(process.uptime()) }));
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
server.listen(PORT, () => console.log(`Eldermoor listening on http://localhost:${PORT}  (${mobs.size} monsters)`));
