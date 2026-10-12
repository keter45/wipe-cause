// O healer comparado com logs de referência, não com os tops (regras em docs/healer-analysis.md):
// a cura dos tops engana (raid tomando dano a mais, poucos healers), então a referência são kills no
// mítico com composição de healers parecida com a nossa, sem os logs distorcidos. Os logs vêm de
// src/data/heal-refs (scripts/rotation/heal-bench.mjs), um a um, para a escolha ser feita aqui.
//
// O HPS nunca vira nota: fica no contexto. Dica só quando a referência cumpre o que se cobra e o
// player está fora da faixa dela.

import type { PlayerStats, Pull } from '../types';
import { SPEC_NAMES } from './specs';
import { anchorTimes } from './benchMetrics';
import { anchoredMoments, type AnchoredMoment, type Anchors } from './cdAnchors';

export interface HealRefEntry {
  name: string;
  code: string;
  fight: number;
  region?: string;
  /** specs dos healers do fight ("Holy Paladin"), o próprio incluído */
  healers: string[];
  players: number;
  /** fatia da cura dos healers */
  share: number;
  /** dano tomado pela raid por segundo */
  dtps: number;
  durationMs: number;
  startTime?: number;
  hps: number;
  idle: number | null;
  manaEnd: number | null;
  manaMid: number | null;
  overheal: number;
  spells: Record<string, { share: number; overheal: number }>;
  checks: Record<string, number | null>;
  cooldowns: Record<string, number | null>;
  /** casts de cada habilidade na luta (análises antigas não têm) */
  casts?: Record<string, number>;
  /** usos possíveis de cada cooldown no tempo vivo (análises antigas não têm) */
  cdPossible?: Record<string, number>;
  /** momentos de uso dos cooldowns grandes, em fração da luta */
  cdTimes: Record<string, number[]>;
  /** usos dos cooldowns grandes (ms do pull) e os casts do boss que servem de marco: momento por mecânica */
  cdUses?: Record<string, number[]>;
  anchors?: Anchors;
  ally: Record<string, { uptime: number; targets: number }>;
}

export interface SpecRefs {
  spec: number;
  name: string;
  names: Record<string, string>;
  /** tipo de cada checagem do YAML e os buffs na raid que têm checagem própria (para a calibração) */
  kinds?: Record<string, string>;
  checkedAlly?: number[];
  bosses: Record<string, HealRefEntry[]>;
}

const files = import.meta.glob<SpecRefs>('../data/heal-refs/*.json', {
  eager: true,
  import: 'default',
});
const bySpec = new Map(Object.values(files).map((b) => [b.spec, b]));
export const allHealRefs = () => [...bySpec.values()];

const LEECH = 143924;
/** Menos que isso de logs de referência: só os números, sem dica. */
export const MIN_REFS = 3;
/** Logs usados na referência (os de composição mais parecida). */
const MAX_REFS = 8;
/** Raid tomando mais que isso × a mediana dos candidatos: log distorcido. */
const DTPS_OUTLIER = 1.35;
/** Healer com mais que isso × a fatia "justa" (1 / nº de healers): cura concentrada nele. */
const SHARE_OUTLIER = 1.6;
/** Mais momentos que isso na luta: o cooldown é curto ou tem recarga reduzida, não marca mecânica. */
const MAX_MOMENTS = 6;
/** Janela para dizer que um cooldown saiu "no mesmo momento" que nos logs de referência. */
export const CD_WINDOW_MS = 12_000;
/** Momento em que pelo menos esta fração dos logs de referência usou o cooldown... */
const CD_MOMENT_SHARE = 0.75;
/** ...com pelo menos estes logs (com menos, "a maioria" é estilo de duas raids). */
const CD_MOMENT_MIN_REFS = 5;
/** A referência "cumpre" a checagem: mediana acima disso. */
const REF_FULFILLS = 0.85;

/** "Holy Paladin" para um spec id (como o Warcraft Logs escreve nas composições). */
export function healerSpecName(specId: number | null | undefined): string | null {
  const s = specId != null ? SPEC_NAMES[specId] : undefined;
  return s ? `${s.spec} ${s.class}` : null;
}

