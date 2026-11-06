// Métricas que o grupo escolhe para o resumo do boss: qualquer mecânica avaliada pelas regras,
// somada na noite (falhas pull a pull, quem errou e quem ajudou). A escolha fica salva por boss.
// Boss com fantasmas que andam quando o alvo dá as costas (gaze): também as jardas que o fantasma
// de cada um andou na noite (`<mecânica>:yards`).

import type { Death, MechanicResult, MechanicSeverity, Pull } from '../types';
import { tr, type Loc } from '../i18n';
import { mechanicMistakes, mistakes } from './blame';
import { deathKey, massDeathKeys } from './massDeaths';
import { groupByBoss } from './night';

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

export interface MetricItem {
  spellId: number | null;
  name: string;
  /** quantas vezes ficou livre sem uso */
  count: number;
  kind: 'defensive' | 'potion' | 'healthstone';
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
  /** dano tomado (avoidable_damage, tank_range, positioning) */
  damage?: number;
  /** mortes sem pot/defensivo: o que estava livre e não foi usado */
  items?: MetricItem[];
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
  perPull: { pull: Pull; failures: number; damage?: number }[];
  total: number;
  pullsWithFailure: number;
  /** dano tomado na noite (avoidable_damage, tank_range, positioning) */
  damage?: number;
  /** quem errou, quem mais errou primeiro */
  players: MetricPlayer[];
  /** quem ajudou (soak, interrupt, dispel), quem mais ajudou primeiro */
  helpers: MetricPlayer[];
  /** jardas (fantasmas): `total` e `failures` de cada pull em jardas; `count` de cada um em jardas */
  unit?: 'yd';
}

const YARDS = ':yards';
/** Mortes com defensivo, poção de vida ou healthstone livres sem uso. */
export const NO_DEFENSIVE = ':nodef';
const HEALTH_POTION_SPELL = 1234768;
const HEALTHSTONE_SPELL = 6262;
const NO_DEFENSIVE_NAME: Loc = { pt: 'Mortes sem pot/defensivo', en: 'Deaths without pot/defensive' };
const NO_DEFENSIVE_TIP: Loc = {
  pt: 'Mortes em que o player tinha um defensivo, poção de vida ou healthstone disponível e não usou. Mortes em wipe geral e depois da call de wipe ficam de fora.',
  en: 'Deaths where the player had a defensive, health potion or healthstone available and did not use it. Mass-wipe deaths and deaths after the wipe call are left out.',
};
const POTION_NAME: Loc = { pt: 'Poção de vida', en: 'Health potion' };
const HEALTHSTONE_NAME: Loc = { pt: 'Healthstone', en: 'Healthstone' };

const itemKey = (i: MetricItem) => `${i.kind}:${i.spellId ?? i.name}`;

/** O que cada morte deixou livre sem usar: defensivos, poção de vida e healthstone. */
function unusedAtDeath(d: Death): MetricItem[] {
  const used = new Set(d.defensivesRecent.map((x) => x.spellId));
  const seen = new Set<number>();
  const out: MetricItem[] = [];
  for (const a of d.defensivesAvailable) {
    if (used.has(a.spellId) || seen.has(a.spellId)) continue;
    seen.add(a.spellId);
    out.push({ spellId: a.spellId, name: a.name, count: 1, kind: 'defensive' });
  }
  if (!d.usedHealthPotion) out.push({ spellId: HEALTH_POTION_SPELL, name: tr(POTION_NAME), count: 1, kind: 'potion' });
  if (d.healthstoneKnown && !d.usedHealthstone) out.push({ spellId: HEALTHSTONE_SPELL, name: tr(HEALTHSTONE_NAME), count: 1, kind: 'healthstone' });
  return out;
}

