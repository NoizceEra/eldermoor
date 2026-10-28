// Terrain art: procedural tiles, a baked ground layer, animated water, trees and houses.
import { W, H, G, O, hash2 } from '/shared/world.js';
import { Grid, mkCanvas, adj } from '/client/sprites.js';

export const TS = 16;
const pickc = (r, cols, w) => {
  let t = r * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cols.length; i++) { if ((t -= w[i]) < 0) return cols[i]; }
  return cols[0];
};

function speckle(g, base, cols, weights, seed) {
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) g.set(x, y, pickc(hash2(x, y, seed), [base, ...cols], [1 - weights.reduce((a, b) => a + b, 0), ...weights]));
}

function grassTile(v) {
  const g = new Grid(TS, TS);
  speckle(g, '#4c9a3a', ['#56a643', '#437f33'], [0.16, 0.12], 100 + v);
  const r = hash2(v, 1, 55);
  const tufts = 1 + Math.floor(hash2(v, 2, 55) * 3);
  for (let i = 0; i < tufts; i++) {
    const x = 2 + Math.floor(hash2(v, i + 3, 56) * 11), y = 3 + Math.floor(hash2(v, i + 3, 57) * 11);
    g.set(x, y, '#6cc04f'); g.set(x - 1, y - 1, '#6cc04f'); g.set(x + 1, y - 1, '#6cc04f');
  }
  if (r < 0.42) {
    const x = 3 + Math.floor(hash2(v, 8, 58) * 10), y = 3 + Math.floor(hash2(v, 9, 58) * 10);
    const col = ['#ffe066', '#ff8fa3', '#ffffff', '#9fd0ff'][Math.floor(hash2(v, 10, 59) * 4)];
    g.set(x, y, col); g.set(x, y + 1, '#2f7a2a'); g.set(x - 1, y, adj(col, 0.85)); g.set(x + 1, y, adj(col, 0.85));
  }
  return g.canvas();
}
function forestTile(v) {
  const g = new Grid(TS, TS);
  speckle(g, '#2f6b34', ['#38783b', '#285c2d', '#5a4a2a'], [0.14, 0.14, 0.04], 200 + v);
  if (hash2(v, 3, 61) < 0.3) { const x = 3 + Math.floor(hash2(v, 4, 61) * 9), y = 6 + Math.floor(hash2(v, 5, 61) * 7); g.set(x, y, '#d8d0b8'); g.rect(x - 1, y - 1, 3, 1, '#c03a3a'); g.set(x, y - 1, '#ffffff'); }
  return g.canvas();
}
function swampTile(v) {
  const g = new Grid(TS, TS);
  speckle(g, '#3d5a4a', ['#486b58', '#33503f', '#566a3a'], [0.14, 0.14, 0.05], 300 + v);
  if (hash2(v, 3, 71) < 0.4) {
    const cx = 4 + Math.floor(hash2(v, 4, 71) * 8), cy = 5 + Math.floor(hash2(v, 5, 71) * 7);
    g.ell(cx, cy, 3.5, 2, '#2b4650'); g.set(cx - 1, cy - 1, '#5c8a96'); g.set(cx + 1, cy, '#3c6672');
  }
  if (hash2(v, 6, 72) < 0.3) { const x = 2 + Math.floor(hash2(v, 7, 72) * 12); g.rect(x, 4, 1, 4, '#7a8a4a'); g.set(x, 3, '#8a5a2a'); g.set(x + 1, 6, '#7a8a4a'); }
  return g.canvas();
}
function sandTile(v) {
  const g = new Grid(TS, TS);
  speckle(g, '#dcc58a', ['#c9b074', '#ece0aa'], [0.16, 0.1], 400 + v);
  if (hash2(v, 3, 81) < 0.3) { const x = 3 + Math.floor(hash2(v, 4, 81) * 10), y = 3 + Math.floor(hash2(v, 5, 81) * 10); g.set(x, y, '#a89060'); g.set(x + 1, y, '#bba070'); }
  return g.canvas();
}
function pathTile(v) {
  const g = new Grid(TS, TS);
  speckle(g, '#a0794a', ['#8d683c', '#b58c5a', '#6b5030'], [0.18, 0.12, 0.03], 500 + v);
  return g.canvas();
}
function floorTile(v, mode) {
  const ruin = mode === true || mode === 1, crypt = mode === 2;
  const g = new Grid(TS, TS);
  const base = crypt ? '#4a4e66' : ruin ? '#6f7b6a' : '#8a8a96', seam = crypt ? '#2a2c40' : ruin ? '#4f5a4c' : '#62626f', hi = crypt ? '#5e6280' : ruin ? '#838f7c' : '#a4a4b0';
  g.rect(0, 0, TS, TS, base);
  const off = (v & 1) * 3;
  for (let by = 0; by < 2; by++) {
    for (let bx = 0; bx < 2; bx++) {
      const x0 = bx * 8 + (by ? off : 0) - (by ? 4 : 0), y0 = by * 8;
      for (let i = 0; i < 8; i++) { g.set(x0 + i, y0, hi); g.set(x0, y0 + i, hi); g.set(x0 + i, y0 + 7, seam); g.set(x0 + 7, y0 + i, seam); }
    }
  }
  for (let i = 0; i < 14; i++) { const x = Math.floor(hash2(i, v, 91) * 16), y = Math.floor(hash2(i, v, 92) * 16); if (g.get(x, y) === base) g.set(x, y, adj(base, hash2(i, v, 93) < 0.5 ? 0.9 : 1.1)); }
  if (crypt) {
    for (let i = 0; i < 3; i++) { const x = 2 + Math.floor(hash2(i, v, 97) * 12), y = 2 + Math.floor(hash2(i, v, 98) * 12); if (hash2(i, v, 99) < 0.5) { g.set(x, y, '#c8c4ae'); g.set(x + 1, y, '#a8a48e'); } }
    if (v === 1) { g.set(5, 5, '#16121f'); g.set(6, 6, '#16121f'); g.set(7, 6, '#16121f'); g.set(8, 7, '#16121f'); }
  }
  if (ruin) {
    for (let i = 0; i < 18; i++) { const x = Math.floor(hash2(i, v, 94) * 16), y = Math.floor(hash2(i, v, 95) * 16); if (hash2(i, v, 96) < 0.7) g.set(x, y, '#4f7a4a'); }
  }
  return g.canvas();
}
function waterTile(frame, deep) {
  const g = new Grid(TS, TS);
  const base = deep ? '#1f4a8c' : '#2f6fb8', wave = deep ? '#2a5aa0' : '#5c9be0', spark = '#a8d4ff';
  g.rect(0, 0, TS, TS, base);
  for (let row = 0; row < 4; row++) {
    const y = row * 4 + 1;
    const ox = (frame * 4 + row * 5) % 16;
    for (let i = 0; i < 5; i++) { g.set((ox + i) % 16, y, wave); }
    g.set((ox + 9) % 16, y + 2, wave); g.set((ox + 10) % 16, y + 2, wave);
  }
  if (!deep) { g.set((frame * 5 + 3) % 16, 6, spark); g.set((frame * 7 + 11) % 16, 12, spark); }
  return g.canvas();
}
const foamStrips = (() => {
  const mk = (draw) => { const g = new Grid(TS, TS); draw(g); return g.canvas(); };
  const c = '#e8f4ff', c2 = '#b8dcf8';
  return [
    mk((g) => { g.rect(0, 0, TS, 1, c); for (let x = 0; x < TS; x += 2) g.set(x, 1, c2); }),
    mk((g) => { g.rect(0, 15, TS, 1, c); for (let x = 1; x < TS; x += 2) g.set(x, 14, c2); }),
    mk((g) => { g.rect(0, 0, 1, TS, c); for (let y = 0; y < TS; y += 2) g.set(1, y, c2); }),
    mk((g) => { g.rect(15, 0, 1, TS, c); for (let y = 1; y < TS; y += 2) g.set(14, y, c2); }),
  ];
})();

