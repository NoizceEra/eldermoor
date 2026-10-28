// Eldermoor client: rendering, input, networking and UI.
import { W, H, G, O, TOWN, generateWorld, isSolid, inTown } from '/shared/world.js';
import { SEED, CLASSES, MOBS, QUESTS, RARITY, NPCS } from '/shared/data.js';
import * as SP from '/client/sprites.js';
import { TS, buildWorldArt, drawWaterTile, treeSprite } from '/client/gfx.js';

const $ = (id) => document.getElementById(id);
const world = generateWorld(SEED);
const art = buildWorldArt(world);

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
const skillReady = { 1: 0, 2: 0, 3: 0 };
let potReady = 0;
let goal = null, nextStep = 0, shake = 0;
const keys = new Set();
let camX = 0, camY = 0;
let selClass = 'warrior', selSlot = -1, shopOpen = false, dialogNpc = 0;
const chatLines = [];
let party = { id: 0, leader: 0, members: [] };
const pmData = new Map(); // member id -> { h, mh, x, y } from the server's party tick
let pendingInvite = null; // { from, name, until } or { offer: playerId, name }
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
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
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

// ------------------------------------------------------------------ icons
const urlCache = new Map();
const iconURL = (b, r) => { const k = `${b}${r}`; if (!urlCache.has(k)) urlCache.set(k, SP.itemIcon(b, r).toDataURL()); return urlCache.get(k); };
function skillGlyph(cls, n) {
  const k = `sk${cls}${n}`;
  if (urlCache.has(k)) return urlCache.get(k);
  const g = new SP.Grid(16, 16);
  const id = cls + n;
  if (id === 'warrior1') { for (let a = -2.7; a <= -0.4; a += 0.1) { g.rect(8 + Math.cos(a) * 6.5, 10 + Math.sin(a) * 6.5, 2, 2, '#e8e8f0'); g.set(8 + Math.cos(a) * 4.5, 10 + Math.sin(a) * 4.5, '#9aa0b0'); } g.line(3, 13, 13, 13, '#c03a3a'); g.line(5, 11, 11, 11, '#c03a3a'); }
  else if (id === 'warrior2') { g.rect(4, 3, 8, 9, '#5a6a8a'); g.rect(6, 12, 4, 2, '#5a6a8a'); g.rect(7, 5, 2, 5, '#e8c04a'); g.rect(5, 7, 6, 1, '#e8c04a'); g.set(2, 2, '#ffd23a'); g.set(13, 2, '#ffd23a'); g.set(1, 8, '#ffd23a'); g.set(14, 8, '#ffd23a'); }
  else if (id === 'warrior3') { g.rect(3, 6, 4, 4, '#e8c04a'); g.line(7, 6, 12, 2, '#e8c04a'); g.line(7, 9, 12, 13, '#e8c04a'); g.rect(11, 3, 2, 10, '#c8a030'); g.set(14, 5, '#ff6a6a'); g.set(14, 10, '#ff6a6a'); g.set(15, 7, '#ff6a6a'); }
  else if (id === 'mage1') { g.ell(9, 9, 5, 5, '#e8581a'); g.ell(9, 9, 3, 3, '#ffb030'); g.ell(9, 9, 1.5, 1.5, '#fff2a0'); g.line(1, 15, 5, 11, '#ff8a20'); g.line(1, 12, 4, 10, '#ffb030'); }
  else if (id === 'mage2') { for (const [x, y] of [[8, 2], [8, 14], [2, 8], [14, 8], [3, 3], [13, 13], [13, 3], [3, 13]]) g.line(8, 8, x, y, '#8fe0ff'); g.ell(8, 8, 2, 2, '#ffffff'); }
  else if (id === 'mage3') { g.rect(6, 2, 4, 12, '#5fd35f'); g.rect(2, 6, 12, 4, '#5fd35f'); g.rect(7, 4, 2, 8, '#b8ffb8'); g.rect(4, 7, 8, 2, '#b8ffb8'); }
  else if (id === 'ranger1') { g.line(2, 14, 12, 4, '#8a6a3a'); g.line(12, 4, 14, 2, '#dfe4ec'); g.rect(11, 2, 4, 2, '#dfe4ec'); g.line(1, 11, 4, 14, '#cc3a3a'); g.line(2, 12, 2, 15, '#cc3a3a'); }
  else if (id === 'ranger2') { for (const [x1, y1] of [[14, 3], [14, 8], [14, 13]]) { g.line(2, 8, x1, y1, '#8a6a3a'); g.rect(x1 - 1, y1 - 1, 2, 2, '#dfe4ec'); } }
  else { g.rect(4, 5, 5, 6, '#8a5a2a'); g.rect(4, 11, 9, 3, '#6a3a1a'); g.rect(8, 8, 5, 3, '#8a5a2a'); g.line(0, 5, 3, 5, '#e8e8f0'); g.line(0, 8, 3, 8, '#e8e8f0'); g.line(1, 11, 3, 11, '#e8e8f0'); g.set(11, 4, '#fff'); }
  const u = g.shade().outline().canvas().toDataURL();
  urlCache.set(k, u);
  return u;
}

