// Eldermoor client: rendering, input, networking and UI.
import { W, H, G, O, TOWN, TOWNS, BOSSES, generateWorld, generateDungeon, isSolid, inTown, regionAt } from '/shared/world.js';
import { SEED, MOBS, QUESTS, RARITY, NPCS } from '/shared/data.js';
import { JOBS, JOB_ORDER, SKILLS, ATTRS, ATTR_INFO, EFFECTS, skillsOfJob } from '/shared/jobs.js';
import { EQ_KEYS, EQ_LABEL, LOOK_LIMITS, LOOK_LABELS, LOOK_COST, SKIN_TONES, HAIR_STYLES, HAIR_COLORS, EYE_COLORS, STARTER_KIT, defaultLook, visTokens, eqKeyFor } from '/shared/gear.js';
import * as SP from '/client/sprites.js';
import * as HERO from '/client/hero32.js';
import { TS, CHUNK, buildWorldArt, drawWaterTile, drawLavaTile, treeSprite } from '/client/gfx.js';
import { DEEDS, titleText } from '/shared/deeds.js';
import { GAMEPAD_HELP, moveFocusIndex, readGamepad } from '/client/input.js';

const $ = (id) => document.getElementById(id);
const worldOver = generateWorld(SEED);
const artOver = buildWorldArt(worldOver);
let world = worldOver, art = artOver; // swapped when the server moves us into a dungeon instance
let zoneKind = 'world', zoneId = 'world', zoneTheme = 'world', zoneName = 'Eldermoor';
const dungeonCache = new Map(); // seed -> { world, art }
const BIG = new Set(['golem', 'bonelord', 'sandgolem', 'icegolem', 'obsidiangolem', 'sunking', 'rimefang', 'cinderwing', 'moltengolem', 'emberlord']);
const HUMANOID = new Set(['goblin', 'skeleton', 'ghoul', 'wraith', 'mummy', 'frostsprite', 'yeti', 'emberknight', 'emberacolyte']);
const FLYERS = new Set(['bat', 'frostowl', 'imp']);
const SLIMES = new Set(['slime', 'frostslime', 'magmaslime']);

// ------------------------------------------------------------------ canvas setup
const screen = $('screen'), sctx = screen.getContext('2d');
const wc = document.createElement('canvas'), wx = wc.getContext('2d');
const lm = document.createElement('canvas'), lx = lm.getContext('2d');
let S = 3, VW = 0, VH = 0;
function resize() {
  if (innerWidth < 64 || innerHeight < 64) return; // hidden / minimised: keep the last good size
  S =Math.max(2, Math.min(6, Math.floor(Math.min(innerWidth / 320, innerHeight / 190))));
  VW = Math.min(W * TS, Math.ceil(innerWidth / S)); VH = Math.min(H * TS, Math.ceil(innerHeight / S));
  screen.width = VW * S; screen.height = VH * S;
  wc.width = lm.width = VW; wc.height = lm.height = VH;
  sctx.imageSmoothingEnabled = false;
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ state
let ws = null, myId = 0, inGame = false;
const ents = new Map();
let npcs = NPCS.map((n) => ({ ...n }));
const fxs = [], parts = [], floaters = [];
let me = null; // private state from server
let packetN = 0, timeOff = 0;
const skillReady = {}; // skill id -> ready time
let gcdUntil = 0, meAt = 0, lastBuffDraw = 0;
let potReady = 0;
let goal = null, nextStep = 0, shake = 0;
const keys = new Set();
let camX = 0, camY = 0;
let selClass = 'warrior',  selSlot = -1, shopOpen = false, dialogNpc = 0;
const chatLines = [];
let party = { id: 0, leader: 0, members: [] };
const pmData = new Map(); // member id -> { h, mh, x, y } from the server's party tick
let pendingInvite = null; // incoming party { from, name, until } | incoming trade { kind:'trade', from, name, until } | player menu { menu: id, name }
let tradeView = null; // latest server state of the open trade window
const inParty = (id) => party.members.some((m) => m.id === id);
const skinOf = (id) => id % 4;
const now = () => performance.now();

// ------------------------------------------------------------------ audio
let actx = null, muted = localStorage.getItem('em_mute') === '1';
function beep(freq, dur, type = 'square', vol = 0.04, slide = 0, delay = 0) {
  if (muted || !actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  const lv = vol * (settings.vol / 0.7);
  g.gain.setValueAtTime(Math.max(0.0002, lv), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  hit: () => beep(200, 0.08, 'square', 0.05, -120),
  crit: () => { beep(320, 0.1, 'square', 0.06, -200); beep(480, 0.08, 'triangle', 0.05, -100, 0.03); },
  hurt: () => beep(120, 0.14, 'sawtooth', 0.05, -60),
  skill: () => beep(260, 0.18, 'triangle', 0.05, 300),
  pickup: () => { beep(660, 0.06, 'square', 0.04); beep(990, 0.08, 'square', 0.04, 0, 0.05); },
  coin: () => { beep(988, 0.05, 'square', 0.04); beep(1319, 0.12, 'square', 0.04, 0, 0.05); },
  level: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.18, 'square', 0.05, 0, i * 0.1)),
  die: () => beep(220, 0.5, 'sawtooth', 0.06, -170),
  click: () => beep(500, 0.03, 'square', 0.03),
};

// ---- ambient music: slow generated phrases; the scale and register follow where you are
const SCALES = { town: [0, 2, 4, 7, 9], field: [0, 2, 3, 5, 7, 9, 10], dark: [0, 1, 3, 5, 7, 8, 10], ice: [0, 2, 4, 6, 7, 9, 11], fire: [0, 1, 4, 5, 7, 8, 11] };
const ROOTS = { town: 262, field: 196, dark: 110, ice: 294, fire: 147 };
const music = { next: 0, n: 0 };
function note(freq, dur, vol, type = 'sine', attack = 0.25) {
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  const lv = Math.max(0.0002, vol * (settings.vol / 0.7));
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(lv, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.05);
}
function musicTick() {
  if (!actx || muted || !settings.music || !me || document.hidden || actx.currentTime < music.next) return;
  const mood = zoneKind === 'dungeon' ? (SCALES[zoneTheme] ? zoneTheme : 'dark') : inTown(me.x, me.y) ? 'town' : 'field';
  const sc = SCALES[mood], root = ROOTS[mood], i = Math.floor(Math.random() * sc.length), oct = Math.random() < 0.3 ? 2 : 1;
  note(root * Math.pow(2, sc[i] / 12) * oct, mood === 'dark' ? 3.2 : 2.2, mood === 'town' ? 0.022 : 0.018, mood === 'ice' ? 'triangle' : 'sine');
  if (Math.random() < 0.35) note(root * Math.pow(2, sc[(i + 2) % sc.length] / 12) * oct, 2.4, 0.012, 'sine', 0.4); // a third above
  if (music.n++ % 4 === 0) note(root / 2, 5, 0.02, 'sine', 0.8); // a slow drone underneath
  music.next = actx.currentTime + (mood === 'dark' ? 1.8 : 0.9) + Math.random() * 1.6;
}
setInterval(musicTick, 300);

// ------------------------------------------------------------------ icons
const urlCache = new Map();
const iconURL = (b, r, cl = '') => { const k = `${b}${r}${cl}`; if (!urlCache.has(k)) urlCache.set(k, SP.itemIcon(b, r, cl).toDataURL()); return urlCache.get(k); };
const statParts = (it) => {
  const out = [];
  if (it.atk) out.push(`+${it.atk} ATK`);
  if (it.def) out.push(`+${it.def} DEF`);
  if (it.hp) out.push(`+${it.hp} HP`);
  for (const [k, v] of Object.entries(it.a || {})) out.push(`+${v} ${k.toUpperCase()}`);
  if (it.crit) out.push(`+${it.crit}% crit`);
  if (it.dodge) out.push(`+${it.dodge}% dodge`);
  if (it.heal) out.push(`heals ${it.heal}`);
  return out;
};
// ---- item comparison: stat deltas against what is worn in the slot the item would take
const statMap = (it) => {
  const o = {};
  if (!it) return o;
  if (it.atk) o.ATK = it.atk;
  if (it.def) o.DEF = it.def;
  if (it.hp) o.HP = it.hp;
  for (const [k, v] of Object.entries(it.a || {})) o[k.toUpperCase()] = (o[k.toUpperCase()] || 0) + v;
  if (it.crit) o['% crit'] = it.crit;
  if (it.dodge) o['% dodge'] = it.dodge;
  return o;
};
/** the equipped item this one would replace (rings: a free ring slot first, else ring 1, as the server does); null = nothing worn */
const worn = (it) => (me && it && it.s !== 'potion' && eqKeyFor(me.eq, it) ? me.eq[eqKeyFor(me.eq, it)] : null);
const wearsSlot = (it) => !!(me && it && eqKeyFor(me.eq, it));
/** [{ label, d }] for every stat that changes, biggest gain first; empty when nothing changes */
function statDeltas(it, cur) {
  const a = statMap(it), b = statMap(cur), out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (a[k] || 0) - (b[k] || 0);
    if (d) out.push({ label: k, d });
  }
  return out.sort((x, y) => y.d - x.d);
}
const fmtDelta = ({ label, d }) => {
  const txt = `${d > 0 ? '+' : '-'}${Math.abs(d)}${label.startsWith('%') ? '' : ' '}${label}`;
  return `<span class="${d > 0 ? 'dUp' : 'dDown'}">${txt}</span>`;
};
const deltaFor = (it, cur, tag = '') => {
  const ds = statDeltas(it, cur);
  return `<span class="small">${cur ? `vs ${esc(cur.n)}${tag}` : 'vs empty slot'}</span> ` + (ds.length ? ds.map(fmtDelta).join(' ') : '<span class="small">no change</span>');
};
const deltaLine = (it, full = false) => {
  if (!wearsSlot(it)) return '';
  const cur = worn(it);
  // both ring slots taken: equipping replaces ring 1, but show ring 2 too so the player can pick which to swap out
  if (full && it.s === 'ring' && me.eq.ring1 && me.eq.ring2) return `${deltaFor(it, me.eq.ring1, ' (ring 1, replaced)')}<br>${deltaFor(it, me.eq.ring2, ' (ring 2)')}`;
  return deltaFor(it, cur);
};
const skillURL = (id) => { const k = `sk${id}`; if (!urlCache.has(k)) urlCache.set(k, SP.skillIcon(id).toDataURL()); return urlCache.get(k); };

// ------------------------------------------------------------------ networking
function connect(name, pass, cls, look) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'login', name, pass, cls, look, delta: true }));
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = (e) => {
    if (inGame) { $('dcWhy').textContent = e.reason || 'Connection lost.'; $('dc').classList.remove('hidden'); }
    else { $('enter').disabled = false; if (!$('loginErr').textContent) $('loginErr').textContent = 'Could not reach the server.'; }
  };
}
const tx = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      myId = m.id; applyZone(m.zone); inGame = true;
      $('login').classList.add('hidden'); $('ui').classList.remove('hidden');
      queueMicrotask(() => showTutorial());
      break;
    case 'err': $('loginErr').textContent = m.m; ws.close(); break;
    case 's': applyState(m); break;
    case 'me': me = m; onMe(); break;
    case 'log': addLine(`<span style="color:${m.c}">${esc(m.m)}</span>`); break;
    case 'zone': applyZone(m); break;
    case 'trade_inv':
      pendingInvite = { kind: 'trade', from: m.from, name: m.name, until: now() + 30000 };
      showInvite(); sfx.click();
      break;
    case 'trade':
      tradeView = m; renderTrade();
      if (innerWidth > 900) $('inv').classList.remove('hidden'); // wide screens: window and pack sit side by side
      if (me) renderInv();
      break;
    case 'trade_end':
      tradeView = null; $('trade').classList.add('hidden'); $('inv').classList.remove('front');
      if (m.ok) { sfx.coin(); banner('TRADE COMPLETE'); } else toast(`Trade cancelled: ${m.why}`);
      if (me) renderInv();
      break;
    case 'party': party = m; pmData.clear(); renderParty(); break;
    case 'pm': for (const r of m.m) pmData.set(r.id, r); renderParty(); break;
    case 'pinv':
      pendingInvite = { from: m.from, name: m.name, until: now() + 30000 };
      showInvite(); sfx.click();
      break;
    case 'chat': {
      if (m.ch === 'w') {
        if (m.dir === 'from') lastWhisper = m.n;
        addLine(`<span style="color:#e08aff">${m.dir === 'to' ? 'To' : 'From'} ${esc(m.n)}</span>: <span style="color:#f0c8ff">${esc(m.m)}</span>`);
        if (m.dir === 'from') sfx.click();
        break;
      }
      if (m.ch === 'party') addLine(`<span style="color:#6ab8ff">[Party] ${esc(m.n)}</span>: ${esc(m.m)}`);
      else addLine(`<span style="color:${m.id === myId ? '#8be88b' : '#9fd0ff'}">${esc(m.n)}</span>: ${esc(m.m)}`);
      const e = ents.get(m.id); if (e) { e.say = m.m; e.sayAt = now(); }
      break;
    }
    case 'dialog': openDialog(m); break;
    case 'ev': onEvent(m); break;
    default:
  }
}

function applyZone(z) {
  zoneKind = z.kind; zoneId = z.id; zoneTheme = z.theme || 'world'; zoneName = z.name || 'Eldermoor';
  if (z.kind === 'dungeon') {
    const ck = `${z.seed}:${zoneTheme}`;
    if (!dungeonCache.has(ck)) { const w = generateDungeon(z.seed, zoneTheme); dungeonCache.set(ck, { world: w, art: buildWorldArt(w) }); }
    ({ world, art } = dungeonCache.get(ck));
  } else { world = worldOver; art = artOver; }
  npcs = z.npcs.map((n) => ({ ...n }));
  ents.clear(); fxs.length = 0; parts.length = 0; floaters.length = 0; goal = null;
  closeDialog();
  if (z.kind === 'dungeon') banner(z.name);
}

function applyState(m) {
  packetN++;
  timeOff = m.tm - Date.now();
  for (const e of m.e) {
    let o = ents.get(e.i);
    if (!o) { o = { rx: e.x, ry: e.y, born: now(), atkAt: 0, hitAt: 0, dying: 0 }; ents.set(e.i, o); }
    const wasD = o.d;
    Object.assign(o, e, { seen: packetN });
    if (o.k === 'p' && o.d && !wasD && o.i !== myId) o.rx = o.x;
  }
  if (m.d) { // delta packet: only changed entities arrived; `r` lists the ones that left view
    for (const id of m.r) {
      const o = ents.get(id);
      if (!o || (o.dying && now() - o.dying < 700)) continue;
      if (o.k === 'm' && !o.dying) { o.dying = now(); continue; }
      ents.delete(id);
    }
    return;
  }
  for (const [id, o] of ents) {
    if (o.seen === packetN) continue;
    if (o.dying && now() - o.dying < 700) continue;
    if (o.k === 'm' && !o.dying) { o.dying = now(); continue; }
    ents.delete(id);
  }
}

