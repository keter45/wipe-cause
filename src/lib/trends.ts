// Evolução entre noites: junta as análises salvas de um boss e mostra se a raid está
// melhorando (causas de wipe, melhor HP) e o que se repete com cada player.

import type { Pull } from '../types';
import { messagesOf } from '../i18n';
import { trendsMsg } from './trends.i18n';
import { shortName } from './format';
import { bossKey, summarizeNight, type NightSummary } from './night';
import { raidOnly } from './content';
import { mechanicSpellId } from './spells';
import { scorePull } from './score';
import { coreRoster, isGuildGroup } from './roster';

export interface NightInput {
  id: string;
  title: string;
  raidStartMs: number | null;
  pulls: Pull[];
}

export interface TrendNight {
  id: string;
  /** "28/09" */
  label: string;
  startMs: number;
  summary: NightSummary;
}

export interface CauseRow {
  key: string;
  name: string;
  spellId: number | null;
  /** por noite (mesma ordem de `nights`): wipes em que foi o gatilho; null = boss não jogado */
  perNight: (number | null)[];
  total: number;
}

export interface PlayerTrend {
  guid: string;
  name: string;
  class: string | null;
  /** por noite: mortes (antes do corte) por pull; null = não jogou */
  deathsPerPull: (number | null)[];
  /** por noite: nota média; null = não jogou */
  scorePerNight: (number | null)[];
  /** por noite: parse médio do Warcraft Logs nos kills (0-100); null = sem kill ou sem parse */
  perfPerNight: (number | null)[];
  pulls: number;
  deaths: number;
  /** mortes com defensivo disponível e nenhum usado */
  deathsNoDefensive: number;
  /** o que mais o matou: [nome, vezes] */
  topKiller: [string, number] | null;
  topKillerSpellId: number | null;
  /** noites em que morreu para `topKiller` */
  topKillerNights: number;
  /** mortes para `topKiller` com defensivo disponível e nenhum usado */
  topKillerNoDefensive: number;
  mechanicErrors: number;
}

/** Como a nota e o desempenho de um player mudaram entre o começo e o fim das noites em que jogou. */
export interface PlayerMove {
  guid: string;
  name: string;
  class: string | null;
  nights: number;
  scoreFrom: number;
  scoreTo: number;
  perfFrom: number | null;
  perfTo: number | null;
}

/** Um player na progressão: nota média nos wipes antes da kill e o parse dele na kill. */
export interface ProgressionPlayer {
  guid: string;
  name: string;
  class: string | null;
  pulls: number;
  avgScore: number;
  /** parse do Warcraft Logs na kill que fechou a progressão; null = sem kill ou sem parse */
  killParse: number | null;
}

export interface Progression {
  /** wipes antes da 1ª kill (ou todos, sem kill ainda) */
  pulls: number;
  /** noite da 1ª kill (label); null = ainda sem kill */
  killedOn: string | null;
  /** jogou ao menos isso dos pulls para entrar */
  minPulls: number;
  best: ProgressionPlayer | null;
  worst: ProgressionPlayer | null;
  /** melhor e pior parse na kill (o wipe não tem parse) */
  bestPerf: ProgressionPlayer | null;
  worstPerf: ProgressionPlayer | null;
}

export interface Trends {
  nights: TrendNight[];
  causes: CauseRow[];
  players: PlayerTrend[];
  /** quem mais subiu e quem mais caiu de nota entre o começo e o fim das noites */
  improving: PlayerMove[];
  worsening: PlayerMove[];
  progression: Progression | null;
  insights: string[];
}

/** Mudança mínima de nota para contar como melhora ou piora. */
export const MOVE_MIN_SCORE = 5;
/** Na progressão, entra quem jogou ao menos isso dos wipes (e no mínimo PROGRESSION_MIN_PULLS). */
const PROGRESSION_SHARE = 0.3;
const PROGRESSION_MIN_PULLS = 5;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Começo x fim: média da primeira metade das noites em que jogou contra a da segunda (com 2 noites,
 * a primeira contra a última). Valores null (não jogou / sem base) ficam de fora.
 */
function halves(values: (number | null)[]): [number, number] | null {
  const xs = values.filter((v): v is number => v != null);
  if (xs.length < 2) return null;
  const h = Math.floor(xs.length / 2);
  return [mean(xs.slice(0, h))!, mean(xs.slice(xs.length - h))!];
}

