import { describe, expect, it } from 'vitest';
import type { MechanicResult, PhaseWindow } from '../types';
import { phaseLabel, phaseTone, phasesOfNight } from './phases';
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