// ------------------------------------------------------------------ events & fx
const tc = (x, y) => [x * TS + 8, y * TS + 8];
function burst(x, y, col, n = 8, spd = 30, life = 400, size = 1) {
  if (!settings.motion) { n = Math.min(n, 2); life = Math.min(life, 180); }
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random() * 0.8);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, t0: now(), life: life * (0.6 + Math.random() * 0.6), col: Array.isArray(col) ? col[i % col.length] : col, size });
  }
}
function onEvent(m) {
  const t = now();
  switch (m.e) {
    case 'dmg': {
      const [px, py] = tc(m.x, m.y);
      if (m.k === 'x' || m.k === 'a') { floaters.push({ x: px, y: py - 8, txt: m.k === 'x' ? 'Miss' : 'Absorbed', col: m.k === 'x' ? '#b8b8c8' : '#ffe8a0', t0: t }); break; }
      const col = m.k === 'p' ? '#ff5a5a' : m.k === 'h' ? '#6aff8a' : m.k === 'c' ? '#ffe066' : m.k === 'd' ? '#ff9a3a' : '#ffffff';
      if (settings.dmg) floaters.push({ x: px + (Math.random() * 8 - 4), y: py - 8, txt: m.k === 'h' ? `+${m.v}` : m.k === 'c' ? `${m.v}!` : `${m.v}`, col, t0: t, big: m.k === 'c' });
      const e = ents.get(m.id);
      if (e && m.k !== 'h') e.hitAt = t;
      if (m.k === 'p') { burst(px, py, ['#ff5a5a', '#a02828'], 6, 28, 350); if (m.id === myId) { if (settings.shake) shake = 4; sfx.hurt(); if (touchMode && navigator.vibrate) navigator.vibrate(25); } }
      else if (m.k === 'm' || m.k === 'c') { burst(px, py, ['#fff', '#ffe066'], m.k === 'c' ? 10 : 5, 30, 260); (m.k === 'c' ? sfx.crit : sfx.hit)(); }
      break;
    }
    case 'fx': {
      if (m.k === 'proj') m = { ...m, k: m.vis }; // projectiles arrive as proj + visual
      const src = ents.get(m.id);
      if (src && ['swing', 'bolt', 'arrow', 'fire', 'bash', 'cleave', 'holy', 'shadow', 'lightning'].includes(m.k)) {
        src.atkAt = t;
        if (m.tx !== undefined) src.atkDx = Math.sign(m.tx - m.x), src.atkDy = Math.sign(m.ty - m.y);
      } else if (src && src.k === 'p' && ['cry', 'heal', 'nova', 'ring', 'burst', 'meteor', 'rain'].includes(m.k)) src.castAt = t; // support / area casts raise both arms
      fxs.push({ ...m, t0: t });
      if (m.k === 'levelup' && m.id === myId) { sfx.level(); banner('LEVEL UP!'); }
      if (m.k === 'die') {
        const [px, py] = tc(m.x, m.y);
        const e = ents.get(m.id);
        if (e && e.k === 'm') { e.dying = t; burst(px, py, e.s === 'slime' ? ['#5fd35f', '#c8ffc8'] : ['#8a8f99', '#c0c4cc', '#e8e0c8'], 14, 40, 600); }
        else burst(px, py, ['#c8c8c8', '#8a8a92'], 10, 30, 600);
        if (m.id === myId) sfx.die();
      }
      if (['cleave', 'bash', 'cry', 'nova', 'fire', 'heal', 'dash'].includes(m.k) && m.id === myId) sfx.skill();
      break;
    }
    case 'cd': skillReady[m.id] = now() + m.ms; gcdUntil = now() + 600; break;
    case 'pot': potReady = now() + m.ms; sfx.click(); break;
    case 'pickup': sfx.pickup(); break;
    case 'coin': sfx.coin(); break;
    default:
  }
}
function banner(txt) {
  const b = $('banner'); b.textContent = txt; b.classList.remove('hidden');
  clearTimeout(banner.t); banner.t = setTimeout(() => b.classList.add('hidden'), 2200);
}
function toast(txt) {
  const el = $('toast'); el.textContent = txt; clearTimeout(toast.t); toast.t = setTimeout(() => (el.textContent = ''), 1800);
}

// ------------------------------------------------------------------ entity helpers
const meEnt = () => ents.get(myId);
const solidAt = (x, y) => isSolid(world, x, y);
const mobDef = (e) => MOBS[e.s] || MOBS.slime;
function levelColor(l) {
  const d = l - (me ? me.lvl : 1);
  return d <= -5 ? '#9a9a9a' : d <= -2 ? '#6aff8a' : d <= 1 ? '#ffe066' : d <= 4 ? '#ff9a3a' : '#ff4a4a';
}

function stepEntities(dt, t) {
  for (const o of ents.values()) {
    if (o.dying && t - o.dying > 700) { ents.delete(o.i); continue; }
    if (o.k !== 'p' && o.k !== 'm') { o.rx = o.x; o.ry = o.y; continue; }
    const dx = o.x - o.rx, dy = o.y - o.ry;
    if (Math.abs(dx) + Math.abs(dy) > 5) { o.rx = o.x; o.ry = o.y; }
    const spd = (o.k === 'p' ? (o.sp ? 1000 / 95 : 1000 / 150) : 1000 / mobDef(o).moveMs) * 1.2;
    const st = spd * dt;
    o.rx += Math.abs(dx) <= st ? dx : Math.sign(dx) * st;
    o.ry += Math.abs(dy) <= st ? dy : Math.sign(dy) * st;
    o.moving = o.rx !== o.x || o.ry !== o.y;
  }
}

// ------------------------------------------------------------------ pathfinding (client-side click-to-move)
const bfsPrev = new Int32Array(W * H), bfsQ = new Int32Array(W * H);
function bfsStep(sx, sy, goalFn, blocked) {
  bfsPrev.fill(-2);
  let qh = 0, qt = 0;
  const s = sy * W + sx;
  bfsQ[qt++] = s; bfsPrev[s] = -1;
  let found = -1, guard = 0;
  while (qh < qt && guard++ < 5000) {
    const c = bfsQ[qh++], cx = c % W, cy = (c / W) | 0;
    if (c !== s && goalFn(cx, cy)) { found = c; break; }
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cx + dx, ny = cy + dy;
      if (Math.abs(nx - sx) > 40 || Math.abs(ny - sy) > 30) continue;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (bfsPrev[n] !== -2 || solidAt(nx, ny) || blocked.has(n)) continue;
      bfsPrev[n] = c; bfsQ[qt++] = n;
    }
  }
  if (found < 0) return null;
  let c = found;
  while (bfsPrev[c] !== s && bfsPrev[c] !== -1) c = bfsPrev[c];
  return { dx: (c % W) - sx, dy: ((c / W) | 0) - sy };
}
const occupied = (ignore) => {
  const set = new Set();
  for (const o of ents.values()) if ((o.k === 'm' || o.k === 'p') && o.i !== myId && o.i !== ignore && !o.dying) set.add(o.y * W + o.x);
  for (const n of npcs) if (n.id !== ignore) set.add(n.y * W + n.x);
  return set;
};
const stepMs = () => { const m = meEnt(); return m && m.sp ? 100 : 150; };

function runGoal(t) {
  const m = meEnt();
  if (!goal || !m || m.d || t < nextStep) return;
  let gx, gy, fn;
  if (goal.type === 'ent') {
    const e = ents.get(goal.id) || npcs.find((n) => n.id === goal.id);
    if (!e || e.dying) { goal = null; return; }
    gx = e.x; gy = e.y;
    const d = Math.hypot(gx - m.x, gy - m.y);
    if (d <= goal.range) {
      if (goal.then === 'talk') tx({ t: 'talk', id: goal.id });
      if (goal.then !== 'chase') goal = null;
      else m.f = Math.abs(gx - m.x) >= Math.abs(gy - m.y) ? (gx > m.x ? 3 : 2) : (gy > m.y ? 0 : 1);
      return;
    }
    fn = (x, y) => Math.hypot(gx - x, gy - y) <= goal.range && !(x === gx && y === gy);
  } else {
    if (m.x === goal.x && m.y === goal.y) { goal = null; return; }
    gx = goal.x; gy = goal.y;
    fn = (x, y) => x === gx && y === gy;
  }
  const blocked = occupied(goal.type === 'ent' ? goal.id : 0);
  let step = bfsStep(m.x, m.y, fn, blocked);
  if (!step && goal.type === 'tile') step = bfsStep(m.x, m.y, (x, y) => Math.hypot(gx - x, gy - y) <= 1.5, blocked);
  if (!step) { goal = null; return; }
  tx({ t: 'move', dx: step.dx, dy: step.dy });
  nextStep = t + stepMs() - 8;
}