/** Tipos que já têm painel próprio no resumo ou não são avaliados. */
const SKIP = new Set(['phase_duration', 'unavoidable', 'info']);
const COLLECTIVE = new Set(['soak', 'tank_soak', 'interrupt', 'enrage', 'hp_balance', 'failure_event', 'dispel']);
/** Kinds em que cada hit é erro de quem tomou: `MechanicPlayer.amount` é o dano tomado. */
export const DAMAGE_KINDS = new Set(['avoidable_damage', 'tank_range', 'positioning']);
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
  const noDef = noDefensiveNight(pulls, NO_DEFENSIVE);
  const out = [...byKey.values(), ...(noDef ? [{ key: noDef.key, name: noDef.name, spellId: noDef.spellId, kind: noDef.kind, severity: noDef.severity, failures: noDef.total, pullsWithFailure: noDef.pullsWithFailure }] : [])].sort(
    (a, b) => b.failures - a.failures || (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || a.name.localeCompare(b.name),
  );
  // as jardas dos fantasmas logo depois das que falharam (não no fim, entre as que nunca falharam)
  const clean = out.findIndex((o) => o.failures === 0);
  const at = clean < 0 ? out.length : clean;
  return [...out.slice(0, at), ...yardOptions(pulls), ...out.slice(at)];
}

