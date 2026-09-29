// Cooldowns maiores de dano (e de cura, para healers) por classe: os que abrem uma janela de
// burst. Casa por spell ID ou pelo nome (o log e o Warcraft Logs às vezes usam IDs diferentes).
// Utilidades (Wind Rush Totem, Capacitor Totem, movimento) e cooldowns curtos (45-60s:
// Stormkeeper, Frozen Orb, Colossus Smash) ficam de fora de propósito.

type Role = 'dps' | 'healer';
interface Cd {
  id: number;
  name: string;
  /** só para esta função (sem: vale para as duas) */
  role?: Role;
}

const CDS: Record<string, Cd[]> = {
  DeathKnight: [
    { id: 51271, name: 'Pillar of Frost' },
    { id: 152279, name: 'Breath of Sindragosa' },
    { id: 279302, name: "Frostwyrm's Fury" },
    { id: 63560, name: 'Dark Transformation' },
    { id: 275699, name: 'Apocalypse' },
    { id: 42650, name: 'Army of the Dead' },
    { id: 49206, name: 'Summon Gargoyle' },
    { id: 383269, name: 'Abomination Limb' },
    { id: 47568, name: 'Empower Rune Weapon' },
    { id: 49028, name: 'Dancing Rune Weapon' },
  ],
  DemonHunter: [
    { id: 191427, name: 'Metamorphosis' },
    { id: 370965, name: 'The Hunt' },
    { id: 1217605, name: 'Void Metamorphosis' },
  ],
  Druid: [
    { id: 194223, name: 'Celestial Alignment' },
    { id: 102560, name: 'Incarnation: Chosen of Elune' },
    { id: 391528, name: 'Convoke the Spirits' },
    { id: 106951, name: 'Berserk' },
    { id: 102543, name: 'Incarnation: Avatar of Ashamane' },
    { id: 740, name: 'Tranquility', role: 'healer' },
    { id: 33891, name: 'Incarnation: Tree of Life', role: 'healer' },
    { id: 197721, name: 'Flourish', role: 'healer' },
  ],
  Evoker: [
    { id: 375087, name: 'Dragonrage' },
    { id: 357210, name: 'Deep Breath' },
    { id: 403631, name: 'Breath of Eons' },
    { id: 363534, name: 'Rewind', role: 'healer' },
    { id: 359816, name: 'Dream Flight', role: 'healer' },
    { id: 370960, name: 'Emerald Communion', role: 'healer' },
    { id: 370537, name: 'Stasis', role: 'healer' },
  ],
  Hunter: [
    { id: 288613, name: 'Trueshot' },
    { id: 19574, name: 'Bestial Wrath' },
    { id: 359844, name: 'Call of the Wild' },
    { id: 360952, name: 'Coordinated Assault' },
    { id: 203415, name: 'Fury of the Eagle' },
  ],
  Mage: [
    { id: 190319, name: 'Combustion' },
    { id: 12472, name: 'Icy Veins' },
    { id: 365350, name: 'Arcane Surge' },
  ],
  Monk: [
    { id: 123904, name: 'Invoke Xuen, the White Tiger' },
    { id: 137639, name: 'Storm, Earth, and Fire' },
    { id: 152173, name: 'Serenity' },
    { id: 115310, name: 'Revival', role: 'healer' },
    { id: 322118, name: "Invoke Yu'lon, the Jade Serpent", role: 'healer' },
    { id: 325197, name: 'Invoke Chi-Ji, the Red Crane', role: 'healer' },
  ],
  Paladin: [
    { id: 31884, name: 'Avenging Wrath' },
    { id: 231895, name: 'Crusade' },
    { id: 343721, name: 'Final Reckoning' },
    { id: 31821, name: 'Aura Mastery', role: 'healer' },
    { id: 216331, name: 'Avenging Crusader', role: 'healer' },
  ],
  Priest: [
    { id: 228260, name: 'Voidform' },
    { id: 391109, name: 'Dark Ascension' },
    { id: 10060, name: 'Power Infusion' },
    { id: 64843, name: 'Divine Hymn', role: 'healer' },
    { id: 200183, name: 'Apotheosis', role: 'healer' },
    { id: 62618, name: 'Power Word: Barrier', role: 'healer' },
    { id: 47536, name: 'Rapture', role: 'healer' },
    { id: 246287, name: 'Evangelism', role: 'healer' },
  ],
  Rogue: [
    { id: 360194, name: 'Deathmark' },
    { id: 385627, name: 'Kingsbane' },
    { id: 13750, name: 'Adrenaline Rush' },
    { id: 121471, name: 'Shadow Blades' },
    { id: 51690, name: 'Killing Spree' },
  ],
  Shaman: [
    { id: 114050, name: 'Ascendance' },
    { id: 114051, name: 'Ascendance' },
    { id: 198067, name: 'Fire Elemental' },
    { id: 192249, name: 'Storm Elemental' },
    { id: 51533, name: 'Feral Spirit' },
    { id: 384352, name: 'Doom Winds' },
    { id: 114052, name: 'Ascendance', role: 'healer' },
    { id: 98008, name: 'Spirit Link Totem', role: 'healer' },
    { id: 108280, name: 'Healing Tide Totem', role: 'healer' },
  ],
  Warlock: [
    { id: 205180, name: 'Summon Darkglare' },
    { id: 265187, name: 'Summon Demonic Tyrant' },
    { id: 1122, name: 'Summon Infernal' },
    { id: 442726, name: 'Malevolence' },
  ],
  Warrior: [
    { id: 107574, name: 'Avatar' },
    { id: 1719, name: 'Recklessness' },
    { id: 228920, name: 'Ravager' },
    { id: 227847, name: 'Bladestorm' },
    { id: 436358, name: 'Demolish' },
  ],
};

/** Raciais ofensivas: entram como cooldown de dano de qualquer classe. */
const RACIALS: Cd[] = [
  { id: 20572, name: 'Blood Fury' },
  { id: 26297, name: 'Berserking' },
  { id: 265221, name: 'Fireblood' },
  { id: 274738, name: 'Ancestral Call' },
];

/** Poções de combate cujo nome não diz "potion". */
export const COMBAT_POTION_NAMES = ["Light's Potential", 'Potion of Recklessness', 'Tempered Potion', 'Potion of Unwavering Focus'];

const norm = (s: string) => s.toLocaleLowerCase('en');

/** É um cooldown maior de dano (ou de cura, para healer) desta classe? */
export function isMajorCooldown(cls: string | null | undefined, role: string | null | undefined, spellId: number, name: string): boolean {
  const r: Role = role === 'healer' ? 'healer' : 'dps';
  const list = [...(cls ? (CDS[cls] ?? []) : []), ...(r === 'dps' ? RACIALS : [])].filter((c) => !c.role || c.role === r);
  const n = norm(name);
  return list.some((c) => c.id === spellId || norm(c.name) === n);
}

/** A classe tem lista de cooldowns? (senão, cai no padrão de uso) */
export const knowsClass = (cls: string | null | undefined) => !!cls && cls in CDS;