function runKeys(t) {
  const m = meEnt();
  if (!m || m.d || t < nextStep || document.activeElement === $('chatIn')) return;
  let dx = 0, dy = 0;
  const gamepadMove = ['move_up', 'move_left', 'move_down', 'move_right'].find((action) => gamepadHeld.has(action));
  const last = gamepadMove || [...keys].reverse().find((k) => ['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(k));
  if (last === 'w' || last === 'arrowup' || last === 'move_up') dy = -1;
  else if (last === 's' || last === 'arrowdown' || last === 'move_down') dy = 1;
  else if (last === 'a' || last === 'arrowleft' || last === 'move_left') dx = -1;
  else if (last === 'd' || last === 'arrowright' || last === 'move_right') dx = 1;
  if (dx || dy) { goal = null; tx({ t: 'move', dx, dy }); nextStep = t + stepMs() - 8; }
}

// ------------------------------------------------------------------ input
let gamepadButtons = [], gamepadHeld = new Set();
function gamepadPanel() {
  for (const id of ['tutorial', 'invite', 'trade', 'dialog', 'char', 'inv', 'worldmap', 'qlog', 'menu']) {
    const panel = $(id);
    if (panel && !panel.classList.contains('hidden')) return panel;
  }
  return null;
}
function moveGamepadFocus(panel, direction) {
  const controls = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
  if (!controls.length) return;
  const index = moveFocusIndex(controls.indexOf(document.activeElement), controls.length, direction);
  controls[index]?.focus();
}
function gamepadAction(action) {
  if (!inGame) return;
  const panel = gamepadPanel();
  if (panel) {
    if (action.startsWith('nav_')) moveGamepadFocus(panel, action === 'nav_up' || action === 'nav_left' ? -1 : 1);
    else if (action === 'interact') {
      const focused = panel.contains(document.activeElement) ? document.activeElement : panel.querySelector('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
      focused?.click(); focused?.focus();
    } else if (action === 'back') {
      if (panel.id === 'tutorial') closeTutorial();
      else if (panel.id === 'trade') tx({ t: 'trade_cancel' });
      else if (panel.id === 'dialog') closeDialog();
      else panel.classList.add('hidden');
    }
    return;
  }
  if (action === 'interact') interact();
  else if (action === 'target') cycleTarget();
  else if (action === 'potion') quaff();
  else if (action.startsWith('skill')) tx({ t: 'skill', n: Number(action.slice(5)) });
  else if (action === 'menu') toggleMenu();
  else if (action === 'map') toggleMap();
  else if (action === 'back') {
    if (escapeMenu()) return;
    $('worldmap').classList.add('hidden');
    if (tradeView) tx({ t: 'trade_cancel' });
    closeDialog(); $('inv').classList.add('hidden'); $('char').classList.add('hidden');
    tx({ t: 'target', id: 0 }); goal = null;
  }
}
function pollGamepad() {
  const pad = Array.from(navigator.getGamepads?.() || []).find(Boolean);
  if (!pad) { gamepadButtons = []; gamepadHeld = new Set(); return; }
  const state = readGamepad(pad, gamepadButtons, settings.deadzone);
  gamepadButtons = state.buttons; gamepadHeld = state.held;
  if (state.held.size || state.pressed.size) document.body.dataset.input = 'gamepad';
  for (const action of state.pressed) gamepadAction(action);
}
function worldPos(ev) {
  const r = screen.getBoundingClientRect();
  const lx0 = ((ev.clientX - r.left) / r.width) * VW, ly0 = ((ev.clientY - r.top) / r.height) * VH;
  return { px: camX + lx0, py: camY + ly0 };
}
function pickAt(px, py) {
  const tx0 = Math.floor(px / TS), ty0 = Math.floor(py / TS);
  let best = null, bd = 1.1;
  const consider = (e, kind) => {
    const h = BIG.has(e.s) ? 1.6 : 0.7;
    const d = Math.hypot(e.rx - (px - 8) / TS, e.ry - (py - 8) / TS + (h > 1 ? 0.5 : 0));
    if (d < bd) { bd = d; best = { kind, e }; }
  };
  for (const e of ents.values()) {
    if (e.i === myId || e.dying) continue;
    if (e.k === 'm') consider(e, 'm');
    else if (e.k === 'p' && !e.d) consider(e, 'p');
    else if (e.k === 'd') { if (e.x === tx0 && e.y === ty0) { bd = 0; best = { kind: 'd', e }; } }
  }
  for (const n of npcs) { const d = Math.hypot(n.x - (px - 8) / TS, n.y - (py - 8) / TS); if (d < bd) { bd = d; best = { kind: 'n', e: n }; } }
  return best || { kind: 't', e: { x: tx0, y: ty0 } };
}
screen.addEventListener('mousedown', (ev) => {
  if (!inGame || ev.button !== 0) return;
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  const { px, py } = worldPos(ev);
  const hit = pickAt(px, py);
  const m = meEnt();
  if (!m || m.d) return;
  if (hit.kind === 'm') {
    tx({ t: 'target', id: hit.e.i });
    const rng = Math.max(1.4, (me ? me.st.range : 1.5) - 0.2);
    goal = { type: 'ent', id: hit.e.i, range: rng, then: 'chase' };
    sfx.click();
  } else if (hit.kind === 'p') {
    pendingInvite = { menu: hit.e.i, name: hit.e.n }; showInvite();
  } else if (hit.kind === 'n') {
    goal = { type: 'ent', id: hit.e.id, range: 2.3, then: 'talk' };
  } else if (hit.kind === 'd') {
    goal = { type: 'tile', x: hit.e.x, y: hit.e.y };
  } else if (!solidAt(hit.e.x, hit.e.y)) {
    goal = { type: 'tile', x: hit.e.x, y: hit.e.y };
    toastMove(hit.e.x, hit.e.y);
  }
});
screen.addEventListener('contextmenu', (e) => e.preventDefault());
let clickMark = null;
const toastMove = (x, y) => { clickMark = { x, y, t0: now() }; };

addEventListener('keydown', (e) => {
  document.body.dataset.input = 'keyboard';
  const k = e.key.toLowerCase();
  if (inGame && isOpen('tutorial')) {
    if (k === 'escape') closeTutorial();
    e.preventDefault();
    return;
  }
  if (document.activeElement === $('chatIn')) {
    if (k === 'enter') { const v = $('chatIn').value.trim(); if (v) sendChat(v); $('chatIn').value = ''; $('chatIn').blur(); }
    else if (k === 'escape') { $('chatIn').blur(); }
    e.stopPropagation();
    return;
  }
  if (!inGame) return;
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (e.repeat && !['w', 'a', 's', 'd'].includes(k)) return;
  keys.add(k);
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
  if (k === 'enter') { $('chatIn').focus(); e.preventDefault(); }
  else if (k.length === 1 && k >= '1' && k <= '6') tx({ t: 'skill', n: Number(k) });
  else if (k === 'c') toggleChar();
  else if (k === 'n' && !pendingInvite) toggleMap();
  else if (k === 'l') toggleQlog();
  else if (k === 'h' || k === 'f1') { toggleMenu(); e.preventDefault(); }
  else if (k === 'j') toggleChar('jobs');
  else if (k === 'k') toggleChar('skills');
  else if (k === 'q') quaff();
  else if (k === 'i') toggleInv();
  else if (k === 'e') interact();
  else if (k === 'm') { muted = !muted; localStorage.setItem('em_mute', muted ? '1' : '0'); toast(muted ? 'Sound off' : 'Sound on'); }
  else if (k === 'tab' || k === ' ') cycleTarget();
  else if ((k === 'y' || k === 'n') && pendingInvite && !pendingInvite.menu) answerInvite(k === 'y');
  else if (k === 'escape') { if (escapeMenu()) return; $('worldmap').classList.add('hidden'); if (pendingInvite && pendingInvite.menu) { pendingInvite = null; showInvite(); } if (tradeView) tx({ t: 'trade_cancel' }); closeDialog(); $('inv').classList.add('hidden'); tx({ t: 'target', id: 0 }); goal = null; }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// ---- party
let lastWhisper = '';
function sendChat(v) {
  const arg = (cmd) => v.slice(cmd.length).trim();
  if (v.startsWith('/invite ')) tx({ t: 'pinvite', name: arg('/invite') });
  else if (v === '/leave') tx({ t: 'pleave' });
  else if (/^\/bounty( |$)/.test(v)) tx({ t: 'bounty', a: arg('/bounty') || 'take' });
  else if (/^\/(w|whisper|tell) /.test(v)) {
    const rest = v.slice(v.indexOf(' ') + 1).trim(), sp = rest.indexOf(' ');
    if (sp < 1) addLine('<span style="color:#ff8a8a">Usage: /w NAME message</span>');
    else tx({ t: 'whisper', to: rest.slice(0, sp), m: rest.slice(sp + 1) });
  } else if (/^\/r /.test(v)) {
    if (!lastWhisper) addLine('<span style="color:#ff8a8a">Nobody has whispered you yet.</span>');
    else tx({ t: 'whisper', to: lastWhisper, m: v.slice(3) });
  }
  else if (v.startsWith('/trade ')) tx({ t: 'trade_req', name: arg('/trade') });
  else if (v.startsWith('/kick ')) {
    const t = party.members.find((m) => m.name.toLowerCase() === arg('/kick').toLowerCase());
    if (t) tx({ t: 'pkick', id: t.id }); else addLine('<span style="color:#ff8a8a">Nobody in your party has that name.</span>');
  } else if (v.startsWith('/p ')) tx({ t: 'chat', m: arg('/p'), ch: 'party' });
  else if (['/wave', '/dance', '/sit', '/cheer'].includes(v)) tx({ t: 'emote', e: v.slice(1) });
  else if (v === '/help') addLine('<span style="color:#9fd0ff">/invite NAME, /leave, /kick NAME, /p TEXT (party chat), /bounty [claim|drop], /w NAME TEXT (whisper), /r TEXT (reply), /trade NAME, /who, /wave /dance /sit /cheer</span>');
  else tx({ t: 'chat', m: v });
}
function answerInvite(ok) {
  const inv = pendingInvite;
  pendingInvite = null; showInvite();
  if (!inv || inv.menu) return;
  if (inv.kind === 'trade') tx({ t: 'trade_ans', ok });
  else tx({ t: 'pgo', ok });
}
function showInvite() {
  const box = $('invite');
  const inv = pendingInvite;
  if (!inv) { box.classList.add('hidden'); return; }
  const nm = `<b style="color:#6ab8ff">${esc(inv.name)}</b>`;
  if (inv.menu) {
    box.innerHTML = `<div>${nm}</div><div class="btns"><button data-a="party">Party invite</button><button data-a="trade">Trade</button><button data-a="no">Cancel</button></div>`;
    box.querySelectorAll('button').forEach((bt) => {
      bt.onclick = () => {
        const a = bt.dataset.a;
        pendingInvite = null; showInvite();
        if (a === 'party') tx({ t: 'pinvite', name: inv.name });
        else if (a === 'trade') tx({ t: 'trade_req', name: inv.name });
      };
    });
  } else {
    const what = inv.kind === 'trade' ? 'wants to trade with you' : 'invites you to a party';
    box.innerHTML = `<div>${nm} ${what}</div><div class="btns"><button data-a="1">Accept (Y)</button><button data-a="0">Decline (N)</button></div>`;
    box.querySelectorAll('button').forEach((bt) => { bt.onclick = () => answerInvite(bt.dataset.a === '1'); });
  }
  box.classList.remove('hidden');
}

// ---- trading
const offerUids = () => (tradeView ? tradeView.me.items.map((i) => i.u) : []);
function sendOffer(uids, gold) {
  tx({ t: 'trade_offer', items: uids, gold: gold === undefined ? (tradeView ? tradeView.me.gold : 0) : gold });
}
function toggleOffer(u) {
  const cur = offerUids();
  sendOffer(cur.includes(u) ? cur.filter((x) => x !== u) : [...cur, u]);
}
const itemText = (it) => `${it.n} (${RARITY[it.r].n}) ${statParts(it).join(' ')}${it.c > 1 ? ` x${it.c}` : ''}`;
function renderTrade() {
  const v = tradeView, box = $('trade');
  if (!v) { box.classList.add('hidden'); return; }
  const both = v.me.lock && v.them.lock;
  const slots = (list, mine) => {
    const wrap = document.createElement('div'); wrap.className = 'tslots';
    for (let i = 0; i < 6; i++) {
      const it = list[i]; const d = slotEl(it || null);
      if (it) { d.title = itemText(it); if (mine) d.onclick = () => toggleOffer(it.u); }
      wrap.appendChild(d);
    }
    return wrap;
  };
  box.innerHTML = '';
  const head = document.createElement('div'); head.className = 'row';
  head.innerHTML = `<b>Trade with <span style="color:#6ab8ff">${esc(v.them.name)}</span></b>`;
  const x = document.createElement('button'); x.className = 'x'; x.textContent = 'x'; x.onclick = () => tx({ t: 'trade_cancel' }); head.appendChild(x);
  const cols = document.createElement('div'); cols.className = 'cols';
  const mine = document.createElement('div'); mine.className = 'col';
  mine.innerHTML = '<div class="small">You offer (tap pack items to add)</div>';
  mine.appendChild(slots(v.me.items, true));
  const g = document.createElement('input'); g.type = 'number'; g.min = 0; g.max = me ? me.gold : 0; g.value = v.me.gold; g.title = 'Gold to offer';
  g.onchange = () => sendOffer(offerUids(), Math.max(0, Math.floor(Number(g.value) || 0)));
  const gl = document.createElement('div'); gl.className = 'small'; gl.textContent = 'Gold:';
  mine.append(gl, g);
  const ms = document.createElement('div'); ms.className = `state ${v.me.ok ? 'on' : ''}`; ms.textContent = v.me.ok ? 'CONFIRMED' : v.me.lock ? 'LOCKED' : '';
  mine.appendChild(ms);
  const them = document.createElement('div'); them.className = 'col them';
  them.innerHTML = `<div class="small">${esc(v.them.name)} offers</div>`;
  them.appendChild(slots(v.them.items, false));
  const tg = document.createElement('div'); tg.innerHTML = `<div class="small">Gold:</div><div style="color:#ffd23a;padding:5px 0">${v.them.gold}</div>`;
  them.appendChild(tg);
  const ts = document.createElement('div'); ts.className = `state ${v.them.ok ? 'on' : ''}`; ts.textContent = v.them.ok ? 'CONFIRMED' : v.them.lock ? 'LOCKED' : '';
  them.appendChild(ts);
  cols.append(mine, them);
  const btns = document.createElement('div'); btns.className = 'btns';
  const mk = (txt, fn, dis) => { const b = document.createElement('button'); b.textContent = txt; b.onclick = fn; if (dis) b.disabled = true; btns.appendChild(b); };
  if (!both) mk(v.me.lock ? 'Locked - waiting...' : 'Lock offer', () => tx({ t: 'trade_lock' }), v.me.lock);
  else mk(v.me.ok ? `Waiting for ${v.them.name}...` : 'Confirm trade', () => tx({ t: 'trade_confirm' }), v.me.ok);
  mk('Pack', () => { const inv = $('inv'); inv.classList.toggle('hidden'); inv.classList.add('front'); if (me) renderInv(); });
  mk('Cancel', () => tx({ t: 'trade_cancel' }));
  const note = document.createElement('div'); note.className = 'note';
  note.textContent = 'Both sides lock their offers, then both confirm. Changing an offer unlocks everyone.';
  box.append(head, cols, btns, note);
  box.classList.remove('hidden');
}

function renderParty() {
  const el = $('party');
  el.innerHTML = '';
  el.classList.toggle('hidden', !party.id);
  const amLeader = party.leader === myId;
  for (const mem of party.members) {
    if (mem.id === myId) continue;
    const d = pmData.get(mem.id) || { h: 1, mh: 1 };
    const row = document.createElement('div'); row.className = 'pm';
    row.innerHTML = `<div class="row"><b class="${mem.id === party.leader ? 'lead' : ''}">${esc(mem.name)}</b><span>Lv ${mem.lvl}</span></div><div class="bar hp"><i style="width:${Math.max(0, Math.min(100, (d.h / d.mh) * 100))}%"></i></div>`;
    if (amLeader) { const x = document.createElement('button'); x.className = 'x'; x.textContent = 'kick'; x.title = 'Remove from party'; x.onclick = () => tx({ t: 'pkick', id: mem.id }); row.querySelector('.row').appendChild(x); }
    el.appendChild(row);
  }
  if (party.id) {
    const lv = document.createElement('button'); lv.textContent = 'Leave party'; lv.style.fontSize = '7px'; lv.onclick = () => tx({ t: 'pleave' }); el.appendChild(lv);
  }
}


// ---- settings, help menu and quest log
let settings = {
  vol: 0.7, dmg: true, names: true, shake: true, music: true, deadzone: 0.24,
  uiScale: 1, motion: !matchMedia('(prefers-reduced-motion: reduce)').matches, contrast: false,
};
try { settings = { ...settings, ...JSON.parse(localStorage.getItem('em_settings') || '{}') }; } catch { /* private mode */ }
function applySettings() {
  settings.uiScale = Math.max(0.85, Math.min(1.5, Number(settings.uiScale) || 1));
  settings.deadzone = Math.max(0.1, Math.min(0.5, Number(settings.deadzone) || 0.24));
  document.documentElement.style.setProperty('--ui-scale', settings.uiScale);
  document.documentElement.dataset.reducedMotion = String(!settings.motion);
  document.documentElement.dataset.highContrast = String(!!settings.contrast);
}
applySettings();
const saveSettings = () => { try { localStorage.setItem('em_settings', JSON.stringify(settings)); localStorage.setItem('em_mute', muted ? '1' : '0'); } catch { /* ignore */ } };
const isOpen = (id) => !$(id).classList.contains('hidden');
function toggleMenu() { $('qlog').classList.add('hidden'); $('menu').classList.toggle('hidden'); if (isOpen('menu')) renderMenu(); }
function toggleQlog() { $('menu').classList.add('hidden'); $('qlog').classList.toggle('hidden'); if (isOpen('qlog')) renderQlog(); }
function escapeMenu() {
  for (const id of ['menu', 'qlog']) if (isOpen(id)) { $(id).classList.add('hidden'); return true; }
  const open = ['inv', 'char', 'dialog', 'worldmap', 'trade'].some(isOpen);
  if (!open && !(me && me.tg) && !goal) { toggleMenu(); return true; }
  return false;
}
function renderMenu() {
  const box = $('menu'); box.innerHTML = '';
  const head = mkEl('div', 'row', '<b>Menu</b>'); const x = mkEl('button', 'x', 'x'); x.onclick = () => box.classList.add('hidden'); head.appendChild(x);
  box.appendChild(head);
  box.appendChild(mkEl('h4', '', 'Settings'));
  const toggle = (label, key, after) => {
    const row = mkEl('div', 'setrow', `<span>${label}</span>`); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!settings[key];
    cb.onchange = () => { settings[key] = cb.checked; saveSettings(); if (after) after(); }; row.appendChild(cb); box.appendChild(row);
  };
  const snd = mkEl('div', 'setrow', '<span>Sound</span>'); const sc = document.createElement('input'); sc.type = 'checkbox'; sc.checked = !muted;
  sc.onchange = () => { muted = !sc.checked; saveSettings(); }; snd.appendChild(sc); box.appendChild(snd);
  const vol = mkEl('div', 'setrow', '<span>Volume</span>'); const vr = document.createElement('input'); vr.type = 'range'; vr.min = 0; vr.max = 100; vr.value = Math.round(settings.vol * 100);
  vr.oninput = () => { settings.vol = vr.value / 100; saveSettings(); }; vr.onchange = () => sfx.click(); vol.appendChild(vr); box.appendChild(vol);
  toggle('Ambient music', 'music');
  toggle('Floating damage numbers', 'dmg');
  toggle('Monster names (always shown for your target)', 'names');
  toggle('Screen shake when hit', 'shake');
  toggle('Motion effects', 'motion', applySettings);
  toggle('High contrast', 'contrast', applySettings);
  const us = mkEl('div', 'setrow', '<span>Interface scale</span>'); const ur = document.createElement('input'); ur.type = 'range'; ur.min = 85; ur.max = 150; ur.value = Math.round(settings.uiScale * 100);
  ur.oninput = () => { settings.uiScale = ur.value / 100; applySettings(); saveSettings(); }; us.appendChild(ur); box.appendChild(us);
  const dz = mkEl('div', 'setrow', '<span>Gamepad deadzone</span>'); const dr = document.createElement('input'); dr.type = 'range'; dr.min = 10; dr.max = 50; dr.value = Math.round(settings.deadzone * 100);
  dr.oninput = () => { settings.deadzone = dr.value / 100; saveSettings(); }; dz.appendChild(dr); box.appendChild(dz);
  const btns = mkEl('div', 'btnrow'); const ql = mkEl('button', '', 'Quest log (L)'); ql.onclick = () => toggleQlog();
  const mp = mkEl('button', '', 'World map (N)'); mp.onclick = () => { box.classList.add('hidden'); toggleMap(); };
  const tut = mkEl('button', '', 'Replay guide'); tut.onclick = () => { box.classList.add('hidden'); showTutorial(true); };
  const rl = mkEl('button', '', 'Log out'); rl.onclick = () => location.reload(); btns.append(ql, mp, tut, rl); box.appendChild(btns);
  const emo = mkEl('div', 'btnrow');
  for (const e of ['wave', 'dance', 'sit', 'cheer']) { const b = mkEl('button', '', e[0].toUpperCase() + e.slice(1)); b.onclick = () => { tx({ t: 'emote', e }); box.classList.add('hidden'); }; emo.appendChild(b); }
  box.appendChild(mkEl('h4', '', 'Emotes (or /wave /dance /sit /cheer)')); box.appendChild(emo);
  box.appendChild(mkEl('h4', '', 'Controls'));
  const keys = [
    ['WASD / arrows', 'walk'], ['Click ground', 'walk there'], ['Click monster', 'target + attack'], ['Click NPC', 'talk'],
    ['Click a hero', 'party / trade'], ['1-6', 'skills'], ['Q', 'health potion'], ['Space / Tab', 'next target'],
    ['E', 'talk / use portal'], ['C J K', 'hero: stats, jobs, skills'], ['I', 'pack'], ['L', 'quest log'],
    ['N', 'world map'], ['Enter', 'chat (/help)'], ['H or Esc', 'this menu'], ['M', 'mute'],
  ];
  box.appendChild(mkEl('div', 'keys', keys.map(([k, v]) => `<div><b>${k}</b> ${v}</div>`).join('')));
  box.appendChild(mkEl('h4', '', 'Gamepad'));
  box.appendChild(mkEl('div', 'keys', GAMEPAD_HELP.map(([k, v]) => `<div><b>${k}</b> ${v}</div>`).join('')));
}

const TUTORIAL_STEPS = [
  ['Welcome to Eldermoor', 'Your hero is saved to the server under this name and secret word. Keep the secret: there is no account-recovery flow yet.'],
  ['Move and explore', 'Use WASD, the arrow keys, the left stick, the touch joystick, or click the ground. The minimap marks NPCs in gold and other heroes in blue.'],
  ['Talk and fight', 'Press E or the gamepad south button near an NPC or portal. Click a monster—or press Tab, Space, or the gamepad target button—to attack it.'],
  ['Skills and survival', 'Use 1–6 or the six gamepad shoulder/stick buttons for skills. Q or the gamepad top button drinks a potion. Red ground markers warn of dangerous attacks.'],
  ['Your first objective', 'Talk to the marked quest giver, follow the quest panel, equip drops from your Pack, and open the Menu for the map, controls, accessibility settings, parties and chat commands.'],
];
let tutorialStep = 0, tutorialPreviousFocus = null;
function closeTutorial() {
  $('tutorial').classList.add('hidden');
  try { localStorage.setItem('em_tutorial_v1', 'done'); } catch { /* private mode */ }
  tutorialPreviousFocus?.focus?.(); tutorialPreviousFocus = null;
}
function showTutorial(force = false) {
  if (!inGame || (!force && localStorage.getItem('em_tutorial_v1') === 'done')) return;
  const box = $('tutorial'); tutorialStep = 0; tutorialPreviousFocus = document.activeElement;
  const draw = () => {
    const [title, text] = TUTORIAL_STEPS[tutorialStep];
    box.innerHTML = '';
    const heading = mkEl('h2', '', title); heading.id = 'tutorialTitle';
    const progress = mkEl('div', 'step', `Step ${tutorialStep + 1} of ${TUTORIAL_STEPS.length}`);
    const body = mkEl('p', '', text);
    const buttons = mkEl('div', 'btnrow');
    const skip = mkEl('button', '', 'Skip guide'); skip.onclick = closeTutorial;
    if (tutorialStep > 0) { const back = mkEl('button', '', 'Back'); back.onclick = () => { tutorialStep--; draw(); }; buttons.appendChild(back); }
    const next = mkEl('button', '', tutorialStep === TUTORIAL_STEPS.length - 1 ? 'Start adventuring' : 'Next');
    next.onclick = () => { if (++tutorialStep >= TUTORIAL_STEPS.length) closeTutorial(); else draw(); };
    buttons.append(skip, next); box.append(heading, progress, body, buttons); next.focus();
  };
  box.classList.remove('hidden'); draw();
}
function townOfNpc(id) {
  const n = NPCS.find((q) => q.id === id);
  if (!n) return '';
  return TOWNS.slice().sort((a, b) => Math.hypot(a.cx - n.x, a.cy - n.y) - Math.hypot(b.cx - n.x, b.cy - n.y))[0].name;
}
function renderQlog() {
  const box = $('qlog'); box.innerHTML = '';
  const head = mkEl('div', 'row', '<b>Quest log</b>'); const x = mkEl('button', 'x', 'x'); x.onclick = () => box.classList.add('hidden'); head.appendChild(x);
  box.appendChild(head);
  if (!me) return;
  const q = me.quest;
  box.appendChild(mkEl('div', 'small', `${Math.min(q.i, QUESTS.length)} of ${QUESTS.length} quests complete. One quest at a time; the next giver may be in another town.`));
  QUESTS.forEach((Q, i) => {
    const state = i < q.i ? 'done' : i === q.i ? 'cur' : 'lock';
    const g = NPCS.find((n) => n.id === Q.giver);
    const prog = state === 'cur' ? (q.s === 0 ? '<span style="color:#ffe066">Not accepted yet</span>' : q.s === 1 ? `<span style="color:#ffe066">Slay ${q.p}/${Q.need}</span>` : '<span style="color:#6aff8a">Ready to turn in</span>') : state === 'done' ? '<span style="color:#6aff8a">Complete</span>' : 'Locked';
    box.appendChild(mkEl('div', `qrow ${state}`, `<b>${esc(Q.title)}</b> &middot; ${prog}<div class="ds">${state === 'lock' ? '' : `Slay ${Q.need} ${esc(MOBS[Q.mob].name)}${Q.need > 1 ? 's' : ''} &middot; `}${g ? `${esc(g.name)}, ${esc(townOfNpc(Q.giver))}` : ''} &middot; ${Q.xp} XP, ${Q.gold}g${Q.reward ? ', epic gear' : ''}</div>`));
  });
}

// ---- regions and the world map
let curRegion = '';
function trackRegion() {
  const m = meEnt();
  if (!m) return;
  let label;
  if (zoneKind === 'dungeon') label = zoneName;
  else {
    const r = regionAt(m.x, m.y);
    label = r.town ? `${r.name} (safe)` : r.sea ? 'Open sea' : `${r.name}  Lv ${r.lv}`;
    if (label !== curRegion && !r.sea) {
      const el = $('region'); el.textContent = r.town ? r.name : `${r.name}  (Lv ${r.lv})`; el.classList.add('show');
      clearTimeout(trackRegion.t); trackRegion.t = setTimeout(() => el.classList.remove('show'), 3200);
    }
  }
  if (label !== curRegion) { curRegion = label; $('regionName').textContent = label; }
}
function drawWorldMap() {
  const m = meEnt(), x = $('wmCanvas').getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(art.minimap, 0, 0, W, H, 0, 0, 512, 512);
  x.textAlign = 'center'; x.font = '9px "Press Start 2P", monospace'; x.lineWidth = 3; x.strokeStyle = '#0d0a18';
  if (zoneKind === 'world') {
    for (const t of TOWNS) { x.strokeText(t.name, t.cx * 2, t.cy * 2 - 8); x.fillStyle = '#ffe066'; x.fillText(t.name, t.cx * 2, t.cy * 2 - 8); x.fillRect(t.cx * 2 - 3, t.cy * 2 - 3, 6, 6); }
    x.fillStyle = '#ff5a3a';
    for (const b of BOSSES) { x.fillRect(b.x * 2 - 3, b.y * 2 - 3, 7, 7); x.fillStyle = '#0d0a18'; x.fillRect(b.x * 2 - 1, b.y * 2 - 1, 3, 3); x.fillStyle = '#ff5a3a'; }
  }
  for (const [id, d] of pmData) { if (id === myId || (d.z && d.z !== zoneId)) continue; x.fillStyle = '#6aff8a'; x.fillRect(d.x * 2 - 3, d.y * 2 - 3, 7, 7); }
  if (m) { x.fillStyle = Math.floor(now() / 400) % 2 ? '#ffffff' : '#8be88b'; x.fillRect(m.x * 2 - 4, m.y * 2 - 4, 9, 9); x.strokeStyle = '#0d0a18'; x.lineWidth = 1; x.strokeRect(m.x * 2 - 4, m.y * 2 - 4, 9, 9); }
}
function toggleMap() {
  const box = $('worldmap');
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) drawWorldMap();
}
$('minimap').addEventListener('click', toggleMap);
$('minimap').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleMap(); } });

function cycleTarget() {
  const m = meEnt(); if (!m) return;
  const list = [...ents.values()].filter((e) => e.k === 'm' && !e.dying && Math.hypot(e.x - m.x, e.y - m.y) < 14).sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y));
  if (!list.length) return toast('No enemies nearby');
  const i = list.findIndex((e) => me && e.i === me.tg);
  tx({ t: 'target', id: list[(i + 1) % list.length].i });
}
function interact() {
  const m = meEnt(); if (!m) return;
  const n = npcs.slice().sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
  if (n && Math.hypot(n.x - m.x, n.y - m.y) <= 4.5) tx({ t: 'talk', id: n.id });
  else toast('Nobody to talk to nearby');
}
function quaff() {
  if (!me) return;
  const i = me.inv.findIndex((it) => it && it.s === 'potion');
  if (i < 0) return toast('No potions!');
  tx({ t: 'use', slot: i });
}

