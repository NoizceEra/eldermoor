// Persistence: a hero is saved, the server is killed and restarted, and the hero loads with the same level, gold, pack and look.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3987;
const SAVE = 'data/test-saves-persist.json';
try { fs.unlinkSync(SAVE); } catch { /* none */ }
let srv = null, out = '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const start = async () => {
  out = '';
  srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  srv.stdout.on('data', (d) => (out += d));
  for (let i = 0; i < 40 && !out.includes('listening'); i++) await wait(100);
  if (!out.includes('listening')) fail('server did not start: ' + out);
};
const stop = async () => { const s = srv; const exited = new Promise((r) => s.once('exit', r)); s.kill(); await exited; };
const done = (code) => { try { srv && srv.kill(); } catch { /* gone */ } try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };
const status = async () => (await fetch(`http://localhost:${PORT}/api/status`)).json();

async function bot(name, look) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, tx: (o) => ws.send(JSON.stringify(o)), ws };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'x', cls: 'mage', look });
  await wait(450);
  if (!b.me) fail(`${name}: no me message`);
  return b;
}
const pack = (me) => JSON.stringify([me.inv, me.eq]);

await start();
const st = await status();
ok(st.store === 'file' && st.storeOk === true, 'status reports the file store as healthy when DATABASE_URL is unset');

const A = await bot('PersistAlpha', [3, 2, 1, 4, 2, 1]);
A.tx({ t: 'dbg', gold: 777, lvl: 12 }); await wait(200);
A.tx({ t: 'dbg', give: 'body', n: 2, r: 2 }); await wait(200);
A.tx({ t: 'dbg', give: 'potion', n: 3 }); await wait(300);
const before = { lvl: A.me.lvl, gold: A.me.gold, look: [...A.me.look], pack: pack(A.me), job: A.me.job };
ok(before.lvl === 12 && before.gold >= 777 && before.look.join() === '3,2,1,4,2,1', `hero prepared (lvl ${before.lvl}, ${before.gold} gold)`);
A.ws.close(); await wait(500);
ok(fs.existsSync(SAVE), 'logging out wrote the save file');

await stop();
await start();
const B = await bot('PersistAlpha');
ok(B.me.lvl === before.lvl && B.me.gold === before.gold, 'level and gold survive a server restart');
ok(JSON.stringify(B.me.look) === JSON.stringify(before.look), 'look survives a server restart');
ok(pack(B.me) === before.pack && B.me.job === before.job, 'inventory and equipment survive a server restart');
B.ws.close(); await wait(300);

console.log('PERSIST SMOKE OK');
done(0);
