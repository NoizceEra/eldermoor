// Operational telemetry under modest live load: concurrency, rejects, auth failures, flood drops and tick p95.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3979 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0);
const SAVE = 'data/test-saves-telemetry.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 75) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(step); } return null; };
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };
const status = async () => (await fetch(`http://localhost:${PORT}/api/status`)).json();

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { me: null, ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'me') b.me = m; else if (m.t === 'err') b.err = m.m; });
  await new Promise((resolve) => ws.once('open', resolve));
  b.tx({ t: 'login', name, pass: 'test-load-1', cls: 'warrior', delta: true });
  if (!(await until(() => b.me))) fail(`${name}: no me message`);
  return b;
}

try { fs.unlinkSync(SAVE); } catch { /* none */ }
if (!(await until(() => out.includes('listening'), 15000, 100))) fail(`server did not start: ${out}`);
const bots = await Promise.all(Array.from({ length: 8 }, (_, i) => bot(`LoadHero${i}`)));
await wait(1200);
let s = await status();
ok(s.online === 8 && s.peakOnline >= 8, `current and peak concurrency are visible (${s.online}/${s.peakOnline})`);
ok(s.connectionsTotal >= 8, `accepted connection count is visible (${s.connectionsTotal})`);
ok(Number.isFinite(s.tickP95Ms) && s.tickP95Ms >= 0 && s.tickP95Ms < 50, `recent tick p95 stays inside budget (${s.tickP95Ms} ms)`);

const bad = new WebSocket(`ws://localhost:${PORT}/ws`, { headers: { Origin: 'https://evil.invalid' } });
await new Promise((resolve) => { bad.once('unexpected-response', (_req, res) => { res.resume(); resolve(); }); bad.once('error', resolve); });
const weak = new WebSocket(`ws://localhost:${PORT}/ws`);
await new Promise((resolve) => weak.once('open', resolve));
let weakErr = '';
weak.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'err') weakErr = m.m; });
weak.send(JSON.stringify({ t: 'login', name: 'WeakLoadHero', pass: 'x', cls: 'warrior' }));
ok(await until(() => weakErr), 'an invalid new-secret attempt was rejected');
weak.close();

for (let i = 0; i < 450; i++) bots[0].tx({ t: 'target', id: 0 });
await wait(300);
s = await status();
ok(s.wsRejected >= 1, `cross-origin WebSocket rejects are counted (${s.wsRejected})`);
ok(s.authFailures >= 1, `authentication failures are counted (${s.authFailures})`);
ok(s.messagesDropped >= 1, `flood-guard drops are counted (${s.messagesDropped})`);

for (const b of bots.slice(0, 4)) b.ws.close();
ok(await until(async () => (await status()).online === 4), 'current online count falls after disconnects');
s = await status();
ok(s.peakOnline >= 8, 'peak concurrency remains available after players leave');

console.log('TELEMETRY SMOKE OK');
done(0);