export const hasHealRefs = (specId: number | null | undefined) => specId != null && bySpec.has(specId);

/** Specs dos healers do pull (o player incluído), em ordem. */
export function pullHealers(pull: Pull): string[] {
  return pull.players
    .filter((p) => p.role === 'healer')
    .map((p) => healerSpecName(p.specId) ?? '?')
    .sort();
}

/** Quantas specs de healer (sem contar a do próprio player uma vez) as duas composições têm em comum. */
function overlap(ours: string[], theirs: string[], self: string): number {
  const a = [...ours];
  const b = [...theirs];
  for (const list of [a, b]) {
    const i = list.indexOf(self);
    if (i >= 0) list.splice(i, 1);
  }
  let n = 0;
  for (const s of a) {
    const i = b.indexOf(s);
    if (i >= 0) {
      n++;
      b.splice(i, 1);
    }
  }
  return n;
}

const median = (xs: number[]) => quantile(xs, 0.5);
function quantile(xs: number[], q: number): number | null {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i);
  return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo);
}

export interface Band {
  median: number;
  p25: number;
  p75: number;
}
function band(xs: (number | null | undefined)[]): Band | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  if (!v.length) return null;
  return {
    median: median(v)!,
    p25: quantile(v, 0.25)!,
    p75: quantile(v, 0.75)!,
  };
}

export interface HealRefSelection {
  /** logs de referência usados (nunca da nossa raid: são os players que queremos ajudar) */
  entries: HealRefEntry[];
  /** candidatos do boss antes dos filtros e quantos caíram por log distorcido */
  candidates: number;
  distorted: number;
  /** a composição não bateu: usou ±1 healer */
  looseCount: boolean;
  ourHealers: string[];
  names: Record<string, string>;
}

/**
 * Referência do healer neste pull: os logs de referência do boss com a mesma quantidade de healers
 * (±1 se faltar), sem os distorcidos e ordenados pela composição mais parecida. Nunca um healer da
 * nossa raid (nem o colega da mesma spec no mesmo pull): eles são quem a análise quer ajudar, não o
 * exemplo.
 */
export function selectHealRefs(pull: Pull, me: PlayerStats): HealRefSelection | null {
  if (me.role !== 'healer') return null;
  const ourHealers = pullHealers(pull);
  const refs = me.specId != null ? bySpec.get(me.specId) : undefined;
  const names = refs?.names ?? {};
  if (!refs) return null;
  const all = refs.bosses[pull.encounterName] ?? [];
  if (!all.length)
    return {
      entries: [],
      candidates: 0,
      distorted: 0,
      looseCount: false,
      ourHealers,
      names,
    };

  const { entries, distorted, looseCount } = pickRefs(all, ourHealers, healerSpecName(me.specId) ?? '', pull.analyzedMs);
  return {
    entries,
    candidates: all.length,
    distorted,
    looseCount,
    ourHealers,
    names,
  };
}

/**
 * Dos logs de referência de um boss: tira os distorcidos (raid tomando dano demais, cura concentrada
 * num healer), fica com os de mesma quantidade de healers (±1 se faltar) e ordena pela composição
 * mais parecida e pela duração.
 */
export function pickRefs(all: HealRefEntry[], ourHealers: string[], self: string, durationMs: number) {
  const dtpsMed = median(all.map((e) => e.dtps)) ?? 0;
  const clean = all.filter((e) => !(dtpsMed > 0 && e.dtps > dtpsMed * DTPS_OUTLIER) && !(e.share > SHARE_OUTLIER / Math.max(1, e.healers.length)));
  let pool = clean.filter((e) => e.healers.length === ourHealers.length);
  let looseCount = false;
  if (pool.length < MIN_REFS) {
    pool = clean.filter((e) => Math.abs(e.healers.length - ourHealers.length) <= 1);
    looseCount = pool.some((e) => e.healers.length !== ourHealers.length);
  }
  const entries = [...pool]
    .sort((a, b) => overlap(ourHealers, b.healers, self) - overlap(ourHealers, a.healers, self) || Math.abs(a.durationMs - durationMs) - Math.abs(b.durationMs - durationMs))
    .slice(0, MAX_REFS);
  return { entries, distorted: all.length - clean.length, looseCount };
}

