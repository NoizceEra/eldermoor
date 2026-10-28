// Trading test, including the dupe / race attacks the plan called out.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3995 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0); // set EM_TEST_PORT_OFFSET to run beside another test run
const SAVE = 'data/test-saves-trade.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };
const status = async () => (await fetch(`http://localhost:${PORT}/api/status`)).json();

async function bot(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], logs: [], inv: null, view: null, ended: null, ws, tx: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'trade_inv') b.inv = m; else if (m.t === 'trade') { b.view = m; b.ended = null; }
    else if (m.t === 'trade_end') { b.ended = m; b.view = null; } else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'x', cls: 'warrior' });
  for (let i = 0; i < 40 && !b.me; i++) await wait(100);
  if (!b.me) fail(`${name}: no me message`);
  await wait(250); // let the first state packets arrive
  b.items = () => b.me.inv.filter(Boolean);
  b.has = (u) => b.me.inv.some((i) => i && i.u === u);
  b.gear = () => b.items().filter((i) => i.s !== 'potion');
  return b;
}
const open = async (A, B) => {
  await wait(2100); // trade requests are rate-limited to one per 2s
  A.inv = B.inv = null;
  A.tx({ t: 'trade_req', name: B.name }); await wait(300);
  if (!B.inv) fail('no trade_inv received');
  B.tx({ t: 'trade_ans', ok: true }); await wait(300);
};
const uidCount = (bots, u) => bots.reduce((n, b) => n + b.me.inv.filter((i) => i && i.u === u).length, 0);

await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);

const A = await bot('TradeAlpha'), B = await bot('TradeBeta');
A.tx({ t: 'dbg', give: 'weapon', n: 2, gold: 500 });
B.tx({ t: 'dbg', give: 'armor', n: 1, gold: 100 });
await wait(400);
const [w1, w2] = A.gear(), arm = B.gear()[0];
ok(w1 && w2 && arm, 'test gear granted');
const goldA0 = A.me.gold, goldB0 = B.me.gold;

// ---- happy path
await open(A, B);
ok(A.view && B.view, 'both clients receive the trade window');
A.tx({ t: 'trade_offer', items: [w1.u], gold: 200 });
B.tx({ t: 'trade_offer', items: [arm.u], gold: 0 });
await wait(300);
ok(A.view.them.items.length === 1 && B.view.them.items[0].u === w1.u && B.view.them.gold === 200, 'each side sees the other\'s offer');
A.tx({ t: 'trade_lock' }); B.tx({ t: 'trade_lock' }); await wait(300);
ok(A.view.me.lock && A.view.them.lock, 'both locked');
A.tx({ t: 'trade_confirm' }); await wait(200);
ok(A.has(w1.u) && B.me.gold === goldB0, 'nothing moves after only one confirm');
B.tx({ t: 'trade_confirm' }); await wait(500);
ok(A.ended && A.ended.ok && B.ended && B.ended.ok, 'trade completes for both');
ok(!A.has(w1.u) && B.has(w1.u) && A.has(arm.u) && !B.has(arm.u), 'items swapped');
ok(A.me.gold === goldA0 - 200 && B.me.gold === goldB0 + 200, 'gold moved');
ok(uidCount([A, B], w1.u) === 1 && uidCount([A, B], arm.u) === 1, 'no duplicated items');
ok(A.has(w2.u), 'untouched items stay put');

// ---- changing an offer after locking resets the locks
await open(A, B);
A.tx({ t: 'trade_offer', items: [w2.u], gold: 0 }); B.tx({ t: 'trade_offer', items: [], gold: 10 }); await wait(250);
A.tx({ t: 'trade_lock' }); B.tx({ t: 'trade_lock' }); await wait(250);
B.tx({ t: 'trade_offer', items: [], gold: 50 }); await wait(250);
ok(!A.view.me.lock && !A.view.them.lock && !B.view.me.lock, 'editing an offer clears both locks');
A.tx({ t: 'trade_confirm' }); B.tx({ t: 'trade_confirm' }); await wait(300);
ok(A.has(w2.u) && A.view, 'confirm without locks does nothing');

// ---- offering things you do not own / duplicates / absurd gold
A.tx({ t: 'trade_offer', items: [w2.u, w2.u, w2.u, 999999, -5, 'abc', B.gear()[0] ? B.gear()[0].u : 1], gold: 1e12 }); await wait(250);
ok(A.view.me.items.length === 1 && A.view.me.items[0].u === w2.u, 'duplicate / foreign / invalid item ids are dropped');
ok(A.view.me.gold === A.me.gold, `gold offer is clamped to what you own (${A.view.me.gold})`);

