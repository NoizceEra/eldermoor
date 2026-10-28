// 32x32 chibi hero sprites (big head, small body, big eyes), assembled from modular layers:
//   body -> legs/boots -> torso/armour -> cape -> arms/gloves -> head -> hair -> head gear -> face (eyes, marks)
//   -> class accents -> off-hand -> weapon.
// Every layer reads its own option, so look (hair style/colour, eye colour/shape, face mark, skin) and each worn
// item swap independently. The animation pose is baked into each frame:
//   fr  0 idle   1 stride A   2 passing   3 stride B   4 idle breath   5 blink
//   act 0 none   2 strike     3 follow-through         4 cast
// Facing: 0 down, 1 up, 2 left (the right-facing canvas mirrored), 3 right.
import { Grid, adj, heroOptions, PRESET, SKINS, BLADE, WOOD, JOB_EYE } from '/client/sprites.js';
import { JOBS } from '/shared/jobs.js';

const RED = '#c03a3a', BONE = '#e6e2cc', GOLD = '#e8c04a', DARK = '#2a2a3a', INK = '#1a1a22';
export const HERO_SIZE = 32;
const WS = 0.82; // weapons are a little shorter than the grown-up sprite's, to suit the proportions

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
  const at = (t, s = 0) => [Math.round(hx + ux * t * WS + px * s), Math.round(hy + uy * t * WS + py * s)];
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

// ---------------------------------------------------------------- hair: a style is a few parameters
// fringe: the bangs over the brow; side: rows of locks beside the face; drop: rows hanging behind below the head;
// extra: a feature (pony, twin tails, bun, braid); puff: a cloud of hair behind the head; spikes / crest: standing hair.
const HAIR = {
  short: { fringe: 'straight', side: 3 },
  long: { fringe: 'swept', side: 12, drop: 9 },
  spiky: { fringe: 'spiky', side: 2, spikes: 1 },
  mohawk: { crest: 1 },
  ponytail: { fringe: 'swept', side: 3, extra: 'pony' },
  bald: null,
  bob: { fringe: 'straight', side: 8, drop: 2 },
  twintails: { fringe: 'straight', side: 3, extra: 'twin' },
  bun: { fringe: 'swept', side: 3, extra: 'bun' },
  curly: { fringe: 'straight', side: 2, puff: 1 },
  braid: { fringe: 'swept', side: 4, extra: 'braid' },
  wild: { fringe: 'spiky', side: 6, drop: 3, spikes: 1, puff: 0.6 },
};
const hairSpec = (o) => HAIR[o.hs || 'short'] || null;

