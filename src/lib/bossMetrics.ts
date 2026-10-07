// Métricas que o grupo escolhe para o resumo do boss: qualquer mecânica avaliada pelas regras,
// somada na noite (falhas pull a pull, quem errou e quem ajudou). A escolha fica salva por boss.

import type { MechanicResult, MechanicSeverity, Pull } from '../types';

export interface MetricOption {
  key: string;
  name: string;
  spellId: number | null;
  kind: string;
  severity: MechanicSeverity;
  /** falhas na noite e em quantos pulls */
  failures: number;
  pullsWithFailure: number;
}

export interface MetricPlayer {
  guid: string;
  name: string;
  class: string | null;
  /** erros na noite (stack_limit: pulls em que passou do limite) */
  count: number;
  /** pulls em que errou */
  pulls: number;
  /** stack_limit: mais stacks que chegou a ter */
  max: number;
}

export interface MetricNight {
  key: string;
  name: string;
  spellId: number | null;
  kind: string;
  severity: MechanicSeverity;
  tip: MechanicResult['tip'];
  /** falha do raid (soak, interrupt, enrage...) em vez de erro de cada um */
  collective: boolean;
  /** cada pull em que a mecânica foi avaliada, em ordem */
  perPull: { pull: Pull; failures: number }[];
  total: number;
  pullsWithFailure: number;
  /** quem errou, quem mais errou primeiro */
  players: MetricPlayer[];
  /** quem ajudou (soak, interrupt, dispel), quem mais ajudou primeiro */
  helpers: MetricPlayer[];
}

/** Tipos que já têm painel próprio no resumo ou não são avaliados. */
const SKIP = new Set(['phase_duration', 'unavoidable', 'info']);
const COLLECTIVE = new Set(['soak', 'tank_soak', 'interrupt', 'enrage', 'hp_balance', 'failure_event', 'dispel']);
const RANK: Record<string, number> = { wipe: 0, major: 1, minor: 2, none: 3 };

const eligible = (m: MechanicResult) => m.evaluated && !SKIP.has(m.kind);

/** Mecânicas que dá para acompanhar neste boss: as que mais falharam na noite primeiro. */
export function metricOptions(pulls: Pull[]): MetricOption[] {
  const byKey = new Map<string, MetricOption>();
  for (const p of pulls) {
    for (const m of p.mechanics) {
      if (!eligible(m)) continue;
      const o =
        byKey.get(m.key) ??
        byKey.set(m.key, { key: m.key, name: m.name, spellId: m.spellId, kind: m.kind, severity: m.severity, failures: 0, pullsWithFailure: 0 }).get(m.key)!;
      o.failures += m.failures;
      if (m.failures > 0) o.pullsWithFailure++;
    }
  }
  return [...byKey.values()].sort((a, b) => b.failures - a.failures || (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || a.name.localeCompare(b.name));
}

/** Uma mecânica somada na noite do boss; null se ela não aparece em nenhum pull. */
export function metricNight(pulls: Pull[], key: string): MetricNight | null {
  let out: MetricNight | null = null;
  const errs = new Map<string, MetricPlayer>();
  const helps = new Map<string, MetricPlayer>();
  for (const pull of pulls) {
    const m = pull.mechanics.find((x) => x.key === key);
    if (!m) continue;
    out ??= {
      key: m.key, name: m.name, spellId: m.spellId, kind: m.kind, severity: m.severity, tip: m.tip,
      collective: COLLECTIVE.has(m.kind), perPull: [], total: 0, pullsWithFailure: 0, players: [], helpers: [],
    };
    out.perPull.push({ pull, failures: m.failures });
    out.total += m.failures;
    if (m.failures > 0) out.pullsWithFailure++;
    const cls = new Map(pull.players.map((x) => [x.guid, x.class]));
    for (const mp of m.players) {
      const map = mp.credit ? helps : errs;
      const p = map.get(mp.guid) ?? map.set(mp.guid, { guid: mp.guid, name: mp.name, class: null, count: 0, pulls: 0, max: 0 }).get(mp.guid)!;
      p.class ??= cls.get(mp.guid) ?? null;
      p.count += m.kind === 'stack_limit' && !mp.credit ? 1 : mp.count;
      p.pulls++;
      p.max = Math.max(p.max, mp.count);
    }
  }
  if (!out) return null;
  const order = (a: MetricPlayer, b: MetricPlayer) => b.count - a.count || b.pulls - a.pulls || a.name.localeCompare(b.name);
  out.players = [...errs.values()].sort(order);
  out.helpers = [...helps.values()].sort(order);
  return out;
}

const KEY = 'wipe-cause:boss-metrics:';

/** Mecânicas escolhidas para o resumo deste boss, na ordem do usuário. */
export function savedBossMetrics(encounterId: number): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY + encounterId) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveBossMetrics(encounterId: number, keys: string[]) {
  try {
    localStorage.setItem(KEY + encounterId, JSON.stringify(keys));
  } catch {
    /* vale só nesta sessão */
  }
}

/** Move uma métrica uma posição para a frente (-1) ou para trás (+1). */
export function moveMetric(keys: string[], key: string, dir: -1 | 1): string[] {
  const i = keys.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return keys;
  const out = [...keys];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
