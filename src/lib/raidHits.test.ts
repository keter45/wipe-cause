import { describe, expect, it } from 'vitest';
import type { Pull } from '../types';
import { hits, moments, nightAnchors, raidLow } from './raidHits';
import { pull } from './test-fixtures';

// 20 players, 1.000.000 de vida cada (20.000 mil); golpe = 16.000 mil em 5 s
const N = 120;
const series = (dmg: Record<number, number>, low: Record<number, number> = {}) => ({
  alive: Array(N).fill(20),
  low: Array.from({ length: N }, (_, i) => low[i] ?? 0),
  maxHpK: Array(N).fill(20_000),
  unavoidableK: Array.from({ length: N }, (_, i) => dmg[i] ?? 500),
});
const boss = (casts: number[], spellId = 900) => ({ spellId, name: 'Golpe', sources: ['Boss'], casts: casts.length, castTimes: casts, hitsOnPlayers: 0, damageToPlayers: 0, interrupted: 0, interruptible: false });
const mk = (id: number, dmg: Record<number, number>, casts: number[], over: Partial<Pull> = {}) =>
  pull(id, id * 1_000_000, N * 1000, {
    raidSeries: series(dmg),
    enemyHits: Object.keys(dmg).map((s) => [Number(s), 900, dmg[Number(s)] * 1000] as [number, number, number]),
    enemySpells: [boss(casts)],
    phaseMarks: [{ key: 'p1', name: 'P1', t: 0 }],
    ...over,
  });

describe('hits', () => {
  it('golpe instantâneo começa no segundo do dano, não 4 s antes', () => {
    const p = mk(0, { 30: 17_000 }, [29_000]);
    const hs = hits(p, nightAnchors([p]).get(0)!);
    expect(hs).toHaveLength(1);
    expect(hs[0]).toMatchObject({ start: 30_000, key: '900:1', spellId: 900 });
  });

  it('golpe espalhado em 3 s começa no primeiro segundo com dano de verdade', () => {
    const p = mk(0, { 40: 6_000, 41: 6_000, 42: 6_000 }, [39_000]);
    expect(hits(p, nightAnchors([p]).get(0)!)[0].start).toBe(40_000);
  });

  it('sem vida no log não há golpes', () => {
    const p = mk(0, { 30: 17_000 }, [29_000]);
    p.raidSeries = { ...p.raidSeries!, low: null };
    expect(hits(p, {})).toEqual([]);
  });

  it('dois golpes com a mesma chave: o menor fica sem marco', () => {
    const p = mk(0, { 30: 17_000, 52: 19_000 }, [29_000]);
    const hs = hits(p, { '900': [29_000] });
    expect(hs.map((h) => h.key)).toEqual([null, '900:1']);
  });
});

describe('moments', () => {
  it('golpe em 2 pulls vira momento, e o pull que chegou sem golpe (o CD segurou) também tem o momento', () => {
    const pulls = [mk(0, { 30: 17_000 }, [29_000]), mk(1, { 31: 17_000 }, [29_500]), mk(2, {}, [29_000])];
    const anchors = nightAnchors(pulls);
    const hb = new Map(pulls.map((p) => [p.id, hits(p, anchors.get(p.id)!)]));
    const [m] = moments(pulls, anchors, hb);
    expect(m).toMatchObject({ key: '900:1', withHit: 2, phaseKey: 'p1' });
    expect(m.pulls.get(2)).toMatchObject({ hit: false, at: 29_000 + 1_250 });
  });

  it('golpe em um pull só não vira momento', () => {
    const pulls = [mk(0, { 30: 17_000 }, [29_000]), mk(1, {}, [29_000]), mk(2, {}, [29_000])];
    const anchors = nightAnchors(pulls);
    expect(moments(pulls, anchors, new Map(pulls.map((p) => [p.id, hits(p, anchors.get(p.id)!)])))).toEqual([]);
  });

  it('marco da P2 vale mesmo com a maioria dos pulls morrendo no P1', () => {
    const p2 = [{ key: 'p1', name: 'P1', t: 0 }, { key: 'p2', name: 'P2', t: 50_000 }];
    const pulls = [mk(0, { 70: 17_000 }, [69_000], { phaseMarks: p2 }), mk(1, { 70: 17_000 }, [69_000], { phaseMarks: p2 }), mk(2, {}, []), mk(3, {}, []), mk(4, {}, [])];
    const anchors = nightAnchors(pulls);
    const [m] = moments(pulls, anchors, new Map(pulls.map((p) => [p.id, hits(p, anchors.get(p.id)!)])));
    expect(m).toMatchObject({ key: '900:1', phaseKey: 'p2', inPhaseMs: 20_000 });
  });
});

describe('raidLow', () => {
  it('um quarto dos vivos abaixo de 50% por 2 s ou mais', () => {
    const p = mk(0, {}, []);
    p.raidSeries = { ...p.raidSeries!, low: Array.from({ length: N }, (_, i) => (i >= 10 && i < 13 ? 5 : i === 20 ? 9 : 0)) };
    expect(raidLow(p)).toEqual([{ start: 10_000, end: 13_000 }]);
  });
});