/** hair that sits behind the head (drawn before it) */
function hairUnder(g, o, y) {
  const h = hairSpec(o);
  if (h && h.puff) g.ell(15.5, y(8.5), 9.5 + h.puff, 7.5 + h.puff, o.hair);
}
/** the head's silhouette: a rounded 14 x 14 block, x 9..22, y 3..16 */
function headShape(g, y, col) {
  g.rect(9, y(5), 14, 10, col); g.rect(10, y(4), 12, 1, col); g.rect(11, y(3), 10, 1, col); g.rect(10, y(15), 12, 1, col); g.rect(11, y(16), 10, 1, col);
}
function hairOver(g, o, dir, y) {
  const h = hairSpec(o), hc = o.hair, hl = adj(hc, 1.3), hd = adj(hc, 0.75);
  if (!h) return;
  if (h.crest) {
    if (dir === 0 || dir === 1) { g.rect(14, y(0), 4, 9, hc); g.rect(14, y(0), 1, 7, hl); g.rect(17, y(1), 1, 7, hd); }
    else { g.rect(12, y(0), 5, 9, hc); g.rect(12, y(0), 1, 7, hl); g.rect(9, y(6), 4, 6, hc); }
    return;
  }
  const cap = () => { g.rect(11, y(3), 10, 1, hc); g.rect(10, y(4), 12, 1, hc); g.rect(9, y(5), 14, 3, hc); g.rect(11, y(4), 4, 1, hl); };
  if (dir === 1) { // back of the head: all hair
    cap(); g.rect(9, y(8), 14, 7, hc); g.rect(10, y(15), 12, 1, hc); g.rect(11, y(16), 10, 1, hc); g.rect(11, y(9), 3, 2, hl);
    if (h.drop) g.rect(9, y(17), 14, h.drop, hc);
  } else if (dir === 0) {
    cap();
    if (h.fringe === 'straight') { g.rect(9, y(8), 14, 1, hc); g.rect(9, y(9), 2, 1, hc); g.rect(21, y(9), 2, 1, hc); }
    else if (h.fringe === 'swept') { g.rect(9, y(8), 14, 1, hc); g.rect(9, y(9), 4, 1, hc); g.rect(9, y(10), 2, 1, hc); }
    else if (h.fringe === 'spiky') { g.rect(9, y(8), 14, 1, hc); for (const x of [10, 13, 16, 19, 22]) g.set(x, y(9), hc); }
    if (h.side) { g.rect(8, y(6), 2, 2 + h.side, hc); g.rect(22, y(6), 2, 2 + h.side, hc); }
  } else {
    cap(); g.rect(9, y(8), 8, 7, hc); g.rect(11, y(9), 2, 2, hl);
    if (h.fringe === 'straight') g.rect(17, y(8), 5, 1, hc); else if (h.fringe === 'swept') { g.rect(17, y(8), 5, 1, hc); g.rect(17, y(9), 3, 1, hc); } else if (h.fringe === 'spiky') { g.rect(17, y(8), 6, 1, hc); g.set(20, y(9), hc); g.set(22, y(9), hc); }
    if (h.drop) g.rect(9, y(15), 7, 2 + h.drop, hc);
    if (h.side && h.side > 5) g.rect(10, y(15), 6, h.side - 4, hc);
  }
  if (h.spikes) { g.rect(10, y(1), 2, 3, hc); g.rect(14, y(0), 3, 4, hc); g.rect(19, y(1), 2, 3, hc); g.set(14, y(0), hl); }
  const tie = '#e8c04a';
  if (h.extra === 'pony') {
    if (dir === 0) { g.rect(23, y(6), 2, 3, hc); g.set(23, y(7), tie); g.rect(24, y(9), 2, 7, hc); g.rect(24, y(9), 1, 4, hl); }
    else if (dir === 1) { g.rect(15, y(13), 3, 9, hc); g.rect(15, y(13), 1, 6, hl); g.rect(15, y(13), 3, 1, tie); }
    else { g.rect(5, y(6), 4, 3, hc); g.set(8, y(7), tie); g.rect(4, y(9), 3, 8, hc); g.rect(4, y(9), 1, 5, hl); }
  } else if (h.extra === 'twin') {
    if (dir === 0 || dir === 1) { for (const x of [5, 24]) { g.rect(x, y(8), 3, 2, hc); g.set(x + (x < 10 ? 2 : 0), y(8), tie); g.rect(x - (x < 10 ? 0 : 0), y(10), 3, 8, hc); g.rect(x, y(10), 1, 5, hl); } }
    else { g.rect(5, y(8), 3, 2, hc); g.rect(4, y(10), 3, 8, hc); g.rect(4, y(10), 1, 5, hl); }
  } else if (h.extra === 'bun') {
    g.ell(dir >= 2 ? 13 : 15.5, y(1.5), 3.6, 2.6, hc); g.rect(dir >= 2 ? 11 : 13, y(0), 2, 1, hl); g.rect(dir >= 2 ? 11 : 14, y(3), 5, 1, tie);
  } else if (h.extra === 'braid') {
    const bx = dir === 0 ? 22 : dir === 1 ? 15 : 6, by0 = dir === 0 ? 14 : 13;
    g.rect(bx, y(by0), 3, 11, hc); for (let k = 0; k < 5; k++) g.rect(bx, y(by0 + 1 + k * 2), 3, 1, hd); g.rect(bx, y(by0 + 10), 3, 1, tie);
  }
}

