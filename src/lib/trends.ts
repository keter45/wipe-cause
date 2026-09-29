// Evolução entre noites: junta as análises salvas de um boss e mostra se a raid está
// melhorando (causas de wipe, melhor HP) e o que se repete com cada player.

import type { Pull } from '../types';
import { shortName } from './format';
import { bossKey, summarizeNight, type NightSummary } from './night';

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
  pulls: number;
  deaths: number;
  /** mortes com defensivo disponível e nenhum usado */
  deathsNoDefensive: number;
  /** o que mais o matou: [nome, vezes] */
  topKiller: [string, number] | null;
  /** noites em que morreu para `topKiller` */
  topKillerNights: number;
  /** mortes para `topKiller` com defensivo disponível e nenhum usado */
  topKillerNoDefensive: number;
  mechanicErrors: number;
}

export interface Trends {
  nights: TrendNight[];
  causes: CauseRow[];
  players: PlayerTrend[];
  insights: string[];
}

/** Bosses presentes no histórico, do mais jogado para o menos. */
export function trendBosses(nights: NightInput[]): { key: string; nights: number; pulls: number }[] {
  const m = new Map<string, { nights: Set<string>; pulls: number }>();
  for (const n of nights) {
    for (const p of n.pulls) {
      const e = m.get(bossKey(p)) ?? { nights: new Set(), pulls: 0 };
      e.nights.add(n.id);
      e.pulls++;
      m.set(bossKey(p), e);
    }
  }
  return [...m.entries()].map(([key, e]) => ({ key, nights: e.nights.size, pulls: e.pulls })).sort((a, b) => b.pulls - a.pulls);
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
      const row = causeMap.get(c.key) ?? { key: c.key, name: c.name, perNight: nights.map(() => 0), total: 0 };
      row.perNight[i] = c.triggers;
      row.total += c.triggers;
      causeMap.set(c.key, row);
    }
  });
  const causes = [...causeMap.values()].sort((a, b) => b.total - a.total);

  // players
  const acc = new Map<string, PlayerTrend & { killers: Map<string, Set<number>>; killerCount: Map<string, number>; killerNoDef: Map<string, number> }>();
  nights.forEach((n, i) => {
    for (const pn of n.summary.players) {
      const a = acc.get(pn.guid) ?? {
        guid: pn.guid, name: pn.name, class: pn.class, deathsPerPull: nights.map(() => null), pulls: 0, deaths: 0,
        deathsNoDefensive: 0, topKiller: null, topKillerNights: 0, topKillerNoDefensive: 0, mechanicErrors: 0, killers: new Map(), killerCount: new Map(), killerNoDef: new Map(),
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
        if (k) {
          if (noDef) a.killerNoDef.set(k, (a.killerNoDef.get(k) ?? 0) + 1);
          a.killerCount.set(k, (a.killerCount.get(k) ?? 0) + 1);
          a.killers.set(k, (a.killers.get(k) ?? new Set()).add(i));
        }
      }
    }
    for (const pn of n.summary.players) {
      acc.get(pn.guid)!.deathsPerPull[i] = pn.pulls ? (deathsThisNight.get(pn.guid) ?? 0) / pn.pulls : null;
    }
  });
  const players: PlayerTrend[] = [...acc.values()].map(({ killers, killerCount, killerNoDef, ...a }) => {
    const top = [...killerCount.entries()].sort((x, y) => y[1] - x[1])[0] ?? null;
    return { ...a, topKiller: top, topKillerNights: top ? killers.get(top[0])!.size : 0, topKillerNoDefensive: top ? killerNoDef.get(top[0]) ?? 0 : 0 };
  });
  // quem mais morreu no total (taxa por pull desempata: quem jogou pouco não vai para o topo)
  players.sort((a, b) => b.deaths - a.deaths || b.deaths / Math.max(1, b.pulls) - a.deaths / Math.max(1, a.pulls));

  return { nights, causes, players, insights: insights(nights, causes, players) };
}

function insights(nights: TrendNight[], causes: CauseRow[], players: PlayerTrend[]): string[] {
  const out: string[] = [];
  if (nights.length < 2) return out;
  const first = nights[0];
  const last = nights[nights.length - 1];

  // progresso
  const hpOf = (n: TrendNight) => (n.summary.kills ? 0 : n.summary.best?.hp ?? null);
  const kill = nights.find((n) => n.summary.kills > 0);
  if (kill) out.push(`Kill em ${kill.label}, depois de ${nights.slice(0, nights.indexOf(kill) + 1).reduce((s, n) => s + n.summary.pulls.length, 0)} pulls no total.`);
  else {
    const hps = nights.map(hpOf).filter((x): x is number => x != null);
    if (hps.length >= 2) out.push(`Melhor pull por noite: ${hps.map((h) => `${h.toFixed(1)}%`).join(' → ')}.`);
  }

  // causas que caíram ou subiram entre a primeira e a última noite
  for (const c of causes.slice(0, 4)) {
    const a = c.perNight[0] ?? 0;
    const b = c.perNight[c.perNight.length - 1] ?? 0;
    const pa = pctOf(a, first.summary.wipes);
    const pb = pctOf(b, last.summary.wipes);
    if (Math.abs(pa - pb) < 15) continue;
    out.push(`${c.name}: gatilho em ${pa}% dos wipes em ${first.label} → ${pb}% em ${last.label}${pb < pa ? ' (melhorou)' : ' (piorou)'}.`);
  }

  // o que se repete com cada player
  const repeat = players
    .filter((p) => p.topKiller && p.topKiller[1] >= 3 && p.topKillerNights >= 2)
    .sort((a, b) => b.topKiller![1] - a.topKiller![1])
    .slice(0, 5);
  for (const p of repeat) {
    const [killer, n] = p.topKiller!;
    out.push(
      `${shortName(p.name)} morreu para ${killer} ${n}× em ${p.topKillerNights} noites${p.topKillerNoDefensive ? `, ${p.topKillerNoDefensive} delas com defensivo sobrando` : ''}.`,
    );
  }
  return out;
}
