// Evolução entre noites: junta as análises salvas de um boss e mostra se a raid está
// melhorando (causas de wipe, melhor HP) e o que se repete com cada player.

import type { Pull } from '../types';
import { messagesOf } from '../i18n';
import { trendsMsg } from './trends.i18n';
import { shortName } from './format';
import { bossKey, summarizeNight, type NightSummary } from './night';
import { raidOnly } from './content';
import { mechanicSpellId } from './spells';

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

export interface Trends {
  nights: TrendNight[];
  causes: CauseRow[];
  players: PlayerTrend[];
  insights: string[];
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
        guid: pn.guid, name: pn.name, class: pn.class, deathsPerPull: nights.map(() => null), scorePerNight: nights.map(() => null), pulls: 0, deaths: 0,
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
    }
  });
  const players: PlayerTrend[] = [...acc.values()].map(({ killers, killerCount, killerNoDef, ...a }) => {
    const top = [...killerCount.entries()].sort((x, y) => y[1] - x[1])[0] ?? null;
    return { ...a, topKiller: top, topKillerSpellId: top ? killerSpell.get(top[0]) ?? null : null, topKillerNights: top ? killers.get(top[0])!.size : 0, topKillerNoDefensive: top ? killerNoDef.get(top[0]) ?? 0 : 0 };
  });
  // quem mais morreu no total (taxa por pull desempata: quem jogou pouco não vai para o topo)
  players.sort((a, b) => b.deaths - a.deaths || b.deaths / Math.max(1, b.pulls) - a.deaths / Math.max(1, a.pulls));

  return { nights, causes, players, insights: insights(nights, causes, players) };
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
