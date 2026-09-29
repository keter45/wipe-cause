// Nota de 0 a 100 por player e pull (inspirada no Wipefest): parte de 100, perde pontos por
// erros de mecânica (pela gravidade), por deixar passar a própria vez na escala de interrupts
// e por morte decisiva; no fim, pesa o tempo vivo até a primeira morte.

import type { Pull } from '../types';
import { assignmentsFor, checkAssignments, type Assignments } from './assignments';
import { mmss, shortName } from './format';
import { PERSONAL_BLAME } from './blame';
import { analyzePull } from './verdict';

/** Desconto por erro, pela gravidade da regra. */
const PENALTY: Record<string, number> = { wipe: 25, major: 12, minor: 4, none: 0 };
/** Erros contados por mecânica (quem pisa 20× na poça não perde 80 pontos por uma mecânica só). */
const MAX_PER_MECHANIC = 3;
const MISSED_KICK = 10;
const DECISIVE_DEATH = 15;
const DEATH_WITH_DEFENSIVE = 10;

export interface PlayerScore {
  score: number;
  /** motivos dos descontos, para o tooltip */
  parts: string[];
}

export function scorePull(p: Pull, assignments: Assignments = assignmentsFor(p)): Map<string, PlayerScore> {
  const out = new Map<string, PlayerScore>();
  const verdict = analyzePull(p, assignments);
  const decisive = new Set(verdict.decisiveDeaths.map((d) => `${d.guid}:${d.t}`));
  const byName = new Map(p.players.map((x) => [shortName(x.name), x.guid]));
  const penalties = new Map<string, { total: number; parts: string[] }>();
  const add = (guid: string, pts: number, why: string) => {
    const e = penalties.get(guid) ?? { total: 0, parts: [] };
    e.total += pts;
    e.parts.push(`−${pts} ${why}`);
    penalties.set(guid, e);
  };

  for (const m of p.mechanics) {
    if (!PERSONAL_BLAME.has(m.kind)) continue;
    const per = PENALTY[m.severity] ?? 0;
    if (!per) continue;
    for (const mp of m.players) {
      if (mp.credit) continue;
      const n = m.kind === 'stack_limit' ? 1 : Math.min(mp.count, MAX_PER_MECHANIC);
      add(mp.guid, n * per, `${m.name}${n > 1 ? ` (${n}×)` : ''}`);
    }
  }

  for (const m of p.mechanics.filter((m) => m.kind === 'interrupt')) {
    const groups = assignments.get(m.key);
    if (!groups?.length) continue;
    for (const k of checkAssignments(m, groups).kickers) {
      const guid = byName.get(k.name);
      if (guid && k.missed) add(guid, k.missed * MISSED_KICK, `${m.name} passou na vez (${k.missed}×)`);
    }
  }

  const firstDeath = new Map<string, number>();
  for (const d of p.deaths) {
    if (d.ignored) continue;
    if (!firstDeath.has(d.guid)) firstDeath.set(d.guid, d.t);
    if (!decisive.has(`${d.guid}:${d.t}`)) continue;
    add(d.guid, DECISIVE_DEATH, `morte decisiva aos ${mmss(d.t)}`);
    if (d.defensivesRecent.length === 0 && d.defensivesAvailable.length > 0) add(d.guid, DEATH_WITH_DEFENSIVE, 'morreu com defensivo sobrando');
  }

  const span = Math.max(1, p.analyzedMs ?? p.durationMs);
  for (const x of p.players) {
    const pen = penalties.get(x.guid);
    const died = firstDeath.get(x.guid);
    const alive = died != null ? Math.min(1, died / span) : 1;
    const factor = 0.5 + 0.5 * alive;
    const parts = [...(pen?.parts ?? [])];
    if (died != null) parts.push(`vivo ${Math.round(alive * 100)}% do pull (×${factor.toFixed(2).replace('.', ',')})`);
    const score = Math.round(Math.max(0, 100 - (pen?.total ?? 0)) * factor);
    out.set(x.guid, { score: Math.max(0, Math.min(100, score)), parts });
  }
  return out;
}

/** Faixa da nota (cor): boa, média ou ruim. */
export const scoreTone = (s: number) => (s >= 80 ? 'good' : s >= 50 ? 'mid' : 'bad');
