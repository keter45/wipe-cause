import { describe, expect, it } from 'vitest';
import { anchoredMoments, nearestAnchor } from './cdAnchors';

// boss: 1001 (Wave) aos 30 s e 150 s; 1002 (Orb) aos 90 s. A raid de cada log mata em ritmo diferente.
const ref = (shift: number, uses: number[]) => ({ anchors: { 1001: [30_000 + shift, 150_000 + shift], 1002: [90_000 + shift] }, uses: uses.map((u) => u + shift) });

describe('momento dos cooldowns preso à mecânica', () => {
  it('acha o cast do boss mais perto, antes ou depois do uso', () => {
    expect(nearestAnchor(33_000, { 1001: [30_000], 1002: [40_000] })).toEqual({ anchor: 1001, k: 1, dt: 3000 });
    expect(nearestAnchor(87_000, { 1002: [90_000] })).toEqual({ anchor: 1002, k: 1, dt: -3000 });
    expect(nearestAnchor(200_000, { 1001: [30_000] })).toBeNull();
  });

  it('a mecânica em que a maioria usa vira o momento, mesmo com a luta em outro ritmo', () => {
    // 4 de 5 logs usam ~3 s depois da 2ª Wave; o tempo de luta varia 20 s entre eles
    const refs = [ref(0, [153_000]), ref(10_000, [152_000]), ref(-10_000, [154_000]), ref(20_000, [153_000]), ref(5_000, [60_000])];
    // na nossa luta a 2ª Wave veio aos 170 s; usamos aos 180 s (10 s depois)
    const ours = { anchors: { 1001: [35_000, 170_000], 1002: [100_000] }, uses: [180_000] };
    const m = anchoredMoments(refs, ours, 0.6, 3);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ anchor: 1001, k: 2, dt: 3000, support: 0.8, at: 170_000, you: 10_000 });
  });

  it('não usou nesse momento, e mecânica que a luta não alcançou fica sem o seu lado', () => {
    const refs = [ref(0, [92_000, 152_000]), ref(0, [91_000, 151_000]), ref(0, [93_000, 153_000])];
    const ours = { anchors: { 1001: [30_000], 1002: [95_000] }, uses: [40_000] };
    const m = anchoredMoments(refs, ours, 0.6, 3);
    expect(m.map((x) => [x.anchor, x.k, x.you, x.at])).toEqual([
      [1002, 1, null, 95_000],
      [1001, 2, null, null],
    ]);
  });
});
