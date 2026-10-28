# Keeping heroes across deploys

Render's free plan wipes the disk on every deploy and restart, so the default JSON save file (`data/saves.json`) resets. Eldermoor can instead store heroes in a free Postgres database. It is switched on by one environment variable, `DATABASE_URL`. Without it the game behaves exactly as before (file storage, used by local dev and the tests).

## How it works

- At startup the server loads every hero from the `heroes` table into memory (`heroes(name_key text primary key, data jsonb not null, updated_at timestamptz default now())`, created automatically).
- The game runs from memory. Changed heroes are queued and written in one batch every ~4 seconds, on logout, and on shutdown (SIGTERM from a Render deploy). The 20 Hz tick never waits on the database.
- If the database fails, the game keeps running from memory, logs the outage once, and retries with growing delays (2s up to 60s). Nothing queued is dropped.
- If the database cannot be reached when the server boots, it falls back to the local file and logs `FALLING BACK`. Heroes made during that run are then ephemeral.
- The connection string is read only from `DATABASE_URL` and is never logged.
- `GET /api/status` reports `"store": "postgres"` or `"file"` and `"storeOk": true|false`.

## Owner steps (Supabase)

1. Sign in at supabase.com and create a new project (free plan). Pick a region near your Render region and set a database password. Save the password somewhere private.
2. Open the project, click **Connect** at the top, and copy the **Session pooler** connection string (host like `aws-0-<region>.pooler.supabase.com`, port 5432). The pooled strings work on Render's free plan; the "Direct connection" string is IPv6 only and often fails there. Replace `[YOUR-PASSWORD]` with your password.
3. In the Render dashboard open the `eldermoor` service, go to **Environment**, click **Add Environment Variable**, key `DATABASE_URL`, value the string from step 2. Save.
4. Render redeploys (or use **Manual Deploy > Deploy latest commit**). Wait until it is live.
5. Verify: open `https://<your-service>.onrender.com/api/status`. You should see `"store":"postgres","storeOk":true`. In the Render logs you will see `[store] postgres connected, N hero(es) loaded`.
6. Test it: make a hero, log out, trigger a manual deploy, log back in. The hero is still there. In Supabase **Table Editor > heroes** you can see the rows.

If `/api/status` says `"store":"file"` after step 4, the database was unreachable at boot: check the Render logs for the `[store]` line, then re-check the string and password (special characters in the password must be URL-encoded).

### Neon instead

Create a project at neon.tech, copy the **pooled** connection string from the dashboard (the host contains `-pooler`), and use it as `DATABASE_URL` in step 3. Everything else is the same.

## Export and restore

Backup, from your own machine (needs Node and `npm install`):

```
DATABASE_URL="<your string>" node scripts/saves-tool.mjs export heroes-backup.json
```

PowerShell: `$env:DATABASE_URL="<your string>"; node scripts/saves-tool.mjs export heroes-backup.json`

Restore (or move local heroes into the database):

```
DATABASE_URL="<your string>" node scripts/saves-tool.mjs import heroes-backup.json
```

Import overwrites heroes with the same name. Do it while the game server is idle, since a running server holds heroes in memory and would write its own copy back on the next save. Restart (redeploy) the service after an import so it loads the restored data.

Without `DATABASE_URL` the same script works on the local `data/saves.json`. If the database is empty on first boot and a save file is present, its heroes are imported automatically.

You can also use SQL: `select name_key, data from heroes;` in the Supabase SQL editor.

## Caveats

- Free Supabase projects pause after a week of no activity (restore with one click in the dashboard); free Neon scales to zero and wakes on connect. The Render service itself still sleeps after ~15 idle minutes, which is unrelated to saves.
- Free database tiers have no guaranteed backups. Export now and then.
- Heroes are saved a few seconds after a change. A hard crash (not a normal deploy) can lose the last few seconds of progress.
- Only one game server instance should run against a database. Two instances would overwrite each other's in-memory heroes.
- Passwords are stored as salted hashes inside the hero record, as before. Treat `DATABASE_URL` and any export file as private.
- Never commit `DATABASE_URL`; `render.yaml` declares it with `sync: false` so its value is only ever set in the Render dashboard.