/** head gear: all of it is a swappable layer over the hair */
function hat(g, o, dir, y) {
  const hc = o.hatCol || '#aab2c0', hd = adj(hc, 0.75), hl = adj(hc, 1.3), side = dir >= 2, back = dir === 1;
  switch (o.hat) {
    case 'helm': case 'horns':
      g.rect(8, y(3), 16, 6, hc); g.rect(10, y(2), 12, 1, hc); g.rect(10, y(3), 5, 1, hl); g.rect(8, y(8), 16, 1, hd);
      if (!side) { g.rect(8, y(9), 2, 5, hc); g.rect(22, y(9), 2, 5, hc); if (!back) g.rect(15, y(9), 2, 5, hc); else g.rect(8, y(9), 16, 6, hc); }
      else { g.rect(8, y(9), 8, 6, hc); g.rect(21, y(9), 2, 4, hc); }
      if (o.hat === 'horns') {
        const hn = '#e8e0d0';
        if (!side) { g.rect(5, y(0), 3, 6, hn); g.rect(24, y(0), 3, 6, hn); g.rect(4, y(-1), 2, 2, hn); g.rect(26, y(-1), 2, 2, hn); }
        else { g.rect(12, y(-1), 3, 6, hn); g.rect(15, y(-2), 2, 2, hn); }
      } else if (!o.hatCol) g.rect(15, y(-1), 2, 3, RED);
      break;
    case 'wizard':
      g.rect(6, y(7), 20, 2, hc); g.rect(7, y(9), 18, 1, hd); g.rect(9, y(5), 14, 2, hd); g.rect(10, y(3), 12, 2, hc); g.rect(12, y(1), 8, 2, hc); g.rect(14, y(0), 5, 1, hc);
      g.rect(19, y(-1), 3, 2, hc); g.rect(20, y(0), 3, 2, hd); g.rect(18, y(5), 3, 2, GOLD); g.rect(11, y(2), 2, 4, hl);
      break;
    case 'hood':
      g.rect(8, y(3), 16, 13, hc); g.rect(10, y(2), 12, 1, hc); g.rect(10, y(3), 6, 1, hl); g.rect(9, y(15), 14, 3, hd);
      if (dir === 0) g.rect(11, y(8), 10, 8, o.skin);
      if (dir === 3 || dir === 2) g.rect(14, y(8), 9, 8, o.skin);
      break;
    case 'cap':
      g.rect(9, y(3), 14, 5, hc); g.rect(10, y(2), 12, 1, hc); g.rect(8, y(8), 16, 1, hd); g.rect(11, y(3), 4, 1, hl);
      break;
    case 'crown': {
      const gd = o.hatCol || '#f0c040';
      g.rect(9, y(4), 14, 4, gd); for (const x of [9, 15, 20]) g.rect(x, y(1), x === 15 ? 2 : 3, 3, gd); g.rect(10, y(4), 3, 1, adj(gd, 1.3));
      if (!back) g.rect(15, y(5), 2, 2, '#ff5a5a');
      break;
    }
    case 'circlet':
      g.rect(9, y(7), 14, 1, o.hatCol || GOLD);
      if (!back) g.rect(15, y(6), 2, 2, '#5fd3ff');
      break;
    default:
  }
}

