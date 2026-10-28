// Deterministic world generation. Runs identically on the server and in the browser,
// so only the seed ever crosses the wire.
export const W = 256;
export const H = 256;
const NW = 128; // the original Eldermoor island occupies the north-west 128x128 square, generated exactly as before

// Ground layer
export const G = {
  GRASS: 0, FOREST: 1, SWAMP: 2, SAND: 3, WATER: 4, DEEP: 5, PATH: 6, FLOOR: 7, RUIN: 8, VOID: 9, CRYPT: 10,
  SNOW: 11, ICE: 12, DUNE: 13, BASALT: 14, ASH: 15, LAVA: 16, BRIDGE: 17, FROST: 18, EMBER: 19,
};
// Object layer (things standing on the ground)
export const O = {
  NONE: 0, TREE: 1, DTREE: 2, ROCK: 3, HOUSE: 4, WALL: 5, RWALL: 6, PILLAR: 7,
  CACTUS: 8, SNOWPINE: 9, ICEROCK: 10, BROCK: 11, PALM: 12,
};

// Four islands joined by plank bridges. The first is the original Eldermoor island.
export const ISLANDS = [
  { id: 'eldermoor', name: 'Eldermoor', cx: 64, cy: 64, rad: 60, biome: 'temperate' },
  { id: 'sunscar', name: 'Sunscar Dunes', cx: 192, cy: 64, rad: 58, biome: 'desert' },
  { id: 'frostmarch', name: 'Frostmarch', cx: 64, cy: 192, rad: 58, biome: 'tundra' },
  { id: 'cinder', name: 'Cinderpeak', cx: 192, cy: 192, rad: 58, biome: 'volcano' },
];
export const TOWNS = [
  { id: 'eldermoor', name: 'Eldermoor', cx: 64, cy: 64, r: 11, island: 0 },
  { id: 'dunehaven', name: 'Dunehaven', cx: 192, cy: 66, r: 9, island: 1 },
  { id: 'frostwatch', name: 'Frostwatch', cx: 62, cy: 194, r: 9, island: 2 },
  { id: 'emberhold', name: 'Emberhold', cx: 194, cy: 190, r: 9, island: 3 },
];
export const TOWN = TOWNS[0];
export const BOSS = { x: 100, y: 28 };
export const CAMP = { x: 28, y: 96 };
export const BOSSES = [
  { id: 'golem', mob: 'golem', x: 100, y: 28 },
  { id: 'sunking', mob: 'sunking', x: 206, y: 24 },
  { id: 'rimefang', mob: 'rimefang', x: 28, y: 228 },
  { id: 'cinderwing', mob: 'cinderwing', x: 228, y: 228 },
];
export const CAMPS = [
  { x: 28, y: 96, mob: 'skeleton' }, { x: 230, y: 100, mob: 'mummy' }, { x: 100, y: 230, mob: 'yeti' }, { x: 160, y: 232, mob: 'emberknight' },
];

const inTownOf = (t, x, y) => Math.max(Math.abs(x - t.cx), Math.abs(y - t.cy)) <= t.r;
export const townAt = (x, y) => TOWNS.find((t) => inTownOf(t, x, y)) || null;
export const inTown = (x, y) => TOWNS.some((t) => inTownOf(t, x, y));

const RINGS = [
  [[26, 'Greenmeadow', '1-8'], [42, 'Whisperwood', '8-16'], [999, 'Mirefen', '14-22']],
  [[28, 'Sunscar Dunes', '18-24'], [999, 'Tombfields', '22-32']],
  [[28, 'Frostmarch', '27-33'], [999, 'Rimewood Wastes', '32-42']],
  [[28, 'Cinderpeak Slopes', '36-42'], [999, 'Ashen Caldera', '42-54']],
];
export function regionAt(x, y) {
  const t = townAt(x, y);
  if (t) return { name: t.name, lv: '', town: true };
  let k = 0, bd = 1e9;
  ISLANDS.forEach((I, i) => { const d = Math.hypot(x - I.cx, y - I.cy); if (d < bd) { bd = d; k = i; } });
  if (bd > ISLANDS[k].rad + 8) return { name: 'The Open Sea', lv: '', sea: true };
  const ring = RINGS[k].find((r) => bd <= r[0]);
  return { name: ring[1], lv: ring[2], island: k };
}

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
  return g === G.WATER || g === G.DEEP || g === G.VOID || g === G.LAVA || world.o[i] !== O.NONE;
}

