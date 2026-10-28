// Scale + loot test: sleeping monsters, delta packets (equivalence + bandwidth), zone resets, party loot protection.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { PORTAL_ID } from '../shared/data.js';
import { generateDungeon } from '../shared/world.js';

const PORT = 3989;
const SAVE = 'data/test-saves-scale.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const diag = [];
const fail = (m) => { console.error('FAIL:', m); if (diag.length) console.error(`   last steps:\n   ${diag.slice(-12).join('\n   ')}`); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };
const status = async () => (await fetch(`http://localhost:${PORT}/api/status`)).json();

/** a bot that understands both packet styles; `map` is the entity set a real client would hold */
async function bot(name, { delta = false, cls = 'warrior' } = {}) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, map: new Map(), bytes: 0, packets: 0, logs: [], zone: null, ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => {
    const raw = d.toString(), m = JSON.parse(raw);
    if (m.t === 's') {
      b.bytes += raw.length; b.packets++;
      if (m.d) { for (const e of m.e) b.map.set(e.i, e); for (const id of m.r) b.map.delete(id); }
      else { b.map = new Map(m.e.map((e) => [e.i, e])); }
    } else if (m.t === 'me') b.me = m; else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'zone') { b.zone = m; b.map = new Map(); } else if (m.t === 'welcome') b.zone = m.zone; else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'x', cls, delta });
  for (let i = 0; i < 40 && !b.me; i++) await wait(100);
  if (!b.me) fail(`${name}: no me message`);
  await wait(250); // let the first state packets arrive
  b.pos = () => b.map.get(b.me.id);
  b.tp = async (x, y) => {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2]]) {
      b.tx({ t: 'dbg', tp: [x + dx, y + dy] });
      await wait(160);
      const p = b.pos();
      if (p && p.x === x + dx && p.y === y + dy) return true;
    }
    return false;
  };
  return b;
}

await wait(1800);
if (!out.includes('listening')) fail('server did not start: ' + out);

// ---------------------------------------------------------------- idle world
const idle = await status();
ok(idle.mobs > 500 && idle.awake === 0, `with nobody online every monster sleeps (${idle.mobs} monsters, ${idle.awake} awake)`);
ok(idle.tickMs < 3, `an idle server tick is cheap (${idle.tickMs} ms)`);

// ---------------------------------------------------------------- delta vs full packets
const F = await bot('ScaleFull'), D = await bot('ScaleDelta', { delta: true });
for (const b of [F, D]) b.tx({ t: 'dbg', god: true });
await F.tp(64, 84); await D.tp(63, 84);
await wait(500);
F.bytes = D.bytes = F.packets = D.packets = 0;
await wait(6000);
const awake = (await status()).awake;
ok(awake > 0 && awake < 300, `only monsters near players wake up (${awake} of ${idle.mobs})`);
const near = (e) => Math.abs(e.x - 64) <= 24 && Math.abs(e.y - 84) <= 14; // both view windows overlap here (they differ by a tile at the edges)
const fIds = new Set([...F.map.values()].filter(near).map((e) => e.i)), dIds = new Set([...D.map.values()].filter(near).map((e) => e.i));
const common = [...fIds].filter((id) => dIds.has(id));
ok(fIds.size > 15 && common.length / Math.max(fIds.size, dIds.size) > 0.9, `delta and full clients hold the same entities (${fIds.size} vs ${dIds.size}, ${common.length} shared)`);
const same = common.filter((id) => { const a = F.map.get(id), c = D.map.get(id); return a.x === c.x && a.y === c.y && a.h === c.h; }).length;
ok(same / common.length > 0.93, `and the same positions and health (${same}/${common.length})`);
ok(D.bytes < F.bytes * 0.6, `delta packets use far less bandwidth (${D.bytes} vs ${F.bytes} bytes in 6s, ${Math.round((D.bytes / F.bytes) * 100)}%)`);
ok(D.packets > 10, 'delta clients still receive regular keep-alive packets');

// a delta client survives a zone change: entities are reset and rebuilt
for (let i = 0; i < 6 && D.zone.kind !== 'dungeon'; i++) { // monsters guard the portal: retry until we stand close enough
  D.tx({ t: 'dbg', tp: [27 + (i % 3), 98 + (i >> 1)] }); await wait(500);
  const q = D.pos();
  if (q && Math.hypot(q.x - 28, q.y - 96) <= 4) { D.tx({ t: 'talk', id: PORTAL_ID }); await wait(1200); }
}
ok(D.zone.kind === 'dungeon', 'the delta client entered the crypt');
const rm = generateDungeon(D.zone.seed).rooms[2];
D.tx({ t: 'dbg', god: true }); await D.tp(rm.cx, rm.cy); await wait(700); // the entry room is empty: go where monsters are
const types = new Set([...D.map.values()].filter((e) => e.k === 'm').map((e) => e.s));
ok(types.size > 0 && [...types].every((t) => ['skeleton', 'ghoul', 'wraith', 'bonelord'].includes(t)), `no leftovers from the overworld after the zone change (${[...types].join(', ')})`);
await D.tp(generateDungeon(D.zone.seed).exit.x + 2, generateDungeon(D.zone.seed).exit.y); D.tx({ t: 'talk', id: 6 }); await wait(1200);
ok(D.zone.kind === 'world' && D.map.size > 1, 'and entities are rebuilt after coming back');
ok((await status()).tickMs < 8, 'ticks stay well inside the 50 ms budget with players online');

