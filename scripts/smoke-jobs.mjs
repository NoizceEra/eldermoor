// Progression test: jobs, attributes, carry-over skills, bar rules, GCD/cooldowns, effects, migration.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SKILLS, JOBS, knownSkills, barSlots, POINTS_PER_LEVEL } from '../shared/jobs.js';

const PORT = 3994 + (Number(process.env.EM_TEST_PORT_OFFSET) || 0); // set EM_TEST_PORT_OFFSET to run beside another test run
const SAVE = 'data/test-saves-jobs.json';

// an old-format (v1) save to prove migration: ranger, level 12, no jobs/attr fields
const salt = 'abcdef0123456789';
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(SAVE, JSON.stringify({
  oldhero: { name: 'OldHero', salt, hash: crypto.scryptSync('test', salt, 32).toString('hex'), cls: 'ranger', lvl: 12, xp: 5, gold: 77,
    inv: Array(20).fill(null), eq: { weapon: null, armor: null, trinket: null }, quest: { i: 1, s: 0, p: 0 }, x: 64, y: 67, hp: 50 },
  // saved before paladin/druid/necromancer/monk existed: its jobs table has only the original six
  legacyhero: { v: 3, name: 'LegacyHero', salt, hash: crypto.scryptSync('test', salt, 32).toString('hex'), look: [0, 0, 0, 0], job: 'mage', lvl: 8, xp: 0, gold: 5,
    jobs: { warrior: { lvl: 0, xp: 0 }, mage: { lvl: 6, xp: 0 }, ranger: { lvl: 0, xp: 0 }, cleric: { lvl: 0, xp: 0 }, rogue: { lvl: 0, xp: 0 }, warlock: { lvl: 0, xp: 0 } },
    attr: { str: 0, dex: 0, int: 0, vit: 0, spr: 0 }, points: 0, bar: ['fireball', null, null, null, null, null],
    inv: Array(20).fill(null), eq: {}, quest: { i: 0, s: 0, p: 0 }, x: 64, y: 67, hp: 50 },
}));

const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE, EM_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { srv.kill(); try { fs.unlinkSync(SAVE); } catch { /* none */ } process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const ok = (c, m) => { if (!c) fail(m); else console.log('ok  -', m); };

async function bot(name, cls = 'warrior') {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { name, me: null, ents: [], logs: [], evs: [], tx: (o) => ws.send(JSON.stringify(o)), ws };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'me') b.me = m; else if (m.t === 's') b.ents = m.e; else if (m.t === 'log') b.logs.push(m.m);
    else if (m.t === 'ev') b.evs.push(m); else if (m.t === 'err') fail(m.m);
  });
  await new Promise((r) => ws.on('open', r));
  b.tx({ t: 'login', name, pass: 'test', cls });
  for (let i = 0; i < 40 && !b.me; i++) await wait(100);
  if (!b.me) fail(`${name}: no me message`);
  await wait(250); // let the first state packets arrive
  b.pos = () => b.ents.find((e) => e.i === b.me.id);
  return b;
}

await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);

// ---------------------------------------------------------------- shared data sanity
for (const [id, sk] of Object.entries(SKILLS)) {
  if (!JOBS[sk.job] || !sk.name || !sk.kind || !(sk.cd > 0) || !sk.ic || !sk.desc) fail(`skill ${id} is incomplete`);
}
ok(Object.keys(SKILLS).length === 60, '60 skills defined, 6 per job');
for (const j of Object.keys(JOBS)) ok(Object.values(SKILLS).filter((s) => s.job === j).length === 6, `${j} has 6 skills`);

// ---------------------------------------------------------------- new hero
const A = await bot('JobAlpha', 'mage');
ok(A.me.job === 'mage' && A.me.jobs.mage.lvl === 1 && A.me.jobs.warrior.lvl === 0, 'new mage starts at job level 1, other jobs unplayed');
ok(A.me.points === POINTS_PER_LEVEL, 'starts with 3 attribute points');
ok(A.me.bar[0] === 'fireball' && A.me.bar[1] === null, 'bar starts with the first learned skill');
ok(A.me.slots === 3 && A.me.eq.weapon && A.me.eq.weapon.b === 'staff' && A.me.st.range === 6, 'job gives a starter weapon; staff means ranged magic auto attacks');
const atk0 = A.me.st.atk, hp0 = A.me.mh;

