// Two-bot party test: invite/accept, shared XP + quest credit, leave/disband, negative cases.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3998;
const SAVE = 'data/test-saves-party.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none written */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name, cls = 'warrior') {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], logs: [], party: null, inv: null, tx: (o) => ws.send(JSON.stringify(o)), ws };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'party') b.party = m; else if (m.t === 'pinv') b.inv = m; else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'x', cls });
  await wait(400);
  if (!b.me) fail(`${name}: no me message`);
  b.pos = () => b.ents.find((e) => e.i === b.me.id);
  return b;
}

await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);
const A = await bot('PartyAlpha');
const B = await bot('PartyBeta', 'mage');

// negative cases first
A.tx({ t: 'pinvite', name: 'NoSuchHero' });
await wait(300);
ok(A.logs.some((l) => /No hero by that name/.test(l)), 'inviting an unknown name is rejected');
B.tx({ t: 'pgo', ok: true });
await wait(300);
ok(B.logs.some((l) => /expired/.test(l)), 'accepting with no invite is rejected');

// invite + accept
await wait(2100);
A.tx({ t: 'pinvite', name: 'PartyBeta' });
await wait(300);
ok(B.inv && B.inv.name === 'PartyAlpha', 'B receives the invite');
B.tx({ t: 'pgo', ok: true });
await wait(400);
ok(A.party && A.party.members.length === 2 && B.party && B.party.members.length === 2, 'both see a 2-member party');
ok(A.party.leader === A.me.id, 'inviter is leader');

// already grouped
const C = await bot('PartyGamma');
await wait(2100);
C.tx({ t: 'pinvite', name: 'PartyBeta' });
await wait(300);
ok(C.logs.some((l) => /already in a party/.test(l)), 'inviting someone already grouped is rejected');
C.ws.close();

// quest credit: both take the first quest from Elder Mira
for (const bt of [A, B]) {
  for (let i = 0; i < 4; i++) { bt.tx({ t: 'move', dx: 0, dy: -1 }); await wait(190); }
  bt.tx({ t: 'questAccept' });
}
await wait(400);
ok(A.me.quest.s === 1 && B.me.quest.s === 1, 'both accepted the slime quest');

// A hunts a slime near town while B waits in range (B never attacks)
const xp0 = [A.me.xp + A.me.lvl * 1000, B.me.xp + B.me.lvl * 1000];
for (let step = 0; step < 300 && A.me.quest.p < 1; step++) {
  const me = A.pos();
  const slime = A.ents.filter((e) => e.k === 'm' && e.s === 'slime').sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  if (!slime) { A.tx({ t: 'move', dx: 0, dy: 1 }); await wait(170); continue; }
  A.tx({ t: 'target', id: slime.i });
  const dx = slime.x - me.x, dy = slime.y - me.y;
  if (Math.hypot(dx, dy) > 1.4) A.tx({ t: 'move', dx: Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0, dy: Math.abs(dx) >= Math.abs(dy) ? 0 : Math.sign(dy) });
  else A.tx({ t: 'skill', n: 1 });
  await wait(170);
}
await wait(600);
const bd = Math.hypot(A.pos().x - B.pos().x, A.pos().y - B.pos().y);
console.log(`   (A-B distance at the kill: ${bd.toFixed(1)} tiles)`);
ok(A.me.quest.p >= 1, 'A got quest credit');
ok(bd <= 25, 'B was within shared-XP range');
ok(B.me.quest.p >= 1, 'B (who never attacked) got quest credit');
ok(B.me.xp + B.me.lvl * 1000 > xp0[1] && A.me.xp + A.me.lvl * 1000 > xp0[0], 'both gained XP');

// leave -> disband
B.tx({ t: 'pleave' });
await wait(400);
ok(B.party.members.length === 0 && A.party.members.length === 0, 'party disbands when one of two leaves');
const st = await (await fetch(`http://localhost:${PORT}/api/status`)).json();
ok(st.parties === 0, `status reports 0 parties (got ${st.parties})`);

// 3-person party, leader disconnects -> leadership passes
A.tx({ t: 'pinvite', name: 'PartyBeta' });
await wait(300); B.tx({ t: 'pgo', ok: true }); await wait(400);
const D = await bot('PartyDelta');
await wait(2100); A.tx({ t: 'pinvite', name: 'PartyDelta' }); await wait(300); D.tx({ t: 'pgo', ok: true }); await wait(400);
ok(D.party.members.length === 3, 'third member joins');
A.ws.close(); await wait(500);
ok(B.party.members.length === 2 && B.party.leader !== A.me.id, 'leadership passes when the leader disconnects');

console.log('PARTY SMOKE OK');
done(0);
