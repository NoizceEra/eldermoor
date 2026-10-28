// 32x32 hero sprites. Everything is drawn procedurally from the character's look + worn gear + job, with
// an animation pose baked into each frame:
//   fr  0 idle   1 stride A   2 passing   3 stride B   4 idle breath   5 blink
//   act 0 none   2 strike     3 follow-through         4 cast
// Facing: 0 down, 1 up, 2 left (the right-facing canvas mirrored), 3 right.
import { Grid, adj, heroOptions, PRESET, SKINS, BLADE, WOOD, JOB_EYE } from '/client/sprites.js';
import { JOBS } from '/shared/jobs.js';

const RED = '#c03a3a', BONE = '#e6e2cc', GOLD = '#e8c04a', DARK = '#2a2a3a';
export const HERO_SIZE = 32;

/** thick line of w x w squares; the last `hand` steps use the hand colour */
function limb(g, x0, y0, x1, y1, w, col, handCol, hand = 2) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
    g.rect(x - (w >> 1), y - (w >> 1), w, w, i > n - hand ? handCol : col);
  }
}

/** a held weapon: (hx,hy) is the grip, (vx,vy) points from grip to tip. Returns the tip position. */
function weapon(g, kind, hx, hy, vx, vy, blade) {
  const L = Math.hypot(vx, vy) || 1, ux = vx / L, uy = vy / L, px = -uy, py = ux;
  const at = (t, s = 0) => [Math.round(hx + ux * t + px * s), Math.round(hy + uy * t + py * s)];
  const line = (t0, t1, col, w = 1, s = 0) => { for (let t = t0; t <= t1; t += 0.5) { const [x, y] = at(t, s); g.rect(x, y, w, w, col); } };
  const blob = (t, s, r, col) => { const [x, y] = at(t, s); g.ell(x + 0.5, y + 0.5, r, r, col); };
  const bd = adj(blade, 0.72), bh = adj(blade, 1.3);
  switch (kind) {
    case 'sword':
      line(-3, 0, WOOD, 2); for (let s = -3; s <= 3; s++) { const [x, y] = at(1, s); g.rect(x, y, 1, 2, '#c8a040'); }
      line(2, 14, bd, 2); line(2, 13.5, blade, 1); line(3, 12, bh, 1, 0.5);
      return at(15);
    case 'axe':
      line(-3, 13, WOOD, 2); blob(10.5, 2.5, 3.6, bd); blob(10.5, 3, 2.8, blade); blob(10.5, 4, 1.2, bh); blob(10.5, -1.5, 1.5, bd);
      return at(12, 4);
    case 'mace':
      line(-3, 11, WOOD, 2); blob(13, 0, 3.6, bd); blob(13, 0, 2.6, blade); blob(12.5, -1, 1, bh);
      for (const [t, s] of [[13, 4.5], [13, -4.5], [16.5, 0]]) { const [x, y] = at(t, s); g.rect(x, y, 1, 1, bh); }
      return at(14);
    case 'staff':
      line(-7, 17, WOOD, 2); line(-7, 17, adj(WOOD, 1.25), 1);
      blob(19, 0, 3, blade === BLADE[0] ? '#4ab8e8' : blade); blob(19, 0, 1.8, blade === BLADE[0] ? '#9af0ff' : bh); blob(18.5, -0.5, 0.8, '#ffffff');
      return at(19);
    case 'wand':
      line(-2, 10, WOOD, 2); blob(11.5, 0, 2.2, blade === BLADE[0] ? '#d85aff' : blade); blob(11.5, 0, 1, '#ffffff');
      return at(12);
    case 'dagger':
      line(-2, 0, '#6a4a2a', 2); for (let s = -2; s <= 2; s++) { const [x, y] = at(1, s); g.rect(x, y, 1, 1, '#c8a040'); }
      line(2, 8, '#cfd4dc', 1); line(2, 7.5, '#ffffff', 1, -0.7);
      return at(9);
    case 'spear':
      line(-6, 19, WOOD, 2); line(18, 23, '#dfe4ec', 2); line(18, 22, '#ffffff', 1);
      return at(23);
    case 'bow': {
      for (let s = -9; s <= 9; s++) { const [x, y] = at(3.4 - (s * s) / 24, s); g.rect(x, y, 2, 2, WOOD); }
      for (let s = -9; s <= 9; s++) { const [x, y] = at(0.2, s); g.set(x, y, '#ece6d0'); }
      return at(3);
    }
    default:
      return [hx, hy];
  }
}

