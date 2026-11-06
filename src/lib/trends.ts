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
import { mistakes, PERSONAL_BLAME } from './blame';
import { cascadeThreshold, decisiveDeaths } from './verdict';
import { DAMAGE_KINDS, unusedAtDeath } from './bossMetrics';
import { difficultyRank, raidOrder } from './raids';
import { deathKey, massDeathKeys } from './massDeaths';
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
  /** média da nota nas noites em que jogou, ponderada pelos pulls de cada noite */
  avgScore: number;
  /** mortes (sem call de wipe nem wipe geral) por pull */
  avgDeathsPerPull: number;
  /** média dos parses nas noites com kill; null = nenhum parse */
  avgParse: number | null;
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

/** Critérios dos destaques da progressão: nota, dano evitável tomado, mortes e wipes causados. */
export type ProgAwardKey = 'bestScore' | 'leastDamage' | 'fewestDeaths' | 'bestPotUse' | 'mostDamage' | 'wipeCauser' | 'mostDeaths' | 'mostFreeDeaths'
  | 'fewestMechErrors' | 'mostMechErrors' | 'mostTimeAlive' | 'firstToDie' | 'mostImproved' | 'mostWorsened' | 'bestKillParse';

export interface ProgAwardWinner {
  guid: string;
  name: string;
  class: string | null;
  /** valor do critério por pull (na nota: a média nos pulls da prog) */
  value: number;
  /** pulls da prog em que jogou */
  pulls: number;
  /** wipeCauser: wipes em que teve ao menos uma morte decisiva */
  wipes?: number;
  /** firstToDie: quantas vezes foi a primeira morte da prog */
  count?: number;
  /** mostImproved / mostWorsened: nota no começo e no fim da prog */
  from?: number;
  to?: number;
}

/** Top 3 de cada categoria, do 1º ao 3º (categoria sem ninguém não aparece). */
export type ProgAwards = Partial<Record<ProgAwardKey, ProgAwardWinner[]>>;

/** Quantos players cada destaque mostra. */
export const PROG_AWARD_TOP = 3;

export interface Trends {
  nights: TrendNight[];
  causes: CauseRow[];
  players: PlayerTrend[];
  /** quem mais subiu e quem mais caiu de nota entre o começo e o fim das noites */
  improving: PlayerMove[];
  worsening: PlayerMove[];
  progression: Progression | null;
  /** melhores e piores da progressão (pulls antes da kill) */
  progAwards: ProgAwards;
  insights: string[];
}

/** Mudança mínima de nota para contar como melhora ou piora. */
export const MOVE_MIN_SCORE = 5;
/** Na progressão, entra quem jogou ao menos isso dos wipes (e no mínimo PROGRESSION_MIN_PULLS). */
const PROGRESSION_SHARE = 0.3;
const PROGRESSION_MIN_PULLS = 5;
/** Nos destaques da prog, entra quem jogou ao menos isso dos pulls. */
const PROG_AWARD_SHARE = 0.3;

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
 * Os wipes antes da 1ª kill do boss (em ordem, de todas as noites). Sem kill ainda, todos os pulls;
 * a kill que fecha a progressão (se houver).
 */
function progPulls(nights: TrendNight[]): { wipes: Pull[]; kill: Pull | null; killedOn: string | null } {
  const all = nights.flatMap((n) => n.summary.pulls.map((p) => ({ n, p }))).sort((a, b) => a.p.startMs - b.p.startMs);
  const killAt = all.findIndex((x) => x.p.success);
  const wipes = (killAt >= 0 ? all.slice(0, killAt) : all).filter((x) => !x.p.success).map((x) => x.p);
  return { wipes, kill: killAt >= 0 ? all[killAt].p : null, killedOn: killAt >= 0 ? all[killAt].n.label : null };
}

/**
 * Os wipes antes da 1ª kill do boss (em ordem, de todas as noites): quem teve a melhor e a pior nota
 * neles, e o melhor e o pior parse na kill que fechou a progressão.
 */
