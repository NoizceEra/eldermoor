// Appearance options and wearable item definitions, shared by server (generation, validation) and client (drawing).

// ---- equipment slots
export const EQ_KEYS = ['weapon', 'offhand', 'head', 'body', 'legs', 'boots', 'gloves', 'cape', 'ring1', 'ring2', 'amulet'];
export const EQ_LABEL = {
  weapon: 'Weapon', offhand: 'Offhand', head: 'Head', body: 'Body', legs: 'Legs', boots: 'Boots',
  gloves: 'Gloves', cape: 'Cape', ring1: 'Ring', ring2: 'Ring', amulet: 'Amulet',
};
/** item.s values (a ring fits either ring slot) */
export const GEAR_SLOTS = ['weapon', 'offhand', 'head', 'body', 'legs', 'boots', 'gloves', 'cape', 'ring', 'amulet'];
export const emptyEq = () => Object.fromEntries(EQ_KEYS.map((k) => [k, null]));

/** which equipment key an item goes into; rings take the first free ring slot, else replace ring 1 */
export function eqKeyFor(eq, it) {
  if (!it || !GEAR_SLOTS.includes(it.s)) return null;
  if (it.s === 'ring') return !eq.ring1 ? 'ring1' : !eq.ring2 ? 'ring2' : 'ring1';
  return it.s;
}

// ---- appearance
export const SKIN_TONES = ['#f6d2b0', '#f0c090', '#e0a878', '#c68a5a', '#a06a40', '#6e4a30'];
export const HAIR_STYLES = ['short', 'long', 'spiky', 'mohawk', 'ponytail', 'bald', 'bob', 'twintails', 'bun', 'curly', 'braid', 'wild'];
export const HAIR_COLORS = ['#2a1a12', '#5a3a22', '#8a5a2a', '#d8b050', '#c84a2a', '#e8e0c8', '#3a4a8a', '#8a3a8a', '#d86aa0', '#3ab8a8', '#6ac85a', '#f08a2a'];
export const EYE_COLORS = ['#1a1a2a', '#2a5a9a', '#2a8a4a', '#7a4a2a', '#8a2a8a', '#c03a3a', '#e8a820', '#6a2ac0'];
export const EYE_STYLES = ['round', 'sharp', 'sleepy', 'sparkle'];
export const FACE_MARKS = ['none', 'blush', 'freckles', 'scar', 'glasses', 'eyepatch'];
export const LOOK_LIMITS = [SKIN_TONES.length, HAIR_STYLES.length, HAIR_COLORS.length, EYE_COLORS.length, EYE_STYLES.length, FACE_MARKS.length];
export const LOOK_LABELS = ['Skin', 'Hair style', 'Hair colour', 'Eye colour', 'Eye shape', 'Face'];
export const LOOK_COST = 50;

/** [skin, hairStyle, hairColour, eyeColour, eyeShape, faceMark] as small integers; the older 4-field form is padded. null when malformed */
export function validLook(l) {
  if (!Array.isArray(l) || (l.length !== 4 && l.length !== LOOK_LIMITS.length)) return null;
  const out = l.map((v) => Math.floor(Number(v)));
  while (out.length < LOOK_LIMITS.length) out.push(0);
  return out.every((v, i) => Number.isInteger(v) && v >= 0 && v < LOOK_LIMITS[i]) ? out : null;
}
export function defaultLook(name = '') {
  let h = 7;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LOOK_LIMITS.map((n, i) => (h >>> (i * 5)) % n);
}

// ---- wearable kinds. `pal` names the colour palette items of this kind are dyed from.
export const PALETTES = {
  cloth: ['#b03a3a', '#3a5aa0', '#3f7a3f', '#6a3fb0', '#e8e0d0', '#c8a030', '#2a2a3a', '#a05a8a'],
  leather: ['#8a5a2a', '#6a4a2a', '#a07a4a', '#4a3a2a', '#3f5a3a'],
  metal: ['#aab2c0', '#8a94a8', '#c8a040', '#6a7a8a', '#9a6a4a'],
  gold: ['#e8c04a'],
  gem: ['#c06bff', '#4aa3ff', '#5fd35f', '#ff5a5a', '#ffd23a'],
};
export const KINDS = {
  weapon: [{ b: 'sword', n: 'Sword' }, { b: 'staff', n: 'Staff' }, { b: 'bow', n: 'Bow' }, { b: 'axe', n: 'Axe' }, { b: 'mace', n: 'Mace' }, { b: 'dagger', n: 'Dagger' }, { b: 'wand', n: 'Wand' }],
  offhand: [{ b: 'shield', n: 'Shield', pal: 'metal' }, { b: 'tome', n: 'Tome', pal: 'cloth' }, { b: 'quiver', n: 'Quiver', pal: 'leather' }],
  head: [{ b: 'cap', n: 'Cap', pal: 'cloth' }, { b: 'hood', n: 'Hood', pal: 'cloth' }, { b: 'helm', n: 'Helm', pal: 'metal' }, { b: 'crown', n: 'Crown', pal: 'gold' }, { b: 'horns', n: 'Horned Helm', pal: 'metal' }, { b: 'circlet', n: 'Circlet', pal: 'gold' }, { b: 'wizhat', n: 'Hat', pal: 'cloth' }],
  body: [{ b: 'robe', n: 'Robe', pal: 'cloth' }, { b: 'tunic', n: 'Tunic', pal: 'cloth' }, { b: 'vest', n: 'Vest', pal: 'leather' }, { b: 'mail', n: 'Mail', pal: 'metal' }, { b: 'plate', n: 'Plate', pal: 'metal' }],
  legs: [{ b: 'pants', n: 'Trousers', pal: 'cloth' }, { b: 'leggings', n: 'Leggings', pal: 'leather' }, { b: 'greaves', n: 'Greaves', pal: 'metal' }],
  boots: [{ b: 'boots', n: 'Boots', pal: 'leather' }, { b: 'shoes', n: 'Shoes', pal: 'cloth' }, { b: 'sabatons', n: 'Sabatons', pal: 'metal' }],
  gloves: [{ b: 'gloves', n: 'Gloves', pal: 'leather' }, { b: 'gauntlets', n: 'Gauntlets', pal: 'metal' }, { b: 'wraps', n: 'Wraps', pal: 'cloth' }],
  cape: [{ b: 'cape', n: 'Cape', pal: 'cloth' }, { b: 'cloak', n: 'Cloak', pal: 'cloth' }, { b: 'mantle', n: 'Mantle', pal: 'leather' }],
  ring: [{ b: 'ring', n: 'Ring', pal: 'gem' }],
  amulet: [{ b: 'amulet', n: 'Amulet', pal: 'gem' }, { b: 'charm', n: 'Charm', pal: 'gem' }],
};
export const kindName = (slot, b) => ((KINDS[slot] || []).find((k) => k.b === b) || { n: b }).n;

