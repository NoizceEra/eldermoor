// Gear + appearance test: starter kits, 11 slots, rings, affixes, looks, wire format, v2 -> v3 migration.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { EQ_KEYS, validLook, defaultLook, LOOK_COST, KINDS, VIS_ORDER } from '../shared/gear.js';

const PORT = 3993;
const SAVE = 'data/test-saves-gear.json';
const salt = '0123456789abcdef';
fs.mkdirSync('data', { recursive: true });
// a v2 save: three equipment slots (armor / trinket) and an old-style armor item in the pack
fs.writeFileSync(SAVE, JSON.stringify({
  legacy: {
    v: 2, name: 'Legacy', salt, hash: crypto.scryptSync('x', salt, 32).toString('hex'), job: 'cleric',
    jobs: { warrior: { lvl: 0, xp: 0 }, mage: { lvl: 0, xp: 0 }, ranger: { lvl: 0, xp: 0 }, cleric: { lvl: 4, xp: 0 }, rogue: { lvl: 0, xp: 0 }, warlock: { lvl: 0, xp: 0 } },
    attr: { str: 0, dex: 0, int: 0, vit: 0, spr: 3 }, points: 3, bar: [null, null, null, null, null, null], lvl: 8, xp: 0, gold: 10,
    inv: [{ u: 900, s: 'armor', r: 1, l: 5, b: 'armor', n: 'Old Plate', atk: 0, def: 9, hp: 4, v: 20 }, ...Array(19).fill(null)],
    eq: {
      weapon: { u: 901, s: 'weapon', r: 0, l: 1, b: 'mace', n: 'Old Mace', atk: 3, def: 0, hp: 0, v: 5 },
      armor: { u: 902, s: 'armor', r: 2, l: 6, b: 'armor', n: 'Old Mail', atk: 0, def: 12, hp: 8, v: 40 },
      trinket: { u: 903, s: 'trinket', r: 1, l: 5, b: 'amulet', n: 'Old Amulet', atk: 0, def: 0, hp: 30, v: 30 },
    },
    quest: { i: 0, s: 0, p: 0 }, x: 64, y: 67, hp: 100,
  },
}));

const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name, cls = 'warrior', look) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], logs: [], tx: (o) => ws.send(JSON.stringify(o)), ws };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'log') b.logs.push(m.m); else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'x', cls, look });
  await wait(450);
  if (!b.me) fail(`${name}: no me message`);
  b.inv = (slot) => b.me.inv.filter((i) => i && i.s === slot);
  return b;
}

await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);

// ---------------------------------------------------------------- starter kit + looks
const A = await bot('GearAlpha', 'warrior', [2, 3, 4, 1]);
ok(JSON.stringify(A.me.look) === '[2,3,4,1,0,0]', 'a new hero keeps the look chosen in the creator');
const bad = await bot('GearBad', 'mage', [99, -1, 'x', 0]);
ok(JSON.stringify(bad.me.look) === JSON.stringify(defaultLook('GearBad')) && validLook(bad.me.look), 'an invalid look falls back to a valid default');
for (const k of ['weapon', 'head', 'body', 'legs', 'boots', 'offhand']) ok(A.me.eq[k], `warrior starts wearing: ${k} (${A.me.eq[k] && A.me.eq[k].n})`);
ok(!A.me.eq.cape && !A.me.eq.ring1 && A.me.mh > 0 && A.me.st.def > 0, 'starter kit gives a little defense; cape and rings are empty');
ok(Object.keys(A.me.eq).length === EQ_KEYS.length && EQ_KEYS.every((k) => k in A.me.eq), `there are ${EQ_KEYS.length} equipment slots`);

// ---------------------------------------------------------------- wire format other players see
const B = await bot('GearBeta', 'mage');
await wait(500);
const seen = B.ents.find((e) => e.i === A.me.id);
ok(seen && seen.vs.length === VIS_ORDER.length && seen.vs[0].startsWith('helm~') && seen.vs[7].startsWith('sword~'), 'other players receive the worn-gear summary');
ok(JSON.stringify(seen.lk) === '[2,3,4,1,0,0]', 'other players receive the look');

// ---------------------------------------------------------------- every slot
A.tx({ t: 'dbg', lvl: 30, god: false }); await wait(250);
const DEF0 = A.me.st.def, A_SUM0 = Object.values(A.me.st.A).reduce((a, b) => a + b, 0);
const slots = ['head', 'body', 'legs', 'boots', 'gloves', 'cape', 'offhand', 'amulet', 'weapon'];
for (const slot of slots) A.tx({ t: 'dbg', give: slot, n: 1, r: 3 });
A.tx({ t: 'dbg', give: 'ring', n: 3, r: 2 });
await wait(600);
ok(slots.every((s) => A.inv(s).length >= 1) && A.inv('ring').length === 3, 'items of every slot exist in the pack');
const epic = A.inv('body')[0];
ok(epic.a && Object.keys(epic.a).length >= 1 && / of (Might|Agility|Insight|Vigor|Grace)$/.test(epic.n), `epic gear rolls affixes (${epic.n}: ${JSON.stringify(epic.a)})`);
ok(KINDS.body.some((k) => k.b === epic.b) && epic.cl, 'gear carries a visual kind and a dye colour');
const rings = A.inv('ring');
ok(rings.every((r) => r.a && Object.keys(r.a).length === 1 && r.hp > 0), 'rings give health plus one attribute');
const equipAll = async () => {
  for (const slot of slots) { const it = A.inv(slot)[0]; if (it) { A.tx({ t: 'equip', slot: A.me.inv.findIndex((i) => i && i.u === it.u) }); await wait(120); } }
};
await equipAll();
for (const slot of slots) ok(A.me.eq[slot] && A.me.eq[slot].s === slot, `equipped into ${slot}`);
ok(A.me.st.def > DEF0 && Object.values(A.me.st.A).reduce((a, b) => a + b, 0) > A_SUM0, `gear raises defense (${DEF0} -> ${A.me.st.def}) and attributes`);
ok(A.me.st.crit > 5, `gloves/quiver bonuses reach crit chance (${A.me.st.crit}%)`);