export function progressionOf(nights: TrendNight[]): Progression | null {
  const { wipes, kill, killedOn } = progPulls(nights);
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
    killedOn,
    minPulls: Math.min(minPulls, wipes.length),
    best: byScore[0] ?? null,
    worst: byScore.length > 1 ? byScore[byScore.length - 1] : null,
    bestPerf: byPerf[0] ?? null,
    worstPerf: byPerf.length > 1 ? byPerf[byPerf.length - 1] : null,
  };
}

type ProgAcc = {
  guid: string;
  name: string;
  class: string | null;
  pulls: number;
  scoreSum: number;
  damage: number;
  deaths: number;
  decisive: number;
  decisivePulls: number;
  /** mortes com pot/defensivo/healthstone livre */
  freeDeaths: number;
  /** poções de vida + healthstones usadas na prog */
  potUse: number;
  /** o player era tank em algum pull da prog (fica fora do dano tomado) */
  tank: boolean;
  /** erros de mecânica pessoais nos pulls da prog */
  mechErrors: number;
  /** soma da fração do pull em que ficou vivo */
  aliveSum: number;
  /** vezes que foi a primeira morte do pull */
  firstDeaths: number;
  /** nota em cada pull da prog, em ordem */
  scores: number[];
};

const perPull = (n: number, pulls: number) => (pulls ? n / pulls : 0);

/**
 * Destaques da progressão: melhores e piores nos pulls antes da 1ª kill, só entre quem jogou ao
 * menos 30% deles. Mortes depois da call de wipe (`ignored`) e de wipe geral ficam de fora; empate
 * fica com quem jogou mais pulls. Um player não aparece como melhor e pior do mesmo critério.
 */
