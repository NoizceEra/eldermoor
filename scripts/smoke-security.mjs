import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { WebSocket } from 'ws';

const PORT = 3984 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0);
const SAVE = 'data/test-saves-security.json';
const srv = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let out = '';
srv.stdout.on('data', (data) => (out += data));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = fn();
    if (value) return value;
    await wait(40);
  }
  return null;
};
const cleanup = () => {
  srv.kill();
  try { fs.unlinkSync(SAVE); } catch { /* none */ }
};
const fail = (message) => { console.error('FAIL:', message); cleanup(); process.exit(1); };
const ok = (condition, message) => { if (!condition) fail(message); console.log('ok  -', message); };

async function login(name, pass) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ t: 'login', name, pass, cls: 'warrior', delta: true }));
  await until(() => messages.some((message) => message.t === 'err' || message.t === 'welcome'));
  return { ws, messages };
}

if (!(await until(() => out.includes('listening'), 20000))) fail(`server did not start: ${out}`);

const statusResponse = await fetch(`http://localhost:${PORT}/api/status`);
ok(statusResponse.headers.get('x-content-type-options') === 'nosniff', 'status responses include anti-sniffing headers');
ok(statusResponse.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"), 'status responses include the framing policy');
const healthResponse = await fetch(`http://localhost:${PORT}/api/health`);
let health = {};
try { health = JSON.parse(await healthResponse.text()); } catch { /* the missing endpoint is the expected RED state */ }
ok(healthResponse.status === 200 && health.ok && health.store === 'file', 'the readiness endpoint reports a healthy save store');

const crossOriginRejected = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`, { origin: 'https://evil.example' });
  ws.once('open', () => { ws.close(); resolve(false); });
  ws.once('unexpected-response', () => resolve(true));
  ws.once('error', () => resolve(true));
});
ok(crossOriginRejected, 'cross-origin browser WebSockets are rejected');

const weak = await login('WeakSecret', 'x');
ok(weak.messages.some((message) => message.t === 'err' && /at least 4/.test(message.m)), 'new heroes need a four-character secret');
weak.ws.close();

const strong = await login('StrongSecret', 'four');
ok(strong.messages.some((message) => message.t === 'welcome'), 'a valid secret can create a hero');
strong.ws.close();

await wait(200);
for (let attempt = 0; attempt < 5; attempt++) {
  const wrong = await login('StrongSecret', 'wrong');
  ok(wrong.messages.some((message) => message.t === 'err'), `wrong secret attempt ${attempt + 1} is rejected`);
  wrong.ws.close();
}
const blocked = await login('StrongSecret', 'four');
ok(blocked.messages.some((message) => message.t === 'err' && /too many/i.test(message.m)), 'repeated failures temporarily block the hero and IP pair');
blocked.ws.close();

cleanup();
console.log('SECURITY SMOKE OK');
