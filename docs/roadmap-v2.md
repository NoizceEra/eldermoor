# Eldermoor v2 roadmap

Requested: more skills, deeper customization, more classes, bigger maps/world, more monsters, wearables and
accessories, better combat, better UX/HUD, level scaling, **multiclassing** (main level + per-job level, skills
carry over so players can mix and match), polish and scale, and a link to try it.

Delivered in phases, each committed with tests. Nothing here is a promise of a single big-bang release.

| Phase | Scope | Status |
|---|---|---|
| 1 | Progression core: main level + job levels, 5 attributes, 6 jobs x 6 skills, skill library that carries over, 3-6 slot skill bar, status effects, threat, weapon-based auto attacks, telegraphed boss attacks, character window UI | **done** (tests: `smoke-jobs.mjs`) |
| 2 | Customization + wearables: appearance creator (skin/hair/eyes), 11 equipment slots incl. head/body/legs/boots/gloves/cape/2 rings/amulet, equipment drawn on the character, item affixes | **done** (tests: `smoke-gear.mjs`) |
| 3 | Bigger world: 256x256 world of 4 islands, chunked rendering, 6 biomes, 3 more towns, 23 more monsters (3 bosses), 15 more quests, per-town shops, world map | **done** incl. the second and third dungeons, The Frozen Depths and The Ember Forge (fire theme, 11 rooms, Vorthak; 29 quests, 34 monsters) (tests: `smoke-world.mjs`, `smoke-frozen.mjs`, `smoke-ember.mjs`) |
| 4 | UX + scale: world map, quest log, settings/help menu, buff bars, delta-encoded state, spatial grid + sleeping monsters, party loot protection, deploy config | **done** (tests: `smoke-scale.mjs`). Not done: persistent saves on the free host, Colyseus |
| 5 | Content pass: 10 jobs, 3 dungeons (Sunken Crypt, Frozen Depths, Ember Forge), 29 quests with job-flavoured givers in all four towns, item comparison deltas in pack and shop | **done** |
| - | Shareable URL | needs the owner's go-ahead (see "Hosting" below) |

## Phase 1 design (multiclassing)

**Two levels.** *Main level* (1-60) comes from every kill and gives +3 attribute points and unlocks skill-bar slots
(3 -> 4 -> 5 -> 6 at levels 10 / 20 / 30). Each *job* has its own level (1-20) that only grows while that job is
active. Job level gives that job's automatic attribute growth and unlocks that job's skills.

**Skills carry over.** A skill, once its job level is reached, is learned for good. Any learned skill can sit in any
bar slot while *any* job is active, so a Warrior can carry Mage's Frost Nova. The job only decides passive trait,
auto growth, and who levels.

**Jobs:** Warrior, Mage, Ranger, Cleric, Rogue, Warlock, Paladin, Druid, Necromancer, Monk (all 10 exist). Six skills each, learned at job levels 1/3/6/9/13/17.

**Attributes:** STR (melee power), DEX (bow/dagger power, crit, dodge, haste), INT (magic power), VIT (health), SPR
(healing power, magic resistance). Weapon type decides which attribute your auto attack scales with, so a Cleric with a
mace hits with STR and heals with SPR.

**Combat v2:** weapon-defined auto attacks (range, speed, scaling); crits, dodge, physical/magic mitigation; status
effects (stun, slow, burn, poison, bleed, vulnerable, haste, attack/defense up, shield, regen, dodge, fear, invulnerable);
threat table instead of "nearest"; telegraphed ground attacks for bosses; global cooldown.

**Migration:** old saves (`cls`, `lvl`) become `job = cls`, job level ~ half the old level, unspent points for the
levels already earned.

## Hosting (needs owner)

Making a public link is outward-facing, so it waits for a go-ahead. Options: Railway (matches the owner's other games;
needs `railway login`), or a temporary tunnel to this PC (fast, but only up while this PC and server are running).
`Dockerfile` + `railway.json` are already in the repo so either path is one command (see README "Deploy").
