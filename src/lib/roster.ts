// Raid da guilda x pug: o mesmo PC grava a raid da guilda e as raids com outros personagens e gente
// aleatória. O que separa as duas é quem joga: a guilda tem um núcleo que aparece noite após noite;
// no pug, quase ninguém se repete. Funciona sem o Warcraft Logs, só com os logs (por GUID do personagem).

/** Personagem do núcleo: esteve em pelo menos isso de noites diferentes. */
export const CORE_NIGHTS = 3;
/** Grupo da guilda: pelo menos isso dos players são do núcleo (medido: guilda 77–100%, pug 5–20%). */
export const GUILD_SHARE = 0.5;
/** Com menos noites que isso não dá para saber quem é do núcleo: tudo conta como guilda. */
const MIN_NIGHTS = CORE_NIGHTS + 1;

export interface Roster {
  core: Set<string>;
  /** dá para separar (noites suficientes) */
  known: boolean;
}

/** Núcleo da raid a partir dos players de cada noite (um conjunto por noite). */
export function coreRoster(nights: Iterable<string>[]): Roster {
  const count = new Map<string, number>();
  let n = 0;
  for (const night of nights) {
    const unique = new Set(night);
    if (!unique.size) continue;
    n++;
    for (const g of unique) count.set(g, (count.get(g) ?? 0) + 1);
  }
  return { core: new Set([...count].filter(([, c]) => c >= CORE_NIGHTS).map(([g]) => g)), known: n >= MIN_NIGHTS };
}

/** O grupo é da guilda? null = não dá para saber (poucas noites ou ninguém registrado). */
export function isGuildGroup(players: Iterable<string>, roster: Roster): boolean | null {
  const list = [...new Set(players)];
  if (!roster.known || !list.length) return null;
  return list.filter((g) => roster.core.has(g)).length / list.length >= GUILD_SHARE;
}

/** Guilda, pug ou os dois na mesma noite (null = não dá para saber). */
export type NightKind = 'guild' | 'pug' | 'mixed';

export function nightKind(groups: (boolean | null)[]): NightKind | null {
  const known = groups.filter((g): g is boolean => g != null);
  if (!known.length) return null;
  if (known.every(Boolean)) return 'guild';
  if (known.every((g) => !g)) return 'pug';
  return 'mixed';
}