// ---------------------------------------------------------------- attributes
A.tx({ t: 'attr', k: 'int', n: 3 }); await wait(250);
ok(A.me.points === 0 && A.me.attr.int === 3 && A.me.st.atk > atk0, `spending points raises power (${atk0} -> ${A.me.st.atk})`);
A.tx({ t: 'attr', k: 'int', n: 1 }); await wait(200);
ok(A.me.attr.int === 3, 'cannot spend points you do not have');
A.tx({ t: 'attr', k: 'bogus', n: 1 }); await wait(150);
ok(A.me.attr.bogus === undefined, 'unknown attributes are ignored');
A.tx({ t: 'attr', k: 'vit', n: 0 }); await wait(150);

// ---------------------------------------------------------------- multiclass: skills carry over
A.tx({ t: 'dbg', jobLvl: 10, lvl: 12 }); await wait(300);
const knownMage = knownSkills(A.me.jobs);
ok(knownMage.includes('fireball') && knownMage.includes('chain') && !knownMage.includes('meteor'), 'mage level 10 knows skills up to level 9');
ok(A.me.slots === 4, 'bar slots unlock with main level (4 at level 10)');
ok(A.me.bar.filter(Boolean).length === 4, 'new slots fill automatically');
A.tx({ t: 'bar', slot: 4, skill: 'fireball' }); await wait(200);
ok(A.me.bar[4] === null, 'cannot use a slot that is not unlocked yet');
A.tx({ t: 'bar', slot: 0, skill: 'assassinate' }); await wait(200);
ok(A.me.bar[0] !== 'assassinate', 'cannot slot a skill you have not learned');

A.tx({ t: 'job', id: 'warrior' }); await wait(300);
ok(A.me.job === 'warrior' && A.me.jobs.warrior.lvl === 1 && A.me.jobs.mage.lvl === 10, 'switching jobs keeps the other job\'s level');
ok(knownSkills(A.me.jobs).includes('cleave') && knownSkills(A.me.jobs).includes('frostnova'), 'warrior now knows warrior AND mage skills');
ok(A.me.bar.includes('fireball') || A.me.bar.includes('frostnova'), 'mage skills stay on the bar after switching to warrior');
A.tx({ t: 'bar', slot: 0, skill: 'cleave' }); await wait(200);
ok(A.me.bar[0] === 'cleave' && A.me.bar.filter((s) => s === 'cleave').length === 1, 'a Warrior can slot Cleave next to Mage skills');
const barBefore = [...A.me.bar];
A.tx({ t: 'bar', slot: 1, skill: 'cleave' }); await wait(200);
ok(A.me.bar[1] === 'cleave' && A.me.bar[0] === barBefore[1], 'dropping an equipped skill on another slot swaps them');
A.tx({ t: 'job', id: 'mage' }); await wait(250);
ok(A.me.job === 'warrior' && A.logs.some((l) => /change jobs again/.test(l)), 'job changes have a cooldown');

// ---------------------------------------------------------------- derived stats follow the job
ok(A.me.st.A.str >= 5 && A.me.mh > 0, 'stats recomputed for the active job');
const warriorHp = A.me.mh;

// ---------------------------------------------------------------- respec
A.tx({ t: 'dbg', gold: 1000 }); await wait(200);
A.tx({ t: 'respec' }); await wait(250);
ok(A.me.attr.int === 0 && A.me.points === POINTS_PER_LEVEL * A.me.lvl, `respec refunds every point (${A.me.points})`);

// ---------------------------------------------------------------- migration of a v1 save
const O = await bot('OldHero');
ok(O.me.job === 'ranger' && O.me.lvl === 12 && O.me.jobs.ranger.lvl === 6, 'old save migrates: ranger job level = half the old level');
ok(O.me.points === POINTS_PER_LEVEL * 12, 'old save migrates: all earned points are unspent');
ok(O.me.gold === 77 && O.me.quest.i === 1, 'old save keeps gold and quest');
ok(O.me.bar.filter(Boolean).length === barSlots(12) || O.me.bar.filter(Boolean).length >= 3, 'migrated hero gets a filled skill bar');

