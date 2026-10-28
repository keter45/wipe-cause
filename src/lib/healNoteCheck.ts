// Confere a note de CDs contra os pulls: casa cada linha com o cast do player, mede o desvio entre o
// relógio do addon e as fases do app e dá um estado para cada linha. Só funções puras; regras em
// docs/heal-cd-note.md.

import type { PhaseMark, PlayerStats, Pull } from '../types';
import { shortName } from './format';
import { nearestAnchor } from './cdAnchors';
import { castIdsOf, healCd, healCooldowns, type HealCd, type HealCdEffect } from './healCooldowns';
import { band, MIN_REFS, OVERHEAL_MARGIN, type Band, type HealRefEntry } from './healer';
import { quantile } from './quantile';
import { mapPhases, type NoteChange, type ParsedNote } from './healNote';
import { raidLow, type Moment } from './raidHits';

/** Uso a até isso da hora da linha = na hora. */
export const ON_TIME_MS = 10_000;
/** Linha e cast a até isso casam; além disso, "não usou". */
export const PAIR_MS = 30_000;
/** Pares (linha, pull) para o desvio de uma fase ser estável (em pelo menos 2 pulls). */
export const MIN_OFFSET_LINES = 5;
/** Desvio maior que isso não é aplicado (etapa 0: 7–9 s no P2 do The Coiled Altar). */
export const MAX_OFFSET_MS = 12_000;

export type LineState =
  | 'not_evaluated'
  | 'not_in_pull'
  | 'phase_not_reached'
  | 'phase_ended'
  | 'after_cutoff'
  | 'no_spell'
  | 'on_time'
  | 'early'
  | 'late'
  | 'dead'
  | 'not_used';

export interface LineCheck {
  lineIndex: number;
  state: LineState;
  /** por que não foi avaliada */
  why?: 'no_spell_id' | 'everyone' | 'unknown_tag' | 'no_phase';
  /** `no_spell` por talento ou fora da tabela: pode ser CD esquecido a noite toda */
  neverUsed?: boolean;
  guid?: string;
  /** hora ajustada (ms do pull) */
  expectedMs?: number;
  usedMs?: number;
  /** uso − hora ajustada */
  deltaMs?: number;
  /** uso − hora sem ajuste */
  rawDeltaMs?: number;
}

export interface PhaseOffset {
  ph: string;
  offsetMs: number;
  pairs: number;
  pulls: number;
  /** primeira fase (começa no pull): nunca recebe desvio */
  first: boolean;
  applied: boolean;
}

export type NoteOf = (p: Pull) => ParsedNote | null;

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('pt-BR');
const median = (xs: number[]) => quantile(xs, 0.5);

const playerOf = (pull: Pull, tag: string): PlayerStats | undefined => pull.players.find((p) => norm(shortName(p.name)) === norm(tag));

/** Tempos (ms do pull) em que o player castou a spell ou um id alternativo dela. */
function castTimes(p: PlayerStats, spellId: number): number[] {
  const ids = new Set(castIdsOf(spellId));
  return (p.casts ?? []).filter((c) => ids.has(c.spellId)).flatMap((c) => c.times);
}

interface Slot {
  lineIndex: number;
  spellId: number;
  player: PlayerStats;
  expectedMs: number;
  rawMs: number;
}

/** Pares de menor |Δ| primeiro; cada linha e cada cast casam uma vez só. */
function pair(slots: Slot[]): Map<number, number> {
  const cands: { line: number; cast: string; t: number; d: number }[] = [];
  for (const s of slots) {
    for (const t of castTimes(s.player, s.spellId)) {
      const d = t - s.expectedMs;
      if (Math.abs(d) <= PAIR_MS) cands.push({ line: s.lineIndex, cast: `${s.player.guid}:${t}`, t, d });
    }
  }
  cands.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  const out = new Map<number, number>();
  const used = new Set<string>();
  for (const c of cands) {
    if (out.has(c.line) || used.has(c.cast)) continue;
    out.set(c.line, c.t);
    used.add(c.cast);
  }
  return out;
}

/** Phase marks do pull por `ph`, e qual é a seguinte de cada uma. */
function phasesOf(pull: Pull) {
  const byPh = mapPhases(pull.phaseMarks);
  const marks = [...(pull.phaseMarks ?? [])].sort((a, b) => a.t - b.t);
  const phOf = new Map<PhaseMark, string>();
  for (const [ph, m] of byPh) phOf.set(m, ph);
  const next = (m: PhaseMark) => marks.find((x) => x.t > m.t);
  const first = marks[0] ?? { key: 'p1', name: '', t: 0 };
  return { byPh, phOf, next, first };
}

