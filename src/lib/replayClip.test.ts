import { describe, expect, it } from 'vitest';
import type { MechanicResult, ReplayRef } from '../types';
import { death, pull } from './test-fixtures';
import { clipMoments, clipSpan } from './replayClip';

const ref = (t: number, focus: string[] = []): ReplayRef => ({ t, from: Math.max(0, t - 15_000), to: t + 2_000, focus });

const mech = (key: string, severity: MechanicResult['severity'], replays: ReplayRef[], over: Partial<MechanicResult> = {}): MechanicResult => ({
  key,
  name: key,
  spellId: key.length,
  kind: 'avoidable',
  severity,
  tip: { pt: '', en: '' },
  evaluated: true,
  failures: replays.length || 1,
  summary: { pt: '', en: '' },
  players: [],
  events: [],
  replays,
  ...over,
});

describe('clipMoments: o resumo da try', () => {
  // o pull 1 do log de 14/10: Sever aos 0:22, Widow's Kiss aos 0:53 e a detonação do orb (causa do wipe) aos 1:25
  const p1 = pull(0, 0, 89_516, {
    trigger: { key: 'detonation', name: 'Virulent Mutation (detonation)', t: 85_156, deaths: 15 },
    mechanics: [
      mech('detonation', 'wipe', [{ t: 86_996, from: 71_996, to: 88_996, focus: [] }]),
      mech('widows_kiss', 'major', [ref(53_994, ['B']), ref(53_994, ['C'])]),
      mech('sever', 'major', [ref(22_985, ['A'])]),
      mech('axegrinder', 'minor', [ref(19_599, ['A'])]),
    ],
    deaths: [death('A', 22_987, { replay: ref(22_987, ['A']) }), ...['B', 'C'].map((g) => death(g, 85_200, { replay: ref(85_200, [g]) }))],
  });

  it('erros graves e a causa do wipe, em ordem de tempo', () => {
    const ms = clipMoments(p1);
    expect(ms.map((m) => [m.kind, m.label, m.t])).toEqual([
      ['mistake', 'sever', 22_985],
      ['mistake', 'widows_kiss', 53_994],
      ['trigger', 'Virulent Mutation (detonation)', 85_156],
    ]);
    // um só culpado: o nome dele; falha coletiva: ninguém
    expect(ms.map((m) => m.who)).toEqual(['A', 'B', undefined]);
  });

  it('erro leve só entra se for o foco da progressão', () => {
    const p = { ...p1, mechanics: p1.mechanics.map((m) => (m.key === 'axegrinder' ? { ...m, focus: true } : m)) };
    expect(clipMoments(p).map((m) => m.label)).toContain('axegrinder');
  });

  it('dois momentos a menos de 5 s viram um só (fica o mais importante)', () => {
    const p = { ...p1, mechanics: [...p1.mechanics, mech('guillotine', 'wipe', [ref(88_000, ['A'])])] };
    expect(clipMoments(p).map((m) => m.label)).not.toContain('guillotine');
  });

  it('no máximo 4 momentos', () => {
    const extra = [100, 200, 300, 400].map((s) => mech(`m${s}`, 'major', [ref(s * 100, ['A'])]));
    expect(clipMoments({ ...p1, mechanics: [...p1.mechanics, ...extra] })).toHaveLength(4);
  });

  it('a morte do tank entre as decisivas entra', () => {
    const tank = death('T', 40_000, { role: 'tank', replay: ref(40_000, ['T']), killingBlow: { t: 40_000, kind: 'damage', spellId: 9, spellName: 'Rend', source: 'Boss', amount: 1, overkill: 0, absorbed: 0, hpPct: 0 } });
    const ms = clipMoments({ ...p1, deaths: [tank, ...p1.deaths] });
    expect(ms.find((m) => m.kind === 'death')).toMatchObject({ t: 40_000, label: 'T · Rend', spellId: 9 });
  });

  it('sem gatilho nem erro grave: a primeira morte', () => {
    const p = pull(0, 0, 60_000, { deaths: [death('B', 30_000, { replay: ref(30_000, ['B']) }), death('A', 20_000, { replay: ref(20_000, ['A']) })] });
    expect(clipMoments(p).map((m) => [m.kind, m.t])).toEqual([[undefined, 20_000]]);
  });

  it('kill: nada', () => {
    expect(clipMoments({ ...p1, success: true })).toEqual([]);
  });
});

describe('clipSpan', () => {
  it('no resumo, cada trecho é mais curto', () => {
    const r = { t: 50_000, from: 0, to: 100_000, focus: [] };
    expect(clipSpan(r, 50_000)).toEqual([43_000, 53_000]);
    expect(clipSpan(r, 50_000, true)).toEqual([45_000, 52_500]);
  });
  it('fica dentro do replay', () => {
    expect(clipSpan({ t: 2_000, from: 0, to: 3_000, focus: [] }, 2_000)).toEqual([0, 3_000]);
  });
});
