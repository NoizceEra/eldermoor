// Headless smoke test: boots the server, logs in a bot, walks, fights, checks state.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3999;
const SAVE = 'data/test-saves-smoke.json';
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), EM_SAVE: SAVE }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error('FAIL:', m); srv.kill(); process.exit(1); };

await wait(1500);
if (!out.includes('listening')) fail('server did not start: ' + out);
const status = await (await fetch(`http://localhost:${PORT}/api/status`)).json();
if (!(status.mobs > 100)) fail('too few mobs: ' + JSON.stringify(status));
const html = await (await fetch(`http://localhost:${PORT}/`)).text();
if (!html.includes('<canvas')) fail('index.html missing canvas');

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
const st = { me: null, ents: [], logs: [], ev: [] };
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t === 'me') st.me = m; else if (m.t === 's') st.ents = m.e; else if (m.t === 'log') st.logs.push(m.m); else if (m.t === 'ev') st.ev.push(m);
  else if (m.t === 'err') fail(m.m);
});
await new Promise((r) => ws.on('open', r));
const tx = (o) => ws.send(JSON.stringify(o));
tx({ t: 'login', name: 'SmokeBot', pass: 'x', cls: 'warrior' });
for (let i = 0; i < 40 && !st.me; i++) await wait(100);
if (!st.me) fail('no me message');
await wait(250); // let the first state packets arrive
const start = { x: st.ents.find((e) => e.i === st.me.id).x, y: st.ents.find((e) => e.i === st.me.id).y };
for (let i = 0; i < 8; i++) { tx({ t: 'move', dx: 0, dy: 1 }); await wait(170); }
const now = st.ents.find((e) => e.i === st.me.id);
if (now.y <= start.y + 3) fail(`did not walk south (${start.y} -> ${now.y})`);
// fight: leave town by the south gate, then walk to the nearest reachable slime and hit it
let target, last = null, stuck = 0, cur = 0, steps = 0;
const skip = new Set();
for (let step = 0; step < 500 && !st.logs.some((l) => /XP|gold/.test(l)); step++) {
  const me = st.ents.find((e) => e.i === st.me.id);
  if (me.y < 79) { tx({ t: 'move', dx: me.y < 70 || me.x === 64 ? 0 : Math.sign(64 - me.x), dy: me.y < 70 || me.x === 64 ? 1 : 0 }); await wait(160); continue; }
  target = st.ents.filter((e) => e.k === 'm' && e.s === 'slime' && !skip.has(e.i)).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  if (!target) { tx({ t: 'move', dx: 0, dy: 1 }); await wait(160); continue; }
  if (target.i !== cur) { cur = target.i; steps = 0; }
  if (++steps > 70) { skip.add(target.i); continue; } // unreachable (water / trees)
  tx({ t: 'target', id: target.i });
  const dx = target.x - me.x, dy = target.y - me.y;
  stuck = last && last.x === me.x && last.y === me.y && Math.hypot(dx, dy) > 1.4 ? stuck + 1 : 0;
  last = { x: me.x, y: me.y };
  if (Math.hypot(dx, dy) > 1.4) {
    const horiz = Math.abs(dx) >= Math.abs(dy);
    let mx = horiz ? Math.sign(dx) : 0, my = horiz ? 0 : Math.sign(dy);
    if (stuck >= 2) [mx, my] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
    tx({ t: 'move', dx: mx, dy: my });
  } else tx({ t: 'skill', n: 1 });
  await wait(160);
}
const killed = st.me.xp > 0 || st.me.lvl > 1;
console.log('state', JSON.stringify({ lvl: st.me.lvl, xp: st.me.xp, gold: st.me.gold, hp: st.me.hp, ents: st.ents.length }));
console.log('last logs:', st.logs.slice(-4));
if (!killed) fail('never earned XP from a kill');
ws.close();
await wait(300);
const saves = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
if (!saves.smokebot) fail('player not persisted');
fs.unlinkSync(SAVE);
console.log('SMOKE OK');
srv.kill();
process.exit(0);