/** `ph` que existe em algum pull do relatório (as outras ficam "não avaliadas"). */
function knownPhs(pulls: Pull[]): Set<string> {
  return new Set(pulls.flatMap((p) => [...mapPhases(p.phaseMarks).keys()]));
}

function roster(pulls: Pull[]): Set<string> {
  return new Set(pulls.flatMap((p) => p.players.map((x) => norm(shortName(x.name)))));
}

/** Slots (linhas avaliáveis) de um pull com a hora esperada; o resto já sai com o estado. */
function slotsOf(pull: Pull, note: ParsedNote, offsets: Map<string, PhaseOffset> | null, phs: Set<string>, names: Set<string>, everCast: (tag: string, spell: number) => boolean) {
  const { byPh, phOf, next } = phasesOf(pull);
  const done: LineCheck[] = [];
  const slots: Slot[] = [];
  const end = pull.cutoffT ?? pull.durationMs;
  const off = (ph: string | undefined) => (ph && offsets?.get(ph)?.applied ? offsets.get(ph)!.offsetMs : 0);
  note.lines.forEach((l, lineIndex) => {
    if (l.ph == null) return;
    const no = (why: LineCheck['why']) => done.push({ lineIndex, state: 'not_evaluated', why });
    if (l.spellId == null) return no('no_spell_id');
    if (!l.tag || norm(l.tag) === 'everyone') return no('everyone');
    if (!names.has(norm(l.tag))) return no('unknown_tag');
    if (!phs.has(l.ph)) return no('no_phase');
    const player = playerOf(pull, l.tag);
    if (!player) return done.push({ lineIndex, state: 'not_in_pull' });
    const mark = byPh.get(l.ph);
    if (!mark) return done.push({ lineIndex, state: 'phase_not_reached', guid: player.guid });
    const rawMs = mark.t + (l.time ?? 0) * 1000;
    const expectedMs = rawMs + off(l.ph);
    const nx = next(mark);
    if (nx && expectedMs >= nx.t + off(phOf.get(nx))) return done.push({ lineIndex, state: 'phase_ended', guid: player.guid, expectedMs });
    if (expectedMs > end) return done.push({ lineIndex, state: 'after_cutoff', guid: player.guid, expectedMs });
    const cd = healCd(l.spellId);
    if (cd?.kind && cd.specs && player.specId != null && !cd.specs.includes(player.specId)) return done.push({ lineIndex, state: 'no_spell', guid: player.guid, expectedMs });
    if ((!cd?.kind || cd.talent) && !everCast(l.tag, l.spellId)) return done.push({ lineIndex, state: 'no_spell', neverUsed: true, guid: player.guid, expectedMs });
    slots.push({ lineIndex, spellId: l.spellId, player, expectedMs, rawMs });
  });
  return { done, slots };
}

function everCastIn(pulls: Pull[]) {
  const memo = new Map<string, boolean>();
  return (tag: string, spell: number) => {
    const k = `${norm(tag)}:${spell}`;
    if (!memo.has(k)) memo.set(k, pulls.some((p) => { const pl = playerOf(p, tag); return !!pl && castTimes(pl, spell).length > 0; }));
    return memo.get(k)!;
  };
}

/** Desvio do relógio do addon em cada fase, medido no primeiro passe (hora sem ajuste). */
export function phaseOffsets(pulls: Pull[], noteOf: NoteOf): Map<string, PhaseOffset> {
  const phs = knownPhs(pulls);
  const names = roster(pulls);
  const ever = everCastIn(pulls);
  const deltas = new Map<string, { d: number; pull: number }[]>();
  const firstPh = new Set<string>();
  for (const pull of pulls) {
    const note = noteOf(pull);
    if (!note) continue;
    const { byPh, first } = phasesOf(pull);
    for (const [ph, m] of byPh) if (m.t === first.t) firstPh.add(ph);
    const { slots } = slotsOf(pull, note, null, phs, names, ever);
    const matched = pair(slots);
    for (const s of slots) {
      const t = matched.get(s.lineIndex);
      const ph = note.lines[s.lineIndex].ph!;
      if (t != null) (deltas.get(ph) ?? deltas.set(ph, []).get(ph)!).push({ d: t - s.rawMs, pull: pull.id });
    }
  }
  const out = new Map<string, PhaseOffset>();
  for (const [ph, ds] of deltas) {
    const offsetMs = median(ds.map((x) => x.d)) ?? 0;
    const nPulls = new Set(ds.map((x) => x.pull)).size;
    const first = firstPh.has(ph);
    const stable = ds.length >= MIN_OFFSET_LINES && nPulls >= 2;
    out.set(ph, { ph, offsetMs, pairs: ds.length, pulls: nPulls, first, applied: !first && stable && Math.abs(offsetMs) <= MAX_OFFSET_MS });
  }
  return out;
}

