// Ordem dos bosses na raide (a do Encounter Journal, como o Warcraft Logs lista a zona), para as
// listas por boss seguirem a raide em vez da quantidade de pulls.

/** The Venomous Abyss (zona 53 do WCL), do primeiro ao último boss. */
const VENOMOUS_ABYSS = [3470, 3445, 3455, 3497, 3420, 3421, 3429, 3492, 3379, 3513];

const ORDER = new Map(VENOMOUS_ABYSS.map((id, i) => [id, i] as const));

/** Posição do boss na raide; boss de outra raide (ou desconhecido) vem depois. */
export const raidOrder = (encounterId: number): number => ORDER.get(encounterId) ?? Number.MAX_SAFE_INTEGER;

/** Mythic, Heroic, Normal, LFR; o resto (masmorra, evento) por último. */
const DIFFICULTY_RANK: Record<number, number> = { 16: 0, 15: 1, 14: 2, 17: 3 };
export const difficultyRank = (difficultyId: number): number => DIFFICULTY_RANK[difficultyId] ?? 9;
