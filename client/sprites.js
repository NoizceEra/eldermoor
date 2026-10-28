// Procedural pixel art. Every sprite is built pixel-by-pixel on a small grid, given a
// two-tone bevel shade and a 1px dark outline, then cached as a canvas.
import { hash2 } from '/shared/world.js';
import { SKILLS } from '/shared/jobs.js';
import { SKIN_TONES, HAIR_STYLES, HAIR_COLORS, EYE_COLORS, defaultColor } from '/shared/gear.js';

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** f<1 darkens, f>1 lightens toward white */
export const adj = (h, f) => {
  const [r, g, b] = hex(h);
  return f < 1 ? toHex([r * f, g * f, b * f]) : toHex([r + (255 - r) * (f - 1), g + (255 - g) * (f - 1), b + (255 - b) * (f - 1)]);
};
export const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
/** a colour wash over the opaque pixels only (icy dungeon art is the crypt art, tinted) */
export function tintCanvas(src, rgba) {
  const c = mkCanvas(src.width, src.height), x = c.getContext('2d');
  x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-atop'; x.fillStyle = rgba; x.fillRect(0, 0, c.width, c.height);
  return c;
}

export class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Array(w * h).fill(null); }
  set(x, y, c) { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c; }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.d[y * this.w + x]; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  ell(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) this.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
  }
  /** bevel: darker on right/bottom silhouette edges, lighter on top/left */
  shade() {
    const out = this.d.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        if (!c) continue;
        if (!this.get(x + 1, y) || !this.get(x, y + 1)) out[y * this.w + x] = adj(c, 0.78);
        else if (!this.get(x, y - 1) || !this.get(x - 1, y)) out[y * this.w + x] = adj(c, 1.2);
      }
    }
    this.d = out;
    return this;
  }
  outline(col = '#16121f') {
    const out = this.d.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x + 1, y) || this.get(x - 1, y) || this.get(x, y + 1) || this.get(x, y - 1)) out[y * this.w + x] = col;
      }
    }
    this.d = out;
    return this;
  }
  /** recolour every pixel by hashing its position into a palette (rock / bark texture) */
  tex(cols, seed = 1) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) this.set(x, y, cols[Math.floor(hash2(x, y, seed) * cols.length)]);
      }
    }
    return this;
  }
  canvas(flip = false) {
    const c = mkCanvas(this.w, this.h);
    const x = c.getContext('2d');
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const col = this.d[j * this.w + i];
        if (!col) continue;
        x.fillStyle = col;
        x.fillRect(flip ? this.w - 1 - i : i, j, 1, 1);
      }
    }
    return c;
  }
}

export const RARITY_COL = ['#c8c8c8', '#5fd35f', '#4aa3ff', '#c06bff'];
const BLADE = ['#cfd4dc', '#8be88b', '#7cc2ff', '#dc9bff'];
const SKINS = ['#f0c090', '#e0a878', '#b9814f', '#8a5a3a'];
const WOOD = '#7a5230';

