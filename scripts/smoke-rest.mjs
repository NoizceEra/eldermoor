// Sitting recovers health faster than standing, and a bounty advances from a real kill.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3982 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0);
const SAVE = 'data/test-saves-rest.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { me: null, ents: [], logs: [], ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'me') b.me = m; else if (m.t === 's') { for (const e of m.e) { const i = b.ents.findIndex((x) => x.i === e.i); if (i < 0) b.ents.push(e); else b.ents[i] = { ...b.ents[i], ...e }; } } else if (m.t === 'log') b.logs.push(m.m); else if (m.t === 'err') fail(m.m); });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'test-pass-1', cls: 'warrior' });
  for (let i = 0; i < 40 && !b.me; i++) await wait(100);
  if (!b.me) fail(`${name}: no me message`);
  await wait(300);
  return b;
}
await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);

// resting: two heroes hurt to the same point; compare recovery over 3s (well short of full health)
const S = await bot('RestSitter'), T = await bot('RestStander');
for (const b of [S, T]) { b.tx({ t: 'dbg', lvl: 20 }); }
await wait(500);
for (const b of [S, T]) b.tx({ t: 'dbg', hp: 10 });
await wait(300);
S.tx({ t: 'emote', e: 'sit' }); await wait(300);
const s0 = S.me.hp, t0 = T.me.hp;
await wait(3000);
// me messages only arrive on change, which regen causes every second
ok(S.me.hp > s0 && T.me.hp >= t0, 'both heroes recover while calm');
ok(S.me.hp - s0 > (T.me.hp - t0) * 1.3, `sitting heals faster than standing (${S.me.hp - s0} vs ${T.me.hp - t0})`);

// a real kill advances a bounty
const K = await bot('RestHunter');
K.tx({ t: 'dbg', bountyMob: 'slime', god: true }); await wait(300);
ok(K.me.bounty && K.me.bounty.mob === 'slime' && K.me.bounty.p === 0, 'bounty set to slimes');
let killed = false;
for (let i = 0; i < 10 && !killed; i++) {
  const me = K.ents.find((e) => e.i === K.me.id) || { x: 0, y: 0 };
  const s = K.ents.filter((e) => e.k === 'm' && e.s === 'slime' && !e.d).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  if (!s) { K.tx({ t: 'dbg', tp: [64, 84 + i] }); await wait(600); continue; }
  K.tx({ t: 'dbg', tp: [s.x + 1, s.y] }); await wait(250);
  K.tx({ t: 'target', id: s.i });
  for (let j = 0; j < 20 && !(K.me.bounty && K.me.bounty.p >= 1); j++) await wait(300);
  killed = K.me.bounty && K.me.bounty.p >= 1;
}
ok(killed, 'killing a slime advances the bounty');
console.log('REST SMOKE OK');
done(0);
