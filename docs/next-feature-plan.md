# Eldermoor - next feature pass

> **Status:** All four phases (parties, touch controls, dungeon with Zone refactor, trading) and the small NPC-lookup/status fixes are implemented.

Baseline: commit `9d7ef74` on `feat/mmorpg-vertical-slice`. Authoritative server in `server/index.js`
(20 Hz tick, 10 Hz state), client in `client/main.js`, shared data in `shared/`.

## Recommendation

**Build parties first**, then touch controls, then the dungeon, then trading.

| Feature | Effort | Payoff | Risk | Why this slot |
|---|---|---|---|---|
| **Parties** | M (about 1 day) | High | Low | Smallest change that makes the game feel multiplayer: shared XP and quest credit, party frames, party chat. It also gives dungeons an entry group, so it is the foundation for step 3. |
| Touch controls | M (client only) | Medium-high | Low | No server work, widens the audience to phones/tablets. Independent, so it can run any time. |
| Dungeon / instance | L (2-3 days) | Highest (content) | Medium | Needs the server's global `mobs`/`drops`/`occ` maps split into zones first. Do it after parties. |
| Player trading | M-L | Medium early | High | Two-sided state machine plus the biggest duplication-exploit surface. Only worth it once there is a real player economy. |

Why not the dungeon first: `server/index.js` keeps `mobs`, `drops`, `occ`, `emit()` and `broadcast()` at module
level for a single world. Instancing means refactoring all of that, which is a bigger and riskier change than
anything else on the list. Parties are the cheaper way to ship something visible while that refactor is designed.

## Phase 1 - Parties

Rules: max 4 members, leader can kick/disband, invites expire after 30 s, parties are not persisted
(they dissolve on disconnect; leader passes to the next member).

### Server (`server/index.js`)
- New state: `const parties = new Map()` (`id -> { id, leader, members: Set<playerId> }`), `p.party` (id or 0),
  `p.invitedBy` / `p.inviteUntil`.
- Helpers: `partyOf(p)`, `partyMembersNear(m, p, 25)`, `leaveParty(p)`, `broadcastParty(party)`.
- `dropPlayer()`: call `leaveParty(p)` before removing the player.
- **`killMob()` change** (currently pays each contributor in `m.dmgBy`, non-killers capped at 0.6 share):
  group contributors by party. Every party member within 25 tiles of the mob (damage dealt or not) gets
  `def.xp * factor * (1 + 0.1 * (n - 1)) / n`, and quest progress counts for every in-range member whose quest
  matches. Solo players keep the current behaviour.
- Loot stays free-for-all in v1 (drops are on the ground). Optional later: 10 s pickup lock to the killer's party.
- Chat: `chat` messages with `ch: 'party'` go only to members. Client sends `/p text`.
- Rate limit invites (1 per 2 s per player) and ignore invites to players already in a party.

### Protocol
Client to server:
- `{t:'pinvite', name}` - invite an online player by name (also reachable via `/invite name`).
- `{t:'pgo', ok:true|false}` - accept/decline the pending invite.
- `{t:'pleave'}`, `{t:'pkick', id}` (leader only).
- `{t:'chat', m, ch:'party'}`.

Server to client:
- `{t:'pinv', from, name}` - invite prompt (expires after 30 s).
- `{t:'party', id, leader, members:[{id,name,cls,lvl}]}` - on any membership change; `null` members means no party.
- `{t:'pm', m:[{id,h,mh,x,y}]}` - every 500 ms, member HP and position (so frames and minimap work out of view).
- Existing `log` messages cover "X joined/left the party".

### Client
- `client/index.html`: `#party` panel (up to 3 member rows under `#plate`), `#invite` toast with Accept / Decline.
- `client/style.css`: party row, small HP bar, invite toast styles (reuse `.panel`, `.bar`).
- `client/main.js`: `party` state; handle `pinv` / `party` / `pm`; keys Y / N answer an invite; `/invite`, `/leave`,
  `/p` chat commands; click another player in the world to open a small "Invite to party" button (extends `pickAt`
  to return `kind:'p'`); party members get blue names and green minimap dots; leader crown in the member row.

### Test (`scripts/smoke-party.mjs`, wired into `npm test`)
Two bots (A and B) on a spare port:
1. A `/invite B`; B receives `pinv`; B accepts; both receive `party` with 2 members.
2. Both stand near a slime; A kills it; **assert both XP values increased** and (with quest accepted) both quest
   counters moved.
3. B leaves; A receives a `party` update with 1 member. A disconnects; party map is empty (check via `/api/status`
   extended with `parties` count).
4. Negative cases: inviting a non-existent name, inviting someone already grouped, accepting an expired invite.
Also manual browser check: two tabs, invite, kill something, look at frames and minimap.

## Phase 2 - Touch controls (client only)
- Pointer events instead of mouse-only: on-screen joystick (bottom-left) feeding the existing `keys` set / `runKeys`,
  tap = existing `mousedown` path (target, talk, pick up, walk), big skill/potion buttons reusing `#skillbar`.
- Responsive UI: pack/dialog full-width sheets on narrow screens, larger tap targets, chat collapsed behind a button.
- Rendering: `resize()` already picks an integer scale; allow `S = 2` on phones and verify label font sizes.
- Test: Chrome device emulation (`resize_window` mobile preset) plus a Playwright-style synthetic touch run; no server change.

## Phase 3 - Dungeon / instance
1. Refactor server state into `Zone` objects (`{id, world, mobs, drops, occ, players}`); every function that touches
   the old globals takes a zone. `p.zone` selects it; `broadcast`/`emit` iterate that zone's players.
2. New terrain kinds in `shared/world.js` (`G.DUNGEON`, `O.PILLAR`, `O.DOOR`) and a `generateDungeon(seed)` room-and-corridor
   generator; `gfx.js` gets matching tiles. Client swaps `world`/`art` on a `{t:'zone', kind, seed}` message.
3. Entry: portal tile in the south-west ruin; party leader enters, members within 5 tiles follow; instance is destroyed
   when empty for 60 s. Boss with guaranteed rare+ drop, no respawn within an instance.
4. Tests: smoke bot enters, kills the first room, leaves; assert overworld mob counts are untouched.

## Phase 4 - Trading
State machine `idle -> requested -> open -> locked(A) / locked(B) -> confirmed -> swap`.
- Messages: `trade_req`, `trade_open`, `trade_offer {items:[uid], gold}`, `trade_lock`, `trade_confirm`, `trade_cancel`.
- Rules: items identified by `u`; any offer change clears both locks; swap is one synchronous server function that
  re-validates ownership, inventory space and gold; cancel on disconnect, death, or distance > 6.
- Test: dupe-attack cases (offer same item twice, drop during trade, disconnect mid-confirm) must leave both
  inventories consistent.

## Small fixes to fold in while in the code
- `questAccept` / `questTurnIn` / `buy` / `sell` assume `npcs[0]` / `npcs[1]`; look NPCs up by role instead.
- Add `parties` and per-zone mob counts to `/api/status`.
- Night is still the darkest stretch of the 8-minute day; the brighter tint from the last session was never viewed in-game.

## Not verified yet
Boss arena visuals, two real players on screen at once, touch input, and behaviour with more than a handful of
players (state packets are full JSON at 10 Hz per player; fine for dozens, will need delta encoding beyond that).

## Open questions for the owner
1. Loot rule inside a party: free-for-all, round-robin, or killer's party gets a 10 s lock?
2. Should the dungeon be solo-capable, or party-only?
3. Is mobile a real target now (decides whether touch controls jump ahead of parties)?