// ------------------------------------------------------------------ networking
function connect(name, pass, cls) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'login', name, pass, cls }));
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
      myId = m.id; npcs = m.npcs; inGame = true;
      $('login').classList.add('hidden'); $('ui').classList.remove('hidden');
      break;
    case 'err': $('loginErr').textContent = m.m; ws.close(); break;
    case 's': applyState(m); break;
    case 'me': me = m; onMe(); break;
    case 'log': addLine(`<span style="color:${m.c}">${esc(m.m)}</span>`); break;
    case 'party': party = m; pmData.clear(); renderParty(); break;
    case 'pm': for (const r of m.m) pmData.set(r.id, r); renderParty(); break;
    case 'pinv':
      pendingInvite = { from: m.from, name: m.name, until: now() + 30000 };
      showInvite(); sfx.click();
      break;
    case 'chat': {
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
      const col = m.k === 'p' ? '#ff5a5a' : m.k === 'h' ? '#6aff8a' : m.k === 'c' ? '#ffe066' : '#ffffff';
      floaters.push({ x: px + (Math.random() * 8 - 4), y: py - 8, txt: m.k === 'h' ? `+${m.v}` : m.k === 'c' ? `${m.v}!` : `${m.v}`, col, t0: t, big: m.k === 'c' });
      const e = ents.get(m.id);
      if (e && m.k !== 'h') e.hitAt = t;
      if (m.k === 'p') { burst(px, py, ['#ff5a5a', '#a02828'], 6, 28, 350); if (m.id === myId) { shake = 4; sfx.hurt(); if (touchMode && navigator.vibrate) navigator.vibrate(25); } }
      else if (m.k === 'm' || m.k === 'c') { burst(px, py, ['#fff', '#ffe066'], m.k === 'c' ? 10 : 5, 30, 260); (m.k === 'c' ? sfx.crit : sfx.hit)(); }
      break;
    }
    case 'fx': {
      const src = ents.get(m.id);
      if (src && ['swing', 'bolt', 'arrow', 'fire', 'bash', 'cleave'].includes(m.k)) {
        src.atkAt = t;
        if (m.tx !== undefined) src.atkDx = Math.sign(m.tx - m.x), src.atkDy = Math.sign(m.ty - m.y);
      }
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
    case 'cd': skillReady[m.n] = now() + m.ms; break;
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
  const last = [...keys].reverse().find((k) => ['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(k));
  if (last === 'w' || last === 'arrowup') dy = -1;
  else if (last === 's' || last === 'arrowdown') dy = 1;
  else if (last === 'a' || last === 'arrowleft') dx = -1;
  else if (last === 'd' || last === 'arrowright') dx = 1;
  if (dx || dy) { goal = null; tx({ t: 'move', dx, dy }); nextStep = t + stepMs() - 8; }
}

// ------------------------------------------------------------------ input
function worldPos(ev) {
  const r = screen.getBoundingClientRect();
  const lx0 = ((ev.clientX - r.left) / r.width) * VW, ly0 = ((ev.clientY - r.top) / r.height) * VH;
  return { px: camX + lx0, py: camY + ly0 };
}
function pickAt(px, py) {
  const tx0 = Math.floor(px / TS), ty0 = Math.floor(py / TS);
  let best = null, bd = 1.1;
  const consider = (e, kind) => {
    const h = e.s === 'golem' ? 1.6 : 0.7;
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
    if (!inParty(hit.e.i) && (!party.id || party.leader === myId)) { pendingInvite = { offer: hit.e.i, name: hit.e.n }; showInvite(); }
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
  const k = e.key.toLowerCase();
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
  else if (k === '1' || k === '2' || k === '3') tx({ t: 'skill', n: Number(k) });
  else if (k === 'q') quaff();
  else if (k === 'i') toggleInv();
  else if (k === 'e') interact();
  else if (k === 'm') { muted = !muted; localStorage.setItem('em_mute', muted ? '1' : '0'); toast(muted ? 'Sound off' : 'Sound on'); }
  else if (k === 'tab' || k === ' ') cycleTarget();
  else if ((k === 'y' || k === 'n') && pendingInvite) answerInvite(k === 'y');
  else if (k === 'escape') { if (pendingInvite && pendingInvite.offer) { pendingInvite = null; showInvite(); } closeDialog(); $('inv').classList.add('hidden'); tx({ t: 'target', id: 0 }); goal = null; }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// ---- party
function sendChat(v) {
  const arg = (cmd) => v.slice(cmd.length).trim();
  if (v.startsWith('/invite ')) tx({ t: 'pinvite', name: arg('/invite') });
  else if (v === '/leave') tx({ t: 'pleave' });
  else if (v.startsWith('/kick ')) {
    const t = party.members.find((m) => m.name.toLowerCase() === arg('/kick').toLowerCase());
    if (t) tx({ t: 'pkick', id: t.id }); else addLine('<span style="color:#ff8a8a">Nobody in your party has that name.</span>');
  } else if (v.startsWith('/p ')) tx({ t: 'chat', m: arg('/p'), ch: 'party' });
  else if (v === '/help') addLine('<span style="color:#9fd0ff">/invite NAME, /leave, /kick NAME, /p TEXT (party chat), /who</span>');
  else tx({ t: 'chat', m: v });
}
function answerInvite(ok) {
  const inv = pendingInvite;
  pendingInvite = null; showInvite();
  if (!inv) return;
  if (inv.offer) { if (ok) tx({ t: 'pinvite', name: inv.name }); } else tx({ t: 'pgo', ok });
}
function showInvite() {
  const box = $('invite');
  if (!pendingInvite) { box.classList.add('hidden'); return; }
  const o = pendingInvite.offer;
  box.innerHTML = `<div>${o ? `Invite <b style="color:#6ab8ff">${esc(pendingInvite.name)}</b> to your party?` : `<b style="color:#6ab8ff">${esc(pendingInvite.name)}</b> invites you to a party`}</div>
    <div class="btns"><button data-a="1">${o ? 'Invite (Y)' : 'Accept (Y)'}</button><button data-a="0">${o ? 'Cancel (N)' : 'Decline (N)'}</button></div>`;
  box.classList.remove('hidden');
  box.querySelectorAll('button').forEach((b) => { b.onclick = () => answerInvite(b.dataset.a === '1'); });
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
function buildSkillbar() {
  const bar = $('skillbar'); bar.innerHTML = '';
  const cls = me ? me.cls : 'warrior';
  CLASSES[cls].skills.forEach((s, i) => {
    const el = document.createElement('div'); el.className = 'sk'; el.id = `sk${i + 1}`; el.title = `${s.n}: ${s.d}`;
    el.innerHTML = `<img src="${skillGlyph(cls, i + 1)}"><span class="key">${i + 1}</span><div class="cd"></div><span class="cdt"></span>`;
    el.onclick = () => tx({ t: 'skill', n: i + 1 });
    bar.appendChild(el);
  });
  const p = document.createElement('div'); p.className = 'sk'; p.id = 'skq'; p.title = 'Health potion (Q)';
  p.innerHTML = `<img src="${iconURL('potion', 0)}"><span class="key">Q</span><div class="cd"></div><span class="cdt"></span><span class="cnt"></span>`;
  p.onclick = quaff; bar.appendChild(p);
}
function updateCooldowns(t) {
  for (let i = 1; i <= 3; i++) {
    const el = $(`sk${i}`); if (!el) continue;
    const left = skillReady[i] - t, tot = (CLASSES[me.cls].skills[i - 1]).cd;
    el.querySelector('.cd').style.height = left > 0 ? `${Math.min(100, (left / tot) * 100)}%` : '0';
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
  if ($('skillbar').dataset.cls !== me.cls) { buildSkillbar(); $('skillbar').dataset.cls = me.cls; }
  $('pName').textContent = me.name;
  $('pLvl').textContent = `Lv ${me.lvl} ${CLASSES[me.cls].name}`;
  $('hpBar').style.width = `${(me.hp / me.mh) * 100}%`;
  $('hpTxt').textContent = `${me.hp}/${me.mh}`;
  $('xpBar').style.width = me.xpn ? `${(me.xp / me.xpn) * 100}%` : '100%';
  $('pGold').innerHTML = `<span style="color:#ffd23a">${me.gold}g</span>`;
  $('pStats').textContent = `ATK ${me.st.atk}  DEF ${me.st.def}`;
  $('death').classList.toggle('hidden', me.hp > 0);
  renderQuest();
  if (!$('inv').classList.contains('hidden')) renderInv();
  const tg = me.tg && ents.get(me.tg);
  $('targetFrame').classList.toggle('hidden', !tg);
}
function renderQuest() {
  const q = me.quest, el = $('quest');
  if (q.i >= QUESTS.length) { el.innerHTML = '<b>All quests complete</b>'; return; }
  const Q = QUESTS[q.i];
  if (q.s === 0) el.innerHTML = `<b>!</b> ${esc(Q.title)}<br>Talk to Elder Mira`;
  else if (q.s === 1) el.innerHTML = `<b>${esc(Q.title)}</b><br>Slay ${esc(MOBS[Q.mob].name)}: ${q.p}/${Q.need}`;
  else el.innerHTML = `<b>?</b> ${esc(Q.title)}<br>Return to Elder Mira`;
}

function itemTip(it) {
  const r = RARITY[it.r];
  const lines = [`<span style="color:${r.c}">${esc(it.n)}</span> <span class="small">${r.n}</span>`];
  if (it.s === 'potion') lines.push(`Heals ${it.heal} health`, `Stack: ${it.c}`);
  else {
    lines.push(`<span class="small">${it.s} · req. level ${Math.max(1, it.l - 2)}</span>`);
    if (it.atk) lines.push(`<span style="color:#ff9a6a">+${it.atk} Attack</span>`);
    if (it.def) lines.push(`<span style="color:#6ab8ff">+${it.def} Defense</span>`);
    if (it.hp) lines.push(`<span style="color:#6aff8a">+${it.hp} Health</span>`);
  }
  lines.push(`<span style="color:#ffd23a">Worth ${Math.max(1, Math.floor(it.v * 0.5))}g</span>`);
  return lines.join('<br>');
}
function slotEl(it, extra = '') {
  const d = document.createElement('div'); d.className = `slot ${extra}`;
  if (it) {
    d.style.boxShadow = `inset 0 0 0 2px ${RARITY[it.r].c}`;
    d.innerHTML = `<img src="${iconURL(it.b, it.r)}">${it.c > 1 ? `<span class="cnt">${it.c}</span>` : ''}`;
  }
  return d;
}
function renderInv() {
  const eq = $('equip'); eq.innerHTML = '';
  for (const s of ['weapon', 'armor', 'trinket']) {
    const it = me.eq[s]; const d = slotEl(it, 'eq');
    if (!it) d.insertAdjacentHTML('beforeend', `<span class="lbl">${s}</span>`);
    d.onclick = () => { selSlot = -1; showInfo(it, () => { tx({ t: 'unequip', s }); }, 'Unequip', null); };
    eq.appendChild(d);
  }
  const grid = $('slots'); grid.innerHTML = '';
  me.inv.forEach((it, i) => {
    const d = slotEl(it); if (i === selSlot) d.classList.add('sel');
    d.onclick = () => { selSlot = i; renderInv(); };
    d.ondblclick = () => primary(i);
    d.oncontextmenu = (e) => { e.preventDefault(); primary(i); };
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
  box.innerHTML = `${itemTip(it)}<div class="btns"></div>`;
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
  const pc = document.createElement('canvas'); pc.width = 16; pc.height = 16;
  pc.getContext('2d').drawImage(SP.npcSprite(n.key, 0, 0), 0, 0);
  const txt = document.createElement('div'); txt.className = 'txt';
  txt.innerHTML = `<div class="title">${esc(m.name)}${m.title ? ` - ${esc(m.title)}` : ''}</div>${esc(m.text)}${m.reward ? `<div class="rew">Reward: ${esc(m.reward)}</div>` : ''}`;
  top.append(pc, txt); box.appendChild(top);
  if (m.shop) {
    m.shop.forEach((it, i) => {
      const row = document.createElement('div'); row.className = 'shopRow';
      const stats = [it.atk ? `+${it.atk} ATK` : '', it.def ? `+${it.def} DEF` : '', it.hp ? `+${it.hp} HP` : '', it.heal ? `heals ${it.heal}` : ''].filter(Boolean).join(' ');
      row.innerHTML = `<img src="${iconURL(it.b, it.r)}"><div class="grow"><span style="color:${RARITY[it.r].c}">${esc(it.n)}</span><br><span class="small">${stats}</span></div><span style="color:#ffd23a">${it.price}g</span>`;
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
    const fr = o.moving ? [1, 0, 3, 0][Math.floor(t / 110) % 4] : 0;
    spr = SP.playerSprite(o.c, skinOf(o.i), o.f, fr, o.w, o.wr, o.ar);
  } else {
    const fr = o.s === 'bat' ? Math.floor(t / 110) % 2 : o.s === 'slime' ? Math.floor(t / 320) % 2 : o.moving ? Math.floor(t / 160) % 2 : o.s === 'golem' ? Math.floor(t / 600) % 2 : 0;
    spr = SP.mobSprite(o.s, o.f, o.s === 'goblin' || o.s === 'skeleton' ? (o.moving ? [1, 0, 3, 0][Math.floor(t / 130) % 4] : 0) : fr);
    if (o.s === 'wolf') spr = SP.mobSprite('wolf', o.f === 2 ? 2 : 3, fr);
    if (o.s === 'bat') oy = -4 + Math.round(Math.sin(t / 180 + o.i) * 2);
  }
  w = spr.width;
  const baseX = o.rx * TS + 8 - w / 2 + lx0, baseY = o.ry * TS + 16 - spr.height + ly0 + oy;
  const px = Math.round(baseX - camX), py = Math.round(baseY - camY);
  if (px < -40 || py < -40 || px > VW + 40 || py > VH + 40) return;
  shadow(px + w / 2, py + spr.height - (o.s === 'bat' ? 0 : 3) - oy * (o.s === 'bat' ? -1 : 0) + (o.s === 'bat' ? 0 : 0), o.s === 'golem' ? 22 : o.s === 'bat' ? 6 : 10);
  if (o.id === undefined && o.i === tgId) {
    const pulse = Math.floor(t / 250) % 2;
    wx.fillStyle = '#ff4a4a';
    const x0 = Math.round(o.rx * TS - camX) - pulse, y0 = Math.round(o.ry * TS - camY) - pulse, ww = (o.s === 'golem' ? 2 : 1) * 16 + pulse * 2;
    for (const [cx, cy] of [[x0, y0 + 11], [x0 + ww - 3, y0 + 11]]) { wx.fillRect(cx, cy + 3, 3, 1); }
    wx.fillRect(x0 + 1, y0 + 14, 3, 1); wx.fillRect(x0 + 12 + pulse * 2, y0 + 14, 3, 1);
    wx.fillRect(x0, y0 + 13, 1, 2); wx.fillRect(x0 + 15 + pulse * 2, y0 + 13, 1, 2);
  }
  wx.globalAlpha = fadeA;
  wx.drawImage(spr, px, py);
  if (flash) { wx.globalAlpha = 0.65 * fadeA; wx.drawImage(flashOf(spr), px, py); }
  wx.globalAlpha = 1;
  if (o.k === 'm' && o.st) { wx.fillStyle = '#ffe066'; const sx = px + w / 2 - 4; for (let i = 0; i < 3; i++) wx.fillRect(sx + i * 3 + ((Math.floor(t / 100) + i) % 2), py - 3, 1, 1); }
  if (o.dying) return;
  // overhead bars + labels
  const cx = px + w / 2;
  const barW = o.s === 'golem' ? 26 : 12;
  if (o.k === 'm' && (o.h < o.mh || o.i === tgId)) drawHealthBar(Math.round(cx - barW / 2), py - 2 - (o.s === 'golem' ? 0 : 0), barW, o.h / o.mh);
  if (o.k === 'p' && o.i !== myId) drawHealthBar(Math.round(cx - 6), py - 1, 12, o.h / o.mh, '#4ac86a');
  const name = o.k === 'p' ? o.n : mobDef(o).name;
  const col = o.k === 'p' ? (o.i === myId ? '#8be88b' : inParty(o.i) ? '#6ab8ff' : '#ffffff') : levelColor(o.l);
  labels.push({ x: cx, y: py - (o.k === 'm' && (o.h < o.mh || o.i === tgId) ? 5 : 2), txt: o.k === 'p' ? name : `${name}  ${o.l}`, col, boss: !!mobDef(o).boss });
  if (o.say && t - o.sayAt < 5000) labels.push({ x: cx, y: py - 14, txt: o.say, col: '#ffffff', bubble: true });
}

function drawFx(t) {
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i], age = t - f.t0;
    const dur = { swing: 220, bolt: 200, arrow: 200, fire: 380, cleave: 300, bash: 300, cry: 600, nova: 450, heal: 700, dash: 350, levelup: 1300, die: 1 }[f.k] || 300;
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
        const r = 8 + p * 20;
        for (let k = 0; k < 28; k++) { const a = (k / 28) * 6.283 + p * 2; wx.fillStyle = k % 3 ? '#e8e8f0' : '#ff6a6a'; wx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r), 2, 2); }
        break;
      }
      case 'nova': {
        const r = 6 + p * 27;
        for (let k = 0; k < 40; k++) { const a = (k / 40) * 6.283; wx.fillStyle = k % 2 ? '#8fe0ff' : '#ffffff'; wx.globalAlpha = 1 - p; wx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r), 2, 2); }
        wx.globalAlpha = 1;
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
  const icon = d.g ? SP.itemIcon('gold', 0) : SP.itemIcon(d.b, d.r);
  wx.drawImage(icon, px, py - 2 + bob);
  if (!d.g && d.r > 0 && Math.floor(t / 200 + d.i) % 3 === 0) { wx.fillStyle = SP.RARITY_COL[d.r]; wx.fillRect(px + 3 + ((d.i * 5) % 9), py + 2 + ((d.i * 3) % 7), 1, 1); }
}

function drawNpc(n, t) {
  const spr = SP.npcSprite(n.key, n.key === 'guard' ? 0 : (Math.floor(t / 2500 + n.id) % 6 === 0 ? 3 : 0), 0);
  const px = n.x * TS - camX, py = n.y * TS - camY;
  shadow(px + 8, py + 13, 10);
  wx.drawImage(spr, px, py);
  labels.push({ x: px + 8, y: py - 2, txt: n.name, col: '#ffe066' });
  if (n.role === 'quest' && me) {
    const q = me.quest; const mark = q.i >= QUESTS.length ? '' : q.s === 0 ? '!' : q.s === 2 ? '?' : '';
    if (mark) labels.push({ x: px + 8, y: py - 12 - Math.round(Math.sin(t / 200) * 2), txt: mark, col: mark === '!' ? '#ffe066' : '#6aff8a', mark: true });
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

  wx.drawImage(art.baked, camX, camY, VW, VH, 0, 0, VW, VH);
  const tx0 = Math.floor(camX / TS), ty0 = Math.floor(camY / TS), tx1 = Math.min(W - 1, tx0 + Math.ceil(VW / TS) + 1), ty1 = Math.min(H - 1, ty0 + Math.ceil(VH / TS) + 1);
  const wf = Math.floor(t / 420) % 4;
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) { const g = world.g[y * W + x]; if (g === G.WATER || g === G.DEEP) drawWaterTile(wx, art, world, x, y, x * TS - camX, y * TS - camY, wf); }
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
  const amb = ambient(phase);
  const dark = 1 - (amb[0] + amb[1] + amb[2]) / 765;
  if (dark > 0.02) {
    lx.globalCompositeOperation = 'source-over';
    lx.fillStyle = `rgb(${amb[0]},${amb[1]},${amb[2]})`; lx.fillRect(0, 0, VW, VH);
    lx.globalCompositeOperation = 'lighter';
    const light = (x, y, r, col) => {
      const g = lx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); lx.fillStyle = g; lx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const o of ents.values()) if (o.k === 'p' && !o.d) light(o.rx * TS + 8 - camX, o.ry * TS + 4 - camY, 46, 'rgba(255,200,120,.8)');
    for (const n of npcs) light(n.x * TS + 8 - camX, n.y * TS + 6 - camY, 30, 'rgba(255,190,110,.6)');
    for (const f of fxs) if (['fire', 'bolt', 'levelup', 'nova'].includes(f.k)) light(f.x * TS + 8 - camX, f.y * TS + 8 - camY, 40, 'rgba(255,170,90,.6)');
    for (const o of ents.values()) if (o.k === 'm' && o.s === 'golem') light(o.rx * TS + 8 - camX, o.ry * TS - camY, 26, 'rgba(255,140,40,.7)');
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
    if (o.k === 'm') { x.fillStyle = o.s === 'golem' ? '#ff9a3a' : '#e04a4a'; x.fillRect(px, py, o.s === 'golem' ? 3 : 1, o.s === 'golem' ? 3 : 1); }
    else if (o.k === 'p' && o.i !== myId) { x.fillStyle = '#6ae0ff'; x.fillRect(px - 1, py - 1, 2, 2); }
  }
  for (const n of npcs) { x.fillStyle = '#ffe066'; x.fillRect(n.x - ox - 1, n.y - oy - 1, 2, 2); }
  for (const [id, d] of pmData) { // party members stay on the map even when out of view
    if (id === myId) continue;
    const px = d.x - ox, py = d.y - oy; if (px < 0 || py < 0 || px >= 64 || py >= 64) continue;
    x.fillStyle = '#6aff8a'; x.fillRect(px - 1, py - 1, 3, 3); x.fillStyle = '#0d0a18'; x.fillRect(px, py, 1, 1);
  }
  if (Math.floor(t / 400) % 2) { x.fillStyle = '#fff'; x.fillRect(m.x - ox - 1, m.y - oy - 1, 3, 3); } else { x.fillStyle = '#8be88b'; x.fillRect(m.x - ox - 1, m.y - oy - 1, 3, 3); }
}

let last = now();
function frame() { tickFrame(); requestAnimationFrame(frame); }
function tickFrame() {
  const t = now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
  stepEntities(dt, t);
  if (inGame) {
    runKeys(t); runGoal(t);
    if (pendingInvite && !pendingInvite.offer && t > pendingInvite.until) { pendingInvite = null; showInvite(); }
    if (me) {
      updateCooldowns(t);
      const tg = me.tg && ents.get(me.tg);
      if (tg && !tg.dying) { $('targetFrame').classList.remove('hidden'); $('tName').textContent = mobDef(tg).name; $('tName').style.color = levelColor(tg.l); $('tLvl').textContent = `Lv ${tg.l}`; $('tBar').style.width = `${(tg.h / tg.mh) * 100}%`; }
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
    talk: interact,
    tgt: cycleTarget,
    chat: () => { $('chat').classList.add('open'); $('chatIn').focus(); },
  };
  $('tbtns').addEventListener('click', (e) => { const a = e.target.dataset && e.target.dataset.act; if (a && acts[a]) acts[a](); });
  $('chatIn').addEventListener('blur', () => setTimeout(() => $('chat').classList.remove('open'), 150));
})();

// ------------------------------------------------------------------ login screen
const cardsEl = $('classes');
function selectClass(c) {
  selClass = c;
  [...cardsEl.children].forEach((el) => el.classList.toggle('sel', el.dataset.c === c));
  $('classDesc').innerHTML = `<b style="color:#ffe066">${CLASSES[c].name}</b> - ${CLASSES[c].desc}<br>` + CLASSES[c].skills.map((s, i) => `${i + 1}. ${s.n}`).join(' &nbsp; ');
}
for (const c of Object.keys(CLASSES)) {
  const el = document.createElement('div'); el.className = 'card'; el.dataset.c = c;
  const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16; cv.getContext('2d').drawImage(SP.playerSprite(c, 0, 0, 0), 0, 0);
  el.append(cv, document.createTextNode(CLASSES[c].name));
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
  connect(name, $('pass').value, selClass);
});
fetch('/api/status').then((r) => r.json()).then((s) => { $('online').textContent = `${s.online} hero${s.online === 1 ? '' : 'es'} online`; }).catch(() => {});

document.fonts && document.fonts.load('10px "Press Start 2P"').catch(() => {});
requestAnimationFrame(frame);
// debug / test hook: lets automation drive frames when rAF is throttled
window.__em = { ents, world, get me() { return me; }, get goal() { return goal; }, tx, tickFrame, get cam() { return [camX, camY, S]; } };
