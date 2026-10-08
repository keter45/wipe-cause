import { describe, expect, it } from 'vitest';
import type { RotationResult } from '../types';
import { compareWithTops, type BossBench } from './bench';
import { castMix, idleIn } from './benchMetrics';
import { death, player, pull } from './test-fixtures';

const rotation = (over: Partial<RotationResult> = {}): RotationResult => ({
  specName: 'Retribution Paladin',
  patch: '12.1',
  tree: null,
  score: 90,
  findings: [{ id: 'always_be_casting', kind: 'downtime', title: { pt: 'Tempo sem castar', en: 'Time not casting' }, tip: { pt: '', en: '' }, importance: 'high', count: 1, rate: 0.9, times: [], detail: { pt: '', en: '' }, spellId: null }],
  opener: null,
  downtimeMs: 6000,
  activeMs: 60000,
  idle: [[20000, 26000]],
  cooldowns: [
    { spellId: 31884, name: 'Avenging Wrath', casts: 1, possible: 1, usage: 1 },
    { spellId: 255937, name: 'Wake of Ashes', casts: 1, possible: 2, usage: 0.5 },
  ],
  keyPoints: [],
  prioritySt: [
    { spellId: 383328, name: 'Final Verdict', note: null },
    { spellId: 53385, name: 'Divine Storm', note: null },
  ],
  priorityAoe: [{ spellId: 53385, name: 'Divine Storm', note: null }],
  sources: [],
  ...over,
});

const bench = (over: Partial<BossBench> = {}): BossBench => ({
  name: 'Boss',
  n: 8,
  downtimePct: 0.02,
  cpm: 40,
  checks: { always_be_casting: 0.98 },
  cooldowns: {
    31884: { name: 'Avenging Wrath', usage: 1, first: 1500, early: 1 },
    255937: { name: 'Wake of Ashes', usage: 1, first: 45000, early: 0.2 },
  },
  mix: { 383328: { name: 'Final Verdict', share: 0.2 }, 53385: { name: 'Divine Storm', share: 0.8 } },
  potion: { used: 0.9, first: 1500, second: 180000 },
  anchors: [{ spellId: 999, name: 'Big Slam', k: 0, t: 19000, idle: 500, use: [{ spellId: 53385, name: 'Divine Storm', share: 0.75 }] }],
  defensives: [{ spellId: 999, name: 'Big Slam', share: 0.75, spells: [{ spellId: 642, name: 'Divine Shield', share: 0.5 }] }],
  ...over,
});

const me = player('A', {
  specId: 70,
  rotation: rotation(),
  casts: [
    { spellId: 383328, name: 'Final Verdict', times: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000] },
    { spellId: 53385, name: 'Divine Storm', times: [9000, 10000] },
    { spellId: 31884, name: 'Avenging Wrath', times: [30000] },
    { spellId: 255937, name: 'Wake of Ashes', times: [2500] },
  ],
});
const fight = pull(1, 0, 120000, {
  players: [me],
  enemySpells: [{ spellId: 999, name: 'Big Slam', sources: ['Boss'], casts: 2, castTimes: [20000, 70000], hitsOnPlayers: 0, damageToPlayers: 0, interrupted: 0, interruptible: false }],
});

describe('benchMetrics', () => {
  it('soma só o tempo parado dentro da janela', () => {
    expect(idleIn([[0, 5000], [8000, 12000]], 3000, 10000)).toBe(4000);
  });
  it('mistura: fatia de cada habilidade nos casts da rotação', () => {
    const m = castMix(me, rotation());
    expect(m.get(383328)?.share).toBeCloseTo(0.8);
    expect(m.get(53385)?.share).toBeCloseTo(0.2);
  });
});

describe('compareWithTops', () => {
  const v = compareWithTops(fight, me, bench())!;

  it('sem referência do boss (ou sem rotação), nada', () => {
    expect(compareWithTops(fight, me, null)).toBeNull();
    expect(compareWithTops(fight, { ...me, rotation: undefined }, bench())).toBeNull();
  });

  it('aproveitamento e uso de cooldown dos tops em cada item da rotação', () => {
    expect(v.checks).toEqual({ always_be_casting: 0.98 });
    expect(v.cdUsage).toEqual({ 31884: 1, 255937: 1 });
  });

  it('aponta a habilidade que os tops usam bem mais (AoE x alvo único)', () => {
    expect(v.mix[0]).toMatchObject({ name: 'Divine Storm', you: 0.2, tops: 0.8 });
  });

  it('cooldown que os tops seguram e cooldown que eles usam no pull', () => {
    expect(v.cooldowns).toEqual([
      { spellId: 31884, name: 'Avenging Wrath', kind: 'pull', tops: 1500, you: 30000 },
      { spellId: 255937, name: 'Wake of Ashes', kind: 'held', tops: 45000, you: 2500 },
    ]);
  });

  it('janela parada depois de uma mecânica e defensivo nela', () => {
    expect(v.windows).toEqual([{ spellId: 999, name: 'Big Slam', k: 0, t: 20000, you: 6000, tops: 500, use: [{ spellId: 53385, name: 'Divine Storm', share: 0.75 }] }]);
    expect(v.defensives[0]).toMatchObject({ used: 0, of: 2, share: 0.75 });
  });

  it('não conta mecânica depois da morte do player', () => {
    const dead = compareWithTops({ ...fight, deaths: [death('A', 15000)] }, me, bench())!;
    expect(dead.windows).toEqual([]);
    expect(dead.defensives).toEqual([]);
  });

  it('defensivo pessoal perto da mecânica conta', () => {
    const def = { ...me, defensivesUsed: [{ spellId: 642, name: 'Divine Shield', t: 19000, source: 'A' }] };
    expect(compareWithTops(fight, def, bench())!.defensives[0]).toMatchObject({ used: 1, of: 2 });
  });
});