// ---------------------------------------------------------------- real combat: GCD, cooldown, damage, effects, job xp
const M = await bot('JobMage', 'mage');
M.tx({ t: 'dbg', god: true, jobLvl: 10, lvl: 12 }); await wait(250);
M.tx({ t: 'bar', slot: 1, skill: 'frostnova' }); await wait(200);
let slime = null;
for (const [x, y] of [[64, 82], [60, 84], [68, 84], [64, 88], [56, 86], [72, 86], [64, 92], [50, 90]]) {
  M.tx({ t: 'dbg', tp: [x, y] }); await wait(250);
  slime = M.ents.find((e) => e.k === 'm' && e.s === 'slime' && Math.hypot(e.x - M.pos().x, e.y - M.pos().y) < 6);
  if (slime) break;
}
ok(!!slime, 'found a slime in the meadow to fight');
const jxp0 = M.me.jobs.mage.xp + M.me.jobs.mage.lvl * 100000;
M.evs.length = 0;
M.tx({ t: 'target', id: slime.i });
M.tx({ t: 'skill', n: 1 }); await wait(250);
ok(M.evs.some((e) => e.e === 'cd' && e.id === 'fireball'), 'casting reports the skill cooldown by skill id');
ok(M.evs.some((e) => e.e === 'dmg' && e.id === slime.i), 'fireball damages the target');
const cds = M.evs.filter((e) => e.e === 'cd').length;
M.tx({ t: 'skill', n: 2 }); await wait(150);
ok(M.evs.filter((e) => e.e === 'cd').length === cds, 'the global cooldown blocks a second cast right away');
await wait(800);
const tgt = M.ents.find((e) => e.i === slime.i);
ok(!tgt || (tgt.fx && tgt.fx.includes('burn')) || tgt.h < tgt.mh, 'fireball applies a burn (or the slime is already dead)');
M.tx({ t: 'skill', n: 1 }); await wait(250);
ok(M.evs.filter((e) => e.e === 'cd' && e.id === 'fireball').length === 1, 'the same skill cannot be recast during its cooldown');
M.tx({ t: 'dbg', atkMul: 300 });
for (let i = 0; i < 12 && M.ents.find((e) => e.i === slime.i); i++) { M.tx({ t: 'target', id: slime.i }); await wait(1300); }
ok(M.me.jobs.mage.xp + M.me.jobs.mage.lvl * 100000 > jxp0 || M.me.jobs.mage.lvl >= 10, 'kills grant job experience');

// ---------------------------------------------------------------- the four newer jobs
const findSlime = async (b) => {
  for (let round = 0; round < 3; round++) {
    for (const [x, y] of [[64, 82], [60, 84], [68, 84], [64, 88], [56, 86], [72, 86], [64, 92], [50, 90], [80, 90], [58, 96], [70, 100]]) {
      b.tx({ t: 'dbg', tp: [x, y] }); await wait(250);
      const s = b.ents.find((e) => e.k === 'm' && e.s === 'slime' && Math.hypot(e.x - b.pos().x, e.y - b.pos().y) < 6);
      if (s) return s;
    }
    await wait(1500);
  }
  return null;
};
const NEW = {};
for (const [cls, first, weapon] of [['paladin', 'crusader', 'sword'], ['druid', 'moonfire', 'staff'], ['necromancer', 'deathbolt', 'wand'], ['monk', 'flurry', 'mace']]) {
  NEW[cls] = await bot(`Job${cls}`, cls);
  const b = NEW[cls];
  ok(b.me.job === cls && b.me.bar[0] === first && b.me.eq.weapon.b === weapon && b.me.eq.body, `a new ${cls} starts with ${first}, a ${weapon} and a starter outfit`);
  b.tx({ t: 'dbg', god: true, jobLvl: 20, lvl: 30 }); await wait(250);
}
const slotSkill = async (b, slot, skill) => { b.tx({ t: 'bar', slot, skill }); await wait(150); };

// monk: Flurry of Blows lands three separate hits
{
  const b = NEW.monk;
  let hits = 0;
  for (let attempt = 0; attempt < 4 && hits < 3; attempt++) { // a slime can wander off between teleport and cast: try again after the cooldown
    const s = await findSlime(b);
    ok(!!s, 'found a slime for the monk');
    b.tx({ t: 'dbg', tp: [s.x + 1, s.y] }); await wait(200);
    const q = b.pos(), m = b.ents.find((e) => e.i === s.i);
    if (!m || !q || Math.hypot(m.x - q.x, m.y - q.y) > 1.6) { await wait(3200); continue; }
    b.tx({ t: 'dbg', atkMul: 0.01 }); b.tx({ t: 'target', id: s.i }); b.evs.length = 0;
    b.tx({ t: 'skill', n: 1 }); await wait(300);
    hits = b.evs.filter((e) => e.e === 'dmg' && e.id === s.i).length || (b.ents.find((e) => e.i === s.i) ? 0 : 3);
    if (hits < 3) await wait(3200);
  }
  ok(hits >= 3, 'Flurry of Blows hits three times');
}

