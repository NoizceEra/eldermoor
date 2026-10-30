// /top: lists the highest-level heroes, live levels override the last save, and it needs no arguments.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3981;
const SAVE = 'data/test-saves-top.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, lines: [], tx: (o) => ws.send(JSON.stringify(o)), ws };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 'log') b.lines.push(m.m); else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'test', cls: 'warrior' });
  await wait(500);
  if (!b.me) fail(`${name}: no me message`);
  return b;
}
await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);

const A = await bot('TopAlpha'), B = await bot('TopBeta');
A.tx({ t: 'dbg', lvl: 30 }); B.tx({ t: 'dbg', lvl: 12 }); await wait(400);
A.tx({ t: 'chat', m: '/top' }); await wait(500);
const line = A.lines.find((l) => l.startsWith('Top heroes:'));
ok(!!line, 'the /top command answers with a ranking');
ok(line.indexOf('TopAlpha') < line.indexOf('TopBeta'), `the level 30 hero ranks above the level 12 hero (${line})`);
ok(/TopAlpha L30/.test(line) && /TopBeta L12/.test(line), 'live levels are shown, not the stale saved ones');

B.tx({ t: 'chat', m: '/inspect topalpha' }); await wait(600);
const ins = B.lines.find((l) => l.startsWith('TopAlpha'));
ok(!!ins && /L30 warrior/.test(ins), `/inspect shows another hero's level and job (${ins})`);
B.tx({ t: 'chat', m: '/inspect nobodyhere' }); await wait(700);
ok(B.lines.includes('No hero by that name.'), '/inspect of an unknown name says so');

console.log('TOP SMOKE OK');
done(0);
