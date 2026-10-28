import { describe, expect, it } from 'vitest';
import type { PlayerStats, Pull } from '../types';
import { parseNote } from './healNote';
import { matchLines, MAX_OFFSET_MS, phaseOffsets, summarizeLines, type LineState } from './healNoteCheck';
import { death, player, pull } from './test-fixtures';

// Druida Resto (105) com Tranquility (740) e Convoke (391528, talento); Warrior (71) com Rallying Cry
const casts = (m: Record<number, number[]>): PlayerStats['casts'] => Object.entries(m).map(([id, times]) => ({ spellId: Number(id), name: '', times }));
const druid = (m: Record<number, number[]> = {}) => player('Druida', { specId: 105, class: 'Druid', role: 'healer', casts: casts(m) });
const warrior = (m: Record<number, number[]> = {}) => player('Guerreiro', { specId: 71, class: 'Warrior', casts: casts(m) });
const P2 = 170_000;
const marks = [
  { key: 'p1', name: 'P1', t: 0 },
  { key: 'p2', name: 'P2', t: P2 },
];
const mk = (id: number, players: PlayerStats[], over: Partial<Pull> = {}) => pull(id, id * 1_000_000, 400_000, { players, phaseMarks: marks, ...over });
const states = (r: Map<number, { state: LineState }[]>, id: number) => r.get(id)!.map((c) => c.state);
const run = (pulls: Pull[], text: string) => {
  const note = parseNote(text);
  const offsets = phaseOffsets(pulls, () => note);
  return { offsets, checks: matchLines(pulls, () => note, offsets) };
};

describe('matchLines: estados', () => {
  it('na hora, adiantado, atrasado e não usou', () => {
    const text = ['time:10;ph:1;tag:Druida;spellid:740;', 'time:60;ph:1;tag:Guerreiro;spellid:97462;', 'time:120;ph:1;tag:Druida;spellid:740;', 'time:200;ph:1;tag:Guerreiro;spellid:97462;'].join('\n');
    const p = mk(0, [druid({ 740: [15_000, 140_000] }), warrior({ 97462: [42_000] })], { phaseMarks: [marks[0]] });
    expect(states(run([p], text).checks, 0)).toEqual(['on_time', 'early', 'late', 'not_used']);
  });

  it('não avaliada, fora do pull, fase não alcançada, depois do corte e fase que acabou antes', () => {
    const text = [
      'time:5;ph:1;tag:everyone;spellid:6262;',
      'time:5;ph:1;tag:Druida;text:Personals;',
      'time:5;ph:1;tag:Apelido;spellid:740;',
      'time:5;ph:1;tag:Guerreiro;spellid:97462;',
      'time:5;ph:2;tag:Druida;spellid:740;',
      'time:180;ph:1;tag:Druida;spellid:740;',
      'time:5;ph:9;tag:Druida;spellid:740;',
    ].join('\n');
    const short = mk(0, [druid()], { phaseMarks: [marks[0]], durationMs: 150_000 });
    const long = mk(1, [druid(), warrior()]);
    const r = run([short, long], text).checks;
    expect(states(r, 0)).toEqual(['not_evaluated', 'not_evaluated', 'not_evaluated', 'not_in_pull', 'phase_not_reached', 'after_cutoff', 'not_evaluated']);
    expect(r.get(0)!.map((c) => c.why).slice(0, 3)).toEqual(['everyone', 'no_spell_id', 'unknown_tag']);
    expect(states(r, 1)[5]).toBe('phase_ended'); // P1 +180 s passa do início do P2 (170 s)
  });

  it('morto antes: o uso feito antes da morte continua casado; ressuscitado volta a contar', () => {
    const text = 'time:50;ph:1;tag:Druida;spellid:740;';
    const used = mk(0, [druid({ 740: [45_000] })], { deaths: [death('Druida', 48_000)] });
    const dead = mk(1, [druid({})], { deaths: [death('Druida', 20_000)] });
    const rezzed = mk(2, [druid({ 774: [30_000] })], { deaths: [death('Druida', 20_000)] });
    const r = run([used, dead, rezzed], text).checks;
    expect([states(r, 0)[0], states(r, 1)[0], states(r, 2)[0]]).toEqual(['on_time', 'dead', 'not_used']);
  });

  it('sem a spell: spec errada, talento nunca usado e spell fora da tabela nunca usada', () => {
    const text = ['time:10;ph:1;tag:Guerreiro;spellid:740;', 'time:10;ph:1;tag:Druida;spellid:391528;', 'time:10;ph:1;tag:Druida;spellid:12345;', 'time:10;ph:1;tag:Druida;spellid:740;'].join('\n');
    const r = run([mk(0, [druid(), warrior()])], text).checks.get(0)!;
    expect(r.map((c) => c.state)).toEqual(['no_spell', 'no_spell', 'no_spell', 'not_used']);
    expect(r.map((c) => !!c.neverUsed)).toEqual([false, true, true, false]);
  });

  it('casa pelo id alternativo e pelo par de menor |Δ|', () => {
    const text = ['time:10;ph:1;tag:Druida;spellid:391528;', 'time:30;ph:1;tag:Druida;spellid:391528;'].join('\n');
    const r = run([mk(0, [druid({ 323764: [28_000] })])], text).checks.get(0)!;
    expect(r.map((c) => c.state)).toEqual(['not_used', 'on_time']);
  });
});

