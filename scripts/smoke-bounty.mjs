// Bounties: rolled server-side, one at a time, claimable only when finished, paid once, persisted.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3983 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0);
const SAVE = 'data/test-saves-bounty.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { me: null, logs: [], ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'me') b.me = m; else if (m.t === 'log') b.logs.push(m.m); else if (m.t === 'err') fail(m.m); });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'test-pass-1', cls: 'warrior' });
  for (let i = 0; i < 40 && !b.me; i++) await wait(100);
  if (!b.me) fail(`${name}: no me message`);
  await wait(300);
  return b;
}
await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);

const A = await bot('BountyAlpha');
ok(A.me.bounty === null, 'a new hero has no bounty');
A.tx({ t: 'bounty', a: 'claim' }); await wait(300);
ok(A.logs.some((l) => l.includes('no bounty')), 'claiming with no bounty is explained');
A.tx({ t: 'bounty', a: 'take' }); await wait(400);
const b = A.me.bounty;
ok(b && b.need >= 8 && b.need <= 14 && b.p === 0, 'taking a bounty rolls a contract');
A.tx({ t: 'bounty', a: 'take' }); await wait(300);
ok(A.me.bounty.mob === b.mob && A.logs.some((l) => l.includes('already have a bounty')), 'only one bounty at a time');
A.tx({ t: 'bounty', a: 'claim' }); await wait(300);
ok(A.me.bounty && A.logs.some((l) => l.includes('Not finished')), 'an unfinished bounty cannot be claimed');
A.tx({ t: 'bounty', a: 'bogus' }); await wait(200);
ok(A.me.bounty, 'unknown bounty actions are ignored');

const gold0 = A.me.gold, xp0 = A.me.xp;
A.tx({ t: 'dbg', bountyDone: 1 }); await wait(300);
A.tx({ t: 'bounty', a: 'claim' }); await wait(500);
ok(A.me.bounty === null && A.me.gold > gold0 && (A.me.xp > xp0 || A.me.lvl > 1), 'a finished bounty pays gold and XP and clears');
ok(A.me.stats.bounties === 1, 'the claim is counted for deeds');
A.tx({ t: 'bounty', a: 'claim' }); await wait(300);
ok(A.me.stats.bounties === 1, 'a bounty cannot be claimed twice');

A.tx({ t: 'bounty', a: 'take' }); await wait(400);
const kept = A.me.bounty;
A.ws.close(); await wait(800);
const A2 = await bot('BountyAlpha');
ok(A2.me.bounty && A2.me.bounty.mob === kept.mob && A2.me.bounty.need === kept.need, 'an active bounty persists across logins');
A2.tx({ t: 'bounty', a: 'drop' }); await wait(300);
ok(A2.me.bounty === null, 'a bounty can be dropped');

console.log('BOUNTY SMOKE OK');
done(0);
