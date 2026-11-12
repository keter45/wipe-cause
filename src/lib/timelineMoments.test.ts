import { describe, expect, it } from 'vitest';
import type { Pull } from '../types';
import type { FightMarker, MechanicLane } from './fight';
import { clusterDeaths, defaultWeight, fightMoments, weighLanes } from './timelineMoments';

const lane = (key: string, severity: MechanicLane['severity'], bad: number[], ok: number[] = []): MechanicLane => ({
  key,
  name: key,
  spellId: 1,
  severity,
  failures: bad.length,
  marks: [...bad.map((t) => ({ t, ok: false, guid: 'P1' })), ...ok.map((t) => ({ t, ok: true }))].sort((a, b) => a.t - b.t),
});

describe('weighLanes', () => {
  it('usa o peso da regra, a escolha do usuário por cima, e ordena pelo peso', () => {
    const lanes = [lane('a', 'minor', [1]), lane('b', 'major', [1, 2]), lane('c', 'wipe', []), lane('d', 'none', [])];
    const w = weighLanes(lanes, { a: 'wipe', c: 'hidden' });
    expect(w.map((l) => [l.key, l.weight])).toEqual([
      ['a', 'wipe'],
      ['b', 'major'],
      ['d', 'minor'],
      ['c', 'hidden'],
    ]);
  });
  it('orbs no chão ficam em cima e contam como grave', () => {
    expect(defaultWeight('orbs', 'none')).toBe('major');
    const w = weighLanes([lane('x', 'wipe', [1]), { ...lane('orbs', 'none', []), series: [[0, 1]] }], {});
    expect(w[0].key).toBe('orbs');
  });
});

describe('fightMoments', () => {
  const pull = (extra: Partial<Pull> = {}) =>
    ({
      deaths: [
        { guid: 'P2', name: 'Bob', t: 43_000, ignored: false },
        { guid: 'P3', name: 'Cid', t: 80_000, ignored: true },
      ],
      cutoffT: null,
      ...extra,
    }) as unknown as Pull;

  it('primeiro erro grave, primeira morte, pico e call de wipe, em ordem', () => {
    const lanes = weighLanes([lane('leve', 'minor', [10_000]), lane('onda', 'major', [37_000, 59_000, 60_000, 61_000, 63_500, 70_000])], {});
    const m = fightMoments(pull({ wipeCall: { t: 60_500 } as Pull['wipeCall'] }), lanes);
    expect(m.map((x) => x.kind)).toEqual(['firstFail', 'firstDeath', 'peak', 'wipeCall']);
    expect(m[0]).toMatchObject({ t: 37_000, label: 'onda', guid: 'P1' });
    expect(m[1]).toMatchObject({ t: 43_000, guid: 'P2', label: 'Bob' });
    expect(m[2]).toMatchObject({ t: 59_000, end: 63_500, count: 4 });
  });
  it('sem call de wipe usa o corte; sem erros graves não tem pico nem primeiro erro', () => {
    const m = fightMoments(pull({ cutoffT: 90_000 }), weighLanes([lane('leve', 'minor', [1, 2, 3, 4])], {}));
    expect(m.map((x) => x.kind)).toEqual(['firstDeath', 'cutoff']);
  });
  it('mecânica que o usuário subiu para grave entra nos momentos', () => {
    const m = fightMoments(pull(), weighLanes([lane('leve', 'minor', [5_000])], { leve: 'major' }));
    expect(m[0]).toMatchObject({ kind: 'firstFail', t: 5_000 });
  });
});

describe('clusterDeaths', () => {
  const d = (t: number): FightMarker => ({ t, kind: 'death', label: '', spellId: null });
  it('junta as mortes que ficariam a menos de 14px uma da outra', () => {
    // 100 ms por px: 1,4 s de distância é o limite
    const c = clusterDeaths([d(60_000), d(10_000), d(60_500), d(61_200), d(70_000)], 100);
    expect(c.map((x) => x.deaths.length)).toEqual([1, 3, 1]);
    expect(c[1]).toMatchObject({ t: 60_000, end: 61_200 });
  });
});