export function playerMoves(players: PlayerTrend[]): { improving: PlayerMove[]; worsening: PlayerMove[] } {
  const moves = players.flatMap((p) => {
    const s = halves(p.scorePerNight);
    if (!s) return [];
    const pf = halves(p.perfPerNight);
    return [{ guid: p.guid, name: p.name, class: p.class, nights: p.scorePerNight.filter((v) => v != null).length, scoreFrom: Math.round(s[0]), scoreTo: Math.round(s[1]), perfFrom: pf?.[0] ?? null, perfTo: pf?.[1] ?? null }];
  });
  const delta = (m: PlayerMove) => m.scoreTo - m.scoreFrom;
  return {
    improving: moves.filter((m) => delta(m) >= MOVE_MIN_SCORE).sort((a, b) => delta(b) - delta(a)),
    worsening: moves.filter((m) => delta(m) <= -MOVE_MIN_SCORE).sort((a, b) => delta(a) - delta(b)),
  };
}

/**
 * Os wipes antes da 1ª kill do boss (em ordem, de todas as noites): quem teve a melhor e a pior nota
 * neles, e o melhor e o pior parse na kill que fechou a progressão.
 */
export function progressionOf(nights: TrendNight[]): Progression | null {
  const all = nights.flatMap((n) => n.summary.pulls.map((p) => ({ n, p }))).sort((a, b) => a.p.startMs - b.p.startMs);
  const killAt = all.findIndex((x) => x.p.success);
  const wipes = (killAt >= 0 ? all.slice(0, killAt) : all).filter((x) => !x.p.success).map((x) => x.p);
  if (!wipes.length) return null;
  const acc = new Map<string, { name: string; class: string | null; pulls: number; scores: number[] }>();
  for (const p of wipes) {
    const scores = scorePull(p);
    for (const pl of p.players) {
      const s = scores.get(pl.guid);
      if (!s) continue;
      const a = acc.get(pl.guid) ?? { name: pl.name, class: pl.class, pulls: 0, scores: [] };
      a.pulls++;
      a.scores.push(s.score);
      acc.set(pl.guid, a);
    }
  }
  // parse na kill, pelo nome (o guid do kill é o mesmo do log; o nome cobre logs diferentes)
  const kill = killAt >= 0 ? all[killAt].p : null;
  const killScores = kill ? scorePull(kill) : null;
  const parseOf = (name: string) => {
    const pl = kill?.players.find((x) => x.name === name);
    return pl ? (killScores!.get(pl.guid)?.perf ?? null) : null;
  };
  const minPulls = Math.max(PROGRESSION_MIN_PULLS, Math.ceil(wipes.length * PROGRESSION_SHARE));
  const list: ProgressionPlayer[] = [...acc.entries()]
    .filter(([, a]) => a.pulls >= Math.min(minPulls, wipes.length))
    .map(([guid, a]) => ({ guid, name: a.name, class: a.class, pulls: a.pulls, avgScore: mean(a.scores)!, killParse: parseOf(a.name) }));
  const byScore = [...list].sort((a, b) => b.avgScore - a.avgScore);
  const byPerf = list.filter((x) => x.killParse != null).sort((a, b) => b.killParse! - a.killParse!);
  return {
    pulls: wipes.length,
    killedOn: killAt >= 0 ? all[killAt].n.label : null,
    minPulls: Math.min(minPulls, wipes.length),
    best: byScore[0] ?? null,
    worst: byScore.length > 1 ? byScore[byScore.length - 1] : null,
    bestPerf: byPerf[0] ?? null,
    worstPerf: byPerf.length > 1 ? byPerf[byPerf.length - 1] : null,
  };
}

/**
 * Só os pulls da raid da guilda (ou só os de pug): pelo núcleo de players que se repete nas noites
 * salvas (pelo nome: o GUID pode mudar entre o log do PC e o Warcraft Logs). Sem noites suficientes
 * para saber, tudo conta como guilda.
 */