export function progAwards(nights: TrendNight[]): ProgAwards {
  const { wipes, kill } = progPulls(nights);
  if (!wipes.length) return {};
  const minPulls = Math.max(1, Math.ceil(wipes.length * PROG_AWARD_SHARE));
  const acc = new Map<string, ProgAcc>();
  let damageTracked = false;
  let errorsTracked = false;
  for (const p of wipes) {
    const scores = scorePull(p);
    const roleOf = new Map(p.players.map((x) => [x.guid, x.role]));
    const mass = massDeathKeys(p.deaths);
    const sorted = [...p.deaths].filter((d) => !d.ignored).sort((a, b) => a.t - b.t);
    const decisive = new Set(
      (p.cutoffT != null ? sorted : decisiveDeaths(sorted, cascadeThreshold(p)))
        .filter((d) => !mass.has(deathKey(d)))
        .map(deathKey),
    );
    for (const pl of p.players) {
      const a = acc.get(pl.guid) ?? { guid: pl.guid, name: pl.name, class: pl.class, pulls: 0, scoreSum: 0, damage: 0, deaths: 0, decisive: 0, decisivePulls: 0, freeDeaths: 0, potUse: 0, tank: false, mechErrors: 0, aliveSum: 0, firstDeaths: 0, scores: [] };
      a.name = pl.name;
      a.class ??= pl.class;
      a.tank ||= pl.role === 'tank';
      a.pulls++;
      a.scoreSum += scores.get(pl.guid)?.score ?? 0;
      const sc = scores.get(pl.guid);
      if (sc) a.scores.push(sc.score);
      a.potUse += (pl.healthPotions ?? 0) + (pl.healthstones ?? 0);
      acc.set(pl.guid, a);
    }
    for (const m of p.mechanics) {
      if (!DAMAGE_KINDS.has(m.kind)) continue;
      damageTracked = true;
      for (const mp of m.players) {
        if (mp.credit || roleOf.get(mp.guid) === 'tank') continue;
        const a = acc.get(mp.guid);
        if (a) a.damage += mp.amount;
      }
    }
    for (const m of p.mechanics) {
      if (!PERSONAL_BLAME.has(m.kind)) continue;
      errorsTracked = true;
      for (const mp of m.players) {
        if (mp.credit) continue;
        const a = acc.get(mp.guid);
        if (a) a.mechErrors += m.kind === 'stack_limit' ? 1 : mistakes(mp);
      }
    }
    // tempo vivo: até a primeira morte que conta; o fim é a call de wipe (se houver) ou o pull inteiro
    const endT = Math.max(1, p.wipeCall?.t ?? p.cutoffT ?? p.durationMs);
    const firstDeathT = new Map<string, number>();
    let firstDeath: { guid: string; t: number } | null = null;
    for (const d of sorted) {
      if (mass.has(deathKey(d))) continue;
      if (!firstDeathT.has(d.guid)) firstDeathT.set(d.guid, d.t);
      if (!firstDeath) firstDeath = d;
    }
    for (const pl of p.players) {
      const a = acc.get(pl.guid);
      if (!a) continue;
      const t = firstDeathT.get(pl.guid);
      a.aliveSum += t == null ? 1 : Math.min(1, Math.max(0, t / endT));
    }
    if (firstDeath) {
      const a = acc.get(firstDeath.guid);
      if (a) a.firstDeaths++;
    }
    const hitWipe = new Set<string>();
    for (const d of p.deaths) {
      if (d.ignored || mass.has(deathKey(d))) continue;
      const a = acc.get(d.guid);
      if (!a) continue;
      a.deaths++;
      if (unusedAtDeath(d).length) a.freeDeaths++;
      if (decisive.has(deathKey(d))) {
        a.decisive++;
        hitWipe.add(d.guid);
      }
    }
    for (const guid of hitWipe) {
      const a = acc.get(guid);
      if (a) a.decisivePulls++;
    }
  }

  const cands = [...acc.values()].filter((a) => a.pulls >= minPulls);
  if (!cands.length) return {};
  const rank = (pool: ProgAcc[], metric: (a: ProgAcc) => number, dir: 'asc' | 'desc', exclude = new Set<string>(), tie?: (a: ProgAcc, b: ProgAcc) => number) =>
    pool
      .filter((a) => !exclude.has(a.guid))
      .sort((a, b) => (dir === 'asc' ? metric(a) - metric(b) : metric(b) - metric(a)) || (tie ? tie(a, b) : 0) || b.pulls - a.pulls || a.name.localeCompare(b.name));
  const winner = (a: ProgAcc, value: number, wipesCaused?: number, extra: Partial<ProgAwardWinner> = {}): ProgAwardWinner => ({
    guid: a.guid,
    name: a.name,
    class: a.class,
    value,
    pulls: a.pulls,
    ...(wipesCaused != null ? { wipes: wipesCaused } : {}),
    ...extra,
  });
  const out: ProgAwards = {};

  const top = (list: ProgAcc[], value: (a: ProgAcc) => number, wipesOf?: (a: ProgAcc) => number): ProgAwardWinner[] =>
    list.slice(0, PROG_AWARD_TOP).map((a) => winner(a, value(a), wipesOf?.(a)));
  /** Os melhores (menor valor ou maior nota) e os piores sem repetir quem já está no top do lado oposto; valor 0 não entra no negativo. */
  const pair = (
    goodKey: ProgAwardKey | null,
    badKey: ProgAwardKey | null,
    metric: (a: ProgAcc) => number,
    goodDir: 'asc' | 'desc',
    tie?: (a: ProgAcc, b: ProgAcc) => number,
    eligible: (a: ProgAcc) => boolean = () => true,
  ) => {
    const pool = cands.filter(eligible);
    const good = rank(pool, metric, goodDir, new Set(), tie).slice(0, PROG_AWARD_TOP);
    if (goodKey && good.length) out[goodKey] = top(good, metric);
    if (badKey) {
      const taken = new Set(good.map((a) => a.guid));
      const bad = rank(pool, metric, goodDir === 'asc' ? 'desc' : 'asc', taken).filter((a) => metric(a) > 0);
      if (bad.length) out[badKey] = top(bad, metric);
    }
  };

  pair('bestScore', null, (a) => perPull(a.scoreSum, a.pulls), 'desc');
  // dano tomado: tanks ficam de fora; healers concorrem com os DPS
  if (damageTracked) pair('leastDamage', 'mostDamage', (a) => perPull(a.damage, a.pulls), 'asc', undefined, (a) => !a.tank);
  pair('fewestDeaths', 'mostDeaths', (a) => perPull(a.deaths, a.pulls), 'asc');
  // menor taxa de mortes com algo livre; empate por mais pot/healthstone por pull
  const potRate = (a: ProgAcc) => perPull(a.potUse, a.pulls);
  pair('bestPotUse', 'mostFreeDeaths', (a) => perPull(a.freeDeaths, a.pulls), 'asc', (a, b) => potRate(b) - potRate(a));

  if (errorsTracked) pair('fewestMechErrors', 'mostMechErrors', (a) => perPull(a.mechErrors, a.pulls), 'asc');
  pair('mostTimeAlive', null, (a) => perPull(a.aliveSum, a.pulls), 'desc');
  // primeiro a morrer: só o lado ruim
  const firstTop = rank(cands, (a) => perPull(a.firstDeaths, a.pulls), 'desc').filter((a) => a.firstDeaths > 0);
  if (firstTop.length) out.firstToDie = firstTop.slice(0, PROG_AWARD_TOP).map((a) => winner(a, perPull(a.firstDeaths, a.pulls), undefined, { count: a.firstDeaths }));

  // começo x fim da prog: metades das notas pull a pull; só entra quem tem nota nas duas metades
  const moves = cands.flatMap((a) => {
    const h = halves(a.scores);
    return h ? [{ a, from: Math.round(h[0]), to: Math.round(h[1]) }] : [];
  });
  const moveOut = (key: 'mostImproved' | 'mostWorsened', list: typeof moves) => {
    const ranked = list.sort((x, y) => (key === 'mostImproved' ? y.to - y.from - (x.to - x.from) : x.to - x.from - (y.to - y.from)) || y.a.pulls - x.a.pulls || x.a.name.localeCompare(y.a.name));
    if (ranked.length) out[key] = ranked.slice(0, PROG_AWARD_TOP).map((x) => winner(x.a, x.to - x.from, undefined, { from: x.from, to: x.to }));
  };
  moveOut('mostImproved', moves.filter((x) => x.to - x.from >= MOVE_MIN_SCORE));
  moveOut('mostWorsened', moves.filter((x) => x.to - x.from <= -MOVE_MIN_SCORE));

  // parse na 1ª kill (pelo nome, como a Progressão); sem kill a categoria some
  if (kill) {
    const killScores = scorePull(kill);
    const parsed = cands.flatMap((a) => {
      const pl = kill.players.find((x) => x.name === a.name);
      const perf = pl ? killScores.get(pl.guid)?.perf : null;
      return perf != null ? [{ a, perf }] : [];
    });
    parsed.sort((x, y) => y.perf - x.perf || y.a.pulls - x.a.pulls || x.a.name.localeCompare(y.a.name));
    if (parsed.length) out.bestKillParse = parsed.slice(0, PROG_AWARD_TOP).map((x) => winner(x.a, x.perf));
  }

  const causers = rank(cands, (a) => perPull(a.decisive, a.pulls), 'desc').filter((a) => a.decisive > 0);
  if (causers.length) out.wipeCauser = top(causers, (a) => perPull(a.decisive, a.pulls), (a) => a.decisivePulls);

  return out;
}

