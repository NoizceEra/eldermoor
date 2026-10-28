# Eldermoor Online

A classic pixel-art MMORPG. Node + WebSocket server (authoritative), canvas client, **zero image assets** -
every sprite, tile, tree and icon is drawn in code (`client/sprites.js`, `client/gfx.js`).

## Run

```powershell
cd D:\ai-studio\eldermoor
npm install
npm start            # http://localhost:3000  (set PORT to change)
npm test             # headless tests: solo loop, party flow, dungeon instances + boss (own save files)
```

Open the URL in several tabs to play together. Heroes persist in `data/saves.json`.

## Play

| Input | Action |
|---|---|
| WASD / arrows | walk |
| Click ground / monster / NPC / loot | path there, attack, talk, pick up |
| 1 2 3 | class skills (Warrior, Mage, Ranger) |
| Q | health potion |
| Space / Tab | target nearest enemy |
| E | talk to nearest NPC |
| I | pack (right-click or double-click to equip/use; open the shop to sell) |
| Enter | chat (`/who`, `/help`) |
| Click another hero | invite to party (Y / N answers an invite) |
| `/invite NAME`, `/leave`, `/kick NAME`, `/p TEXT` | party commands and party chat |
| M | mute |

**Phones / tablets:** touch mode switches on automatically - on-screen joystick, tap to move/attack/talk/loot, big skill buttons, CHAT / TARGET / TALK / PACK buttons, full-width pack and dialog sheets.

## What's in it

- 128x128 island generated from a seed shared by client and server (meadow, forest, swamp, lakes, roads, walled town, two ruins).
- 6 monster types (slime, bat, wolf, goblin, bone archer, **Moss Golem** boss), leash/aggro AI, respawns, XP + loot (4 rarities, stat gear, potions).
- **The Sunken Crypt**: a private dungeon instance reached by the purple portal in the south-west ruins (press E / click it). 8 rooms, ghouls, wraiths, bone archers and a boss, **The Bone Lord**, with guaranteed rare+ loot. One instance per party (or per solo hero); it vanishes a minute after everyone leaves. Dying sends you back to town. Recommended level 14+.
- 3 classes with 3 skills each, 30 levels, equipment, shop, 5-step quest chain, global chat, day/night with torchlight.
- Parties of up to 4: shared XP (with a group bonus) and quest credit for everyone in range, party frames, minimap dots, party chat.
- Server-authoritative: movement, combat, loot and economy all validated server-side.

## Layout

```
shared/world.js   deterministic world generation (G ground / O object layers)
shared/data.js    classes, monsters, quests, NPCs, rarity, XP curve
server/index.js   HTTP static + WebSocket game loop (20 Hz tick, 10 Hz state)
client/           index.html, style.css, main.js (net/input/UI/render), sprites.js, gfx.js
scripts/smoke*.mjs headless end-to-end tests (solo, party, dungeon). The dungeon test starts the server with EM_DEBUG=1, which enables teleport/god-mode messages - never set it on a public server.
```

## Ideas next

Trading, a second dungeon, more zones/dungeons, player-vs-player arenas, mounts, crafting, bank, touch controls.