// ---------------------------------------------------------------- face: eyes and marks (painted after shading so they stay crisp)
function eyeAt(g, x, yy, style, col, blink) {
  const dk = adj(col, 0.5), lt = adj(col, 1.45);
  if (blink) { g.rect(x, yy + 3, 3, 1, INK); return; }
  switch (style) {
    case 'sharp': g.rect(x, yy + 1, 3, 3, col); g.rect(x - 1, yy, 5, 1, INK); g.rect(x, yy + 3, 3, 1, lt); g.set(x + 1, yy + 2, '#ffffff'); break;
    case 'sleepy': g.rect(x, yy + 2, 3, 2, col); g.rect(x, yy + 1, 3, 1, INK); g.set(x, yy + 2, '#ffffff'); g.rect(x, yy + 3, 3, 1, lt); break;
    case 'sparkle': g.rect(x, yy, 3, 4, col); g.rect(x, yy, 3, 1, dk); g.set(x, yy + 1, '#ffffff'); g.set(x + 2, yy + 2, '#ffffff'); g.rect(x, yy + 3, 3, 1, lt); break;
    default: g.rect(x, yy, 3, 4, col); g.rect(x, yy, 3, 1, dk); g.set(x, yy + 1, '#ffffff'); g.rect(x, yy + 3, 3, 1, lt);
  }
}
function face(g, o, dir, y, blink) {
  if (dir === 1) return;
  const eye = o.eye || INK, dk = adj(o.skin, 0.55), side = dir >= 2, es = o.es || 'round', fm = o.fm || 'none', frame = '#3a2a1a';
  const ex = side ? [18] : [11, 18];
  for (const x of ex) eyeAt(g, x, y(10), es, eye, blink);
  if (o.job !== 'rogue') g.rect(side ? 20 : 15, y(15), 2, 1, dk);
  if (!side) g.set(15, y(13), adj(o.skin, 0.9));
  const pink = '#f09aa0';
  if (fm === 'blush') { if (side) g.rect(19, y(14), 3, 1, pink); else { g.rect(10, y(14), 3, 1, pink); g.rect(19, y(14), 3, 1, pink); } }
  else if (fm === 'freckles') { const fr = adj(o.skin, 0.68); for (const [x, yy] of side ? [[18, 14], [20, 14], [19, 13]] : [[11, 14], [13, 14], [12, 13], [18, 14], [20, 14], [19, 13]]) g.set(x, y(yy), fr); }
  else if (fm === 'scar') { if (side) g.line(18, y(9), 21, y(14), '#c85a5a'); else g.line(10, y(9), 14, y(14), '#c85a5a'); }
  else if (fm === 'glasses') {
    for (const x of ex) { g.rect(x - 1, y(9), 5, 1, frame); g.rect(x - 1, y(14), 5, 1, frame); g.rect(x - 1, y(9), 1, 6, frame); g.rect(x + 3, y(9), 1, 6, frame); }
    if (!side) g.rect(14, y(11), 4, 1, frame);
  } else if (fm === 'eyepatch') {
    const px = side ? 17 : 10;
    g.rect(px, y(9), side ? 5 : 5, 6, INK); g.line(side ? 9 : 9, y(7), side ? 17 : 10, y(10), INK);
  }
}

