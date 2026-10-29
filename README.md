# Eldermoor Online

A classic pixel-art MMORPG. Node + WebSocket server (authoritative), canvas client, **zero image assets** -
every sprite, tile, tree and icon is drawn in code (`client/sprites.js`, `client/gfx.js`).

## Run

```powershell
cd D:\ai-studio\eldermoor
npm install
npm start            # http://localhost:3000  (set PORT to change)
npm test             # headless tests: scale (sleeping mobs, delta packets, loot locks), world/regions/quests/shops, jobs/progression, gear/looks/migration, solo loop, party, dungeon + boss, trading incl. dupe attacks (own save files)
```

Open the URL in several tabs to play together. Heroes persist in `data/saves.json`.

## Play

| Input | Action |
|---|---|
| WASD / arrows | walk |
| Click ground / monster / NPC / loot | path there, attack, talk, pick up |
| 1-6 | your skill bar (3 slots at start, 4/5/6 at levels 10/20/30) |
| N (or click the minimap) | world map |
| L | quest log |
| H / Esc | menu: sound, volume, damage numbers, monster names, screen shake, controls |
| C / J / K | hero window: stats and attributes / jobs / skills (the Look tab changes your appearance) |
| Q | health potion |
| Space / Tab | target nearest enemy |
| E | talk to nearest NPC |
| I | pack (right-click or double-click to equip/use; open the shop to sell) |
| Enter | chat (`/who`, `/help`) |
| Click another hero | menu: party invite or trade (Y / N answers a request) |
| `/invite NAME`, `/leave`, `/kick NAME`, `/p TEXT` | party commands and party chat |
| `/trade NAME` | start a trade |
| M | mute |

**Gamepad:** left stick / D-pad moves; A/Cross interacts; X/Square targets; Y/Triangle uses a potion; LB/RB/LT/RT/L3/R3 trigger skills 1-6; View opens the map; Menu opens settings. D-pad and A/Cross also navigate every open menu.

**Phones / tablets:** touch mode switches on automatically - on-screen joystick, tap to move/attack/talk/loot, big skill buttons, CHAT / TARGET / TALK / PACK buttons, full-width pack and dialog sheets.

The Menu also includes interface scaling, high contrast, reduced-motion support, gamepad deadzone, and a replayable first-session guide. Browser zoom remains available.

## What's in it

- **A 256x256 world of four islands joined by plank bridges**, generated from a seed shared by client and server: Eldermoor (meadow, forest, swamp), **Sunscar Dunes** (desert, oasis, cacti), **Frostmarch** (snow, ice, pines) and **Cinderpeak** (basalt, ash, animated lava). Each has a walled town (Dunehaven, Frostwatch, Emberhold), its own shop, a quest giver, a boss arena and a monster camp. Terrain is baked in 32x32-tile chunks on demand, so the big map costs almost no memory.
- **34 monster types** from level 2 to 54, many with status attacks (poison, bleed, burn, slow) and telegraphed slams. Three region bosses: **The Sun King**, **Rimefang** and **Cinderwing**, plus the Moss Golem and the Bone Lord. Respawns, XP and loot (4 rarities, stat gear, four tiers of health potions). If you die you return to the nearest town.
- **29 quests** across the four towns (the last nine, set in the Ember Forge, are given by Paladin, Necromancer, Monk and Druid NPCs): finish one and the next giver may be across a bridge. Shops get better the further you travel.
- **Three instanced dungeons**, each private to your party (or you) and gone a minute after everyone leaves; dying sends you back to town. **The Sunken Crypt** (purple portal, south-west ruins of Eldermoor, level 14+): 8 rooms, ghouls, wraiths, bone archers and **The Bone Lord**. **The Frozen Depths** (ice-blue portal, ruin on the Frostmarch shore, level 34+): 10 winding ice rooms, yetis, ice golems, frost sprites and **Glacius, the Frozen King**. **The Ember Forge** (orange portal, crater ruin on Cinderpeak, level 48+): 11 serpentine fire rooms of slag crawlers, ember acolytes, magma serpents and molten colossi, ending with **Vorthak, the Ember Lord**. Bosses drop guaranteed rare+ gear.
- **Multiclassing**: 10 jobs (Warrior, Mage, Ranger, Cleric, Rogue, Warlock, Paladin, Druid, Necromancer, Monk), each with its own level (1-20) on top of your main level (1-60). 60 skills (now with charges, multi-hit combos, roots and party regeneration); every skill you learn stays with you and works in any bar slot under any job, so a Warrior can carry Frost Nova. Switch jobs any time you are out of combat (15s cooldown). Job levels keep their progress when you switch away.
- **Attributes** (STR / DEX / INT / VIT / SPR): 3 points per level, plus automatic growth from your active job. Your weapon decides which attribute your auto attacks use.
- **Combat v2**: crits, dodge, physical vs magic defense, status effects (stun, slow, burn, poison, bleed, vulnerable, haste, shields, regen, fear...), threat tables so tanks can hold monsters, global cooldown, telegraphed boss attacks (watch for the red circles).
- **Customization**: a character creator (skin, hair style and colour, eyes) with a live preview. Change your look later in the town square from the Look tab (50g).
- **Wearables**: 11 equipment slots (weapon, offhand, head, body, legs, boots, gloves, cape, two rings, amulet), 40+ item kinds, and every worn piece is drawn on your character. Rarer gear rolls attribute affixes ("of Might", "of Insight"...), crit and dodge. Each job starts in its own outfit.
- Regional shops, a 29-step quest journey, global chat, day/night with torchlight, ambient music and social emotes.
- Parties of up to 4: shared XP (with a group bonus) and quest credit for everyone in range, party frames, minimap dots, party chat.
- **Player trading**: both sides offer up to 6 items + gold, both lock, both confirm. Any change unlocks everyone; the swap re-validates ownership, gold, range and pack space on the server, and cancels cleanly on disconnect, death, zone change or distance. Pack changes are frozen mid-trade.
- **Built to scale on a small server**: monsters live in a spatial grid, monsters far from every player sleep (an idle world costs about 0.1 ms per tick), and the browser client receives only the entities that changed (about 4% of the bandwidth of full snapshots in a busy meadow). Fresh loot is reserved for the heroes and parties who fought for it for 8 seconds (15 for bosses).
- Server-authoritative: movement, combat, loot and economy all validated server-side.
- **Durable and hardened hosting path**: file saves locally or batched Postgres saves when `DATABASE_URL` is set; asynchronous timing-safe secret verification, login throttling, same-origin WebSockets, security headers, and `/api/health` readiness reporting.