// ------------------------------------------------------------------ UI
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function addLine(html) {
  const log = $('chatLog');
  const d = document.createElement('div'); d.innerHTML = html; log.appendChild(d);
  while (log.children.length > 40) log.removeChild(log.firstChild);
}

const abbr = (id) => (EFFECTS[id] ? EFFECTS[id].name.slice(0, 2).toUpperCase() : id.slice(0, 2).toUpperCase());
function renderPips(el, ids) {
  const key = (ids || []).join(',');
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  el.innerHTML = (ids || []).map((id) => `<span class="pip" title="${EFFECTS[id] ? EFFECTS[id].name : id}" style="background:${EFFECTS[id] ? EFFECTS[id].col : '#fff'}"></span>`).join('');
}
function renderBuffs(t) {
  const el = $('buffs');
  if (!me) return;
  const list = me.fx.map((f) => ({ ...f, ms: f.ms - (t - meAt) })).filter((f) => f.ms > 0);
  el.innerHTML = list.map((f) => {
    const d = EFFECTS[f.id] || { name: f.id, col: '#fff' };
    return `<span class="buff" title="${d.name}" style="--c:${d.col}">${abbr(f.id)}<i>${Math.ceil(f.ms / 1000)}</i></span>`;
  }).join('');
}
function buildSkillbar() {
  const bar = $('skillbar'); bar.innerHTML = '';
  const slots = me ? me.slots : 3;
  for (let i = 0; i < slots; i++) {
    const id = me && me.bar[i];
    const el = document.createElement('div'); el.className = `sk${id ? '' : ' empty'}`; el.id = `sk${i + 1}`;
    el.innerHTML = `${id ? `<img src="${skillURL(id)}">` : ''}<span class="key">${i + 1}</span><div class="cd"></div><span class="cdt"></span>`;
    el.title = id ? `${SKILLS[id].name}: ${SKILLS[id].desc}` : 'Empty slot - open the Skills tab (K) to assign a skill';
    el.onclick = () => (id ? tx({ t: 'skill', n: i + 1 }) : toggleChar('skills'));
    bar.appendChild(el);
  }
  const p = document.createElement('div'); p.className = 'sk'; p.id = 'skq'; p.title = 'Health potion (Q)';
  p.innerHTML = `<img src="${iconURL('potion', 0)}"><span class="key">Q</span><div class="cd"></div><span class="cdt"></span><span class="cnt"></span>`;
  p.onclick = quaff; bar.appendChild(p);
}
function updateCooldowns(t) {
  const gcd = gcdUntil - t;
  for (let i = 1; i <= me.slots; i++) {
    const el = $(`sk${i}`), id = me.bar[i - 1];
    if (!el || !id) continue;
    const left = (skillReady[id] || 0) - t, tot = SKILLS[id].cd;
    el.querySelector('.cd').style.height = left > 0 ? `${Math.min(100, (left / tot) * 100)}%` : gcd > 0 ? `${Math.min(100, (gcd / 600) * 100)}%` : '0';
    el.querySelector('.cdt').textContent = left > 0 ? (left / 1000).toFixed(left > 9900 ? 0 : 1) : '';
  }
  const q = $('skq'); if (q) {
    const left = potReady - t; const n = me.inv.reduce((a, it) => a + (it && it.s === 'potion' ? it.c : 0), 0);
    q.querySelector('.cd').style.height = left > 0 ? `${Math.min(100, (left / 6000) * 100)}%` : '0';
    q.querySelector('.cdt').textContent = left > 0 ? (left / 1000).toFixed(0) : '';
    q.querySelector('.cnt').textContent = n ? n : '';
    q.style.opacity = n ? 1 : 0.4;
  }
}
function onMe() {
  meAt = now();
  const sig = `${me.slots}|${me.bar.join(',')}`;
  if ($('skillbar').dataset.sig !== sig) { buildSkillbar(); $('skillbar').dataset.sig = sig; }
  const J = me.jobs[me.job];
  $('pName').textContent = me.name;
  $('pLvl').textContent = `Lv ${me.lvl} ${JOBS[me.job].name} ${J.lvl}`;
  $('hpBar').style.width = `${(me.hp / me.mh) * 100}%`;
  $('hpTxt').textContent = `${me.hp}/${me.mh}`;
  $('xpBar').style.width = me.xpn ? `${(me.xp / me.xpn) * 100}%` : '100%';
  $('jxpBar').style.width = me.jxpn ? `${(J.xp / me.jxpn) * 100}%` : '100%';
  $('pGold').innerHTML = `<span style="color:#ffd23a">${me.gold}g</span>`;
  $('pStats').innerHTML = `ATK ${me.st.atk}  DEF ${me.st.def}${me.points ? ` <span class="pts">+${me.points}pt</span>` : ''}`;
  $('death').classList.toggle('hidden', me.hp > 0);
  renderQuest();
  if (!$('inv').classList.contains('hidden')) renderInv();
  if (tradeView) renderTrade();
  renderChar();
  if (isOpen('qlog')) renderQlog();
  const tg = me.tg && ents.get(me.tg);
  $('targetFrame').classList.toggle('hidden', !tg);
}
$('plate').addEventListener('click', () => toggleChar());

