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
import { DAMAGE_KINDS, unusedAtDeath } from './bossMetrics';
import { difficultyRank, raidOrder } from './raids';
import { deathKey, massDeathKeys } from './massDeaths';
import { coreRoster, isGuildGroup } from './roster';
import { bestPulls, countedEarlyDeaths, DECISIVE_MS, MIN_BEST_PLAYED } from './progDeaths';
import { wipeCause } from './verdict';
import { phaseCountOf } from './phases';

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

/** Critérios dos destaques de cartão pequeno (mortes têm a tabela própria, `deathTable`). */
export type ProgAwardKey = 'bestScore' | 'leastDamage' | 'mostDamage' | 'fewestMechErrors' | 'mostMechErrors' | 'mostTimeAlive' | 'mostImproved' | 'mostWorsened' | 'bestKillParse' | 'mostWipesCaused';

export interface ProgAwardWinner {
  guid: string;
  name: string;
  class: string | null;
  /** valor do critério por pull (na nota: a média nos pulls da prog) */
  value: number;
  /** pulls da prog em que jogou */
  pulls: number;
  /** maior valor (em módulo) entre todos os candidatos da categoria: a barra do cartão é value/scale */
  scale: number;
  /** mostImproved / mostWorsened: nota no começo e no fim da prog */
  from?: number;
  to?: number;
  /** mostWipesCaused: wipes causados por morte decisiva, por mecânica e por tank (um pull pode contar em mais de um) */
  byDeath?: number;
  byMechanic?: number;
  byTank?: number;
}

/** Top 3 de cada categoria, do 1º ao 3º (categoria sem ninguém não aparece). */
export type ProgAwards = Partial<Record<ProgAwardKey, ProgAwardWinner[]>>;

/** Uma linha da tabela de mortes: tudo por pull. */
export interface DeathRow {
  guid: string;
  name: string;
  class: string | null;
  /** pulls da prog em que jogou */
  pulls: number;
  /** mortes por pull (sem call de wipe nem wipe geral) */
  deaths: number;
  /** parte das mortes em que ainda havia pot/defensivo/healthstone livre, por pull */
  free: number;
  /** vezes como primeira morte do pull, por pull */
  first: number;
  /** mortes por pull nos melhores pulls (20% de cada noite); null com menos de MIN_BEST_PLAYED jogados */
  bestRate: number | null;
}

export interface DeathTable {
  /** quem mais morre (só com mortes) e quem menos morre, do 1º ao 5º; sem repetir player entre os dois */
  most: DeathRow[];
  least: DeathRow[];
  /** maior taxa de mortes por pull entre todos os candidatos: a barra é deaths/scale */
  scale: number;
}

/** Quantos players cada destaque mostra. */
export const PROG_AWARD_TOP = 3;
/** Quantos players a tabela de mortes mostra de cada lado. */
export const DEATH_TABLE_TOP = 5;

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
  deathTable: DeathTable;
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
  /** mortes com pot/defensivo/healthstone livre */
  freeDeaths: number;
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
  /** melhores pulls (20% de cada noite) jogados e mortes contadas neles; mortes contadas em todos os pulls */
  bestPlayed: number;
  bestDeaths: number;
  countedDeaths: number;
  /** pulls da prog (wipes) que o player causou, e por qual caminho */
  wipesCaused: number;
  wipeByDeath: number;
  wipeByMechanic: number;
  wipeByTank: number;
};

interface WipeCulprit {
  death: boolean;
  mechanic: boolean;
  tank: boolean;
}

