import { describe, expect, it } from 'vitest';
import type { MechanicResult } from '../types';
import { metricNight, metricOptions, metricTrend, moveMetric } from './bossMetrics';
import { player, pull } from './test-fixtures';

const mech = (over: Partial<MechanicResult>): MechanicResult => ({
  key: 'm', name: 'M', spellId: 1, kind: 'avoidable_damage', severity: 'minor', tip: '', evaluated: true, failures: 0,
  summary: '', players: [], events: [], ...over,
});
const mp = (guid: string, count: number, credit = false, amount = 0) => ({ guid, name: `${guid}-Realm`, count, amount, firstT: 0, credit, message: '' });

describe('métricas do resumo do boss', () => {
  const pulls = [
    pull(0, 0, 60_000, {
      players: [player('A', { class: 'Priest' }), player('B')],
      mechanics: [
        mech({ key: 'wave', name: 'Wave', severity: 'wipe', failures: 3, players: [mp('A', 2), mp('B', 1)] }),
        mech({ key: 'soak', name: 'Soak', kind: 'soak', severity: 'major', failures: 1, players: [mp('A', 4, true)] }),
        mech({ key: 'venom', name: 'Venom', kind: 'stack_limit', failures: 1, players: [mp('B', 9)] }),
        mech({ key: 'phase', name: 'Phase', kind: 'phase_duration', failures: 2 }),
        mech({ key: 'tip', name: 'Tip', kind: 'info', evaluated: false }),
      ],
    }),
    pull(1, 100_000, 60_000, {
      players: [player('A'), player('B')],
      mechanics: [
        mech({ key: 'wave', name: 'Wave', severity: 'wipe', failures: 0 }),
        mech({ key: 'soak', name: 'Soak', kind: 'soak', severity: 'major', failures: 2, players: [mp('B', 1, true)] }),
        mech({ key: 'venom', name: 'Venom', kind: 'stack_limit', failures: 1, players: [mp('B', 10)] }),
      ],
    }),
  ];

  it('oferece as mecânicas avaliadas (sem fase nem dica), as que mais falharam primeiro', () => {
    expect(metricOptions(pulls).map((o) => [o.key, o.failures, o.pullsWithFailure])).toEqual([
      ['wave', 3, 1],
      ['soak', 3, 2],
      ['venom', 2, 2],
    ]);
  });

  it('soma a mecânica na noite: falhas pull a pull, quem errou e quem ajudou', () => {
    const w = metricNight(pulls, 'wave')!;
    expect(w.perPull.map((x) => x.failures)).toEqual([3, 0]);
    expect([w.total, w.pullsWithFailure, w.collective]).toEqual([3, 1, false]);
    expect(w.players.map((p) => [p.guid, p.count, p.pulls, p.class])).toEqual([
      ['A', 2, 1, 'Priest'],
      ['B', 1, 1, 'Mage'],
    ]);
    const s = metricNight(pulls, 'soak')!;
    expect(s.collective).toBe(true);
    expect(s.helpers.map((p) => [p.guid, p.count])).toEqual([
      ['A', 4],
      ['B', 1],
    ]);
    // stack_limit: conta pulls acima do limite e guarda o máximo de stacks
    expect(metricNight(pulls, 'venom')!.players.map((p) => [p.guid, p.count, p.max])).toEqual([['B', 2, 10]]);
    expect(metricNight(pulls, 'nada')).toBeNull();
  });

  it('soma o dano tomado nas mecânicas de hit (só nos kinds de dano por hit)', () => {
    const night = [
      pull(0, 0, 60_000, {
        players: [player('A'), player('B')],
        mechanics: [mech({ key: 'bad', name: 'Bad', kind: 'avoidable_damage', failures: 2, players: [mp('A', 2, false, 1_200_000), mp('B', 1, false, 340_000)] })],
      }),
      pull(1, 100_000, 60_000, {
        players: [player('A'), player('B')],
        mechanics: [mech({ key: 'bad', name: 'Bad', kind: 'avoidable_damage', failures: 0 })],
      }),
      pull(2, 200_000, 60_000, {
        players: [player('A'), player('B')],
        mechanics: [mech({ key: 'bad', name: 'Bad', kind: 'avoidable_damage', failures: 1, players: [mp('B', 2, false, 500_000)] })],
      }),
    ];
    const m = metricNight(night, 'bad')!;
    expect(m.damage).toBe(2_040_000);
    expect(m.perPull.map((x) => x.damage)).toEqual([1_540_000, 0, 500_000]);
    expect(m.players.map((p) => [p.guid, p.damage])).toEqual([
      ['B', 840_000],
      ['A', 1_200_000],
    ]);
    // kinds que não são dano por hit não ganham o campo
    expect(metricNight(pulls, 'soak')!.damage).toBeUndefined();
    expect(metricNight(pulls, 'venom')!.damage).toBeUndefined();
    expect(metricNight(pulls, 'wave')!.damage).toBe(0);
  });

  it('evolui a métrica entre noites: total por noite e players somados com as noites em que repetiram', () => {
    const wave = (failures: number, players: ReturnType<typeof mp>[]) => mech({ key: 'wave', name: 'Wave', severity: 'wipe', failures, players });
    const night1 = [pull(0, 0, 60_000, { players: [player('A'), player('B')], mechanics: [wave(3, [mp('A', 2), mp('B', 1)])] })];
    const night2 = [
      pull(1, 100_000, 60_000, { players: [player('A'), player('C')], mechanics: [wave(2, [mp('A', 1), mp('C', 1)])] }),
      pull(2, 200_000, 60_000, { players: [player('A')], mechanics: [wave(1, [mp('A', 1)])] }),
    ];
    const trend = metricTrend([{ label: 'n1', pulls: night1 }, { label: 'n2', pulls: night2 }, { label: 'n3', pulls: [] }], 'wave')!;
    expect(trend.nights.map((n) => [n.label, n.night?.total ?? null])).toEqual([['n1', 3], ['n2', 3], ['n3', null]]);
    expect(trend.players.map((p) => [p.guid, p.count, p.pulls, p.nights])).toEqual([
      ['A', 4, 3, 2],
      ['B', 1, 1, 1],
      ['C', 1, 1, 1],
    ]);
    expect(metricTrend([{ label: 'n1', pulls: night1 }], 'nada')).toBeNull();
  });

  it('jardas que o fantasma de cada um andou na noite', () => {
    const ghosts = (players: [string, number, number][]) => ({ spellId: 7, name: 'Manifestation of Dread', players: players.map(([g, yards, n]) => ({ guid: g, name: `${g}-Realm`, yards, ghosts: n })) });
    const night = [
      pull(0, 0, 60_000, { players: [player('A', { class: 'Priest' }), player('B')], mechanics: [mech({ key: 'dread', name: 'Collision', kind: 'failure_event', severity: 'major', failures: 1, ghostYards: ghosts([['A', 30.4, 2], ['B', 5, 1]]) })] }),
      pull(1, 100_000, 60_000, { players: [player('A'), player('B')], mechanics: [mech({ key: 'dread', name: 'Collision', kind: 'failure_event', severity: 'major', ghostYards: ghosts([['B', 12.2, 2]]) })] }),
      pull(2, 200_000, 60_000, { mechanics: [mech({ key: 'dread', name: 'Collision', kind: 'failure_event', severity: 'major' })] }),
    ];
    // a opção vem depois das mecânicas, com as jardas da noite
    expect(metricOptions(night).map((o) => [o.key, o.unit, o.amount, o.pullsWithFailure])).toEqual([
      ['dread', undefined, undefined, 1],
      ['dread:yards', 'yd', 48, 2],
    ]);
    const y = metricNight(night, 'dread:yards')!;
    expect([y.unit, y.name, y.spellId, y.total, y.pullsWithFailure]).toEqual(['yd', 'Manifestation of Dread', 7, 48, 2]);
    expect(y.perPull.map((x) => x.failures)).toEqual([35, 12]);
    // quem deixou andar mais primeiro; `max` = quantos fantasmas teve
    expect(y.players.map((p) => [p.guid, p.count, p.pulls, p.max, p.class])).toEqual([
      ['A', 30, 1, 2, 'Priest'],
      ['B', 17, 2, 3, 'Mage'],
    ]);
  });

  it('reordena sem sair da lista', () => {
    expect(moveMetric(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveMetric(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
  });
});