// ---- character window: stats / jobs / skills
let charTab = 'stats', selSkill = null;
function toggleChar(tab) {
  const box = $('char'), open = !box.classList.contains('hidden');
  if (open && (!tab || tab === charTab)) { box.classList.add('hidden'); return; }
  if (tab) charTab = tab;
  box.classList.remove('hidden');
  renderChar();
}
const mkEl = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
function renderChar() {
  const box = $('char');
  if (!me || box.classList.contains('hidden')) return;
  const keepScroll = box.querySelector('.cbody') ? box.querySelector('.cbody').scrollTop : 0;
  box.innerHTML = '';
  const head = mkEl('div', 'row', `<b>${esc(me.name)}</b><span class="small">Lv ${me.lvl} &middot; ${JOBS[me.job].name} ${me.jobs[me.job].lvl}</span>`);
  const x = mkEl('button', 'x', 'x'); x.onclick = () => box.classList.add('hidden'); head.appendChild(x);
  const tabs = mkEl('div', 'tabs');
  for (const [id, label] of [['stats', 'Stats'], ['jobs', 'Jobs'], ['skills', 'Skills'], ['deeds', 'Deeds'], ['look', 'Look']]) {
    const b = mkEl('button', charTab === id ? 'on' : '', label); b.onclick = () => { charTab = id; renderChar(); }; tabs.appendChild(b);
  }
  const body = mkEl('div', 'cbody');
  box.append(head, tabs, body);
  (charTab === 'stats' ? statsTab : charTab === 'jobs' ? jobsTab : charTab === 'look' ? lookTab : charTab === 'deeds' ? deedsTab : skillsTab)(body);
  body.scrollTop = keepScroll;
}
function deedsTab(body) {
  const done = DEEDS.filter((d) => me.deeds[d.id]).length;
  body.appendChild(mkEl('div', 'small', `${done}/${DEEDS.length} deeds earned. Click an earned deed to wear its title.`));
  const cur = mkEl('div', 'qrow cur', `<b>Title:</b> ${me.title ? esc(titleText(me.title)) : 'none'}`);
  if (me.title) { const b = mkEl('button', '', 'Remove'); b.onclick = () => tx({ t: 'title', id: '' }); cur.appendChild(b); }
  body.appendChild(cur);
  for (const d of DEEDS) {
    const got = !!me.deeds[d.id], have = Math.min(d.need, d.have(me));
    const row = mkEl('div', `qrow ${got ? (me.title === d.id ? 'cur' : 'done') : 'lock'}`, `<b>${esc(d.name)}</b> &middot; ${got ? 'earned' : `${have}/${d.need}`}<div class="ds">${esc(d.desc)} Title: ${esc(d.title)}</div>`);
    row.style.opacity = got ? 1 : 0.75;
    if (got) { row.style.cursor = 'pointer'; row.onclick = () => tx({ t: 'title', id: d.id }); }
    body.appendChild(row);
  }
}
let lookDraft = null;
function lookTab(body) {
  if (!lookDraft) lookDraft = [...me.look];
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32; cv.className = 'bigprev';
  drawPrev(cv, lookDraft, visTokens(me.eq), 0, 0, me.job);
  const rows = mkEl('div', 'lookrows');
  lookRows(rows, lookDraft, () => renderChar());
  const wrap = mkEl('div', 'creator'); wrap.append(cv, rows);
  const changed = lookDraft.some((v, i) => v !== me.look[i]);
  const apply = mkEl('button', '', `Apply new look (${LOOK_COST}g, in town)`);
  apply.disabled = !changed; apply.onclick = () => { tx({ t: 'look', look: lookDraft }); lookDraft = null; };
  const reset = mkEl('button', '', 'Undo'); reset.disabled = !changed; reset.onclick = () => { lookDraft = null; renderChar(); };
  const btns = mkEl('div', 'btnrow'); btns.append(apply, reset);
  body.append(mkEl('div', 'small', 'Change your skin, hair and eyes. Your equipment is drawn on top of it. You can only do this in the town square.'), wrap, btns);
}
function statsTab(body) {
  const pct = me.xpn ? Math.round((me.xp / me.xpn) * 100) : 100;
  body.appendChild(mkEl('div', 'small', `Experience ${me.xp}/${me.xpn || 'max'} (${pct}%) &nbsp; Attribute points: <b class="pts">${me.points}</b>`));
  for (const k of ATTRS) {
    const row = mkEl('div', 'arow', `<span class="nm">${ATTR_INFO[k][0]}</span><span class="val">${me.st.A[k]}</span><span class="ds">${ATTR_INFO[k][1]}${me.attr[k] ? ` <b class="pts">(+${me.attr[k]} spent)</b>` : ''}</span>`);
    for (const n of [1, 5]) {
      const b = mkEl('button', 'x', `+${n}`); b.disabled = me.points < n; b.onclick = () => tx({ t: 'attr', k, n }); row.appendChild(b);
    }
    body.appendChild(row);
  }
  const rb = mkEl('button', '', `Reset attributes (${25 * me.lvl}g)`); rb.style.fontSize = '7px'; rb.onclick = () => tx({ t: 'respec' });
  const S = me.st;
  const g = mkEl('div', 'dgrid', [
    ['Attack power', S.atk], ['Defense', S.def], ['Magic resist', S.mres], ['Healing power', S.heal],
    ['Crit chance', `${S.crit}%`], ['Crit damage', `${S.critDmg}%`], ['Dodge', `${S.dodge}%`], ['Haste', `${S.haste}%`],
    ['Weapon', `${S.wt} (${S.range} tiles)`], ['Auto attack', `${(S.atkMs / 1000).toFixed(2)}s`],
  ].map(([n, v]) => `<div><span>${n}</span><b>${v}</b></div>`).join(''));
  body.append(g, rb, mkEl('div', 'small', `Job trait - ${esc(JOBS[me.job].trait)}`));
}
function jobsTab(body) {
  const wait = Math.max(0, me.jobWait - (now() - meAt));
  body.appendChild(mkEl('div', 'small', 'Each job levels on its own and keeps its level when you switch. Skills you learn stay with you. You cannot switch in combat.'));
  for (const id of JOB_ORDER) {
    const J = JOBS[id], lv = me.jobs[id].lvl, active = id === me.job;
    const learned = skillsOfJob(id).filter((s) => SKILLS[s].lvl <= lv).length;
    const card = mkEl('div', `jcard${active ? ' act' : ''}`);
    card.style.setProperty('--c', J.color);
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32; cv.getContext('2d').drawImage(HERO.classSprite(id, 0, 0), 0, 0);
    const info = mkEl('div', 'grow', `<b style="color:${J.color}">${J.name}</b> <span class="small">${J.role}</span><br>${lv ? `Job level ${lv}/20` : 'Not played yet'} &middot; skills ${learned}/6${active && me.jxpn ? ` &middot; ${Math.round((me.jobs[id].xp / me.jxpn) * 100)}% to next` : ''}<div class="tr">${esc(J.trait)}</div>`);
    const b = mkEl('button', '', active ? 'Active' : wait > 0 ? `Wait ${Math.ceil(wait / 1000)}s` : 'Switch');
    b.disabled = active || wait > 0; b.onclick = () => tx({ t: 'job', id });
    card.append(cv, info, b);
    body.appendChild(card);
  }
}
function skillsTab(body) {
  body.appendChild(mkEl('div', 'small', selSkill ? `Now click a bar slot to place <b class="pts">${SKILLS[selSkill].name}</b>.` : 'Pick a learned skill, then click a bar slot. Any job can use any learned skill.'));
  const sbar = mkEl('div', 'sbar');
  for (let i = 0; i < 6; i++) {
    const id = me.bar[i];
    const locked = i >= me.slots;
    const d = mkEl('div', 'slot', `${id ? `<img src="${skillURL(id)}">` : ''}<span class="n">${i + 1}</span>`);
    if (locked) { d.style.opacity = 0.3; d.title = `Unlocks at level ${[0, 0, 0, 10, 20, 30][i]}`; }
    else {
      d.title = id ? `${SKILLS[id].name} (right-click to clear)` : 'Empty';
      d.onclick = () => { if (selSkill) { tx({ t: 'bar', slot: i, skill: selSkill }); selSkill = null; } };
      d.oncontextmenu = (e) => { e.preventDefault(); tx({ t: 'bar', slot: i, skill: null }); };
    }
    sbar.appendChild(d);
  }
  body.appendChild(sbar);
  for (const jid of [me.job, ...JOB_ORDER.filter((j) => j !== me.job)]) { // active job first
    const lv = me.jobs[jid].lvl;
    body.appendChild(mkEl('div', 'skhead', `<b style="color:${JOBS[jid].color}">${JOBS[jid].name}</b> <span class="small">job level ${lv}</span>`));
    for (const id of skillsOfJob(jid)) {
      const sk = SKILLS[id], ok = lv >= sk.lvl, at = me.bar.indexOf(id);
      const row = mkEl('div', `skrow${ok ? '' : ' locked'}${selSkill === id ? ' sel' : ''}`);
      row.innerHTML = `<img src="${skillURL(id)}"><div class="grow"><b>${sk.name}</b> <span class="small">${ok ? `${sk.cd / 1000}s${at >= 0 ? ` &middot; slot ${at + 1}` : ''}` : `unlocks at job level ${sk.lvl}`}</span><div class="ds">${sk.desc}</div></div>`;
      if (ok) row.onclick = () => { selSkill = selSkill === id ? null : id; renderChar(); };
      body.appendChild(row);
    }
  }
}

function renderQuest() {
  const q = me.quest, el = $('quest');
  const bt = me.bounty ? `<br><b>Bounty</b> ${esc(MOBS[me.bounty.mob].name)}: ${me.bounty.p}/${me.bounty.need}${me.bounty.p >= me.bounty.need ? ' - /bounty claim' : ''}` : '';
  if (q.i >= QUESTS.length) { el.innerHTML = `<b>All quests complete</b><br>Type /bounty for a contract${bt}`; return; }
  const Q = QUESTS[q.i];
  const gname = esc((NPCS.find((n) => n.id === Q.giver) || { name: 'the quest giver' }).name);
  if (q.s === 0) el.innerHTML = `<b>!</b> ${esc(Q.title)}<br>Talk to ${gname}`;
  else if (q.s === 1) el.innerHTML = `<b>${esc(Q.title)}</b><br>Slay ${esc(MOBS[Q.mob].name)}: ${q.p}/${Q.need}`;
  else el.innerHTML = `<b>?</b> ${esc(Q.title)}<br>Return to ${gname}`;
  el.innerHTML += bt;
}

/** the hero's worn tokens with `it` swapped in, so a buyer can see exactly how it would look */
const TRY_SLOT = { head: 0, body: 1, legs: 2, boots: 3, gloves: 4, cape: 5, offhand: 6, weapon: 7, amulet: 8, ring: 9 };
let tryDir = 0;
function tryOnVs(it) {
  const vs = visTokens(me.eq), i = TRY_SLOT[it.s];
  if (i !== undefined) vs[i] = `${it.b}~${it.cl || ''}~${it.r}`;
  return vs;
}
/** "Wearing" and "With this" side by side; click to turn the hero around */
function tryOnPanel(it) {
  const box = mkEl('div', 'tryon');
  const draw = () => {
    box.innerHTML = '';
    const mk = (vs, label) => {
      const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
      cv.getContext('2d').drawImage(HERO.heroSprite(me.look, vs, tryDir, 0, me.job), 0, 0);
      const cell = mkEl('div', 'tcell'); cell.append(cv, mkEl('div', 'small', label)); return cell;
    };
    box.append(mk(visTokens(me.eq), 'Wearing'), mkEl('div', 'tarrow', '&rarr;'), mk(tryOnVs(it), 'With this'));
  };
  box.title = 'Click to turn around';
  box.onclick = () => { tryDir = [3, 2, 0, 1][tryDir]; draw(); };
  draw();
  return box;
}
function itemTip(it, cmp = false) {
  const r = RARITY[it.r];
  const lines = [`<span style="color:${r.c}">${esc(it.n)}</span> <span class="small">${r.n}</span>`];
  if (it.s === 'potion') lines.push(`Heals ${it.heal} health`, `Stack: ${it.c}`);
  else {
    lines.push(`<span class="small">${it.s} · req. level ${Math.max(1, it.l - 2)}</span>`);
    for (const sp of statParts(it)) lines.push(`<span style="color:#9fd0ff">${sp}</span>`);
    if (cmp) { const dl = deltaLine(it, true); if (dl) lines.push(dl); }
  }
  lines.push(`<span style="color:#ffd23a">Worth ${Math.max(1, Math.floor(it.v * 0.5))}g</span>`);
  return lines.join('<br>');
}
function slotEl(it, extra = '') {
  const d = document.createElement('div'); d.className = `slot ${extra}`;
  if (it) {
    d.style.boxShadow = `inset 0 0 0 2px ${RARITY[it.r].c}`;
    d.innerHTML = `<img src="${iconURL(it.b, it.r, it.cl)}">${it.c > 1 ? `<span class="cnt">${it.c}</span>` : ''}`;
  }
  return d;
}
function renderInv() {
  const eq = $('equip'); eq.innerHTML = '';
  for (const s of EQ_KEYS) {
    const it = me.eq[s]; const d = slotEl(it, 'eq');
    if (!it) d.insertAdjacentHTML('beforeend', `<span class="lbl">${EQ_LABEL[s].slice(0, 4).toUpperCase()}</span>`);
    d.title = it ? itemText(it) : EQ_LABEL[s];
    d.onclick = () => { selSlot = -1; showInfo(it, () => { tx({ t: 'unequip', s }); }, 'Unequip', null); };
    eq.appendChild(d);
  }
  drawPrev($('invPrev'), me.look, visTokens(me.eq), 0, 0, me.job);
  const grid = $('slots'); grid.innerHTML = '';
  me.inv.forEach((it, i) => {
    const d = slotEl(it); if (i === selSlot) d.classList.add('sel');
    if (tradeView && it) {
      d.title = itemText(it);
      if (tradeView.me.items.some((o) => o.u === it.u)) d.classList.add('offered');
      d.onclick = () => toggleOffer(it.u);
    } else d.onclick = () => { selSlot = i; renderInv(); };
    if (!tradeView) { d.ondblclick = () => primary(i); d.oncontextmenu = (e) => { e.preventDefault(); primary(i); }; }
    grid.appendChild(d);
  });
  $('invGold').innerHTML = `Gold: <span style="color:#ffd23a">${me.gold}</span> &nbsp; (${touchMode ? 'tap an item, then Equip' : 'right-click to use/equip'})`;
  const it = me.inv[selSlot];
  if (it) showInfo(it, () => primary(selSlot), it.s === 'potion' ? 'Drink' : 'Equip', selSlot);
  else if (selSlot < 0 && !$('itemInfo').dataset.keep) $('itemInfo').innerHTML = '<span class="small">Select an item.</span>';
}
function primary(i) {
  const it = me.inv[i]; if (!it) return;
  tx(it.s === 'potion' ? { t: 'use', slot: i } : { t: 'equip', slot: i });
}
function showInfo(it, act, label, slot) {
  const box = $('itemInfo');
  if (!it) { box.innerHTML = '<span class="small">Empty slot.</span>'; return; }
  box.innerHTML = `${itemTip(it, slot !== null)}<div class="btns"></div>`;
  if (it.s !== 'potion' && TRY_SLOT[it.s] !== undefined) box.insertBefore(tryOnPanel(it), box.querySelector('.btns'));
  const b = box.querySelector('.btns');
  const mk = (txt, fn) => { const x = document.createElement('button'); x.textContent = txt; x.onclick = fn; b.appendChild(x); };
  mk(label, act);
  if (slot !== null) {
    if (shopOpen) mk('Sell', () => { tx({ t: 'sell', slot }); selSlot = -1; });
    mk('Drop', () => { tx({ t: 'drop', slot }); selSlot = -1; });
  }
}
function toggleInv() {
  $('inv').classList.toggle('hidden');
  if (!$('inv').classList.contains('hidden') && me) renderInv();
}
document.addEventListener('click', (e) => { const c = e.target.dataset && e.target.dataset.close; if (c) $(c).classList.add('hidden'); });

