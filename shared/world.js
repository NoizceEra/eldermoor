// Deterministic world generation. Runs identically on the server and in the browser,
// so only the seed ever crosses the wire.
export const W = 128;
export const H = 128;

// Ground layer
export const G = { GRASS: 0, FOREST: 1, SWAMP: 2, SAND: 3, WATER: 4, DEEP: 5, PATH: 6, FLOOR: 7, RUIN: 8 };
// Object layer (things standing on the ground)
export const O = { NONE: 0, TREE: 1, DTREE: 2, ROCK: 3, HOUSE: 4, WALL: 5, RWALL: 6 };

export const TOWN = { cx: 64, cy: 64, r: 11 };
export const BOSS = { x: 100, y: 28 };
export const CAMP = { x: 28, y: 96 };

export const inTown = (x, y) => Math.max(Math.abs(x - TOWN.cx), Math.abs(y - TOWN.cy)) <= TOWN.r;

export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, s, oct = 4) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, y * f, s + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function isSolid(world, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return true;
  const i = y * W + x;
  const g = world.g[i];
  return g === G.WATER || g === G.DEEP || world.o[i] !== O.NONE;
}

export function generateWorld(seed) {
  const g = new Uint8Array(W * H);
  const o = new Uint8Array(W * H);
  const idx = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const { cx, cy, r: R } = TOWN;

  // --- terrain: island with ragged coast, biome rings, inland lakes
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const n = fbm(x / 18, y / 18, seed);
      const m = 1 - Math.pow(d / 60, 1.8) + (n - 0.5) * 0.55;
      let t;
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) t = G.DEEP;
      else if (m < 0.02) t = G.DEEP;
      else if (m < 0.1) t = G.WATER;
      else if (m < 0.16) t = G.SAND;
      else {
        const b = d + (fbm(x / 12, y / 12, seed + 3) - 0.5) * 10;
        t = b < 26 ? G.GRASS : b < 42 ? G.FOREST : G.SWAMP;
        const lake = fbm(x / 10 + 50, y / 10 + 50, seed + 7);
        if (d > 18) {
          if (lake > 0.68) t = G.WATER;
          else if (lake > 0.64) t = G.SAND;
        }
      }
      g[idx(x, y)] = t;
    }
  }

  // --- scatter: trees, dead trees, rocks
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = g[idx(x, y)];
      if (t === G.WATER || t === G.DEEP || t === G.SAND) continue;
      const r = hash2(x, y, seed + 11);
      const clump = fbm(x / 6, y / 6, seed + 5);
      if (t === G.GRASS) {
        if (r < (clump > 0.62 ? 0.18 : 0.012)) o[idx(x, y)] = O.TREE;
      } else if (t === G.FOREST) {
        if (r < (clump > 0.5 ? 0.38 : 0.07)) o[idx(x, y)] = O.TREE;
      } else if (t === G.SWAMP) {
        if (r < (clump > 0.55 ? 0.25 : 0.05)) o[idx(x, y)] = O.DTREE;
      }
      if (o[idx(x, y)] === O.NONE && hash2(x, y, seed + 13) < 0.012) o[idx(x, y)] = O.ROCK;
    }
  }

  const clear = (x, y, ground) => {
    if (!inb(x, y)) return;
    o[idx(x, y)] = O.NONE;
    if (ground !== undefined) g[idx(x, y)] = ground;
  };

  // --- ruined arenas (boss + skeleton camp)
  const ruin = (px, py, rad, ring, gaps) => {
    for (let y = py - rad - 2; y <= py + rad + 2; y++) {
      for (let x = px - rad - 2; x <= px + rad + 2; x++) {
        if (!inb(x, y)) continue;
        const d = Math.hypot(x - px, y - py);
        if (d <= rad + 0.5) {
          clear(x, y, G.RUIN);
          const edge = d > rad - 1.5;
          const ang = Math.atan2(y - py, x - px);
          const gap = gaps.some((a) => Math.abs(Math.atan2(Math.sin(ang - a), Math.cos(ang - a))) < 0.45);
          if (edge && !gap && hash2(x, y, seed + 21) < ring) o[idx(x, y)] = O.RWALL;
          else if (d < rad - 2 && hash2(x, y, seed + 22) < 0.025) o[idx(x, y)] = O.ROCK;
        } else if (d <= rad + 2.5 && g[idx(x, y)] !== G.RUIN) {
          // keep the approach to the ruin dry
          if (g[idx(x, y)] === G.WATER || g[idx(x, y)] === G.DEEP) g[idx(x, y)] = G.SAND;
        }
      }
    }
  };
  ruin(BOSS.x, BOSS.y, 9, 0.62, [Math.PI * 0.75, Math.PI * 0.25]);
  ruin(CAMP.x, CAMP.y, 7, 0.3, [-Math.PI * 0.25, 0, Math.PI * 0.5]);

  // --- town
  for (let y = cy - R - 3; y <= cy + R + 3; y++) {
    for (let x = cx - R - 3; x <= cx + R + 3; x++) {
      if (!inb(x, y)) continue;
      const ch = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      o[idx(x, y)] = O.NONE;
      if (ch <= R) {
        g[idx(x, y)] = G.FLOOR;
        if (ch === R) {
          const gate = (Math.abs(x - cx) <= 1 && Math.abs(y - cy) === R) || (Math.abs(y - cy) <= 1 && Math.abs(x - cx) === R);
          if (!gate) o[idx(x, y)] = O.WALL;
        }
      } else if (g[idx(x, y)] === G.WATER || g[idx(x, y)] === G.DEEP || g[idx(x, y)] === G.SAND) {
        g[idx(x, y)] = G.GRASS;
      }
    }
  }
  const houses = [
    { x: cx - 8, y: cy - 8, w: 4, h: 3 },
    { x: cx + 5, y: cy - 8, w: 4, h: 3 },
    { x: cx - 8, y: cy + 5, w: 4, h: 3 },
    { x: cx + 5, y: cy + 5, w: 4, h: 3 },
  ];
  for (const h of houses) for (let j = 0; j < h.h; j++) for (let i = 0; i < h.w; i++) o[idx(h.x + i, h.y + j)] = O.HOUSE;

  // --- roads (wobbling stairs of path, 2 tiles wide, bridging any water in the way)
  const carve = (x0, y0, x1, y1, s) => {
    let x = x0, y = y0, guard = 0;
    while ((x !== x1 || y !== y1) && guard++ < 800) {
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
        const px = x + ox, py = y + oy;
        if (!inb(px, py) || inTown(px, py)) continue;
        if (g[idx(px, py)] === G.RUIN) continue;
        g[idx(px, py)] = G.PATH;
        o[idx(px, py)] = O.NONE;
      }
      const adx = Math.abs(x1 - x), ady = Math.abs(y1 - y);
      const rr = hash2(x, y, s);
      let horiz = adx >= ady ? rr > 0.22 : rr < 0.22;
      if (adx === 0) horiz = false;
      if (ady === 0) horiz = true;
      if (horiz) x += Math.sign(x1 - x);
      else y += Math.sign(y1 - y);
    }
  };
  carve(cx, cy - R - 1, cx + 6, cy - 40, seed + 31);
  carve(cx + R + 1, cy, BOSS.x - 7, BOSS.y + 6, seed + 32);
  carve(cx, cy + R + 1, CAMP.x + 6, CAMP.y - 3, seed + 33);
  carve(cx - R - 1, cy, cx - 40, cy - 6, seed + 34);

  return { g, o, houses, spawn: { x: cx, y: cy + 3 } };
}
