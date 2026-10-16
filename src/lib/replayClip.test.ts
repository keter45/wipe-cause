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

  it('inclui só a causa do wipe, sem Sever ou Widow’s Kiss graves', () => {
    const ms = clipMoments(p1);
    expect(ms.map((m) => [m.kind, m.label, m.t])).toEqual([
      ['trigger', 'Virulent Mutation (detonation)', 85_156],
    ]);
    // um só culpado: o nome dele; falha coletiva: ninguém
    expect(ms.map((m) => m.who)).toEqual([undefined]);
  });

  it('erros graves e leves não entram nem como foco da progressão', () => {
    const p = { ...p1, mechanics: p1.mechanics.map((m) => ({ ...m, focus: true })) };
    expect(clipMoments(p).map((m) => m.kind)).toEqual(['trigger']);
  });

  it('inclui falhas gravíssimas em ordem de tempo e identifica um culpado único', () => {
    const extra = mech('failed_soak', 'wipe', [ref(40_000, ['A'])]);
    expect(clipMoments({ ...p1, mechanics: [...p1.mechanics, extra] }).map(m => [m.kind, m.t, m.who])).toEqual([
      ['mistake', 40_000, 'A'], ['trigger', 85_156, undefined],
    ]);
  });

  it('mantém a causa real mesmo se a regra tem gravidade major', () => {
    const p = { ...p1, mechanics: p1.mechanics.map(m => ({ ...m, severity: 'major' as const })) };
    expect(clipMoments(p).map(m => m.kind)).toEqual(['trigger']);
  });

  it('dois momentos a menos de 5 s viram um só (fica o mais importante)', () => {
    const p = { ...p1, mechanics: [...p1.mechanics, mech('guillotine', 'wipe', [ref(88_000, ['A'])])] };
    expect(clipMoments(p).map((m) => m.label)).not.toContain('guillotine');
  });

  it('no máximo 4 momentos', () => {
    const extra = [100, 200, 300, 400].map((s) => mech(`m${s}`, 'wipe', [ref(s * 100, ['A'])]));
    expect(clipMoments({ ...p1, mechanics: [...p1.mechanics, ...extra] })).toHaveLength(4);
  });

  it('mortes de tank sem causa ligada não entram', () => {
    const tank = death('T', 40_000, { role: 'tank', replay: ref(40_000, ['T']), killingBlow: { t: 40_000, kind: 'damage', spellId: 9, spellName: 'Rend', source: 'Boss', amount: 1, overkill: 0, absorbed: 0, hpPct: 0 } });
    const ms = clipMoments({ ...p1, deaths: [tank, ...p1.deaths] });
    expect(ms.map(m => m.t)).toEqual([85_156]);
  });

  it('sem gatilho nem falha gravíssima: não gera clipe de uma morte comum', () => {
    const p = pull(0, 0, 60_000, { deaths: [death('B', 30_000, { replay: ref(30_000, ['B']) }), death('A', 20_000, { replay: ref(20_000, ['A']) })] });
    expect(clipMoments(p)).toEqual([]);
  });

  it('não inclui falhas depois do corte de mortes', () => {
    const p = { ...p1, cutoffT: 90_000, mechanics: [...p1.mechanics, mech('late', 'wipe', [ref(95_000)])] };
    expect(clipMoments(p).map(m => m.t)).toEqual([85_156]);
  });

  it('usa a morte ligada ao gatilho quando falta replay da mecânica', () => {
    const p = { ...p1, mechanics: [], deaths: [death('A', 85_200, { causedBy: { key: 'detonation', name: 'Detonation', amount: 1, pct: 100, failT: 85_156 }, replay: ref(85_200, ['A']) })] };
    expect(clipMoments(p)[0]).toMatchObject({ kind: 'trigger', t: 85_156, death: { guid: 'A' } });
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
