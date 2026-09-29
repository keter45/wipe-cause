// Ícone de qualquer habilidade citada na tela: mecânicas das regras (pela key ou pelo nome),
// golpes finais, habilidades do boss, defensivos e debuffs. O combat log só traz o id do
// spell; o ícone vem do Wowhead pelo id.

import type { Pull } from '../types';

/** Spell que representa a mecânica `key` (a primeira ocorrência nos pulls). */
export function mechanicSpellId(pulls: Pull | Pull[], key: string | null | undefined): number | null {
  if (!key) return null;
  for (const p of Array.isArray(pulls) ? pulls : [pulls]) {
    const m = p.mechanics.find((x) => x.key === key);
    if (m?.spellId != null) return m.spellId;
  }
  return null;
}

/** mecânica (key) -> spell, de vários pulls. */
export function mechanicSpellMap(pulls: Pull[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pulls) for (const m of p.mechanics) if (m.spellId != null && !out.has(m.key)) out.set(m.key, m.spellId);
  return out;
}

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('en');

/**
 * Nome (em minúsculas) -> spell de tudo o que aparece no pull: para achar ícones de nomes
 * soltos num texto (ex.: respostas da IA).
 */
export function spellIndex(p: Pull): Map<string, number> {
  const out = new Map<string, number>();
  const add = (name: string | null | undefined, id: number | null | undefined) => {
    if (!name || id == null || id <= 1 || name.length < 4) return; // 0/1 = ambiente/melee
    const k = norm(name);
    if (!out.has(k)) out.set(k, id);
  };
  for (const m of p.mechanics) add(m.name, m.spellId);
  for (const e of p.enemySpells) add(e.name, e.spellId);
  for (const d of p.deaths) {
    add(d.killingBlow?.spellName, d.killingBlow?.spellId);
    for (const a of d.debuffs) add(a.name, a.spellId);
    for (const a of d.defensivesAvailable) add(a.name, a.spellId);
    for (const a of d.defensivesRecent) add(a.name, a.spellId);
  }
  for (const x of p.players) for (const u of x.defensivesUsed) add(u.name, u.spellId);
  return out;
}

/** Nome de mecânica ou spell -> id, procurando nas mecânicas pelo nome e depois no índice. */
export function spellIdByName(p: Pull, name: string | null | undefined): number | null {
  if (!name) return null;
  const m = p.mechanics.find((x) => x.name === name);
  if (m?.spellId != null) return m.spellId;
  return spellIndex(p).get(norm(name)) ?? null;
}
