// Dungeon test: enter via portal, instance isolation, party-shared instance, boss kill + loot,
// exit, death -> town, instance cleanup. Uses the server's EM_DEBUG teleport/god-mode hooks.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { generateDungeon, isSolid } from '../shared/world.js';
import { PORTAL_ID, EXIT_ID, MOBS } from '../shared/data.js';

const PORT = 3997 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0); // set EM_TEST_PORT_OFFSET to run beside another test run
const SAVE = 'data/test-saves-dungeon.json';
const srv = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1', EM_INSTANCE_TTL: '2500' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };
const status = async () => (await fetch(`http://localhost:${PORT}/api/status`)).json();

async function bot(name, cls = 'warrior', god = true) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], logs: [], zone: null, zones: [], tx: (o) => ws.send(JSON.stringify(o)), ws };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'zone') { b.zone = m; b.zones.push(m); } else if (m.t === 'welcome') { b.zone = m.zone; b.zones.push(m.zone); } else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'x', cls });
  for (let i = 0; i < 40 && !b.me; i++) await wait(100);
  if (!b.me) fail(`${name}: no me message`);
  await wait(250); // let the first state packets arrive
  if (god) { b.tx({ t: 'dbg', god: true }); await wait(150); } // the skeleton camp surrounds the portal
  b.pos = () => b.ents.find((e) => e.i === b.me.id);
  b.tp = async (x, y) => {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2]]) {
      b.tx({ t: 'dbg', tp: [x + dx, y + dy] });
      await wait(160);
      const p = b.pos();
      if (p && p.x === x + dx && p.y === y + dy) return true;
    }
    return false;
  };
  b.enter = async () => { b.tx({ t: 'talk', id: PORTAL_ID }); await wait(500); };
  b.leave = async () => { b.tx({ t: 'talk', id: EXIT_ID }); await wait(500); };
  return b;
}

await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);
const st0 = await status();

// --- A: enter solo
const A = await bot('CryptAlpha');
ok(A.zone.kind === 'world', 'login starts in the overworld');
ok(A.zone.npcs.some((n) => n.role === 'portal'), 'overworld has the Sunken Crypt portal');
ok(await A.tp(28, 98), 'teleported next to the portal');
await A.enter();
ok(A.zone.kind === 'dungeon', 'portal moves A into a dungeon zone');
const dz = generateDungeon(A.zone.seed);
const pos = A.pos();
ok(pos && !isSolid(dz, pos.x, pos.y), 'A stands on open crypt floor');
ok(A.zone.npcs.length === 1 && A.zone.npcs[0].id === EXIT_ID, 'dungeon has only the exit portal');
const st1 = await status();
ok(st1.instances === 1, 'one instance exists');
ok(st1.mobs === st0.mobs, `overworld monster count untouched (${st0.mobs})`);

// --- boss fight with test god-mode
A.tx({ t: 'dbg', atkMul: 400, lvl: 30 });
await wait(200);
const bossRoom = dz.rooms.at(-1);
ok(await A.tp(bossRoom.x + 2, bossRoom.cy), 'teleported into the boss room');
await wait(500);
const types = new Set(A.ents.filter((e) => e.k === 'm').map((e) => e.s));
ok([...types].every((t) => ['skeleton', 'ghoul', 'wraith', 'bonelord'].includes(t)), `only crypt monsters here (${[...types].join(', ')})`);
const boss = A.ents.find((e) => e.k === 'm' && e.s === 'bonelord');
ok(!!boss, 'The Bone Lord is present');
let killed = false, last = null, still = 0;
for (let i = 0; i < 400 && !killed; i++) {
  const b = A.ents.find((e) => e.k === 'm' && e.s === 'bonelord');
  if (!b) { killed = A.logs.some((l) => /falls/.test(l)); await wait(150); continue; }
  const me = A.pos();
  A.tx({ t: 'target', id: b.i });
  still = last && last.x === me.x && last.y === me.y ? still + 1 : 0;
  last = { x: me.x, y: me.y };
  const far = Math.hypot(b.x - me.x, b.y - me.y) > 1.4;
  if (far) {
    const horiz = Math.abs(b.x - me.x) >= Math.abs(b.y - me.y);
    let dx = horiz ? Math.sign(b.x - me.x) : 0, dy = horiz ? 0 : Math.sign(b.y - me.y);
    if (still >= 2) { [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)]; } // blocked by adds or pillars: sidestep
    A.tx({ t: 'move', dx, dy });
  } else A.tx({ t: 'skill', n: 1 });
  await wait(160);
}
ok(A.logs.some((l) => /falls/.test(l)), 'boss killed, victory message received');
await wait(400);
const loot = A.ents.filter((e) => e.k === 'd');
ok(loot.some((d) => !d.g && d.r >= 2) || A.me.inv.some((it) => it && it.r >= 2), 'boss dropped rare+ gear (on the floor or already picked up)');
ok(loot.some((d) => d.g) || A.me.gold >= 300, 'boss dropped gold (on the floor or already picked up)');

// --- exit
const ex = dz.exit;
ok(await A.tp(ex.x + 2, ex.y), 'walked to the exit portal');
await A.leave();
ok(A.zone.kind === 'world', 'exit portal returns A to the overworld');
const back = A.pos();
ok(Math.hypot(back.x - 28, back.y - 98) < 6, `A reappears beside the crypt portal (${back.x},${back.y})`);

// --- instance isolation: B solo gets a different instance than A
const B = await bot('CryptBeta');
await B.tp(28, 98); await B.enter();
await A.tp(28, 98); await A.enter();
ok(B.zone.kind === 'dungeon' && A.zone.kind === 'dungeon' && A.zone.id !== B.zone.id, 'two solo heroes get separate instances');
ok((await status()).instances === 2, 'two instances live');

// --- party shares one instance
await A.leave(); await B.leave();
const C = await bot('CryptGamma'), D = await bot('CryptDelta');
C.tx({ t: 'pinvite', name: 'CryptDelta' }); await wait(300);
D.tx({ t: 'pgo', ok: true }); await wait(400);
await C.tp(28, 98); await D.tp(28, 98);
await C.enter(); await D.enter();
ok(C.zone.kind === 'dungeon' && C.zone.id === D.zone.id, 'party members share one instance');
const sees = D.ents.some((e) => e.k === 'p' && e.i === C.me.id);
ok(sees, 'party members see each other inside');
ok(!A.ents.some((e) => e.k === 'p' && e.i === C.me.id), 'players in other zones do not see them');

// --- death sends you to town (no god-mode): E walks into the boss room and dies
const E = await bot('CryptEcho', 'warrior', false);
await E.tp(28, 98); await E.enter();
const dz2 = generateDungeon(E.zone.seed), br = dz2.rooms.at(-1);
await E.tp(br.x + 3, br.cy);
const diedAt = Date.now();
while (Date.now() - diedAt < 25000 && !E.logs.some((l) => /slain by/.test(l))) await wait(300);
ok(E.logs.some((l) => /slain by/.test(l)), 'E died in the crypt');
const zonesBefore = E.zones.length;
for (let i = 0; i < 40 && E.zones.length === zonesBefore; i++) await wait(250);
ok(E.zone.kind === 'world', 'death respawns E in the overworld town');

// --- cleanup: everyone leaves -> instances are reaped after the TTL
for (const b of [A, B, C, D, E]) b.ws.close();
await wait(5500);
const st2 = await status();
ok(st2.instances === 0, `empty instances are removed (got ${st2.instances})`);
ok(st2.mobs === st0.mobs, 'overworld monster count still untouched');

console.log('DUNGEON SMOKE OK');
done(0);