// ---- dialog
function closeDialog() { $('dialog').classList.add('hidden'); shopOpen = false; dialogNpc = 0; }
function openDialog(m) {
  dialogNpc = m.npc; shopOpen = !!m.shop;
  const n = npcs.find((x) => x.id === m.npc);
  const box = $('dialog'); box.innerHTML = ''; box.classList.remove('hidden');
  const top = document.createElement('div'); top.className = 'top';
  const pc = document.createElement('canvas'); pc.width = 32; pc.height = 32;
  pc.getContext('2d').drawImage(HERO.npcSprite(n.key, 0, 0), 0, 0);
  const txt = document.createElement('div'); txt.className = 'txt';
  txt.innerHTML = `<div class="title">${esc(m.name)}${m.title ? ` - ${esc(m.title)}` : ''}</div>${esc(m.text)}${m.reward ? `<div class="rew">Reward: ${esc(m.reward)}</div>` : ''}`;
  top.append(pc, txt); box.appendChild(top);
  if (m.shop) {
    let tryBox = null;
    const showTry = (it) => { if (TRY_SLOT[it.s] === undefined) return; const nb = tryOnPanel(it); if (tryBox) tryBox.replaceWith(nb); tryBox = nb; };
    const firstGear = m.shop.find((x) => TRY_SLOT[x.s] !== undefined);
    if (firstGear) { tryBox = tryOnPanel(firstGear); box.appendChild(tryBox); box.appendChild(mkEl('div', 'small', 'Tap or hover an item to try it on.')); }
    m.shop.forEach((it, i) => {
      const row = document.createElement('div'); row.className = 'shopRow';
      row.onmouseenter = row.onclick = () => showTry(it);
      const stats = statParts(it).join(' ');
      row.innerHTML = `<img src="${iconURL(it.b, it.r, it.cl)}"><div class="grow"><span style="color:${RARITY[it.r].c}">${esc(it.n)}</span><br><span class="small">${stats}</span>${wearsSlot(it) ? `<br>${deltaLine(it)}` : ''}</div><span style="color:#ffd23a">${it.price}g</span>`;
      const b = document.createElement('button'); b.textContent = 'Buy'; b.onclick = () => tx({ t: 'buy', i }); row.appendChild(b);
      box.appendChild(row);
    });
    const hint = document.createElement('div'); hint.className = 'small'; hint.textContent = 'Open your pack (I) and select an item to sell it here.'; box.appendChild(hint);
    $('inv').classList.remove('hidden'); renderInv();
  }
  const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
  for (const o of m.opts || []) {
    const b = document.createElement('button'); b.textContent = o.l;
    b.onclick = () => { tx({ t: o.k === 'accept' ? 'questAccept' : 'questTurnIn' }); closeDialog(); };
    btns.appendChild(b);
  }
  const c = document.createElement('button'); c.textContent = 'Close'; c.onclick = closeDialog; btns.appendChild(c);
  box.appendChild(btns);
}

$('chatIn').addEventListener('focus', () => keys.clear());

// ------------------------------------------------------------------ rendering
const DAY_MS = 8 * 60 * 1000;
const SKY = [[0, [255, 207, 160]], [0.08, [255, 255, 255]], [0.52, [255, 255, 255]], [0.62, [255, 178, 122]], [0.72, [150, 140, 215]], [0.88, [105, 120, 185]], [0.96, [140, 135, 200]], [1, [255, 207, 160]]];
function ambient(phase) {
  for (let i = 1; i < SKY.length; i++) {
    if (phase <= SKY[i][0]) {
      const [p0, c0] = SKY[i - 1], [p1, c1] = SKY[i], f = (phase - p0) / (p1 - p0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
    }
  }
  return [255, 255, 255];
}
const flashCache = new WeakMap();
function flashOf(spr) {
  let f = flashCache.get(spr);
  if (!f) { f = SP.mkCanvas(spr.width, spr.height); const x = f.getContext('2d'); x.drawImage(spr, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, f.width, f.height); flashCache.set(spr, f); }
  return f;
}
/** ground aura in the job's colour: grows with main level (rings at 10 / 30 / 50) */
function heroAura(cx, cy, job, lvl, t, seed) {
  const tier = lvl >= 50 ? 3 : lvl >= 30 ? 2 : lvl >= 10 ? 1 : 0;
  if (!tier || !JOBS[job]) return;
  const col = JOBS[job].color, pulse = 0.55 + 0.2 * Math.sin(t / 420 + seed);
  wx.fillStyle = col;
  wx.globalAlpha = 0.14 + 0.05 * tier;
  wx.fillRect(Math.round(cx - 8), Math.round(cy - 2), 16, 5); wx.fillRect(Math.round(cx - 6), Math.round(cy - 3), 12, 7);
  wx.globalAlpha = pulse;
  for (let a = 0; a < 6.283; a += 0.42) wx.fillRect(Math.round(cx + Math.cos(a) * 9), Math.round(cy + Math.sin(a) * 4), 1, 1);
  if (tier >= 2) {
    wx.globalAlpha = Math.min(1, pulse + 0.2);
    const rot = t / 900 + seed;
    for (let k = 0; k < 5; k++) { const a = rot + k * 1.2566; wx.fillRect(Math.round(cx + Math.cos(a) * 13), Math.round(cy + Math.sin(a) * 6), 2, 1); }
  }
  if (tier >= 3) { // legend: motes drift upward around the hero
    wx.globalAlpha = 0.85; wx.fillStyle = '#ffffff';
    for (let k = 0; k < 4; k++) { const ph = ((t / 1400 + k * 0.25 + seed) % 1), a = k * 1.7 + seed; wx.fillRect(Math.round(cx + Math.cos(a) * 8), Math.round(cy - ph * 18), 1, 1); }
  }
  wx.globalAlpha = 1;
}
function shadow(x, y, w) {
  wx.fillStyle = 'rgba(10,8,20,.38)';
  wx.fillRect(Math.round(x - w / 2 + 1), Math.round(y), w - 2, 1); wx.fillRect(Math.round(x - w / 2), Math.round(y + 1), w, 2); wx.fillRect(Math.round(x - w / 2 + 1), Math.round(y + 3), w - 2, 1);
}

function drawHealthBar(x, y, w, frac, col = '#d83a3a') {
  wx.fillStyle = '#16121f'; wx.fillRect(x - 1, y - 1, w + 2, 4);
  wx.fillStyle = '#4a1a1a'; wx.fillRect(x, y, w, 2);
  wx.fillStyle = col; wx.fillRect(x, y, Math.max(1, Math.round(w * frac)), 2);
  wx.fillStyle = 'rgba(255,255,255,.4)'; wx.fillRect(x, y, Math.max(1, Math.round(w * frac)), 1);
}

const labels = []; // screen-space text drawn after upscale

function drawEntity(o, t, tgId) {
  const fadeA = o.dying ? Math.max(0, 1 - (t - o.dying) / 700) : 1;
  let lunge = 0, lx0 = 0, ly0 = 0;
  if (t - o.atkAt < 160) { lunge = Math.sin(((t - o.atkAt) / 160) * Math.PI) * 3; lx0 = (o.atkDx || 0) * lunge; ly0 = (o.atkDy || 0) * lunge; }
  const flash = t - o.hitAt < 110;
  let spr, ox = 0, oy = 0, w = 16;
  if (o.k === 'p') {
    if (o.d) { // gravestone
      const px = Math.round(o.rx * TS - camX), py = Math.round(o.ry * TS - camY);
      wx.fillStyle = '#16121f'; wx.fillRect(px + 4, py + 3, 8, 12);
      wx.fillStyle = '#9a9aa8'; wx.fillRect(px + 5, py + 4, 6, 10); wx.fillStyle = '#c8c8d4'; wx.fillRect(px + 5, py + 4, 6, 2);
      wx.fillStyle = '#6a6a78'; wx.fillRect(px + 7, py + 7, 2, 5); wx.fillRect(px + 6, py + 8, 4, 1);
      return;
    }
    let fr = o.moving ? [1, 2, 3, 2][Math.floor(t / 115) % 4] : Math.floor(t / 600 + o.i) % 2 ? 4 : 0; // stride / passing / stride, or idle breath
    if (!o.moving && (t / 1000 + o.i * 0.37) % 4 < 0.14) fr = 5; // blink
    const since = t - o.atkAt;
    const act = since < 130 ? 2 : since < 280 ? 3 : o.castAt && t - o.castAt < 450 ? 4 : 0;
    let sf = fr, a = act;
    if (o.em && !o.moving && act === 0) { a = { wave: 5, dance: 6, sit: 7, cheer: 8 }[o.em] || 0; sf = Math.floor(t / (o.em === 'dance' ? 260 : 380)) % 2; if (a === 8) oy = -Math.round(Math.abs(Math.sin(t / 190)) * 3); }
    spr = HERO.heroSprite(o.lk, o.vs, o.f, sf, o.c, a);
  } else {
    const fr = FLYERS.has(o.s) ? Math.floor(t / 110) % 2 : SLIMES.has(o.s) ? Math.floor(t / 320) % 2 : o.moving ? Math.floor(t / 160) % 2 : BIG.has(o.s) ? Math.floor(t / 600) % 2 : 0;
    spr = SP.mobSprite(o.s, o.f, HUMANOID.has(o.s) ? (o.moving ? [1, 0, 3, 0][Math.floor(t / 130) % 4] : 0) : fr);
    if (SP.SIDE_MOBS.has(o.s)) spr = SP.mobSprite(o.s, o.f === 2 ? 2 : 3, fr);
    if (FLYERS.has(o.s)) oy = -4 + Math.round(Math.sin(t / 180 + o.i) * 2);
  }
  w = spr.width;
  const baseX = o.rx * TS + 8 - w / 2 + lx0, baseY = o.ry * TS + 16 - spr.height + ly0 + oy;
  const px = Math.round(baseX - camX), py = Math.round(baseY - camY);
  if (px < -40 || py < -40 || px > VW + 40 || py > VH + 40) return;
  shadow(px + w / 2, py + spr.height - (FLYERS.has(o.s) ? 0 : 3) - oy * (FLYERS.has(o.s) ? -1 : 0) + (FLYERS.has(o.s) ? 0 : 0), BIG.has(o.s) ? 22 : FLYERS.has(o.s) ? 6 : o.k === 'p' ? 14 : 10);
  if (o.id === undefined && o.i === tgId) {
    const pulse = Math.floor(t / 250) % 2;
    wx.fillStyle = '#ff4a4a';
    const x0 = Math.round(o.rx * TS - camX) - pulse, y0 = Math.round(o.ry * TS - camY) - pulse, ww = (BIG.has(o.s) ? 2 : 1) * 16 + pulse * 2;
    for (const [cx, cy] of [[x0, y0 + 11], [x0 + ww - 3, y0 + 11]]) { wx.fillRect(cx, cy + 3, 3, 1); }
    wx.fillRect(x0 + 1, y0 + 14, 3, 1); wx.fillRect(x0 + 12 + pulse * 2, y0 + 14, 3, 1);
    wx.fillRect(x0, y0 + 13, 1, 2); wx.fillRect(x0 + 15 + pulse * 2, y0 + 13, 1, 2);
  }
  if (o.k === 'p') heroAura(px + w / 2, py + spr.height - 2, o.c, o.l, t, o.i);
  wx.globalAlpha = fadeA;
  wx.drawImage(spr, px, py);
  if (flash) { wx.globalAlpha = 0.65 * fadeA; wx.drawImage(flashOf(spr), px, py); }
  wx.globalAlpha = 1;
  if (o.k === 'm' && o.st) { wx.fillStyle = '#ffe066'; const sx = px + w / 2 - 4; for (let i = 0; i < 3; i++) wx.fillRect(sx + i * 3 + ((Math.floor(t / 100) + i) % 2), py - 3, 1, 1); }
  if (o.dying) return;
  // overhead bars + labels (a hero's head sits a few rows below the top of its 32px frame)
  const cx = px + w / 2, pyT = o.k === 'p' ? py + 3 : py;
  const barW = BIG.has(o.s) ? 26 : 12;
  if (o.k === 'm' && (o.h < o.mh || o.i === tgId)) drawHealthBar(Math.round(cx - barW / 2), py - 2 - (BIG.has(o.s) ? 0 : 0), barW, o.h / o.mh);
  if (o.k === 'p' && o.i !== myId) drawHealthBar(Math.round(cx - 6), pyT - 1, 12, o.h / o.mh, '#4ac86a');
  if (o.fx && o.fx.length) o.fx.slice(0, 6).forEach((id, i) => { wx.fillStyle = EFFECTS[id] ? EFFECTS[id].col : '#fff'; wx.fillRect(Math.round(cx - o.fx.length * 2) + i * 4, pyT - 7, 3, 3); });
  const name = o.k === 'p' ? o.n : mobDef(o).name;
  const col = o.k === 'p' ? (o.i === myId ? '#8be88b' : inParty(o.i) ? '#6ab8ff' : '#ffffff') : levelColor(o.l);
  if (o.k !== 'm' || settings.names || o.i === tgId || mobDef(o).boss) labels.push({ x: cx, y: pyT - (o.k === 'm' && (o.h < o.mh || o.i === tgId) ? 5 : 2), txt: o.k === 'p' ? name : `${name}  ${o.l}`, col, boss: !!mobDef(o).boss });
  if (o.k === 'p' && o.ti && !(o.fx && o.fx.length)) labels.push({ x: cx, y: pyT - 10, txt: titleText(o.ti), col: '#ffd23a' });
  if (o.say && t - o.sayAt < 5000) labels.push({ x: cx, y: pyT - 14, txt: o.say, col: '#ffffff', bubble: true });
}

function drawFx(t) {
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i], age = t - f.t0;
    const dur = (f.k === 'warn' ? f.ms : { swing: 220, bolt: 200, arrow: 200, fire: 380, cleave: 300, bash: 300, cry: 600, nova: 450, heal: 700, dash: 350, levelup: 1300, die: 1, holy: 230, shadow: 250, lightning: 300, ring: 520, burst: 440, meteor: 700, rain: 850 }[f.k]) || 300;
    if (age > dur) { fxs.splice(i, 1); continue; }
    const p = age / dur;
    const [sx, sy] = tc(f.x, f.y).map((v, j) => Math.round(v - (j ? camY : camX)));
    let ex = sx, ey = sy;
    if (f.tx !== undefined) [ex, ey] = tc(f.tx, f.ty).map((v, j) => Math.round(v - (j ? camY : camX)));
    switch (f.k) {
      case 'swing': { // crescent slash at the victim
        const n = Math.floor(p * 6) + 2;
        wx.fillStyle = '#ffffff';
        for (let k = 0; k < n; k++) { const a = -1.2 + k * 0.38; wx.fillRect(Math.round(ex + Math.cos(a + 0.6) * 7), Math.round(ey + Math.sin(a + 0.6) * 7), 2, 2); }
        wx.fillStyle = '#c8d4ff';
        for (let k = 0; k < n - 1; k++) { const a = -1.2 + k * 0.38; wx.fillRect(Math.round(ex + Math.cos(a + 0.6) * 5), Math.round(ey + Math.sin(a + 0.6) * 5), 1, 1); }
        break;
      }
      case 'bolt': case 'fire': case 'arrow': {
        const q = f.k === 'fire' ? Math.min(1, p / 0.7) : p;
        const x = sx + (ex - sx) * q, y = sy + (ey - sy) * q;
        if (f.k === 'arrow') {
          const ang = Math.atan2(ey - sy, ex - sx);
          for (let k = 0; k < 6; k++) wx.fillStyle = k < 1 ? '#fff' : '#a07a40', wx.fillRect(Math.round(x - Math.cos(ang) * k), Math.round(y - Math.sin(ang) * k), 1, 1);
          wx.fillStyle = '#dfe4ec'; wx.fillRect(Math.round(x), Math.round(y), 2, 2);
        } else if (f.k === 'bolt') {
          wx.fillStyle = '#b86bff'; wx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3); wx.fillStyle = '#fff'; wx.fillRect(Math.round(x), Math.round(y), 1, 1);
          wx.fillStyle = '#7a3fc0'; wx.fillRect(Math.round(x - (ex - sx) * 0.06), Math.round(y - (ey - sy) * 0.06), 1, 1);
        } else if (p < 0.7) {
          for (let k = 4; k >= 0; k--) { const qq = Math.max(0, q - k * 0.04); wx.fillStyle = ['#fff2a0', '#ffb030', '#ff6a1a', '#c8381a', '#6a1a10'][k]; wx.fillRect(Math.round(sx + (ex - sx) * qq) - (4 - k >> 1), Math.round(sy + (ey - sy) * qq) - (4 - k >> 1), 6 - k, 6 - k); }
        } else {
          const r = (p - 0.7) / 0.3 * 9;
          for (let k = 0; k < 14; k++) { const a = (k / 14) * 6.283; wx.fillStyle = k % 2 ? '#ffb030' : '#ff6a1a'; wx.fillRect(Math.round(ex + Math.cos(a) * r), Math.round(ey + Math.sin(a) * r), 2, 2); }
        }
        break;
      }
      case 'cleave': {
        const r = 6 + p * (f.r ? f.r * 9 : 20);
        for (let k = 0; k < 28; k++) { const a = (k / 28) * 6.283 + p * 2; wx.fillStyle = k % 3 ? '#e8e8f0' : '#ff6a6a'; wx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r), 2, 2); }
        break;
      }
      case 'nova': {
        const r = 6 + p * (f.r ? f.r * 8.6 : 27);
        for (let k = 0; k < 40; k++) { const a = (k / 40) * 6.283; wx.fillStyle = k % 2 ? (f.col || '#8fe0ff') : '#ffffff'; wx.globalAlpha = 1 - p; wx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r), 2, 2); }
        wx.globalAlpha = 1;
        break;
      }
      case 'holy': case 'shadow': {
        const c1 = f.k === 'holy' ? '#fff2a0' : '#b050ff', c2 = f.k === 'holy' ? '#ffffff' : '#3a1050';
        for (let k = 4; k >= 0; k--) { const qq = Math.max(0, p - k * 0.05); wx.globalAlpha = 1 - k * 0.18; wx.fillStyle = k ? c1 : c2; wx.fillRect(Math.round(sx + (ex - sx) * qq) - 1, Math.round(sy + (ey - sy) * qq) - 1, 3, 3); }
        wx.globalAlpha = 1;
        break;
      }
      case 'lightning': {
        let px = sx, py = sy;
        wx.fillStyle = p < 0.5 ? '#ffffff' : '#ffe866';
        for (let k = 1; k <= 7; k++) {
          const q = k / 7, jx = k < 7 ? ((k * 37 + Math.floor(f.t0)) % 7) - 3 : 0, jy = k < 7 ? ((k * 53 + Math.floor(f.t0)) % 7) - 3 : 0;
          const nx = sx + (ex - sx) * q + jx, ny = sy + (ey - sy) * q + jy;
          for (let s2 = 0; s2 <= 6; s2++) wx.fillRect(Math.round(px + ((nx - px) * s2) / 6), Math.round(py + ((ny - py) * s2) / 6), 1, 1);
          px = nx; py = ny;
        }
        break;
      }
      case 'warn': { // telegraphed ground circle
        const rr = (f.r || 2) * TS, pulse = 0.25 + 0.15 * Math.sin(age / 90);
        wx.fillStyle = f.col || '#ff3a2a';
        for (let yy = -Math.ceil(rr); yy <= Math.ceil(rr); yy += 2) {
          const hw = Math.sqrt(Math.max(0, rr * rr - yy * yy));
          wx.globalAlpha = pulse * 0.6; wx.fillRect(Math.round(sx - hw), sy + yy, Math.round(hw * 2), 2);
        }
        wx.globalAlpha = 0.9;
        for (let k = 0; k < 48; k++) { const a = (k / 48) * 6.283; wx.fillRect(Math.round(sx + Math.cos(a) * rr), Math.round(sy + Math.sin(a) * rr), 1, 1); }
        wx.globalAlpha = 1;
        break;
      }
      case 'ring': {
        const rr = (f.r || 2) * TS * (0.3 + 0.7 * p);
        wx.globalAlpha = 1 - p; wx.fillStyle = f.col || '#ffffff';
        for (let k = 0; k < 40; k++) { const a = (k / 40) * 6.283; wx.fillRect(Math.round(sx + Math.cos(a) * rr), Math.round(sy + Math.sin(a) * rr), 2, 2); }
        wx.globalAlpha = 1;
        break;
      }
      case 'burst': {
        const rr = (f.r || 2) * TS * p;
        if (p < 0.35) { wx.globalAlpha = 0.5 * (1 - p / 0.35); wx.fillStyle = '#fff'; wx.fillRect(Math.round(sx - (f.r || 2) * TS * 0.5), Math.round(sy - (f.r || 2) * TS * 0.5), Math.round((f.r || 2) * TS), Math.round((f.r || 2) * TS)); wx.globalAlpha = 1; }
        wx.globalAlpha = 1 - p; wx.fillStyle = f.col || '#ff6a3a';
        for (let k = 0; k < 28; k++) { const a = (k / 28) * 6.283; wx.fillRect(Math.round(sx + Math.cos(a) * rr), Math.round(sy + Math.sin(a) * rr), 2, 2); }
        wx.globalAlpha = 1;
        break;
      }
      case 'meteor': {
        const fall = Math.min(1, p / 0.55), rr = (f.r || 2.5) * TS;
        if (p < 0.55) {
          const cx = sx + (1 - fall) * 30, cy = sy - (1 - fall) * 130;
          for (let k = 5; k >= 0; k--) { wx.fillStyle = ['#fff2a0', '#ffb030', '#ff6a1a', '#c8381a', '#6a1a10', '#3a1008'][k]; wx.fillRect(Math.round(cx + k * 2) - 3, Math.round(cy - k * 4) - 3, 7 - k, 7 - k); }
        } else {
          const q = (p - 0.55) / 0.45;
          wx.globalAlpha = 1 - q; wx.fillStyle = '#ff6a1a';
          for (let k = 0; k < 36; k++) { const a = (k / 36) * 6.283; wx.fillRect(Math.round(sx + Math.cos(a) * rr * q), Math.round(sy + Math.sin(a) * rr * q), 3, 3); }
          wx.fillStyle = '#ffe066';
          for (let k = 0; k < 18; k++) { const a = (k / 18) * 6.283 + 0.2; wx.fillRect(Math.round(sx + Math.cos(a) * rr * q * 0.6), Math.round(sy + Math.sin(a) * rr * q * 0.6), 2, 2); }
          wx.globalAlpha = 1;
        }
        break;
      }
      case 'rain': {
        const rr = (f.r || 3) * TS;
        for (let k = 0; k < 18; k++) {
          const a = k * 2.4, rad = rr * (0.2 + ((k * 7) % 10) / 12), ph = (p * 2.4 + k * 0.17) % 1;
          wx.fillStyle = '#d8d8e0'; wx.fillRect(Math.round(sx + Math.cos(a) * rad), Math.round(sy + Math.sin(a) * rad * 0.8 - 50 * (1 - ph)), 1, 5);
          if (ph > 0.9) { wx.fillStyle = '#ffd23a'; wx.fillRect(Math.round(sx + Math.cos(a) * rad) - 1, Math.round(sy + Math.sin(a) * rad * 0.8), 3, 1); }
        }
        break;
      }
      case 'bash': {
        for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.283, r = 3 + p * 10; wx.fillStyle = k % 2 ? '#ffd23a' : '#fff'; wx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r), 2, 2); }
        break;
      }
      case 'cry': {
        for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.283; const r = 6 + p * 14; wx.fillStyle = '#ff6a6a'; wx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r - p * 8), 1, 4); }
        break;
      }
      case 'heal': {
        for (let k = 0; k < 6; k++) { const x = sx - 8 + k * 3 + ((k * 7) % 3), y = sy + 6 - p * 22 - (k % 3) * 3; wx.fillStyle = '#6aff8a'; wx.fillRect(x, y, 1, 3); wx.fillRect(x - 1, y + 1, 3, 1); }
        break;
      }
      case 'dash': {
        const d = [[0, -1], [0, 1], [1, 0], [-1, 0]];
        wx.fillStyle = '#fff';
        for (let k = 0; k < 4; k++) wx.fillRect(sx - 8 + k * 4, sy + 4 - p * 6, 1, 4);
        break;
      }
      case 'levelup': {
        for (let k = 0; k < 16; k++) { const a = (k / 16) * 6.283 + p * 5; wx.fillStyle = k % 2 ? '#ffe066' : '#fff'; wx.fillRect(Math.round(sx + Math.cos(a) * 10), Math.round(sy + 6 - p * 40 + Math.sin(a) * 3), 2, 2); }
        wx.globalAlpha = 0.5 * (1 - p); wx.fillStyle = '#ffe066'; wx.fillRect(sx - 6, sy - 40, 12, 46); wx.globalAlpha = 1;
        break;
      }
      default:
    }
  }
}
function drawParts(t, dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i], age = t - q.t0;
    if (age > q.life) { parts.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 70 * dt;
    wx.globalAlpha = 1 - age / q.life;
    wx.fillStyle = q.col; wx.fillRect(Math.round(q.x - camX), Math.round(q.y - camY), q.size, q.size);
  }
  wx.globalAlpha = 1;
}