// ------------------------------------------------------------------ weapons
function weapon(g, kind, x, blade, mirror = false) {
  const m = mirror ? -1 : 1;
  switch (kind) {
    case 'sword':
      g.rect(x, 2, 1, 7, blade); g.set(x, 1, adj(blade, 1.4));
      g.rect(x - 1, 9, 3, 1, '#c8a040'); g.set(x, 10, WOOD); g.set(x, 11, '#c8a040');
      break;
    case 'axe':
      g.rect(x, 3, 1, 9, WOOD); g.rect(x - (mirror ? 0 : 1), 2, 2, 4, blade); g.set(x - 2 * m, 3, adj(blade, 1.25)); g.set(x - 2 * m, 4, adj(blade, 1.25));
      break;
    case 'mace':
      g.rect(x, 5, 1, 7, WOOD); g.rect(x - 1, 2, 3, 3, blade); g.set(x, 1, adj(blade, 1.3));
      break;
    case 'staff':
      g.rect(x, 2, 1, 12, WOOD); g.rect(x - (mirror ? 1 : 0), 0, 2, 2, blade === BLADE[0] ? '#7ae0ff' : blade); g.set(x - (mirror ? 1 : 0), 0, '#ffffff');
      break;
    case 'spear':
      g.rect(x, 2, 1, 12, WOOD); g.rect(x, 0, 1, 3, '#dfe4ec'); g.set(x - 1, 2, '#9aa0ac'); g.set(x + 1, 2, '#9aa0ac');
      break;
    case 'wand':
      g.rect(x, 4, 1, 8, WOOD); g.rect(x, 2, 1, 2, blade === BLADE[0] ? '#ff7aff' : blade); g.set(x, 1, '#ffffff');
      break;
    case 'dagger':
      g.rect(x, 6, 1, 4, '#cfd4dc'); g.rect(x - 1, 10, 3, 1, '#6a4a2a'); g.set(x, 11, '#6a4a2a');
      break;
    case 'bow':
      for (const [dx, dy] of [[0, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [0, 9]]) g.set(x + dx * m, dy, WOOD);
      g.rect(x, 4, 1, 5, '#ece6d0');
      break;
    default:
  }
}

// ------------------------------------------------------------------ humanoids
function hairFront(g, o, dir) {
  const hs = o.hs || 'short', hc = o.hair;
  if (dir === 1) { // back of the head
    if (hs === 'bald') { g.rect(5, 2, 6, 5, o.skin); return; }
    if (hs === 'mohawk') { g.rect(5, 2, 6, 5, o.skin); g.rect(7, 0, 2, 7, hc); return; }
    g.rect(5, 2, 6, 5, hc);
    if (hs === 'long') g.rect(4, 3, 8, 6, hc);
    if (hs === 'ponytail') { g.rect(7, 7, 2, 3, hc); g.set(8, 10, adj(hc, 0.8)); }
    if (hs === 'spiky') { for (const x of [5, 9, 10]) g.set(x, 1, hc); g.set(7, 0, hc); g.set(7, 1, hc); }
    return;
  }
  g.rect(5, 2, 6, 5, o.skin);
  switch (hs) {
    case 'bald': break;
    case 'long': g.rect(5, 2, 6, 2, hc); g.set(5, 4, hc); g.set(10, 4, hc); g.rect(4, 3, 1, 6, hc); g.rect(11, 3, 1, 6, hc); break;
    case 'spiky': g.rect(5, 2, 6, 2, hc); g.set(5, 4, hc); g.set(10, 4, hc); for (const x of [5, 9, 10]) g.set(x, 1, hc); g.set(7, 0, hc); g.set(7, 1, hc); break;
    case 'mohawk': g.rect(7, 0, 2, 4, hc); g.rect(6, 1, 1, 2, hc); g.rect(9, 1, 1, 2, hc); break;
    case 'ponytail': g.rect(5, 2, 6, 2, hc); g.set(5, 4, hc); g.set(10, 4, hc); g.set(11, 5, hc); g.set(11, 6, hc); break;
    default: g.rect(5, 2, 6, 2, hc); g.set(5, 4, hc); g.set(10, 4, hc);
  }
}
function hairSide(g, o) { // facing right: the back of the head is on the left
  const hs = o.hs || 'short', hc = o.hair;
  g.rect(5, 2, 6, 5, o.skin);
  switch (hs) {
    case 'bald': break;
    case 'long': g.rect(5, 2, 6, 2, hc); g.rect(5, 4, 3, 3, hc); g.rect(4, 4, 3, 6, hc); break;
    case 'spiky': g.rect(5, 2, 6, 2, hc); g.rect(5, 4, 3, 3, hc); for (const x of [5, 7, 9]) g.set(x, 1, hc); g.set(6, 0, hc); break;
    case 'mohawk': g.rect(6, 0, 3, 4, hc); g.rect(5, 4, 2, 2, hc); break;
    case 'ponytail': g.rect(5, 2, 6, 2, hc); g.rect(5, 4, 3, 3, hc); g.rect(3, 4, 2, 4, hc); g.set(3, 8, hc); break;
    default: g.rect(5, 2, 6, 2, hc); g.rect(5, 4, 3, 3, hc);
  }
  g.set(11, 5, o.skin);
}
function bodyDetail(g, o, side) {
  if (!o.bk) return;
  const t = o.tunic, lt = adj(t, 1.25), dk = adj(t, 0.7);
  const x0 = side ? 6 : 5, w = side ? 4 : 6;
  if (o.bk === 'mail') { for (let y = 7; y < 10; y++) for (let x = x0; x < x0 + w; x++) if ((x + y) % 2) g.set(x, y, lt); }
  else if (o.bk === 'leather') { if (!side) { g.rect(7, 7, 2, 3, dk); for (let y = 7; y < 10; y += 2) { g.set(6, y, lt); g.set(9, y, lt); } } else g.rect(7, 7, 1, 3, dk); }
  else if (o.bk === 'plate') { if (!side) { g.rect(3, 7, 2, 2, lt); g.rect(11, 7, 2, 2, lt); g.rect(7, 7, 2, 3, lt); g.rect(5, 9, 6, 1, dk); } else { g.rect(6, 7, 2, 2, lt); g.rect(7, 9, 2, 1, dk); } }
}

/** dir: 0 down, 1 up, 2 left, 3 right; fr: 0..3 walk cycle */
function humanoid(o, dir, fr) {
  const g = new Grid(16, 16);
  const stride = fr === 1 || fr === 3;
  const side = dir >= 2;
  const pants = o.pants, boots = o.boots;
  const tunic = o.tunic;

  if (!side) {
    if (o.cape && dir === 0) g.rect(3, 8, 10, 7, o.cape);
    const leg = (x, raised) => { const yb = raised ? 13 : 14; g.rect(x, 11, 2, yb - 11, pants); g.rect(x, yb, 2, 1, boots); };
    leg(6, fr === 1); leg(8, fr === 3);
    g.rect(5, 7, 6, 4, tunic);
    if (o.robe) { g.rect(5, 11, 6, 2, tunic); g.rect(4, 12, 8, 2, tunic); }
    g.rect(5, 10, 6, 1, o.belt);
    const al = fr === 3 ? 1 : 0, ar = fr === 1 ? 1 : 0;
    g.rect(4, 7 + al, 1, 3, o.sleeve || tunic); g.rect(11, 7 + ar, 1, 3, o.sleeve || tunic);
    g.rect(4, 9 + al, 1, 2, o.gloves || o.skin); g.rect(11, 9 + ar, 1, 2, o.gloves || o.skin);
    if (o.trim) { g.set(4, 7, o.trim); g.set(11, 7, o.trim); g.set(7, 10, o.trim); g.set(8, 10, o.trim); }
    // head
    if (o.cape && dir === 1) { g.rect(4, 7, 8, 7, o.cape); g.rect(7, 8, 1, 5, adj(o.cape, 0.8)); }
    hairFront(g, o, dir);
    if (o.apron && dir === 0) g.rect(6, 8, 4, 5, '#e8e0cc');
  } else {
    // side view, facing right
    if (o.cape) g.rect(3, 7, 4, 8, o.cape);
    const back = stride ? 5 : 6, front = stride ? 9 : 8;
    g.rect(back, 11, 2, fr === 1 ? 2 : 3, adj(pants, 0.85)); g.rect(back, fr === 1 ? 13 : 14, 2, 1, boots);
    g.rect(front, 11, 2, fr === 3 ? 2 : 3, pants); g.rect(front, fr === 3 ? 13 : 14, 2, 1, boots);
    g.rect(6, 7, 4, 4, tunic);
    if (o.robe) { g.rect(5, 11, 6, 2, tunic); g.rect(5, 12, 6, 2, tunic); }
    g.rect(6, 10, 4, 1, o.belt);
    g.rect(7, 7, 2, 3, adj(o.sleeve || tunic, 0.88)); g.set(8, 10, o.gloves || o.skin); if (o.gloves) g.set(8, 9, o.gloves);
    if (o.trim) g.set(7, 7, o.trim);
    hairSide(g, o);
  }

  // hats
  const hc2 = o.hatCol || '#aab2c0';
  if (o.hat === 'helm' || o.hat === 'horns') {
    g.rect(5, 1, 6, 3, hc2); g.rect(4, 2, 1, 3, hc2); g.rect(11, 2, 1, 3, hc2);
    if (dir === 0) g.rect(7, 4, 2, 2, hc2);
    if (dir === 3) g.rect(10, 3, 2, 3, hc2);
    if (dir === 2) g.rect(4, 3, 2, 3, hc2);
    if (o.hat === 'horns') {
      const hn = '#e8e0d0';
      if (dir === 0 || dir === 1) { g.rect(3, 0, 2, 3, hn); g.rect(11, 0, 2, 3, hn); g.set(2, 0, hn); g.set(13, 0, hn); }
      else { g.rect(7, 0, 2, 3, hn); g.set(9, 0, hn); }
    } else if (!o.hatCol) { g.rect(7, 0, 2, 1, '#c03a3a'); g.set(7, 1, '#c03a3a'); }
  } else if (o.hat === 'wizard') {
    g.rect(3, 3, 10, 1, o.hatCol); g.rect(5, 2, 6, 1, o.hatCol); g.rect(6, 1, 4, 1, o.hatCol); g.rect(7, 0, 2, 1, o.hatCol);
    g.rect(5, 2, 6, 1, adj(o.hatCol, 0.8)); g.set(9, 2, '#e8c04a'); g.set(10, 2, '#e8c04a');
    g.set(10, -1, o.hatCol);
  } else if (o.hat === 'hood') {
    g.rect(4, 1, 8, 6, o.hatCol); g.rect(5, 0, 6, 1, o.hatCol);
    if (dir === 0) g.rect(6, 3, 4, 4, o.skin);
    if (dir === 3) g.rect(8, 3, 4, 4, o.skin);
    if (dir === 2) g.rect(4, 3, 4, 4, o.skin);
  } else if (o.hat === 'cap') {
    g.rect(5, 1, 6, 2, o.hatCol); g.rect(4, 3, 8, 1, o.hatCol);
  } else if (o.hat === 'crown') {
    const gd = o.hatCol || '#f0c040';
    g.rect(5, 1, 6, 2, gd); for (const x of [5, 7, 9, 10]) g.set(x, 0, gd);
    if (dir !== 1) g.set(8, 2, '#ff5a5a');
  } else if (o.hat === 'circlet') {
    g.rect(5, 2, 6, 1, o.hatCol || '#e8c04a');
    if (dir !== 1) g.set(8, 1, '#5fd3ff');
  }

  g.shade();

  // details painted after shading so they stay crisp
  const eye = o.eye || '#1a1a2a';
  if (dir === 0) { g.set(6, 5, eye); g.set(9, 5, eye); if (o.beard) { g.rect(6, 6, 4, 2, o.beard); g.set(7, 5, o.beard); g.set(8, 5, o.beard); g.rect(5, 5, 1, 2, o.beard); g.rect(10, 5, 1, 2, o.beard); } }
  if (dir === 3) { g.set(9, 5, eye); if (o.beard) g.rect(8, 6, 3, 2, o.beard); }
  if (dir === 2) { g.set(6, 5, eye); if (o.beard) g.rect(5, 6, 3, 2, o.beard); }
  if (o.ribs && !side) { for (const y of [8, 9]) g.rect(6, y, 4, 1, '#6a665a'); g.rect(7, 7, 2, 4, '#6a665a'); g.set(7, 8, o.tunic); g.set(8, 9, o.tunic); }
  if (o.sockets) { if (dir === 0) { g.rect(6, 4, 2, 2, '#1a1420'); g.rect(9, 4, 2, 2, '#1a1420'); g.set(7, 6, '#1a1420'); } if (dir === 3) g.rect(8, 4, 2, 2, '#1a1420'); if (dir === 2) g.rect(6, 4, 2, 2, '#1a1420'); }
  if (o.ears) {
    if (dir === 0 || dir === 1) { g.set(4, 4, o.skin); g.set(3, 3, o.skin); g.set(11, 4, o.skin); g.set(12, 3, o.skin); }
    else g.set(dir === 3 ? 4 : 11, 3, o.skin);
  }

  bodyDetail(g, o, side);

  // weapon & shield
  if (o.weapon) {
    const bx = dir === 0 ? 12 : dir === 1 ? 3 : dir === 3 ? 11 : 4;
    weapon(g, o.weapon, bx, o.blade || BLADE[0], dir === 1 || dir === 2);
  }
  if (o.shield && dir !== 1) {
    const sx = dir === 0 ? 2 : dir === 3 ? 5 : 8;
    if (dir === 0 || dir === 2 || dir === 3) {
      g.rect(sx, 7, 4, 5, o.shieldCol || '#5a6a8a'); g.rect(sx + 1, 8, 2, 3, '#c8a040'); g.rect(sx, 7, 4, 1, adj(o.shieldCol || '#5a6a8a', 1.35));
    }
  }
  if (o.offhand === 'tome' && dir !== 1) {
    const bx = dir === 0 ? 2 : dir === 3 ? 6 : 7;
    g.rect(bx, 8, 3, 4, o.offCol || '#8a3a3a'); g.rect(bx, 8, 1, 4, '#e8d8a0'); g.set(bx + 1, 9, '#e8c04a');
  }
  if (o.offhand === 'quiver') {
    const q = o.offCol || '#7a5230';
    if (dir === 1) { g.rect(9, 3, 2, 8, q); for (const x of [9, 10]) g.set(x, 2, '#e8e8e8'); }
    else if (dir === 0) { g.rect(11, 4, 1, 4, q); g.set(11, 3, '#e8e8e8'); }
    else { g.rect(5, 3, 2, 7, q); g.set(5, 2, '#e8e8e8'); g.set(6, 2, '#cc3a3a'); }
  }
  return g.outline().canvas(dir === 2);
}

const PRESET = {
  warrior: { hair: '#5a3a22', tunic: '#b03a3a', pants: '#4a4a5a', boots: '#5a3a22', belt: '#3a2a1a', hat: 'helm', weapon: 'sword', shield: true },
  mage: { hair: '#e8e0c8', tunic: '#6a3fb0', pants: '#3a2a5a', boots: '#3a2a1a', belt: '#e8c04a', hat: 'wizard', hatCol: '#5a2f9a', weapon: 'staff', robe: true },
  ranger: { hair: '#7a4a22', tunic: '#3f7a3f', pants: '#6a4a2a', boots: '#3a2a1a', belt: '#2a1a0a', hat: 'hood', hatCol: '#2f5f33', weapon: 'bow' },
  cleric: { hair: '#c8a060', tunic: '#f0f0e8', pants: '#c8b070', boots: '#7a5a2a', belt: '#f0d060', hat: 'cap', hatCol: '#f0d060', weapon: 'mace', robe: true },
  rogue: { hair: '#2a2a3a', tunic: '#3a3a4a', pants: '#2a2a34', boots: '#1a1a22', belt: '#8a2a2a', hat: 'hood', hatCol: '#2f2f3f', weapon: 'dagger' },
  warlock: { hair: '#3a1a3a', tunic: '#5a1f5a', pants: '#2a1030', boots: '#1a1020', belt: '#c060c0', hat: 'wizard', hatCol: '#3a1050', weapon: 'wand', robe: true },
  paladin: { hair: '#c8a060', tunic: '#d8d0a0', pants: '#8a94a8', boots: '#6a7a8a', belt: '#e8c04a', hat: 'helm', hatCol: '#d8d0a0', weapon: 'sword', shield: true, shieldCol: '#e8d88a' },
  druid: { hair: '#5a3a22', tunic: '#4f7a3f', pants: '#6a4a2a', boots: '#5a3a22', belt: '#8a6a3a', hat: 'hood', hatCol: '#4f8f4f', weapon: 'staff', robe: true },
  necromancer: { hair: '#c8d8d0', tunic: '#2f4a45', pants: '#1a2a28', boots: '#1a2020', belt: '#7aa89a', hat: 'hood', hatCol: '#2a3a3a', weapon: 'wand', robe: true },
  monk: { hair: '#2a1a12', tunic: '#c8782a', pants: '#e8e0d0', boots: '#e8e0d0', belt: '#7a2a1a', hat: 'none', weapon: 'mace' },
};
const NPC_LOOK = {
  elder: { skin: SKINS[0], hair: '#f2f2f2', tunic: '#3a6ab0', pants: '#2a4a80', boots: '#3a2a1a', belt: '#e8c04a', robe: true, beard: '#f2f2f2', weapon: 'staff', hat: 'none' },
  shop: { skin: SKINS[1], hair: '#6a3a1a', tunic: '#c0a060', pants: '#5a4a2a', boots: '#3a2a1a', belt: '#3a2a1a', apron: true, hat: 'cap', hatCol: '#a03030' },
  guard: { skin: SKINS[1], hair: '#3a2a1a', tunic: '#3a5a9a', pants: '#4a4a5a', boots: '#2a2a2a', belt: '#c8a040', hat: 'helm', weapon: 'spear', shield: false },
  scout: { skin: SKINS[2], hair: '#2a1a12', tunic: '#d8c090', pants: '#8a6a3a', boots: '#4a3a22', belt: '#a03030', hat: 'hood', hatCol: '#d8c090', weapon: 'bow' },
  warden: { skin: SKINS[0], hair: '#e8e0c8', tunic: '#3a5a9a', pants: '#2a3a6a', boots: '#2a2a2a', belt: '#c8c8d8', hat: 'helm', hatCol: '#8a94a8', weapon: 'spear', beard: '#e8e0c8' },
  forgemaster: { skin: SKINS[3], hair: '#2a1a12', tunic: '#6a3a2a', pants: '#3a2a22', boots: '#2a1a12', belt: '#3a2a22', apron: true, hat: 'cap', hatCol: '#3a2a2a', weapon: 'mace', beard: '#2a1a12' },
  mummy: { skin: '#d8d0b0', hair: '#d8d0b0', tunic: '#d8d0b0', sleeve: '#cfc8a8', pants: '#cfc8a8', boots: '#bdb690', belt: '#9a926a', hat: 'cap', hatCol: '#d8d0b0', eye: '#ff4a2a' },
  frostsprite: { skin: '#bfe8ff', hair: '#ffffff', tunic: '#6ab8ff', pants: '#4a98e0', boots: '#e8f8ff', belt: '#ffffff', robe: true, hat: 'none', eye: '#ffffff', weapon: 'wand', blade: '#8affff' },
  yeti: { skin: '#e8f0ff', hair: '#dfe8f5', tunic: '#dfe8f5', sleeve: '#dfe8f5', pants: '#c8d4e8', boots: '#aab8d0', belt: '#8a98b0', hat: 'none', eye: '#3aafff', ears: true },
  emberknight: { skin: '#6a2a1a', hair: '#2a1a1a', tunic: '#3a1a1a', pants: '#2a1a1a', boots: '#1a1010', belt: '#ff6a2a', hat: 'horns', hatCol: '#4a2a2a', eye: '#ff8a2a', weapon: 'sword', blade: '#ff6a2a', shield: true, shieldCol: '#2a1a1a', trim: '#ff6a2a' },
  goblin: { skin: '#6fae48', hair: '#4a7a30', tunic: '#7a5a30', pants: '#4a3a22', boots: '#2a1a0a', belt: '#2a1a0a', hat: 'none', weapon: 'dagger', ears: true, eye: '#ff3a3a' },
  ghoul: { skin: '#7a9a7a', hair: '#3a4a3a', tunic: '#4a4a5a', pants: '#2a2a3a', boots: '#2a2a2a', belt: '#2a2a2a', hat: 'none', eye: '#ffe83a', ears: true },
  wraith: { skin: '#a8c4ff', hair: '#a8c4ff', tunic: '#3a4a9a', pants: '#2a3a7a', boots: '#2a3a7a', belt: '#6a8aff', robe: true, hat: 'hood', hatCol: '#2a3a7a', eye: '#8affff', weapon: 'staff', blade: '#8affff' },
  skeleton: { skin: '#e6e2cc', hair: '#e6e2cc', tunic: '#d9d5bf', sleeve: '#e6e2cc', pants: '#cfcbb5', boots: '#bdb9a3', belt: '#8a8672', hat: 'none', weapon: 'bow', ribs: true, sockets: true, blade: '#bba' },
};

const cache = new Map();
const memo = (k, f) => { let v = cache.get(k); if (!v) { v = f(); cache.set(k, v); } return v; };


// ------------------------------------------------------------------ player characters: appearance + worn gear
const HERO_BODY = { robe: { robe: true }, tunic: {}, vest: { bk: 'leather' }, mail: { bk: 'mail' }, plate: { bk: 'plate' } };
const HERO_HAT = { cap: 'cap', hood: 'hood', helm: 'helm', crown: 'crown', horns: 'horns', circlet: 'circlet', wizhat: 'wizard' };
function heroOptions(lk, vs) {
  const tok = (i) => { const [b, cl, r] = (vs[i] || '').split('~'); return b ? { b, cl: cl || defaultColor(b), r: Number(r) || 0 } : null; };
  const head = tok(0), body = tok(1), legs = tok(2), boots = tok(3), gloves = tok(4), cape = tok(5), off = tok(6), wep = tok(7);
  const o = {
    skin: SKIN_TONES[lk[0]] || SKIN_TONES[1], hs: HAIR_STYLES[lk[1]] || 'short', hair: HAIR_COLORS[lk[2]] || HAIR_COLORS[1], eye: EYE_COLORS[lk[3]] || EYE_COLORS[0],
    tunic: body ? body.cl : '#d8d0c0', pants: legs ? legs.cl : '#6a5a4a', boots: boots ? boots.cl : '#4a3a2a', belt: '#3a2a1a', hat: 'none',
    weapon: wep ? wep.b : null, blade: BLADE[wep ? wep.r : 0],
  };
  if (body) Object.assign(o, HERO_BODY[body.b] || {});
  if (body && body.b === 'plate') o.sleeve = adj(body.cl, 1.15);
  if (head) { o.hat = HERO_HAT[head.b] || 'cap'; o.hatCol = head.cl; }
  if (gloves) o.gloves = gloves.cl;
  if (cape) o.cape = cape.cl;
  if (off) { if (off.b === 'shield') { o.shield = true; o.shieldCol = off.cl; } else o.offhand = off.b; o.offCol = off.cl; }
  const rmax = Math.max(body ? body.r : 0, head ? head.r : 0, legs ? legs.r : 0, boots ? boots.r : 0);
  if (rmax >= 2) o.trim = RARITY_COL[rmax];
  return o;
}
/** lk = [skin, hairStyle, hairColour, eyes], vs = worn-gear tokens "kind~dye~rarity" in VIS_ORDER */
export function heroSprite(lk, vs, dir, fr) {
  return memo(`h${lk.join('')}|${vs.join(',')}|${dir}${fr}`, () => humanoid(heroOptions(lk, vs), dir, fr));
}

export function playerSprite(cls, skin, dir, fr, wb = '', wr = 0, ar = -1) {
  return memo(`p${cls}${skin}${dir}${fr}${wb}${wr}${ar}`, () => {
    const o = { ...PRESET[cls], skin: SKINS[skin % SKINS.length], blade: BLADE[wr] };
    if (wb) o.weapon = wb === 'armor' ? o.weapon : wb;
    if (ar > 0) o.trim = RARITY_COL[ar];
    return humanoid(o, dir, fr);
  });
}
export function npcSprite(key, dir, fr = 0) {
  return memo(`n${key}${dir}${fr}`, () => humanoid({ ...NPC_LOOK[key] }, dir, fr));
}

// ------------------------------------------------------------------ monsters
function slime(fr, p = {}) {
  const body = p.body || '#5fd35f', hi = p.hi || '#c8ffc8', mouth = p.mouth || '#2f8a2f', eye = p.eye || '#1a1a2a';
  const g = new Grid(16, 16);
  if (fr) g.ell(8, 11, 7, 3.6, body); else g.ell(8, 10, 6, 4.6, body);
  g.shade();
  g.set(5, fr ? 9 : 7, hi); g.set(6, fr ? 9 : 7, hi);
  const ey = fr ? 10 : 9;
  g.rect(5, ey, 2, 2, '#fff'); g.rect(9, ey, 2, 2, '#fff'); g.set(6, ey + 1, eye); g.set(10, ey + 1, eye);
  g.rect(7, ey + 3, 2, 1, mouth);
  return g.outline().canvas();
}
function bat(fr, p = {}) {
  const w = p.w || '#5a3f7a', bd = p.body || '#3a2a55', eye = p.eye || '#ff4a4a';
  const g = new Grid(16, 16);
  for (let i = 1; i <= 6; i++) {
    const y = Math.round(8 + (fr ? i * 0.55 : -i * 0.7));
    g.rect(8 - i - 1, y - 1, 1, 3, w); g.rect(8 + i, y - 1, 1, 3, w);
  }
  g.rect(6, 8, 4, 2, w);
  g.ell(8, 8, 2.2, 3, bd); g.ell(8, 5.5, 2.2, 2, bd);
  g.set(6, 3, bd); g.set(10, 3, bd);
  g.shade();
  g.set(7, 5, eye); g.set(9, 5, eye); g.set(7, 7, '#fff'); g.set(9, 7, '#fff');
  return g.outline().canvas();
}
function wolf(fr, p = {}) {
  const c = p.c || '#8a8f99', d = p.d || '#6a6f79', l = p.l || '#c0c4cc', eye = p.eye || '#ffd23a';
  const g = new Grid(16, 16);
  g.rect(0, 5, 3, 2, c); g.set(0, 4, c);
  g.ell(7.5, 8.5, 5.6, 3, c);
  g.rect(4, 10, 7, 1, l);
  for (const [x, long] of [[3, fr === 0], [5, fr === 1], [9, fr === 1], [11, fr === 0]]) g.rect(x, 10, 1, long ? 4 : 3, d);
  g.ell(12, 6.5, 3, 2.5, c);
  g.rect(13, 7, 3, 2, l);
  g.set(11, 3, d); g.set(11, 4, c); g.set(13, 3, d); g.set(13, 4, c);
  g.shade();
  g.set(13, 6, eye); g.set(15, 7, '#16121f'); g.set(14, 9, '#fff'); g.set(8, 7, d); g.set(6, 7, d);
  return g.outline().canvas();
}
function golem(fr, p = {}) {
  const tex = p.tex || ['#8a8a92', '#7c7c86', '#9a9aa4', '#6e6e78', '#8a8a92'], eye = p.eye || '#ffb030', rune = p.rune || '#ff8a20';
  const moss = p.moss === undefined ? '#4f8a3f' : p.moss;
  const g = new Grid(32, 32);
  const up = fr ? 2 : 0;
  g.rect(9, 23, 6, 7, '#7a7a82'); g.rect(17, 23, 6, 7, '#7a7a82');
  g.rect(7, 9, 18, 15, '#8a8a92');
  g.rect(2, 9 - up, 6, 6, '#8a8a92'); g.rect(3, 15 - up, 4, 8, '#7a7a82'); g.rect(1, 22 - up, 7, 5, '#8a8a92');
  g.rect(24, 9 - up, 6, 6, '#8a8a92'); g.rect(25, 15 - up, 4, 8, '#7a7a82'); g.rect(24, 22 - up, 7, 5, '#8a8a92');
  g.rect(11, 2, 10, 8, '#9a9aa2');
  g.tex(tex, 5);
  if (moss) for (let i = 0; i < 26; i++) { const x = Math.floor(hash2(i, 1, 9) * 30) + 1, y = Math.floor(hash2(i, 2, 9) * 28) + 1; if (g.get(x, y)) g.set(x, y, moss); }
  g.shade();
  g.rect(13, 5, 2, 2, eye); g.rect(17, 5, 2, 2, eye); g.set(13, 5, '#fff2a0'); g.set(17, 5, '#fff2a0');
  g.rect(15, 12, 2, 7, rune); g.rect(13, 14, 6, 1, rune); g.rect(15, 12, 2, 1, '#fff2a0');
  g.line(20, 11, 23, 16, '#3a3a44'); g.line(10, 18, 8, 22, '#3a3a44');
  return g.outline().canvas();
}
function scarab(fr) {
  const g = new Grid(16, 16), body = '#2a6a6a', gold = '#d8b040';
  g.ell(8, 9, 4.8, 3.6, body); g.ell(8, 7, 2.6, 2, gold); g.rect(7, 5, 2, 1, gold);
  for (const x of [3, 5, 10, 12]) g.rect(x, 12 + ((x + fr) % 2), 1, 2, '#1a3a3a');
  g.set(6, 4, '#1a3a3a'); g.set(10, 4, '#1a3a3a');
  g.shade();
  g.set(7, 6, '#fff'); g.set(9, 6, '#fff'); g.line(8, 7, 8, 12, '#14403f');
  return g.outline().canvas();
}
function scorpion(fr) { // faces right
  const g = new Grid(16, 16), b = '#8a5a2a', d = '#a06a30';
  g.ell(7, 10, 4.6, 2.8, b); g.ell(11, 10, 2, 2, b);
  g.rect(13, 7 + fr, 3, 2, d); g.rect(13, 12 - fr, 3, 2, d); g.set(15, 7 + fr, b); g.set(15, 13 - fr, b);
  for (const [x, y] of [[2, 9], [1, 7], [1, 5], [2, 3], [4, 2], [6, 2], [8, 3]]) g.rect(x, y + (fr ? 0 : 1), 2, 2, b);
  for (const x of [4, 6, 8, 10]) g.rect(x, 12 + ((x + fr) % 2), 1, 2, '#5a3a18');
  g.shade();
  g.set(9, 4 + (fr ? 0 : 1), '#ffd23a'); g.set(12, 9, '#ff4a2a');
  return g.outline().canvas();
}
function viper(fr) { // faces right
  const g = new Grid(16, 16);
  for (let i = 0; i < 12; i++) g.rect(2 + i, 9 + Math.round(Math.sin(i / 1.5 + fr * 1.6) * 2), 2, 2, i % 3 ? '#9ab040' : '#7a9030');
  g.ell(14, 8, 2.2, 1.8, '#9ab040');
  g.shade();
  g.set(14, 7, '#ffe040'); g.set(15, 9, '#ff3a3a');
  return g.outline().canvas();
}
function elemental(fr) {
  const g = new Grid(16, 16);
  g.ell(8, 10, 5, 5, '#ff6a1a'); g.ell(8, 9, 3.6, 4.2, '#ffa030'); g.ell(8, 9, 2, 2.6, '#ffe060');
  for (const [x, y] of fr ? [[5, 3], [8, 1], [11, 4]] : [[4, 4], [8, 2], [12, 3]]) { g.rect(x, y, 2, 4, '#ff8a2a'); g.set(x, y, '#ffd040'); }
  g.set(6, 9, '#7a1a0a'); g.set(10, 9, '#7a1a0a'); g.rect(7, 12, 2, 1, '#7a1a0a');
  return g.outline('#5a1a0a').canvas();
}
function kingMummy(fr) {
  const g = new Grid(32, 32), wrap = '#d8d0b0', up = fr ? 1 : 0;
  g.rect(8, 12, 16, 18, wrap); g.rect(6, 22, 20, 8, wrap);
  g.rect(4, 13 - up, 4, 10, wrap); g.rect(24, 13 - up, 4, 10, wrap);
  g.rect(11, 3, 10, 9, wrap);
  g.rect(12, 4, 8, 7, '#e8c040');
  g.rect(9, 3, 2, 9, '#2a6aff'); g.rect(21, 3, 2, 9, '#2a6aff'); g.rect(10, 2, 12, 2, '#e8c040');
  g.rect(29, 2, 1, 28, '#6a4a2a'); g.rect(27, 0, 4, 4, '#ffd23a');
  g.shade();
  for (let y = 13; y < 30; y += 2) g.rect(9, y, 14, 1, '#b8b090');
  g.rect(13, 6, 2, 2, '#2a6aff'); g.rect(17, 6, 2, 2, '#2a6aff'); g.rect(15, 9, 2, 1, '#a07020');
  g.rect(14, 19, 4, 4, '#ffd23a'); g.rect(15, 20, 2, 2, '#fff8c0');
  if (fr) { g.set(28, 1, '#fff'); g.set(30, 3, '#fff'); }
  return g.outline().canvas();
}
function dragon(fr, p) {
  const g = new Grid(32, 32), up = fr ? 2 : 0;
  for (let r = 0; r < 12; r++) { const w = Math.round(10 - r * 0.8); g.rect(9 - w, 4 + r + up, w, 1, p.wing); g.rect(23, 4 + r + up, w, 1, p.wing); }
  g.ell(16, 19, 7, 9, p.body);
  g.ell(16, 7, 5.2, 4.2, p.body); g.rect(13, 9, 6, 4, p.body);
  g.rect(12, 1, 2, 5, p.horn); g.rect(18, 1, 2, 5, p.horn); g.set(11, 1, p.horn); g.set(20, 1, p.horn);
  g.rect(13, 14, 6, 11, p.belly);
  g.rect(10, 26, 4, 5, p.body); g.rect(18, 26, 4, 5, p.body); g.rect(22, 27, 7, 2, p.body);
  g.shade();
  for (let y = 15; y < 25; y += 2) g.rect(14, y, 4, 1, adj(p.belly, 0.8));
  g.rect(12, 6, 2, 2, p.eye); g.rect(18, 6, 2, 2, p.eye); g.set(14, 11, '#16121f'); g.set(17, 11, '#16121f');
  g.rect(14, 12, 4, 1, '#fff');
  return g.outline().canvas();
}

const SAND_TEX = ['#c8a868', '#b89858', '#d8b878', '#a88848', '#c8a868'];
const ICE_TEX = ['#bfe0f0', '#a8d0e8', '#d8f0ff', '#8ab8d8', '#bfe0f0'];
const OBS_TEX = ['#2a2a3a', '#1a1a28', '#3a3a4a', '#4a2a5a', '#2a2a3a'];
// every creature: [painter, palette]
const MOB_ART = {
  slime: ['slime', {}], frostslime: ['slime', { body: '#8fd8ff', hi: '#e8ffff', mouth: '#4a9ac8' }], magmaslime: ['slime', { body: '#ff6a2a', hi: '#ffe0a0', mouth: '#b02a0a', eye: '#ffe040' }],
  bat: ['bat', {}], frostowl: ['bat', { w: '#dfe8f5', body: '#aab8d0', eye: '#3aafff' }], imp: ['bat', { w: '#c03a2a', body: '#8a1a1a', eye: '#ffe040' }],
  wolf: ['wolf', {}], snowwolf: ['wolf', { c: '#e8eef5', d: '#b0bccc', l: '#ffffff', eye: '#3aafff' }], lavahound: ['wolf', { c: '#5a2a2a', d: '#3a1a1a', l: '#ff8a2a', eye: '#ff4a1a' }],
  golem: ['golem', {}], sandgolem: ['golem', { tex: SAND_TEX, eye: '#ff4a2a', rune: '#ffd23a', moss: null }],
  icegolem: ['golem', { tex: ICE_TEX, eye: '#3aafff', rune: '#8affff', moss: null }], obsidiangolem: ['golem', { tex: OBS_TEX, eye: '#ff6a1a', rune: '#ff4a1a', moss: null }],
  scarab: ['scarab', {}], scorpion: ['scorpion', {}], sandviper: ['viper', {}], fireelem: ['elemental', {}], sunking: ['kingmummy', {}], bonelord: ['bonelord', {}],
  glacius: ['bonelord', { tint: 'rgba(90,170,255,0.55)' }],
  rimefang: ['dragon', { body: '#7ab8e8', belly: '#d8f0ff', wing: '#4a88c8', eye: '#ffffff', horn: '#e8f4ff' }],
  cinderwing: ['dragon', { body: '#b02a1a', belly: '#ff8a2a', wing: '#6a1a1a', eye: '#ffe040', horn: '#2a1a1a' }],
};
const PAINT = { slime, bat, wolf, golem, scarab, scorpion, viper, elemental, kingmummy: kingMummy, dragon, bonelord };
const HUMANOID_MOB = new Set(['goblin', 'skeleton', 'ghoul', 'wraith', 'mummy', 'frostsprite', 'yeti', 'emberknight']);
/** creatures drawn facing right that mirror when they face left */
export const SIDE_MOBS = new Set(['wolf', 'snowwolf', 'lavahound', 'scorpion', 'sandviper']);

function bonelord(fr) {
  const g = new Grid(32, 32);
  const up = fr ? 1 : 0;
  g.rect(8, 13, 16, 17, '#3a2a5a'); g.rect(6, 22, 20, 8, '#3a2a5a'); g.rect(9, 26, 14, 4, '#2a1c44'); // robe
  g.rect(11, 13, 10, 8, '#e6e2cc'); // ribcage
  g.rect(4, 13 - up, 3, 10, '#d9d5bf'); g.rect(25, 13 - up, 3, 10, '#d9d5bf'); g.rect(3, 22 - up, 5, 3, '#e6e2cc'); g.rect(24, 22 - up, 5, 3, '#e6e2cc'); // arms
  g.rect(11, 3, 10, 9, '#e6e2cc'); g.rect(12, 11, 8, 3, '#d9d5bf'); // skull + jaw
  for (const x of [11, 14, 17, 20]) g.rect(x, 0, 2, 3, '#f0c040'); g.rect(11, 3, 10, 1, '#f0c040'); // crown
  g.rect(29, 2, 1, 28, '#6a4a2a'); g.rect(27, 0, 4, 4, '#6aff8a'); // staff + orb
  g.shade();
  g.rect(13, 6, 2, 2, '#6aff8a'); g.rect(17, 6, 2, 2, '#6aff8a'); g.set(13, 6, '#e8ffe8'); g.set(17, 6, '#e8ffe8');
  g.rect(15, 9, 2, 2, '#2a1c44');
  for (const y of [14, 16, 18]) g.rect(12, y, 8, 1, '#8a866e');
  g.rect(15, 13, 2, 8, '#8a866e');
  g.rect(14, 22, 4, 4, '#6aff8a'); g.rect(15, 23, 2, 2, '#e8ffe8'); // soul gem
  if (fr) { g.set(28, 1, '#fff'); g.set(30, 3, '#fff'); }
  return g.outline().canvas();
}

export function mobSprite(type, dir, fr) {
  const f2 = fr & 1;
  if (HUMANOID_MOB.has(type)) {
    return memo(`m${type}${dir}${fr}`, () => {
      const c = humanoid({ ...NPC_LOOK[type] }, dir, fr);
      if (type !== 'wraith') return c;
      const n = mkCanvas(16, 16), x = n.getContext('2d');
      x.globalAlpha = 0.8; x.drawImage(c, 0, 0); return n;
    });
  }
  const art = MOB_ART[type] || MOB_ART.slime;
  const flip = SIDE_MOBS.has(type) && dir === 2;
  return memo(`m${type}${f2}${flip}`, () => {
    let c = PAINT[art[0]](f2, art[1]);
    if (art[1] && art[1].tint) c = tintCanvas(c, art[1].tint);
    if (!flip) return c;
    const n = mkCanvas(c.width, c.height), x = n.getContext('2d');
    x.scale(-1, 1); x.drawImage(c, -c.width, 0);
    return n;
  });
}

// ------------------------------------------------------------------ item icons
export function itemIcon(base, r = 0, cl = '') {
  return memo(`i${base}${r}${cl}`, () => {
    const g = new Grid(16, 16);
    const b = BLADE[r], gem = cl || RARITY_COL[r];
    const c = cl || defaultColor(base), cd = adj(c, 0.72), cl2 = adj(c, 1.3);
    switch (base) {
      case 'sword':
        g.line(3, 12, 12, 3, b); g.line(4, 12, 12, 4, adj(b, 0.8)); g.set(13, 2, adj(b, 1.4));
        g.line(3, 9, 6, 12, '#c8a040'); g.line(2, 13, 4, 11, WOOD); g.set(1, 14, '#c8a040'); break;
      case 'axe':
        g.line(3, 13, 11, 5, WOOD); g.line(4, 13, 12, 5, adj(WOOD, 0.8));
        g.rect(9, 2, 4, 5, b); g.rect(13, 3, 1, 3, adj(b, 1.3)); g.rect(9, 2, 4, 1, adj(b, 1.3)); break;
      case 'mace':
        g.line(3, 13, 10, 6, WOOD); g.line(4, 13, 10, 7, adj(WOOD, 0.8)); g.ell(11, 5, 3, 3, b); g.set(11, 1, b); g.set(14, 5, b); g.set(8, 5, b); break;
      case 'staff':
        g.line(3, 14, 11, 6, WOOD); g.line(4, 14, 12, 6, adj(WOOD, 0.8)); g.ell(12, 4, 2.2, 2.2, gem); g.set(11, 3, '#fff'); break;
      case 'dagger':
        g.line(3, 13, 11, 5, b); g.line(4, 13, 12, 5, adj(b, 0.8)); g.rect(2, 10, 4, 2, '#c8a040'); g.set(2, 14, WOOD); break;
      case 'wand':
        g.line(3, 14, 12, 5, WOOD); g.line(4, 14, 13, 5, adj(WOOD, 0.8)); g.ell(13, 4, 2.2, 2.2, gem); g.set(12, 3, '#fff'); break;
      case 'bow':
        for (let i = 0; i <= 10; i++) { const x = 4 + Math.round(6 * Math.sin((i / 10) * Math.PI)); g.set(x, 2 + i, WOOD); g.set(x + 1, 2 + i, adj(WOOD, 0.8)); }
        g.line(4, 2, 4, 12, '#ece6d0'); break;
      case 'armor':
        g.rect(4, 3, 8, 10, '#8a94a8'); g.rect(2, 3, 3, 4, '#a8b2c6'); g.rect(11, 3, 3, 4, '#a8b2c6'); g.rect(6, 3, 4, 2, '#16121f');
        g.rect(7, 7, 2, 4, gem); g.rect(4, 12, 8, 1, '#c8a040'); break;
      case 'ring':
        g.ell(8, 9, 4.5, 4.5, '#e8c04a'); g.ell(8, 9, 2.4, 2.4, null); g.ell(8, 4, 2, 2, gem); g.set(7, 3, '#fff'); break;
      case 'amulet':
        g.line(4, 2, 8, 8, '#c8a040'); g.line(12, 2, 8, 8, '#c8a040'); g.ell(8, 10, 3.2, 3.5, '#e8c04a'); g.ell(8, 10, 1.6, 1.8, gem); break;
      case 'charm':
        g.rect(7, 1, 2, 3, '#c8a040'); g.ell(8, 9, 4, 5, gem); g.set(6, 7, '#fff'); g.set(7, 6, adj(gem, 1.5)); break;
      case 'potion': {
        const liq = r ? '#e04a8a' : '#e03a3a';
        g.rect(6, 1, 4, 2, '#b08a5a'); g.rect(7, 3, 2, 2, '#d8f0ff'); g.ell(8, 10, 5, 4.4, '#d8f0ff'); g.ell(8, 11, 4, 3.4, liq);
        g.set(6, 9, adj(liq, 1.5)); g.set(5, 8, '#fff'); break;
      }
      case 'cap': g.rect(4, 6, 8, 4, c); g.rect(2, 9, 12, 2, cd); g.rect(5, 7, 2, 1, cl2); break;
      case 'hood': g.ell(8, 8, 6, 6, c); g.ell(8, 10, 3, 3, null); g.rect(6, 4, 4, 1, cl2); break;
      case 'helm': g.ell(8, 8, 5, 5, c); g.rect(3, 9, 10, 5, c); g.rect(5, 10, 6, 2, '#16121f'); g.rect(7, 2, 2, 3, '#c03a3a'); break;
      case 'crown': g.rect(3, 8, 10, 5, c); for (const x of [3, 6, 9, 12]) g.rect(x, 5, 1, 3, c); g.rect(7, 10, 2, 2, '#ff5a5a'); break;
      case 'horns': g.ell(8, 9, 4.5, 4.5, c); g.rect(4, 12, 8, 2, c); g.rect(2, 2, 2, 6, '#e8e0d0'); g.rect(12, 2, 2, 6, '#e8e0d0'); break;
      case 'circlet': g.ell(8, 9, 6, 3.5, c); g.ell(8, 9, 4, 2, null); g.rect(7, 5, 2, 2, '#5fd3ff'); break;
      case 'wizhat': g.rect(7, 1, 2, 2, c); g.rect(6, 3, 4, 2, c); g.rect(5, 5, 6, 3, c); g.rect(2, 8, 12, 2, cd); g.rect(5, 7, 6, 1, '#e8c04a'); break;
      case 'robe': g.rect(5, 2, 6, 12, c); g.rect(3, 3, 3, 7, cd); g.rect(10, 3, 3, 7, cd); g.rect(5, 8, 6, 1, '#e8c04a'); break;
      case 'tunic': g.rect(4, 3, 8, 9, c); g.rect(2, 3, 2, 5, cd); g.rect(12, 3, 2, 5, cd); g.rect(6, 3, 4, 1, cl2); break;
      case 'vest': g.rect(4, 3, 8, 9, c); g.rect(7, 4, 2, 8, '#2a1a10'); g.rect(2, 3, 2, 4, cd); g.rect(12, 3, 2, 4, cd); break;
      case 'mail': g.rect(4, 3, 8, 9, c); for (let y = 3; y < 12; y++) for (let x = 4; x < 12; x++) if ((x + y) % 2) g.set(x, y, cl2); g.rect(2, 3, 2, 5, c); g.rect(12, 3, 2, 5, c); break;
      case 'plate': g.rect(4, 3, 8, 9, c); g.rect(2, 3, 3, 3, cl2); g.rect(11, 3, 3, 3, cl2); g.rect(7, 4, 2, 6, cl2); g.rect(4, 11, 8, 1, cd); break;
      case 'pants': g.rect(5, 3, 6, 3, c); g.rect(5, 6, 2, 8, c); g.rect(9, 6, 2, 8, c); g.rect(5, 3, 6, 1, cl2); break;
      case 'leggings': g.rect(5, 3, 6, 2, c); g.rect(5, 5, 2, 9, c); g.rect(9, 5, 2, 9, c); g.rect(6, 6, 1, 6, cl2); break;
      case 'greaves': g.rect(5, 3, 6, 3, c); g.rect(5, 6, 2, 8, c); g.rect(9, 6, 2, 8, c); g.rect(5, 8, 2, 2, cl2); g.rect(9, 8, 2, 2, cl2); break;
      case 'boots': g.rect(5, 3, 4, 8, c); g.rect(5, 9, 8, 4, c); g.rect(5, 13, 8, 1, cd); g.rect(5, 3, 4, 1, cl2); break;
      case 'shoes': g.rect(5, 6, 4, 5, c); g.rect(5, 9, 8, 3, c); g.rect(5, 12, 8, 1, cd); break;
      case 'sabatons': g.rect(5, 3, 4, 8, c); g.rect(5, 9, 9, 4, c); g.rect(13, 10, 2, 2, cl2); g.rect(5, 6, 4, 2, cl2); break;
      case 'gloves': g.rect(5, 7, 6, 6, c); for (const x of [5, 7, 9]) g.rect(x, 3, 2, 5, c); g.rect(11, 8, 2, 3, c); g.rect(5, 12, 6, 2, cd); break;
      case 'gauntlets': g.rect(5, 7, 6, 5, c); for (const x of [5, 7, 9]) g.rect(x, 3, 2, 5, c); g.rect(11, 8, 2, 3, c); g.rect(4, 11, 8, 3, cl2); break;
      case 'wraps': g.rect(5, 7, 6, 6, '#e8e0d0'); for (const x of [5, 7, 9]) g.rect(x, 3, 2, 5, '#e8e0d0'); g.rect(5, 9, 6, 1, c); g.rect(5, 12, 6, 1, c); break;
      case 'cape': g.rect(4, 2, 8, 2, cd); g.rect(3, 4, 10, 8, c); g.rect(4, 12, 2, 2, c); g.rect(10, 12, 2, 2, c); g.rect(7, 4, 2, 7, cd); break;
      case 'cloak': g.ell(8, 4, 4.5, 3, cd); g.rect(3, 5, 10, 9, c); g.rect(7, 5, 2, 9, cd); break;
      case 'mantle': g.rect(3, 4, 10, 9, c); g.rect(3, 2, 10, 3, '#e8e0d0'); g.rect(5, 12, 6, 2, cd); break;
      case 'shield': g.rect(4, 2, 8, 8, c); g.rect(5, 10, 6, 2, c); g.rect(7, 12, 2, 2, c); g.rect(7, 4, 2, 6, '#e8c04a'); g.rect(5, 6, 6, 1, '#e8c04a'); break;
      case 'tome': g.rect(4, 3, 8, 10, c); g.rect(4, 3, 2, 10, cd); g.rect(12, 4, 1, 8, '#e8d8a0'); g.rect(7, 6, 3, 3, '#e8c04a'); break;
      case 'quiver': g.rect(6, 5, 4, 9, c); g.rect(6, 5, 4, 1, cd); for (const [x, col] of [[6, '#cc3a3a'], [8, '#e8e8e8'], [10, '#cc3a3a']]) { g.rect(x, 1, 1, 4, '#8a6a3a'); g.rect(x, 1, 1, 2, col); } break;
      case 'gold':
        g.ell(8, 10, 5, 3.2, '#c8901a'); g.ell(8, 9, 5, 3.2, '#ffd23a'); g.ell(8, 9, 3, 1.8, '#e8b020'); g.set(6, 8, '#fff2a0'); break;
      default: g.rect(5, 5, 6, 6, '#888');
    }
    return g.shade().outline().canvas();
  });
}

export const classPortrait = (cls) => playerSprite(cls, 0, 0, 0);

/** 16x16 skill icon built from the (glyph, colour) pair in the shared skill table */
export function skillIcon(id) {
  return memo(`sk${id}`, () => {
    const [glyph, col] = SKILLS[id].ic;
    const g = new Grid(16, 16), d = adj(col, 0.7), l = adj(col, 1.45);
    const ring = (cx, cy, r, c, step = 0.35) => { for (let a = 0; a < 6.283; a += step) g.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, c); };
    switch (glyph) {
      case 'slash': for (let a = -2.7; a <= -0.4; a += 0.1) { g.rect(8 + Math.cos(a) * 6.5, 10 + Math.sin(a) * 6.5, 2, 2, col); g.set(8 + Math.cos(a) * 4.5, 10 + Math.sin(a) * 4.5, d); } g.line(3, 13, 13, 13, '#c03a3a'); break;
      case 'shield': g.rect(4, 3, 8, 8, col); g.rect(6, 11, 4, 2, col); g.rect(7, 5, 2, 5, l); g.rect(5, 6, 6, 1, l); break;
      case 'horn': g.rect(3, 6, 4, 4, col); g.line(7, 6, 12, 2, col); g.line(7, 9, 12, 13, col); g.rect(11, 3, 2, 10, d); g.set(14, 5, '#ff6a6a'); g.set(14, 10, '#ff6a6a'); break;
      case 'eye': g.ell(8, 8, 6.5, 3.5, '#fff'); g.ell(8, 8, 3, 3, col); g.set(8, 8, '#16121f'); g.set(7, 7, '#fff'); break;
      case 'spin': ring(8, 8, 6, col, 0.25); ring(8, 8, 3, d, 0.5); g.rect(12, 2, 3, 3, l); break;
      case 'flame': g.ell(8, 10, 4.5, 5, col); g.ell(8, 11, 2.5, 3, l); g.set(8, 2, col); g.set(8, 3, col); g.set(7, 4, col); g.set(9, 4, col); g.set(7, 5, col); break;
      case 'snow': for (let a = 0; a < 6.283; a += 1.047) g.line(8, 8, 8 + Math.cos(a) * 6.5, 8 + Math.sin(a) * 6.5, col); g.ell(8, 8, 1.6, 1.6, l); break;
      case 'star': g.rect(7, 1, 2, 14, col); g.rect(1, 7, 14, 2, col); g.line(3, 3, 13, 13, d); g.line(13, 3, 3, 13, d); g.ell(8, 8, 2, 2, l); break;
      case 'bolt': g.line(10, 1, 5, 8, col); g.line(5, 8, 11, 8, col); g.line(11, 8, 6, 15, col); g.line(11, 1, 6, 8, l); break;
      case 'meteor': g.ell(10, 6, 4.2, 4.2, col); g.ell(10, 6, 2, 2, l); g.line(1, 15, 7, 9, d); g.line(1, 12, 5, 8, col); g.line(4, 15, 8, 11, col); break;
      case 'arrow': g.line(2, 14, 12, 4, '#8a6a3a'); g.rect(11, 2, 4, 3, col); g.line(1, 11, 4, 14, '#cc3a3a'); g.line(2, 12, 2, 15, '#cc3a3a'); break;
      case 'arrows': for (const y of [3, 8, 13]) { g.line(1, 8, 13, y, '#8a6a3a'); g.rect(12, y - 1, 3, 2, col); } break;
      case 'boot': g.rect(4, 4, 5, 7, col); g.rect(4, 11, 9, 3, d); g.rect(8, 8, 5, 3, col); g.line(0, 5, 3, 5, '#e8e8f0'); g.line(0, 8, 3, 8, '#e8e8f0'); break;
      case 'web': for (let a = 0; a < 6.283; a += 0.785) g.line(8, 8, 8 + Math.cos(a) * 7, 8 + Math.sin(a) * 7, d); ring(8, 8, 5, col); ring(8, 8, 2.5, col); break;
      case 'drop': g.ell(8, 10, 4.5, 4.8, col); g.set(8, 2, col); g.set(8, 3, col); g.rect(7, 4, 2, 2, col); g.set(6, 8, l); g.set(6, 9, l); break;
      case 'sun': g.ell(8, 8, 3.2, 3.2, col); for (let a = 0; a < 6.283; a += 0.785) g.line(8 + Math.cos(a) * 5, 8 + Math.sin(a) * 5, 8 + Math.cos(a) * 7.5, 8 + Math.sin(a) * 7.5, l); break;
      case 'cross': g.rect(6, 2, 4, 12, col); g.rect(2, 6, 12, 4, col); g.rect(7, 4, 2, 8, l); g.rect(4, 7, 8, 2, l); break;
      case 'dagger': g.line(3, 13, 12, 4, col); g.line(4, 13, 12, 5, d); g.line(2, 10, 6, 14, '#c8a040'); g.set(13, 3, l); break;
      case 'bomb': g.ell(8, 10, 5, 5, col); g.rect(8, 3, 2, 3, '#8a6a3a'); g.set(10, 2, '#ffd23a'); g.set(11, 1, '#ff8a2a'); g.set(6, 8, l); break;
      case 'skull': g.ell(8, 7, 5, 5, col); g.rect(5, 11, 6, 3, col); g.rect(5, 6, 2, 2, '#16121f'); g.rect(9, 6, 2, 2, '#16121f'); g.rect(7, 12, 1, 2, '#16121f'); g.rect(9, 12, 1, 2, '#16121f'); break;
      case 'orb': g.ell(8, 8, 5.5, 5.5, col); g.ell(6, 6, 2, 2, l); g.ell(10, 10, 2.5, 2.5, d); break;
      default: g.rect(4, 4, 8, 8, col);
    }
    return g.shade().outline().canvas();
  });
}