function wallTile(v, dark) {
  const g = new Grid(TS, TS);
  g.rect(0, 0, TS, TS, dark ? '#3e3e56' : '#6e6e7c');
  g.rect(0, 0, TS, 5, dark ? '#62627e' : '#9a9aaa'); g.rect(0, 4, TS, 1, dark ? '#4a4a64' : '#7a7a8a');
  for (let r = 0; r < 3; r++) {
    const y = 5 + r * 4;
    g.rect(0, y + 3, TS, 1, '#46465a');
    const off = r % 2 ? 4 : 0;
    for (let x = off; x < TS; x += 8) g.rect(x, y, 1, 3, '#46465a');
  }
  for (let i = 0; i < 12; i++) { const x = Math.floor(hash2(i, v, 31) * 16), y = 5 + Math.floor(hash2(i, v, 32) * 11); if (g.get(x, y) === (dark ? '#3e3e56' : '#6e6e7c')) g.set(x, y, dark ? '#484862' : '#7c7c8c'); }
  for (let x = 0; x < TS; x += 4) g.set(x, 0, '#b0b0c0');
  g.rect(0, 15, TS, 1, '#34344a');
  return g.canvas();
}
function ruinWallTile(v) {
  const g = new Grid(TS, TS);
  const h = 6 + Math.floor(hash2(v, 1, 41) * 8);
  g.rect(1, 16 - h, 14, h, '#7c8478');
  g.rect(1, 16 - h, 14, 3, '#9aa392');
  for (let i = 0; i < 16; i++) { const x = 1 + Math.floor(hash2(i, v, 42) * 14), y = 16 - h + Math.floor(hash2(i, v, 43) * h); g.set(x, y, hash2(i, v, 44) < 0.5 ? '#4f7a4a' : '#646c5e'); }
  g.set(1, 16 - h, null); g.set(14, 16 - h, null); g.set(2, 16 - h, null);
  return g.shade().outline('#2a2e28').canvas();
}
function rockTile(v) {
  const g = new Grid(TS, TS);
  g.ell(8, 10, 5.5 + (v & 1), 4, '#8a8a92'); g.ell(7, 8, 3, 2.2, '#a2a2aa');
  g.tex(['#8a8a92', '#7c7c86', '#989aa2'], v + 1);
  g.shade();
  g.set(6, 7, '#c8c8d0'); g.set(7, 7, '#c8c8d0');
  return g.outline().canvas();
}

