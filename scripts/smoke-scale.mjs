// Scale + loot test: sleeping monsters, delta packets (equivalence + bandwidth), zone resets, party loot protection.
//
// Timing policy (this test used to flake when it ran first inside `npm test`, on a cold and busy machine): every wait is on
// server-reported state (a position, an entity, gold or a log line arriving) with a generous deadline, never a fixed sleep.
// The one real-time quantity, the 8 s loot lock, runs on the server's wall clock, so the stranger check retries with a fresh
// kill whenever the attempt landed too late to prove anything - while an attempt inside the lock window must still be refused.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { PORTAL_ID } from '../shared/data.js';
import { generateDungeon } from '../shared/world.js';

const PORT = 3989 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0); // set EM_TEST_PORT_OFFSET to run beside another test run
const SAVE = 'data/test-saves-scale.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** poll until `fn` returns something truthy (returned) or the deadline passes (null) */
const until = async (fn, ms = 5000, step = 40) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await wait(step);
  }
};
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const diag = [];
const fail = (m) => { console.error('FAIL:', m); if (diag.length) console.error(`   last steps:\n   ${diag.slice(-12).join('\n   ')}`); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };
const status = async () => (await fetch(`http://localhost:${PORT}/api/status`)).json();

/** a bot that understands both packet styles; `map` is the entity set a real client would hold */
async function bot(name, { delta = false, cls = 'warrior' } = {}) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, map: new Map(), bytes: 0, packets: 0, logs: [], zone: null, party: null, inv: null, ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => {
    const raw = d.toString(), m = JSON.parse(raw);
    if (m.t === 's') {
      b.bytes += raw.length; b.packets++;
      if (m.d) { for (const e of m.e) b.map.set(e.i, e); for (const id of m.r) b.map.delete(id); }
      else { b.map = new Map(m.e.map((e) => [e.i, e])); }
    } else if (m.t === 'me') b.me = m; else if (m.t === 'log') b.logs.push(m.m); else if (m.t === 'party') b.party = m; else if (m.t === 'pinv') b.inv = m;
    else if (m.t === 'zone') { b.zone = m; b.map = new Map(); } else if (m.t === 'welcome') b.zone = m.zone; else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'test', cls, delta });
  b.pos = () => (b.me ? b.map.get(b.me.id) : undefined);
  if (!(await until(() => b.me && b.pos(), 15000))) fail(`${name}: no me message / first snapshot`);
  b.tp = async (x, y) => {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2]]) {
      b.tx({ t: 'dbg', tp: [x + dx, y + dy] });
      if (await until(() => { const p = b.pos(); return p && p.x === x + dx && p.y === y + dy; }, 1500)) return true;
    }
    return false;
  };
  return b;
}

if (!(await until(() => out.includes('listening'), 20000, 100))) fail('server did not start: ' + out);

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
await wait(6000); // a fixed window on purpose: bandwidth is measured per unit of time
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
  const px = 27 + (i % 3), py = 98 + (i >> 1);
  D.tx({ t: 'dbg', tp: [px, py] });
  await until(() => { const q = D.pos(); return q && q.x === px && q.y === py; }, 1500);
  const q = D.pos();
  if (q && Math.hypot(q.x - 28, q.y - 96) <= 4) { D.tx({ t: 'talk', id: PORTAL_ID }); await until(() => D.zone.kind === 'dungeon', 3000); }
}
ok(D.zone.kind === 'dungeon', 'the delta client entered the crypt');
const rm = generateDungeon(D.zone.seed).rooms[2];
D.tx({ t: 'dbg', god: true }); await D.tp(rm.cx, rm.cy); // the entry room is empty: go where monsters are
await until(() => [...D.map.values()].some((e) => e.k === 'm'), 4000);
const types = new Set([...D.map.values()].filter((e) => e.k === 'm').map((e) => e.s));
ok(types.size > 0 && [...types].every((t) => ['skeleton', 'ghoul', 'wraith', 'bonelord'].includes(t)), `no leftovers from the overworld after the zone change (${[...types].join(', ')})`);
await D.tp(generateDungeon(D.zone.seed).exit.x + 2, generateDungeon(D.zone.seed).exit.y); D.tx({ t: 'talk', id: 6 });
await until(() => D.zone.kind === 'world' && D.map.size > 1, 4000);
ok(D.zone.kind === 'world' && D.map.size > 1, 'and entities are rebuilt after coming back');
ok((await status()).tickMs < 8, 'ticks stay well inside the 50 ms budget with players online');