// ---------------------------------------------------------------- os números do player

/** O mesmo resumo de um log de referência, tirado de um player do pull (o nosso healer ou o colega). */
export function summarize(pull: Pull, p: PlayerStats): HealRefEntry {
  const r = p.rotation;
  const secs = pull.analyzedMs / 1000;
  const total = p.healingDone || 1;
  const over = new Map((p.overhealBySpell ?? []).map((s) => [s.spellId, s.amount]));
  const overTotal = [...over.values()].reduce((a, b) => a + b, 0);
  const cdTimes: Record<string, number[]> = {};
  const cdUses: Record<string, number[]> = {};
  for (const c of r?.cooldowns ?? []) {
    if (c.possible > 10) continue;
    cdUses[c.spellId] = (p.casts ?? []).filter((x) => x.spellId === c.spellId).flatMap((x) => x.times);
    cdTimes[c.spellId] = cdUses[c.spellId].map((t) => t / pull.analyzedMs);
  }
  const damageTaken = pull.players.reduce((a, x) => a + x.damageTaken, 0);
  const healers = pull.players.filter((x) => x.role === 'healer');
  const healersTotal = healers.reduce((a, x) => a + x.healingDone, 0);
  return {
    name: p.name,
    code: '',
    fight: pull.id,
    healers: pullHealers(pull),
    players: pull.players.length,
    share: healersTotal ? p.healingDone / healersTotal : 0,
    dtps: Math.round(damageTaken / secs),
    durationMs: pull.analyzedMs,
    hps: Math.round(p.healingDone / secs),
    idle: r && r.activeMs > 0 ? r.downtimeMs / r.activeMs : null,
    manaEnd: p.manaTimeline?.length ? p.manaTimeline[p.manaTimeline.length - 1] : null,
    manaMid: p.manaTimeline?.length ? p.manaTimeline[Math.floor(p.manaTimeline.length / 2)] : null,
    overheal: overTotal / (total + overTotal),
    spells: Object.fromEntries(
      (p.healingBySpell ?? []).map((s) => [
        s.spellId,
        {
          share: s.amount / total,
          overheal: (over.get(s.spellId) ?? 0) / (s.amount + (over.get(s.spellId) ?? 0)),
        },
      ]),
    ),
    checks: Object.fromEntries((r?.findings ?? []).map((f) => [f.id, f.rate])),
    cooldowns: Object.fromEntries((r?.cooldowns ?? []).map((c) => [c.spellId, c.usage])),
    cdPossible: Object.fromEntries((r?.cooldowns ?? []).map((c) => [c.spellId, c.possible])),
    casts: Object.fromEntries((p.casts ?? []).map((c) => [c.spellId, c.times.length])),
    cdTimes,
    cdUses,
    anchors: Object.fromEntries([...anchorTimes(pull)].map(([id, a]) => [id, a.times])),
    ally: Object.fromEntries((r?.uptimes ?? []).filter((u) => u.kind === 'ally').map((u) => [u.id, { uptime: u.uptime, targets: u.targets ?? 0 }])),
  };
}

// ---------------------------------------------------------------- comparação

export type HealTipKind = 'check' | 'cooldown' | 'manaLeft' | 'manaOut' | 'idle' | 'overheal' | 'ally';

export interface HealTip {
  kind: HealTipKind;
  /** ordem da seção 4 do documento: cooldowns, sequências/procs, recarga fixa, buffs, mana/ócio, overheal */
  rank: number;
  spellId?: number;
  name?: string;
  checkId?: string;
  you: number;
  ref: Band;
  /** momentos (ms) para o replay */
  times: number[];
}

export interface HealContext {
  you: HealRefEntry;
  hps: Band | null;
  share: Band | null;
  dtps: Band | null;
  /** as habilidades que mais curam: fatia da cura, overheal e casts, seus e a mediana da referência */
  mix: MixRow[];
  /**
   * Momentos em que a maioria da referência usa cada cooldown grande, e os seus (ms). Informação,
   * não dica: na calibração, usar em outro momento era estratégia e ritmo de cada raid.
   */
  moments: CdMoments[];
}