/**
 * Só os pulls da raid da guilda (ou só os de pug): pelo núcleo de players que se repete nas noites
 * salvas (pelo nome: o GUID pode mudar entre o log do PC e o Warcraft Logs). Sem noites suficientes
 * para saber, tudo conta como guilda.
 */
/** Pulls do mesmo boss que começam com menos disso de diferença são o mesmo pull (log e WCL arredondam diferente). */
const SAME_PULL_MS = 5_000;

/**
 * A mesma raide salva duas vezes (de dois arquivos, ou do log e do WCL) contaria em dobro: cada
 * pull entra uma vez só (o da noite mais antiga na lista), e a noite que fica sem pull novo sai.
 */
export function dedupeNights(input: NightInput[]): NightInput[] {
  const seen = new Map<number, number[]>();
  const out: NightInput[] = [];
  for (const n of input) {
    const pulls = n.pulls.filter((p) => {
      const starts = seen.get(p.encounterId) ?? [];
      if (starts.some((t) => Math.abs(t - p.startMs) < SAME_PULL_MS)) return false;
      seen.set(p.encounterId, [...starts, p.startMs]);
      return true;
    });
    if (pulls.length) out.push(pulls.length === n.pulls.length ? n : { ...n, pulls });
  }
  return out;
}

export function byGroup(all: NightInput[], group: 'guild' | 'pug' | 'all'): { nights: NightInput[]; pugPulls: number } {
  const input = dedupeNights(all);
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

/** Boss presente no histórico (uma dificuldade). */
export interface TrendBoss {
  key: string;
  encounterId: number;
  name: string;
  difficultyId: number;
  difficultyName: string;
  nights: number;
  pulls: number;
}

/** Bosses com noites salvas: por dificuldade (Mythic, Heroic...) e, dentro dela, na ordem da raide. */
export function trendBosses(nights: NightInput[]): TrendBoss[] {
  const m = new Map<string, Omit<TrendBoss, 'nights'> & { nights: Set<string> }>();
  for (const n of nights) {
    // a Evolução é de raid: masmorras (M+) ficam de fora
    for (const p of raidOnly(n.pulls)) {
      const key = bossKey(p);
      const e = m.get(key) ?? { key, encounterId: p.encounterId, name: p.encounterName, difficultyId: p.difficultyId, difficultyName: p.difficultyName, nights: new Set(), pulls: 0 };
      e.nights.add(n.id);
      e.pulls++;
      m.set(key, e);
    }
  }
  return [...m.values()]
    .map((e) => ({ ...e, nights: e.nights.size }))
    .sort((a, b) => difficultyRank(a.difficultyId) - difficultyRank(b.difficultyId) || raidOrder(a.encounterId) - raidOrder(b.encounterId) || a.name.localeCompare(b.name));
}

const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/**
 * O que matou: a mecânica ligada à morte (pela chave: análises antigas guardaram o nome em
 * português), senão o golpe final. `name` é o que aparece.
 */
const killerOf = (d: Pull['deaths'][number]): { key: string; name: string } | null => {
  if (d.causedBy) return { key: `mech:${d.causedBy.key}`, name: d.causedBy.name };
  const name = d.killingBlowMechanic ?? d.killingBlow?.spellName ?? null;
  return name ? { key: name, name } : null;
};

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
      // análises antigas guardaram o nome em português: vale o da noite mais recente
      row.name = c.name;
      row.perNight[i] = c.triggers;
      row.total += c.triggers;
      causeMap.set(c.key, row);
    }
  });
  const causes = [...causeMap.values()].sort((a, b) => b.total - a.total);

  // players
  const acc = new Map<
    string,
    PlayerTrend & { killers: Map<string, Set<number>>; killerCount: Map<string, number>; killerNoDef: Map<string, number>; scoreWeighted: number; scorePulls: number; perfSum: number; perfNights: number }
  >();
  // nome do que matou -> spell (ícone)
  const killerSpell = new Map<string, number>();
  const killerName = new Map<string, string>();
  nights.forEach((n, i) => {
    for (const pn of n.summary.players) {
      const a = acc.get(pn.guid) ?? {
        guid: pn.guid, name: pn.name, class: pn.class, deathsPerPull: nights.map(() => null), scorePerNight: nights.map(() => null), perfPerNight: nights.map(() => null),
        avgScore: 0, avgDeathsPerPull: 0, avgParse: null, pulls: 0, deaths: 0,
        deathsNoDefensive: 0, topKiller: null, topKillerSpellId: null, topKillerNights: 0, topKillerNoDefensive: 0, mechanicErrors: 0, killers: new Map(), killerCount: new Map(), killerNoDef: new Map(),
        scoreWeighted: 0, scorePulls: 0, perfSum: 0, perfNights: 0,
      };
      a.class ??= pn.class;
      a.pulls += pn.pulls;
      a.mechanicErrors += pn.mechanicErrors;
      acc.set(pn.guid, a);
    }
    const deathsThisNight = new Map<string, number>();
    for (const p of n.summary.pulls) {
      // mortes num mass wipe (muita gente junto) não são culpa de quem morreu: ficam fora
      const mass = massDeathKeys(p.deaths);
      for (const d of p.deaths) {
        if (d.ignored || mass.has(deathKey(d))) continue;
        const a = acc.get(d.guid);
        if (!a) continue;
        a.deaths++;
        deathsThisNight.set(d.guid, (deathsThisNight.get(d.guid) ?? 0) + 1);
        const noDef = d.defensivesRecent.length === 0 && d.defensivesAvailable.length > 0;
        if (noDef) a.deathsNoDefensive++;
        const killer = killerOf(d);
        const k = killer?.key;
        // a noite mais recente dá o nome
        if (killer) killerName.set(killer.key, killer.name);
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
      if (a.scorePerNight[i] != null) {
        a.scoreWeighted += a.scorePerNight[i]! * pn.pulls;
        a.scorePulls += pn.pulls;
      }
      if (pn.avgPerf != null) {
        a.perfSum += pn.avgPerf;
        a.perfNights++;
      }
    }
  });
  const players: PlayerTrend[] = [...acc.values()].map(({ killers, killerCount, killerNoDef, scoreWeighted, scorePulls, perfSum, perfNights, ...a }) => {
    const best = [...killerCount.entries()].sort((x, y) => y[1] - x[1])[0] ?? null;
    const top: [string, number] | null = best ? [killerName.get(best[0]) ?? best[0], best[1]] : null;
    return {
      ...a,
      avgScore: scorePulls ? Math.round(scoreWeighted / scorePulls) : 0,
      avgDeathsPerPull: a.pulls ? a.deaths / a.pulls : 0,
      avgParse: perfNights ? perfSum / perfNights : null,
      topKiller: top,
      topKillerSpellId: best ? killerSpell.get(best[0]) ?? null : null,
      topKillerNights: best ? killers.get(best[0])!.size : 0,
      topKillerNoDefensive: best ? killerNoDef.get(best[0]) ?? 0 : 0,
    };
  });
  // a média da nota manda na lista; mortes por pull desempatam
  players.sort((a, b) => b.avgScore - a.avgScore || b.avgDeathsPerPull - a.avgDeathsPerPull || a.name.localeCompare(b.name));

  return { nights, causes, players, ...playerMoves(players), progression: progressionOf(nights), progAwards: progAwards(nights), insights: insights(nights, causes, players) };
}

function insights(nights: TrendNight[], causes: CauseRow[], players: PlayerTrend[]): string[] {
  const t = messagesOf(trendsMsg);
  const out: string[] = [];
  if (nights.length < 2) return out;
  const first = nights[0];
  const last = nights[nights.length - 1];

  // progresso
  const hpOf = (n: TrendNight) => (n.summary.kills ? 'Kill' : n.summary.best?.label ?? null);
  const kill = nights.find((n) => n.summary.kills > 0);
  if (kill) out.push(t.killAt(kill.label, nights.slice(0, nights.indexOf(kill) + 1).reduce((s, n) => s + n.summary.pulls.length, 0)));
  else {
    const hps = nights.map(hpOf).filter((x): x is string => x != null);
    if (hps.length >= 2) out.push(t.bestPerNight(hps.join(' → ')));
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