/** Quem causou o wipe deste pull (cada player uma vez): morte decisiva, falha na mecânica que puxou, tank da call. */
function wipeCulprits(p: Pull): Map<string, WipeCulprit> {
  const out = new Map<string, WipeCulprit>();
  const mark = (guid: string, how: keyof WipeCulprit) => {
    const c = out.get(guid) ?? { death: false, mechanic: false, tank: false };
    c[how] = true;
    out.set(guid, c);
  };
  if (p.success) return out;
  for (const d of countedEarlyDeaths(p)) {
    if (p.durationMs - d.t <= DECISIVE_MS) mark(d.guid, 'death');
  }
  // a mecânica que puxou o wipe: só as de culpa pessoal (ou falha de evento) apontam jogadores
  const blame = (m: Pull['mechanics'][number] | undefined) => {
    if (!m || !(PERSONAL_BLAME.has(m.kind) || m.kind === 'failure_event')) return;
    for (const x of m.players) if (!x.credit) mark(x.guid, 'mechanic');
  };
  const cause = wipeCause(p);
  if (cause) blame(p.mechanics.find((m) => m.key === cause.key));
  const wt = p.wipeCall?.trigger;
  if (wt?.kind === 'mechanic') {
    blame(p.mechanics.find((m) => (wt.spellId != null && m.spellId === wt.spellId) || (!!wt.spell && m.name === wt.spell) || (!!wt.name && m.name === wt.name)));
  }
  if (wt?.kind === 'tank' && wt.name) {
    const tank = p.players.find((x) => x.name === wt.name || shortName(x.name) === shortName(wt.name!));
    if (tank) mark(tank.guid, 'tank');
  }
  return out;
}

const perPull = (n: number, pulls: number) => (pulls ? n / pulls : 0);

/**
 * Destaques da progressão: melhores e piores nos pulls antes da 1ª kill, só entre quem jogou ao
 * menos 30% deles. Mortes depois da call de wipe (`ignored`) e de wipe geral ficam de fora; empate
 * fica com quem jogou mais pulls. Um player não aparece como melhor e pior do mesmo critério.
 */
export function progAwards(nights: TrendNight[]): ProgAwards {
  return progBoard(nights).awards;
}

/** Tabela "quem mais / menos morre" da progressão (mesmos candidatos e regras dos destaques). */
export function progDeathTable(nights: TrendNight[]): DeathTable {
  return progBoard(nights).deathTable;
}

const EMPTY_DEATH_TABLE: DeathTable = { most: [], least: [], scale: 0 };

