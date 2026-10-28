import { describe, expect, it } from 'vitest';
import type { PlayerStats, Pull } from '../types';
import { parseNote } from './healNote';
import { covers, judgeUse, matchLines, phaseOffsets, RECOVER_MS } from './healNoteCheck';
import type { Moment } from './raidHits';
import { player, pull } from './test-fixtures';

const casts = (m: Record<number, number[]>): PlayerStats['casts'] => Object.entries(m).map(([id, times]) => ({ spellId: Number(id), name: '', times }));
const druid = (m: Record<number, number[]>) => player('Druida', { specId: 105, class: 'Druid', role: 'healer', casts: casts(m) });
const dh = (m: Record<number, number[]>) => player('Caçador', { specId: 577, class: 'DemonHunter', casts: casts(m) });
const quiet = (low: Record<number, number> = {}) => ({
  alive: Array(300).fill(20),
  low: Array.from({ length: 300 }, (_, i) => low[i] ?? 0),
  maxHpK: Array(300).fill(20_000),
  unavoidableK: Array(300).fill(500),
});
const mk = (players: PlayerStats[], low: Record<number, number> = {}) =>
  pull(0, 0, 300_000, { players, raidSeries: quiet(low), phaseMarks: [{ key: 'p1', name: 'P1', t: 0 }] });
const moment = (key: string, at: number): Moment => ({
  key, anchorSpell: 900, k: Number(key.split(':')[1]), spellId: 900, phaseKey: 'p1', inPhaseMs: at,
  pulls: new Map([[0, { at, end: at + 5_000, hit: true, size: 1 }]]), withHit: 2, medianSize: 1,
});
const run = (p: Pull, text: string, ms: Moment[]) => {
  const note = parseNote(text);
  const offsets = phaseOffsets([p], () => note);
  const checks = matchLines([p], () => note, offsets);
  return judgeUse([p], () => note, offsets, checks, ms).get(0)!;
};

describe('covers', () => {
  it('redução ativa no começo do dano; cura de rajada depois; cura que dura antes ou depois', () => {
    expect(covers('active', 59_000, 8_000, 60_000, 65_000)).toBe(true);
    expect(covers('active', 62_000, 8_000, 60_000, 65_000)).toBe(false);
    expect(covers('burst', 57_000, 5_000, 60_000, 65_000)).toBe(false);
    expect(covers('burst', 65_000 + RECOVER_MS, 5_000, 60_000, 65_000)).toBe(true);
    expect(covers('sustained', 55_000, 6_000, 60_000, 65_000)).toBe(true);
    expect(covers('sustained', 50_000, 6_000, 60_000, 65_000)).toBe(false);
  });
});

describe('judgeUse', () => {
  it('no golpe, fora do golpe por timing e golpe sem CD', () => {
    const p = mk([druid({ 740: [61_000] }), dh({ 196718: [66_000] })]);
    const v = run(p, ['time:60;ph:1;tag:Druida;spellid:740;', 'time:59;ph:1;tag:Caçador;spellid:196718;'].join('\n'), [moment('900:1', 60_000), moment('900:2', 150_000)]);
    expect(v.lines.get(0)).toMatchObject({ momentKey: '900:1', onHit: true });
    // Darkness 7 s atrasada: a linha está no lugar certo, o uso não cobriu (e redução não leva "sem dano")
    expect(v.lines.get(1)).toMatchObject({ momentKey: '900:1', onHit: false, noDamage: false });
    expect(v.uncovered).toEqual(['900:2']);
  });

  it('cura sem golpe nem raide baixa sai "sem dano"; com raide baixa na janela, não', () => {
    const text = 'time:100;ph:1;tag:Druida;spellid:740;';
    expect(run(mk([druid({ 740: [100_000] })]), text, []).lines.get(0)).toMatchObject({ momentKey: null, noDamage: true });
    expect(run(mk([druid({ 740: [100_000] })], { 103: 6, 104: 6 }), text, []).lines.get(0)?.noDamage).toBe(false);
  });

  it('linha de outro pull não cobre o golpe', () => {
    const v = run(mk([dh({})]), 'time:60;ph:1;tag:Druida;spellid:740;', [moment('900:1', 60_000)]);
    expect(v.uncovered).toEqual(['900:1']);
  });

  it('uso de ciclo: gasto cedo para a próxima linha estar pronta no golpe não leva "sem dano"', () => {
    const p = mk([druid({ 740: [10_000, 190_000] })]);
    const v = run(p, ['time:10;ph:1;tag:Druida;spellid:740;', 'time:190;ph:1;tag:Druida;spellid:740;'].join('\n'), [moment('900:1', 100_000), moment('900:2', 190_000)]);
    expect(v.lines.get(0)).toMatchObject({ cycle: true, noDamage: false });
    expect(v.lines.get(1)).toMatchObject({ cycle: false, momentKey: '900:2' });
  });

  it('raide baixa longe de qualquer golpe', () => {
    const v = run(mk([druid({})], { 200: 6, 201: 6 }), 'time:10;ph:1;tag:Druida;spellid:740;', [moment('900:1', 60_000)]);
    expect(v.lowWithoutHit).toEqual([{ start: 200_000, end: 202_000 }]);
  });
});
