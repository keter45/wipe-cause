import { describe, expect, it } from 'vitest';
import type { PhaseMark, PlayerStats, Pull } from '../types';
import type { HealRefEntry } from './healer';
import { healCd } from './healCooldowns';
import { parseNote } from './healNote';
import { judgeUse, matchLines, phaseOffsets, refOverheal, suggest, type RefsOf } from './healNoteCheck';
import type { Moment } from './raidHits';
import { player, pull } from './test-fixtures';

const casts = (m: Record<number, number[]>): PlayerStats['casts'] => Object.entries(m).map(([id, times]) => ({ spellId: Number(id), name: '', times }));
const druid = (name: string, m: Record<number, number[]>, cdHeals?: PlayerStats['cdHeals']) =>
  player(name, { specId: 105, class: 'Druid', role: 'healer', casts: casts(m), cdHeals });
const dh = (name: string, m: Record<number, number[]>) => player(name, { specId: 577, class: 'DemonHunter', casts: casts(m) });
const series = (n: number) => ({ alive: Array(n).fill(20), low: Array(n).fill(0), maxHpK: Array(n).fill(20_000), unavoidableK: Array(n).fill(500) });
const mk = (id: number, players: PlayerStats[], marks: PhaseMark[] = [{ key: 'p1', name: 'P1', t: 0 }], dur = 400_000) =>
  pull(id, id * 1_000_000, dur, { players, raidSeries: series(dur / 1000), phaseMarks: marks });
/** momento da noite: `at` por pull (ou o mesmo em todos) */
const moment = (key: string, inPhaseMs: number, ids: number[], at: (id: number) => number = () => inPhaseMs, phaseKey = 'p1'): Moment => ({
  key, anchorSpell: 900, k: Number(key.split(':')[1]), spellId: 900, phaseKey, inPhaseMs,
  pulls: new Map(ids.map((id) => [id, { at: at(id), end: at(id) + 5_000, hit: true, size: 1 }])), withHit: ids.length, medianSize: 1,
});
const run = (pulls: Pull[], text: string, ms: Moment[], refsOf?: RefsOf) => {
  const note = parseNote(text);
  const offsets = phaseOffsets(pulls, () => note);
  const checks = matchLines(pulls, () => note, offsets);
  const verdicts = judgeUse(pulls, () => note, offsets, checks, ms, refsOf);
  return { verdicts, out: suggest(note, pulls, offsets, checks, ms, verdicts, refsOf) };
};
const ref = (overheal: number) => ({ cdSpells: { 157982: { share: 0.1, overheal } } }) as unknown as HealRefEntry;

describe('suggest: adicionar', () => {
  it('golpe sem CD em 3 de 4 pulls lista os CDs livres; CD sem player da spec na note não entra', () => {
    const ids = [0, 1, 2, 3];
    const pulls = ids.map((id) => mk(id, [druid('Druida', { 740: [30_000] }), dh('Outro', { 196718: [10_000] }), ...(id === 3 ? [dh('Caçador', { 196718: [250_000] })] : [])]));
    const text = ['time:30;ph:1;tag:Druida;spellid:740;', 'time:250;ph:1;tag:Caçador;spellid:196718;'].join('\n');
    const { out } = run(pulls, text, [moment('900:2', 250_000, ids)]);
    expect(out.adds).toHaveLength(1);
    expect(out.adds[0].reason).toMatchObject({ momentKey: '900:2', pulls: 3, reached: 4 });
    const c = out.adds[0].candidates;
    expect(c.map((x) => x.change)).toContainEqual({ kind: 'add', time: 248, ph: '1', tag: 'Druida', spellId: 740 });
    // Darkness do Caçador já está na note 98 s antes (recarga de 300 s); o "Outro" não tem linha
    expect(c.some((x) => x.cdId === 196718)).toBe(false);
  });

  it('CD que não volta a tempo no início mais cedo da fase não entra', () => {
    const ids = [0, 1, 2];
    const marks = (t: number): PhaseMark[] => [{ key: 'p1', name: 'P1', t: 0 }, { key: 'p2', name: 'P2', t }];
    const pulls = ids.map((id) => mk(id, [druid('Druida', {})], marks(id === 0 ? 250_000 : 300_000)));
    // no pior caso a linha da P2 cai em 260 s; Tranquility em 98 s só volta em 278 s
    const { out } = run(pulls, 'time:10;ph:2;tag:Druida;spellid:740;', [moment('900:1', 100_000, ids)]);
    expect(out.adds.flatMap((a) => a.candidates).some((x) => x.cdId === 740)).toBe(false);
  });

  it('fase sem desvio aplicado não recebe mudança', () => {
    const ids = [0, 1, 2];
    const marks: PhaseMark[] = [{ key: 'p1', name: 'P1', t: 0 }, { key: 'p2', name: 'P2', t: 100_000 }];
    const pulls = ids.map((id) => mk(id, [druid('Druida', {})], marks));
    const { out } = run(pulls, 'time:10;ph:1;tag:Druida;spellid:740;', [moment('900:1', 150_000, ids, () => 250_000, 'p2')]);
    expect(out.adds).toEqual([]);
  });

  it('menos de 3 pulls não sugere nada', () => {
    const ids = [0, 1];
    const pulls = ids.map((id) => mk(id, [druid('Druida', { 740: [30_000] })]));
    const { out } = run(pulls, 'time:30;ph:1;tag:Druida;spellid:740;', [moment('900:2', 250_000, ids)]);
    expect(out).toEqual({ adds: [], moves: [] });
  });
});