/** Mortes com algo livre sem uso: total da noite, pulls com morte assim e o detalhe por player. */
function noDefensiveNight(pulls: Pull[], key: string): MetricNight | null {
  let evaluated = false;
  for (const pull of pulls) {
    const mass = massDeathKeys(pull.deaths);
    if (pull.deaths.some((d) => !d.ignored && !mass.has(deathKey(d)))) {
      evaluated = true;
      break;
    }
  }
  if (!evaluated) return null;

  const out: MetricNight = {
    key, name: tr(NO_DEFENSIVE_NAME), spellId: null, kind: 'no_defensive', severity: 'major', tip: NO_DEFENSIVE_TIP,
    collective: false, perPull: [], total: 0, pullsWithFailure: 0, players: [], helpers: [],
  };
  const by = new Map<string, { player: MetricPlayer; items: Map<string, MetricItem> }>();
  for (const pull of pulls) {
    const mass = massDeathKeys(pull.deaths);
    const seen = new Set<string>();
    let failures = 0;
    for (const d of pull.deaths) {
      if (d.ignored || mass.has(deathKey(d))) continue;
      const items = unusedAtDeath(d);
      if (!items.length) continue;
      failures++;
      const e = by.get(d.guid) ?? by.set(d.guid, { player: { guid: d.guid, name: d.name, class: null, count: 0, pulls: 0, max: 0 }, items: new Map() }).get(d.guid)!;
      e.player.name = d.name;
      e.player.class ??= d.class;
      e.player.count++;
      if (!seen.has(d.guid)) {
        e.player.pulls++;
        seen.add(d.guid);
      }
      e.player.max = Math.max(e.player.max, items.length);
      for (const item of items) {
        const k = itemKey(item);
        const cur = e.items.get(k);
        if (cur) cur.count++;
        else e.items.set(k, { ...item });
      }
    }
    out.perPull.push({ pull, failures });
    out.total += failures;
    if (failures > 0) out.pullsWithFailure++;
  }
  out.players = [...by.values()]
    .map(({ player, items }) => ({ ...player, items: [...items.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.count - a.count || b.pulls - a.pulls || a.name.localeCompare(b.name));
  return out;
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
  if (key === NO_DEFENSIVE) return noDefensiveNight(pulls, key);
  if (key.endsWith(YARDS)) return yardsNight(pulls, key);
  let out: MetricNight | null = null;
  const errs = new Map<string, MetricPlayer>();
  const helps = new Map<string, MetricPlayer>();
  let dmg = false;
  for (const pull of pulls) {
    const m = pull.mechanics.find((x) => x.key === key);
    if (!m) continue;
    dmg = DAMAGE_KINDS.has(m.kind);
    const hitDamage = dmg ? m.players.reduce((s, mp) => s + (mp.credit ? 0 : mp.amount), 0) : 0;
    out ??= {
      key: m.key, name: m.name, spellId: m.spellId, kind: m.kind, severity: m.severity, tip: m.tip,
      collective: COLLECTIVE.has(m.kind), perPull: [], total: 0, pullsWithFailure: 0, players: [], helpers: [],
      ...(dmg ? { damage: 0 } : {}),
    };
    out.perPull.push(dmg ? { pull, failures: mechanicMistakes(m), damage: hitDamage } : { pull, failures: mechanicMistakes(m) });
    out.total += mechanicMistakes(m);
    if (dmg) out.damage! += hitDamage;
    if (m.failures > 0) out.pullsWithFailure++;
    const cls = new Map(pull.players.map((x) => [x.guid, x.class]));
    for (const mp of m.players) {
      const map = mp.credit ? helps : errs;
      const p = map.get(mp.guid) ?? map.set(mp.guid, { guid: mp.guid, name: mp.name, class: null, count: 0, pulls: 0, max: 0 }).get(mp.guid)!;
      p.class ??= cls.get(mp.guid) ?? null;
      p.count += m.kind === 'stack_limit' && !mp.credit ? 1 : mp.credit ? mp.count : mistakes(mp);
      p.pulls++;
      p.max = Math.max(p.max, mp.count);
      if (dmg) p.damage = (p.damage ?? 0) + (mp.credit ? 0 : mp.amount);
    }
  }
  if (!out) return null;
  const order = (a: MetricPlayer, b: MetricPlayer) => b.count - a.count || b.pulls - a.pulls || a.name.localeCompare(b.name);
  out.players = [...errs.values()].sort(order);
  out.helpers = [...helps.values()].sort(order);
  return out;
}

/** Uma noite da evolução: `night` é null quando a mecânica não aparece nela. */
export interface MetricTrendNight {
  label: string;
  night: MetricNight | null;
}

export interface MetricTrendPlayer extends MetricPlayer {
  /** em quantas noites apareceu */
  nights: number;
}

/** Uma métrica escolhida somada noite a noite, com os players somados em todas elas. */
export interface MetricTrend {
  key: string;
  name: string;
  spellId: number | null;
  kind: string;
  severity: MechanicSeverity;
  collective: boolean;
  unit?: 'yd';
  /** na mesma ordem das noites recebidas */
  nights: MetricTrendNight[];
  /** quem errou, quem mais errou primeiro; `nights` = noites em que apareceu */
  players: MetricTrendPlayer[];
  /** dano tomado somado nas noites (avoidable_damage, tank_range, positioning) */
  damage?: number;
}

/** Evolução de uma métrica entre noites: reusa `metricNight` em cada uma. */
export function metricTrend(nights: { label: string; pulls: Pull[] }[], key: string): MetricTrend | null {
  const perNight: MetricTrendNight[] = nights.map((n) => ({ label: n.label, night: metricNight(n.pulls, key) }));
  const found = perNight.filter((n): n is MetricTrendNight & { night: MetricNight } => n.night != null);
  const first = found[0]?.night;
  if (!first) return null;
  const by = new Map<string, MetricTrendPlayer>();
  let damage: number | undefined;
  for (const { night } of found) {
    if (night.damage != null) damage = (damage ?? 0) + night.damage;
    for (const p of night.players) {
      const a: MetricTrendPlayer = by.get(p.guid) ?? { guid: p.guid, name: p.name, class: p.class, count: 0, pulls: 0, max: 0, nights: 0 };
      a.name = p.name;
      a.class ??= p.class;
      a.count += p.count;
      a.pulls += p.pulls;
      a.max = Math.max(a.max, p.max);
      a.nights++;
      if (p.damage != null) a.damage = (a.damage ?? 0) + p.damage;
      if (p.items) {
        const merged = new Map((a.items ?? []).map((i) => [itemKey(i), i]));
        for (const i of p.items) {
          const cur = merged.get(itemKey(i));
          if (cur) merged.set(itemKey(i), { ...cur, count: cur.count + i.count });
          else merged.set(itemKey(i), { ...i });
        }
        a.items = [...merged.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
      }
      by.set(p.guid, a);
    }
  }
  const players = [...by.values()].sort((a, b) => b.count - a.count || b.nights - a.nights || a.name.localeCompare(b.name));
  return {
    key: first.key,
    name: first.name,
    spellId: first.spellId,
    kind: first.kind,
    severity: first.severity,
    collective: first.collective,
    ...(first.unit ? { unit: first.unit } : {}),
    ...(damage != null ? { damage } : {}),
    nights: perNight,
    players,
  };
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

/** As métricas escolhidas de cada boss da noite (boss sem escolha fica de fora). */
export function nightBossMetrics(pulls: Pull[]): { key: string; encounterId: number; metrics: MetricNight[] }[] {
  return groupByBoss(pulls)
    .map(({ key, pulls: ps }) => ({
      key,
      encounterId: ps[0].encounterId,
      metrics: savedBossMetrics(ps[0].encounterId)
        .map((k) => metricNight(ps, k))
        .filter((m): m is MetricNight => m != null),
    }))
    .filter((b) => b.metrics.length > 0);
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
