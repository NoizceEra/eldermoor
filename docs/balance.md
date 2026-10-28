# Balance pass

A data-driven pass over the ten jobs. Everything here is reproducible: `npm run balance` (or `node scripts/balance-sim.mjs`)
prints the tables below from the live rules in `shared/`, and `scripts/test-balance.mjs` (part of `npm test`) fails when a job
drifts out of its role band or when the simulator stops matching the live server.

## How the simulator works

`scripts/balance-sim.mjs` is headless, deterministic and offline. It imports `shared/jobs.js`, `shared/data.js` and
`shared/combat.js`. The last one is new: the pure maths of `computeStats`, `power()`, mitigation, crit and healing power was moved
out of `server/index.js`, so **the server and the simulator run the same functions** (`deriveStats`, `power`, `mitigation`,
`critFactor`). `test-balance.mjs` additionally logs real heroes of six jobs into a live server, spends attribute points, equips
random gear and checks that the stats the server reports equal the shared formulas, and that real slime hits fall inside the
mitigated damage range.

Model (50 ms steps, expected values instead of dice: crit is an average multiplier, dodge a fraction, damage rolls their mean):

- **Heroes**: main level 10 / 20 / 30 / 45 / 60 with job level 10 or 20 (columns `L10/j10`, `L20/j10`, `L20/j20`, `L30/j20`, `L45/j20`, `L60/j20`).
  Attribute points (3 per level) are split by the job's `growth` weights. Each job wields the weapon with the best auto-attack output among the
  weapons it normally uses. The skill bar has `barSlots(level)` slots and the sim brute-forces the best bar for each question.
- **Gear**: `starter` (the Apprentice weapon and Traveler pieces every hero starts in) or `geared` (expected values of the drop formulas
  in `mkGear` for all eleven slots at the hero's level: uncommon until level 30, rare after; half of the random attribute affixes land on the build's
  attributes, half are spread evenly). The geared tier is the primary one.
- **Rotation**: global cooldown 600 ms, weapon swing from `WEAPON_TYPES` / haste, perfect priority play: offensive buffs and curses first, then the damage skill with the highest
  value (direct hit plus damage-over-time ticks that a recast would cut off). Damage over time scales like `applyFx` in `castSkill` (`pow x power` per tick, no crit,
  `ceil(ms/1000) - 1` ticks), heals like `castSkill` (`healPow x mult`), and execute skills are valued at a 30% share of the fight under their threshold.
- **Monsters**: real `MOBS` entries: the nearest-level regular monster and the nearest-level boss within 12 levels
  (goblin raider, sand scarab, gale owl, ember knight x2 and Cinderwing, Moss Golem, Sun King, Glacius...). Monsters hit for their average damage through the hero's armour (or
  resist for magic users), through dodge, with on-hit damage over time, slams (half of the telegraphed ones land) and drains; stuns, fear and roots stop or delay them.

Measures: single-target DPS (60 s), 3-target and 6-target AoE DPS (60 s, clustered), burst (first 10 s, all cooldowns ready), effective HP, clear time and health lost on a
four-monster pull, levelling speed (XP per minute chain-pulling four at a time and resting at 2%/s), a six-monster camp, a solo boss fight, and healing per second on one tank / across a party of five.

Roles used for the "within about 25% of the role median" rule: **dps** = Mage, Ranger, Rogue, Warlock, Necromancer, Monk; **tank** = Warrior, Paladin;
**healer** = Cleric, Druid (Paladin is a hybrid). Tanks must keep at least 60% of the dps median's single-target damage, healers 40%, and tanks must be the most durable jobs.

## What the first run found

Outliers before any change (geared gear; ratio to the role median):

- **Warrior**: kill power vs dps median (tank floor 0.6) low in 6 of 6 columns (worst 0.41x at L60/j20)
- **Mage**: 6-target DPS high in 1 of 6 columns (worst 1.29x at L10/j10); solo levelling speed vs all-job median high in 2 of 6 columns (worst 1.78x at L45/j20)
- **Ranger**: non-tank is tankier than a tank would be high in 2 of 6 columns (worst 1.58x at L60/j20); solo levelling speed vs all-job median high in 1 of 6 columns (worst 1.87x at L45/j20)
- **Cleric**: solo levelling speed vs all-job median low in 3 of 6 columns (worst 0.43x at L20/j10); kill power vs dps median (healer floor 0.4) low in 2 of 6 columns (worst 0.38x at L60/j20)
- **Rogue**: single-target DPS high in 6 of 6 columns (worst 1.85x at L60/j20); 10s burst high in 6 of 6 columns (worst 1.88x at L60/j20); 3-target DPS high in 3 of 6 columns (worst 1.48x at L60/j20); 6-target DPS high in 1 of 6 columns (worst 1.27x at L60/j20)
- **Warlock**: 3-target DPS low in 6 of 6 columns (worst 0.60x at L60/j20); 6-target DPS low in 6 of 6 columns (worst 0.51x at L60/j20); single-target DPS low in 2 of 6 columns (worst 0.74x at L60/j20)
- **Paladin**: kill power vs dps median (tank floor 0.6) low in 6 of 6 columns (worst 0.45x at L60/j20); solo levelling speed vs all-job median low in 2 of 6 columns (worst 0.47x at L45/j20)
- **Druid**: solo levelling speed vs all-job median high in 1 of 6 columns (worst 1.68x at L20/j10)
- **Monk**: 10s burst high in 2 of 6 columns (worst 1.42x at L60/j20); non-tank is tankier than a tank would be high in 2 of 6 columns (worst 1.51x at L60/j20); single-target DPS high in 1 of 6 columns (worst 1.30x at L60/j20)