/**
 * Momentos de um cooldown grande. `anchored`: presos à mecânica do boss ("2ª Stir the Depths + 3 s"),
 * quando os logs de referência trazem os casts do boss; senão `ref`/`you` em tempo de luta (ms).
 */
export interface CdMoments {
  spellId: number;
  name: string;
  anchored: (AnchoredMoment & { anchorName: string })[] | null;
  ref: number[];
  you: number[];
}

export interface MixRow {
  spellId: number;
  name: string;
  you: number;
  ref: number | null;
  overYou: number;
  overRef: number | null;
  /** casts da habilidade que gera esta cura (null: a cura não vem de um botão, ex.: Beacon of Light) */
  castsYou: number | null;
  /** mediana da referência ajustada para a duração da sua luta */
  castsRef: number | null;
}

export interface HealComparison {
  sel: HealRefSelection;
  context: HealContext;
  /** sem base para dica (poucos logs): só números */
  numbersOnly: boolean;
  tips: HealTip[];
}

const rate = (x: number | null | undefined) => (x == null ? null : x);

/** Fração dos logs que precisa usar o cooldown na mesma mecânica para ela virar momento da referência. */
const ANCHOR_SHARE = 0.6;

function cooldownMoments(you: HealRefEntry, refs: HealRefEntry[], nameOf: (id: string | number) => string): CdMoments[] {
  const anchoredRefs = refs.filter((e) => e.anchors && e.cdUses);
  return (
    Object.keys(you.cdTimes)
      .map((id): CdMoments => {
        const yours = you.cdTimes[id].map((f) => f * you.durationMs);
        const anchored =
          you.anchors && you.cdUses && anchoredRefs.length >= CD_MOMENT_MIN_REFS
            ? anchoredMoments(
                anchoredRefs.map((e) => ({ anchors: e.anchors!, uses: e.cdUses![id] ?? [] })),
                { anchors: you.anchors, uses: you.cdUses[id] ?? [] },
                ANCHOR_SHARE,
                CD_MOMENT_MIN_REFS,
              ).map((m) => ({ ...m, anchorName: nameOf(m.anchor) }))
            : null;
        return { spellId: +id, name: nameOf(id), anchored, ref: anchored ? [] : cdMoments(refs, id), you: yours };
      })
      // só cooldown grande de verdade: com recarga reduzida (Holy Word: Serenity) vira uma lista de horários
      .filter((m) => {
        const n = m.anchored ? m.anchored.length : m.ref.length;
        return n > 0 && n <= MAX_MOMENTS && m.you.length <= MAX_MOMENTS * 2;
      })
  );
}

/** Momentos (ms) em que pelo menos CD_MOMENT_SHARE dos logs usaram o cooldown, juntando os vizinhos. */
function cdMoments(refs: HealRefEntry[], spellId: string): number[] {
  const uses = refs.map((e) => (e.cdTimes[spellId] ?? []).map((f) => f * e.durationMs));
  const all = uses.flat().sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) {
    const n = uses.filter((u) => u.some((x) => Math.abs(x - t) <= CD_WINDOW_MS)).length;
    if (n / refs.length >= CD_MOMENT_SHARE && !out.some((m) => Math.abs(m - t) <= CD_WINDOW_MS * 2)) out.push(t);
  }
  return out;
}

/**
 * Habilidade lançada que gera esta cura: o mesmo id, ou o cast com o mesmo nome (Holy Shock cura com
 * outro id). Sem cast (Beacon of Light, Atonement, procs): null.
 */
function castOf(me: PlayerStats, healId: number, name: string): number | null {
  const casts = me.casts ?? [];
  if (casts.some((c) => c.spellId === healId)) return healId;
  return casts.find((c) => c.name.toLowerCase() === name.toLowerCase())?.spellId ?? null;
}