// ---------------------------------------------------------------- party loot protection
const drops = (b) => [...b.map.values()].filter((e) => e.k === 'd');
/** kill slimes until a fresh gold drop appears (a monster leaving view is not a kill); returns that drop */
const killForDrop = async (b, seen) => {
  const skip = new Set();
  for (let tries = 0; tries < 10; tries++) {
    const me = b.pos();
    const m = [...b.map.values()].filter((e) => e.k === 'm' && e.s === 'slime' && !skip.has(e.i)).sort((x, y) => Math.hypot(x.x - me.x, x.y - me.y) - Math.hypot(y.x - me.x, y.y - me.y))[0];
    if (!m) { diag.push(`${b.name} try ${tries}: no slime in view at ${me.x},${me.y} (${b.map.size} entities)`); await b.tp(me.x, me.y + 4); await wait(400); continue; }
    // stand on an adjacent tile (melee range is 1.5); the nearest one may be occupied
    let adj = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      b.tx({ t: 'dbg', tp: [m.x + dx, m.y + dy] }); await wait(170);
      const q = b.pos();
      if (q && q.x === m.x + dx && q.y === m.y + dy) { adj = true; break; }
    }
    diag.push(`${b.name} try ${tries}: slime ${m.i} at ${m.x},${m.y}; adjacent ${adj}`);
    if (!adj) { skip.add(m.i); continue; }
    b.tx({ t: 'target', id: m.i });
    for (let i = 0; i < 10; i++) {
      await wait(250);
      const d = drops(b).find((x) => x.g && !seen.has(x.i));
      if (d) return d;
    }
    skip.add(m.i); // wandered off or already dead without a visible drop: try another
  }
  return null;
};
/** stand exactly on the drop tile (a wandering monster may block it for a moment) and try to loot */
const collectAt = async (b, d) => {
  for (let i = 0; i < 6; i++) {
    b.tx({ t: 'dbg', tp: [d.x, d.y] }); await wait(250);
    const p = b.pos();
    if (p && p.x === d.x && p.y === d.y) { b.tx({ t: 'dbg', collect: true }); await wait(400); return true; }
    await wait(400);
  }
  return false;
};
const A = await bot('LootAlpha'), B = await bot('LootBeta');
for (const b of [A, B]) b.tx({ t: 'dbg', god: true, atkMul: 500 });
await A.tp(64, 84); await B.tp(64, 80); await wait(500);
const before = new Set(drops(A).map((d) => d.i));
const drop = await killForDrop(A, before);
ok(!!drop, 'A killed a slime and it dropped gold');
await A.tp(drop.x + 4, drop.y); await wait(200); // nobody may stand on the drop tile
const gB0 = B.me.gold;
const onTile = await collectAt(B, drop);
ok(onTile && B.me.gold === gB0 && B.logs.some((l) => /reserved for the party that earned it/.test(l)), 'a stranger cannot take fresh loot (and is told why)');
await B.tp(64, 78); await wait(200); // step off the drop tile
const gA0 = A.me.gold;
const aOn = await collectAt(A, drop);
ok(aOn && A.me.gold > gA0, 'the killer can');

// after the lock expires anyone can loot
const before2 = new Set([...before, drop.i, ...drops(A).map((d) => d.i)]);
const drop2 = await killForDrop(A, before2);
ok(!!drop2, 'a second kill drops gold');
await A.tp(drop2.x + 4, drop2.y);
await wait(9000);
const gB1 = B.me.gold;
const bOn = await collectAt(B, drop2);
ok(bOn && B.me.gold > gB1, 'once the 8 second lock runs out, anyone can pick it up');

// party members share the lock
const C = await bot('LootGamma'), E = await bot('LootDelta');
for (const b of [C, E]) b.tx({ t: 'dbg', god: true, atkMul: 500 });
C.tx({ t: 'pinvite', name: 'LootDelta' }); await wait(300);
E.tx({ t: 'pgo', ok: true }); await wait(400);
await C.tp(80, 90); await E.tp(79, 90); await wait(500);
const before3 = new Set(drops(C).map((d) => d.i));
const drop3 = await killForDrop(C, before3);
ok(!!drop3, 'the party killed a slime and it dropped gold');
await C.tp(drop3.x + 4, drop3.y); await E.tp(drop3.x - 4, drop3.y); await wait(200);
const gE0 = E.me.gold;
const eOn = await collectAt(E, drop3);
ok(eOn && E.me.gold > gE0, 'a party member can take loot the party earned straight away');

console.log('SCALE SMOKE OK');
done(0);