// ---------------------------------------------------------------- class identity: a signature silhouette whatever the hero wears
function accent(g, o, dir, y, front, back, side) {
  const J = JOBS[o.job];
  if (!J) return;
  const c = J.color, cd = adj(c, 0.7);
  const pauldrons = (col) => {
    const hi = adj(col, 1.3), lo = adj(col, 0.7);
    if (!side) { for (const x of [8, 20]) { g.rect(x, y(17), 4, 4, col); g.rect(x, y(17), 4, 1, hi); g.rect(x, y(20), 4, 1, lo); } }
    else { g.rect(13, y(17), 5, 4, col); g.rect(13, y(17), 5, 1, hi); g.rect(13, y(20), 5, 1, lo); }
  };
  switch (o.job) {
    case 'warrior':
      pauldrons('#aab2c0');
      if (front) { g.rect(15, y(18), 2, 6, RED); g.rect(14, y(23), 4, 2, RED); }
      break;
    case 'paladin':
      pauldrons('#d8c070');
      if (!side) for (const [x, w] of [[4, 4], [2, 2], [24, 4], [28, 2]]) { g.rect(x, y(4), w, 2, '#fff2a0'); g.rect(x, y(6), w, 1, adj('#fff2a0', 0.8)); }
      if (front) { g.rect(15, y(18), 2, 6, GOLD); g.rect(13, y(19), 6, 2, GOLD); g.rect(15, y(19), 2, 2, '#fff2a0'); }
      else if (side) { g.rect(16, y(18), 2, 5, GOLD); g.rect(15, y(19), 4, 2, GOLD); }
      break;
    case 'mage':
      if (!side) for (let x = 10; x < 22; x += 2) g.rect(x, 27, 1, 1, GOLD); else for (let x = 12; x < 21; x += 2) g.rect(x, 27, 1, 1, GOLD);
      if (!side) g.rect(10, y(17), 12, 2, '#e8e0d0'); else g.rect(13, y(17), 7, 2, '#e8e0d0');
      if (front) { g.rect(15, y(19), 2, 2, '#9fe8ff'); g.set(15, y(19), '#ffffff'); }
      break;
    case 'ranger':
      g.rect(11, y(17), 10, 2, c); if (front) { g.rect(19, y(19), 2, 4, cd); limb(g, 11, y(18), 19, y(23), 1, '#6a4a2a', '#6a4a2a', 0); }
      g.rect(23, y(2), 1, 7, '#f0f0e8'); g.rect(24, y(3), 1, 5, c);
      break;
    case 'cleric':
      g.ell(15.5, y(1.6), 7, 1.8, '#ffe88a'); g.ell(15.5, y(1.6), 5, 0.8, null);
      if (front) { g.rect(14, y(18), 4, 6, '#ffffff'); g.rect(14, y(23), 4, 1, GOLD); g.rect(15, y(18), 2, 3, GOLD); g.rect(14, y(19), 4, 1, GOLD); }
      break;
    case 'rogue':
      if (front) g.rect(10, y(13), 12, 3, DARK); else if (side) g.rect(16, y(13), 7, 3, DARK);
      if (!side) { g.rect(21, y(19), 2, 5, RED); g.rect(22, y(23), 2, 3, adj(RED, 0.7)); } else { g.rect(11, y(18), 3, 2, RED); g.rect(8, y(19), 3, 2, RED); g.rect(6, y(20), 2, 2, adj(RED, 0.7)); }
      break;
    case 'warlock':
      if (!side) for (const x of [7, 22]) { g.rect(x, y(15), 3, 4, '#3a1050'); g.rect(x + 1, y(14), 1, 1, '#a03aa0'); }
      if (!back) g.rect(12, y(17), 8, 1, '#c060c0');
      if (front) { g.rect(15, y(22), 2, 2, BONE); g.set(15, y(23), DARK); g.set(16, y(23), DARK); }
      break;
    case 'druid':
      pauldrons('#5a9a4a');
      if (!side) { for (const [x0, y0, x1, y1] of [[11, 3, 9, 0], [10, 2, 7, 2], [20, 3, 22, 0], [21, 2, 24, 2]]) g.line(x0, y(y0), x1, y(y1), '#c8a870'); }
      else { g.line(15, y(3), 14, y(0), '#c8a870'); g.line(14, y(1), 11, y(1), '#c8a870'); }
      if (front) { g.rect(12, y(22), 8, 1, '#4a8a3a'); g.set(13, y(23), '#9aff8a'); g.set(18, y(23), '#9aff8a'); }
      break;
    case 'necromancer':
      pauldrons('#d8d4bc');
      if (!side) { g.rect(8, y(15), 1, 2, BONE); g.rect(23, y(15), 1, 2, BONE); }
      if (front) { g.rect(14, y(18), 4, 3, BONE); g.set(15, y(19), DARK); g.set(17, y(19), DARK); g.rect(15, y(21), 2, 3, '#b8b4a0'); }
      break;
    case 'monk':
      g.rect(9, y(8), 14, 2, RED); g.rect(9, y(8), 14, 1, adj(RED, 1.25)); g.rect(22, y(9), 3, 1, RED); g.rect(24, y(10), 2, 2, adj(RED, 0.8)); g.rect(23, y(12), 3, 1, RED);
      if (front) { limb(g, 11, y(18), 20, y(23), 2, '#7a2a1a', '#7a2a1a', 0); g.rect(11, y(22), 10, 1, '#7a2a1a'); }
      break;
    default:
  }
}
function accentFx(g, o) {
  const dot = (x, y, col) => { if (!g.get(x, y)) g.set(x, y, col); };
  const t = (x, y, a, b) => { dot(x, y, a); if (b) dot(x + 1, y, b); };
  if (o.job === 'warlock') { t(2, 9, '#d060d0'); t(29, 15, '#a03aa0'); t(2, 19, '#7a2a7a'); t(29, 7, '#e8a0ff'); }
  else if (o.job === 'necromancer') { t(2, 7, '#7affc8'); t(29, 13, '#7affc8'); t(2, 20, '#4aa890'); t(29, 21, '#a8ffe0'); }
  else if (o.job === 'mage') { t(28, 7, '#9fe8ff', '#ffffff'); t(2, 12, '#c8a8ff'); t(29, 19, '#ffffff'); }
  else if (o.job === 'druid') { t(2, 11, '#9aff8a'); t(28, 21, '#6aaa4a'); t(2, 23, '#c8ff9a'); }
  else if (o.job === 'cleric') { t(3, 8, '#fff2a0'); t(28, 10, '#ffffff'); }
  else if (o.job === 'paladin') { t(2, 15, '#fff2a0'); }
}

