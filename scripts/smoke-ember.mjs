// Third dungeon: The Ember Forge. Enter, isolation from the other dungeons, fire theme, 11 rooms, the boss quest, boss + loot, exit, party sharing.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { generateDungeon, isSolid, G } from '../shared/world.js';
import { DUNGEONS, PORTAL_ID, PORTAL2_ID, PORTAL3_ID, EXIT_ID, MOBS, QUESTS } from '../shared/data.js';

const PORT = 3986;
const SAVE = 'data/test-saves-ember.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1', EM_INSTANCE_TTL: '7000' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };
const status = async () => (await fetch(`http://localhost:${PORT}/api/status`)).json();
const ember = DUNGEONS.find((d) => d.id === 'ember'), frozen = DUNGEONS.find((d) => d.id === 'frozen'), crypt = DUNGEONS.find((d) => d.id === 'crypt');

// walk to the exit portal of whichever dungeon the bot is in, and take it
async function leave(b, theme) {
  const e = generateDungeon(b.zone.seed, theme).exit;
  await b.tp(e.x + 2, e.y);
  b.tx({ t: 'talk', id: EXIT_ID }); await wait(600);
}

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], logs: [], dialogs: [], zone: null, ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'dialog') b.dialogs.push(m); else if (m.t === 'zone') b.zone = m; else if (m.t === 'welcome') b.zone = m.zone; else if (m.t === 'err') fail(m.m);
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
ok(DUNGEONS.length === 3 && ember.rec > frozen.rec && MOBS[ember.boss].boss && MOBS[ember.boss].specials.some((x) => x.kind === 'slam' && x.warnMs > 0), 'three dungeons are registered; the ember one is the highest level, with a telegraphed boss');

const A = await bot('EmberAlpha');
ok(A.zone.npcs.some((n) => n.id === PORTAL3_ID && n.name === 'The Ember Forge') && A.zone.npcs.some((n) => n.id === PORTAL2_ID) && A.zone.npcs.some((n) => n.id === PORTAL_ID), 'the overworld has all three dungeon portals');

// the boss quest: accept it from Forgemaster Kael, then it completes inside the dungeon
const lastQ = QUESTS.length - 1;
A.tx({ t: 'dbg', quest: lastQ, lvl: 50, atkMul: 1500 }); await wait(300);
ok(await A.tp(191, 191), 'teleported beside Forgemaster Kael in Emberhold');
A.dialogs.length = 0;
A.tx({ t: 'talk', id: 17 }); await wait(400);
ok(A.dialogs.some((d) => d.title === 'The Ember Lord' && /epic/.test(d.reward) && d.opts), 'Forgemaster Kael offers the Ember Lord boss quest');
A.tx({ t: 'questAccept' }); await wait(300);
ok(A.me.quest.i === lastQ && A.me.quest.s === 1, 'the boss quest is accepted');

ok(await A.tp(ember.portal.x, ember.portal.y + 2), 'teleported beside the Ember Forge portal');
A.tx({ t: 'talk', id: PORTAL3_ID }); await wait(600);
ok(A.zone.kind === 'dungeon' && A.zone.theme === 'fire' && A.zone.name === 'The Ember Forge', 'the portal leads to the fire-themed Ember Forge');
const dz = generateDungeon(A.zone.seed, 'fire');
ok(dz.rooms.length === 11 && dz.g.includes(G.EMBER) && !dz.g.includes(G.CRYPT) && !dz.g.includes(G.FROST), 'the client can rebuild an 11-room ember dungeon from the seed');
const pos = A.pos();
ok(pos && !isSolid(dz, pos.x, pos.y), 'A stands on open floor');
ok((await status()).instances === 1, 'one instance exists');