// ---- tall things (drawn y-sorted, anchored at tile bottom-centre)
function oakTree(v) {
  const g = new Grid(24, 32);
  g.rect(10, 18, 4, 12, '#6a4423'); g.rect(8, 28, 8, 2, '#6a4423'); g.rect(11, 18, 1, 12, '#8a5a30');
  const gr = v % 3 === 0 ? '#3f8a35' : v % 3 === 1 ? '#48963a' : '#368030';
  g.ell(12, 11, 10, 9, gr); g.ell(6, 15, 6, 5, gr); g.ell(18, 15, 6, 5, gr);
  g.tex([gr, adj(gr, 0.9), adj(gr, 1.08), gr], v + 7);
  g.shade();
  for (let i = 0; i < 7; i++) g.set(5 + Math.floor(hash2(i, v, 51) * 14), 4 + Math.floor(hash2(i, v, 52) * 8), adj(gr, 1.35));
  return g.outline('#14240f').canvas();
}
function pineTree(v) {
  const g = new Grid(24, 32);
  g.rect(11, 24, 3, 6, '#5a3a1c');
  const gr = v % 2 ? '#25603a' : '#1f5632';
  const layers = [[3, 7, 5], [9, 10, 7], [15, 12, 9], [21, 14, 10]];
  for (const [y, hw, h] of layers) for (let j = 0; j < h; j++) { const w = Math.round((hw * (j + 1)) / h); g.rect(12 - w, y + j - 2, w * 2, 1, gr); }
  g.tex([gr, adj(gr, 0.88), adj(gr, 1.1), gr], v + 3);
  g.shade();
  g.set(12, 0, adj(gr, 1.3));
  return g.outline('#0f2a18').canvas();
}
function deadTree(v) {
  const g = new Grid(24, 32);
  const bark = '#5a4a40';
  g.rect(11, 14, 3, 16, bark); g.rect(9, 28, 7, 2, bark);
  g.line(12, 16, 5, 7, bark); g.line(13, 18, 20, 8, bark); g.line(12, 12, 9, 3, bark); g.line(6, 8, 3, 8, bark); g.line(19, 9, 22, 6, bark); g.line(12, 10, 15, 2, bark);
  g.tex([bark, '#4a3a32', '#6a5a50'], v + 2);
  g.shade();
  for (let i = 0; i < 6; i++) { const x = 4 + Math.floor(hash2(i, v, 53) * 16), y = 7 + Math.floor(hash2(i, v, 54) * 8); if (g.get(x, y)) g.set(x, y + 2, '#6a8a4a'); }
  return g.outline('#1a1410').canvas();
}
function pillarSprite(v) {
  const g = new Grid(24, 32);
  g.rect(5, 27, 14, 4, '#5a5e7a'); g.rect(7, 8, 10, 19, '#7a7e9a'); g.rect(4, 4, 16, 5, '#8a8eaa'); g.rect(6, 2, 12, 3, '#9a9eba');
  g.tex(['#7a7e9a', '#6e7290', '#868aa6'], v + 11);
  g.shade();
  for (const y of [11, 15, 19, 23]) g.rect(8, y, 8, 1, '#4a4e66');
  g.set(10, 6, '#c8c4ae'); g.set(14, 6, '#c8c4ae');
  return g.outline('#14121f').canvas();
}
const treeCache = new Map();
export function treeSprite(kind, v) {
  const k = `${kind}${v}`;
  let c = treeCache.get(k);
  if (!c) { c = kind === 'cactus' ? cactusSprite(v) : kind === 'snowpine' ? snowPineSprite(v) : kind === 'palm' ? palmSprite(v) : kind === 'pillar' ? pillarSprite(v) : kind === O.DTREE ? deadTree(v) : kind === 'pine' ? pineTree(v) : oakTree(v); treeCache.set(k, c); }
  return c;
}