function drawDrop(d, t) {
  const bob = Math.round(Math.sin(t / 300 + d.i) * 1.2);
  const px = d.x * TS - camX, py = d.y * TS - camY;
  shadow(px + 8, py + 13, 8);
  const icon = d.g ? SP.itemIcon('gold', 0) : SP.itemIcon(d.b, d.r, d.cl);
  wx.drawImage(icon, px, py - 2 + bob);
  if (!d.g && d.r > 0 && Math.floor(t / 200 + d.i) % 3 === 0) { wx.fillStyle = SP.RARITY_COL[d.r]; wx.fillRect(px + 3 + ((d.i * 5) % 9), py + 2 + ((d.i * 3) % 7), 1, 1); }
}

function drawPortal(n, t) {
  const cx = Math.round(n.x * TS + 8 - camX), cy = Math.round(n.y * TS + 8 - camY);
  const exit = n.name === 'Exit', ice = /Frozen/.test(n.name), fire = /Ember/.test(n.name), c1 = exit ? '#8aff9a' : ice ? '#8affff' : fire ? '#ffb040' : '#c06bff', c2 = exit ? '#3a8a5a' : ice ? '#3a8ac8' : fire ? '#c8381a' : '#7a3fc0';
  shadow(cx, cy + 7, 12);
  for (let dy = -10; dy <= 10; dy++) {
    const hw = Math.round(7 * Math.sqrt(1 - (dy / 10.5) ** 2));
    wx.fillStyle = '#120a24'; wx.fillRect(cx - hw, cy + dy - 2, hw * 2, 1);
    wx.fillStyle = c1; wx.fillRect(cx - hw, cy + dy - 2, 1, 1); wx.fillRect(cx + hw - 1, cy + dy - 2, 1, 1);
  }
  wx.fillStyle = c1; wx.fillRect(cx - 3, cy - 12, 6, 1); wx.fillRect(cx - 3, cy + 8, 6, 1);
  for (let i = 0; i < 14; i++) {
    const a = t / 380 + i * 0.45, r = 1.5 + (i % 7) * 0.8;
    wx.fillStyle = i % 2 ? c1 : c2; wx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy - 2 + Math.sin(a) * r * 1.5), 1, 1);
  }
  labels.push({ x: cx, y: cy - 16, txt: n.name, col: c1 });
}

function drawNpc(n, t) {
  if (n.role === 'portal') return drawPortal(n, t);
  const dir = n.key === 'guard' ? 0 : (Math.floor(t / 2500 + n.id) % 6 === 0 ? 3 : 0);
  const fr = (t / 1000 + n.id * 0.7) % 4 < 0.14 ? 5 : Math.floor(t / 700 + n.id) % 2 ? 4 : 0; // blink, breathe
  const spr = HERO.npcSprite(n.key, dir, fr);
  const px = n.x * TS - camX, py = n.y * TS - camY; // the tile's top-left; the 32px sprite stands on its bottom edge
  shadow(px + 8, py + 13, 12);
  wx.drawImage(spr, px - 8, py - 16);
  labels.push({ x: px + 8, y: py - 14, txt: n.name, col: '#ffe066' });
  if (n.role === 'quest' && me) {
    const q = me.quest; const mark = q.i >= QUESTS.length || QUESTS[q.i].giver !== n.id ? '' : q.s === 0 ? '!' : q.s === 2 ? '?' : '';
    if (mark) labels.push({ x: px + 8, y: py - 24 - Math.round(Math.sin(t / 200) * 2), txt: mark, col: mark === '!' ? '#ffe066' : '#6aff8a', mark: true });
  }
}