/** Segundo passe (hora ajustada): o estado de cada linha em cada pull. */
export function matchLines(pulls: Pull[], noteOf: NoteOf, offsets: Map<string, PhaseOffset>): Map<number, LineCheck[]> {
  const phs = knownPhs(pulls);
  const names = roster(pulls);
  const ever = everCastIn(pulls);
  const out = new Map<number, LineCheck[]>();
  for (const pull of pulls) {
    const note = noteOf(pull);
    if (!note) continue;
    const { done, slots } = slotsOf(pull, note, offsets, phs, names, ever);
    const matched = pair(slots);
    const checks = [...done];
    for (const s of slots) {
      const base = { lineIndex: s.lineIndex, guid: s.player.guid, expectedMs: s.expectedMs };
      const t = matched.get(s.lineIndex);
      if (t != null) {
        const d = t - s.expectedMs;
        const state: LineState = Math.abs(d) <= ON_TIME_MS ? 'on_time' : d < 0 ? 'early' : 'late';
        checks.push({ ...base, state, usedMs: t, deltaMs: d, rawDeltaMs: t - s.rawMs });
        continue;
      }
      checks.push({ ...base, state: diedBefore(pull, s.player, s.expectedMs) ? 'dead' : 'not_used' });
    }
    out.set(pull.id, checks.sort((a, b) => a.lineIndex - b.lineIndex));
  }
  return out;
}

/** Morreu antes da hora e não castou nada depois (castar de novo = foi ressuscitado). */
function diedBefore(pull: Pull, p: PlayerStats, at: number): boolean {
  const death = pull.deaths.filter((d) => d.guid === p.guid && d.t < at).sort((a, b) => b.t - a.t)[0];
  if (!death) return false;
  const after = (p.casts ?? []).some((c) => c.times.some((t) => t > death.t && t <= at + PAIR_MS));
  return !after;
}

export interface LineSummary {
  lineIndex: number;
  /** pulls que chegaram na linha */
  reached: number;
  onTime: number;
  early: number;
  late: number;
  dead: number;
  notUsed: number;
  noSpell: number;
  medianDeltaMs: number | null;
  states: Partial<Record<LineState, number>>;
}

const NOT_REACHED: LineState[] = ['not_evaluated', 'not_in_pull', 'phase_not_reached', 'phase_ended', 'after_cutoff'];

/** A tabela da noite por linha de uma versão: só com os pulls que essa versão julgou. */
export function summarizeLines(checks: Map<number, LineCheck[]>, pulls: Pull[]): LineSummary[] {
  const by = new Map<number, LineCheck[]>();
  for (const p of pulls) for (const c of checks.get(p.id) ?? []) (by.get(c.lineIndex) ?? by.set(c.lineIndex, []).get(c.lineIndex)!).push(c);
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lineIndex, cs]) => {
      const states: Partial<Record<LineState, number>> = {};
      for (const c of cs) states[c.state] = (states[c.state] ?? 0) + 1;
      const reached = cs.filter((c) => !NOT_REACHED.includes(c.state)).length;
      return {
        lineIndex,
        reached,
        onTime: states.on_time ?? 0,
        early: states.early ?? 0,
        late: states.late ?? 0,
        dead: states.dead ?? 0,
        notUsed: states.not_used ?? 0,
        noSpell: states.no_spell ?? 0,
        medianDeltaMs: median(cs.filter((c) => c.deltaMs != null).map((c) => c.deltaMs!)),
        states,
      };
    });
}

// ---------------------------------------------------------------------------
// Golpes e uso (etapa 2): cada linha ligada a um momento da noite (raidHits.ts)

