// Métricas que o grupo escolhe para o resumo do boss: qualquer mecânica avaliada pelas regras,
// somada na noite (falhas pull a pull, quem errou e quem ajudou). A escolha fica salva por boss.
// Boss com fantasmas que andam quando o alvo dá as costas (gaze): também as jardas que o fantasma
// de cada um andou na noite (`<mecânica>:yards`).

import type { MechanicResult, MechanicSeverity, Pull } from '../types';
import { mechanicMistakes, mistakes } from './blame';

export interface MetricOption {
  key: string;
  name: string;
  spellId: number | null;
  kind: string;
  severity: MechanicSeverity;
  /** falhas na noite e em quantos pulls */
  failures: number;
  pullsWithFailure: number;
  /** métrica em jardas (fantasmas): `amount` = jardas na noite, `pullsWithFailure` = pulls com fantasma */
  unit?: 'yd';
  amount?: number;
}

export interface MetricPlayer {
  guid: string;
  name: string;
  class: string | null;
  /** erros na noite (stack_limit: pulls em que passou do limite) */
  count: number;
  /** pulls em que errou */
  pulls: number;
  /** stack_limit: mais stacks que chegou a ter; jardas: quantos fantasmas teve */
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
  /** jardas (fantasmas): `total` e `failures` de cada pull em jardas; `count` de cada um em jardas */
  unit?: 'yd';
}

const YARDS = ':yards';

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
      o.failures += mechanicMistakes(m);
      if (m.failures > 0) o.pullsWithFailure++;
    }
  }
  const out = [...byKey.values()].sort((a, b) => b.failures - a.failures || (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || a.name.localeCompare(b.name));
  // as jardas dos fantasmas logo depois das que falharam (não no fim, entre as que nunca falharam)
  const clean = out.findIndex((o) => o.failures === 0);
  const at = clean < 0 ? out.length : clean;
  return [...out.slice(0, at), ...yardOptions(pulls), ...out.slice(at)];
}

/** As jardas que os fantasmas andaram (uma opção por mecânica com fantasmas). */
function yardOptions(pulls: Pull[]): MetricOption[] {
  const byKey = new Map<string, MetricOption>();
  for (const p of pulls) {
    for (const m of p.mechanics) {
      const g = m.ghostYards;
      if (!g?.players.length) continue;
      const key = m.key + YARDS;
      const o = byKey.get(key) ?? byKey.set(key, { key, name: g.name, spellId: g.spellId, kind: m.kind, severity: m.severity, failures: 0, pullsWithFailure: 0, unit: 'yd', amount: 0 }).get(key)!;
      o.amount! += g.players.reduce((s, x) => s + x.yards, 0);
      o.pullsWithFailure++;
    }
  }
  return [...byKey.values()].map((o) => ({ ...o, amount: Math.round(o.amount!) }));
}

/** Jardas que o fantasma de cada um andou na noite: quem deixou andar mais primeiro. */
function yardsNight(pulls: Pull[], key: string): MetricNight | null {
  const mechKey = key.slice(0, -YARDS.length);
  let out: MetricNight | null = null;
  const by = new Map<string, MetricPlayer>();
  for (const pull of pulls) {
    const m = pull.mechanics.find((x) => x.key === mechKey);
    const g = m?.ghostYards;
    if (!m || !g) continue;
    out ??= {
      key, name: g.name, spellId: g.spellId, kind: m.kind, severity: m.severity, tip: m.tip,
      collective: false, perPull: [], total: 0, pullsWithFailure: 0, players: [], helpers: [], unit: 'yd',
    };
    const yards = g.players.reduce((s, x) => s + x.yards, 0);
    out.perPull.push({ pull, failures: Math.round(yards) });
    out.total += yards;
    if (g.players.length) out.pullsWithFailure++;
    const cls = new Map(pull.players.map((x) => [x.guid, x.class]));
    for (const x of g.players) {
      const p = by.get(x.guid) ?? by.set(x.guid, { guid: x.guid, name: x.name, class: null, count: 0, pulls: 0, max: 0 }).get(x.guid)!;
      p.class ??= cls.get(x.guid) ?? null;
      p.count += x.yards;
      p.pulls++;
      p.max += x.ghosts;
    }
  }
  if (!out) return null;
  out.total = Math.round(out.total);
  out.players = [...by.values()]
    .map((p) => ({ ...p, count: Math.round(p.count) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return out;
}

/** Uma mecânica somada na noite do boss; null se ela não aparece em nenhum pull. */
export function metricNight(pulls: Pull[], key: string): MetricNight | null {
  if (key.endsWith(YARDS)) return yardsNight(pulls, key);
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
    out.perPull.push({ pull, failures: mechanicMistakes(m) });
    out.total += mechanicMistakes(m);
    if (m.failures > 0) out.pullsWithFailure++;
    const cls = new Map(pull.players.map((x) => [x.guid, x.class]));
    for (const mp of m.players) {
      const map = mp.credit ? helps : errs;
      const p = map.get(mp.guid) ?? map.set(mp.guid, { guid: mp.guid, name: mp.name, class: null, count: 0, pulls: 0, max: 0 }).get(mp.guid)!;
      p.class ??= cls.get(mp.guid) ?? null;
      p.count += m.kind === 'stack_limit' && !mp.credit ? 1 : mp.credit ? mp.count : mistakes(mp);
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