function progBoard(nights: TrendNight[]): { awards: ProgAwards; deathTable: DeathTable } {
  const { wipes, kill } = progPulls(nights);
  if (!wipes.length) return { awards: {}, deathTable: EMPTY_DEATH_TABLE };
  const minPulls = Math.max(1, Math.ceil(wipes.length * PROG_AWARD_SHARE));
  const acc = new Map<string, ProgAcc>();
  let damageTracked = false;
  let errorsTracked = false;
  // melhores pulls: os 20% que chegaram mais longe em cada noite, entre os pulls da prog
  const phases = phaseCountOf(wipes);
  const bestSet = new Set<Pull>();
  const inProg = new Set(wipes);
  for (const n of nights) {
    for (const p of bestPulls(n.summary.pulls.filter((x) => inProg.has(x)), phases)) bestSet.add(p);
  }
  for (const p of wipes) {
    const scores = scorePull(p);
    const roleOf = new Map(p.players.map((x) => [x.guid, x.role]));
    const mass = massDeathKeys(p.deaths);
    const sorted = [...p.deaths].filter((d) => !d.ignored).sort((a, b) => a.t - b.t);
    for (const pl of p.players) {
      const a = acc.get(pl.guid) ?? { guid: pl.guid, name: pl.name, class: pl.class, pulls: 0, scoreSum: 0, damage: 0, deaths: 0, freeDeaths: 0, tank: false, mechErrors: 0, aliveSum: 0, firstDeaths: 0, scores: [], bestPlayed: 0, bestDeaths: 0, countedDeaths: 0, wipesCaused: 0, wipeByDeath: 0, wipeByMechanic: 0, wipeByTank: 0 };
      a.name = pl.name;
      a.class ||= pl.class;
      a.tank ||= pl.role === 'tank';
      a.pulls++;
      a.scoreSum += scores.get(pl.guid)?.score ?? 0;
      const sc = scores.get(pl.guid);
      if (sc) a.scores.push(sc.score);
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
    const isBest = bestSet.has(p);
    if (isBest) for (const pl of p.players) {
      const a = acc.get(pl.guid);
      if (a) a.bestPlayed++;
    }
    // só as 3 primeiras mortes que contam (sem call de wipe nem wipe geral)
    for (const d of countedEarlyDeaths(p)) {
      const a = acc.get(d.guid);
      if (!a) continue;
      a.countedDeaths++;
      if (isBest) a.bestDeaths++;
    }
    for (const d of p.deaths) {
      if (d.ignored || mass.has(deathKey(d))) continue;
      const a = acc.get(d.guid);
      if (!a) continue;
      a.deaths++;
      if (unusedAtDeath(d).length) a.freeDeaths++;
    }
    // quem causou o wipe: por morte decisiva, por falha na mecânica que puxou, ou o tank da call
    const culprits = wipeCulprits(p);
    for (const [guid, c] of culprits) {
      const a = acc.get(guid);
      if (!a) continue;
      a.wipesCaused++;
      if (c.death) a.wipeByDeath++;
      if (c.mechanic) a.wipeByMechanic++;
      if (c.tank) a.wipeByTank++;
    }
  }

  const cands = [...acc.values()].filter((a) => a.pulls >= minPulls);
  if (!cands.length) return { awards: {}, deathTable: EMPTY_DEATH_TABLE };
  const rank = (pool: ProgAcc[], metric: (a: ProgAcc) => number, dir: 'asc' | 'desc', exclude = new Set<string>()) =>
    pool
      .filter((a) => !exclude.has(a.guid))
      .sort((a, b) => (dir === 'asc' ? metric(a) - metric(b) : metric(b) - metric(a)) || b.pulls - a.pulls || a.name.localeCompare(b.name));
  const winner = (a: ProgAcc, value: number, scale: number, extra: Partial<ProgAwardWinner> = {}): ProgAwardWinner => ({
    guid: a.guid,
    name: a.name,
    class: a.class,
    value,
    pulls: a.pulls,
    scale,
    ...extra,
  });
  const out: ProgAwards = {};

  /** Os melhores (menor valor ou maior nota) e os piores sem repetir quem já está no top do lado oposto; valor 0 não entra no negativo. */
  const pair = (
    goodKey: ProgAwardKey | null,
    badKey: ProgAwardKey | null,
    metric: (a: ProgAcc) => number,
    goodDir: 'asc' | 'desc',
    eligible: (a: ProgAcc) => boolean = () => true,
    fixedScale?: number,
  ) => {
    const pool = cands.filter(eligible);
    const scale = fixedScale ?? Math.max(0, ...pool.map(metric));
    const top = (list: ProgAcc[]) => list.slice(0, PROG_AWARD_TOP).map((a) => winner(a, metric(a), scale));
    const good = rank(pool, metric, goodDir).slice(0, PROG_AWARD_TOP);
    if (goodKey && good.length) out[goodKey] = top(good);
    if (badKey) {
      const taken = new Set(good.map((a) => a.guid));
      const bad = rank(pool, metric, goodDir === 'asc' ? 'desc' : 'asc', taken).filter((a) => metric(a) > 0);
      if (bad.length) out[badKey] = top(bad);
    }
  };

  pair('bestScore', null, (a) => perPull(a.scoreSum, a.pulls), 'desc', undefined, 100);
  // dano tomado: tanks ficam de fora; healers concorrem com os DPS
  if (damageTracked) pair('leastDamage', 'mostDamage', (a) => perPull(a.damage, a.pulls), 'asc', (a) => !a.tank);
  if (errorsTracked) pair('fewestMechErrors', 'mostMechErrors', (a) => perPull(a.mechErrors, a.pulls), 'asc');
  pair('mostTimeAlive', null, (a) => perPull(a.aliveSum, a.pulls), 'desc', undefined, 1);

  // quem mais causou wipes, de qualquer forma (morte decisiva, mecânica que puxou, tank da call)
  const wipeValue = (a: ProgAcc) => perPull(a.wipesCaused, a.pulls);
  const wipeScale = Math.max(0, ...cands.map(wipeValue));
  const wipeTop = rank(cands.filter((a) => a.wipesCaused > 0), wipeValue, 'desc').slice(0, PROG_AWARD_TOP);
  if (wipeTop.length) {
    out.mostWipesCaused = wipeTop.map((a) => winner(a, wipeValue(a), wipeScale, { byDeath: a.wipeByDeath, byMechanic: a.wipeByMechanic, byTank: a.wipeByTank }));
  }

  // começo x fim da prog: metades das notas pull a pull; só entra quem tem nota nas duas metades
  const moves = cands.flatMap((a) => {
    const h = halves(a.scores);
    return h ? [{ a, from: Math.round(h[0]), to: Math.round(h[1]) }] : [];
  });
  const moveScale = Math.max(0, ...moves.map((x) => Math.abs(x.to - x.from)));
  const moveOut = (key: 'mostImproved' | 'mostWorsened', list: typeof moves) => {
    const ranked = list.sort((x, y) => (key === 'mostImproved' ? y.to - y.from - (x.to - x.from) : x.to - x.from - (y.to - y.from)) || y.a.pulls - x.a.pulls || x.a.name.localeCompare(y.a.name));
    if (ranked.length) out[key] = ranked.slice(0, PROG_AWARD_TOP).map((x) => winner(x.a, x.to - x.from, moveScale, { from: x.from, to: x.to }));
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
    if (parsed.length) out.bestKillParse = parsed.slice(0, PROG_AWARD_TOP).map((x) => winner(x.a, x.perf, 100));
  }

  // tabela de mortes: quem menos morre (5) e quem mais morre (5, sem repetir os de cima; só com mortes).
  // Nos melhores pulls só há taxa com no mínimo MIN_BEST_PLAYED melhores pulls jogados.
  const row = (a: ProgAcc): DeathRow => ({
    guid: a.guid,
    name: a.name,
    class: a.class,
    pulls: a.pulls,
    deaths: perPull(a.deaths, a.pulls),
    free: perPull(a.freeDeaths, a.pulls),
    first: perPull(a.firstDeaths, a.pulls),
    bestRate: a.bestPlayed >= MIN_BEST_PLAYED ? perPull(a.bestDeaths, a.bestPlayed) : null,
  });
  const deathRate = (a: ProgAcc) => perPull(a.deaths, a.pulls);
  // raide pequena: o "menos" fica com a metade de cima (arredondada para cima) e o "mais" com o resto, sem repetir ninguém
  const leastPool = rank([...cands], deathRate, 'asc').slice(0, Math.min(DEATH_TABLE_TOP, Math.ceil(cands.length / 2)));
  const leastIds = new Set(leastPool.map((a) => a.guid));
  const mostPool = rank([...cands], deathRate, 'desc', leastIds).filter((a) => a.deaths > 0).slice(0, DEATH_TABLE_TOP);
  // todo mundo do "menos" sem nenhuma morte (2 ou mais) não separa ninguém: some, como nos outros destaques
  const hideLeast = leastPool.length >= 2 && leastPool.every((a) => a.deaths === 0);
  const deathTable: DeathTable = {
    most: mostPool.map(row),
    least: hideLeast ? [] : leastPool.map(row),
    scale: Math.max(0, ...cands.map(deathRate)),
  };

  // categoria em que o top inteiro empata no valor perfeito (todo mundo 100% vivo, ninguém com morte
  // ou erro) não separa ninguém: some. Empate em outro valor (três com 0,28) ainda diz algo e fica.
  for (const key of Object.keys(out) as ProgAwardKey[]) {
    if (key === 'mostImproved' || key === 'mostWorsened') continue; // mostram de → para, que difere
    const list = out[key]!;
    const shown = (v: number) => (key === 'mostTimeAlive' ? Math.round(v * 100) : Math.round(v * 100) / 100);
    const perfect = key === 'mostTimeAlive' ? shown(list[0].value) >= 100 : shown(list[0].value) === 0;
    if (list.length >= 2 && perfect && list.every((x) => shown(x.value) === shown(list[0].value))) delete out[key];
  }

  return { awards: out, deathTable };
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

  return { nights, causes, players, ...playerMoves(players), progression: progressionOf(nights), progAwards: progAwards(nights), deathTable: progDeathTable(nights), insights: insights(nights, causes, players) };
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