describe('phaseOffsets', () => {
  const text = ['time:10;ph:1;tag:Druida;spellid:740;', 'time:20;ph:2;tag:Druida;spellid:740;', 'time:40;ph:2;tag:Guerreiro;spellid:97462;', 'time:80;ph:2;tag:Guerreiro;spellid:97462;'].join('\n');
  // o addon conta o P2 8,6 s depois do app: todo mundo "atrasa" 8,6 s no P2
  const late = (id: number, d = 8_600) =>
    mk(id, [druid({ 740: [10_000, P2 + 20_000 + d] }), warrior({ 97462: [P2 + 40_000 + d, P2 + 80_000 + d] })]);

  it('desvio estável do P2 é aplicado e as linhas viram na hora; o P1 nunca recebe desvio', () => {
    const pulls = [late(0), late(1), late(2)];
    const { offsets, checks } = run(pulls, text);
    expect(offsets.get('2')).toMatchObject({ offsetMs: 8_600, applied: true, pulls: 3 });
    expect(offsets.get('1')).toMatchObject({ first: true, applied: false });
    expect(checks.get(0)!.find((c) => c.lineIndex === 2)).toMatchObject({ state: 'on_time', deltaMs: 0, rawDeltaMs: 8_600 });
  });

  it('não aplica com menos de 5 pares, em um pull só ou acima de MAX_OFFSET_MS', () => {
    expect(run([late(0)], text).offsets.get('2')?.applied).toBe(false);
    expect(run([late(0), late(1), late(2)], text.split('\n').slice(0, 2).join('\n')).offsets.get('2')?.applied).toBe(false);
    const far = MAX_OFFSET_MS + 3_000;
    expect(run([late(0, far), late(1, far), late(2, far)], text).offsets.get('2')?.applied).toBe(false);
  });

  it('pares de duas versões entram juntos no desvio; a tabela é por versão', () => {
    const v1 = parseNote(text);
    const v2 = parseNote(text.replace('time:80', 'time:81'));
    const pulls = [late(0), late(1), late(2), late(3)];
    const noteOf = (p: Pull) => (p.id < 2 ? v1 : v2);
    const offsets = phaseOffsets(pulls, noteOf);
    expect(offsets.get('2')?.pairs).toBe(12);
    const checks = matchLines(pulls, noteOf, offsets);
    const s2 = summarizeLines(checks, pulls.slice(2));
    expect(s2.find((l) => l.lineIndex === 3)).toMatchObject({ reached: 2, onTime: 2 });
  });
});