describe('suggest: mover', () => {
  const ids = [0, 1, 2];

  it('linha na hora sem momento vai para o golpe da fase', () => {
    const pulls = ids.map((id) => mk(id, [druid('Druida', { 740: [100_000] })]));
    const { out } = run(pulls, 'time:100;ph:1;tag:Druida;spellid:740;', [moment('900:1', 120_000, ids)]);
    expect(out.moves).toEqual([{ reason: { momentKey: '900:1', pulls: 3, reached: 3, medianSize: 1 }, change: { kind: 'move', line: 0, time: 118 }, guid: 'Druida' }]);
  });

  it('mudança que não troca o time é descartada', () => {
    // o golpe de cada pull cai em 130 s, mas a mediana do momento na fase é 100 s
    const pulls = ids.map((id) => mk(id, [druid('Druida', { 740: [98_000] })]));
    const { out } = run(pulls, 'time:98;ph:1;tag:Druida;spellid:740;', [moment('900:1', 100_000, ids, () => 130_000)]);
    expect(out.moves).toEqual([]);
  });

  it('golpe antes do início da fase na note (time negativo) não gera mover', () => {
    const pulls = ids.map((id) => mk(id, [druid('Druida', { 740: [20_000] })]));
    const { out } = run(pulls, 'time:20;ph:1;tag:Druida;spellid:740;', [moment('900:1', 1_000, ids)]);
    expect(out.moves).toEqual([]);
  });

  it('linha de ciclo não gera mover', () => {
    const pulls = ids.map((id) => mk(id, [druid('Druida', { 740: [10_000, 190_000] })]));
    const text = ['time:10;ph:1;tag:Druida;spellid:740;', 'time:190;ph:1;tag:Druida;spellid:740;'].join('\n');
    const { verdicts, out } = run(pulls, text, [moment('900:1', 30_000, ids), moment('900:2', 190_000, ids)]);
    expect(verdicts.get(0)!.lines.get(0)?.cycle).toBe(true);
    expect(out.moves).toEqual([]);
  });
});

describe('overheal do uso', () => {
  const tranq = healCd(740)!;

  it('spell sem referência não vira "overheal alto"', () => {
    expect(refOverheal([], tranq)).toEqual({ values: [], band: null });
    const pulls = [mk(0, [druid('Druida', { 740: [60_000] }, [[61, 740, 100, 900]])])];
    const { verdicts } = run(pulls, 'time:60;ph:1;tag:Druida;spellid:740;', [moment('900:1', 60_000, [0])]);
    expect(verdicts.get(0)!.lines.get(0)?.overheal).toMatchObject({ heal: 100, over: 900, share: 0.9, ref: null, refs: 0, high: false });
  });

  it('"empilhado" só com dois usos de cura com heal_ids no mesmo momento', () => {
    const refsOf: RefsOf = () => [ref(0.1), ref(0.2), ref(0.3)];
    const two = [mk(0, [druid('Druida', { 740: [60_000] }, [[61, 740, 100, 900]]), druid('Outra', { 740: [61_000] }, [[62, 740, 900, 100]])])];
    const text = ['time:60;ph:1;tag:Druida;spellid:740;', 'time:61;ph:1;tag:Outra;spellid:740;'].join('\n');
    const v = run(two, text, [moment('900:1', 60_000, [0])], refsOf).verdicts.get(0)!.lines;
    expect(v.get(0)).toMatchObject({ stacked: true, overheal: { high: true } });
    // a outra também está empilhada, mas com overheal baixo: sem rótulo
    expect(v.get(1)).toMatchObject({ stacked: false, overheal: { high: false } });
    const one = [mk(0, [druid('Druida', { 740: [60_000] }, [[61, 740, 100, 900]])])];
    expect(run(one, text.split('\n')[0], [moment('900:1', 60_000, [0])], refsOf).verdicts.get(0)!.lines.get(0)).toMatchObject({ stacked: false, overheal: { high: true } });
  });
});
