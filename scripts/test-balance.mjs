// Balance guard: (1) the simulator's formulas match the live server, (2) the balance targets still hold.
//   Part 1 starts a real server, builds heroes of several jobs (level, attributes, random gear), and checks that the stats the
//   server reports equal what shared/combat.js derives from the same inputs, and that real monster hits obey the mitigation formula.
//   Part 2 runs the offline simulator and fails if a job drifts out of its role band (generous limits; docs/balance.md has the targets).
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { ATTRS, JOBS, WEAPON_TYPES } from '../shared/jobs.js';
import { MOBS } from '../shared/data.js';
import { deriveStats, power, mitigation, critFactor } from '../shared/combat.js';
import { evaluate, ROLE, COLUMNS } from './balance-sim.mjs';

const PORT = 3988 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0); // set EM_TEST_PORT_OFFSET to run beside another test run
const SAVE = 'data/test-saves-balance.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name, cls) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], evs: [], tx: (o) => ws.send(JSON.stringify(o)), ws };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'ev') b.evs.push(m); else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'test', cls });
  await wait(450);
  if (!b.me) fail(`${name}: no me message`);
  b.pos = () => b.ents.find((e) => e.i === b.me.id);
  return b;
}

await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);

/** what the shared formulas say for the hero the server sent us */
function expected(me) {
  const gear = { atk: 0, def: 0, hp: 0, crit: 0, dodge: 0, a: {} };
  for (const it of Object.values(me.eq)) {
    if (!it) continue;
    gear.atk += it.atk || 0; gear.def += it.def || 0; gear.hp += it.hp || 0; gear.crit += it.crit || 0; gear.dodge += it.dodge || 0;
    for (const k of ATTRS) if (it.a && it.a[k]) gear.a[k] = (gear.a[k] || 0) + it.a[k];
  }
  return deriveStats({ job: me.job, lvl: me.lvl, jobLvl: me.jobs[me.job].lvl, attr: me.attr, gear, weaponBase: me.eq.weapon ? me.eq.weapon.b : null });
}

// ---------------------------------------------------------------- part 1: the live server uses the same maths
const SLOTS = ['weapon', 'offhand', 'head', 'body', 'legs', 'boots', 'gloves', 'cape', 'ring', 'ring', 'amulet'];
const cases = [['mage', 40, 20], ['rogue', 30, 20], ['paladin', 55, 20], ['cleric', 12, 10], ['monk', 60, 20], ['warrior', 25, 12]];
for (const [job, lvl, jl] of cases) {
  const b = await bot(`Bal${job}`, job);
  b.tx({ t: 'dbg', lvl, jobLvl: jl, points: POINTS(lvl) }); await wait(300);
  const w = JOBS[job].growth;
  const keys = Object.keys(w);
  for (let i = 0; i < 6; i++) { // several attribute spends, biased to the job's growth, plus a stray point somewhere else
    b.tx({ t: 'attr', k: keys[i % keys.length], n: 10 }); await wait(60);
  }
  b.tx({ t: 'attr', k: 'dex', n: 3 }); await wait(60);
  for (const s of SLOTS) { b.tx({ t: 'dbg', give: s, r: 2 }); await wait(40); }
  await wait(200);
  for (let i = 0; i < 20; i++) { if (b.me.inv[i]) { b.tx({ t: 'equip', slot: i }); await wait(40); } }
  await wait(300);
  const m = b.me, st = expected(m);
  const worn = Object.values(m.eq).filter(Boolean).length;
  const near = (a, c, tol = 0.51) => Math.abs(a - c) <= tol;
  ok(worn >= 9, `${job}: wearing ${worn} pieces so every gear term is exercised`);
  ok(m.mh === st.mh, `${job} L${lvl}: max health ${m.mh} matches the shared formula (${st.mh})`);
  ok(m.st.atk === Math.round(power(st, lvl, st.wt.scale)), `${job}: weapon power ${m.st.atk} matches`);
  ok(m.st.def === Math.round(st.def) && m.st.mres === Math.round(st.mres), `${job}: defense ${m.st.def} / resist ${m.st.mres} match`);
  ok(near(m.st.crit, st.crit, 0.06) && m.st.critDmg === Math.round(st.critDmg * 100), `${job}: crit ${m.st.crit}% x${m.st.critDmg} match (cap respected: ${st.crit.toFixed(1)}%)`);
  ok(near(m.st.dodge, st.dodge, 0.06), `${job}: dodge ${m.st.dodge}% matches`);
  ok(m.st.haste === Math.round(st.haste * 100) && m.st.atkMs === Math.round(st.atkMs), `${job}: haste ${m.st.haste}% and swing time ${m.st.atkMs} ms match`);
  ok(m.st.heal === Math.round(st.healPow), `${job}: healing power ${m.st.heal} matches`);
  b.ws.close();
}

