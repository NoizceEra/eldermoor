// Export or import every hero as one JSON file.
//   DATABASE_URL=... node scripts/saves-tool.mjs export heroes-backup.json
//   DATABASE_URL=... node scripts/saves-tool.mjs import heroes-backup.json
// Without DATABASE_URL it works on the local save file (EM_SAVE or data/saves.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.js';

const [cmd, target] = process.argv.slice(2);
if (!['export', 'import'].includes(cmd) || !target) {
  console.error('usage: node scripts/saves-tool.mjs export|import <file.json>');
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.env.EM_SAVE || path.join(ROOT, 'data', 'saves.json');
const store = await openStore({ file });
if (process.env.DATABASE_URL && store.kind !== 'postgres') { console.error('Could not reach the database; nothing done.'); process.exit(1); }
if (cmd === 'export') {
  fs.writeFileSync(target, JSON.stringify(store.loaded, null, 1));
  console.log(`exported ${Object.keys(store.loaded).length} hero(es) from ${store.kind} to ${target}`);
} else {
  const data = JSON.parse(fs.readFileSync(target, 'utf8'));
  for (const [k, v] of Object.entries(data)) store.put(k.toLowerCase(), v);
  const okFlush = await store.close();
  console.log(okFlush ? `imported ${Object.keys(data).length} hero(es) into ${store.kind}` : 'import FAILED; nothing was written');
  process.exit(okFlush ? 0 : 1);
}
await store.close();
process.exit(0);
