// Confere a note de CDs contra os pulls: casa cada linha com o cast do player, mede o desvio entre o
// relógio do addon e as fases do app e dá um estado para cada linha. Só funções puras; regras em
// docs/heal-cd-note.md.

import type { PhaseMark, PlayerStats, Pull } from '../types';
import { shortName } from './format';
import { castIdsOf, healCd } from './healCooldowns';
import { quantile } from './healer';
import { mapPhases, type ParsedNote } from './healNote';

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