export function byGroup(input: NightInput[], group: 'guild' | 'pug' | 'all'): { nights: NightInput[]; pugPulls: number } {
  const names = (p: Pull) => p.players.map((x) => x.name);
  const roster = coreRoster(input.map((n) => raidOnly(n.pulls).flatMap(names)));
  let pugPulls = 0;
  const nights = input.map((n) => ({
    ...n,
    pulls: n.pulls.filter((p) => {
      const pug = isGuildGroup(names(p), roster) === false;
      if (pug && !p.dungeon) pugPulls++;
      return group === 'all' || (group === 'pug' ? pug : !pug);
    }),
  }));
  return { nights, pugPulls };
}

/** Bosses presentes no histórico, do mais jogado para o menos. */
export function trendBosses(nights: NightInput[]): { key: string; encounterId: number; nights: number; pulls: number }[] {
  const m = new Map<string, { encounterId: number; nights: Set<string>; pulls: number }>();
  for (const n of nights) {
    // a Evolução é de raid: masmorras (M+) ficam de fora
    for (const p of raidOnly(n.pulls)) {
      const e = m.get(bossKey(p)) ?? { encounterId: p.encounterId, nights: new Set(), pulls: 0 };
      e.nights.add(n.id);
      e.pulls++;
      m.set(bossKey(p), e);
    }
  }
  return [...m.entries()].map(([key, e]) => ({ key, encounterId: e.encounterId, nights: e.nights.size, pulls: e.pulls })).sort((a, b) => b.pulls - a.pulls);
}

const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Nome do que matou: a mecânica ligada à morte, senão o golpe final. */
const killerOf = (d: Pull['deaths'][number]) => d.causedBy?.name ?? d.killingBlowMechanic ?? d.killingBlow?.spellName ?? null;

