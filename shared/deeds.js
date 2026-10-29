// Deeds: lifetime achievements. Each one is derived from counters the server keeps (p.stats) plus the hero's
// progress, so they are cheap to re-check and can never be granted by a client message. Some award a title that
// the player may display under their name.
import { JOB_ORDER } from './jobs.js';

export const STAT_KEYS = ['kills', 'bosses', 'quests', 'deaths', 'dungeons'];
export const newStats = () => ({ kills: 0, bosses: 0, quests: 0, deaths: 0, dungeons: 0 });

const jobsTried = (p) => JOB_ORDER.filter((j) => p.jobs[j] && p.jobs[j].lvl >= 1).length;
const jobMaxed = (p) => JOB_ORDER.some((j) => p.jobs[j] && p.jobs[j].lvl >= 20);

// need/have give the progress bar its numbers: have(p) is clamped to need for display.
export const DEEDS = [
  { id: 'first_blood', name: 'First Blood', desc: 'Defeat your first monster.', need: 1, have: (p) => p.stats.kills, title: 'the Newcomer' },
  { id: 'slayer', name: 'Monster Hunter', desc: 'Defeat 100 monsters.', need: 100, have: (p) => p.stats.kills, title: 'the Hunter' },
  { id: 'relentless', name: 'Relentless', desc: 'Defeat 500 monsters.', need: 500, have: (p) => p.stats.kills, title: 'the Relentless' },
  { id: 'bossbane', name: 'Bossbane', desc: 'Help defeat a boss.', need: 1, have: (p) => p.stats.bosses, title: 'Bossbane' },
  { id: 'delver', name: 'Delver', desc: 'Conquer 3 dungeons.', need: 3, have: (p) => p.stats.dungeons, title: 'the Delver' },
  { id: 'errands', name: 'Dependable', desc: 'Complete 10 quests.', need: 10, have: (p) => p.stats.quests, title: 'the Dependable' },
  { id: 'hero', name: 'Hero of Eldermoor', desc: 'Complete 25 quests.', need: 25, have: (p) => p.stats.quests, title: 'Hero of Eldermoor' },
  { id: 'lv10', name: 'Seasoned', desc: 'Reach level 10.', need: 10, have: (p) => p.lvl, title: 'the Seasoned' },
  { id: 'lv30', name: 'Veteran', desc: 'Reach level 30.', need: 30, have: (p) => p.lvl, title: 'the Veteran' },
  { id: 'lv60', name: 'Legend', desc: 'Reach level 60.', need: 60, have: (p) => p.lvl, title: 'the Legend' },
  { id: 'versatile', name: 'Versatile', desc: 'Train 3 different jobs.', need: 3, have: jobsTried, title: 'the Versatile' },
  { id: 'master', name: 'Job Master', desc: 'Take any job to level 20.', need: 1, have: (p) => (jobMaxed(p) ? 1 : 0), title: 'the Master' },
  { id: 'all_jobs', name: 'Jack of All Trades', desc: 'Train every job.', need: JOB_ORDER.length, have: jobsTried, title: 'Jack of All Trades' },
  { id: 'fallen', name: 'Down but Not Out', desc: 'Fall in battle 10 times.', need: 10, have: (p) => p.stats.deaths, title: 'the Unyielding' },
];
export const DEED_BY_ID = Object.fromEntries(DEEDS.map((d) => [d.id, d]));

// Returns the deeds newly satisfied (not yet in p.deeds); the caller records and announces them.
export function newDeeds(p) {
  return DEEDS.filter((d) => !p.deeds[d.id] && d.have(p) >= d.need);
}
export function validStats(s) {
  const o = newStats();
  if (s && typeof s === 'object') for (const k of STAT_KEYS) o[k] = Math.max(0, Math.min(1e9, Number(s[k]) | 0));
  return o;
}
export function validDeeds(d) {
  const o = {};
  if (d && typeof d === 'object') for (const id of Object.keys(d)) if (Object.hasOwn(DEED_BY_ID, id) && d[id]) o[id] = 1;
  return o;
}
export function titleText(deedId) {
  return Object.hasOwn(DEED_BY_ID, deedId) ? DEED_BY_ID[deedId].title : '';
}