// ---------------------------------------------------------------- party loot protection
const LOCK_MS = 8000, SAFE_MS = 5000; // a stranger's attempt only proves the lock if it happens well inside the lock window
const drops = (b) => [...b.map.values()].filter((e) => e.k === 'd');
/** kill slimes until a fresh gold drop appears (a monster leaving view is not a kill); returns that drop plus when we first saw it */
const killForDrop = async (b, seen) => {
  const skip = new Set();
  for (let tries = 0; tries < 10; tries++) {
    const me = b.pos();
    const m = [...b.map.values()].filter((e) => e.k === 'm' && e.s === 'slime' && !skip.has(e.i)).sort((x, y) => Math.hypot(x.x - me.x, x.y - me.y) - Math.hypot(y.x - me.x, y.y - me.y))[0];
    if (!m) { diag.push(`${b.name} try ${tries}: no slime in view at ${me.x},${me.y} (${b.map.size} entities)`); await b.tp(me.x, me.y + 4); await wait(400); continue; }
    // stand on an adjacent tile (melee range is 1.5); the nearest one may be occupied
    let adj = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      b.tx({ t: 'dbg', tp: [m.x + dx, m.y + dy] });
      if (await until(() => { const q = b.pos(); return q && q.x === m.x + dx && q.y === m.y + dy; }, 700)) { adj = true; break; }
    }
    diag.push(`${b.name} try ${tries}: slime ${m.i} at ${m.x},${m.y}; adjacent ${adj}`);
    if (!adj) { skip.add(m.i); continue; }
    b.tx({ t: 'target', id: m.i });
    const d = await until(() => drops(b).find((x) => x.g && !seen.has(x.i)), 3500);
    if (d) return { ...d, seenAt: Date.now() };
    skip.add(m.i); // wandered off or already dead without a visible drop: try another
  }
  return null;
};
/**
 * Stand exactly on the drop tile (a wandering monster may block it for a moment), try to loot, and report what the server
 * answered: 'gold' (it paid out), 'reserved' (it said the loot is locked) or null (no answer / never reached the tile).
 */
const collectAt = async (b, d) => {
  for (let i = 0; i < 8; i++) {
    b.tx({ t: 'dbg', tp: [d.x, d.y] });
    if (await until(() => { const p = b.pos(); return p && p.x === d.x && p.y === d.y; }, 1200)) {
      const g0 = b.me.gold, n0 = b.logs.length;
      b.tx({ t: 'dbg', collect: true });
      const got = await until(() => (b.me.gold > g0 ? 'gold' : b.logs.slice(n0).some((l) => /reserved for the party that earned it/.test(l)) ? 'reserved' : null), 3500);
      diag.push(`${b.name} collect at ${d.x},${d.y}: ${got}`);
      return got;
    }
    await wait(300);
  }
  return null;
};
const A = await bot('LootAlpha'), B = await bot('LootBeta');
for (const b of [A, B]) b.tx({ t: 'dbg', god: true, atkMul: 500 });
await A.tp(64, 84); await B.tp(64, 80);

// a stranger cannot take fresh loot. If the machine is so loaded that the attempt lands after the lock ran out, the result
// proves nothing either way, so try again with a fresh kill; an attempt inside the lock window must be refused.
let drop = null, refused = false;
for (let attempt = 0; attempt < 5 && !refused; attempt++) {
  drop = await killForDrop(A, new Set(drops(A).map((d) => d.i)));
  if (attempt === 0) ok(!!drop, 'A killed a slime and it dropped gold');
  else if (!drop) fail('could not get a fresh drop for the retry');
  await A.tp(drop.x + 4, drop.y); // nobody may stand on the drop tile
  const got = await collectAt(B, drop);
  const age = Date.now() - drop.seenAt;
  if (got === 'reserved') refused = true;
  else if (got === 'gold' && age < SAFE_MS) fail(`a stranger took fresh loot ${age} ms after it appeared (the lock lasts ${LOCK_MS} ms)`);
  else diag.push(`attempt ${attempt} inconclusive: answer ${got}, ${age} ms after the drop appeared`);
}
ok(refused, 'a stranger cannot take fresh loot (and is told why)');
await B.tp(64, 78); // step off the drop tile
ok((await collectAt(A, drop)) === 'gold', 'the killer can');

// after the lock expires anyone can loot
const drop2 = await killForDrop(A, new Set([...drops(A).map((d) => d.i), drop.i]));
ok(!!drop2, 'a second kill drops gold');
await A.tp(drop2.x + 4, drop2.y);
await until(() => Date.now() - drop2.seenAt > LOCK_MS + 700, 15000, 100); // the lock started at or before the moment we saw the drop
ok((await collectAt(B, drop2)) === 'gold', 'once the 8 second lock runs out, anyone can pick it up');

// party members share the lock
const C = await bot('LootGamma'), E = await bot('LootDelta');
for (const b of [C, E]) b.tx({ t: 'dbg', god: true, atkMul: 500 });
C.tx({ t: 'pinvite', name: 'LootDelta' });
await until(() => E.inv, 3000); // the invite has arrived: answer it
E.tx({ t: 'pgo', ok: true });
ok(await until(() => C.party && C.party.members.length === 2 && E.party && E.party.members.length === 2, 5000), 'the two heroes are in one party');
await C.tp(80, 90); await E.tp(79, 90);
const drop3 = await killForDrop(C, new Set(drops(C).map((d) => d.i)));
ok(!!drop3, 'the party killed a slime and it dropped gold');
await C.tp(drop3.x + 4, drop3.y); await E.tp(drop3.x - 4, drop3.y);
ok((await collectAt(E, drop3)) === 'gold', 'a party member can take loot the party earned straight away');

console.log('SCALE SMOKE OK');
done(0);