// ---- pack changes are frozen mid-trade (drop / sell / use / equip)
const before = A.items().length;
A.tx({ t: 'drop', slot: A.me.inv.findIndex((i) => i && i.u === w2.u) }); await wait(250);
ok(A.has(w2.u) && A.items().length === before, 'dropping during a trade is refused');
ok(A.logs.some((l) => /Finish or cancel your trade/.test(l)), 'player is told why');

// ---- cancel
B.tx({ t: 'trade_cancel' }); await wait(300);
ok(A.ended && !A.ended.ok && B.ended && !B.ended.ok, 'cancel closes the window for both');
ok(A.has(w2.u), 'cancel keeps everything');
ok((await status()).trades === 0, 'no trade left on the server');

// ---- disconnect mid-confirm: the other side keeps everything
const goldA1 = A.me.gold;
await open(A, B);
A.tx({ t: 'trade_offer', items: [w2.u], gold: 100 }); B.tx({ t: 'trade_offer', items: [], gold: 0 }); await wait(250);
A.tx({ t: 'trade_lock' }); B.tx({ t: 'trade_lock' }); await wait(250);
A.tx({ t: 'trade_confirm' }); await wait(150);
B.ws.close(); await wait(500);
ok(A.ended && !A.ended.ok && A.has(w2.u) && A.me.gold === goldA1, 'disconnecting mid-confirm cancels; the other side loses nothing');
ok((await status()).trades === 0, 'trade cleaned up after disconnect');

// ---- full pack on the receiving side cancels the swap, nothing moves
const C = await bot('TradeGamma'), D = await bot('TradeDelta');
C.tx({ t: 'dbg', give: 'weapon', n: 1 }); D.tx({ t: 'dbg', give: 'potion', n: 1 }); await wait(300);
for (let i = 0; i < 22; i++) { D.tx({ t: 'dbg', give: 'armor', n: 1, r: 0 }); }
await wait(600);
ok(!D.me.inv.includes(null), 'D\'s pack is completely full');
const cw = C.gear()[0], cGold = C.me.gold;
await open(C, D);
C.tx({ t: 'trade_offer', items: [cw.u], gold: 0 }); D.tx({ t: 'trade_offer', items: [], gold: 0 }); await wait(250);
C.tx({ t: 'trade_lock' }); D.tx({ t: 'trade_lock' }); await wait(250);
C.tx({ t: 'trade_confirm' }); D.tx({ t: 'trade_confirm' }); await wait(500);
ok(C.ended && !C.ended.ok && C.has(cw.u) && !D.has(cw.u) && C.me.gold === cGold, 'swap into a full pack is refused and nothing moves');

// ---- distance: moving apart cancels
await open(C, D);
C.tx({ t: 'trade_offer', items: [cw.u], gold: 0 }); await wait(200);
const c0 = C.ents.find((e) => e.i === C.me.id);
for (let k = 30; k < 40; k++) { C.tx({ t: 'dbg', tp: [c0.x - k, c0.y + (k % 3)] }); await wait(60); } // first free tile wins
await wait(1500);
ok(C.ended && !C.ended.ok && C.has(cw.u), 'moving out of range cancels the trade');

// ---- one trade at a time + can't trade with self / strangers
for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 1]]) { C.tx({ t: 'dbg', tp: [c0.x + dx, c0.y + dy] }); await wait(80); } // walk back into range
await wait(300);
await open(C, D);
const E = await bot('TradeEcho');
E.tx({ t: 'trade_req', name: 'TradeGamma' }); await wait(300);
ok(E.logs.some((l) => /already trading/.test(l)), 'cannot trade with someone already trading');
await wait(2100); E.tx({ t: 'trade_req', name: 'Nobody' }); await wait(300);
await wait(2100); E.tx({ t: 'trade_req', name: 'TradeEcho' }); await wait(300);
ok(E.logs.some((l) => /No hero by that name/.test(l)) && E.logs.some((l) => /yourself/.test(l)), 'unknown names and self-trades are refused');
C.tx({ t: 'trade_cancel' }); await wait(300);
const st = await status();
ok(st.trades === 0, 'all trades closed');

console.log('TRADE SMOKE OK');
done(0);