export function buildTrends(input: NightInput[], boss: string): Trends {
  const nights: TrendNight[] = input
    .map((n) => ({ n, pulls: n.pulls.filter((p) => bossKey(p) === boss) }))
    .filter((x) => x.pulls.length > 0)
    .map(({ n, pulls }) => ({
      id: n.id,
      label: n.title.split(' · ')[0],
      startMs: n.raidStartMs ?? pulls[0].startMs,
      summary: summarizeNight(pulls),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  // causas: gatilhos por noite
  const causeMap = new Map<string, CauseRow>();
  nights.forEach((n, i) => {
    for (const c of n.summary.causes) {
      if (!c.triggers) continue;
      const row = causeMap.get(c.key) ?? { key: c.key, name: c.name, spellId: mechanicSpellId(n.summary.pulls, c.key), perNight: nights.map(() => 0), total: 0 };
      row.perNight[i] = c.triggers;
      row.total += c.triggers;
      causeMap.set(c.key, row);
    }
  });
  const causes = [...causeMap.values()].sort((a, b) => b.total - a.total);

  // players
  const acc = new Map<string, PlayerTrend & { killers: Map<string, Set<number>>; killerCount: Map<string, number>; killerNoDef: Map<string, number> }>();
  // nome do que matou -> spell (ícone)
  const killerSpell = new Map<string, number>();
  nights.forEach((n, i) => {
    for (const pn of n.summary.players) {
      const a = acc.get(pn.guid) ?? {
        guid: pn.guid, name: pn.name, class: pn.class, deathsPerPull: nights.map(() => null), scorePerNight: nights.map(() => null), perfPerNight: nights.map(() => null), pulls: 0, deaths: 0,
        deathsNoDefensive: 0, topKiller: null, topKillerSpellId: null, topKillerNights: 0, topKillerNoDefensive: 0, mechanicErrors: 0, killers: new Map(), killerCount: new Map(), killerNoDef: new Map(),
      };
      a.class ??= pn.class;
      a.pulls += pn.pulls;
      a.mechanicErrors += pn.mechanicErrors;
      acc.set(pn.guid, a);
    }
    const deathsThisNight = new Map<string, number>();
    for (const p of n.summary.pulls) {
      for (const d of p.deaths) {
        if (d.ignored) continue;
        const a = acc.get(d.guid);
        if (!a) continue;
        a.deaths++;
        deathsThisNight.set(d.guid, (deathsThisNight.get(d.guid) ?? 0) + 1);
        const noDef = d.defensivesRecent.length === 0 && d.defensivesAvailable.length > 0;
        if (noDef) a.deathsNoDefensive++;
        const k = killerOf(d);
        if (k && !killerSpell.has(k)) {
          const id = d.causedBy ? mechanicSpellId(p, d.causedBy.key) : d.killingBlow?.spellId;
          if (id != null) killerSpell.set(k, id);
        }
        if (k) {
          if (noDef) a.killerNoDef.set(k, (a.killerNoDef.get(k) ?? 0) + 1);
          a.killerCount.set(k, (a.killerCount.get(k) ?? 0) + 1);
          a.killers.set(k, (a.killers.get(k) ?? new Set()).add(i));
        }
      }
    }
    for (const pn of n.summary.players) {
      const a = acc.get(pn.guid)!;
      a.deathsPerPull[i] = pn.pulls ? (deathsThisNight.get(pn.guid) ?? 0) / pn.pulls : null;
      a.scorePerNight[i] = pn.pulls ? Math.round(pn.avgScore) : null;
      a.perfPerNight[i] = pn.avgPerf;
    }
  });
  const players: PlayerTrend[] = [...acc.values()].map(({ killers, killerCount, killerNoDef, ...a }) => {
    const top = [...killerCount.entries()].sort((x, y) => y[1] - x[1])[0] ?? null;
    return { ...a, topKiller: top, topKillerSpellId: top ? killerSpell.get(top[0]) ?? null : null, topKillerNights: top ? killers.get(top[0])!.size : 0, topKillerNoDefensive: top ? killerNoDef.get(top[0]) ?? 0 : 0 };
  });
  // quem mais morreu no total (taxa por pull desempata: quem jogou pouco não vai para o topo)
  players.sort((a, b) => b.deaths - a.deaths || b.deaths / Math.max(1, b.pulls) - a.deaths / Math.max(1, a.pulls));

  return { nights, causes, players, ...playerMoves(players), progression: progressionOf(nights), insights: insights(nights, causes, players) };
}

function insights(nights: TrendNight[], causes: CauseRow[], players: PlayerTrend[]): string[] {
  const t = messagesOf(trendsMsg);
  const out: string[] = [];
  if (nights.length < 2) return out;
  const first = nights[0];
  const last = nights[nights.length - 1];

  // progresso
  const hpOf = (n: TrendNight) => (n.summary.kills ? 0 : n.summary.best?.hp ?? null);
  const kill = nights.find((n) => n.summary.kills > 0);
  if (kill) out.push(t.killAt(kill.label, nights.slice(0, nights.indexOf(kill) + 1).reduce((s, n) => s + n.summary.pulls.length, 0)));
  else {
    const hps = nights.map(hpOf).filter((x): x is number => x != null);
    if (hps.length >= 2) out.push(t.bestPerNight(hps.map((h) => `${h.toFixed(1)}%`).join(' → ')));
  }

  // causas que caíram ou subiram entre a primeira e a última noite
  for (const c of causes.slice(0, 4)) {
    const a = c.perNight[0] ?? 0;
    const b = c.perNight[c.perNight.length - 1] ?? 0;
    const pa = pctOf(a, first.summary.wipes);
    const pb = pctOf(b, last.summary.wipes);
    if (Math.abs(pa - pb) < 15) continue;
    out.push(t.causeTrend(c.name, pa, first.label, pb, last.label, pb < pa));
  }

  // quem mais melhorou / piorou de nota entre a primeira e a última noite em que jogou
  const deltas = players
    .map((p) => {
      const s = p.scorePerNight.filter((x): x is number => x != null);
      return { p, a: s[0], b: s[s.length - 1], n: s.length };
    })
    .filter((x) => x.n >= 2 && Math.abs(x.b - x.a) >= 10)
    .sort((x, y) => y.b - y.a - (x.b - x.a));
  if (deltas[0] && deltas[0].b > deltas[0].a) out.push(t.improved(shortName(deltas[0].p.name), deltas[0].a, deltas[0].b));
  const worst = deltas[deltas.length - 1];
  if (worst && worst.b < worst.a) out.push(t.dropped(shortName(worst.p.name), worst.a, worst.b));

  // o que se repete com cada player
  const repeat = players
    .filter((p) => p.topKiller && p.topKiller[1] >= 3 && p.topKillerNights >= 2)
    .sort((a, b) => b.topKiller![1] - a.topKiller![1])
    .slice(0, 5);
  for (const p of repeat) {
    const [killer, n] = p.topKiller!;
    out.push(t.repeatDeaths(shortName(p.name), killer, n, p.topKillerNights, p.topKillerNoDefensive));
  }
  return out;
}
