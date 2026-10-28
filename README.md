# Eldermoor Online

A classic pixel-art MMORPG. Node + WebSocket server (authoritative), canvas client, **zero image assets** -
every sprite, tile, tree and icon is drawn in code (`client/sprites.js`, `client/gfx.js`).

## Run

```powershell
cd D:\ai-studio\eldermoor
npm install
npm start            # http://localhost:3000  (set PORT to change)
npm test             # headless tests: jobs/progression, solo loop, party, dungeon + boss, trading incl. dupe attacks (own save files)
```

Open the URL in several tabs to play together. Heroes persist in `data/saves.json`.

## Play

| Input | Action |
|---|---|
| WASD / arrows | walk |
| Click ground / monster / NPC / loot | path there, attack, talk, pick up |
| 1-6 | your skill bar (3 slots at start, 4/5/6 at levels 10/20/30) |
| C / J / K | hero window: stats and attributes / jobs / skills |
| Q | health potion |
| Space / Tab | target nearest enemy |
| E | talk to nearest NPC |
| I | pack (right-click or double-click to equip/use; open the shop to sell) |
| Enter | chat (`/who`, `/help`) |
| Click another hero | menu: party invite or trade (Y / N answers a request) |
| `/invite NAME`, `/leave`, `/kick NAME`, `/p TEXT` | party commands and party chat |
| `/trade NAME` | start a trade |
| M | mute |

**Phones / tablets:** touch mode switches on automatically - on-screen joystick, tap to move/attack/talk/loot, big skill buttons, CHAT / TARGET / TALK / PACK buttons, full-width pack and dialog sheets.

## What's in it

- 128x128 island generated from a seed shared by client and server (meadow, forest, swamp, lakes, roads, walled town, two ruins).
- 6 monster types (slime, bat, wolf, goblin, bone archer, **Moss Golem** boss), leash/aggro AI, respawns, XP + loot (4 rarities, stat gear, potions).
- **The Sunken Crypt**: a private dungeon instance reached by the purple portal in the south-west ruins (press E / click it). 8 rooms, ghouls, wraiths, bone archers and a boss, **The Bone Lord**, with guaranteed rare+ loot. One instance per party (or per solo hero); it vanishes a minute after everyone leaves. Dying sends you back to town. Recommended level 14+.
- **Multiclassing**: 6 jobs (Warrior, Mage, Ranger, Cleric, Rogue, Warlock), each with its own level (1-20) on top of your main level (1-60). 36 skills; every skill you learn stays with you and works in any bar slot under any job, so a Warrior can carry Frost Nova. Switch jobs any time you are out of combat (15s cooldown). Job levels keep their progress when you switch away.
- **Attributes** (STR / DEX / INT / VIT / SPR): 3 points per level, plus automatic growth from your active job. Your weapon decides which attribute your auto attacks use.
- **Combat v2**: crits, dodge, physical vs magic defense, status effects (stun, slow, burn, poison, bleed, vulnerable, haste, shields, regen, fear...), threat tables so tanks can hold monsters, global cooldown, telegraphed boss attacks (watch for the red circles).
- Equipment, shop, 5-step quest chain, global chat, day/night with torchlight.
- Parties of up to 4: shared XP (with a group bonus) and quest credit for everyone in range, party frames, minimap dots, party chat.
- **Player trading**: both sides offer up to 6 items + gold, both lock, both confirm. Any change unlocks everyone; the swap re-validates ownership, gold, range and pack space on the server, and cancels cleanly on disconnect, death, zone change or distance. Pack changes are frozen mid-trade.
- Server-authoritative: movement, combat, loot and economy all validated server-side.

## Layout

```
shared/world.js   deterministic world generation (G ground / O object layers)
shared/data.js    classes, monsters, quests, NPCs, rarity, XP curve
server/index.js   HTTP static + WebSocket game loop (20 Hz tick, 10 Hz state)
client/           index.html, style.css, main.js (net/input/UI/render), sprites.js, gfx.js
scripts/smoke*.mjs headless end-to-end tests (solo, party, dungeon, trade). The dungeon test starts the server with EM_DEBUG=1, which enables teleport/god-mode messages - never set it on a public server.
```

## Ideas next

A second dungeon, a bank, crafting, more zones/dungeons, player-vs-player arenas, mounts, crafting, bank, touch controls.

## Deploy (shareable link)

One Node service serves the client and the WebSocket (`/ws`), so a single host is enough.

**Railway** (matches the other games): from this folder run `railway login`, `railway init`, `railway up`, then add a
**Volume mounted at `/data`** so hero saves survive redeploys, and `railway domain` for a public URL. `railway.json` and the
`Dockerfile` are already set up (health check `/api/status`, saves at `EM_SAVE=/data/saves.json`).

**Quick temporary link** (only while this PC and `npm start` are running): `npx cloudflared tunnel --url http://localhost:3000`
prints a public `https://*.trycloudflare.com` URL.

Never set `EM_DEBUG=1` on a public server.