// ---- hair, hats
function hairFront(g, o, y) {
  const hs = o.hs || 'short', hc = o.hair, hl = adj(hc, 1.3);
  if (hs === 'bald') return;
  if (hs !== 'mohawk') {
    g.rect(11, y(5), 10, 3, hc); g.rect(12, y(4), 8, 1, hc); g.rect(11, y(8), 2, 2, hc); g.rect(19, y(8), 2, 2, hc);
    g.rect(13, y(8), 3, 1, hc); g.set(17, y(8), hc); g.rect(13, y(4), 3, 1, hl);
  }
  if (hs === 'long') { g.rect(10, y(7), 2, 11, hc); g.rect(20, y(7), 2, 11, hc); }
  if (hs === 'spiky') { g.rect(12, y(2), 2, 2, hc); g.rect(15, y(1), 2, 3, hc); g.rect(18, y(2), 2, 2, hc); g.rect(10, y(5), 1, 2, hc); g.rect(21, y(5), 1, 2, hc); }
  if (hs === 'mohawk') { g.rect(15, y(0), 2, 6, hc); g.rect(14, y(4), 4, 2, hc); g.rect(15, y(0), 1, 4, hl); }
  if (hs === 'ponytail') { g.rect(21, y(7), 2, 3, hc); g.rect(22, y(10), 2, 5, hc); g.rect(22, y(10), 1, 3, hl); }
}
function hairBack(g, o, y) {
  const hs = o.hs || 'short', hc = o.hair, hl = adj(hc, 1.3);
  if (hs === 'bald') return;
  if (hs === 'mohawk') { g.rect(15, y(0), 2, 11, hc); g.rect(14, y(4), 4, 2, hc); return; }
  g.rect(11, y(5), 10, 8, hc); g.rect(12, y(4), 8, 1, hc); g.rect(13, y(4), 3, 1, hl);
  if (hs === 'long') g.rect(10, y(6), 12, 12, hc);
  if (hs === 'spiky') { g.rect(12, y(2), 2, 2, hc); g.rect(15, y(1), 2, 3, hc); g.rect(18, y(2), 2, 2, hc); }
  if (hs === 'ponytail') { g.rect(15, y(12), 3, 7, hc); g.rect(15, y(12), 1, 5, hl); }
}
function hairSide(g, o, y) {
  const hs = o.hs || 'short', hc = o.hair, hl = adj(hc, 1.3);
  if (hs === 'bald') return;
  if (hs === 'mohawk') { g.rect(13, y(0), 4, 8, hc); g.rect(11, y(5), 4, 5, hc); return; }
  g.rect(11, y(5), 10, 3, hc); g.rect(12, y(4), 8, 1, hc); g.rect(11, y(8), 5, 4, hc); g.rect(18, y(8), 3, 1, hc); g.rect(13, y(4), 3, 1, hl);
  if (hs === 'long') g.rect(10, y(7), 6, 11, hc);
  if (hs === 'spiky') { g.rect(12, y(2), 2, 2, hc); g.rect(15, y(1), 2, 3, hc); g.rect(18, y(2), 2, 2, hc); }
  if (hs === 'ponytail') { g.rect(8, y(7), 3, 3, hc); g.rect(7, y(10), 3, 5, hc); g.rect(7, y(10), 1, 3, hl); }
}

