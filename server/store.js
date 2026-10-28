// Hero storage adapters. One interface, two backends:
//   file     JSON file (EM_SAVE or data/saves.json). Default; used by local dev and tests.
//   postgres selected when DATABASE_URL is set. Survives Render free-plan deploys.
//
// Interface (all async methods never reject):
//   kind        'file' | 'postgres'
//   ok          false while the backend is failing (writes are queued in memory and retried)
//   load()      -> Promise<object>   map of name_key -> hero record
//   put(k, rec)                      queue a changed hero (sync, cheap, never waits on I/O)
//   flush()     -> Promise<boolean>  write everything queued now
//   close()     -> Promise<boolean>  final flush, stop timers
// The secret connection string is only ever read from the environment and is never logged.
import fs from 'node:fs';
import path from 'node:path';

export function createFileStore({ file, log = console.log } = {}) {
  let data = {};
  let dirty = false;
  let failed = false;
  const s = {
    kind: 'file',
    get ok() { return !failed; },
    async load() {
      try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
      return data;
    },
    put(k, rec) { data[k] = rec; dirty = true; },
    async flush() {
      if (!dirty) return true;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, file);
        dirty = false;
        if (failed) { failed = false; log('[store] file writes recovered'); }
        return true;
      } catch (e) {
        if (!failed) { failed = true; log(`[store] file write failed: ${e.message}`); }
        return false;
      }
    },
    async close() { return s.flush(); },
  };
  return s;
}

// Hosted Postgres (Supabase, Neon) needs TLS but often serves a chain Node does not trust by default.
// Strip any sslmode from the URL (pg would turn "require" into strict verification) and decide here.
export function pgConfig(url, env = process.env) {
  let conn = url, ssl = { rejectUnauthorized: false };
  try {
    const u = new URL(url);
    const mode = u.searchParams.get('sslmode');
    u.searchParams.delete('sslmode');
    conn = u.toString();
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
    if (mode === 'disable' || env.EM_PG_SSL === 'off' || (local && !mode)) ssl = false;
    else if (mode === 'verify-full' || env.EM_PG_SSL === 'verify') ssl = { rejectUnauthorized: true };
  } catch { /* leave as given; pg will report the error (without us logging the string) */ }
  return { connectionString: conn, ssl, max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30000 };
}

export function createPgStore({ pool, flushMs = 4000, backoffMs = 2000, backoffMax = 60000, log = console.log } = {}) {
  const pending = new Map();
  let timer = null, inflight = null, closed = false, failed = false, retryDelay = backoffMs;

  const schedule = (ms) => {
    if (timer || closed) return;
    timer = setTimeout(() => { timer = null; s.flush(); }, ms);
    timer.unref?.();
  };

  async function writeBatch() {
    while (pending.size) {
      const batch = [...pending];
      const keys = batch.map(([k]) => k), vals = batch.map(([, v]) => JSON.stringify(v));
      try {
        await pool.query(
          'insert into heroes (name_key, data) select k, d::jsonb from unnest($1::text[], $2::text[]) as t(k, d) ' +
          'on conflict (name_key) do update set data = excluded.data, updated_at = now()', [keys, vals]);
      } catch (e) {
        if (!failed) { failed = true; log(`[store] postgres write failed (${e.code || e.name}); playing from memory and retrying`); }
        schedule(retryDelay);
        retryDelay = Math.min(retryDelay * 2, backoffMax);
        return false;
      }
      // Only drop entries that were not re-saved while the write was in flight.
      for (const [k, v] of batch) if (pending.get(k) === v) pending.delete(k);
      if (failed) { failed = false; log('[store] postgres writes recovered'); }
      retryDelay = backoffMs;
    }
    return true;
  }

  const s = {
    kind: 'postgres',
    get ok() { return !failed; },
    async init() {
      await pool.query('create table if not exists heroes (name_key text primary key, data jsonb not null, updated_at timestamptz default now())');
    },
    async load() {
      const r = await pool.query('select name_key, data from heroes');
      const out = {};
      for (const row of r.rows) out[row.name_key] = row.data;
      return out;
    },
    put(k, rec) {
      pending.set(k, rec);
      schedule(flushMs);
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (inflight) return inflight.then(() => (pending.size ? s.flush() : !failed));
      inflight = writeBatch().catch(() => false).finally(() => { inflight = null; });
      return inflight;
    },
    async close(timeoutMs = 8000) {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      const done = await Promise.race([s.flush(), new Promise((r) => setTimeout(() => r(false), timeoutMs).unref?.())]);
      try { await Promise.race([pool.end?.(), new Promise((r) => setTimeout(r, 1500).unref?.())]); } catch { /* ignore */ }
      return done;
    },
    get pendingCount() { return pending.size; },
  };
  return s;
}

// Picks the backend. DATABASE_URL set -> postgres, falling back to the file store if it cannot be reached at boot.
export async function openStore({ file, databaseUrl = process.env.DATABASE_URL, log = console.log, makePool, bootTimeoutMs = 10000 } = {}) {
  const fileOnly = async () => { const f = createFileStore({ file, log }); f.loaded = await f.load(); return f; };
  if (!databaseUrl) return fileOnly();
  let pool;
  try {
    if (!makePool) {
      const pg = (await import('pg')).default;
      makePool = (cfg) => new pg.Pool(cfg);
    }
    pool = makePool(pgConfig(databaseUrl));
    pool.on?.('error', () => { /* idle client errors must not crash the process */ });
    const store = createPgStore({ pool, log });
    const guard = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('boot timeout')), bootTimeoutMs).unref?.())]);
    await guard(store.init());
    const loaded = await guard(store.load());
    // First boot against an empty database: import heroes from the local save file, if there is one.
    if (!Object.keys(loaded).length) {
      const old = await createFileStore({ file, log }).load();
      for (const [k, v] of Object.entries(old)) { loaded[k] = v; store.put(k, v); }
      if (Object.keys(old).length) log(`[store] imported ${Object.keys(old).length} hero(es) from ${path.basename(file)} into postgres`);
    }
    log(`[store] postgres connected, ${Object.keys(loaded).length} hero(es) loaded`);
    store.loaded = loaded;
    return store;
  } catch (e) {
    log(`[store] postgres unreachable at boot (${e.code || e.message}); FALLING BACK to the local file ${path.basename(file)}. Heroes saved this run will not survive a redeploy.`);
    try { pool?.end?.(); } catch { /* ignore */ }
    return fileOnly();
  }
}
