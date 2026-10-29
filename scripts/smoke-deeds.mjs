// Deeds + titles + whispers: deeds come from server-side progress, titles need the deed, whispers reach only their target.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3984 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0);
const SAVE = 'data/test-saves-deeds.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], logs: [], chats: [], ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'chat') b.chats.push(m); else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'test-pass-1', cls: 'warrior' });
  for (let i = 0; i < 40 && !b.me; i++) await wait(100);
  if (!b.me) fail(`${name}: no me message`);
  await wait(300);
  return b;
}
await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);

const A = await bot('DeedAlpha'), B = await bot('DeedBeta'), C = await bot('DeedGamma');
const seenTitle = (viewer, who) => { const e = viewer.ents.find((x) => x.i === who.me.id); return e ? e.ti : undefined; };
ok(Object.keys(A.me.deeds).length === 0 && A.me.title === '', 'a new hero has no deeds and no title');

A.tx({ t: 'title', id: 'lv10' }); await wait(400);
ok(A.me.title === '', 'a title cannot be worn before its deed is earned');

A.tx({ t: 'dbg', lvl: 10 }); await wait(500);
ok(A.me.deeds.lv10 === 1, 'reaching level 10 earns the Seasoned deed');
ok(A.logs.some((l) => l.includes('Deed earned: Seasoned')), 'the player is told about the deed');
A.tx({ t: 'title', id: 'bogus' }); A.tx({ t: 'title', id: 'constructor' }); await wait(300);
ok(A.me.title === '', 'unknown deed ids are ignored');
A.tx({ t: 'title', id: 'lv10' }); await wait(500);
ok(A.me.title === 'lv10' && seenTitle(B, A) === 'lv10', 'an earned title is worn and shown to other players');
A.tx({ t: 'title', id: '' }); await wait(500);
ok(A.me.title === '' && !seenTitle(B, A), 'a title can be taken off again');

B.tx({ t: 'whisper', to: 'deedalpha', m: 'psst' }); await wait(500);
ok(A.chats.some((c) => c.ch === 'w' && c.dir === 'from' && c.n === 'DeedBeta' && c.m === 'psst'), 'the target receives the whisper (name match ignores case)');
ok(B.chats.some((c) => c.ch === 'w' && c.dir === 'to' && c.n === 'DeedAlpha'), 'the sender gets an echo');
ok(!C.chats.some((c) => c.ch === 'w'), 'a bystander never sees the whisper');
await wait(700);
B.tx({ t: 'whisper', to: 'nobody', m: 'hi' }); await wait(400);
ok(B.logs.some((l) => l.includes('Nobody by that name')), 'whispering an offline name is explained');
await wait(700);
B.tx({ t: 'whisper', to: 'DeedBeta', m: 'me' }); await wait(400);
ok(B.logs.some((l) => l.includes('cannot whisper yourself')), 'you cannot whisper yourself');

// deeds survive a relogin
A.tx({ t: 'title', id: 'lv10' }); await wait(400);
A.ws.close(); await wait(800);
const A2 = await bot('DeedAlpha');
ok(A2.me.deeds.lv10 === 1 && A2.me.title === 'lv10', 'deeds and the chosen title persist across logins');

console.log('DEEDS SMOKE OK');
done(0);