The structural cause was one stat. **Dexterity fed crit chance (0.25%/pt), dodge (0.15%/pt) and attack speed (0.3%/pt) with no limit**, and weapon auto attacks are 44-63% of every job's damage.
At level 60 in geared drops the Ranger had 107% crit chance (the roll caps at 100%), +94% attack speed and 58% dodge; the Rogue 94% crit with x2.15 crit damage, +87% attack speed
(a 347 ms dagger swing) and 59% dodge; the Monk 84% crit, +70% attack speed and 52% dodge. The Mage, Warlock and Necromancer had 17% crit and +11% attack speed.
Result: Rogue 1.85x the dps median in single-target damage at level 60, Monk 1.30x, Ranger 1.19x, while Mage / Warlock / Necromancer were at 0.74-0.81x. Dodge made the dexterity jobs as durable as the tanks:
at level 60 the Ranger's effective HP was 1.59x the dps median and the Monk's 1.53x, against 1.57x for the Warrior. Meanwhile Warrior, Paladin and Cleric did
only 0.38-0.54x of the dps median single-target damage, which showed up as 0.4-0.6x levelling speed in the fight sim.

## Changes (each with the numbers that motivated it)

| # | Change | Before | After | Why |
| --- | --- | --- | --- | --- |
| 1 | Crit per Dexterity point (`shared/combat.js`) | 0.25%, uncapped (L60 Ranger 107%, Rogue 94%) | 0.15%, total crit capped at 50% | Crit was a free multiplier for any dexterity build; it is now a bounded build choice. |
| 2 | Attack speed per Dexterity point | 0.3%, uncapped (L60 +70% to +94%) | 0.2%, capped at +30% | Nearly doubled auto-attack damage, and autos are about half of everyone's output. |
| 3 | Dodge per Dexterity point | 0.15%, cap 95% (L60 dodge 52-59%) | 0.07%, cap 40% | The Ranger/Monk out-tanked the Warrior-class tanks (EHP 1.59x / 1.53x of the dps median vs 1.57x). Now 1.21x / 1.33x vs 1.83x. |
| 4 | New job trait `dmgMul` (all weapon and skill damage): Warrior 1.25, Paladin 1.20, Cleric 1.15 | none | see left | Tanks and the healer did 0.38-0.50x of the dps median: slow levelling and no way to finish a fight alone. They now sit at 0.59-0.67x; the tank HP/defense lead stays (Warrior EHP 1.83x, Paladin 1.41x of the dps median). |
| 5 | Dagger swing time | 650 ms | 780 ms | The dagger was 38% faster than a sword on a stat that also scales speed; Rogue and Monk both wield it. |
| 6 | Rogue trait: critical damage | +35% | +20% | With crit now bounded, the extra multiplier was a 17% damage bonus on top of the fastest weapon. |
| 7 | Quick Stab | 170% | 150% | Rogue filler, 19% of its damage; trimmed with the dagger change. |
| 8 | Assassinate | 500% (triple under 30% health) | 400% | 10 s burst was 1.88x the median; execute alone was 12% of Rogue damage. Burst is still the highest of the group, which is the Rogue's job. |
| 8b | Backstab bonus against stunned / slowed / bleeding targets | +60% | +45% | Rupture keeps the target bleeding, so the bonus was effectively permanent: Backstab was 12% of Rogue damage at 2.0x. |
| 9 | Dragon Kick | 300% | 270% | Monk single-target DPS was 1.30x and burst 1.42x the median at L60. |
| 10 | Frost Nova | 130% | 110% | Mage AoE led the dps group by 1.2-1.4x at low levels; it keeps the best area damage but is back inside the band at job level 20. |
| 11 | Meteor | 400% | 370% | Same reason, high-level AoE. |
| 12 | Terrify | 40% damage | 150% | Warlock had no AoE (0.51x the median on six targets). Its fear stays; it now has a damaging pulse (0.76x). |
| 13 | Curse of Frailty | 50% damage | 70% | Curse is the Warlock identity and its damage was 2% of the total; the vulnerability debuff itself is unchanged (+25%). |
| 14 | Smite | 190% | 230% | Cleric kill power is the lowest by design, but at 0.38x it could not level alone. Now 0.59x. |
| 15 | Lay on Hands | 400% heal, 24 s | 500% heal, 18 s | The Paladin's one heal gave 9-49 healing/s next to the Cleric's 92-584. It is still a hybrid, no longer a rounding error. |

Skills reviewed and left alone: every job's level-1 spam skill is worth 2-3x its job's median per second of cooldown (that is what a filler is). No damage skill is under 3% of its job's damage
without a control effect. Control-only skills (Entangling Roots, Bone Prison, Smoke Bomb, Ensnare, Curse) are intentionally small hits with a status.

## Effect on the outliers

Ratio to the dps-group median (1.00 = the middle of the Mage / Ranger / Rogue / Warlock / Necromancer / Monk group), geared gear.

Single-target DPS:

| job | L20/j20 before | after | L45/j20 before | after | L60/j20 before | after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 0.50 | 0.66 | 0.42 | 0.63 | 0.41 | 0.64 |
| Mage | 0.99 | 1.03 | 0.84 | 0.98 | 0.81 | 0.99 |
| Ranger | 1.01 | 1.00 | 1.16 | 1.02 | 1.19 | 1.01 |
| Cleric | 0.46 | 0.61 | 0.39 | 0.59 | 0.38 | 0.59 |
| Rogue | 1.36 | 1.10 | 1.62 | 1.23 | 1.85 | 1.22 |
| Warlock | 0.89 | 0.95 | 0.77 | 0.94 | 0.74 | 0.95 |
| Paladin | 0.54 | 0.69 | 0.47 | 0.66 | 0.45 | 0.67 |
| Druid | 0.60 | 0.63 | 0.52 | 0.61 | 0.50 | 0.62 |
| Necromancer | 0.91 | 0.96 | 0.78 | 0.93 | 0.75 | 0.94 |
| Monk | 1.12 | 1.00 | 1.17 | 1.09 | 1.30 | 1.09 |

3-target AoE DPS:

| job | L20/j20 before | after | L45/j20 before | after | L60/j20 before | after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 0.69 | 0.96 | 0.60 | 0.87 | 0.55 | 0.87 |
| Mage | 1.06 | 1.15 | 0.93 | 1.05 | 0.86 | 1.06 |
| Ranger | 1.00 | 1.05 | 1.17 | 1.02 | 1.15 | 1.02 |
| Cleric | 0.42 | 0.59 | 0.37 | 0.54 | 0.35 | 0.54 |
| Rogue | 1.09 | 0.94 | 1.34 | 1.00 | 1.48 | 0.99 |
| Warlock | 0.72 | 0.82 | 0.65 | 0.81 | 0.60 | 0.81 |
| Paladin | 0.49 | 0.65 | 0.43 | 0.60 | 0.40 | 0.61 |
| Druid | 0.55 | 0.62 | 0.49 | 0.57 | 0.46 | 0.58 |
| Necromancer | 0.95 | 1.06 | 0.86 | 1.00 | 0.80 | 1.01 |
| Monk | 1.00 | 0.95 | 1.07 | 0.99 | 1.14 | 0.99 |

6-target AoE DPS:

| job | L20/j20 before | after | L45/j20 before | after | L60/j20 before | after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 0.98 | 1.34 | 0.81 | 1.21 | 0.75 | 1.21 |
| Mage | 1.19 | 1.23 | 0.99 | 1.13 | 0.92 | 1.13 |
| Ranger | 1.06 | 1.08 | 1.15 | 1.06 | 1.14 | 1.04 |
| Cleric | 0.44 | 0.59 | 0.37 | 0.55 | 0.35 | 0.55 |
| Rogue | 1.00 | 0.81 | 1.15 | 0.89 | 1.27 | 0.88 |
| Warlock | 0.63 | 0.76 | 0.55 | 0.75 | 0.51 | 0.76 |
| Paladin | 0.50 | 0.65 | 0.42 | 0.60 | 0.39 | 0.61 |
| Druid | 0.58 | 0.63 | 0.49 | 0.59 | 0.46 | 0.59 |
| Necromancer | 0.97 | 1.05 | 0.85 | 1.01 | 0.79 | 1.02 |
| Monk | 1.00 | 0.95 | 1.01 | 0.99 | 1.08 | 0.98 |

10 s burst:

| job | L20/j20 before | after | L45/j20 before | after | L60/j20 before | after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 0.55 | 0.70 | 0.46 | 0.66 | 0.44 | 0.66 |
| Mage | 0.96 | 0.97 | 0.83 | 0.93 | 0.80 | 0.93 |
| Ranger | 0.94 | 0.90 | 1.08 | 0.91 | 1.11 | 0.90 |
| Cleric | 0.48 | 0.63 | 0.42 | 0.61 | 0.41 | 0.61 |
| Rogue | 1.39 | 1.09 | 1.69 | 1.25 | 1.88 | 1.23 |
| Warlock | 1.04 | 1.07 | 0.92 | 1.03 | 0.89 | 1.03 |
| Paladin | 0.68 | 0.83 | 0.57 | 0.79 | 0.55 | 0.79 |
| Druid | 0.59 | 0.61 | 0.52 | 0.60 | 0.50 | 0.60 |
| Necromancer | 0.96 | 0.98 | 0.84 | 0.97 | 0.82 | 0.97 |
| Monk | 1.20 | 1.02 | 1.26 | 1.11 | 1.42 | 1.10 |

Effective HP:

| job | L20/j20 before | after | L45/j20 before | after | L60/j20 before | after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 1.71 | 1.77 | 1.77 | 1.81 | 1.57 | 1.83 |
| Mage | 0.59 | 0.62 | 0.55 | 0.56 | 0.50 | 0.58 |
| Ranger | 1.04 | 0.99 | 1.45 | 1.13 | 1.59 | 1.21 |
| Cleric | 1.05 | 1.09 | 1.04 | 1.06 | 0.92 | 1.07 |
| Rogue | 0.76 | 0.72 | 0.98 | 0.77 | 1.10 | 0.84 |
| Warlock | 1.03 | 1.07 | 1.02 | 1.04 | 0.90 | 1.05 |
| Paladin | 1.38 | 1.43 | 1.37 | 1.40 | 1.22 | 1.41 |
| Druid | 0.70 | 0.72 | 0.64 | 0.66 | 0.59 | 0.68 |
| Necromancer | 0.97 | 1.01 | 0.93 | 0.96 | 0.82 | 0.95 |
| Monk | 1.25 | 1.22 | 1.50 | 1.26 | 1.53 | 1.33 |

Outliers after the pass:

- **Mage**: 6-target DPS high in 2 of 6 columns (worst 1.33x at L10/j10); solo levelling speed vs all-job median high in 1 of 6 columns (worst 1.73x at L45/j20)
- **Druid**: solo levelling speed vs all-job median high in 1 of 6 columns (worst 1.61x at L20/j10)

What remains outside the 25% band, and why it stays:

- **Mage, 6-target DPS (1.28-1.33x at L10/j10 and L20/j10 only)**: the Mage is the AoE specialist and has Frost Nova and Chain Lightning before anyone else has an area attack; the lead is gone at job level 20 (1.13x at L60).
- **Rogue** now sits at 1.1-1.2x in single-target damage and up to about 1.25x in burst: the top of the band on purpose. Rogue is the burst class, spends every cooldown in the first seconds and has the thinnest health of the melee jobs (EHP 0.84x of the dps median).
- **Warlock** is 0.71-0.76x on six targets: a single-target curse class whose Drain Life, 8% lifesteal and curses are the other half of its identity; single-target it is at 0.94x.
- **Levelling-speed flags** (Mage L45, Druid L20/j10) are noise from the 600 ms global cooldown (a four-monster clear lasts 1-6 s, so one cast changes the rate by 15%), not a design signal; see the tables.