// ---------------------------------------------------------------- rings: two slots, then replace ring 1
const [r1, r2, r3] = rings;
const idx = (u) => A.me.inv.findIndex((i) => i && i.u === u);
A.tx({ t: 'equip', slot: idx(r1.u) }); await wait(150);
A.tx({ t: 'equip', slot: idx(r2.u) }); await wait(150);
ok(A.me.eq.ring1 && A.me.eq.ring1.u === r1.u && A.me.eq.ring2 && A.me.eq.ring2.u === r2.u, 'first two rings fill ring 1 and ring 2');
A.tx({ t: 'equip', slot: idx(r3.u) }); await wait(150);
ok(A.me.eq.ring1.u === r3.u && A.me.eq.ring2.u === r2.u && idx(r1.u) >= 0, 'a third ring replaces ring 1 and the old one returns to the pack');

// ---------------------------------------------------------------- unequip + no duplication
const uids = () => [...A.me.inv.filter(Boolean), ...Object.values(A.me.eq).filter(Boolean)].map((i) => i.u);
ok(new Set(uids()).size === uids().length, 'no item is in two places at once');
A.tx({ t: 'unequip', s: 'ring2' }); await wait(150);
ok(A.me.eq.ring2 === null && idx(r2.u) >= 0, 'unequip moves the item back to the pack');
A.tx({ t: 'unequip', s: 'nonsense' }); await wait(100);
A.tx({ t: 'equip', slot: 0 }); await wait(100);
ok(new Set(uids()).size === uids().length, 'bad unequip/equip requests change nothing');
A.tx({ t: 'dbg', give: 'head', n: 25, r: 0 }); await wait(500);
const full = !A.me.inv.includes(null);
A.tx({ t: 'unequip', s: 'head' }); await wait(200);
ok(!full || A.me.eq.head, 'unequipping into a full pack is refused');

// ---------------------------------------------------------------- level requirement
const C = await bot('GearGamma', 'ranger');
C.tx({ t: 'dbg', give: 'body', n: 1, r: 3 }); await wait(300); // level-10 item for a level-1 hero (needs 8)
const heavy = C.inv('body')[0], before = C.me.eq.body.u;
C.tx({ t: 'equip', slot: C.me.inv.findIndex((i) => i && i.u === heavy.u) }); await wait(200);
ok(C.me.eq.body.u === before && C.logs.some((l) => /You need level/.test(l)), 'level requirements are enforced');

// ---------------------------------------------------------------- changing your look
const look0 = [...A.me.look];
A.tx({ t: 'dbg', gold: 200 });
for (let k = 0; k < 8; k++) { A.tx({ t: 'dbg', tp: [36 - k, 60 + (k % 3)] }); await wait(80); } // first free tile outside the town walls
await wait(300);
A.tx({ t: 'look', look: [0, 0, 0, 0] }); await wait(250);
ok(JSON.stringify(A.me.look) === JSON.stringify(look0) && A.logs.some((l) => /town square/.test(l)), 'a new look needs the town square');
A.tx({ t: 'dbg', tp: [64, 67] }); await wait(300);
const gold0 = A.me.gold;
A.tx({ t: 'look', look: [9, 9, 9, 9] }); await wait(200);
ok(A.me.gold === gold0 && JSON.stringify(A.me.look) === JSON.stringify(look0), 'an invalid look is ignored and costs nothing');
A.tx({ t: 'look', look: look0 }); await wait(200);
ok(A.me.gold === gold0, 'applying the same look is free');
A.tx({ t: 'look', look: [1, 2, 3, 4, 2, 5] }); await wait(250);
ok(JSON.stringify(A.me.look) === '[1,2,3,4,2,5]' && A.me.gold === gold0 - LOOK_COST, `a new look in town costs ${LOOK_COST}g`);
await wait(500);
ok(JSON.stringify(B.ents.find((e) => e.i === A.me.id).lk) === '[1,2,3,4,2,5]', 'other players see the new look');

// ---------------------------------------------------------------- persistence of look + gear
A.ws.close(); await wait(600);
const A2 = await bot('GearAlpha', 'mage');
ok(JSON.stringify(A2.me.look) === '[1,2,3,4,2,5]' && A2.me.eq.head && A2.me.eq.amulet && A2.me.eq.ring1, 'look and 11-slot gear persist across logins');

// ---------------------------------------------------------------- migration of a v2 save
const L = await bot('Legacy');
ok(L.me.eq.weapon.u === 901 && L.me.eq.body && L.me.eq.body.u === 902 && L.me.eq.body.s === 'body', 'old armor slot migrates to the body slot');
ok(L.me.eq.amulet && L.me.eq.amulet.u === 903 && L.me.eq.ring1 === null, 'old trinket migrates to the right slot (amulet)');
ok(L.me.inv[0] && L.me.inv[0].u === 900 && L.me.inv[0].s === 'body' && KINDS.body.some((k) => k.b === L.me.inv[0].b), 'old armor items in the pack become body items');
ok(validLook(L.me.look), 'a migrated hero gets a valid look');
L.tx({ t: 'equip', slot: 0 }); await wait(200);
ok(L.me.eq.body.u === 900 && L.me.inv.some((i) => i && i.u === 902), 'migrated items still equip and swap normally');

console.log('GEAR SMOKE OK');
done(0);