function render(t, dt) {
  const m = meEnt();
  // camera
  let cx, cy;
  if (inGame && m) { cx = m.rx * TS + 8; cy = m.ry * TS + 8; }
  else { const a = t / 22000; cx = TOWN.cx * TS + Math.cos(a) * 150 + 8; cy = TOWN.cy * TS + Math.sin(a * 1.3) * 90 + 8; }
  let sx = 0, sy = 0;
  if (shake > 0.3) { sx = Math.round((Math.random() - 0.5) * shake); sy = Math.round((Math.random() - 0.5) * shake); shake *= 0.85; }
  camX = Math.max(0, Math.min(W * TS - VW, Math.round(cx - VW / 2))) + sx;
  camY = Math.max(0, Math.min(H * TS - VH, Math.round(cy - VH / 2))) + sy;
  camX = Math.max(0, Math.min(W * TS - VW, camX)); camY = Math.max(0, Math.min(H * TS - VH, camY));

  { const CP = CHUNK * TS; // draw only the baked chunks the camera overlaps
    for (let cy = Math.floor(camY / CP); cy <= Math.floor((camY + VH - 1) / CP); cy++) for (let cx = Math.floor(camX / CP); cx <= Math.floor((camX + VW - 1) / CP); cx++) {
      if (cx < 0 || cy < 0 || cx * CHUNK >= W || cy * CHUNK >= H) continue;
      wx.drawImage(art.chunk(cx, cy), cx * CP - camX, cy * CP - camY);
    } }
  const tx0 = Math.floor(camX / TS), ty0 = Math.floor(camY / TS), tx1 = Math.min(W - 1, tx0 + Math.ceil(VW / TS) + 1), ty1 = Math.min(H - 1, ty0 + Math.ceil(VH / TS) + 1);
  const wf = Math.floor(t / 420) % 4;
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) { const g = world.g[y * W + x]; if (g === G.WATER || g === G.DEEP) drawWaterTile(wx, art, world, x, y, x * TS - camX, y * TS - camY, wf); else if (g === G.LAVA) drawLavaTile(wx, art, x * TS - camX, y * TS - camY, wf); }
  if (clickMark && t - clickMark.t0 < 500) {
    const k = Math.floor((t - clickMark.t0) / 120) % 2, mx = clickMark.x * TS - camX, my = clickMark.y * TS - camY;
    wx.fillStyle = '#ffe066'; for (const [a, b] of [[0, 0], [13 - k, 0], [0, 13 - k], [13 - k, 13 - k]]) wx.fillRect(mx + a + k, my + b + k, 3, 3 - 2 * 0);
  }

  labels.length = 0;
  const tgId = me ? me.tg : 0;
  for (const o of ents.values()) if (o.k === 'd') drawDrop(o, t);
  // y-sorted pass: trees + entities
  const list = [];
  for (let y = ty0 - 1; y <= ty1 + 2 && y < H; y++) {
    if (y < 0) continue;
    for (const tr of art.trees[y]) if (tr.x >= tx0 - 1 && tr.x <= tx1 + 1) list.push({ key: y, tree: tr, y });
  }
  for (const o of ents.values()) if (o.k === 'p' || o.k === 'm') list.push({ key: o.ry + (o.d ? -0.5 : 0), ent: o });
  for (const n of npcs) list.push({ key: n.y, npc: n });
  list.sort((a, b) => a.key - b.key);
  for (const it of list) {
    if (it.tree) { const s = treeSprite(it.tree.kind, it.tree.v); wx.drawImage(s, it.tree.x * TS - 4 - camX, it.y * TS + 16 - 32 - camY); }
    else if (it.ent) drawEntity(it.ent, t, tgId);
    else drawNpc(it.npc, t);
  }
  drawFx(t);
  drawParts(t, dt);

  // lighting (day/night)
  const phase = (((Date.now() + timeOff) % DAY_MS) + DAY_MS) % DAY_MS / DAY_MS;
  const amb = zoneKind === 'dungeon' ? (zoneTheme === 'ice' ? [120, 150, 200] : zoneTheme === 'fire' ? [170, 110, 90] : [92, 94, 135]) : ambient(phase);
  const dark = 1 - (amb[0] + amb[1] + amb[2]) / 765;
  if (dark > 0.02) {
    lx.globalCompositeOperation = 'source-over';
    lx.fillStyle = `rgb(${amb[0]},${amb[1]},${amb[2]})`; lx.fillRect(0, 0, VW, VH);
    lx.globalCompositeOperation = 'lighter';
    const light = (x, y, r, col) => {
      const g = lx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); lx.fillStyle = g; lx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const o of ents.values()) if (o.k === 'p' && !o.d) light(o.rx * TS + 8 - camX, o.ry * TS + 4 - camY, zoneKind === 'dungeon' ? 66 : 46, 'rgba(255,200,120,.8)');
    for (const n of npcs) light(n.x * TS + 8 - camX, n.y * TS + 6 - camY, 30, 'rgba(255,190,110,.6)');
    for (const f of fxs) if (['fire', 'bolt', 'levelup', 'nova'].includes(f.k)) light(f.x * TS + 8 - camX, f.y * TS + 8 - camY, 40, 'rgba(255,170,90,.6)');
    for (const o of ents.values()) if (o.k === 'm' && BIG.has(o.s)) light(o.rx * TS + 8 - camX, o.ry * TS - camY, 26, 'rgba(255,140,40,.7)');
    wx.globalCompositeOperation = 'multiply'; wx.drawImage(lm, 0, 0); wx.globalCompositeOperation = 'source-over';
  }

  // upscale
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(wc, 0, 0, VW * S, VH * S);
  drawLabels(t);
}

function drawLabels(t) {
  const fs = Math.max(touchMode ? 10 : 8, S * 3);
  sctx.font = `${fs}px "Press Start 2P", "Lucida Console", monospace`;
  sctx.textAlign = 'center'; sctx.textBaseline = 'alphabetic';
  sctx.lineJoin = 'round';
  for (const l of labels) {
    const x = l.x * S, y = l.y * S;
    if (l.bubble) {
      const w = sctx.measureText(l.txt).width + 10;
      sctx.fillStyle = 'rgba(13,10,24,.85)'; sctx.fillRect(x - w / 2, y - fs - 2, w, fs + 8);
      sctx.fillStyle = '#fff'; sctx.fillText(l.txt, x, y); continue;
    }
    if (l.mark) sctx.font = `${fs * 2}px "Press Start 2P", monospace`;
    sctx.lineWidth = Math.max(3, S); sctx.strokeStyle = '#0d0a18'; sctx.strokeText(l.txt, x, y);
    sctx.fillStyle = l.col; sctx.fillText(l.txt, x, y);
    if (l.mark) sctx.font = `${fs}px "Press Start 2P", monospace`;
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i], age = t - f.t0;
    if (age > 1000) { floaters.splice(i, 1); continue; }
    const rise = Math.min(1, age / 1000) * 18, a = age > 700 ? 1 - (age - 700) / 300 : 1;
    const size = f.big ? fs * 1.5 : fs;
    sctx.font = `${size}px "Press Start 2P", monospace`;
    sctx.globalAlpha = a;
    const x = (f.x - camX) * S, y = (f.y - rise - camY) * S;
    sctx.lineWidth = Math.max(3, S); sctx.strokeStyle = '#0d0a18'; sctx.strokeText(f.txt, x, y);
    sctx.fillStyle = f.col; sctx.fillText(f.txt, x, y);
    sctx.globalAlpha = 1;
  }
}

function drawMinimap(t) {
  const mc = $('minimap'), x = mc.getContext('2d'); const m = meEnt();
  if (!m) return;
  x.imageSmoothingEnabled = false;
  x.fillStyle = '#0d0a18'; x.fillRect(0, 0, 64, 64);
  const ox = Math.max(0, Math.min(W - 64, Math.round(m.x) - 32)), oy = Math.max(0, Math.min(H - 64, Math.round(m.y) - 32));
  x.drawImage(art.minimap, ox, oy, 64, 64, 0, 0, 64, 64);
  for (const o of ents.values()) {
    if (o.dying) continue;
    const px = o.x - ox, py = o.y - oy; if (px < 0 || py < 0 || px >= 64 || py >= 64) continue;
    if (o.k === 'm') { x.fillStyle = BIG.has(o.s) ? '#ff9a3a' : '#e04a4a'; x.fillRect(px, py, BIG.has(o.s) ? 3 : 1, BIG.has(o.s) ? 3 : 1); }
    else if (o.k === 'p' && o.i !== myId) { x.fillStyle = '#6ae0ff'; x.fillRect(px - 1, py - 1, 2, 2); }
  }
  for (const n of npcs) { x.fillStyle = '#ffe066'; x.fillRect(n.x - ox - 1, n.y - oy - 1, 2, 2); }
  for (const [id, d] of pmData) { // party members stay on the map even when out of view
    if (id === myId || (d.z && d.z !== zoneId)) continue;
    const px = d.x - ox, py = d.y - oy; if (px < 0 || py < 0 || px >= 64 || py >= 64) continue;
    x.fillStyle = '#6aff8a'; x.fillRect(px - 1, py - 1, 3, 3); x.fillStyle = '#0d0a18'; x.fillRect(px, py, 1, 1);
  }
  if (Math.floor(t / 400) % 2) { x.fillStyle = '#fff'; x.fillRect(m.x - ox - 1, m.y - oy - 1, 3, 3); } else { x.fillStyle = '#8be88b'; x.fillRect(m.x - ox - 1, m.y - oy - 1, 3, 3); }
}

let last = now();
function frame() { tickFrame(); requestAnimationFrame(frame); }
function tickFrame() {
  if (!VW || !VH) return; // viewport collapsed (hidden pane / minimised): nothing to draw
  const t = now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
  stepEntities(dt, t);
  if (inGame) {
    pollGamepad();
    runKeys(t); runGoal(t);
    if (pendingInvite && !pendingInvite.offer && t > pendingInvite.until) { pendingInvite = null; showInvite(); }
    if (me) {
      updateCooldowns(t);
      if (t - lastBuffDraw > 250) { lastBuffDraw = t; trackRegion(); if (!$('worldmap').classList.contains('hidden')) drawWorldMap(); renderBuffs(t); if (!$('char').classList.contains('hidden') && charTab === 'jobs') renderChar(); }
      const tg = me.tg && ents.get(me.tg);
      if (tg && !tg.dying) { $('targetFrame').classList.remove('hidden'); $('tName').textContent = mobDef(tg).name; $('tName').style.color = levelColor(tg.l); $('tLvl').textContent = `Lv ${tg.l}`; $('tBar').style.width = `${(tg.h / tg.mh) * 100}%`; renderPips($('tFx'), tg.fx); }
      else $('targetFrame').classList.add('hidden');
      const m = meEnt();
      if (m) { $('hpBar').style.width = `${(m.h / m.mh) * 100}%`; $('hpTxt').textContent = `${m.h}/${m.mh}`; if (dialogNpc) { const n = npcs.find((q) => q.id === dialogNpc); if (n && Math.hypot(n.x - m.x, n.y - m.y) > 6) closeDialog(); } }
    }
    drawMinimap(t);
  }
  render(t, dt);
}

// ------------------------------------------------------------------ touch controls
let touchMode = false;
function enableTouch() {
  if (touchMode) return;
  touchMode = true;
  document.body.classList.add('touch');
  resize();
}
if (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) enableTouch();
addEventListener('touchstart', enableTouch, { once: true, passive: true }); // hybrid laptops

(() => {
  const joy = $('joy'), knob = $('knob');
  const MOVE = ['w', 'a', 's', 'd'];
  let pid = null, axis = '';
  const release = () => { MOVE.forEach((k) => keys.delete(k)); axis = ''; knob.style.transform = ''; };
  const drive = (ev) => {
    const r = joy.getBoundingClientRect();
    let dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy), max = r.width / 2 - 10;
    if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    MOVE.forEach((k) => keys.delete(k));
    if (len < 14) { axis = ''; return; }
    const horiz = Math.abs(dx) > Math.abs(dy) * (axis === 'v' ? 1.35 : axis === 'h' ? 0.74 : 1);
    axis = horiz ? 'h' : 'v';
    keys.add(horiz ? (dx < 0 ? 'a' : 'd') : (dy < 0 ? 'w' : 's'));
  };
  joy.addEventListener('pointerdown', (ev) => {
    if (pid !== null) return;
    pid = ev.pointerId; joy.setPointerCapture(pid); ev.preventDefault();
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    drive(ev);
  });
  joy.addEventListener('pointermove', (ev) => { if (ev.pointerId === pid) drive(ev); });
  const end = (ev) => { if (ev.pointerId === pid) { pid = null; release(); } };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
  joy.addEventListener('contextmenu', (e) => e.preventDefault());

  const acts = {
    pack: toggleInv,
    char: () => toggleChar(),
    menu: () => toggleMenu(),
    talk: interact,
    tgt: cycleTarget,
    chat: () => { $('chat').classList.add('open'); $('chatIn').focus(); },
  };
  $('tbtns').addEventListener('click', (e) => { const a = e.target.dataset && e.target.dataset.act; if (a && acts[a]) acts[a](); });
  $('chatIn').addEventListener('blur', () => setTimeout(() => $('chat').classList.remove('open'), 150));
})();

// ------------------------------------------------------------------ login screen
// ---- character creator (login) and the shared look pickers
let selLook = (() => { try { const l = JSON.parse(localStorage.getItem('em_look')); return Array.isArray(l) && (l.length === LOOK_LIMITS.length || l.length === 4) ? [...l, 0, 0].slice(0, LOOK_LIMITS.length) : null; } catch { return null; } })() || defaultLook('hero');
let prevDir = 0;
const previewVis = (job) => HERO.starterTokens(job);
function drawPrev(cv, look, vs, dir = 0, fr = 0, job = '') {
  const x = cv.getContext('2d');
  x.clearRect(0, 0, 32, 32);
  x.drawImage(HERO.heroSprite(look, vs, dir, fr, job), 0, 0);
}
const LOOK_PAL = [SKIN_TONES, null, HAIR_COLORS, EYE_COLORS, null, null];
function lookRows(box, look, onChange) {
  box.innerHTML = '';
  LOOK_LABELS.forEach((label, i) => {
    const row = mkEl('div', 'lrow');
    const prev = mkEl('button', 'x', '&lt;'), next = mkEl('button', 'x', '&gt;');
    prev.type = next.type = 'button';
    const sw = mkEl('span', 'sw'); sw.style.background = LOOK_PAL[i] ? LOOK_PAL[i][look[i]] : 'transparent';
    const step = (d) => { look[i] = (look[i] + d + LOOK_LIMITS[i]) % LOOK_LIMITS[i]; onChange(); };
    prev.onclick = () => step(-1); next.onclick = () => step(1);
    row.append(mkEl('span', 'nm', label), prev, mkEl('b', '', `${look[i] + 1}/${LOOK_LIMITS[i]}`), next, sw);
    box.appendChild(row);
  });
}
const prevCv = $('prev');
function buildCreator() {
  lookRows($('lookRows'), selLook, buildCreator);
  drawPrev(prevCv, selLook, previewVis(selClass), prevDir, 0, selClass);
  try { localStorage.setItem('em_look', JSON.stringify(selLook)); } catch { /* private mode */ }
}
$('rnd').onclick = () => { selLook = LOOK_LIMITS.map((n) => Math.floor(Math.random() * n)); buildCreator(); };
$('turn').onclick = () => { prevDir = [3, 2, 0, 1][prevDir]; buildCreator(); }; // spin: down, right, up, left

const cardsEl = $('classes');
function selectClass(c) {
  selClass = c;
  buildCreator();
  [...cardsEl.children].forEach((el) => { const selected = el.dataset.c === c; el.classList.toggle('sel', selected); el.setAttribute('aria-pressed', String(selected)); });
  const J = JOBS[c], first = skillsOfJob(c)[0];
  $('classDesc').innerHTML = `<b style="color:${J.color}">${J.name}</b> <span class="small">${J.role}</span> - ${J.desc}<br>${J.trait}<br>First skill: ${SKILLS[first].name}. You can learn every job later and mix their skills.`;
}
for (const c of JOB_ORDER) {
  const el = document.createElement('button'); el.type = 'button'; el.className = 'card'; el.dataset.c = c; el.setAttribute('aria-pressed', 'false');
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32; cv.getContext('2d').drawImage(HERO.classSprite(c, 0, 0), 0, 0);
  el.append(cv, document.createTextNode(JOBS[c].name));
  el.onclick = () => selectClass(c);
  cardsEl.appendChild(el);
}
selectClass('warrior');
$('name').value = localStorage.getItem('em_name') || '';
$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  localStorage.setItem('em_name', name);
  $('loginErr').textContent = ''; $('enter').disabled = true;
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  connect(name, $('pass').value, selClass, selLook);
});
$('reconnect').onclick = () => location.reload();
fetch('/api/status').then((r) => r.json()).then((s) => { $('online').textContent = `${s.online} hero${s.online === 1 ? '' : 'es'} online`; }).catch(() => {});

document.fonts && document.fonts.load('10px "Press Start 2P"').catch(() => {});
requestAnimationFrame(frame);
// debug / test hook: lets automation drive frames when rAF is throttled
window.__em = { ents, world, get me() { return me; }, get goal() { return goal; }, tx, tickFrame, get cam() { return [camX, camY, S]; } };