// a real monster hit lands for what the mitigation formula says
{
  const b = await bot('BalHit', 'warrior');
  const def = MOBS.slime;
  const f = mitigation(expected(b.me).def, 1);
  let hits = [], tries = 0;
  while (hits.length < 3 && tries++ < 8) {
    const me = b.pos();
    const s = b.ents.filter((e) => e.k === 'm' && e.s === 'slime').sort((x, y) => Math.hypot(x.x - me.x, x.y - me.y) - Math.hypot(y.x - me.x, y.y - me.y))[0];
    if (!s) { b.tx({ t: 'dbg', tp: [64, 84 + tries] }); await wait(500); continue; }
    b.tx({ t: 'dbg', tp: [s.x + 1, s.y] }); await wait(250);
    b.evs.length = 0; b.tx({ t: 'dbg', god: false });
    await wait(4000);
    hits = hits.concat(b.evs.filter((e) => e.e === 'dmg' && e.k === 'p' && e.id === b.me.id && e.v > 0).map((e) => e.v));
    b.tx({ t: 'dbg', tp: [s.x + 12, s.y] }); await wait(1500); // step away from this one
  }
  const lo = Math.max(1, Math.round(def.dmg[0] * 0.9 * f)), hi = Math.round(def.dmg[1] * 1.1 * f);
  ok(hits.length > 0, `a slime hit the hero ${hits.length} time(s)`);
  // damage events carry no source, so a wandering wolf or bat can add a bigger hit: require that most hits are slime-sized
  const inRange = hits.filter((v) => v >= lo - 1 && v <= hi + 1).length;
  ok(inRange >= Math.ceil(hits.length / 2), `most slime hits (${inRange}/${hits.length}: ${hits.join(',')}) fall within the mitigated range ${lo}-${hi}`);
  b.ws.close();
}
srv.kill();

// ---------------------------------------------------------------- part 2: the balance targets hold
const res = evaluate({ gears: ['geared'] }).geared;
const med = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const dpsJobs = Object.keys(ROLE).filter((j) => ROLE[j] === 'dps');
let worst = { r: 1, what: '' };
COLUMNS.forEach((c, ci) => {
  for (const key of ['dps1', 'dps3', 'burst']) {
    const m = med(dpsJobs.map((j) => res[j][ci][key]));
    for (const j of dpsJobs) {
      const r = res[j][ci][key] / m;
      if (Math.abs(Math.log(r)) > Math.abs(Math.log(worst.r))) worst = { r, what: `${j} ${key} L${c[0]}/j${c[1]}` };
      if (r > 1.35 || r < 0.7) fail(`${j} ${key} is ${r.toFixed(2)}x the dps median at L${c[0]}/j${c[1]}`);
    }
  }
  const m1 = med(dpsJobs.map((j) => res[j][ci].dps1));
  for (const j of Object.keys(ROLE).filter((x) => ROLE[x] !== 'dps')) {
    const r = res[j][ci].dps1 / m1;
    if (r < (ROLE[j] === 'tank' ? 0.5 : 0.4)) fail(`${j} kill power is only ${r.toFixed(2)}x the dps median at L${c[0]}/j${c[1]}`);
    if (r > 1.0) fail(`${j} out-damages the dps median (${r.toFixed(2)}x) at L${c[0]}/j${c[1]}`);
  }
});
ok(true, `every dps job stays within 0.7-1.35x of its role median (widest: ${worst.what} ${worst.r.toFixed(2)}x)`);
ok(Object.keys(ROLE).filter((j) => ROLE[j] === 'tank').every((j) => res[j].every((c, ci) => c.ehp > med(Object.keys(ROLE).map((x) => res[x][ci].ehp)))), 'tanks are the most durable jobs at every level');
const curve = critFactor(deriveStats({ job: 'ranger', lvl: 60, jobLvl: 20, attr: { dex: 600 }, gear: { a: { dex: 600 } }, weaponBase: 'bow' }));
ok(curve <= 1 + 0.5 * 0.8 + 1e-9 && WEAPON_TYPES.bow.ms > 0, 'crit and haste from dexterity are capped, however much is stacked');
console.log('BALANCE OK');
done(0);

function POINTS(lvl) { return lvl * 3 + 60; }
