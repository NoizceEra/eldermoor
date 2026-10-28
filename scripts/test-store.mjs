// Unit tests for the Postgres adapter against a stub pool (no real database).
import fs from 'node:fs';
import { createPgStore, createFileStore, openStore, pgConfig } from '../server/store.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL:', m); } else console.log('ok  -', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = [];
const log = (m) => quiet.push(m);

function stubPool() {
  const p = { calls: [], rows: {}, failNext: 0, ended: false };
  p.query = async (sql, args) => {
    p.calls.push({ sql, args });
    if (/^select name_key/.test(sql)) return { rows: Object.entries(p.rows).map(([name_key, data]) => ({ name_key, data })) };
    if (/^insert/.test(sql)) {
      if (p.failNext > 0) { p.failNext--; throw Object.assign(new Error('boom'), { code: 'ECONNRESET' }); }
      args[0].forEach((k, i) => { p.rows[k] = JSON.parse(args[1][i]); });
    }
    return { rows: [] };
  };
  p.end = async () => { p.ended = true; };
  p.inserts = () => p.calls.filter((c) => /^insert/.test(c.sql));
  return p;
}

// batching: many puts, one write; last write per hero wins
{
  const pool = stubPool(), s = createPgStore({ pool, flushMs: 40, backoffMs: 20, log });
  await s.init();
  ok(/create table if not exists heroes/.test(pool.calls[0].sql), 'init creates the heroes table if missing');
  for (let i = 0; i < 50; i++) s.put('hero' + (i % 10), { v: 3, n: i });
  ok(pool.inserts().length === 0, 'puts do not touch the database synchronously');
  await wait(120);
  ok(pool.inserts().length === 1 && pool.inserts()[0].args[0].length === 10, 'one debounced batch carries every changed hero once');
  ok(pool.rows.hero3.n === 43, 'the latest version of each hero is written');
  ok(s.ok && s.pendingCount === 0, 'store is healthy and queue is empty afterwards');
  await s.close();
}

// load maps rows back
{
  const pool = stubPool(); pool.rows = { a: { lvl: 5 }, b: { lvl: 9 } };
  const s = createPgStore({ pool, log });
  const m = await s.load();
  ok(m.a.lvl === 5 && m.b.lvl === 9, 'load returns every stored hero keyed by name_key');
  await s.close();
}

// failure: logged once, retried with backoff, recovers, nothing lost
{
  quiet.length = 0;
  const pool = stubPool(), s = createPgStore({ pool, flushMs: 20, backoffMs: 30, log });
  pool.failNext = 3;
  s.put('hero', { n: 1 });
  await wait(60);
  ok(!s.ok && s.pendingCount === 1, 'a failed write marks the store not ok and keeps the hero queued');
  s.put('hero', { n: 2 }); // updated during the outage
  await wait(500);
  ok(pool.inserts().length === 4, `retried with backoff until it succeeded (${pool.inserts().length} attempts)`);
  ok(s.ok && pool.rows.hero.n === 2, 'recovers and writes the newest version');
  ok(quiet.filter((m) => /write failed/.test(m)).length === 1 && quiet.some((m) => /recovered/.test(m)), 'the outage is logged once, plus one recovery line');
  await s.close();
}

// shutdown flush: pending data is written by close() without waiting for the timer
{
  const pool = stubPool(), s = createPgStore({ pool, flushMs: 60000, log });
  s.put('late', { n: 7 });
  const res = await s.close();
  ok(res === true && pool.rows.late && pool.rows.late.n === 7 && pool.ended, 'close() flushes pending heroes immediately and ends the pool');
}

// close with a dead database must not hang
{
  const pool = stubPool(); pool.failNext = 99;
  const s = createPgStore({ pool, flushMs: 60000, backoffMs: 10, log });
  s.put('x', { n: 1 });
  const t = Date.now();
  const res = await s.close(500);
  ok(res === false && Date.now() - t < 3000, 'close() gives up quickly when the database is down');
}

// put during an in-flight write is not lost
{
  const pool = stubPool();
  const orig = pool.query;
  let release; const gate = new Promise((r) => (release = r));
  pool.query = async (sql, args) => { if (/^insert/.test(sql) && !pool.gated) { pool.gated = true; await gate; } return orig(sql, args); };
  const s = createPgStore({ pool, flushMs: 10000, log });
  s.put('h', { n: 1 });
  const f = s.flush();
  await wait(20);
  s.put('h', { n: 2 });
  release();
  await f; await s.flush();
  ok(pool.rows.h.n === 2, 'a hero re-saved while a write is in flight is still written afterwards');
  await s.close();
}

// boot fallback: unreachable database -> file store, with no connection string in the log
{
  quiet.length = 0;
  const secret = 'postgres://user:SECRETPASS@db.example.invalid:5432/postgres';
  const s = await openStore({ file: 'data/test-saves-store-unit.json', databaseUrl: secret, log, bootTimeoutMs: 500,
    makePool: () => ({ query: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); }, end: async () => {} }) });
  ok(s.kind === 'file' && s.ok && s.loaded && typeof s.loaded === 'object', 'unreachable database at boot falls back to the file store');
  ok(quiet.some((m) => /FALLING BACK/.test(m)) && !quiet.join('\n').includes('SECRETPASS') && !quiet.join('\n').includes('postgres://'), 'the fallback is logged without leaking the connection string');
}

// ssl handling
{
  ok(pgConfig('postgres://u:p@aws-0.pooler.supabase.com:6543/postgres').ssl.rejectUnauthorized === false, 'hosted URLs get TLS without strict chain verification');
  ok(pgConfig('postgres://u:p@h.neon.tech/db?sslmode=require').connectionString.includes('sslmode') === false, 'sslmode is stripped so pg does not force verify-full');
  ok(pgConfig('postgres://u:p@localhost:5432/db').ssl === false, 'localhost Postgres defaults to no TLS');
}

// file store still behaves
{
  const f = 'data/test-saves-store-unit2.json';
  const s = createFileStore({ file: f, log });
  await s.load(); s.put('k', { n: 1 }); await s.flush();
  const s2 = createFileStore({ file: f, log });
  ok((await s2.load()).k.n === 1, 'file store round-trips');
  fs.unlinkSync(f);
}

if (fails) { console.error(`${fails} store test(s) failed`); process.exit(1); }
console.log('STORE UNIT OK');
process.exit(0);