function hat(g, o, dir, y) {
  const hc = o.hatCol || '#aab2c0', hd = adj(hc, 0.75), hl = adj(hc, 1.3), side = dir >= 2, back = dir === 1;
  switch (o.hat) {
    case 'helm': case 'horns':
      g.rect(10, y(3), 12, 5, hc); g.rect(11, y(2), 10, 1, hc); g.rect(12, y(3), 4, 1, hl);
      if (!side) { g.rect(10, y(8), 2, 4, hc); g.rect(20, y(8), 2, 4, hc); if (!back) g.rect(15, y(8), 2, 4, hc); else g.rect(10, y(8), 12, 4, hc); }
      else { g.rect(11, y(8), 5, 5, hc); g.rect(19, y(8), 2, 3, hc); }
      g.rect(10, y(7), 12, 1, hd);
      if (o.hat === 'horns') {
        const hn = '#e8e0d0';
        if (!side) { g.rect(7, y(1), 3, 5, hn); g.rect(22, y(1), 3, 5, hn); g.rect(6, y(0), 2, 2, hn); g.rect(24, y(0), 2, 2, hn); }
        else { g.rect(13, y(0), 3, 5, hn); g.rect(16, y(-1), 2, 2, hn); }
      } else if (!o.hatCol) g.rect(15, y(0), 2, 3, RED);
      break;
    case 'wizard':
      g.rect(7, y(6), 18, 2, hc); g.rect(8, y(8), 16, 1, hd); g.rect(10, y(4), 12, 2, hc); g.rect(12, y(2), 8, 2, hc); g.rect(14, y(0), 5, 2, hc);
      g.rect(10, y(5), 12, 1, hd); g.rect(19, y(0), 3, 2, hc); g.rect(20, y(1), 3, 2, hd); g.rect(18, y(5), 2, 1, GOLD); g.rect(13, y(1), 2, 4, hl);
      break;
    case 'hood':
      g.rect(9, y(3), 14, 11, hc); g.rect(11, y(2), 10, 1, hc); g.rect(11, y(3), 5, 1, hl); g.rect(10, y(13), 12, 3, hd);
      if (dir === 0) g.rect(12, y(7), 8, 6, o.skin);
      if (dir === 3) g.rect(15, y(7), 6, 6, o.skin);
      break;
    case 'cap':
      g.rect(11, y(3), 10, 3, hc); g.rect(12, y(2), 8, 1, hc); g.rect(10, y(6), 12, 1, hd); g.rect(12, y(3), 3, 1, hl);
      break;
    case 'crown': {
      const gd = o.hatCol || '#f0c040';
      g.rect(11, y(3), 10, 3, gd); for (const x of [11, 15, 19]) g.rect(x, y(1), 2, 2, gd); g.rect(15, y(0), 2, 1, gd);
      if (!back) g.rect(15, y(4), 2, 1, '#ff5a5a');
      break;
    }
    case 'circlet':
      g.rect(11, y(5), 10, 1, o.hatCol || GOLD);
      if (!back) g.rect(15, y(4), 2, 2, '#5fd3ff');
      break;
    default:
  }
}