// monsters are the ember set, in every room
const allowed = ['slagcrawler', 'emberacolyte', 'magmaserpent', 'moltengolem', 'emberlord'];
const types = new Set();
for (const rm of dz.rooms.slice(1)) {
  if (!(await A.tp(rm.cx, rm.cy))) continue;
  await wait(350);
  for (const e of A.ents) if (e.k === 'm') types.add(e.s);
}
ok([...types].every((t) => allowed.includes(t)), `only ember monsters here (${[...types].join(', ')})`);
ok(['slagcrawler', 'emberacolyte', 'magmaserpent', 'moltengolem'].every((t) => types.has(t)), 'all four new monster types roam the forge');
const boss = dz.rooms.at(-1);
ok(await A.tp(boss.x + 2, boss.cy), 'teleported into the boss room');
await wait(600);
ok(A.ents.some((e) => e.k === 'm' && e.s === 'emberlord'), 'the Ember Lord is waiting in the boss room');

let killed = false, last = null, still = 0;
for (let i = 0; i < 900 && !killed; i++) {
  const b = A.ents.find((e) => e.k === 'm' && e.s === 'emberlord');
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
ok(A.logs.some((l) => /Vorthak, the Ember Lord falls/.test(l)), 'the Ember Lord falls and the victory message arrives');
await wait(500);
ok(A.logs.some((l) => /Quest complete: The Ember Lord/.test(l)) && A.me.quest.s === 2, 'killing the boss inside the dungeon completes the boss quest');
ok(A.ents.some((d) => d.k === 'd' && !d.g && d.r >= 2) || A.me.inv.some((it) => it && it.r >= 2), 'the boss dropped rare+ gear');

// exit lands beside the ember portal
const ex = dz.exit;
ok(await A.tp(ex.x + 2, ex.y), 'walked to the exit');
A.tx({ t: 'talk', id: EXIT_ID }); await wait(600);
const back = A.pos();
ok(A.zone.kind === 'world' && Math.hypot(back.x - ember.portal.x, back.y - (ember.portal.y + 2)) < 6, `exit returns you beside the Ember Forge portal (${back.x},${back.y})`);

// the three dungeons are separate instances, even for one hero
await A.tp(frozen.portal.x, frozen.portal.y + 2);
A.tx({ t: 'talk', id: PORTAL2_ID }); await wait(600);
ok(A.zone.theme === 'ice', 'the frozen portal still leads to the frozen depths');
await leave(A, 'ice');
await A.tp(crypt.portal.x, crypt.portal.y + 2);
A.tx({ t: 'talk', id: PORTAL_ID }); await wait(600);
ok(A.zone.theme === 'crypt' && A.zone.name === 'The Sunken Crypt', 'the crypt portal still leads to the crypt');
ok((await status()).instances === 3, 'crypt, frozen and ember instances coexist');
await leave(A, 'crypt');
await A.tp(ember.portal.x, ember.portal.y + 2);
A.tx({ t: 'talk', id: PORTAL3_ID }); await wait(600);
ok(A.zone.theme === 'fire' && (await status()).instances === 3, 're-entering the ember portal reuses the same instance');
await leave(A, 'fire');
ok(A.zone.kind === 'world', 'leaving the ember instance returns to the overworld');

// party members share one ember instance
const C = await bot('EmberGamma'), D = await bot('EmberDelta');
C.tx({ t: 'pinvite', name: 'EmberDelta' }); await wait(300);
D.tx({ t: 'pgo', ok: true }); await wait(400);
await C.tp(ember.portal.x, ember.portal.y + 2); await D.tp(ember.portal.x, ember.portal.y + 2);
C.tx({ t: 'talk', id: PORTAL3_ID }); await wait(500); D.tx({ t: 'talk', id: PORTAL3_ID }); await wait(500);
ok(C.zone.kind === 'dungeon' && C.zone.id === D.zone.id && C.zone.theme === 'fire', 'a party shares one Ember Forge instance');
ok(C.zone.id !== A.zone.id, "the party's instance is separate from the solo hero's");

// cleanup after everyone leaves (instances are reaped after EM_INSTANCE_TTL)
for (const b of [A, C, D]) b.ws.close();
await wait(9000);
ok((await status()).instances === 0, 'empty dungeon instances are removed');

console.log('EMBER SMOKE OK');
done(0);