/** Cura até isso depois do golpe ainda é recuperação. */
export const RECOVER_MS = 8_000;
/** Quanto antes do golpe a note chama um CD `active` ou `sustained` (uso de ciclo, mover, adicionar). */
export const PREP_MS = 2_000;

/** A janela do efeito do CD usado em `u` cobre o momento [start, end]? */
export function covers(effect: HealCdEffect, u: number, d: number, start: number, end: number): boolean {
  if (effect === 'active') return u <= start + 1_000 && u + d >= start;
  if (effect === 'sustained') return u <= end + RECOVER_MS && u + d >= start;
  return start - 2_000 <= u && u <= end + RECOVER_MS;
}

/** Janela em que um uso precisa ver dano para não ser "sem dano". */
function noDamageWindow(effect: HealCdEffect, u: number, d: number): [number, number] {
  if (effect === 'active') return [u, u + d];
  if (effect === 'sustained') return [u, u + d + RECOVER_MS];
  return [u - 5_000, u + d + RECOVER_MS];
}

const overlaps = (a: number, b: number, c: number, d: number) => a <= d && c <= b;

export interface UseVerdict {
  /** momento da noite que a linha cobre neste pull */
  momentKey: string | null;
  /** o uso cobriu o momento (null = sem momento ou sem uso) */
  onHit: boolean | null;
  /** cura usada sem golpe nem raide baixa na janela dela */
  noDamage: boolean;
  /** linha de ciclo: não recebe veredicto de uso */
  cycle: boolean;
  /** overheal do uso (só CD de cura com `heal_ids` e uso casado) */
  overheal: UseOverheal | null;
  /** dois ou mais usos de cura no mesmo momento, e este com overheal alto */
  stacked: boolean;
}

export interface PullVerdicts {
  lines: Map<number, UseVerdict>;
  /** momentos que o pull alcançou sem nenhuma linha da note */
  uncovered: string[];
  /** raide baixa longe de qualquer momento */
  lowWithoutHit: { start: number; end: number }[];
}

const PLANNED: LineState[] = ['on_time', 'early', 'late', 'not_used', 'dead'];

/** O momento que a linha cobre (pela hora ajustada), o mais perto quando cobre mais de um. */
function momentOf(cd: HealCd, at: number, pullId: number, ms: Moment[]): Moment | null {
  let best: Moment | null = null;
  for (const m of ms) {
    const p = m.pulls.get(pullId);
    if (!p || !covers(cd.effect!, at, cd.duration_ms!, p.at, p.end)) continue;
    if (!best || Math.abs(p.at - at) < Math.abs(best.pulls.get(pullId)!.at - at)) best = m;
  }
  return best;
}

/** Início mais cedo de uma fase (chave da regra) nos pulls: o pior caso, num push rápido. */
function earliestPhaseStart(pulls: Pull[], key: string): number | null {
  const ts = pulls.flatMap((p) => (p.phaseMarks ?? []).filter((m) => m.key === key).map((m) => m.t));
  return ts.length ? Math.min(...ts) : key === 'p1' ? 0 : null;
}

/** Linhas de ciclo de uma versão da note: gastas cedo para o próximo uso estar pronto num momento. */
export function cycleLines(note: ParsedNote, pulls: Pull[], offsets: Map<string, PhaseOffset>, ms: Moment[], associated: Set<number>): Set<number> {
  const marks = new Map<string, string>();
  for (const p of pulls) for (const [ph, m] of mapPhases(p.phaseMarks)) if (!marks.has(ph)) marks.set(ph, m.key);
  const abs = (l: { ph?: string; time?: number }) => {
    const key = l.ph ? marks.get(l.ph) : undefined;
    const start = key ? earliestPhaseStart(pulls, key) : null;
    const off = l.ph && offsets.get(l.ph)?.applied ? offsets.get(l.ph)!.offsetMs : 0;
    return start == null ? null : start + (l.time ?? 0) * 1000 + off;
  };
  const momentAbs = ms
    .map((m) => {
      const s = earliestPhaseStart(pulls, m.phaseKey);
      return s == null ? null : s + m.inPhaseMs;
    })
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  const out = new Set<number>();
  note.lines.forEach((l, i) => {
    const cd = l.spellId != null ? healCd(l.spellId) : undefined;
    if (!cd?.kind || associated.has(i) || !l.tag || cd.cooldown_ms == null) return;
    const at = abs(l);
    if (at == null) return;
    const next = note.lines
      .map((n, j) => ({ n, j, t: abs(n) }))
      .filter(({ n, j, t }) => j !== i && n.spellId === l.spellId && n.tag != null && norm(n.tag) === norm(l.tag!) && t != null && t > at)
      .sort((a, b) => a.t! - b.t!)[0];
    if (!next || !associated.has(next.j)) return;
    const m = momentAbs.find((t) => t > at);
    if (m == null) return;
    const moved = m - (cd.effect === 'burst' ? 0 : PREP_MS);
    if (next.t! - moved < cd.cooldown_ms) out.add(i);
  });
  return out;
}

