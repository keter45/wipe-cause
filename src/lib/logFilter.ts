// Filtro da lista de noites por boss (e dificuldade) e por guilda x pug, com a escolha lembrada
// entre aberturas.

import type { Night } from './nights';

export interface BossOption {
  encounterId: number;
  name: string;
  /** noites com o boss (em qualquer dificuldade) */
  nights: number;
  /** dificuldades em que o boss aparece (id do jogo), da maior para a menor */
  difficulties: number[];
  /** noite mais recente com o boss (para ordenar: o que está em progressão vem primeiro) */
  lastMs: number;
}

/** Raid da guilda, pug (outros personagens com gente aleatória) ou tudo: ver roster.ts. */
export type LogGroup = 'guild' | 'pug' | 'all';

export interface LogFilter {
  encounterId: number | null;
  difficultyId: number | null;
  group: LogGroup;
}

/** O boss da noite entra neste grupo? Sem como saber (null) conta como guilda. */
export const inGroup = (b: { guild: boolean | null }, g: LogGroup) => g === 'all' || (g === 'guild' ? b.guild !== false : b.guild === false);

/** Bosses de raid que aparecem nas noites (no grupo escolhido), o mais recente primeiro. */
export function bossOptions(nights: Night[], group: LogGroup = 'all'): BossOption[] {
  const byId = new Map<number, BossOption>();
  for (const n of nights) {
    const rows = n.bosses.filter((b) => inGroup(b, group));
    for (const b of rows) {
      const o = byId.get(b.encounterId) ?? byId.set(b.encounterId, { encounterId: b.encounterId, name: b.name, nights: 0, difficulties: [], lastMs: 0 }).get(b.encounterId)!;
      if (!o.difficulties.includes(b.difficultyId)) o.difficulties.push(b.difficultyId);
      o.lastMs = Math.max(o.lastMs, n.startMs);
    }
    for (const id of new Set(rows.map((b) => b.encounterId))) byId.get(id)!.nights++;
  }
  for (const o of byId.values()) o.difficulties.sort((a, b) => b - a);
  return [...byId.values()].sort((a, b) => b.lastMs - a.lastMs || a.name.localeCompare(b.name));
}

/** O boss (e a dificuldade, se escolhida) está nesta noite? */
export const matchesBoss = (b: { encounterId: number; difficultyId: number }, f: LogFilter) =>
  f.encounterId == null || (b.encounterId === f.encounterId && (f.difficultyId == null || b.difficultyId === f.difficultyId));

/** Noites com algum boss do grupo (e do boss escolhido); noite ainda sem boss lido fica fora só no pug. */
export const filterNights = (nights: Night[], f: LogFilter): Night[] =>
  nights.filter((n) => (n.bosses.length === 0 ? f.group !== 'pug' && f.encounterId == null : n.bosses.some((b) => inGroup(b, f.group) && matchesBoss(b, f))));

const KEY = 'wipe-cause:logs-filter';

export function savedLogFilter(): LogFilter {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') return { encounterId: Number(v.encounterId) || null, difficultyId: Number(v.difficultyId) || null, group: ['guild', 'pug', 'all'].includes(v.group) ? v.group : 'guild' };
  } catch {
    /* sem storage ou valor antigo */
  }
  return { encounterId: null, difficultyId: null, group: 'guild' };
}

export function saveLogFilter(f: LogFilter) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* vale só nesta sessão */
  }
}
