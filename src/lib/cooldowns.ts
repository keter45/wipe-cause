// Cooldowns maiores de dano (e de cura, para healers) por classe: os que abrem uma janela de
// burst. Casa por spell ID ou pelo nome (o log e o Warcraft Logs às vezes usam IDs diferentes).
// Utilidades (Wind Rush Totem, Capacitor Totem, movimento) ficam de fora de propósito; os
// cooldowns menores (20-60s: Stormkeeper, Frozen Orb, Colossus Smash) estão em MINOR: não abrem
// janela de burst, mas o uso deles é comparado com a referência.

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

/**
 * Cooldowns menores (ou de cura pessoal, como Ancestral Guidance) que valem acompanhar: quantas
 * vezes foram usados contra a referência. `cd` = recarga base em segundos (talentos podem reduzir:
 * vale o menor entre ela e o intervalo visto).
 */
const MINOR: Record<string, (Cd & { cd: number })[]> = {
  DeathKnight: [
    { id: 439843, name: "Reaper's Mark", cd: 45 },
    { id: 305392, name: 'Chill Streak', cd: 45 },
    { id: 390279, name: 'Vile Contagion', cd: 45 },
    { id: 207289, name: 'Unholy Assault', cd: 90 },
    { id: 196770, name: 'Remorseless Winter', cd: 20 },
  ],
  DemonHunter: [
    { id: 198013, name: 'Eye Beam', cd: 40 },
    { id: 258860, name: 'Essence Break', cd: 40 },
    { id: 258925, name: 'Fel Barrage', cd: 90 },
    { id: 390163, name: 'Sigil of Spite', cd: 60 },
  ],
  Druid: [
    { id: 202770, name: 'Fury of Elune', cd: 60 },
    { id: 205636, name: 'Force of Nature', cd: 60 },
    { id: 202425, name: 'Warrior of Elune', cd: 45 },
    { id: 5217, name: "Tiger's Fury", cd: 30 },
    { id: 274837, name: 'Feral Frenzy', cd: 45 },
    { id: 132158, name: "Nature's Swiftness", cd: 60, role: 'healer' },
  ],
  Evoker: [
    { id: 357208, name: 'Fire Breath', cd: 30 },
    { id: 359073, name: 'Eternity Surge', cd: 30 },
    { id: 370452, name: 'Shattering Star', cd: 20 },
    { id: 370553, name: 'Tip the Scales', cd: 120 },
    { id: 396286, name: 'Upheaval', cd: 40 },
  ],
  Hunter: [
    { id: 257044, name: 'Rapid Fire', cd: 20 },
    { id: 212431, name: 'Explosive Shot', cd: 30 },
    { id: 260243, name: 'Volley', cd: 45 },
    { id: 321530, name: 'Bloodshed', cd: 60 },
    { id: 120679, name: 'Dire Beast', cd: 20 },
  ],
  Mage: [
    { id: 321507, name: 'Touch of the Magi', cd: 45 },
    { id: 12051, name: 'Evocation', cd: 90 },
    { id: 153626, name: 'Arcane Orb', cd: 20 },
    { id: 84714, name: 'Frozen Orb', cd: 60 },
    { id: 153595, name: 'Comet Storm', cd: 30 },
    { id: 205021, name: 'Ray of Frost', cd: 60 },
    { id: 153561, name: 'Meteor', cd: 45 },
    { id: 382440, name: 'Shifting Power', cd: 60 },
  ],
  Monk: [
    { id: 113656, name: 'Fists of Fury', cd: 24 },
    { id: 392983, name: 'Strike of the Windlord', cd: 40 },
    { id: 152175, name: 'Whirling Dragon Punch', cd: 24 },
    { id: 322109, name: 'Touch of Death', cd: 90 },
    { id: 443028, name: 'Celestial Conduit', cd: 90 },
    { id: 116680, name: 'Thunder Focus Tea', cd: 30, role: 'healer' },
  ],
  Paladin: [
    { id: 255937, name: 'Wake of Ashes', cd: 30 },
    { id: 375576, name: 'Divine Toll', cd: 60 },
    { id: 343527, name: 'Execution Sentence', cd: 30 },
    { id: 414170, name: 'Daybreak', cd: 60, role: 'healer' },
  ],
  Priest: [
    { id: 263165, name: 'Void Torrent', cd: 30 },
    { id: 200174, name: 'Mindbender', cd: 60 },
    { id: 34433, name: 'Shadowfiend', cd: 180 },
    { id: 120644, name: 'Halo', cd: 60 },
    { id: 265202, name: 'Holy Word: Salvation', cd: 360, role: 'healer' },
    { id: 421453, name: 'Ultimate Penitence', cd: 240, role: 'healer' },
  ],
  Rogue: [
    { id: 5938, name: 'Shiv', cd: 25 },
    { id: 1856, name: 'Vanish', cd: 120 },
    { id: 185313, name: 'Shadow Dance', cd: 60 },
    { id: 212283, name: 'Symbols of Death', cd: 30 },
    { id: 280719, name: 'Secret Technique', cd: 45 },
    { id: 385616, name: 'Echoing Reprimand', cd: 45 },
  ],
  Shaman: [
    { id: 191634, name: 'Stormkeeper', cd: 60 },
    { id: 108281, name: 'Ancestral Guidance', cd: 120 },
    { id: 443454, name: 'Ancestral Swiftness', cd: 30 },
    { id: 378081, name: "Nature's Swiftness", cd: 60 },
    { id: 375982, name: 'Primordial Wave', cd: 45 },
    { id: 197214, name: 'Sundering', cd: 40 },
    { id: 157153, name: 'Cloudburst Totem', cd: 30, role: 'healer' },
  ],
  Warlock: [
    { id: 386997, name: 'Soul Rot', cd: 60 },
    { id: 205179, name: 'Phantom Singularity', cd: 45 },
    { id: 278350, name: 'Vile Taint', cd: 30 },
    { id: 111898, name: 'Grimoire: Felguard', cd: 120 },
    { id: 104316, name: 'Call Dreadstalkers', cd: 20 },
    { id: 264119, name: 'Summon Vilefiend', cd: 30 },
    { id: 196447, name: 'Channel Demonfire', cd: 25 },
    { id: 152108, name: 'Cataclysm', cd: 30 },
  ],
  Warrior: [
    { id: 167105, name: 'Colossus Smash', cd: 45 },
    { id: 262161, name: 'Warbreaker', cd: 45 },
    { id: 384318, name: 'Thunderous Roar', cd: 90 },
    { id: 376079, name: "Champion's Spear", cd: 90 },
    { id: 385059, name: "Odyn's Fury", cd: 45 },
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

/**
 * Cooldown da lista da classe (maior ou menor): sempre entra na comparação de cooldowns, mesmo com
 * recarga curta ou pouco uso. `cdMs` = recarga base, quando conhecida.
 */
export function listedCooldown(cls: string | null | undefined, role: string | null | undefined, spellId: number, name: string): { cdMs: number | null } | null {
  if (isMajorCooldown(cls, role, spellId, name)) return { cdMs: null };
  const r: Role = role === 'healer' ? 'healer' : 'dps';
  const n = norm(name);
  const hit = (cls ? (MINOR[cls] ?? []) : []).find((c) => (!c.role || c.role === r) && (c.id === spellId || norm(c.name) === n));
  return hit ? { cdMs: hit.cd * 1000 } : null;
}
