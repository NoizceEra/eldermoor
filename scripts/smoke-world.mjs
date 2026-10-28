// Bigger-world test: generation invariants, new regions and monsters, cross-town quests, shops, nearest-town respawn.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { W, H, G, O, TOWNS, BOSSES, CAMPS, ISLANDS, generateWorld, isSolid, regionAt, inTown } from '../shared/world.js';
import { SEED, MOBS, QUESTS, NPCS } from '../shared/data.js';

const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } else console.log('ok  -', m); };

// ---------------------------------------------------------------- pure generation checks
const world = generateWorld(SEED);
ok(W === 256 && H === 256, 'the world is 256x256');
const reach = new Uint8Array(W * H);
{
  const q = [[world.spawn.x, world.spawn.y]];
  reach[world.spawn.y * W + world.spawn.x] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (isSolid(world, nx, ny) || reach[ny * W + nx]) continue;
      reach[ny * W + nx] = 1; q.push([nx, ny]);
    }
  }
}
for (const t of TOWNS) ok(reach[(t.cy + 3) * W + t.cx], `${t.name} is reachable on foot from Eldermoor`);
for (const b of BOSSES) ok(reach[b.y * W + b.x], `boss arena "${b.id}" is reachable`);
for (const c of CAMPS) ok(reach[c.y * W + c.x], `${c.mob} camp is reachable`);
const bridges = world.g.reduce((n, v) => n + (v === G.BRIDGE ? 1 : 0), 0);
ok(bridges > 100, `islands are joined by plank bridges (${bridges} bridge tiles)`);
for (const [id, kinds] of Object.entries({ desert: [G.DUNE, O.CACTUS], tundra: [G.SNOW, O.SNOWPINE], volcano: [G.BASALT, O.BROCK] })) {
  ok(world.g.includes(kinds[0]) && world.o.includes(kinds[1]), `${id} biome has its ground and its objects`);
}
ok(world.g.includes(G.LAVA) && world.g.includes(G.ICE) && world.g.includes(G.ASH), 'lava, ice and ash exist');
ok(regionAt(64, 64).town && regionAt(70, 80).name === 'Greenmeadow' && regionAt(70, 100).name === 'Whisperwood' && regionAt(192, 100).island === 1 && regionAt(100, 130).sea, 'region lookup names towns, regions and open sea');
ok(inTown(192, 66) && inTown(62, 194) && inTown(194, 190), 'every town is a safe zone');
const spawnTypes = ['scarab', 'scorpion', 'sandviper', 'mummy', 'sandgolem', 'frostslime', 'snowwolf', 'frostowl', 'frostsprite', 'yeti', 'icegolem', 'imp', 'magmaslime', 'lavahound', 'emberknight', 'fireelem', 'obsidiangolem'];
ok(spawnTypes.every((t) => MOBS[t]) && BOSSES.every((b) => MOBS[b.mob] && MOBS[b.mob].boss), '17 new monsters and 3 new bosses are defined');
ok(QUESTS.length === 20 && QUESTS.every((q) => MOBS[q.mob] && NPCS.some((n) => n.id === q.giver && n.role === 'quest')), '20 quests, each with a real giver and target');
for (const m of Object.values(MOBS)) if (!(m.hp > 0 && m.dmg[1] >= m.dmg[0] && m.xp > 0)) ok(false, `bad monster stats ${m.name}`);

// ---------------------------------------------------------------- live server checks
const PORT = 3992;
const SAVE = 'data/test-saves-world.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok2 = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name, cls = 'warrior') {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], logs: [], dialogs: [], ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'dialog') b.dialogs.push(m); else if (m.t === 'welcome') b.zone = m.zone; else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'x', cls });
  await wait(450);
  if (!b.me) fail(`${name}: no me message`);
  b.pos = () => b.ents.find((e) => e.i === b.me.id);
  b.tp = async (x, y) => {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
      b.tx({ t: 'dbg', tp: [x + dx, y + dy] });
      await wait(140);
      const p = b.pos();
      if (p && p.x === x + dx && p.y === y + dy) return true;
    }
    return false;
  };
  return b;
}
await wait(1800);
if (!out.includes('listening')) fail('server did not start: ' + out);
const st = await (await fetch(`http://localhost:${PORT}/api/status`)).json();
ok2(st.mobs > 500, `the world is populated (${st.mobs} monsters)`);