export function generateWorld(seed) {
  const g = new Uint8Array(W * H);
  const o = new Uint8Array(W * H);
  const idx = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const { cx, cy, r: R } = TOWN;

  // --- terrain: island with ragged coast, biome rings, inland lakes
  for (let y = 0; y < NW; y++) {
    for (let x = 0; x < NW; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const n = fbm(x / 18, y / 18, seed);
      const m = 1 - Math.pow(d / 60, 1.8) + (n - 0.5) * 0.55;
      let t;
      if (x < 2 || y < 2 || x >= NW - 2 || y >= NW - 2) t = G.DEEP;
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
  for (let y = 0; y < NW; y++) {
    for (let x = 0; x < NW; x++) {
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
  const ruin = (px, py, rad, ring, gaps, dry = G.SAND) => {
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
          if (g[idx(x, y)] === G.WATER || g[idx(x, y)] === G.DEEP || g[idx(x, y)] === G.LAVA) g[idx(x, y)] = dry;
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
        const gg = g[idx(px, py)];
        g[idx(px, py)] = gg === G.WATER || gg === G.DEEP || gg === G.LAVA ? G.BRIDGE : G.PATH;
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

  // ================================================================== the other three islands
  const nearestIsland = (x, y) => {
    let k = 1, bd = 1e9;
    for (let i = 1; i < ISLANDS.length; i++) { const dd = Math.hypot(x - ISLANDS[i].cx, y - ISLANDS[i].cy); if (dd < bd) { bd = dd; k = i; } }
    return [k, bd];
  };
  const LIQUID = (t) => t === G.WATER || t === G.DEEP || t === G.LAVA;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < NW && y < NW) continue;
      const [k, d] = nearestIsland(x, y);
      const I = ISLANDS[k], biome = I.biome;
      const n = fbm(x / 18, y / 18, seed + 40 * k);
      const m = 1 - Math.pow(d / I.rad, 1.8) + (n - 0.5) * 0.55;
      const shore = biome === 'tundra' ? G.ICE : biome === 'volcano' ? G.BASALT : G.SAND;
      let t;
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) t = G.DEEP;
      else if (m < 0.02) t = G.DEEP;
      else if (m < 0.1) t = G.WATER;
      else if (m < 0.16) t = shore;
      else if (biome === 'desert') {
        t = G.DUNE;
        const lake = fbm(x / 10 + 90, y / 10 + 90, seed + 43);
        if (d > 16) { if (lake > 0.7) t = G.WATER; else if (lake > 0.66) t = G.SAND; }
      } else if (biome === 'tundra') {
        t = G.SNOW;
        const lake = fbm(x / 10 + 130, y / 10 + 130, seed + 47);
        if (d > 16) { if (lake > 0.73) t = G.WATER; else if (lake > 0.62) t = G.ICE; }
      } else {
        t = fbm(x / 8 + 170, y / 8 + 170, seed + 53) > 0.55 ? G.ASH : G.BASALT;
        const lava = fbm(x / 9 + 120, y / 9 + 120, seed + 57);
        if (d > 15) { if (lava > 0.68) t = G.LAVA; else if (lava > 0.64) t = G.BASALT; }
      }
      g[idx(x, y)] = t;
    }
  }
  const nextToWater = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inb(x + dx, y + dy) && g[idx(x + dx, y + dy)] === G.WATER);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < NW && y < NW) continue;
      const t = g[idx(x, y)];
      if (LIQUID(t)) continue;
      const r = hash2(x, y, seed + 61), clump = fbm(x / 6, y / 6, seed + 65);
      if (t === G.DUNE) { if (r < (clump > 0.6 ? 0.05 : 0.016)) o[idx(x, y)] = O.CACTUS; }
      else if (t === G.SAND) { if (r < 0.12 && nextToWater(x, y)) o[idx(x, y)] = O.PALM; }
      else if (t === G.SNOW) { if (r < (clump > 0.52 ? 0.2 : 0.05)) o[idx(x, y)] = O.SNOWPINE; }
      else if (t === G.BASALT || t === G.ASH) { if (r < 0.022) o[idx(x, y)] = O.BROCK; }
      if (o[idx(x, y)] === O.NONE && hash2(x, y, seed + 67) < 0.012) {
        if (t === G.SNOW || t === G.ICE) o[idx(x, y)] = O.ICEROCK;
        else if (t === G.DUNE) o[idx(x, y)] = O.ROCK;
      }
    }
  }
  const GROUND_OF = { 1: G.DUNE, 2: G.SNOW, 3: G.BASALT };
  for (const b of BOSSES.slice(1)) ruin(b.x, b.y, 9, 0.62, [Math.PI * 0.75, Math.PI * 0.25], GROUND_OF[nearestIsland(b.x, b.y)[0]]);
  for (const c of CAMPS.slice(1)) ruin(c.x, c.y, 7, 0.3, [-Math.PI * 0.25, 0, Math.PI * 0.5], GROUND_OF[nearestIsland(c.x, c.y)[0]]);

  // towns of the new islands: walled, four gates, four houses
  TOWNS.slice(1).forEach((t) => {
    const outer = GROUND_OF[t.island];
    for (let y = t.cy - t.r - 3; y <= t.cy + t.r + 3; y++) {
      for (let x = t.cx - t.r - 3; x <= t.cx + t.r + 3; x++) {
        if (!inb(x, y)) continue;
        const ch = Math.max(Math.abs(x - t.cx), Math.abs(y - t.cy));
        o[idx(x, y)] = O.NONE;
        if (ch <= t.r) {
          g[idx(x, y)] = G.FLOOR;
          if (ch === t.r) {
            const gate = (Math.abs(x - t.cx) <= 1 && Math.abs(y - t.cy) === t.r) || (Math.abs(y - t.cy) <= 1 && Math.abs(x - t.cx) === t.r);
            if (!gate) o[idx(x, y)] = O.WALL;
          }
        } else if (LIQUID(g[idx(x, y)]) || g[idx(x, y)] === G.SAND || g[idx(x, y)] === G.ICE) {
          g[idx(x, y)] = outer;
        }
      }
    }
    for (const [dx, dy] of [[-6, -6], [3, -6], [-6, 4], [3, 4]]) {
      const h = { x: t.cx + dx, y: t.cy + dy, w: 4, h: 3 };
      houses.push(h);
      for (let j = 0; j < h.h; j++) for (let i = 0; i < h.w; i++) o[idx(h.x + i, h.y + j)] = O.HOUSE;
    }
  });

  // roads and bridges: between the islands, and out to every arena and camp
  const [nw, ne, sw, se] = TOWNS;
  carve(nw.cx + nw.r + 1, nw.cy, ne.cx - ne.r - 1, ne.cy, seed + 71);
  carve(nw.cx, nw.cy + nw.r + 1, sw.cx, sw.cy - sw.r - 1, seed + 72);
  carve(ne.cx, ne.cy + ne.r + 1, se.cx, se.cy - se.r - 1, seed + 73);
  carve(sw.cx + sw.r + 1, sw.cy, se.cx - se.r - 1, se.cy, seed + 74);
  carve(ne.cx, ne.cy - ne.r - 1, BOSSES[1].x - 1, BOSSES[1].y + 9, seed + 75);
  carve(sw.cx - sw.r - 1, sw.cy, BOSSES[2].x + 3, BOSSES[2].y - 9, seed + 76);
  carve(se.cx + se.r + 1, se.cy, BOSSES[3].x - 2, BOSSES[3].y - 9, seed + 77);
  carve(ne.cx + ne.r + 1, ne.cy, CAMPS[1].x - 2, CAMPS[1].y - 8, seed + 78);
  carve(sw.cx, sw.cy + sw.r + 1, CAMPS[2].x - 7, CAMPS[2].y, seed + 79);
  carve(se.cx, se.cy + se.r + 1, CAMPS[3].x + 7, CAMPS[3].y, seed + 80);

  return { g, o, houses, towns: TOWNS, spawn: { x: cx, y: cy + 3 } };
}