// ---- phase 3 terrain: snow, ice, dunes, basalt, ash, lava, bridges
function snowTile(v) {
  const g = new Grid(TS, TS);
  speckle(g, '#eef3fa', ['#dfe8f4', '#ffffff'], [0.14, 0.1], 600 + v);
  if (hash2(v, 3, 601) < 0.4) { const x = 2 + Math.floor(hash2(v, 4, 601) * 11), y = 3 + Math.floor(hash2(v, 5, 601) * 10); g.set(x, y, '#c6d4e8'); g.set(x + 1, y, '#c6d4e8'); }
  return g.canvas();
}
function iceTile(v) {
  const g = new Grid(TS, TS);
  speckle(g, '#a8d8ee', ['#98c8e0', '#c0e8f8'], [0.16, 0.1], 610 + v);
  const x0 = 2 + Math.floor(hash2(v, 1, 611) * 8), y0 = 2 + Math.floor(hash2(v, 2, 611) * 8);
  g.line(x0, y0, x0 + 5, y0 + 3, '#e8f8ff'); g.line(x0 + 5, y0 + 3, x0 + 4, y0 + 8, '#78b0d0');
  return g.canvas();
}
function duneTile(v) {
  const g = new Grid(TS, TS);
  speckle(g, '#e0b86a', ['#d0a85a', '#ecc884'], [0.16, 0.1], 620 + v);
  const y = 4 + Math.floor(hash2(v, 1, 621) * 8);
  for (let x = 1; x < 15; x++) g.set(x, y + Math.round(Math.sin(x / 2 + v)), '#c89c50');
  return g.canvas();
}
function basaltTile(v) {
  const g = new Grid(TS, TS);
  speckle(g, '#3a3440', ['#2e2a36', '#4a4452'], [0.18, 0.12], 630 + v);
  if (hash2(v, 3, 631) < 0.25) { const x = 2 + Math.floor(hash2(v, 4, 631) * 11), y = 2 + Math.floor(hash2(v, 5, 631) * 11); g.set(x, y, '#ff6a2a'); g.set(x + 1, y, '#c8381a'); }
  return g.canvas();
}
function ashTile(v) {
  const g = new Grid(TS, TS);
  speckle(g, '#58545c', ['#4a464e', '#6a6670', '#3a363e'], [0.14, 0.12, 0.04], 640 + v);
  return g.canvas();
}
function lavaTile(frame) {
  const g = new Grid(TS, TS);
  g.rect(0, 0, TS, TS, '#d8381a');
  for (let row = 0; row < 4; row++) {
    const y = row * 4 + 1, ox = (frame * 3 + row * 5) % 16;
    for (let i = 0; i < 6; i++) g.set((ox + i) % 16, y, '#ff8a2a');
    g.set((ox + 8) % 16, y + 2, '#ffd040'); g.set((ox + 9) % 16, y + 2, '#ffd040');
  }
  for (let i = 0; i < 5; i++) { const x = Math.floor(hash2(i, frame >> 1, 650) * 16), y = Math.floor(hash2(i, 9, 651) * 16); g.set(x, y, '#7a1a0a'); g.set((x + 1) % 16, y, '#7a1a0a'); }
  return g.canvas();
}
function bridgeTile(v) {
  const g = new Grid(TS, TS);
  g.rect(0, 0, TS, TS, '#8a5a2a');
  for (let y = 0; y < TS; y += 4) {
    g.rect(0, y + 3, TS, 1, '#4a2f18'); g.rect(0, y, TS, 1, '#a07038');
    for (let x = Math.floor(hash2(y, v, 660) * 8); x < TS; x += 8) g.set(x, y + 1, '#4a2f18');
  }
  g.rect(0, 0, 1, TS, '#3a2410'); g.rect(15, 0, 1, TS, '#3a2410');
  return g.canvas();
}
function iceRockTile(v) {
  const g = new Grid(TS, TS);
  g.ell(8, 10, 5.5 + (v & 1), 4, '#a8d0e8'); g.ell(7, 8, 3, 2, '#e8f8ff');
  g.tex(['#a8d0e8', '#98c0d8', '#c0e0f4'], v + 1);
  g.shade(); g.set(6, 7, '#ffffff');
  return g.outline('#2a4a68').canvas();
}
function brockTile(v) {
  const g = new Grid(TS, TS);
  g.ell(8, 10, 5.5 + (v & 1), 4, '#3a3440');
  g.tex(['#3a3440', '#2e2a36', '#4a4452'], v + 2);
  g.shade(); g.set(6, 9, '#ff6a2a'); g.set(7, 10, '#ff6a2a'); g.set(9, 11, '#c8381a');
  return g.outline('#14101c').canvas();
}
function cactusSprite(v) {
  const g = new Grid(24, 32), c = '#3f8a3f';
  g.rect(10, 8, 4, 22, c); g.rect(5, 15, 6, 3, c); g.rect(5, 10, 3, 6, c); g.rect(13, 18, 6, 3, c); g.rect(16, 12, 3, 7, c); g.ell(12, 8, 2.2, 2.2, c);
  g.tex([c, adj(c, 0.88), adj(c, 1.12)], v + 4); g.shade();
  for (const [x, y] of [[11, 12], [12, 20], [6, 12], [17, 15]]) g.set(x, y, '#e8f0c0');
  if (v % 2 === 0) { g.set(12, 5, '#ff7aa8'); g.set(11, 6, '#ff7aa8'); g.set(13, 6, '#ff7aa8'); }
  return g.outline('#14240f').canvas();
}
function snowPineSprite(v) {
  const g = new Grid(24, 32);
  g.rect(11, 24, 3, 6, '#5a3a1c');
  const gr = '#1f5a46', layers = [[3, 7, 5], [9, 10, 7], [15, 12, 9], [21, 14, 10]];
  for (const [y, hw, h] of layers) for (let j = 0; j < h; j++) { const w = Math.round((hw * (j + 1)) / h); g.rect(12 - w, y + j - 2, w * 2, 1, gr); }
  g.tex([gr, adj(gr, 0.88), adj(gr, 1.1)], v + 3);
  for (const [y, hw, h] of layers) for (let j = 0; j < 2; j++) { const w = Math.round((hw * (j + 1)) / h); g.rect(12 - w, y + j - 2, w * 2, 1, '#f4f8ff'); }
  g.shade();
  return g.outline('#0f2a28').canvas();
}
function palmSprite(v) {
  const g = new Grid(24, 32), t = '#8a6a3a';
  for (let i = 0; i < 20; i++) { g.set(11 + Math.round(Math.sin(i / 6) * 2), 29 - i, t); g.set(12 + Math.round(Math.sin(i / 6) * 2), 29 - i, adj(t, 0.8)); }
  const top = [13, 9];
  for (const a of [-2.6, -2.0, -1.3, -0.5, 0.2, 0.8]) {
    for (let k = 1; k <= 9; k++) {
      const x = top[0] + Math.cos(a) * k, y = top[1] + Math.sin(a) * k * 0.6 + k * k * 0.03;
      g.set(x, y, k < 5 ? '#4aaa4a' : '#3a8a3a'); g.set(x, y + 1, '#2f7a2f');
    }
  }
  g.set(12, 10, '#6a4a1a'); g.set(14, 10, '#6a4a1a');
  return g.outline('#14240f').canvas();
}

