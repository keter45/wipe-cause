// Nome das specs (em inglês, como no Warcraft Logs e no WoWAnalyzer).

export const SPEC_NAMES: Record<number, { class: string; spec: string }> = {
  250: { class: 'DeathKnight', spec: 'Blood' },
  251: { class: 'DeathKnight', spec: 'Frost' },
  252: { class: 'DeathKnight', spec: 'Unholy' },
  577: { class: 'DemonHunter', spec: 'Havoc' },
  581: { class: 'DemonHunter', spec: 'Vengeance' },
  1480: { class: 'DemonHunter', spec: 'Devourer' },
  102: { class: 'Druid', spec: 'Balance' },
  103: { class: 'Druid', spec: 'Feral' },
  104: { class: 'Druid', spec: 'Guardian' },
  105: { class: 'Druid', spec: 'Restoration' },
  1467: { class: 'Evoker', spec: 'Devastation' },
  1468: { class: 'Evoker', spec: 'Preservation' },
  1473: { class: 'Evoker', spec: 'Augmentation' },
  253: { class: 'Hunter', spec: 'BeastMastery' },
  254: { class: 'Hunter', spec: 'Marksmanship' },
  255: { class: 'Hunter', spec: 'Survival' },
  62: { class: 'Mage', spec: 'Arcane' },
  63: { class: 'Mage', spec: 'Fire' },
  64: { class: 'Mage', spec: 'Frost' },
  268: { class: 'Monk', spec: 'Brewmaster' },
  269: { class: 'Monk', spec: 'Windwalker' },
  270: { class: 'Monk', spec: 'Mistweaver' },
  65: { class: 'Paladin', spec: 'Holy' },
  66: { class: 'Paladin', spec: 'Protection' },
  70: { class: 'Paladin', spec: 'Retribution' },
  256: { class: 'Priest', spec: 'Discipline' },
  257: { class: 'Priest', spec: 'Holy' },
  258: { class: 'Priest', spec: 'Shadow' },
  259: { class: 'Rogue', spec: 'Assassination' },
  260: { class: 'Rogue', spec: 'Outlaw' },
  261: { class: 'Rogue', spec: 'Subtlety' },
  262: { class: 'Shaman', spec: 'Elemental' },
  263: { class: 'Shaman', spec: 'Enhancement' },
  264: { class: 'Shaman', spec: 'Restoration' },
  265: { class: 'Warlock', spec: 'Affliction' },
  266: { class: 'Warlock', spec: 'Demonology' },
  267: { class: 'Warlock', spec: 'Destruction' },
  71: { class: 'Warrior', spec: 'Arms' },
  72: { class: 'Warrior', spec: 'Fury' },
  73: { class: 'Warrior', spec: 'Protection' },
};

/** "Marksmanship" / "Beast Mastery" para mostrar. */
export function specLabel(specId: number | null | undefined): string {
  const s = specId != null ? SPEC_NAMES[specId] : undefined;
  return s ? s.spec.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Spec desconhecida';
}
