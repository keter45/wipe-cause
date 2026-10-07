// Nota de 0 a 100 por player e pull (inspirada no Wipefest): parte de 100, perde pontos por
// erros de mecânica (pela gravidade; dano evitável de tank pesa metade), por deixar passar a própria vez na escala de interrupts
// e por morte decisiva; no fim, pesa o tempo vivo até a primeira morte. Mortes num "wipe geral"
// (mais de 5 juntas) não contam: são consequência do wipe, não erro de cada um.

import type { Pull } from '../types';
import { assignmentsFor, checkAssignments, type Assignments } from './assignments';
import { mmss, shortName } from './format';
import { blameFactor, PERSONAL_BLAME } from './blame';
import { analyzePull } from './verdict';
import { deathKey, massDeathKeys, MASS_DEATH_MIN } from './massDeaths';
import { getMarks } from './marks';
import { messagesOf } from '../i18n';
import { scoreMsg } from './score.i18n';

/** Desconto por erro, pela gravidade da regra. */
const PENALTY: Record<string, number> = { wipe: 25, major: 12, minor: 4, none: 0 };
/** Mecânica de foco pesa mais: é o que está segurando a progressão. */
const FOCUS_MULTIPLIER = 1.5;
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
  const t = messagesOf(scoreMsg);
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

  const roleOf = new Map(p.players.map((x) => [x.guid, x.role]));
  for (const m of p.mechanics) {
    if (!PERSONAL_BLAME.has(m.kind)) continue;
    const base = (PENALTY[m.severity] ?? 0) * (m.focus ? FOCUS_MULTIPLIER : 1);
    if (!base) continue;
    for (const mp of m.players) {
      if (mp.credit) continue;
      const factor = blameFactor(m, roleOf.get(mp.guid));
      const per = Math.round(base * factor);
      const n = m.kind === 'stack_limit' ? 1 : Math.min(mp.count, MAX_PER_MECHANIC);
      add(mp.guid, n * per, `${m.focus ? '★ ' : ''}${m.name}${n > 1 ? ` (${n}×)` : ''}${factor < 1 ? ` ${t.tankHalf}` : ''}`);
    }
  }

  // erros marcados à mão contam como um erro da gravidade escolhida
  for (const mk of getMarks(p)) add(mk.guid, PENALTY[mk.severity], `✎ ${mk.what}`);

  for (const m of p.mechanics.filter((m) => m.kind === 'interrupt')) {
    const groups = assignments.get(m.key);
    if (!groups?.length) continue;
    for (const k of checkAssignments(m, groups).kickers) {
      const guid = byName.get(k.name);
      if (guid && k.missed) add(guid, k.missed * MISSED_KICK, t.missedTurn(m.name, k.missed));
    }
  }

  const firstDeath = new Map<string, number>();
  const mass = massDeathKeys(p.deaths);
  const massNote = new Map<string, string>();
  for (const d of p.deaths) {
    if (d.ignored) continue;
    if (mass.has(deathKey(d))) {
      massNote.set(d.guid, t.massDeath(mmss(d.t), MASS_DEATH_MIN));
      continue;
    }
    if (!firstDeath.has(d.guid)) firstDeath.set(d.guid, d.t);
    if (!decisive.has(`${d.guid}:${d.t}`)) continue;
    add(d.guid, DECISIVE_DEATH, t.decisiveDeath(mmss(d.t)));
    if (d.defensivesRecent.length === 0 && d.defensivesAvailable.length > 0) add(d.guid, DEATH_WITH_DEFENSIVE, t.withDefensive);
  }

  const span = Math.max(1, p.analyzedMs ?? p.durationMs);
  for (const x of p.players) {
    const pen = penalties.get(x.guid);
    const died = firstDeath.get(x.guid);
    const alive = died != null ? Math.min(1, died / span) : 1;
    const factor = 0.5 + 0.5 * alive;
    const parts = [...(pen?.parts ?? [])];
    if (died != null) parts.push(t.alive(Math.round(alive * 100), factor));
    const note = massNote.get(x.guid);
    if (note && died == null) parts.push(note);
    const score = Math.round(Math.max(0, 100 - (pen?.total ?? 0)) * factor);
    out.set(x.guid, { score: Math.max(0, Math.min(100, score)), parts });
  }
  return out;
}

/** Faixa da nota (cor): boa, média ou ruim. */
export const scoreTone = (s: number) => (s >= 80 ? 'good' : s >= 50 ? 'mid' : 'bad');