// ---- class identity: a signature silhouette whatever the hero wears
function accent(g, o, dir, y, front, back, side) {
  const J = JOBS[o.job];
  if (!J) return;
  const c = J.color, cd = adj(c, 0.7), cl = adj(c, 1.3);
  const pauldrons = (col) => {
    const hi = adj(col, 1.3), lo = adj(col, 0.7);
    if (!side) { for (const x of [8, 20]) { g.rect(x, y(14), 4, 4, col); g.rect(x, y(14), 4, 1, hi); g.rect(x, y(17), 4, 1, lo); } }
    else { g.rect(13, y(14), 5, 4, col); g.rect(13, y(14), 5, 1, hi); g.rect(13, y(17), 5, 1, lo); }
  };
  switch (o.job) {
    case 'warrior':
      pauldrons('#aab2c0');
      if (front) { g.rect(15, y(16), 2, 7, RED); g.rect(14, y(22), 4, 2, RED); }
      break;
    case 'paladin':
      pauldrons('#d8c070');
      if (!side) for (const [x, w] of [[7, 3], [5, 2], [22, 3], [25, 2]]) { g.rect(x, y(3), w, 2, '#fff2a0'); g.rect(x, y(5), w, 1, adj('#fff2a0', 0.8)); }
      if (front) { g.rect(15, y(16), 2, 7, GOLD); g.rect(13, y(18), 6, 2, GOLD); g.rect(15, y(18), 2, 2, '#fff2a0'); }
      else if (side) { g.rect(16, y(16), 2, 6, GOLD); g.rect(15, y(18), 4, 2, GOLD); }
      break;
    case 'mage':
      if (!side) for (let x = 10; x < 22; x += 2) g.rect(x, 27, 1, 1, GOLD); else for (let x = 12; x < 20; x += 2) g.rect(x, 27, 1, 1, GOLD);
      if (!side) g.rect(10, y(14), 12, 2, '#e8e0d0'); else g.rect(13, y(14), 7, 2, '#e8e0d0');
      if (front) { g.rect(15, y(17), 2, 2, '#9fe8ff'); g.set(15, y(17), '#ffffff'); }
      break;
    case 'ranger':
      g.rect(12, y(14), 8, 2, c); if (front) { g.rect(18, y(16), 2, 4, cd); limb(g, 11, y(15), 19, y(22), 1, '#6a4a2a', '#6a4a2a', 0); }
      g.rect(21, y(1), 1, 6, '#f0f0e8'); g.rect(22, y(2), 1, 4, c);
      break;
    case 'cleric':
      g.ell(16, y(1.6), 6, 1.7, '#ffe88a'); g.ell(16, y(1.6), 4, 0.7, null);
      if (front) { g.rect(14, y(16), 4, 7, '#ffffff'); g.rect(14, y(22), 4, 1, GOLD); g.rect(15, y(17), 2, 3, GOLD); g.rect(14, y(18), 4, 1, GOLD); }
      break;
    case 'rogue':
      if (front) g.rect(12, y(11), 8, 2, DARK); else if (side) g.rect(16, y(11), 5, 2, DARK);
      if (!side) { g.rect(21, y(17), 2, 5, RED); g.rect(22, y(22), 2, 3, adj(RED, 0.7)); } else { g.rect(11, y(16), 3, 2, RED); g.rect(8, y(17), 3, 2, RED); g.rect(6, y(18), 2, 2, adj(RED, 0.7)); }
      break;
    case 'warlock':
      for (const x of [8, 21]) if (!side) { g.rect(x, y(12), 3, 3, '#3a1050'); g.rect(x + 1, y(11), 1, 1, '#a03aa0'); }
      if (!back) g.rect(12, y(14), 8, 1, '#c060c0');
      if (front) { g.rect(15, y(21), 2, 2, BONE); g.set(15, y(22), DARK); g.set(16, y(22), DARK); }
      break;
    case 'druid':
      pauldrons('#5a9a4a');
      if (!side) { for (const [x0, y0, x1, y1] of [[12, 3, 10, 0], [11, 1, 8, 1], [20, 3, 22, 0], [21, 1, 24, 1]]) g.line(x0, y(y0), x1, y(y1), '#c8a870'); }
      else { g.line(15, y(3), 14, y(0), '#c8a870'); g.line(14, y(1), 11, y(1), '#c8a870'); }
      if (front) { g.rect(12, y(21), 8, 1, '#4a8a3a'); g.set(13, y(22), '#9aff8a'); g.set(18, y(22), '#9aff8a'); }
      break;
    case 'necromancer':
      pauldrons('#d8d4bc');
      if (!side) { g.rect(8, y(12), 1, 2, BONE); g.rect(23, y(12), 1, 2, BONE); }
      if (front) { g.rect(14, y(16), 4, 3, BONE); g.rect(15, y(17), 1, 1, DARK); g.rect(17, y(17), 1, 1, DARK); g.rect(15, y(19), 2, 3, '#b8b4a0'); g.rect(14, y(20), 4, 1, '#8a8670'); }
      break;
    case 'monk':
      g.rect(11, y(6), 10, 2, RED); g.rect(11, y(6), 10, 1, adj(RED, 1.25)); g.rect(21, y(7), 3, 1, RED); g.rect(23, y(8), 2, 2, adj(RED, 0.8)); g.rect(22, y(9), 3, 1, RED);
      if (front) { limb(g, 11, y(15), 19, y(22), 2, '#7a2a1a', '#7a2a1a', 0); g.rect(11, y(21), 10, 1, '#7a2a1a'); }
      break;
    default:
  }
}
function accentFx(g, o) {
  const dot = (x, y, col) => { if (!g.get(x, y)) g.set(x, y, col); };
  const t = (x, y, a, b) => { dot(x, y, a); if (b) dot(x + 1, y, b); };
  if (o.job === 'warlock') { t(3, 8, '#d060d0'); t(28, 14, '#a03aa0'); t(2, 18, '#7a2a7a'); t(29, 6, '#e8a0ff'); }
  else if (o.job === 'necromancer') { t(3, 6, '#7affc8'); t(28, 12, '#7affc8'); t(3, 19, '#4aa890'); t(29, 20, '#a8ffe0'); }
  else if (o.job === 'mage') { t(27, 6, '#9fe8ff', '#ffffff'); t(4, 11, '#c8a8ff'); t(28, 18, '#ffffff'); }
  else if (o.job === 'druid') { t(4, 10, '#9aff8a'); t(27, 20, '#6aaa4a'); t(3, 22, '#c8ff9a'); }
  else if (o.job === 'cleric') { t(5, 7, '#fff2a0'); t(27, 9, '#ffffff'); }
  else if (o.job === 'paladin') { t(4, 14, '#fff2a0'); }
}