## Layout

```
shared/world.js   deterministic world generation (G ground / O object layers)
shared/data.js    classes, monsters, quests, NPCs, rarity, XP curve
server/index.js   HTTP static + WebSocket game loop (20 Hz tick, 10 Hz state)
server/store.js   file/Postgres persistence adapters; server/security.js authentication and HTTP/WS policy
client/           index.html, style.css, main.js (net/UI/render), input.js, sprites.js, hero32.js, gfx.js
shared/combat.js  pure stat/combat formulas shared with the deterministic balance simulator
scripts/          security/input/UI/store units plus headless end-to-end and balance tests. Dungeon tests start the server with EM_DEBUG=1 - never set it on a public server.
```

## Ideas next

A bank, crafting and salvage, stable quest IDs with multiple active quests, friends/guilds with block/report tools, player-vs-player arenas, mounts, and larger automated load tests.

## Deploy (shareable link)

One Node service serves the client and the WebSocket (`/ws`), so a single host is enough.

**Render** (free plan, used for the public link): `render.yaml` is a ready blueprint (Node service, readiness check `/api/health`, auto-deploys from `main`). The free plan sleeps after ~15 minutes idle (first visit then takes about a minute) and its disk is wiped on restart, so by default heroes saved on the free plan reset on every deploy. To keep them, set the `DATABASE_URL` environment variable to a free Supabase or Neon Postgres connection string; heroes are then stored in the database (the file save is used when it is unset, which is what local dev and the tests use). `/api/status` exposes game metrics and `/api/health` reports persistence readiness. Step-by-step setup, export/restore and caveats: [docs/persistence.md](docs/persistence.md).

**Railway**: from this folder run `railway login`, `railway init`, `railway up`, then add a
**Volume mounted at `/data`** so hero saves survive redeploys, and `railway domain` for a public URL. `railway.json` and the
`Dockerfile` are already set up (health check `/api/health`, saves at `EM_SAVE=/data/saves.json`).

**Quick temporary link** (only while this PC and `npm start` are running): `npx cloudflared tunnel --url http://localhost:3000`
prints a public `https://*.trycloudflare.com` URL.

Never set `EM_DEBUG=1` on a public server.

- **Heroes**: 32x32 procedural sprites with class silhouettes, walk/idle/blink/attack/cast animation, gear drawn on the body, and level auras.
