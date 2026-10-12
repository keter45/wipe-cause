// Specs de DPS e de cura: id do jogo, nomes no SimulationCraft, no Warcraft Logs e o arquivo em rotations/.

const LIST = [
  ['deathknight', 'frost', 251, 'DeathKnight', 'Frost', 'Frost Death Knight'],
  ['deathknight', 'unholy', 252, 'DeathKnight', 'Unholy', 'Unholy Death Knight'],
  ['demonhunter', 'havoc', 577, 'DemonHunter', 'Havoc', 'Havoc Demon Hunter'],
  ['demonhunter', 'devourer', 1480, 'DemonHunter', 'Devourer', 'Devourer Demon Hunter'],
  ['druid', 'balance', 102, 'Druid', 'Balance', 'Balance Druid'],
  ['druid', 'feral', 103, 'Druid', 'Feral', 'Feral Druid'],
  ['evoker', 'devastation', 1467, 'Evoker', 'Devastation', 'Devastation Evoker'],
  ['evoker', 'augmentation', 1473, 'Evoker', 'Augmentation', 'Augmentation Evoker'],
  ['hunter', 'beast_mastery', 253, 'Hunter', 'BeastMastery', 'Beast Mastery Hunter'],
  ['hunter', 'marksmanship', 254, 'Hunter', 'Marksmanship', 'Marksmanship Hunter'],
  ['hunter', 'survival', 255, 'Hunter', 'Survival', 'Survival Hunter'],
  ['mage', 'arcane', 62, 'Mage', 'Arcane', 'Arcane Mage'],
  ['mage', 'fire', 63, 'Mage', 'Fire', 'Fire Mage'],
  ['mage', 'frost', 64, 'Mage', 'Frost', 'Frost Mage'],
  ['monk', 'windwalker', 269, 'Monk', 'Windwalker', 'Windwalker Monk'],
  ['paladin', 'retribution', 70, 'Paladin', 'Retribution', 'Retribution Paladin'],
  ['priest', 'shadow', 258, 'Priest', 'Shadow', 'Shadow Priest'],
  ['rogue', 'assassination', 259, 'Rogue', 'Assassination', 'Assassination Rogue'],
  ['rogue', 'outlaw', 260, 'Rogue', 'Outlaw', 'Outlaw Rogue'],
  ['rogue', 'subtlety', 261, 'Rogue', 'Subtlety', 'Subtlety Rogue'],
  ['shaman', 'elemental', 262, 'Shaman', 'Elemental', 'Elemental Shaman'],
  ['shaman', 'enhancement', 263, 'Shaman', 'Enhancement', 'Enhancement Shaman'],
  ['warlock', 'affliction', 265, 'Warlock', 'Affliction', 'Affliction Warlock'],
  ['warlock', 'demonology', 266, 'Warlock', 'Demonology', 'Demonology Warlock'],
  ['warlock', 'destruction', 267, 'Warlock', 'Destruction', 'Destruction Warlock'],
  ['warrior', 'arms', 71, 'Warrior', 'Arms', 'Arms Warrior'],
  ['warrior', 'fury', 72, 'Warrior', 'Fury', 'Fury Warrior'],
];

// Healers: comparados com logs de referência (composição parecida, sem só o topo do ranking), não com
// os tops; ver docs/healer-analysis.md. Ficam fora do fluxo dos DPS (refresh, tops-all).
const HEALERS = [
  ['druid', 'restoration', 105, 'Druid', 'Restoration', 'Restoration Druid'],
  ['paladin', 'holy', 65, 'Paladin', 'Holy', 'Holy Paladin'],
  ['priest', 'discipline', 256, 'Priest', 'Discipline', 'Discipline Priest'],
  ['priest', 'holy', 257, 'Priest', 'Holy', 'Holy Priest'],
  ['shaman', 'restoration', 264, 'Shaman', 'Restoration', 'Restoration Shaman'],
  ['monk', 'mistweaver', 270, 'Monk', 'Mistweaver', 'Mistweaver Monk'],
  ['evoker', 'preservation', 1468, 'Evoker', 'Preservation', 'Preservation Evoker'],
];

const toSpec = (role) => ([cls, spec, id, wclClass, wclSpec, name]) => ({
  role,
  id,
  cls,
  spec,
  wclClass,
  wclSpec,
  name,
  // nome da spec como o SimC escreve nas árvores de talento ("Beast Mastery")
  specLabel: name.replace(/ (Death Knight|Demon Hunter|Druid|Evoker|Hunter|Mage|Monk|Paladin|Priest|Rogue|Shaman|Warlock|Warrior)$/, ''),
  simc: `${cls}_${spec}`,
  file: `${cls}-${spec.replace(/_/g, '-')}`,
});

export const SPECS = LIST.map(toSpec('dps'));
export const HEALER_SPECS = HEALERS.map(toSpec('healer'));

/** "unholy", "deathknight-unholy", "deathknight_unholy" ou "252". */
export function findSpec(key) {
  const k = String(key ?? '').toLowerCase();
  const hits = [...SPECS, ...HEALER_SPECS].filter((s) => String(s.id) === k || s.file === k || s.simc === k || s.spec === k || s.spec.replace(/_/g, '-') === k);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`"${key}" é ambíguo: ${hits.map((s) => s.file).join(', ')}`);
  throw new Error(`spec desconhecida: "${key}" (ex.: ${SPECS.slice(0, 3).map((s) => s.file).join(', ')})`);
}

/** Token no estilo do SimC: "Reaper's Toll" -> reapers_toll, "San'layn" -> sanlayn. */
export function token(name) {
  return String(name)
    .toLowerCase()
    .replace(/['’!:]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