// ---------------------------------------------------------------- the whole figure
function render(o, dir, fr, act) {
  const g = new Grid(32, 32);
  const front = dir === 0, back = dir === 1, side = dir >= 2;
  const stride = fr === 1 ? -1 : fr === 3 ? 1 : 0;
  const by = fr === 1 || fr === 3 || fr === 4 ? 1 : 0; // head and torso settle on stride and breath frames
  const y = (v) => v + by;
  const skin = o.skin, pants = o.pants, boots = o.boots, tunic = o.tunic, sleeve = o.sleeve || tunic;
  const glove = o.gloves || skin;
  const wep = o.weapon, bow = wep === 'bow';
  const cast = act === 4;

  // ---- hands: [x, y] and the weapon direction, per facing and pose
  let handR, handL, wv;
  if (front) {
    handL = [9, y(23) + stride]; handR = [22, y(23) - stride]; wv = bow ? [1, 0] : [0.35, -1];
    if (act === 2) { handR = [21, y(25)]; wv = bow ? [1, 0.2] : [-0.4, 1]; } else if (act === 3) { handR = [24, y(22)]; wv = bow ? [1, 0] : [1, -0.3]; }
    if (cast) { handR = [23, y(15)]; handL = [9, y(15)]; wv = bow ? [1, 0] : [0.15, -1]; }
  } else if (back) {
    handR = [22, y(23) + stride]; handL = [9, y(23) - stride]; wv = bow ? [-1, 0] : [-0.35, -1];
    if (act === 2) { handL = [10, y(13)]; wv = bow ? [-1, 0] : [0, -1]; } else if (act === 3) { handL = [8, y(20)]; wv = bow ? [-1, 0] : [-1, -0.2]; }
    if (cast) { handR = [23, y(15)]; handL = [9, y(15)]; wv = bow ? [-1, 0] : [-0.15, -1]; }
  } else {
    handR = [18 + stride * 2, y(23)]; handL = [15 - stride * 2, y(23)]; wv = bow ? [1, 0] : [0.55, -1];
    if (act === 2) { handR = [22, y(20)]; wv = bow ? [1, 0] : [1, 0.12]; } else if (act === 3) { handR = [20, y(22)]; wv = bow ? [1, 0] : [0.8, 0.6]; }
    if (cast) { handR = [21, y(16)]; handL = [16, y(16)]; wv = bow ? [1, 0] : [0.2, -1]; }
  }

  // ---- layers behind the body
  hairUnder(g, o, y);
  if (o.cape) { if (front) g.rect(9, y(18), 14, 10, o.cape); else if (side) g.rect(10, y(18), 5, 10, o.cape); }
  if (o.offhand === 'quiver' && side) { g.rect(11, y(13), 3, 10, o.offCol || '#7a5230'); g.rect(11, y(12), 1, 1, '#e8e8e8'); g.rect(13, y(12), 1, 1, '#cc3a3a'); }
  if (side) limb(g, 14, y(18), handL[0], handL[1], 2, adj(sleeve, 0.78), adj(glove, 0.8));

  // ---- legs and boots
  const leg = (x, w, lift, toe) => {
    const ph = 3 - lift;
    g.rect(x, 24, w, ph, lift ? adj(pants, 0.9) : pants);
    g.rect(x, 24 + ph, w, 2, boots); g.rect(x, 26 + ph, w + toe, 1, adj(boots, 0.7)); if (toe) g.rect(x + w, 25 + ph, 1, 1, boots);
  };
  if (!side) { leg(12, 3, stride === -1 ? 1 : 0, 0); leg(17, 3, stride === 1 ? 1 : 0, 0); }
  else {
    const bx = 13 + (stride === -1 ? -2 : stride === 1 ? 2 : 0), fx = 16 + (stride === -1 ? 2 : stride === 1 ? -2 : 0);
    leg(bx, 3, stride === -1 ? 1 : 0, 1); leg(fx, 3, stride === 1 ? 1 : 0, 1);
  }

  // ---- torso and body armour
  if (!side) {
    g.rect(11, y(17), 10, 5, tunic); g.rect(12, y(22), 8, 2, tunic); g.rect(11, y(22), 10, 1, o.belt);
    if (front) g.rect(15, y(22), 2, 1, GOLD);
    if (o.robe) { g.rect(10, y(23), 12, 4, tunic); g.rect(9, 26, 14, 2, adj(tunic, 0.85)); }
  } else {
    g.rect(13, y(17), 7, 5, tunic); g.rect(14, y(22), 5, 2, tunic); g.rect(13, y(22), 7, 1, o.belt);
    if (o.robe) { g.rect(12, y(23), 9, 4, tunic); g.rect(11, 26, 11, 2, adj(tunic, 0.85)); }
  }
  if (o.bk && !back) {
    const lt = adj(tunic, 1.25), dk = adj(tunic, 0.68), x0 = side ? 13 : 12, w = side ? 7 : 8;
    if (o.bk === 'mail') { for (let yy = 17; yy < 22; yy++) for (let x = x0; x < x0 + w; x++) if ((x + yy) % 2) g.set(x, y(yy), lt); }
    else if (o.bk === 'leather') { g.rect(15, y(17), 2, 5, dk); if (!side) for (let yy = 17; yy < 22; yy += 2) { g.set(13, y(yy), lt); g.set(18, y(yy), lt); } }
    else if (o.bk === 'plate') { if (!side) { g.rect(8, y(17), 4, 3, lt); g.rect(20, y(17), 4, 3, lt); g.rect(14, y(17), 4, 4, lt); g.rect(12, y(21), 8, 1, dk); } else { g.rect(13, y(17), 5, 3, lt); g.rect(15, y(19), 3, 3, lt); g.rect(13, y(21), 7, 1, dk); } }
  }

  // ---- arms
  if (!side) {
    limb(g, 10, y(18), handL[0], handL[1], 2, sleeve, glove);
    limb(g, 22, y(18), handR[0], handR[1], 2, sleeve, glove);
  } else limb(g, 16, y(18), handR[0], handR[1], 2, sleeve, glove);
  if (back && o.cape) { g.rect(10, y(17), 12, 11, o.cape); g.rect(15, y(18), 2, 9, adj(o.cape, 0.8)); }

  // ---- head, hair, head gear
  headShape(g, y, skin);
  if (side) { g.rect(13, y(10), 2, 3, adj(skin, 0.82)); g.set(23, y(12), skin); }
  hairOver(g, o, dir, y);
  hat(g, o, dir, y);

  g.relief().shade();

  // ---- class accents, face, then crisp details
  accent(g, o, dir, y, front, back, side);
  face(g, o, dir, y, fr === 5);
  if (o.trim) { g.set(9, y(18), o.trim); g.set(22, y(18), o.trim); g.set(15, y(21), o.trim); g.set(16, y(21), o.trim); }

  // ---- off-hand
  if (o.shield && !back) {
    const sc = o.shieldCol || '#5a6a8a', sh = adj(sc, 1.35);
    const sx = side ? 11 : 2, sy = y(18);
    g.rect(sx, sy, 8, 6, sc); g.rect(sx + 1, sy + 6, 6, 2, sc); g.rect(sx + 2, sy + 8, 4, 1, sc);
    g.rect(sx, sy, 8, 1, sh); g.rect(sx + 3, sy + 1, 2, 6, GOLD); g.rect(sx + 1, sy + 3, 6, 1, GOLD); g.rect(sx + 7, sy + 1, 1, 6, adj(sc, 0.7));
    if (!side) limb(g, 10, y(18), 8, sy + 4, 2, sleeve, glove);
  }
  if (o.offhand === 'tome' && !back) {
    const bx = side ? 18 : 4, byy = y(20);
    g.rect(bx, byy, 6, 7, o.offCol || '#8a3a3a'); g.rect(bx, byy, 2, 7, adj(o.offCol || '#8a3a3a', 0.7)); g.rect(bx + 5, byy + 1, 1, 5, '#e8d8a0'); g.rect(bx + 2, byy + 2, 2, 2, GOLD);
  }
  if (o.offhand === 'quiver' && !side) {
    const q = o.offCol || '#7a5230';
    if (back) { g.rect(19, y(11), 3, 12, q); g.rect(19, y(11), 3, 1, adj(q, 0.7)); for (const [x, col] of [[19, '#cc3a3a'], [20, '#e8e8e8'], [21, '#cc3a3a']]) g.rect(x, y(9), 1, 3, col); }
    else { g.rect(22, y(11), 2, 7, q); for (const [x, col] of [[22, '#e8e8e8'], [23, '#cc3a3a']]) g.rect(x, y(9), 1, 3, col); }
  }

  // ---- weapon
  let tip = null;
  if (wep) {
    const w = back ? handL : handR;
    tip = weapon(g, wep, w[0], w[1], wv[0], wv[1], o.blade || BLADE[0]);
    g.rect(w[0] - 1, w[1] - 1, 3, 3, glove);
  }

  g.outline();

  // ---- motion fx painted over the outline
  const J = JOBS[o.job], fxc = J ? J.color : '#ffffff';
  const put = (x, yy, col) => { x = Math.round(x); yy = Math.round(yy); if (x >= 0 && yy >= 0 && x < 32 && yy < 32 && !g.get(x, yy)) g.set(x, yy, col); };
  if (act === 2 && wep && tip) {
    const melee = ['sword', 'axe', 'mace', 'dagger', 'spear'].includes(wep), hand = back ? handL : handR;
    if (melee) {
      const a0 = front ? -1.1 : back ? -2.0 : -1.4, a1 = front ? 1.5 : back ? -1.1 : 0.15;
      for (let k = 0; k <= 10; k++) {
        const a = a0 + ((a1 - a0) * k) / 10, r = 11 + Math.sin((k / 10) * Math.PI) * 2;
        put(hand[0] + Math.cos(a) * r, hand[1] + Math.sin(a) * r, k > 6 ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.45)');
      }
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

/** lk = look fields, vs = worn-gear tokens, job = job id for the class accents */
export function heroSprite(lk, vs, dir, fr = 0, job = '', act = 0) {
  return memo(`h${lk.join('.')}|${vs.join(',')}|${dir}${fr}${job}${act}`, () => render(heroOptions(lk, vs, job), dir, fr, act));
}

const CLASS_HAIR = { warrior: 'short', mage: 'long', ranger: 'ponytail', cleric: 'braid', rogue: 'spiky', warlock: 'bob', paladin: 'short', druid: 'twintails', necromancer: 'wild', monk: 'bun' };
/** a class in its starter look, for the picker */
export function classSprite(cls, dir = 0, fr = 0, act = 0) {
  return memo(`c${cls}${dir}${fr}${act}`, () => render({ ...PRESET[cls], hs: CLASS_HAIR[cls] || 'short', skin: SKINS[0], blade: BLADE[0], job: cls, es: 'round', fm: 'none', ...(JOB_EYE[cls] ? { eye: JOB_EYE[cls] } : {}) }, dir, fr, act));
}
