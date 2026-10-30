// Social safety: persisted server-side mutes cover public chat, whispers, party invites and trades.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3980 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0);
const SAVE = 'data/test-saves-social.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000, step = 50) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await wait(step); } return null; };
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { me: null, chats: [], logs: [], invites: [], trades: [], ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m;
    else if (m.t === 'chat') b.chats.push(m);
    else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'pinv') b.invites.push(m);
    else if (m.t === 'trade_inv') b.trades.push(m);
    else if (m.t === 'err') fail(m.m);
  });
  await new Promise((resolve) => ws.once('open', resolve));
  b.tx({ t: 'login', name, pass: 'test-social-1', cls: 'warrior' });
  if (!(await until(() => b.me))) fail(`${name}: no me message`);
  return b;
}

try { fs.unlinkSync(SAVE); } catch { /* none */ }
if (!(await until(() => out.includes('listening'), 15000, 100))) fail(`server did not start: ${out}`);
const A = await bot('SocialAlpha'), B = await bot('SocialBeta'), C = await bot('SocialGamma');

B.tx({ t: 'mute', name: 'SocialAlpha' });
ok(await until(() => B.me?.mutes?.includes('socialalpha')), 'muting records the normalized hero name');
A.tx({ t: 'chat', m: 'public-one' }); await wait(350);
ok(!B.chats.some((m) => m.m === 'public-one'), 'a muted hero is hidden from public chat');
ok(C.chats.some((m) => m.m === 'public-one'), 'public chat still reaches other heroes');

await wait(700);
const aLog = A.logs.length;
A.tx({ t: 'whisper', to: 'SocialBeta', m: 'private-one' }); await wait(350);
ok(!B.chats.some((m) => m.m === 'private-one'), 'a muted hero cannot whisper the recipient');
ok(A.logs.slice(aLog).some((line) => /unable to whisper/i.test(line)), 'blocked whispers fail without disclosing the mute');

A.tx({ t: 'pinvite', name: 'SocialBeta' }); await wait(300);
A.tx({ t: 'trade_req', name: 'SocialBeta' }); await wait(300);
ok(B.invites.length === 0 && B.trades.length === 0, 'mute also blocks party and trade requests');

B.tx({ t: 'unmute', name: 'SocialAlpha' });
ok(await until(() => B.me && !B.me.mutes.includes('socialalpha')), 'unmute removes the server-side rule');
await wait(700);
A.tx({ t: 'chat', m: 'public-two' });
ok(await until(() => B.chats.some((m) => m.m === 'public-two')), 'unmuting restores public chat');

B.tx({ t: 'mute', name: 'SocialAlpha' });
ok(await until(() => B.me.mutes.includes('socialalpha')), 'the mute can be enabled again');
B.ws.close(); await wait(800);
const B2 = await bot('SocialBeta');
ok(B2.me.mutes.includes('socialalpha'), 'mute choices persist across relogging');
await wait(700);
A.tx({ t: 'chat', m: 'public-three' }); await wait(350);
ok(!B2.chats.some((m) => m.m === 'public-three'), 'the persisted mute remains enforced');

console.log('SOCIAL SMOKE OK');
done(0);