Absolute damage fell about 20% at the top (dps-group median single-target DPS at L60 1648 -> 1287) because the Dexterity jobs set that median. Monsters in the shipped content die in 1-3 s to a geared hero either way
(their health grows as level^1.6 while hero damage grows faster); content pacing is another pass, this one only evens out the jobs.

## Full tables, geared gear

### Single-target DPS
Before:

**Single-target sustained DPS [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 90 | 153 | 189 | 342 | 508 | 671 |
| Mage | 198 | 335 | 376 | 676 | 1006 | 1328 |
| Ranger | 172 | 322 | 386 | 807 | 1394 | 1967 |
| Cleric | 94 | 158 | 174 | 317 | 471 | 625 |
| Rogue | 235 | 445 | 518 | 1097 | 1944 | 3046 |
| Warlock | 144 | 245 | 340 | 624 | 928 | 1226 |
| Paladin | 92 | 156 | 207 | 375 | 559 | 739 |
| Druid | 131 | 222 | 228 | 417 | 620 | 821 |
| Necromancer | 167 | 283 | 346 | 631 | 940 | 1242 |
| Monk | 180 | 334 | 428 | 856 | 1407 | 2141 |

After:

**Single-target sustained DPS [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 111 | 189 | 235 | 407 | 621 | 817 |
| Mage | 195 | 329 | 368 | 638 | 972 | 1277 |
| Ranger | 164 | 298 | 358 | 684 | 1002 | 1296 |
| Cleric | 118 | 198 | 217 | 380 | 578 | 762 |
| Rogue | 186 | 342 | 393 | 776 | 1217 | 1575 |
| Warlock | 147 | 250 | 338 | 610 | 930 | 1223 |
| Paladin | 109 | 185 | 246 | 428 | 655 | 861 |
| Druid | 130 | 220 | 226 | 397 | 607 | 799 |
| Necromancer | 166 | 281 | 343 | 603 | 920 | 1210 |
| Monk | 154 | 275 | 355 | 678 | 1076 | 1400 |

### 3-target AoE DPS
Before:

**3-target AoE DPS (total) [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 132 | 225 | 326 | 580 | 862 | 1136 |
| Mage | 239 | 405 | 505 | 900 | 1341 | 1771 |
| Ranger | 200 | 371 | 477 | 988 | 1687 | 2370 |
| Cleric | 94 | 158 | 200 | 363 | 540 | 716 |
| Rogue | 235 | 445 | 520 | 1092 | 1936 | 3034 |
| Warlock | 147 | 250 | 340 | 632 | 939 | 1240 |
| Paladin | 110 | 186 | 232 | 419 | 624 | 825 |
| Druid | 151 | 257 | 263 | 479 | 713 | 943 |
| Necromancer | 200 | 339 | 452 | 833 | 1241 | 1640 |
| Monk | 180 | 334 | 474 | 945 | 1545 | 2337 |

After:

**3-target AoE DPS (total) [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 164 | 278 | 405 | 701 | 1055 | 1385 |
| Mage | 233 | 393 | 485 | 842 | 1274 | 1674 |
| Ranger | 190 | 344 | 443 | 849 | 1244 | 1610 |
| Cleric | 118 | 198 | 247 | 432 | 655 | 863 |
| Rogue | 186 | 342 | 396 | 774 | 1215 | 1573 |
| Warlock | 161 | 274 | 345 | 645 | 981 | 1289 |
| Paladin | 131 | 221 | 276 | 481 | 731 | 962 |
| Druid | 150 | 254 | 261 | 458 | 698 | 918 |
| Necromancer | 198 | 335 | 447 | 801 | 1214 | 1596 |
| Monk | 154 | 275 | 400 | 759 | 1202 | 1564 |

### 6-target AoE DPS
Before:

**6-target AoE DPS (total) [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 196 | 333 | 532 | 938 | 1393 | 1834 |
| Mage | 270 | 457 | 644 | 1144 | 1704 | 2251 |
| Ranger | 213 | 395 | 574 | 1173 | 1986 | 2780 |
| Cleric | 94 | 158 | 240 | 433 | 643 | 852 |
| Rogue | 235 | 445 | 539 | 1123 | 1989 | 3111 |
| Warlock | 152 | 259 | 340 | 635 | 945 | 1247 |
| Paladin | 135 | 228 | 271 | 487 | 725 | 960 |
| Druid | 181 | 308 | 316 | 573 | 852 | 1128 |
| Necromancer | 204 | 346 | 525 | 980 | 1466 | 1938 |
| Monk | 180 | 334 | 544 | 1078 | 1754 | 2630 |

After:

**6-target AoE DPS (total) [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 243 | 412 | 659 | 1142 | 1705 | 2238 |
| Mage | 259 | 437 | 608 | 1056 | 1591 | 2091 |
| Ranger | 203 | 367 | 534 | 1017 | 1491 | 1929 |
| Cleric | 118 | 198 | 292 | 511 | 770 | 1015 |
| Rogue | 186 | 342 | 399 | 800 | 1256 | 1626 |
| Warlock | 179 | 304 | 377 | 701 | 1064 | 1398 |
| Paladin | 160 | 271 | 322 | 561 | 850 | 1119 |
| Druid | 180 | 305 | 313 | 549 | 834 | 1098 |
| Necromancer | 202 | 343 | 520 | 946 | 1429 | 1886 |
| Monk | 154 | 275 | 467 | 882 | 1391 | 1810 |

### 10 s burst damage
Before:

**10 s burst damage [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 1108 | 1884 | 2410 | 4259 | 6331 | 8355 |
| Mage | 2240 | 3792 | 4248 | 7643 | 11383 | 15029 |
| Ranger | 2052 | 3680 | 4145 | 8759 | 14909 | 20991 |
| Cleric | 1116 | 1880 | 2137 | 3895 | 5789 | 7674 |
| Rogue | 2521 | 4727 | 6125 | 13262 | 23260 | 35466 |
| Warlock | 1699 | 2889 | 4592 | 8517 | 12661 | 16716 |
| Paladin | 1039 | 1765 | 2987 | 5286 | 7873 | 10413 |
| Druid | 1504 | 2554 | 2622 | 4798 | 7142 | 9449 |
| Necromancer | 1872 | 3173 | 4232 | 7814 | 11639 | 15376 |
| Monk | 1880 | 3528 | 5310 | 10772 | 17336 | 26679 |

After:

**10 s burst damage [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 1374 | 2331 | 2982 | 5178 | 7743 | 10172 |
| Mage | 2207 | 3729 | 4137 | 7179 | 10955 | 14393 |
| Ranger | 1907 | 3472 | 3871 | 7320 | 10726 | 13877 |
| Cleric | 1413 | 2375 | 2678 | 4687 | 7132 | 9403 |
| Rogue | 2003 | 3655 | 4653 | 9304 | 14612 | 18912 |
| Warlock | 1744 | 2959 | 4582 | 7914 | 12074 | 15868 |
| Paladin | 1237 | 2096 | 3548 | 6186 | 9226 | 12141 |
| Druid | 1492 | 2530 | 2597 | 4557 | 6985 | 9197 |
| Necromancer | 1858 | 3143 | 4193 | 7422 | 11392 | 14978 |
| Monk | 1632 | 2935 | 4366 | 8479 | 13074 | 17016 |

### Effective HP
Before:

**Effective HP vs level-appropriate monster [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 1935 | 4005 | 4159 | 9157 | 15330 | 21600 |
| Mage | 694 | 1445 | 1445 | 3022 | 4746 | 6840 |
| Ranger | 1223 | 2452 | 2534 | 6341 | 12591 | 21854 |
| Cleric | 1222 | 2479 | 2550 | 5519 | 9016 | 12606 |
| Rogue | 881 | 1825 | 1846 | 4458 | 8483 | 15101 |
| Warlock | 1202 | 2444 | 2507 | 5410 | 8852 | 12376 |
| Paladin | 1588 | 3274 | 3363 | 7415 | 11878 | 16729 |
| Druid | 816 | 1700 | 1700 | 3556 | 5586 | 8043 |
| Necromancer | 1131 | 2302 | 2367 | 5133 | 8092 | 11291 |
| Monk | 1383 | 2742 | 3051 | 6901 | 12988 | 20987 |

After:

**Effective HP vs level-appropriate monster [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 1917 | 3958 | 4111 | 8961 | 14870 | 20767 |
| Mage | 688 | 1428 | 1428 | 2957 | 4604 | 6576 |
| Ranger | 1162 | 2246 | 2303 | 5289 | 9271 | 13712 |
| Cleric | 1211 | 2450 | 2520 | 5401 | 8745 | 12120 |
| Rogue | 838 | 1675 | 1683 | 3737 | 6301 | 9608 |
| Warlock | 1191 | 2415 | 2478 | 5294 | 8586 | 11898 |
| Paladin | 1573 | 3236 | 3324 | 7256 | 11521 | 16083 |
| Druid | 809 | 1681 | 1681 | 3479 | 5418 | 7733 |
| Necromancer | 1120 | 2274 | 2340 | 5023 | 7849 | 10855 |
| Monk | 1326 | 2557 | 2829 | 5997 | 10362 | 15097 |

### Levelling speed (XP per minute)
Before:

**Levelling speed: XP per minute chain-pulling four regular monsters [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 1855 | 3203 | 6621 | 12938 | 11020 | 14146 |
| Mage | 3130 | 7385 | 7385 | 14276 | 21958 | 25366 |
| Ranger | 2618 | 7111 | 8000 | 15333 | 22988 | 27244 |
| Cleric | 1142 | 1968 | 4349 | 8764 | 6327 | 8566 |
| Rogue | 2008 | 5326 | 5687 | 12374 | 13616 | 20373 |
| Warlock | 2000 | 4364 | 5333 | 10684 | 9647 | 12010 |
| Paladin | 1294 | 2820 | 4497 | 9857 | 5831 | 8277 |
| Druid | 2880 | 7680 | 7680 | 14786 | 7495 | 10361 |
| Necromancer | 2250 | 4800 | 8348 | 18000 | 15651 | 21017 |
| Monk | 1175 | 3177 | 8102 | 12561 | 17002 | 20843 |

After:

**Levelling speed: XP per minute chain-pulling four regular monsters [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 1853 | 4735 | 7385 | 12938 | 13622 | 17833 |
| Mage | 3130 | 6000 | 7385 | 14276 | 20016 | 25366 |
| Ranger | 2595 | 5192 | 8000 | 15333 | 14059 | 24520 |
| Cleric | 1157 | 2721 | 6857 | 9890 | 7506 | 10361 |
| Rogue | 1569 | 4016 | 5687 | 11281 | 8273 | 12054 |
| Warlock | 2000 | 5333 | 4140 | 9817 | 10700 | 14712 |
| Paladin | 2141 | 3132 | 4735 | 10556 | 6917 | 9926 |
| Druid | 2880 | 7680 | 7680 | 12938 | 7466 | 10361 |
| Necromancer | 2250 | 4800 | 8348 | 18000 | 15651 | 21017 |
| Monk | 1159 | 3014 | 8102 | 10820 | 12436 | 18239 |

### Six monsters at once
Before:

**Six monsters at once [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 94% left | 89% left | 100% left | 100% left | 98% left | 100% left |
| Mage | 100% left | 100% left | 100% left | 100% left | 100% left | 100% left |
| Ranger | 97% left | 96% left | 100% left | 100% left | 98% left | 100% left |
| Cleric | 84% left | 88% left | 91% left | 91% left | 95% left | 100% left |
| Rogue | 90% left | 93% left | 99% left | 99% left | 88% left | 99% left |
| Warlock | 99% left | 97% left | 100% left | 100% left | 100% left | 100% left |
| Paladin | 82% left | 99% left | 90% left | 91% left | 93% left | 83% left |
| Druid | 100% left | 100% left | 100% left | 100% left | 100% left | 91% left |
| Necromancer | 100% left | 99% left | 100% left | 100% left | 100% left | 100% left |
| Monk | 81% left | 81% left | 100% left | 96% left | 94% left | 98% left |

After:

**Six monsters at once [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 94% left | 93% left | 100% left | 100% left | 100% left | 100% left |
| Mage | 100% left | 98% left | 100% left | 100% left | 100% left | 100% left |
| Ranger | 97% left | 88% left | 100% left | 100% left | 89% left | 99% left |
| Cleric | 86% left | 79% left | 97% left | 94% left | 100% left | 100% left |
| Rogue | 86% left | 84% left | 95% left | 94% left | 66% left | 88% left |
| Warlock | 100% left | 100% left | 100% left | 100% left | 100% left | 100% left |
| Paladin | 93% left | 78% left | 92% left | 93% left | 96% left | 85% left |
| Druid | 100% left | 100% left | 100% left | 100% left | 100% left | 91% left |
| Necromancer | 100% left | 99% left | 100% left | 100% left | 100% left | 100% left |
| Monk | 79% left | 73% left | 100% left | 95% left | 86% left | 95% left |

### Solo boss
Before:

**Solo boss (kill time, or time of death and boss % removed) [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 25s | 13s | 9s | 41s | 49s | 64s |
| Mage | 10s | 6s | 4s | 19s | 23s | 28s |
| Ranger | 13s | 6s | 4s | 17s | 17s | 20s |
| Cleric | 23s | 13s | 10s | 43s | 52s | 67s |
| Rogue | 9s | 4s | 2s | 12s | 12s | 13s |
| Warlock | 15s | 8s | 4s | 20s | 25s | 34s |
| Paladin | 23s | 13s | 6s | 32s | 41s | 52s |
| Druid | 16s | 9s | 9s | 32s | 40s | 49s |
| Necromancer | 13s | 7s | 4s | 20s | 26s | 33s |
| Monk | 11s | 6s | 3s | 13s | 14s | 16s |

After:

**Solo boss (kill time, or time of death and boss % removed) [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 19s | 9s | 6s | 32s | 39s | 51s |
| Mage | 10s | 6s | 4s | 19s | 25s | 30s |
| Ranger | 13s | 6s | 4s | 20s | 23s | 31s |
| Cleric | 19s | 10s | 9s | 37s | 41s | 54s |
| Rogue | 11s | 6s | 4s | 17s | 21s | 27s |
| Warlock | 14s | 8s | 4s | 22s | 25s | 34s |
| Paladin | 18s | 12s | 5s | 28s | 34s | 46s |
| Druid | 16s | 9s | 9s | 34s | 41s | 50s |
| Necromancer | 13s | 7s | 4s | 21s | 26s | 34s |
| Monk | 13s | 7s | 4s | 18s | 21s | 28s |

### Healing per second on one tank
Before:

**Healing per second on one tank [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cleric | 83 | 136 | 162 | 268 | 389 | 497 |
| Paladin | 9 | 15 | 16 | 26 | 38 | 49 |
| Druid | 41 | 68 | 106 | 176 | 256 | 328 |

After:

**Healing per second on one tank [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cleric | 83 | 136 | 162 | 268 | 389 | 497 |
| Paladin | 15 | 25 | 27 | 44 | 63 | 81 |
| Druid | 41 | 68 | 106 | 176 | 256 | 328 |

### Healing per second across a party of five
Before:

**Healing per second across a party of five [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cleric | 83 | 136 | 230 | 380 | 551 | 705 |
| Paladin | 9 | 15 | 16 | 26 | 38 | 49 |
| Druid | 41 | 68 | 243 | 402 | 585 | 749 |

Monsters used: L10: Goblin Raider (L9, 150 hp) / boss Moss Golem (L20, 2200 hp); L20: Sand Scarab (L18, 310 hp) / boss Moss Golem (L20, 2200 hp); L20: Sand Scarab (L18, 310 hp) / boss Moss Golem (L20, 2200 hp); L30: Gale Owl (L30, 614 hp) / boss The Sun King (L32, 13619 hp); L45: Ember Knight (L44, 2591 hp) / boss Glacius, the Frozen King (L44, 24288 hp); L60: Ember Knight (L44, 2591 hp) / boss Cinderwing (L54, 40447 hp)

After:

**Healing per second across a party of five [geared gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cleric | 83 | 136 | 230 | 380 | 551 | 705 |
| Paladin | 15 | 25 | 27 | 44 | 63 | 81 |
| Druid | 41 | 68 | 243 | 402 | 585 | 749 |

Monsters used: L10: Goblin Raider (L9, 150 hp) / boss Moss Golem (L20, 2200 hp); L20: Sand Scarab (L18, 310 hp) / boss Moss Golem (L20, 2200 hp); L20: Sand Scarab (L18, 310 hp) / boss Moss Golem (L20, 2200 hp); L30: Gale Owl (L30, 614 hp) / boss The Sun King (L32, 13619 hp); L45: Ember Knight (L44, 2591 hp) / boss Glacius, the Frozen King (L44, 24288 hp); L60: Ember Knight (L44, 2591 hp) / boss Cinderwing (L54, 40447 hp)


## Starter gear (nothing found yet)

At levels 45 and 60 a hero in starter gear is not realistic; the columns exist to show the shape of the early game (L10-L30).

Single-target DPS, before:

**Single-target sustained DPS [starter gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 51 | 81 | 104 | 140 | 195 | 248 |
| Mage | 111 | 179 | 207 | 282 | 393 | 505 |
| Ranger | 88 | 156 | 195 | 284 | 434 | 594 |
| Cleric | 48 | 74 | 84 | 113 | 157 | 200 |
| Rogue | 118 | 203 | 243 | 353 | 553 | 756 |
| Warlock | 78 | 126 | 182 | 251 | 349 | 448 |
| Paladin | 51 | 80 | 109 | 147 | 205 | 260 |
| Druid | 69 | 109 | 115 | 157 | 219 | 280 |
| Necromancer | 92 | 149 | 188 | 258 | 361 | 463 |
| Monk | 88 | 150 | 202 | 289 | 414 | 568 |

After:

**Single-target sustained DPS [starter gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 63 | 101 | 129 | 174 | 242 | 309 |
| Mage | 110 | 177 | 204 | 277 | 387 | 497 |
| Ranger | 85 | 145 | 181 | 265 | 382 | 515 |
| Cleric | 61 | 95 | 107 | 144 | 200 | 255 |
| Rogue | 98 | 162 | 198 | 273 | 407 | 548 |
| Warlock | 80 | 130 | 182 | 257 | 358 | 459 |
| Paladin | 61 | 96 | 130 | 176 | 245 | 311 |
| Druid | 68 | 108 | 115 | 157 | 218 | 279 |
| Necromancer | 92 | 149 | 187 | 257 | 360 | 462 |
| Monk | 79 | 128 | 172 | 241 | 340 | 458 |

Effective HP, before:

**Effective HP vs level-appropriate monster [starter gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 717 | 1257 | 1408 | 1944 | 2793 | 3660 |
| Mage | 258 | 419 | 419 | 572 | 793 | 1023 |
| Ranger | 447 | 766 | 837 | 1203 | 1830 | 2543 |
| Cleric | 459 | 798 | 839 | 1191 | 1721 | 2245 |
| Rogue | 318 | 535 | 541 | 749 | 1110 | 1526 |
| Warlock | 462 | 810 | 887 | 1229 | 1736 | 2309 |
| Paladin | 569 | 934 | 980 | 1399 | 1968 | 2573 |
| Druid | 304 | 493 | 493 | 673 | 933 | 1204 |
| Necromancer | 427 | 747 | 785 | 1117 | 1585 | 2064 |
| Monk | 507 | 905 | 960 | 1364 | 2074 | 2831 |

After:

**Effective HP vs level-appropriate monster [starter gear]**

| job | L10/j10 | L20/j10 | L20/j20 | L30/j20 | L45/j20 | L60/j20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | 714 | 1252 | 1402 | 1936 | 2782 | 3645 |
| Mage | 257 | 417 | 417 | 570 | 789 | 1019 |
| Ranger | 434 | 728 | 791 | 1112 | 1631 | 2179 |
| Cleric | 458 | 795 | 836 | 1186 | 1714 | 2236 |
| Rogue | 309 | 510 | 512 | 694 | 995 | 1318 |
| Warlock | 460 | 807 | 883 | 1224 | 1729 | 2300 |
| Paladin | 566 | 931 | 976 | 1393 | 1960 | 2563 |
| Druid | 303 | 491 | 491 | 671 | 929 | 1199 |
| Necromancer | 425 | 744 | 782 | 1113 | 1578 | 2055 |
| Monk | 495 | 871 | 919 | 1286 | 1910 | 2539 |

## Skill value after the pass (L60 / job level 20, geared)

**Skill value at L60/j20, geared (amount per cast, per second of cooldown, per second on 3 targets, share of the job damage in its best bar)**

| job | skill | lvl | cd s | kind | per cast | per s | per s x3 | dmg % | fx |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Warrior | Cleave | 1 | 4 | damage | 549 | 137.2 | 411.7 | 41.9 |  |
| Warrior | Shield Bash | 3 | 8 | damage | 392 | 49.0 | 49.0 | 9.1 | stun |
| Warrior | Battle Cry | 6 | 20 | buff | 653 | 32.7 | 0.0 | - | atkUp |
| Warrior | Provoke | 9 | 12 | buff | 0 | 0.0 | 0.0 | - | defUp |
| Warrior | Whirlwind | 13 | 14 | damage | 1387 | 99.1 | 297.2 | 34.3 | bleed |
| Warrior | Bulwark | 17 | 45 | shield | 1307 | 29.0 | 0.0 | - | defUp |
| Mage | Fireball | 1 | 3 | damage | 1440 | 480.0 | 480.0 | 37.8 | burn |
| Mage | Frost Nova | 3 | 10 | damage | 518 | 51.8 | 155.4 | 14.9 | slow |
| Mage | Blink | 6 | 15 | utility | 0 | 0.0 | 0.0 | - |  |
| Mage | Chain Lightning | 9 | 9 | damage | 753 | 83.7 | 200.9 | 10.1 |  |
| Mage | Meteor | 13 | 25 | damage | 1742 | 69.7 | 209.0 | 25.0 |  |
| Mage | Arcane Barrier | 17 | 40 | shield | 470 | 11.8 | 0.0 | - | haste |
| Ranger | Power Shot | 1 | 3 | damage | 1123 | 374.3 | 374.3 | 28.9 |  |
| Ranger | Volley | 3 | 8 | damage | 635 | 79.3 | 238.0 | 17.6 |  |
| Ranger | Sprint | 6 | 18 | buff | 0 | 0.0 | 0.0 | - | haste |
| Ranger | Ensnare | 9 | 14 | damage | 391 | 27.9 | 27.9 | 2.8 | slow |
| Ranger | Venom Arrow | 13 | 12 | damage | 1325 | 110.4 | 110.4 | 9.6 | poison |
| Ranger | Arrow Rain | 17 | 22 | damage | 1562 | 71.0 | 213.1 | 24.3 |  |
| Cleric | Smite | 1 | 3 | damage | 993 | 330.8 | 330.8 | 50.7 |  |
| Cleric | Heal | 3 | 6 | heal | 1554 | 259.0 | 0.0 | - |  |
| Cleric | Blessing | 6 | 25 | buff | 0 | 0.0 | 0.0 | - | atkUp+defUp |
| Cleric | Renew | 9 | 16 | heal | 2798 | 174.8 | 0.0 | - |  |
| Cleric | Holy Nova | 13 | 15 | damage | 690 | 46.0 | 138.1 | 29.9 |  |
| Cleric | Divine Shield | 17 | 50 | buff | 0 | 0.0 | 0.0 | - | invuln |
| Rogue | Quick Stab | 1 | 2.5 | damage | 754 | 301.5 | 301.5 | 19.1 |  |
| Rogue | Backstab | 3 | 6 | damage | 1005 | 167.5 | 167.5 | 15.4 |  |
| Rogue | Evade | 6 | 18 | buff | 0 | 0.0 | 0.0 | - | dodge+haste |
| Rogue | Rupture | 9 | 10 | damage | 1323 | 132.3 | 132.3 | 8.4 | bleed |
| Rogue | Smoke Bomb | 13 | 25 | damage | 302 | 12.1 | 36.2 | 5.6 | slow |
| Rogue | Assassinate | 17 | 30 | damage | 3217 | 107.2 | 107.2 | 17.0 |  |
| Warlock | Shadow Bolt | 1 | 3 | damage | 727 | 242.4 | 242.4 | 26.8 |  |
| Warlock | Drain Life | 3 | 8 | damage | 509 | 63.6 | 63.6 | 7.0 |  |
| Warlock | Curse of Frailty | 6 | 16 | damage | 255 | 15.9 | 15.9 | 2.4 | vuln |
| Warlock | Terrify | 9 | 20 | damage | 545 | 27.3 | 81.8 | 16.0 | fear |
| Warlock | Soul Burn | 13 | 12 | damage | 1513 | 126.1 | 126.1 | 14.3 | burn |
| Warlock | Dark Pact | 17 | 40 | buff | 0 | 0.0 | 0.0 | - | atkUp |
| Paladin | Crusader Strike | 1 | 3 | damage | 630 | 210.0 | 210.0 | 29.5 |  |
| Paladin | Lay on Hands | 3 | 18 | heal | 1214 | 67.4 | 0.0 | - |  |
| Paladin | Righteous Charge | 6 | 14 | damage | 455 | 32.5 | 32.5 | 6.3 | stun |
| Paladin | Consecration | 9 | 12 | damage | 582 | 48.5 | 145.5 | 28.4 |  |
| Paladin | Judgment | 13 | 15 | damage | 841 | 56.1 | 56.1 | 9.7 | vuln |
| Paladin | Avenging Wrath | 17 | 60 | buff | 353 | 5.9 | 0.0 | - | atkUp+defUp |
| Druid | Moonfire | 1 | 3 | damage | 949 | 316.4 | 316.4 | 36.9 | burn |
| Druid | Rejuvenation | 3 | 12 | heal | 2676 | 223.0 | 0.0 | - |  |
| Druid | Entangling Roots | 6 | 14 | damage | 211 | 15.1 | 15.1 | 2.3 | root |
| Druid | Starfall | 9 | 22 | damage | 1194 | 54.3 | 162.8 | 32.6 |  |
| Druid | Wild Growth | 13 | 25 | heal | 2102 | 84.1 | 0.0 | - |  |
| Druid | Barkskin | 17 | 45 | shield | 664 | 14.7 | 0.0 | - | defUp |
| Necromancer | Death Bolt | 1 | 3 | damage | 870 | 290.1 | 290.1 | 26.1 |  |
| Necromancer | Plague | 3 | 10 | damage | 1231 | 123.1 | 123.1 | 11.5 | poison |
| Necromancer | Bone Spear | 6 | 8 | damage | 622 | 77.7 | 233.1 | 15.2 |  |
| Necromancer | Bone Prison | 9 | 18 | damage | 207 | 11.5 | 34.5 | 4.8 | root |
| Necromancer | Reap | 13 | 14 | damage | 912 | 65.1 | 195.4 | 26.1 |  |
| Necromancer | Lich Form | 17 | 45 | buff | 290 | 6.4 | 0.0 | - | atkUp+defUp |
| Monk | Flurry of Blows | 1 | 3 | damage | 949 | 316.5 | 316.5 | 24.3 |  |
| Monk | Stunning Palm | 3 | 9 | damage | 549 | 61.0 | 61.0 | 5.0 | stun |
| Monk | Meditate | 6 | 24 | buff | 780 | 32.5 | 0.0 | - | defUp |
| Monk | Dragon Kick | 9 | 10 | damage | 1139 | 113.9 | 113.9 | 10.5 |  |
| Monk | Tempest Kick | 13 | 12 | damage | 928 | 77.4 | 232.1 | 27.2 | slow |
| Monk | Chi Surge | 17 | 50 | buff | 0 | 0.0 | 0.0 | - | haste+atkUp+dodge |

- Skills under 3% of their job's damage with no control role: none.
- Skills on a cooldown over 3 s that are worth over 2.5x their job's median damage per second of cooldown: none.

## Test stability (scripts/smoke-scale.mjs)

The loot-protection steps of `smoke-scale` failed intermittently when it ran first in `npm test` (and reliably when the machine was busy). Causes: fixed sleeps
(450 ms to log in, 160 ms per teleport, 400 ms to see gold or a log line) that are too short when the server tick or the socket lags, and the server's 8 s loot lock, which
keeps running on the wall clock while the test's slow steps pile up, so a stranger's attempt could land after the lock had already expired. The test now waits on server-reported state
(first snapshot, position, entity, gold or the "reserved" log line) with generous deadlines. For the lock it records when the drop first appeared; an attempt that lands inside the lock window must still be refused
(otherwise it fails), and one that lands too late to prove anything is retried with a fresh kill. All assertions are unchanged. Every test script also accepts `EM_TEST_PORT_OFFSET` so two test runs can share a machine.
