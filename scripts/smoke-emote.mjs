// Emotes: broadcast to other players, timed ones expire, sit lasts until you move, bad or rapid emotes are ignored.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3985;
const SAVE = 'data/test-saves-emote.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], tx: (o) => ws.send(JSON.stringify(o)), ws };
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'err') fail(m.m); });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'x', cls: 'warrior' });
  await wait(500);
  if (!b.me) fail(`${name}: no me message`);
  return b;
}
await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);

const A = await bot('EmoteAlpha'), B = await bot('EmoteBeta');
const seen = (viewer, who) => { const e = viewer.ents.find((x) => x.i === who.me.id); return e ? e.em : undefined; };
await wait(400);
ok(seen(B, A) === 0, 'by default nobody is emoting');

A.tx({ t: 'emote', e: 'wave' }); await wait(450);
ok(seen(B, A) === 'wave' && seen(A, A) === 'wave', 'another player sees your wave');
await wait(3300);
ok(seen(B, A) === 0, 'a wave ends by itself after a few seconds');

A.tx({ t: 'emote', e: 'sit' }); await wait(450);
ok(seen(B, A) === 'sit', 'sitting is shown to others');
await wait(3500);
ok(seen(B, A) === 'sit', 'a seated hero stays seated');
A.tx({ t: 'move', dx: 0, dy: 1 }); await wait(450);
ok(seen(B, A) === 0, 'moving stands you back up');

await wait(900);
A.tx({ t: 'emote', e: 'bogus' }); await wait(300);
ok(seen(B, A) === 0, 'unknown emotes are ignored');
A.tx({ t: 'emote', e: 'constructor' }); await wait(300);
ok(seen(B, A) === 0, 'prototype names are not emotes');

await wait(900);
A.tx({ t: 'emote', e: 'dance' }); A.tx({ t: 'emote', e: 'wave' }); await wait(450);
ok(seen(B, A) === 'dance', 'emotes are rate limited (the second one in a second is dropped)');
A.tx({ t: 'skill', n: 1 }); await wait(450);
ok(seen(B, A) === 0, 'using a skill ends an emote');

console.log('EMOTE SMOKE OK');
done(0);