function paintHouse(w, h, v) {
  const c = mkCanvas(w * TS, h * TS), x = c.getContext('2d');
  const roofH = (h - 1) * TS, pw = w * TS;
  const palettes = [['#b0503c', '#8a3a2a', '#c96a52'], ['#3f6aa0', '#2c4f7c', '#5a88c0'], ['#4a8a4a', '#336633', '#66aa66'], ['#8a5aa0', '#654080', '#a578c0']];
  const [rb, rd, rl] = palettes[v % palettes.length];
  x.fillStyle = rb; x.fillRect(0, 0, pw, roofH);
  for (let y = 0; y < roofH; y += 4) {
    x.fillStyle = rd; x.fillRect(0, y + 3, pw, 1);
    for (let px = (y / 4) % 2 ? 0 : 4; px < pw; px += 8) { x.fillRect(px, y, 1, 3); }
    x.fillStyle = rl; x.fillRect(0, y, pw, 1);
  }
  x.fillStyle = adj(rl, 1.2); x.fillRect(0, 0, pw, 2);
  x.fillStyle = '#16121f'; x.fillRect(0, 0, pw, 1); x.fillRect(0, 0, 1, roofH); x.fillRect(pw - 1, 0, 1, roofH);
  x.fillStyle = '#6a6a76'; x.fillRect(pw - 14, 2, 6, 10); x.fillStyle = '#16121f'; x.fillRect(pw - 15, 1, 8, 2);
  x.fillStyle = rd; x.fillRect(0, roofH - 2, pw, 2); // eaves
  const wy = roofH;
  x.fillStyle = '#d9c9a0'; x.fillRect(0, wy, pw, TS);
  x.fillStyle = '#6a4a2a'; x.fillRect(0, wy, pw, 1); x.fillRect(0, wy, 2, TS); x.fillRect(pw - 2, wy, 2, TS); x.fillRect(0, wy + 15, pw, 1);
  const win = (wx) => { x.fillStyle = '#6a4a2a'; x.fillRect(wx, wy + 3, 8, 8); x.fillStyle = '#8ecae6'; x.fillRect(wx + 1, wy + 4, 6, 6); x.fillStyle = '#d8f0ff'; x.fillRect(wx + 1, wy + 4, 2, 2); x.fillStyle = '#6a4a2a'; x.fillRect(wx + 3, wy + 4, 1, 6); x.fillRect(wx + 1, wy + 7, 6, 1); };
  win(6); win(pw - 14);
  const dx = pw / 2 - 5;
  x.fillStyle = '#4a2f18'; x.fillRect(dx, wy + 3, 10, 13); x.fillStyle = '#6a4423'; x.fillRect(dx + 1, wy + 4, 8, 12); x.fillStyle = '#e8c04a'; x.fillRect(dx + 7, wy + 10, 1, 2);
  return c;
}