export function compareHealer(pull: Pull, me: PlayerStats): HealComparison | null {
  const sel = selectHealRefs(pull, me);
  if (!sel || !me.rotation) return null;
  const you = summarize(pull, me);
  const refs = sel.entries;
  const names = { ...sel.names };
  // os nomes do nosso log primeiro (a referência mistura línguas)
  for (const e of pull.enemySpells) names[e.spellId] = e.name;
  for (const s of me.healingBySpell ?? []) names[s.spellId] = s.name;
  for (const c of me.rotation.cooldowns) names[c.spellId] = c.name;
  for (const u of me.rotation.uptimes ?? []) names[u.id] = u.name;
  const nameOf = (id: string | number) => names[id] ?? `#${id}`;

  const mixIds = Object.entries(you.spells)
    .sort((a, b) => b[1].share - a[1].share)
    .slice(0, 8)
    .map(([id]) => id);
  const context: HealContext = {
    you,
    hps: band(refs.map((e) => e.hps)),
    share: band(refs.map((e) => e.share)),
    dtps: band(refs.map((e) => e.dtps)),
    moments: refs.length >= CD_MOMENT_MIN_REFS ? cooldownMoments(you, refs, nameOf) : [],
    mix: mixIds.map((id) => {
      const castId = castOf(me, +id, nameOf(id));
      const withCasts = refs.filter((e) => e.casts);
      return {
        spellId: +id,
        name: nameOf(id),
        you: you.spells[id].share,
        ref: median(refs.map((e) => e.spells[id]?.share ?? 0)),
        overYou: you.spells[id].overheal,
        overRef: median(refs.filter((e) => e.spells[id]).map((e) => e.spells[id].overheal)),
        castsYou: castId != null ? (you.casts?.[castId] ?? 0) : null,
        castsRef: castId != null && withCasts.length ? median(withCasts.map((e) => ((e.casts?.[castId] ?? 0) / e.durationMs) * you.durationMs)) : null,
      };
    }),
  };
  const numbersOnly = refs.length < MIN_REFS;
  const tips = numbersOnly
    ? []
    : healTips(you, refs, {
        kindOf: new Map(me.rotation.findings.map((f) => [f.id, f.kind ?? ''])),
        timesOf: new Map(me.rotation.findings.map((f) => [f.id, f.times])),
        checkedAlly: new Set(me.rotation.findings.filter((f) => f.kind === 'ally_uptime' && f.spellId != null).map((f) => f.spellId!)),
        manaTimeline: me.manaTimeline ?? [],
        success: pull.success,
        nameOf,
      });
  return { sel, context, numbersOnly, tips };
}

export interface TipInput {
  /** tipo de cada checagem (proc, cooldown, downtime, ally_uptime...) e os momentos dos erros */
  kindOf: Map<string, string>;
  timesOf: Map<string, number[]>;
  /** buffs na raid que já têm checagem própria no YAML */
  checkedAlly: Set<number>;
  manaTimeline: number[];
  success: boolean;
  nameOf: (id: string | number) => string;
}

/**
 * Dicas do healer contra os logs de referência: só onde a referência cumpre o que se cobra e o player
 * está fora da faixa dela. Separada da escolha da referência para a calibração (log de referência
 * contra os outros do mesmo boss) usar a mesma regra.
 */
