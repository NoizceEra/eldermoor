// Second dungeon: The Frozen Depths. Enter, isolation from the crypt, ice theme, 10 rooms, boss + loot, exit, party sharing.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { generateDungeon, isSolid, G } from '../shared/world.js';
import { DUNGEONS, PORTAL_ID, PORTAL2_ID, EXIT_ID, MOBS } from '../shared/data.js';

const PORT = 3990;
const SAVE = 'data/test-saves-frozen.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1', EM_INSTANCE_TTL: '2500' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };
const status = async () => (await fetch(`http://localhost:${PORT}/api/status`)).json();
const frozen = DUNGEONS.find((d) => d.id === 'frozen'), crypt = DUNGEONS.find((d) => d.id === 'crypt');

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], logs: [], zone: null, ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'zone') b.zone = m; else if (m.t === 'welcome') b.zone = m.zone; else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'x', cls: 'warrior' });
  await wait(450);
  if (!b.me) fail(`${name}: no me message`);
  b.tx({ t: 'dbg', god: true }); await wait(150);
  b.pos = () => b.ents.find((e) => e.i === b.me.id);
  b.tp = async (x, y) => {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2], [-2, 0]]) {
      b.tx({ t: 'dbg', tp: [x + dx, y + dy] });
      await wait(150);
      const p = b.pos();
      if (p && p.x === x + dx && p.y === y + dy) return true;
    }
    return false;
  };
  return b;
}

await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);
ok(DUNGEONS.length === 2 && frozen.rec > crypt.rec && MOBS[frozen.boss].boss, 'two dungeons are registered; the frozen one is higher level with a boss');

const A = await bot('FrostAlpha');
ok(A.zone.npcs.some((n) => n.id === PORTAL2_ID && n.name === 'The Frozen Depths') && A.zone.npcs.some((n) => n.id === PORTAL_ID), 'the overworld has both dungeon portals');
ok(await A.tp(frozen.portal.x, frozen.portal.y + 2), 'teleported beside the Frozen Depths portal');
A.tx({ t: 'talk', id: PORTAL2_ID }); await wait(600);
ok(A.zone.kind === 'dungeon' && A.zone.theme === 'ice' && A.zone.name === 'The Frozen Depths', 'the portal leads to the ice-themed Frozen Depths');
const dz = generateDungeon(A.zone.seed, 'ice');
ok(dz.rooms.length === 10 && dz.g.includes(G.FROST) && !dz.g.includes(G.CRYPT), 'the client can rebuild a 10-room frost dungeon from the seed');
const pos = A.pos();
ok(pos && !isSolid(dz, pos.x, pos.y), 'A stands on open floor');
ok(A.logs.some((l) => /Frozen Depths is deadly below level 34/.test(l)), 'a low-level hero is warned about the recommended level');
const st1 = await status();
ok(st1.instances === 1, 'one instance exists');

// monsters are the frozen set
A.tx({ t: 'dbg', atkMul: 600, lvl: 40 }); await wait(250);
const boss = dz.rooms.at(-1);
ok(await A.tp(boss.x + 2, boss.cy), 'teleported into the boss room');
await wait(600);
const types = new Set(A.ents.filter((e) => e.k === 'm').map((e) => e.s));
ok([...types].every((t) => ['frostslime', 'snowwolf', 'frostsprite', 'yeti', 'icegolem', 'glacius'].includes(t)), `only frozen monsters here (${[...types].join(', ')})`);
ok(types.has('glacius'), 'Glacius is waiting in the boss room');

let killed = false, last = null, still = 0;
for (let i = 0; i < 500 && !killed; i++) {
  const b = A.ents.find((e) => e.k === 'm' && e.s === 'glacius');
  if (!b) { killed = A.logs.some((l) => /falls/.test(l)); await wait(150); continue; }
  const me = A.pos();
  A.tx({ t: 'target', id: b.i });
  still = last && last.x === me.x && last.y === me.y ? still + 1 : 0;
  last = { x: me.x, y: me.y };
  if (Math.hypot(b.x - me.x, b.y - me.y) > 1.4) {
    const horiz = Math.abs(b.x - me.x) >= Math.abs(b.y - me.y);
    let dx = horiz ? Math.sign(b.x - me.x) : 0, dy = horiz ? 0 : Math.sign(b.y - me.y);
    if (still >= 2) [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
    A.tx({ t: 'move', dx, dy });
  } else A.tx({ t: 'skill', n: 1 });
  await wait(160);
}
ok(A.logs.some((l) => /Glacius, the Frozen King falls/.test(l)), 'Glacius falls and the victory message arrives');
await wait(400);
ok(A.ents.some((d) => d.k === 'd' && !d.g && d.r >= 2) || A.me.inv.some((it) => it && it.r >= 2), 'the boss dropped rare+ gear');

// exit lands beside the frozen portal, not the crypt's
const ex = dz.exit;
ok(await A.tp(ex.x + 2, ex.y), 'walked to the exit');
A.tx({ t: 'talk', id: EXIT_ID }); await wait(600);
const back = A.pos();
ok(A.zone.kind === 'world' && Math.hypot(back.x - frozen.portal.x, back.y - (frozen.portal.y + 2)) < 6, `exit returns you beside the Frozen Depths portal (${back.x},${back.y})`);

// the two dungeons are separate instances, even for one hero
await A.tp(crypt.portal.x, crypt.portal.y + 2);
A.tx({ t: 'talk', id: PORTAL_ID }); await wait(600);
ok(A.zone.theme === 'crypt' && A.zone.name === 'The Sunken Crypt', 'the other portal still leads to the crypt');
ok((await status()).instances === 2, 'crypt and frozen instances coexist');
A.tx({ t: 'talk', id: EXIT_ID }); await wait(500);

// party members share one frozen instance
const C = await bot('FrostGamma'), D = await bot('FrostDelta');
C.tx({ t: 'pinvite', name: 'FrostDelta' }); await wait(300);
D.tx({ t: 'pgo', ok: true }); await wait(400);
await C.tp(frozen.portal.x, frozen.portal.y + 2); await D.tp(frozen.portal.x, frozen.portal.y + 2);
C.tx({ t: 'talk', id: PORTAL2_ID }); await wait(500); D.tx({ t: 'talk', id: PORTAL2_ID }); await wait(500);
ok(C.zone.kind === 'dungeon' && C.zone.id === D.zone.id && C.zone.theme === 'ice', 'a party shares one Frozen Depths instance');

// cleanup after everyone leaves
for (const b of [A, C, D]) b.ws.close();
await wait(5500);
ok((await status()).instances === 0, 'empty frozen/crypt instances are removed');

console.log('FROZEN SMOKE OK');
done(0);
