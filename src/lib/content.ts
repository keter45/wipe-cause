// Raid x masmorra: o app é para raid. Encontros de masmorra (M+, delve…) ficam num
// compartimento menor e não entram no resumo da noite, na Evolução nem no Discord.

/** Dificuldades de masmorra (normal, heroica, mítica, M+, timewalking, follower, delve). */
const DUNGEON_DIFFICULTIES = new Set([1, 2, 8, 23, 24, 150, 205, 208]);

interface Encounterish {
  difficultyId: number;
  groupSize?: number;
  /** vem do núcleo; análises antigas não têm */
  dungeon?: boolean;
}

export function isDungeon(p: Encounterish): boolean {
  if (p.dungeon != null) return p.dungeon;
  return DUNGEON_DIFFICULTIES.has(p.difficultyId) || (p.groupSize != null && p.groupSize >= 1 && p.groupSize <= 5);
}

export const raidOnly = <T extends Encounterish>(xs: T[]): T[] => xs.filter((x) => !isDungeon(x));
export const dungeonsOnly = <T extends Encounterish>(xs: T[]): T[] => xs.filter((x) => isDungeon(x));
