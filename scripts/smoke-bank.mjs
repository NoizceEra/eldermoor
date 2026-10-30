// Town bank: server-authoritative item moves, no duplication, and persistence across a process restart.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3981 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0);
const SAVE = 'data/test-saves-bank.json';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000, step = 50) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = fn(); if (value) return value; await wait(step); }
  return null;
};
let srv = null, out = '';
const cleanup = () => { srv?.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } };
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function startServer() {
  out = '';
  srv = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  srv.stdout.on('data', (d) => (out += d));
  if (!(await until(() => out.includes('listening'), 15000, 100))) fail(`server did not start: ${out}`);
}

async function stopServer() {
  if (!srv || srv.exitCode !== null) return;
  const exited = new Promise((resolve) => srv.once('exit', resolve));
  srv.kill('SIGTERM');
  await Promise.race([exited, wait(5000)]);
  srv = null;
}

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { me: null, logs: [], ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m;
    else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'err') fail(m.m);
  });
  await new Promise((resolve) => ws.once('open', resolve));
  b.tx({ t: 'login', name, pass: 'test-bank-1', cls: 'warrior' });
  if (!(await until(() => b.me))) fail(`${name}: no me message`);
  return b;
}

try { fs.unlinkSync(SAVE); } catch { /* none */ }
await startServer();
let A = await bot('BankAlpha');
ok(Array.isArray(A.me.bank) && A.me.bank.length === 40 && A.me.bank.every((x) => x === null), 'a new hero receives an empty 40-slot bank');

A.tx({ t: 'dbg', give: 'head', n: 1, r: 2 });
const item = await until(() => A.me.inv.find((it) => it && it.s === 'head'));
ok(!!item, 'test item was added to the pack');
let slot = A.me.inv.findIndex((it) => it && it.u === item.u);

A.tx({ t: 'dbg', tp: [64, 84] }); await wait(250);
A.tx({ t: 'bank_deposit', slot }); await wait(350);
ok(A.me.inv.some((it) => it && it.u === item.u) && A.me.bank.every((it) => !it), 'depositing outside town is refused');
ok(A.logs.some((line) => /town bank/i.test(line)), 'the refusal explains where the bank is available');

A.tx({ t: 'dbg', tp: [64, 67] }); await wait(250);
A.tx({ t: 'bank_deposit', slot });
ok(await until(() => A.me.bank[0] && A.me.bank[0].u === item.u), 'deposit moves the exact item from pack to bank');
ok(!A.me.inv.some((it) => it && it.u === item.u), 'the deposited item no longer exists in the pack');

A.tx({ t: 'bank_deposit', slot }); await wait(250);
const idsBeforeRestart = [...A.me.inv, ...A.me.bank].filter(Boolean).map((it) => it.u);
ok(new Set(idsBeforeRestart).size === idsBeforeRestart.length, 'repeating a stale deposit cannot duplicate an item');

A.ws.close(); await wait(600);
await stopServer();
await startServer();
A = await bot('BankAlpha');
ok(A.me.bank[0] && A.me.bank[0].u === item.u, 'bank contents survive a full server restart');

A.tx({ t: 'dbg', tp: [64, 84] }); await wait(250);
A.tx({ t: 'bank_withdraw', slot: 0 }); await wait(300);
ok(A.me.bank[0] && A.me.bank[0].u === item.u, 'withdrawing outside town is refused');

A.tx({ t: 'dbg', tp: [64, 67] }); await wait(250);
A.tx({ t: 'dbg', give: 'head', n: 30, r: 0 });
ok(await until(() => A.me.inv.every(Boolean)), 'the pack can be filled for the capacity check');
A.tx({ t: 'bank_withdraw', slot: 0 }); await wait(300);
ok(A.me.bank[0] && !A.me.inv.some((it) => it && it.u === item.u), 'a full pack refuses withdrawal without losing the banked item');

const dropSlot = A.me.inv.findIndex((it) => it && it.s === 'head');
A.tx({ t: 'drop', slot: dropSlot });
ok(await until(() => A.me.inv[dropSlot] === null), 'one pack slot was freed');
A.tx({ t: 'bank_withdraw', slot: 0 });
ok(await until(() => !A.me.bank[0] && A.me.inv.some((it) => it && it.u === item.u)), 'withdraw moves the exact item back into the pack');

A.tx({ t: 'bank_withdraw', slot: -1 });
A.tx({ t: 'bank_deposit', slot: 999 }); await wait(250);
const allIds = [...A.me.inv, ...A.me.bank].filter(Boolean).map((it) => it.u);
ok(new Set(allIds).size === allIds.length, 'invalid bank requests cannot duplicate an item');

console.log('BANK SMOKE OK');
A.ws.close(); await wait(300);
await stopServer();
cleanup();