// ---- bake (in 32x32-tile chunks, on demand: a 256x256 world would be a 64 MB canvas)
const GROUND_BASE = {
  [G.GRASS]: '#4c9a3a', [G.FOREST]: '#2f6b34', [G.SWAMP]: '#3d5a4a', [G.SAND]: '#dcc58a', [G.PATH]: '#a0794a', [G.FLOOR]: '#8a8a96', [G.RUIN]: '#6f7b6a',
  [G.SNOW]: '#eef3fa', [G.ICE]: '#a8d8ee', [G.DUNE]: '#e0b86a', [G.BASALT]: '#3a3440', [G.ASH]: '#58545c',
};
const isWater = (t) => t === G.WATER || t === G.DEEP;
const isLiquid = (t) => isWater(t) || t === G.LAVA;
const NOBLEND = new Set([G.FLOOR, G.RUIN, G.CRYPT, G.VOID, G.BRIDGE]);
export const CHUNK = 32;
const CHUNK_PX = CHUNK * TS;

export function buildWorldArt(world) {
  const N = 8;
  const V = {
    [G.GRASS]: Array.from({ length: N }, (_, i) => grassTile(i)),
    [G.FOREST]: Array.from({ length: N }, (_, i) => forestTile(i)),
    [G.SWAMP]: Array.from({ length: N }, (_, i) => swampTile(i)),
    [G.SAND]: Array.from({ length: N }, (_, i) => sandTile(i)),
    [G.PATH]: Array.from({ length: N }, (_, i) => pathTile(i)),
    [G.SNOW]: Array.from({ length: N }, (_, i) => snowTile(i)),
    [G.ICE]: Array.from({ length: N }, (_, i) => iceTile(i)),
    [G.DUNE]: Array.from({ length: N }, (_, i) => duneTile(i)),
    [G.BASALT]: Array.from({ length: N }, (_, i) => basaltTile(i)),
    [G.ASH]: Array.from({ length: N }, (_, i) => ashTile(i)),
    [G.BRIDGE]: Array.from({ length: 4 }, (_, i) => bridgeTile(i)),
    [G.FLOOR]: Array.from({ length: 4 }, (_, i) => floorTile(i, false)),
    [G.RUIN]: Array.from({ length: 4 }, (_, i) => floorTile(i, true)),
    [G.CRYPT]: Array.from({ length: 4 }, (_, i) => floorTile(i, 2)),
    [G.VOID]: [(() => { const g = new Grid(TS, TS); g.rect(0, 0, TS, TS, '#0a0814'); return g.canvas(); })()],
  };
  const walls = Array.from({ length: 3 }, (_, i) => wallTile(i, !!world.dungeon));
  const rwalls = Array.from({ length: 6 }, (_, i) => ruinWallTile(i));
  const rocks = Array.from({ length: 4 }, (_, i) => rockTile(i));
  const irocks = Array.from({ length: 4 }, (_, i) => iceRockTile(i));
  const brocks = Array.from({ length: 4 }, (_, i) => brockTile(i));
  const waterFrames = [0, 1, 2, 3].map((f) => [waterTile(f, false), waterTile(f, true)]);
  const lavaFrames = [0, 1, 2, 3].map((f) => lavaTile(f));
  const gAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? G.DEEP : world.g[y * W + x]);

  // tall objects are y-sorted with characters, so they are collected up front
  const trees = Array.from({ length: H }, () => []);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = world.o[y * W + x];
      if (!o) continue;
      const v = Math.floor(hash2(x, y, 9) * 8);
      if (o === O.TREE) trees[y].push({ x, kind: world.g[y * W + x] === G.FOREST ? 'pine' : 'oak', v });
      else if (o === O.DTREE) trees[y].push({ x, kind: O.DTREE, v });
      else if (o === O.PILLAR) trees[y].push({ x, kind: 'pillar', v });
      else if (o === O.CACTUS) trees[y].push({ x, kind: 'cactus', v });
      else if (o === O.SNOWPINE) trees[y].push({ x, kind: 'snowpine', v });
      else if (o === O.PALM) trees[y].push({ x, kind: 'palm', v });
    }
  }
  const houseArt = world.houses.map((h, i) => paintHouse(h.w, h.h, i));

  function bakeChunk(cx, cy) {
    const c = mkCanvas(CHUNK_PX, CHUNK_PX), bx = c.getContext('2d');
    const ox = cx * CHUNK_PX, oy = cy * CHUNK_PX;
    for (let y = cy * CHUNK; y < Math.min(H, (cy + 1) * CHUNK); y++) {
      for (let x = cx * CHUNK; x < Math.min(W, (cx + 1) * CHUNK); x++) {
        const t = world.g[y * W + x];
        const v = Math.floor(hash2(x, y, 9) * 8);
        const px = x * TS - ox, py = y * TS - oy;
        if (isWater(t)) { bx.drawImage(waterFrames[0][t === G.DEEP ? 1 : 0], px, py); continue; }
        if (t === G.LAVA) { bx.drawImage(lavaFrames[0], px, py); continue; }
        bx.drawImage(V[t][v % V[t].length], px, py);
        // dithered blend into a different neighbouring ground
        if (!NOBLEND.has(t)) {
          for (const [dx, dy, side] of [[0, -1, 0], [0, 1, 1], [-1, 0, 2], [1, 0, 3]]) {
            const nt = gAt(x + dx, y + dy);
            if (nt === t || isLiquid(nt) || NOBLEND.has(nt)) continue;
            const col = GROUND_BASE[nt];
            if (!col) continue;
            bx.fillStyle = col;
            for (let i = 0; i < TS; i++) {
              const r1 = hash2(x * 16 + i, y * 16 + side, 77), r2 = hash2(x * 16 + i, y * 16 + side, 78);
              const d1 = [[i, 0], [i, 15], [0, i], [15, i]][side], d2 = [[i, 1], [i, 14], [1, i], [14, i]][side];
              if (r1 < 0.6) bx.fillRect(px + d1[0], py + d1[1], 1, 1);
              if (r2 < 0.25) bx.fillRect(px + d2[0], py + d2[1], 1, 1);
            }
          }
        }
        const o = world.o[y * W + x];
        if (o === O.WALL) bx.drawImage(walls[v % 3], px, py);
        else if (o === O.RWALL) bx.drawImage(rwalls[v % 6], px, py);
        else if (o === O.ROCK) bx.drawImage(rocks[v % 4], px, py);
        else if (o === O.ICEROCK) bx.drawImage(irocks[v % 4], px, py);
        else if (o === O.BROCK) bx.drawImage(brocks[v % 4], px, py);
      }
    }
    world.houses.forEach((h, i) => {
      if (h.x * TS < ox + CHUNK_PX && (h.x + h.w) * TS > ox && h.y * TS < oy + CHUNK_PX && (h.y + h.h) * TS > oy) bx.drawImage(houseArt[i], h.x * TS - ox, h.y * TS - oy);
    });
    return c;
  }
  const chunks = new Map(); // LRU: a handful of chunks are visible at once
  const chunk = (cx, cy) => {
    const key = cy * 64 + cx;
    let c = chunks.get(key);
    if (c) { chunks.delete(key); chunks.set(key, c); return c; }
    c = bakeChunk(cx, cy);
    chunks.set(key, c);
    if (chunks.size > 24) chunks.delete(chunks.keys().next().value);
    return c;
  };

  // water tiles that touch land get foam; remember them for the animated pass
  const shore = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isWater(world.g[y * W + x])) continue;
      let m = 0;
      if (!isLiquid(gAt(x, y - 1))) m |= 1;
      if (!isLiquid(gAt(x, y + 1))) m |= 2;
      if (!isLiquid(gAt(x - 1, y))) m |= 4;
      if (!isLiquid(gAt(x + 1, y))) m |= 8;
      shore[y * W + x] = m;
    }
  }

  // minimap base
  const mm = mkCanvas(W, H), mx = mm.getContext('2d');
  const MC = {
    [G.GRASS]: '#4c9a3a', [G.FOREST]: '#2f6b34', [G.SWAMP]: '#3d5a4a', [G.SAND]: '#dcc58a', [G.WATER]: '#2f6fb8', [G.DEEP]: '#1f4a8c', [G.PATH]: '#a0794a',
    [G.FLOOR]: '#9a9aa8', [G.RUIN]: '#6f7b6a', [G.CRYPT]: '#4a4e66', [G.VOID]: '#0a0814', [G.SNOW]: '#eef3fa', [G.ICE]: '#a8d8ee', [G.DUNE]: '#e0b86a',
    [G.BASALT]: '#3a3440', [G.ASH]: '#58545c', [G.LAVA]: '#e0481a', [G.BRIDGE]: '#8a5a2a',
  };
  const OC = { [O.WALL]: '#5a5a6a', [O.HOUSE]: '#5a5a6a', [O.TREE]: '#1f5a2a', [O.DTREE]: '#3a3a30', [O.RWALL]: '#555', [O.PILLAR]: '#8a8eaa', [O.CACTUS]: '#2f7a2f', [O.SNOWPINE]: '#2a6a56', [O.PALM]: '#3a8a3a', [O.ICEROCK]: '#8ab8d8', [O.BROCK]: '#2a2630' };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      mx.fillStyle = OC[world.o[y * W + x]] || MC[world.g[y * W + x]];
      mx.fillRect(x, y, 1, 1);
    }
  }
  return { chunk, trees, shore, waterFrames, lavaFrames, minimap: mm };
}

export function drawWaterTile(ctx, art, world, tx, ty, px, py, frame) {
  const i = ty * W + tx;
  ctx.drawImage(art.waterFrames[frame][world.g[i] === G.DEEP ? 1 : 0], px, py);
  const m = art.shore[i];
  if (m) for (let s2 = 0; s2 < 4; s2++) if (m & (1 << s2)) ctx.drawImage(foamStrips[s2], px, py);
}
export function drawLavaTile(ctx, art, px, py, frame) { ctx.drawImage(art.lavaFrames[frame], px, py); }
