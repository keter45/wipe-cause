import { describe, expect, it } from 'vitest';
import type { MechanicResult, PhaseWindow } from '../types';
import { bestWipe, phaseLabel, phaseTone, phasesOfNight, progressLabel, pullProgress, reachedPhase } from './phases';
import { pull } from './test-fixtures';

const win = (start: number, secs: number | null, extra: Partial<PhaseWindow> = {}): PhaseWindow => ({ start, end: secs == null ? null : start + secs * 1000 + 8, ...extra });
const stasis = (phases: PhaseWindow[]): MechanicResult => ({
  key: 'stasis',
  name: 'Vitriolic Stasis',
  spellId: 1,
  kind: 'phase_duration',
  severity: 'minor',
  tip: '',
  evaluated: true,
  failures: 0,
  summary: '',
  players: [],
  events: [],
  phases,
  targetMs: 11_000,
  maxMs: 16_000,
});

describe('fases cronometradas', () => {
  it('tom pelo tempo bom e pelo máximo; mortes na fase = vermelho', () => {
    const m = stasis([]);
    expect(phaseTone(win(0, 10), m)).toBe('good');
    expect(phaseTone(win(0, 14), m)).toBe('mid');
    expect(phaseTone(win(0, 16), m)).toBe('mid'); // 16,008s arredonda para 16: ainda não é lenta
    expect(phaseTone(win(0, 18), m)).toBe('bad');
    expect(phaseTone(win(0, 6, { deaths: 17 }), m)).toBe('bad');
    expect(phaseLabel(win(0, null, { wiped: true }))).toBe('wipe');
  });

  it('noite: melhor de cada vez e média só das fases limpas', () => {
    const a = pull(0, 0, 300_000, { mechanics: [stasis([win(46_000, 18), win(155_000, 13)])] });
    const b = pull(1, 400_000, 300_000, { mechanics: [stasis([win(46_000, 11), win(148_000, 6, { deaths: 17 })])] });
    const [n] = phasesOfNight([a, b]);
    expect(n.slots).toBe(2);
    expect(n.best).toEqual([11, 13]);
    expect(n.avg).toBe(14); // (18 + 13 + 11) / 3: a de 6s com 17 mortes fica de fora
  });
});

describe('fase alcançada', () => {
  const m = (key: string, t: number) => ({ key, name: key.toUpperCase(), t });
  it('só aparece depois da primeira fase, com rótulo curto', () => {
    expect(reachedPhase({ phaseMarks: [m('p1', 0)] })).toBeNull();
    expect(reachedPhase({})).toBeNull();
    expect(reachedPhase({ phaseMarks: [m('p1', 0), m('p2', 100)] })).toMatchObject({ short: 'P2', index: 1 });
    expect(reachedPhase({ phaseMarks: [m('p1', 0), m('p2', 100), m('intermission', 200)] })?.short).toBe('Int.');
  });

  it('com o corte de mortes, a fase em que o corte caiu', () => {
    expect(reachedPhase({ phaseMarks: [m('p1', 0), m('p2', 100)], cutoffT: 50 })).toBeNull();
  });
});

// os pulls de 15/10 como o Warcraft Logs mostra: P1 7,5%, P2 69%, P3 82%
describe('progresso do pull', () => {
  const m = (key: string, t: number) => ({ key, name: key.toUpperCase(), t });
  const marks = [m('p1', 0), m('p2', 169_000), m('intermission', 390_000), m('p3', 428_000)];
  const boss = (hpPct: number) => [{ guid: 'b', name: 'Zuljan', npcId: 1, maxHp: 1, hpPct, hpPctAtCutoff: null }];
  const p1 = pull(6, 0, 146_000, { bosses: boss(7.5), phaseHpPct: 7.5, phaseCount: 4, phaseMarks: marks.slice(0, 1) });
  const p2 = pull(1, 0, 256_000, { bosses: boss(0), phaseHpPct: 69.1, phaseCount: 4, phaseMarks: marks.slice(0, 2) });
  const p3 = pull(16, 0, 460_000, { bosses: boss(78.4), phaseHpPct: 82.2, phaseCount: 4, phaseMarks: marks });

  it('mostra a fase e a vida dos bosses dela', () => {
    expect([p1, p2, p3].map(progressLabel)).toEqual(['7.5%', 'P2 69.1%', 'P3 82.2%']);
  });

  it('P3 a 82% foi mais longe que P2 a 69%, que foi mais longe que P1 a 7,5%', () => {
    const [a, b, c] = [p1, p2, p3].map(pullProgress);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(bestWipe([p1, p2, p3])).toBe(p3);
  });

  it('no corte usa a vida da fase no corte', () => {
    expect(progressLabel({ ...p2, cutoffT: 200_000, phaseHpPctAtCutoff: 71.3 })).toBe('P2 71.3%');
  });
});