/** fallback dye for items without one (old saves, shop stock) */
const DEFAULT_COLOR = {
  cap: '#3a5aa0', hood: '#3f7a3f', helm: '#aab2c0', crown: '#e8c04a', horns: '#aab2c0', circlet: '#e8c04a', wizhat: '#6a3fb0',
  robe: '#6a3fb0', tunic: '#b03a3a', vest: '#8a5a2a', mail: '#8a94a8', plate: '#aab2c0',
  pants: '#6a4a2a', leggings: '#6a4a2a', greaves: '#8a94a8', boots: '#5a3a22', shoes: '#4a3a2a', sabatons: '#8a94a8',
  gloves: '#8a5a2a', gauntlets: '#8a94a8', wraps: '#e8e0d0', cape: '#b03a3a', cloak: '#3f7a3f', mantle: '#6a4a2a',
  shield: '#5a6a8a', tome: '#8a3a3a', quiver: '#7a5230', ring: '#c06bff', amulet: '#4aa3ff', charm: '#5fd35f',
};
export const defaultColor = (b) => DEFAULT_COLOR[b] || '#aab2c0';

/** compact per-player visual summary sent with every state packet: what is worn on the body, plus the amulet and first ring */
export const VIS_ORDER = ['head', 'body', 'legs', 'boots', 'gloves', 'cape', 'offhand', 'weapon', 'amulet', 'ring1'];
export const visTokens = (eq) => VIS_ORDER.map((k) => (eq[k] ? `${eq[k].b}~${eq[k].cl || ''}~${eq[k].r}` : ''));

/** what every new hero starts wearing: slot -> [kind, dye]. The job's weapon comes from JOBS[job].start. */
export const STARTER_KIT = {
  warrior: { head: ['helm', '#aab2c0'], body: ['tunic', '#b03a3a'], legs: ['pants', '#4a4a5a'], boots: ['boots', '#5a3a22'], offhand: ['shield', '#5a6a8a'] },
  mage: { head: ['wizhat', '#5a2f9a'], body: ['robe', '#6a3fb0'], legs: ['pants', '#3a2a5a'], boots: ['shoes', '#3a2a1a'] },
  ranger: { head: ['hood', '#2f5f33'], body: ['vest', '#3f7a3f'], legs: ['pants', '#6a4a2a'], boots: ['boots', '#3a2a1a'] },
  cleric: { head: ['cap', '#f0d060'], body: ['robe', '#f0f0e8'], legs: ['pants', '#c8b070'], boots: ['shoes', '#7a5a2a'] },
  rogue: { head: ['hood', '#2f2f3f'], body: ['vest', '#3a3a4a'], legs: ['pants', '#2a2a34'], boots: ['boots', '#1a1a22'] },
  warlock: { head: ['wizhat', '#3a1050'], body: ['robe', '#5a1f5a'], legs: ['pants', '#2a1030'], boots: ['shoes', '#1a1020'] },
  paladin: { head: ['helm', '#d8d0a0'], body: ['plate', '#d8d0a0'], legs: ['greaves', '#aab2c0'], boots: ['sabatons', '#aab2c0'], offhand: ['shield', '#e8d88a'] },
  druid: { head: ['hood', '#4f8f4f'], body: ['robe', '#4f7a3f'], legs: ['leggings', '#6a4a2a'], boots: ['shoes', '#5a3a22'] },
  necromancer: { head: ['hood', '#2a3a3a'], body: ['robe', '#2f4a45'], legs: ['pants', '#1a2a28'], boots: ['shoes', '#1a2020'] },
  monk: { body: ['vest', '#c8782a'], legs: ['pants', '#e8e0d0'], boots: ['shoes', '#e8e0d0'], gloves: ['wraps', '#c8782a'] },
};
