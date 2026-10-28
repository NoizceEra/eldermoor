// Procedural pixel art. Every sprite is built pixel-by-pixel on a small grid, given a
// two-tone bevel shade and a 1px dark outline, then cached as a canvas.
import { hash2 } from '/shared/world.js';

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** f<1 darkens, f>1 lightens toward white */
export const adj = (h, f) => {
  const [r, g, b] = hex(h);
  return f < 1 ? toHex([r * f, g * f, b * f]) : toHex([r + (255 - r) * (f - 1), g + (255 - g) * (f - 1), b + (255 - b) * (f - 1)]);
};
export const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

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
/** dir: 0 down, 1 up, 2 left, 3 right; fr: 0..3 walk cycle */
function humanoid(o, dir, fr) {
  const g = new Grid(16, 16);
  const stride = fr === 1 || fr === 3;
  const side = dir >= 2;
  const pants = o.pants, boots = o.boots;
  const tunic = o.tunic;

  if (!side) {
    const leg = (x, raised) => { const yb = raised ? 13 : 14; g.rect(x, 11, 2, yb - 11, pants); g.rect(x, yb, 2, 1, boots); };
    leg(6, fr === 1); leg(8, fr === 3);
    g.rect(5, 7, 6, 4, tunic);
    if (o.robe) { g.rect(5, 11, 6, 2, tunic); g.rect(4, 12, 8, 2, tunic); }
    g.rect(5, 10, 6, 1, o.belt);
    const al = fr === 3 ? 1 : 0, ar = fr === 1 ? 1 : 0;
    g.rect(4, 7 + al, 1, 3, o.sleeve || tunic); g.rect(11, 7 + ar, 1, 3, o.sleeve || tunic);
    g.set(4, 10 + al, o.skin); g.set(11, 10 + ar, o.skin);
    if (o.trim) { g.set(4, 7, o.trim); g.set(11, 7, o.trim); g.set(7, 10, o.trim); g.set(8, 10, o.trim); }
    // head
    g.rect(5, 2, 6, 5, dir === 1 ? o.hair : o.skin);
    if (dir === 0) { g.rect(5, 2, 6, 2, o.hair); g.set(5, 4, o.hair); g.set(10, 4, o.hair); }
    if (o.apron && dir === 0) g.rect(6, 8, 4, 5, '#e8e0cc');
  } else {
    // side view, facing right
    const back = stride ? 5 : 6, front = stride ? 9 : 8;
    g.rect(back, 11, 2, fr === 1 ? 2 : 3, adj(pants, 0.85)); g.rect(back, fr === 1 ? 13 : 14, 2, 1, boots);
    g.rect(front, 11, 2, fr === 3 ? 2 : 3, pants); g.rect(front, fr === 3 ? 13 : 14, 2, 1, boots);
    g.rect(6, 7, 4, 4, tunic);
    if (o.robe) { g.rect(5, 11, 6, 2, tunic); g.rect(5, 12, 6, 2, tunic); }
    g.rect(6, 10, 4, 1, o.belt);
    g.rect(7, 7, 2, 3, adj(o.sleeve || tunic, 0.88)); g.set(8, 10, o.skin);
    if (o.trim) g.set(7, 7, o.trim);
    g.rect(5, 2, 6, 5, o.skin);
    g.rect(5, 2, 6, 2, o.hair); g.rect(5, 4, 3, 3, o.hair);
    g.set(11, 5, o.skin);
  }

  // hats
  if (o.hat === 'helm') {
    g.rect(5, 1, 6, 3, '#aab2c0'); g.rect(4, 2, 1, 3, '#aab2c0'); g.rect(11, 2, 1, 3, '#aab2c0');
    if (dir === 0) g.rect(7, 4, 2, 2, '#aab2c0');
    if (dir === 3) g.rect(10, 3, 2, 3, '#aab2c0');
    if (dir === 2) g.rect(4, 3, 2, 3, '#aab2c0');
    g.rect(7, 0, 2, 1, '#c03a3a'); g.set(7, 1, '#c03a3a');
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

  // weapon & shield
  if (o.weapon) {
    const bx = dir === 0 ? 12 : dir === 1 ? 3 : dir === 3 ? 11 : 4;
    weapon(g, o.weapon, bx, o.blade || BLADE[0], dir === 1 || dir === 2);
  }
  if (o.shield && dir !== 1) {
    const sx = dir === 0 ? 2 : dir === 3 ? 5 : 8;
    if (dir === 0 || dir === 2 || dir === 3) {
      g.rect(sx, 7, 4, 5, '#5a6a8a'); g.rect(sx + 1, 8, 2, 3, '#c8a040'); g.rect(sx, 7, 4, 1, '#8a9ac0');
    }
  }
  return g.outline().canvas(dir === 2);
}

const PRESET = {
  warrior: { hair: '#5a3a22', tunic: '#b03a3a', pants: '#4a4a5a', boots: '#5a3a22', belt: '#3a2a1a', hat: 'helm', weapon: 'sword', shield: true },
  mage: { hair: '#e8e0c8', tunic: '#6a3fb0', pants: '#3a2a5a', boots: '#3a2a1a', belt: '#e8c04a', hat: 'wizard', hatCol: '#5a2f9a', weapon: 'staff', robe: true },
  ranger: { hair: '#7a4a22', tunic: '#3f7a3f', pants: '#6a4a2a', boots: '#3a2a1a', belt: '#2a1a0a', hat: 'hood', hatCol: '#2f5f33', weapon: 'bow' },
};
const NPC_LOOK = {
  elder: { skin: SKINS[0], hair: '#f2f2f2', tunic: '#3a6ab0', pants: '#2a4a80', boots: '#3a2a1a', belt: '#e8c04a', robe: true, beard: '#f2f2f2', weapon: 'staff', hat: 'none' },
  shop: { skin: SKINS[1], hair: '#6a3a1a', tunic: '#c0a060', pants: '#5a4a2a', boots: '#3a2a1a', belt: '#3a2a1a', apron: true, hat: 'cap', hatCol: '#a03030' },
  guard: { skin: SKINS[1], hair: '#3a2a1a', tunic: '#3a5a9a', pants: '#4a4a5a', boots: '#2a2a2a', belt: '#c8a040', hat: 'helm', weapon: 'spear', shield: false },
  goblin: { skin: '#6fae48', hair: '#4a7a30', tunic: '#7a5a30', pants: '#4a3a22', boots: '#2a1a0a', belt: '#2a1a0a', hat: 'none', weapon: 'dagger', ears: true, eye: '#ff3a3a' },
  skeleton: { skin: '#e6e2cc', hair: '#e6e2cc', tunic: '#d9d5bf', sleeve: '#e6e2cc', pants: '#cfcbb5', boots: '#bdb9a3', belt: '#8a8672', hat: 'none', weapon: 'bow', ribs: true, sockets: true, blade: '#bba' },
};

const cache = new Map();
const memo = (k, f) => { let v = cache.get(k); if (!v) { v = f(); cache.set(k, v); } return v; };

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
function slime(fr) {
  const g = new Grid(16, 16);
  if (fr) g.ell(8, 11, 7, 3.6, '#5fd35f'); else g.ell(8, 10, 6, 4.6, '#5fd35f');
  g.shade();
  g.set(5, fr ? 9 : 7, '#c8ffc8'); g.set(6, fr ? 9 : 7, '#c8ffc8');
  const ey = fr ? 10 : 9;
  g.rect(5, ey, 2, 2, '#fff'); g.rect(9, ey, 2, 2, '#fff'); g.set(6, ey + 1, '#1a1a2a'); g.set(10, ey + 1, '#1a1a2a');
  g.rect(7, ey + 3, 2, 1, '#2f8a2f');
  return g.outline().canvas();
}
function bat(fr) {
  const g = new Grid(16, 16);
  const w = '#5a3f7a';
  for (let i = 1; i <= 6; i++) {
    const y = Math.round(8 + (fr ? i * 0.55 : -i * 0.7));
    g.rect(8 - i - 1, y - 1, 1, 3, w); g.rect(8 + i, y - 1, 1, 3, w);
  }
  g.rect(6, 8, 4, 2, w);
  g.ell(8, 8, 2.2, 3, '#3a2a55'); g.ell(8, 5.5, 2.2, 2, '#3a2a55');
  g.set(6, 3, '#3a2a55'); g.set(10, 3, '#3a2a55');
  g.shade();
  g.set(7, 5, '#ff4a4a'); g.set(9, 5, '#ff4a4a'); g.set(7, 7, '#fff'); g.set(9, 7, '#fff');
  return g.outline().canvas();
}
function wolf(fr) {
  const g = new Grid(16, 16);
  const c = '#8a8f99', d = '#6a6f79', l = '#c0c4cc';
  g.rect(0, 5, 3, 2, c); g.set(0, 4, c);
  g.ell(7.5, 8.5, 5.6, 3, c);
  g.rect(4, 10, 7, 1, l);
  for (const [x, long] of [[3, fr === 0], [5, fr === 1], [9, fr === 1], [11, fr === 0]]) g.rect(x, 10, 1, long ? 4 : 3, d);
  g.ell(12, 6.5, 3, 2.5, c);
  g.rect(13, 7, 3, 2, l);
  g.set(11, 3, d); g.set(11, 4, c); g.set(13, 3, d); g.set(13, 4, c);
  g.shade();
  g.set(13, 6, '#ffd23a'); g.set(15, 7, '#16121f'); g.set(14, 9, '#fff'); g.set(8, 7, d); g.set(6, 7, d);
  return g.outline().canvas();
}
function golem(fr) {
  const g = new Grid(32, 32);
  const up = fr ? 2 : 0;
  g.rect(9, 23, 6, 7, '#7a7a82'); g.rect(17, 23, 6, 7, '#7a7a82');
  g.rect(7, 9, 18, 15, '#8a8a92');
  g.rect(2, 9 - up, 6, 6, '#8a8a92'); g.rect(3, 15 - up, 4, 8, '#7a7a82'); g.rect(1, 22 - up, 7, 5, '#8a8a92');
  g.rect(24, 9 - up, 6, 6, '#8a8a92'); g.rect(25, 15 - up, 4, 8, '#7a7a82'); g.rect(24, 22 - up, 7, 5, '#8a8a92');
  g.rect(11, 2, 10, 8, '#9a9aa2');
  g.tex(['#8a8a92', '#7c7c86', '#9a9aa4', '#6e6e78', '#8a8a92'], 5);
  for (let i = 0; i < 26; i++) { const x = Math.floor(hash2(i, 1, 9) * 30) + 1, y = Math.floor(hash2(i, 2, 9) * 28) + 1; if (g.get(x, y)) g.set(x, y, '#4f8a3f'); }
  g.shade();
  g.rect(13, 5, 2, 2, '#ffb030'); g.rect(17, 5, 2, 2, '#ffb030'); g.set(13, 5, '#fff2a0'); g.set(17, 5, '#fff2a0');
  g.rect(15, 12, 2, 7, '#ff8a20'); g.rect(13, 14, 6, 1, '#ff8a20'); g.rect(15, 12, 2, 1, '#fff2a0');
  g.line(20, 11, 23, 16, '#3a3a44'); g.line(10, 18, 8, 22, '#3a3a44');
  return g.outline().canvas();
}

export function mobSprite(type, dir, fr) {
  const f2 = fr & 1;
  switch (type) {
    case 'slime': return memo(`m${type}${f2}`, () => slime(f2));
    case 'bat': return memo(`m${type}${f2}`, () => bat(f2));
    case 'wolf': { const flip = dir === 2; return memo(`m${type}${f2}${flip}`, () => { const c = wolf(f2); if (!flip) return c; const n = mkCanvas(16, 16), x = n.getContext('2d'); x.scale(-1, 1); x.drawImage(c, -16, 0); return n; }); }
    case 'golem': return memo(`m${type}${f2}`, () => golem(f2));
    case 'goblin': return memo(`m${type}${dir}${fr}`, () => humanoid({ ...NPC_LOOK.goblin }, dir, fr));
    case 'skeleton': return memo(`m${type}${dir}${fr}`, () => humanoid({ ...NPC_LOOK.skeleton }, dir, fr));
    default: return memo('m?', () => slime(0));
  }
}

// ------------------------------------------------------------------ item icons
export function itemIcon(base, r = 0) {
  return memo(`i${base}${r}`, () => {
    const g = new Grid(16, 16);
    const b = BLADE[r], gem = RARITY_COL[r];
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
      case 'gold':
        g.ell(8, 10, 5, 3.2, '#c8901a'); g.ell(8, 9, 5, 3.2, '#ffd23a'); g.ell(8, 9, 3, 1.8, '#e8b020'); g.set(6, 8, '#fff2a0'); break;
      default: g.rect(5, 5, 6, 6, '#888');
    }
    return g.shade().outline().canvas();
  });
}

export const classPortrait = (cls) => playerSprite(cls, 0, 0, 0);