// ---- the body
function render(o, dir, fr, act) {
  const g = new Grid(32, 32);
  const front = dir === 0, back = dir === 1, side = dir >= 2;
  const stride = fr === 1 ? -1 : fr === 3 ? 1 : 0;
  const by = fr === 1 || fr === 3 || fr === 4 ? 1 : 0; // head and torso settle on stride and breath frames
  const y = (v) => v + by;
  const skin = o.skin, skinD = adj(skin, 0.82), pants = o.pants, boots = o.boots, tunic = o.tunic, sleeve = o.sleeve || tunic;
  const glove = o.gloves || skin;
  const wep = o.weapon, bow = wep === 'bow';
  const swing = act === 2 || act === 3, cast = act === 4;

  // ---- hands: [x, y] and the weapon direction, per facing and pose
  let handR, handL, wv;
  if (front) {
    handL = [9, y(22) + stride]; handR = [22, y(22) - stride]; wv = bow ? [1, 0] : [0.35, -1];
    if (act === 2) { handR = [20, y(24)]; wv = bow ? [1, 0.2] : [-0.4, 1]; } else if (act === 3) { handR = [24, y(21)]; wv = bow ? [1, 0] : [1, -0.3]; }
    if (cast) { handR = [23, y(13)]; handL = [9, y(13)]; wv = bow ? [1, 0] : [0.15, -1]; }
  } else if (back) {
    handR = [22, y(22) + stride]; handL = [9, y(22) - stride]; wv = bow ? [-1, 0] : [-0.35, -1];
    if (act === 2) { handL = [10, y(12)]; wv = bow ? [-1, 0] : [0, -1]; } else if (act === 3) { handL = [8, y(19)]; wv = bow ? [-1, 0] : [-1, -0.2]; }
    if (cast) { handR = [23, y(13)]; handL = [9, y(13)]; wv = bow ? [-1, 0] : [-0.15, -1]; }
  } else {
    handR = [18 + stride * 2, y(22)]; handL = [15 - stride * 2, y(22)]; wv = bow ? [1, 0] : [0.55, -1];
    if (act === 2) { handR = [22, y(19)]; wv = bow ? [1, 0] : [1, 0.12]; } else if (act === 3) { handR = [20, y(21)]; wv = bow ? [1, 0] : [0.8, 0.6]; }
    if (cast) { handR = [21, y(14)]; handL = [16, y(14)]; wv = bow ? [1, 0] : [0.2, -1]; }
  }

  // ---- layers behind the body
  if (o.cape) {
    const cp = o.cape;
    if (front) g.rect(9, y(15), 14, 13, cp);
    else if (side) g.rect(10, y(15), 5, 13, cp);
  }
  if (o.offhand === 'quiver' && side) { g.rect(11, y(11), 3, 10, o.offCol || '#7a5230'); g.rect(11, y(10), 1, 1, '#e8e8e8'); g.rect(13, y(10), 1, 1, '#cc3a3a'); }
  if (side) limb(g, 14, y(15), handL[0], handL[1], 3, adj(sleeve, 0.78), adj(glove, 0.8));

  // ---- legs
  const leg = (x, w, lift, toe) => {
    const ph = 4 - 2 * lift;
    g.rect(x, 23, w, ph, lift ? adj(pants, 0.9) : pants);
    g.rect(x, 23 + ph, w, 3, boots); g.rect(x, 25 + ph, w + toe, 1, adj(boots, 0.7)); if (toe) g.rect(x + w, 24 + ph, 1, 1, boots);
  };
  if (!side) { leg(12, 4, stride === -1 ? 1 : 0, 0); leg(17, 4, stride === 1 ? 1 : 0, 0); }
  else {
    const bx = 13 + (stride === -1 ? -2 : stride === 1 ? 2 : 0), fx = 15 + (stride === -1 ? 2 : stride === 1 ? -2 : 0);
    leg(bx, 3, stride === -1 ? 1 : 0, 1); leg(fx, 3, stride === 1 ? 1 : 0, 1);
  }

  // ---- torso
  if (!side) {
    g.rect(11, y(15), 10, 6, tunic); g.rect(12, y(21), 8, 2, tunic); g.rect(11, y(21), 10, 1, o.belt);
    if (front) g.rect(15, y(21), 2, 1, GOLD);
    if (o.robe) { g.rect(10, y(22), 12, 5, tunic); g.rect(9, 26, 14, 2, adj(tunic, 0.85)); g.rect(10, y(22), 12, 1, o.belt); }
  } else {
    g.rect(13, y(15), 7, 6, tunic); g.rect(14, y(21), 5, 2, tunic); g.rect(13, y(21), 7, 1, o.belt);
    if (o.robe) { g.rect(12, y(22), 9, 5, tunic); g.rect(11, 26, 11, 2, adj(tunic, 0.85)); g.rect(12, y(22), 9, 1, o.belt); }
  }
  // body kinds
  if (o.bk && !back) {
    const lt = adj(tunic, 1.25), dk = adj(tunic, 0.68);
    const x0 = side ? 13 : 12, w = side ? 7 : 8;
    if (o.bk === 'mail') { for (let yy = 15; yy < 21; yy++) for (let x = x0; x < x0 + w; x++) if ((x + yy) % 2) g.set(x, y(yy), lt); }
    else if (o.bk === 'leather') { if (!side) { g.rect(15, y(15), 2, 6, dk); for (let yy = 15; yy < 21; yy += 2) { g.set(13, y(yy), lt); g.set(18, y(yy), lt); } } else g.rect(15, y(15), 2, 6, dk); }
    else if (o.bk === 'plate') { if (!side) { g.rect(8, y(14), 4, 3, lt); g.rect(20, y(14), 4, 3, lt); g.rect(14, y(15), 4, 5, lt); g.rect(12, y(20), 8, 1, dk); } else { g.rect(13, y(14), 5, 3, lt); g.rect(15, y(17), 3, 3, lt); g.rect(13, y(20), 7, 1, dk); } }
  }

  // ---- arms (the weapon arm is drawn with the weapon below)
  const armCol = sleeve;
  if (!side) {
    limb(g, 10, y(15), handL[0], handL[1], 3, armCol, glove);
    limb(g, 21, y(15), handR[0], handR[1], 3, armCol, glove);
  } else {
    limb(g, 16, y(15), handR[0], handR[1], 3, armCol, glove);
  }
  if (back && o.cape) { g.rect(10, y(15), 12, 13, o.cape); g.rect(15, y(16), 2, 11, adj(o.cape, 0.8)); }

  // ---- head
  const hy = y(0);
  g.rect(15, 14 + (by ? 1 : 0) - 0, 2, 1, skinD);
  g.rect(11, 5 + hy, 10, 8, skin); g.rect(12, 4 + hy, 8, 1, skin); g.rect(12, 13 + hy, 8, 1, skin);
  if (side) { g.rect(14, 10 + hy, 2, 2, skinD); g.set(21, 10 + hy, skin); g.set(21, 11 + hy, skin); }
  if (front) hairFront(g, o, y); else if (back) hairBack(g, o, y); else hairSide(g, o, y);
  hat(g, o, dir, y);
  if (o.hat === 'hood' && !back && !o.hs) { /* skin window already drawn */ }

  g.relief().shade();

  // ---- class accents, then crisp details (painted after shading)
  accent(g, o, dir, y, front, back, side);
  const eye = o.eye || '#1a1a2a', blink = fr === 5, dk = adj(skin, 0.55), brow = adj(o.hair, 0.65);
  if (front) {
    if (blink) { g.rect(13, 10 + hy, 2, 1, dk); g.rect(17, 10 + hy, 2, 1, dk); }
    else { g.rect(13, 9 + hy, 2, 2, eye); g.rect(17, 9 + hy, 2, 2, eye); g.set(13, 9 + hy, '#ffffff'); g.set(17, 9 + hy, '#ffffff'); }
    if (o.hs !== 'bald') { g.rect(13, 8 + hy, 2, 1, brow); g.rect(17, 8 + hy, 2, 1, brow); }
    if (o.job !== 'rogue') g.rect(15, 12 + hy, 2, 1, dk);
    g.set(15, 11 + hy, adj(skin, 0.9));
  } else if (side) {
    if (blink) g.rect(18, 10 + hy, 2, 1, dk); else { g.rect(18, 9 + hy, 2, 2, eye); g.set(19, 9 + hy, '#ffffff'); }
    if (o.hs !== 'bald') g.rect(18, 8 + hy, 3, 1, brow);
    if (o.job !== 'rogue') g.rect(18, 12 + hy, 2, 1, dk);
  }
  if (o.trim) { g.set(10, y(15), o.trim); g.set(21, y(15), o.trim); g.set(15, y(20), o.trim); g.set(16, y(20), o.trim); }

  // ---- off-hand
  if (o.shield && !back) {
    const sc = o.shieldCol || '#5a6a8a', sh = adj(sc, 1.35);
    const sx = side ? 11 : 3, sy = y(16);
    g.rect(sx, sy, 8, 7, sc); g.rect(sx + 1, sy + 7, 6, 2, sc); g.rect(sx + 2, sy + 9, 4, 1, sc);
    g.rect(sx, sy, 8, 1, sh); g.rect(sx + 3, sy + 2, 2, 6, GOLD); g.rect(sx + 1, sy + 4, 6, 1, GOLD); g.rect(sx + 7, sy + 1, 1, 6, adj(sc, 0.7));
    if (!side) limb(g, 10, y(15), 8, sy + 5, 3, armCol, glove);
  }
  if (o.offhand === 'tome' && !back) {
    const bx = side ? 18 : 5, byy = y(19);
    g.rect(bx, byy, 6, 8, o.offCol || '#8a3a3a'); g.rect(bx, byy, 2, 8, adj(o.offCol || '#8a3a3a', 0.7)); g.rect(bx + 5, byy + 1, 1, 6, '#e8d8a0'); g.rect(bx + 2, byy + 3, 2, 2, GOLD);
  }
  if (o.offhand === 'quiver' && !side) {
    const q = o.offCol || '#7a5230';
    if (back) { g.rect(19, y(9), 3, 12, q); g.rect(19, y(9), 3, 1, adj(q, 0.7)); for (const [x, col] of [[19, '#cc3a3a'], [20, '#e8e8e8'], [21, '#cc3a3a']]) g.rect(x, y(7), 1, 3, col); }
    else { g.rect(21, y(9), 2, 7, q); for (const [x, col] of [[21, '#e8e8e8'], [22, '#cc3a3a']]) g.rect(x, y(7), 1, 3, col); }
  }

  // ---- weapon
  let tip = null;
  if (wep) {
    const w = back ? handL : handR;
    tip = weapon(g, wep, w[0], w[1], wv[0], wv[1], o.blade || BLADE[0]);
    g.rect(w[0] - 1, w[1] - 1, 3, 3, glove); // fist over the grip
  }

  g.outline();

  // ---- motion fx painted over the outline
  const J = JOBS[o.job], fxc = J ? J.color : '#ffffff';
  const put = (x, yy, col) => { x = Math.round(x); yy = Math.round(yy); if (x >= 0 && yy >= 0 && x < 32 && yy < 32 && !g.get(x, yy)) g.set(x, yy, col); };
  if (act === 2 && wep && tip) {
    const melee = ['sword', 'axe', 'mace', 'dagger', 'spear'].includes(wep), hand = back ? handL : handR;
    if (melee) {
      const a0 = front ? -1.1 : back ? -2.0 : -1.4, a1 = front ? 1.5 : back ? -1.1 : 0.15, mid = (a0 + a1) / 2;
      for (let k = 0; k <= 10; k++) {
        const a = a0 + ((a1 - a0) * k) / 10, r = 12 + Math.sin((k / 10) * Math.PI) * 2;
        const sx = back ? 1 : front || side ? 1 : 1; // arc is drawn around the grip
        put(hand[0] + Math.cos(a) * r * sx, hand[1] + Math.sin(a) * r, k > 6 ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.45)');
      }
      void mid;
    } else for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.283; put(tip[0] + Math.cos(a) * 3, tip[1] + Math.sin(a) * 3, fxc); }
  }
  if (cast && tip) {
    for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.283; put(tip[0] + Math.cos(a) * 4, tip[1] + Math.sin(a) * 4, k % 2 ? fxc : '#ffffff'); }
    put(handL[0] - 2, handL[1] - 3, fxc); put(handR[0] + 2, handR[1] - 3, fxc);
  }
  accentFx(g, o);
  return g.canvas(dir === 2);
}

const cache = new Map();
const memo = (k, f) => { let v = cache.get(k); if (!v) { v = f(); cache.set(k, v); } return v; };

/** lk = [skin, hairStyle, hairColour, eyes], vs = worn-gear tokens, job = job id for the class accents */
export function heroSprite(lk, vs, dir, fr = 0, job = '', act = 0) {
  return memo(`h${lk.join('')}|${vs.join(',')}|${dir}${fr}${job}${act}`, () => render(heroOptions(lk, vs, job), dir, fr, act));
}

const CLASS_HAIR = { warrior: 'short', mage: 'long', ranger: 'ponytail', cleric: 'long', rogue: 'spiky', warlock: 'long', paladin: 'short', druid: 'long', necromancer: 'spiky', monk: 'ponytail' };
/** a class in its starter look, for the picker */
export function classSprite(cls, dir = 0, fr = 0, act = 0) {
  return memo(`c${cls}${dir}${fr}${act}`, () => render({ ...PRESET[cls], hs: CLASS_HAIR[cls] || 'short', skin: SKINS[0], blade: BLADE[0], job: cls, ...(JOB_EYE[cls] ? { eye: JOB_EYE[cls] } : {}) }, dir, fr, act));
}