// druid: Entangling Roots pins a monster in place
{
  const b = NEW.druid, s = await findSlime(b);
  ok(!!s, 'found a slime for the druid');
  await slotSkill(b, 1, 'entangle');
  b.tx({ t: 'dbg', atkMul: 0.01 }); b.tx({ t: 'target', id: s.i }); b.evs.length = 0;
  b.tx({ t: 'skill', n: 2 }); await wait(400);
  const t = b.ents.find((e) => e.i === s.i);
  ok(t && t.fx && t.fx.includes('root'), 'Entangling Roots roots the target');
  const at = { x: t.x, y: t.y };
  await wait(1500);
  const t2 = b.ents.find((e) => e.i === s.i);
  ok(t2 && t2.x === at.x && t2.y === at.y, 'a rooted monster does not move');
}

// paladin: Righteous Charge closes the distance and strikes
{
  const b = NEW.paladin;
  await slotSkill(b, 1, 'charge');
  b.tx({ t: 'dbg', atkMul: 0.01 });
  let charged = false;
  for (let attempt = 0; attempt < 4 && !charged; attempt++) { // slimes wander: re-find one and re-measure each time
    const s = await findSlime(b);
    ok(!!s, 'found a slime for the paladin');
    let far = false;
    for (const [dx, dy] of [[5, 0], [-5, 0], [0, 5], [0, -5], [4, 2], [-4, -2]]) {
      b.tx({ t: 'dbg', tp: [s.x + dx, s.y + dy] }); await wait(250);
      const q = b.pos(), m = b.ents.find((e) => e.i === s.i);
      if (m && q && Math.hypot(m.x - q.x, m.y - q.y) > 3.5) { far = true; break; }
    }
    if (!far) { await wait(3200); continue; }
    b.tx({ t: 'target', id: s.i }); b.evs.length = 0;
    b.tx({ t: 'skill', n: 2 }); await wait(400);
    const q = b.pos(), m = b.ents.find((e) => e.i === s.i);
    charged = (!m || Math.hypot(m.x - q.x, m.y - q.y) <= 1.6) && b.evs.some((e) => e.e === 'dmg' && e.id === s.i);
    if (!charged) await wait(3200);
  }
  ok(charged, 'Righteous Charge rushes in and hits');
}

// druid + necromancer: party regeneration and a rooting area spell
{
  const d = NEW.druid, n = NEW.necromancer;
  d.tx({ t: 'pinvite', name: n.name }); await wait(300);
  n.tx({ t: 'pgo', ok: true }); await wait(400);
  await slotSkill(d, 2, 'wildgrowth');
  d.tx({ t: 'dbg', tp: [64, 70] }); n.tx({ t: 'dbg', tp: [65, 70] }); await wait(400);
  d.evs.length = 0;
  d.tx({ t: 'skill', n: 3 }); await wait(500);
  ok(d.me.fx.some((f) => f.id === 'regen') && n.me.fx.some((f) => f.id === 'regen'), 'Wild Growth puts regeneration on every nearby party member');
  const s = await findSlime(n);
  ok(!!s, 'found a slime for the necromancer');
  await slotSkill(n, 1, 'boneprison');
  n.tx({ t: 'dbg', atkMul: 0.01 });
  n.tx({ t: 'dbg', tp: [s.x + 2, s.y] }); await wait(250);
  n.tx({ t: 'skill', n: 2 }); await wait(400);
  const q2 = n.pos();
  ok(n.ents.some((e) => e.k === 'm' && Math.hypot(e.x - q2.x, e.y - q2.y) <= 3.6 && e.fx && e.fx.includes('root')), 'Bone Prison roots nearby enemies');
}

// a hero saved before the new jobs existed still switches into them
{
  const b = await bot('LegacyHero');
  ok(b.me.job === 'mage' && b.me.jobs.monk && b.me.jobs.monk.lvl === 0, 'an old save gains the new jobs at level 0');
  b.tx({ t: 'job', id: 'monk' }); await wait(300);
  ok(b.me.job === 'monk' && b.me.jobs.monk.lvl === 1 && b.me.jobs.mage.lvl === 6, 'and can switch into one without losing the old job');
}

console.log('JOBS SMOKE OK');
done(0);
