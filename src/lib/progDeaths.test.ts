import { describe, expect, it } from 'vitest';
import type { Death, Pull } from '../types';
import { death, player, pull } from './test-fixtures';
import { bestPulls, computeProgDeaths, countedEarlyDeaths } from './progDeaths';

const hp = (pct: number) => [{ guid: 'b', name: 'Boss', npcId: 1, maxHp: 1, hpPct: pct, hpPctAtCutoff: null }];
const blow = (spellName: string, spellId = 1): Death['killingBlow'] => ({ t: 0, kind: 'damage', spellId, spellName, source: 's', amount: 1, overkill: 0, absorbed: 0, hpPct: null });
const mk = (id: number, hpPct: number, deaths: Death[], over: Partial<Pull> = {}) =>
  pull(id, id * 1000, 100_000, { bosses: hp(hpPct), players: [player('A'), player('B', { role: 'healer' })], deaths, ...over });

describe('bestPulls', () => {
  it('20% melhores da noite, arredondando para cima, no mínimo 1', () => {
    const night = [90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 95].map((h, i) => mk(i, h, []));
    const best = bestPulls(night, 0);
    expect(best.map((p) => p.bosses[0].hpPct)).toEqual([5, 10, 20]);
    expect(bestPulls([mk(0, 50, [])], 0)).toHaveLength(1);
    expect(bestPulls([], 0)).toHaveLength(0);
  });
});

describe('countedEarlyDeaths', () => {
  it('só as 3 primeiras mortes pela ordem de t', () => {
    const p = mk(0, 50, [death('A', 4000), death('B', 1000), death('C', 3000), death('D', 2000)]);
    expect(countedEarlyDeaths(p).map((d) => d.guid)).toEqual(['B', 'D', 'C']);
  });
  it('tira o que não conta antes de pegar as 3 primeiras', () => {
    const wipe = ['A', 'B', 'C', 'D', 'E'].map((g, i) => death(g, 1000 + i * 100));
    // 5 mortes juntas (wipe) + 4 depois: as 3 primeiras que contam são as depois do wipe
    const later = [death('F', 5000), death('G', 6000), death('H', 7000), death('I', 8000)];
    expect(countedEarlyDeaths(mk(0, 50, [...wipe, ...later])).map((d) => d.guid)).toEqual(['F', 'G', 'H']);
    // call de wipe e golpe que sempre é wipe não gastam vaga
    const p = mk(0, 50, [death('A', 1000, { ignored: true }), death('B', 3000, { killingBlow: blow('Unworthy') }), death('C', 5000), death('D', 7000), death('E', 9000), death('F', 11000)], { encounterId: 3429 });
    expect(countedEarlyDeaths(p).map((d) => d.guid)).toEqual(['C', 'D', 'E']);
  });
  it('tira morte de wipe, golpe que sempre é wipe e depois da call', () => {
    const wipe = ['A', 'B', 'C', 'D', 'E'].map((g, i) => death(g, 1000 + i * 100));
    expect(countedEarlyDeaths(mk(0, 50, wipe))).toHaveLength(0);
    const p = mk(0, 50, [death('A', 100, { killingBlow: blow('Grim Execution') }), death('B', 200), death('C', 300, { ignored: true })], { encounterId: 3429 });
    expect(countedEarlyDeaths(p).map((d) => d.guid)).toEqual(['B']);
  });
});

/** 10 pulls por noite; o melhor (vida 1%) é o pull 0 de cada noite */
const night = (n: number, deaths: (i: number) => Death[]) => Array.from({ length: 10 }, (_, i) => mk(n * 100 + i, i === 0 ? 1 : 50 + i, deaths(i)));

describe('computeProgDeaths: pulls mínimos', () => {
  it('menos de 50 pulls: fora', () => {
    const few = Array.from({ length: 4 }, (_, n) => night(n, (i) => (i <= 1 ? [death('A', 95_000)] : [])));
    expect(computeProgDeaths(few).decisive).toHaveLength(0);
  });
});

describe('computeProgDeaths: mortes que viraram wipe', () => {
  const nights = (extra: (i: number) => Death[]) => Array.from({ length: 6 }, (_, n) => night(n, extra));
  it('conta a morte até 25s antes do fim; kill fora; mais longe que 25s fora', () => {
    const r = computeProgDeaths(
      nights((i) => (i === 3 ? [death('A', 80_000, { killingBlow: blow('Shadow Slam', 7) })] : i === 4 ? [death('A', 50_000)] : [])),
    );
    const a = r.decisive.find((x) => x.guid === 'A')!;
    expect(a.decisive).toBe(6);
    expect(a.rate).toBeCloseTo(6 / 60);
    expect(a.every).toBe(10);
    expect(a.cause).toEqual({ spellId: 7, name: 'Shadow Slam', count: 6 });
    const kills = computeProgDeaths(Array.from({ length: 6 }, (_, n) => night(n, (i) => (i === 3 ? [death('A', 90_000)] : [])).map((p) => ({ ...p, success: true }))));
    expect(kills.decisive).toHaveLength(0);
  });
  it('golpe sem nome ou Unknown vira Desconhecida; melee conta', () => {
    const r = computeProgDeaths(nights((i) => (i === 3 ? [death('A', 90_000, { killingBlow: blow('Unknown') })] : i === 4 ? [death('B', 90_000, { role: 'healer', killingBlow: blow('Melee', 6603) })] : i === 5 ? [death('A', 91_000)] : [])));
    const a = r.decisive.find((x) => x.guid === 'A')!;
    expect(a.cause).toEqual({ spellId: null, name: null, count: 12 });
    expect(r.decisive.find((x) => x.guid === 'B')!.cause?.name).toBe('Melee');
  });
  it('top 8 por taxa, do maior para o menor', () => {
    const guids = Array.from({ length: 10 }, (_, k) => `P${k}`);
    const ns = Array.from({ length: 6 }, (_, n) =>
      night(n, (i) => (i < 10 ? [death(guids[i], 95_000)] : [])).map((p) => ({ ...p, players: guids.map((g) => player(g)) })),
    );
    const r = computeProgDeaths(ns);
    expect(r.decisive).toHaveLength(8);
    expect(r.decisive.every((x, i, xs) => i === 0 || xs[i - 1].rate >= x.rate)).toBe(true);
  });
  it('morte depois da call de wipe e de mecânica que mata a raide não conta', () => {
    const wipe = ['A', 'B', 'C', 'D', 'E'].map((g, i) => death(g, 95_000 + i * 100));
    expect(computeProgDeaths(nights((i) => (i === 3 ? wipe : i === 4 ? [death('A', 95_000, { ignored: true })] : []))).decisive).toHaveLength(0);
  });
});