export function healTips(you: HealRefEntry, refs: HealRefEntry[], x: TipInput): HealTip[] {
  const { nameOf } = x;
  const single = refs.length === 1;
  const mixIds = Object.entries(you.spells)
    .sort((a, b) => b[1].share - a[1].share)
    .slice(0, 8)
    .map(([id]) => id);
  const tips: HealTip[] = [];
  // checagens da spec (procs, combinações, recurso, tempo parado), só onde a referência cumpre
  for (const [id, v] of Object.entries(you.checks)) {
    const b = band(refs.map((e) => rate(e.checks[id])));
    // checagem de cooldown do YAML: já sai, mais detalhada, no uso de cada cooldown (abaixo)
    if (v == null || !b || b.median < REF_FULFILLS || x.kindOf.get(id) === 'cooldown') continue;
    const gap = b.median - v;
    const kind = x.kindOf.get(id);
    // procs variam mais de luta para luta: pede uma diferença maior; tempo parado fica sempre perto de
    // 100%, então poucos pontos já são muito (12% parado contra 5% da referência)
    const minGap = single ? 0.2 : kind === 'proc' ? 0.15 : kind === 'downtime' ? 0.05 : 0.12;
    if (gap >= minGap && v < b.p25 - (kind === 'downtime' ? 0.02 : 0.05)) {
      const rank = kind === 'cooldown' ? 2 : kind === 'downtime' ? 4 : kind === 'ally_uptime' ? 3 : 1;
      tips.push({
        kind: 'check',
        rank,
        checkId: id,
        you: v,
        ref: b,
        times: x.timesOf.get(id) ?? [],
      });
    }
  }
  // uso de cada cooldown: o uso anda em passos grandes (1 de 3 = 33%), então pede tantos logs
  // quanto o momento do cooldown
  for (const [id, v] of refs.length >= CD_MOMENT_MIN_REFS || single ? Object.entries(you.cooldowns) : []) {
    const b = band(refs.map((e) => rate(e.cooldowns[id])));
    // só cooldown que a referência usa quase sempre todas as vezes (segurar para uma mecânica é estratégia)
    if (v == null || !b || b.p25 < 0.75) continue;
    // com 1 ou 2 usos possíveis, guardar um para a mecânica é estratégia: só cobra quem não usou nenhum
    const possible = you.cdPossible?.[id] ?? 3;
    if (possible < 3 && v > 0) continue;
    // usos de diferença: pular o último uso, perto do fim da luta, é comum até na referência; cobra 2
    // usos atrás (ou 1 em cooldown curto, com 5+ usos na luta) ou nenhum uso
    const behind = (b.median - v) * possible;
    if (v > 0 && behind < (possible >= 5 ? 1 : 2) - 0.01) continue;
    if (b.median - v >= (single ? 0.3 : 0.25) && v < b.p25 - 0.05)
      tips.push({
        kind: 'cooldown',
        rank: 0,
        spellId: +id,
        name: nameOf(id),
        you: v,
        ref: b,
        times: [],
      });
  }
  // mana: sobrou muita no kill, ou acabou antes do fim
  const mana = band(refs.map((e) => e.manaEnd));
  if (you.manaEnd != null && mana) {
    if (x.success && you.manaEnd >= Math.max(50, mana.p75 + 25))
      tips.push({
        kind: 'manaLeft',
        rank: 4,
        you: you.manaEnd,
        ref: mana,
        times: [],
      });
    const tl = x.manaTimeline;
    const out = tl.findIndex((m) => m <= 2);
    if (out >= 0 && out < tl.length * 0.85 && mana.p25 > 5)
      tips.push({
        kind: 'manaOut',
        rank: 4,
        you: 0,
        ref: mana,
        times: [out * 5000],
      });
  }
  // tempo parado com gente ferida
  const idle = band(refs.map((e) => e.idle));
  if (you.idle != null && idle && you.idle > idle.p75 && you.idle - idle.median >= 0.03 && ![...x.kindOf.values()].includes('downtime'))
    tips.push({ kind: 'idle', rank: 4, you: you.idle, ref: idle, times: [] });
  // overheal das habilidades que mais pesam
  for (const id of mixIds) {
    const s = you.spells[id];
    const b = band(refs.map((e) => e.spells[id]?.overheal));
    // Leech é atributo (cura de todo mundo), não habilidade que o healer escolhe lançar
    if (!b || +id === LEECH || s.share < 0.05 || refs.filter((e) => e.spells[id]).length < Math.min(3, refs.length)) continue;
    if (s.overheal > b.p75 + 0.15)
      tips.push({
        kind: 'overheal',
        rank: 5,
        spellId: +id,
        name: nameOf(id),
        you: s.overheal,
        ref: b,
        times: [],
      });
  }
  // buffs na raid: só os do YAML (checagem ally_uptime, acima); o uptime dos outros HoTs muda com o
  // estilo de cada healer (calibração: dica em referência contra referência)
  tips.sort((a, b) => a.rank - b.rank || b.ref.median - b.you - (a.ref.median - a.you));
  return tips;
}