const A = await bot('WorldAlpha');
A.tx({ t: 'dbg', god: true, lvl: 40 }); await wait(250);
ok2([10, 11, 12, 13, 14, 15, 16, 17, 18].every((id) => A.zone.npcs.some((n) => n.id === id)), 'the zone message lists the NPCs of all four towns');

// each island has its own monsters
const seenOn = async (name, x, y, types) => {
  const found = new Set();
  for (const [dx, dy] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8], [14, 6], [-14, -6]]) {
    if (!(await A.tp(x + dx, y + dy))) continue;
    await wait(400);
    for (const e of A.ents) if (e.k === 'm') found.add(e.s);
  }
  ok2(types.some((t) => found.has(t)), `${name} has its own monsters (${[...found].filter((f) => types.includes(f)).join(', ') || 'none'})`);
};
await seenOn('Sunscar Dunes', 192, 96, ['scarab', 'scorpion', 'sandviper', 'mummy']);
await seenOn('Frostmarch', 64, 224, ['frostslime', 'snowwolf', 'frostsprite', 'yeti', 'frostowl']);
await seenOn('Cinderpeak', 190, 160, ['imp', 'magmaslime', 'lavahound', 'emberknight', 'fireelem']);

// cross-town quest hand-off: quest 5 belongs to Scout Amira in Dunehaven, not Elder Mira
A.tx({ t: 'dbg', quest: 5 }); await wait(200);
await A.tp(61, 66); await wait(300); // beside Elder Mira (61,63)
A.dialogs.length = 0;
A.tx({ t: 'talk', id: 1 }); await wait(300);
ok2(A.dialogs.some((d) => /Scout Amira/.test(d.text)), 'Elder Mira points you to Scout Amira for the next quest');
A.tx({ t: 'questAccept' }); await wait(250);
ok2(A.me.quest.s === 0, 'a quest cannot be accepted from the wrong NPC');
await A.tp(190, 67); await wait(300); // beside Amira (189,65)
A.dialogs.length = 0;
A.tx({ t: 'talk', id: 11 }); await wait(300);
ok2(A.dialogs.some((d) => d.title === 'Scarab Swarm' && d.opts), 'Scout Amira offers the Scarab Swarm quest');
A.tx({ t: 'questAccept' }); await wait(250);
ok2(A.me.quest.s === 1 && A.me.quest.i === 5, 'accepted in Dunehaven');

// shops differ by town
await A.tp(194, 67); await wait(300); // beside Safiya (195,65)
A.dialogs.length = 0;
A.tx({ t: 'talk', id: 10 }); await wait(300);
const shop = A.dialogs.find((d) => d.shop);
ok2(shop && shop.shop.some((i) => /Greater Health Potion/.test(i.n)) && shop.shop.some((i) => i.l >= 20), 'Dunehaven sells Greater potions and level 20+ gear');
A.tx({ t: 'dbg', gold: 5000 }); await wait(200);
const g0 = A.me.gold;
A.tx({ t: 'buy', i: shop.shop.findIndex((i) => /Greater/.test(i.n)) }); await wait(250);
ok2(A.me.gold < g0 && A.me.inv.some((i) => i && /Greater/.test(i.n)), 'buying from the Dunehaven stock works');
await A.tp(64, 70); await wait(300); // in Eldermoor but out of range of Brom
const gFar = A.me.gold;
A.tx({ t: 'buy', i: 0 }); await wait(250);
ok2(A.me.gold === gFar, 'you cannot buy from a shop that is out of range');

// dying far from home returns you to the nearest town
const D = await bot('WorldDelta');
await D.tp(206, 36); // the Sun King's arena
let died = false;
for (let i = 0; i < 80 && !died; i++) { await wait(300); died = D.logs.some((l) => /slain by/.test(l)); }
ok2(died, 'a level 1 hero dies to the Sun King');
await wait(5200);
const dp = D.pos();
ok2(dp && Math.hypot(dp.x - 192, dp.y - 66) < 12, `respawn is in Dunehaven, not Eldermoor (${dp && dp.x},${dp && dp.y})`);

console.log('WORLD SMOKE OK');
done(0);