/**
 * Sunken Crypt: a snake of rooms joined by 3-wide corridors on the same 128x128 grid, so the
 * overworld renderer and pathfinding work unchanged. Deterministic from the seed.
 */
export function generateDungeon(seed, theme = 'crypt') {
  const g = new Uint8Array(W * H).fill(G.VOID);
  const o = new Uint8Array(W * H);
  const idx = (x, y) => y * W + x;
  const r = rng(seed);
  // the crypt is a snake of 8 rooms; the frozen depths wind through 10, the ember forge through 11 (every step is to an adjacent cell)
  const cells = theme === 'ice'
    ? [[0, 2], [1, 2], [1, 1], [0, 1], [0, 0], [1, 0], [2, 0], [2, 1], [3, 1], [3, 0]]
    : theme === 'fire'
      ? [[0, 2], [1, 2], [2, 2], [3, 2], [3, 1], [2, 1], [1, 1], [0, 1], [0, 0], [1, 0], [2, 0]] // the forge: a long serpentine of 11 rooms
      : [[0, 2], [1, 2], [2, 2], [2, 1], [1, 1], [1, 0], [2, 0], [3, 0]];
  const FLOOR = theme === 'ice' ? G.FROST : theme === 'fire' ? G.EMBER : G.CRYPT;
  const rooms = cells.map(([cx, cy], i) => {
    const boss = i === cells.length - 1, entry = i === 0;
    const w = boss ? 22 + Math.floor(r() * 4) : entry ? 11 : 12 + Math.floor(r() * 9);
    const h = boss ? 20 + Math.floor(r() * 4) : entry ? 10 : 11 + Math.floor(r() * 8);
    const x = cx * 32 + 2 + Math.floor(r() * (28 - w));
    const y = 16 + cy * 32 + 2 + Math.floor(r() * (28 - h));
    return { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), boss, entry };
  });
  const carve = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g[idx(x, y)] = FLOOR; };
  for (const rm of rooms) carve(rm.x, rm.y, rm.w, rm.h);
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    carve(Math.min(a.cx, b.cx) - 1, a.cy - 1, Math.abs(a.cx - b.cx) + 3, 3);
    carve(b.cx - 1, Math.min(a.cy, b.cy) - 1, 3, Math.abs(a.cy - b.cy) + 3);
  }
  for (const rm of rooms) {
    if (rm.entry || rm.w < 14 || rm.h < 12) continue;
    const spots = [[3, 3], [rm.w - 4, 3], [3, rm.h - 4], [rm.w - 4, rm.h - 4]];
    if (rm.boss) spots.push([rm.w >> 1, 3], [rm.w >> 1, rm.h - 4]);
    for (const [dx, dy] of spots) o[idx(rm.x + dx, rm.y + dy)] = O.PILLAR;
  }
  // walls: every void tile touching a floor tile
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (g[idx(x, y)] !== G.VOID) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (g[idx(x + dx, y + dy)] === FLOOR) { near = true; break; }
      if (near) o[idx(x, y)] = O.WALL;
    }
  }
  const e = rooms[0];
  return { g, o, houses: [], dungeon: true, theme, rooms, spawn: { x: e.cx + 1, y: e.cy }, exit: { x: e.x + 1, y: e.cy } };
}