/**
 * Veredictos de golpe e uso de cada pull: a linha ligada ao momento, se o uso cobriu, "sem dano"
 * (só cura), linhas de ciclo, momentos sem CD e raide baixa sem golpe.
 */
export function judgeUse(pulls: Pull[], noteOf: NoteOf, offsets: Map<string, PhaseOffset>, checks: Map<number, LineCheck[]>, ms: Moment[], refsOf: RefsOf = () => []): Map<number, PullVerdicts> {
  // ligação linha ↔ momento por pull, e quais linhas de cada versão têm momento em algum pull
  const assoc = new Map<number, Map<number, Moment>>();
  const withMoment = new Map<ParsedNote, Set<number>>();
  for (const p of pulls) {
    const note = noteOf(p);
    if (!note) continue;
    const a = new Map<number, Moment>();
    for (const c of checks.get(p.id) ?? []) {
      const l = note.lines[c.lineIndex];
      const cd = l.spellId != null ? healCd(l.spellId) : undefined;
      if (!cd?.kind || c.expectedMs == null || !PLANNED.includes(c.state)) continue;
      const m = momentOf(cd, c.expectedMs, p.id, ms);
      if (!m) continue;
      a.set(c.lineIndex, m);
      (withMoment.get(note) ?? withMoment.set(note, new Set()).get(note)!).add(c.lineIndex);
    }
    assoc.set(p.id, a);
  }
  const cycles = new Map<ParsedNote, Set<number>>();
  const cycleOf = (note: ParsedNote) => {
    if (!cycles.has(note)) cycles.set(note, cycleLines(note, pulls.filter((p) => noteOf(p) === note), offsets, ms, withMoment.get(note) ?? new Set()));
    return cycles.get(note)!;
  };

  const out = new Map<number, PullVerdicts>();
  for (const p of pulls) {
    const note = noteOf(p);
    if (!note) continue;
    const a = assoc.get(p.id)!;
    const low = raidLow(p);
    const mine = ms.filter((m) => m.pulls.has(p.id));
    const span = (m: Moment) => m.pulls.get(p.id)!;
    const lines = new Map<number, UseVerdict>();
    for (const c of checks.get(p.id) ?? []) {
      const l = note.lines[c.lineIndex];
      const cd = l.spellId != null ? healCd(l.spellId) : undefined;
      if (!cd?.kind || !cd.effect || cd.duration_ms == null) continue;
      const m = a.get(c.lineIndex) ?? null;
      const cycle = cycleOf(note).has(c.lineIndex);
      const used = c.usedMs;
      const onHit = m && used != null ? covers(cd.effect, used, cd.duration_ms, span(m).at, span(m).end) : null;
      let noDamage = false;
      if (cd.kind === 'heal' && !cycle && used != null) {
        const [x, y] = noDamageWindow(cd.effect, used, cd.duration_ms);
        noDamage = !mine.some((mm) => overlaps(span(mm).at, span(mm).end, x, y)) && !low.some((e) => overlaps(e.start, e.end, x, y));
      }
      const player = p.players.find((x) => x.guid === c.guid);
      const amounts = player && used != null && !cycle ? overhealOfUse(player, cd, used) : null;
      const overheal = amounts && player ? withRef(amounts, refOverheal(refsOf(p, player), cd)) : null;
      lines.set(c.lineIndex, { momentKey: m?.key ?? null, onHit, noDamage, cycle, overheal, stacked: false });
    }
    // empilhado: curas com heal_ids usadas no mesmo momento; o rótulo vai em quem tem overheal alto
    const byMoment = new Map<string, UseVerdict[]>();
    for (const v of lines.values()) if (v.momentKey && v.overheal) (byMoment.get(v.momentKey) ?? byMoment.set(v.momentKey, []).get(v.momentKey)!).push(v);
    for (const vs of byMoment.values()) if (vs.length >= 2) for (const v of vs) v.stacked = v.overheal!.high;
    const covered = new Set([...a.values()].map((m) => m.key));
    const uncovered = mine.filter((m) => !covered.has(m.key)).map((m) => m.key);
    const lowWithoutHit = low.filter((e) => !mine.some((mm) => overlaps(span(mm).at - 5_000, span(mm).end + RECOVER_MS, e.start, e.end)));
    out.set(p.id, { lines, uncovered, lowWithoutHit });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Overheal e note sugerida (etapa 3)

/** Referências de fora para um healer do pull (na tela: `selectHealRefs` de healer.ts). */
export type RefsOf = (pull: Pull, player: PlayerStats) => HealRefEntry[];

type Amounts = { heal: number; over: number; share: number };

export interface UseOverheal extends Amounts {
  /** faixa das referências (null: menos de `MIN_REFS` com a cura do CD) e quantas têm o número */
  ref: Band | null;
  refs: number;
  /** acima do p75 das referências + `OVERHEAL_MARGIN` */
  high: boolean;
}

/** Cura e overheal de um uso: os `heal_ids` do CD (em `cdHeals`) na janela do "sem dano". */
export function overhealOfUse(p: PlayerStats, cd: HealCd, usedMs: number): Amounts | null {
  if (cd.kind !== 'heal' || !cd.heal_ids?.length || !cd.effect || cd.duration_ms == null) return null;
  const [x, y] = noDamageWindow(cd.effect, usedMs, cd.duration_ms);
  let heal = 0;
  let over = 0;
  for (const [sec, id, h, o] of p.cdHeals ?? []) {
    if (id !== cd.id || sec * 1000 < x || sec * 1000 > y) continue;
    heal += h;
    over += o;
  }
  return heal + over > 0 ? { heal, over, share: over / (heal + over) } : null;
}

/** Overheal do CD em cada referência (média dos `heal_ids` pela fatia de cura) e a faixa. */
export function refOverheal(refs: HealRefEntry[], cd: HealCd): { values: number[]; band: Band | null } {
  const values: number[] = [];
  for (const e of refs) {
    const rows = (cd.heal_ids ?? []).map((id) => e.cdSpells?.[id]).filter((r) => r != null);
    const w = rows.reduce((a, r) => a + r.share, 0);
    if (rows.length && w > 0) values.push(rows.reduce((a, r) => a + r.overheal * r.share, 0) / w);
  }
  return { values, band: values.length >= MIN_REFS ? band(values) : null };
}

function withRef(o: Amounts, r: { values: number[]; band: Band | null }): UseOverheal {
  return { ...o, ref: r.band, refs: r.values.length, high: !!r.band && o.share > r.band.p75 + OVERHEAL_MARGIN };
}

export interface NightOverheal {
  guid: string;
  cdId: number;
  uses: number;
  share: number;
  /** contra as referências do pull mais recente julgado */
  ref: Band | null;
  high: boolean;
}

/** Overheal da noite por player e CD: soma dos overheals ÷ soma das curas de todos os usos. */
export function nightOverheal(pulls: Pull[], noteOf: NoteOf, verdicts: Map<number, PullVerdicts>, checks: Map<number, LineCheck[]>, refsOf: RefsOf): NightOverheal[] {
  const acc = new Map<string, { guid: string; cd: HealCd; heal: number; over: number; uses: number; last: Pull }>();
  for (const p of [...pulls].sort((a, b) => a.startMs - b.startMs)) {
    const note = noteOf(p);
    const v = verdicts.get(p.id);
    if (!note || !v) continue;
    for (const c of checks.get(p.id) ?? []) {
      const o = v.lines.get(c.lineIndex)?.overheal;
      if (!o || !c.guid) continue;
      const cd = healCd(note.lines[c.lineIndex].spellId!)!;
      const k = `${c.guid}:${cd.id}`;
      const a = acc.get(k) ?? acc.set(k, { guid: c.guid, cd, heal: 0, over: 0, uses: 0, last: p }).get(k)!;
      a.heal += o.heal;
      a.over += o.over;
      a.uses++;
      a.last = p;
    }
  }
  return [...acc.values()].map((a) => {
    const player = a.last.players.find((x) => x.guid === a.guid);
    const share = a.over / (a.heal + a.over);
    const r = withRef({ heal: a.heal, over: a.over, share }, refOverheal(player ? refsOf(a.last, player) : [], a.cd));
    return { guid: a.guid, cdId: a.cd.id, uses: a.uses, share, ref: r.ref, high: r.high };
  });
}

/** Quantas referências usaram o CD no marco do momento (`nearestAnchor` sobre os `cdUses` e `anchors` delas). */
export function refsAt(refs: HealRefEntry[], cd: HealCd, key: string): number {
  const ids = [cd.id, ...(cd.alt_ids ?? [])];
  const at = (e: HealRefEntry, t: number) => {
    const a = nearestAnchor(t, e.anchors!);
    return !!a && `${a.anchor}:${a.k}` === key;
  };
  return refs.filter((e) => e.anchors && ids.some((id) => (e.cdUses?.[id] ?? []).some((t) => at(e, t)))).length;
}

/** Mínimo de pulls que chegaram no momento (ou na linha) para sugerir. */
export const MIN_SUGGEST_PULLS = 3;

export interface SuggestReason {
  momentKey: string;
  /** pulls com o problema e pulls que chegaram */
  pulls: number;
  reached: number;
  medianSize: number | null;
}

export interface AddCandidate {
  change: Extract<NoteChange, { kind: 'add' }>;
  guid: string;
  cdId: number;
  /** referências da spec que usam o CD nesse marco (só informação) */
  refs: number;
}

export interface NoteSuggestion {
  /** um por golpe sem CD, com os CDs livres; o líder marca um */
  adds: { reason: SuggestReason; candidates: AddCandidate[] }[];
  moves: { reason: SuggestReason; change: Extract<NoteChange, { kind: 'move' }>; guid: string }[];
}

/**
 * Note sugerida de uma versão (`pulls`: os que ela julgou): mudanças de um passo, em fase com desvio
 * aplicado (ou na primeira), com pelo menos 3 pulls no momento (ou na linha) e o problema em metade
 * ou mais. A conta de cooldown usa o início mais cedo de cada fase (o pior caso).
 */
export function suggest(
  note: ParsedNote,
  pulls: Pull[],
  offsets: Map<string, PhaseOffset>,
  checks: Map<number, LineCheck[]>,
  ms: Moment[],
  verdicts: Map<number, PullVerdicts>,
  refsOf: RefsOf = () => [],
): NoteSuggestion {
  const out: NoteSuggestion = { adds: [], moves: [] };
  const judged = pulls.filter((p) => verdicts.has(p.id));
  if (judged.length < MIN_SUGGEST_PULLS) return out;
  // ph da note ↔ chave da fase
  const keyOf = new Map<string, string>();
  const phOf = new Map<string, string>();
  for (const p of judged)
    for (const [ph, m] of mapPhases(p.phaseMarks))
      if (!keyOf.has(ph)) {
        keyOf.set(ph, m.key);
        phOf.set(m.key, ph);
      }
  const firstKey = (p: Pull) => [...(p.phaseMarks ?? [])].sort((a, b) => a.t - b.t)[0]?.key ?? 'p1';
  const off = (ph: string) => (offsets.get(ph)?.applied ? offsets.get(ph)!.offsetMs : 0);
  const changeable = (ph: string) => !!offsets.get(ph)?.applied || keyOf.get(ph) === firstKey(judged[0]);
  const abs = (ph: string | undefined, time: number | undefined) => {
    const key = ph ? keyOf.get(ph) : undefined;
    const start = key ? earliestPhaseStart(judged, key) : null;
    return start == null ? null : start + (time ?? 0) * 1000 + off(ph!);
  };
  const prep = (cd: HealCd) => (cd.effect === 'burst' ? 0 : PREP_MS);
  /** `time` da note para usar o CD no momento */
  const noteTime = (m: Moment, cd: HealCd, ph: string) => Math.round((m.inPhaseMs - prep(cd) - off(ph)) / 1000);
  const sameCd = (spellId: number | undefined, cd: HealCd) => spellId != null && healCd(spellId)?.id === cd.id;
  /** a cadeia de usos do player com esse CD cabe no cooldown com um uso em `at` (sem a linha `skip`) */
  const fits = (tag: string, cd: HealCd, at: number, skip: number | null) =>
    note.lines.every((l, j) => {
      if (j === skip || !l.tag || norm(l.tag) !== norm(tag) || !sameCd(l.spellId, cd)) return true;
      const t = abs(l.ph, l.time);
      return t == null || (t < at ? at - t > cd.cooldown_ms! : t - at >= cd.cooldown_ms!);
    });
  const last = [...judged].sort((a, b) => a.startMs - b.startMs).at(-1)!;
  const reason = (m: Moment, n: number, reached: number): SuggestReason => ({ momentKey: m.key, pulls: n, reached, medianSize: m.medianSize });
  const checkOf = (p: Pull, i: number) => checks.get(p.id)?.find((x) => x.lineIndex === i);

  // adicionar: golpe sem CD, com os CDs livres dos players da note
  const tags = [...new Set(note.lines.filter((l) => l.ph != null && l.tag && norm(l.tag) !== 'everyone').map((l) => l.tag!))];
  for (const m of ms) {
    const ph = phOf.get(m.phaseKey);
    if (!ph || !changeable(ph)) continue;
    const reached = judged.filter((p) => m.pulls.has(p.id));
    const bad = reached.filter((p) => verdicts.get(p.id)!.uncovered.includes(m.key));
    if (reached.length < MIN_SUGGEST_PULLS || bad.length * 2 < reached.length) continue;
    const mAbs = earliestPhaseStart(judged, m.phaseKey)! + m.inPhaseMs;
    const candidates: AddCandidate[] = [];
    for (const tag of tags) {
      const player = [last, ...judged].flatMap((p) => p.players).find((x) => norm(shortName(x.name)) === norm(tag));
      if (!player || player.specId == null) continue;
      for (const cd of healCooldowns()) {
        if (!cd.kind || !cd.specs?.includes(player.specId) || cd.cooldown_ms == null) continue;
        if (cd.talent && !judged.some((p) => p.players.some((x) => x.guid === player.guid && castTimes(x, cd.id).length))) continue;
        const time = noteTime(m, cd, ph);
        if (time < 0 || !fits(tag, cd, mAbs - prep(cd), null)) continue;
        candidates.push({
          change: { kind: 'add', time, ph, tag, spellId: cd.id },
          guid: player.guid,
          cdId: cd.id,
          refs: refsAt(refsOf(last, player), cd, m.key),
        });
      }
    }
    if (candidates.length) out.adds.push({ reason: reason(m, bad.length, reached.length), candidates: candidates.sort((a, b) => b.refs - a.refs) });
  }

  // mover: o player usou na hora, mas a hora não cobre nenhum momento
  note.lines.forEach((l, i) => {
    const cd = l.spellId != null ? healCd(l.spellId) : undefined;
    if (!cd?.kind || !cd.effect || cd.cooldown_ms == null || !l.ph || !l.tag || !changeable(l.ph)) return;
    const reached = judged.filter((p) => {
      const c = checkOf(p, i);
      return !!c && !NOT_REACHED.includes(c.state);
    });
    if (reached.length < MIN_SUGGEST_PULLS) return;
    const v = (p: Pull) => verdicts.get(p.id)!.lines.get(i);
    if (reached.some((p) => v(p)?.cycle)) return;
    const away = reached.filter((p) => !v(p)?.momentKey);
    if (away.length * 2 < reached.length || away.some((p) => checkOf(p, i)!.state !== 'on_time')) return;
    const key = keyOf.get(l.ph);
    const inPhase = (l.time ?? 0) * 1000 + off(l.ph);
    const dest = ms
      .filter((m) => m.phaseKey === key && Math.abs(m.inPhaseMs - inPhase) <= PAIR_MS)
      .sort((a, b) => Math.abs(a.inPhaseMs - inPhase) - Math.abs(b.inPhaseMs - inPhase))[0];
    if (!dest) return;
    const time = noteTime(dest, cd, l.ph);
    // antes do início da fase no relógio do addon: a note não chega lá com essa `ph`
    if (time < 0 || time === Math.round(l.time ?? 0) || !fits(l.tag, cd, abs(l.ph, time)!, i)) return;
    out.moves.push({ reason: reason(dest, away.length, reached.length), change: { kind: 'move', line: i, time }, guid: checkOf(reached[0], i)!.guid! });
  });
  return out;
}
