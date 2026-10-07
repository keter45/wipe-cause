import { describe, expect, it } from 'vitest';
import type { MechanicResult } from '../types';
import { metricNight, metricOptions, moveMetric } from './bossMetrics';
import { player, pull } from './test-fixtures';

const mech = (over: Partial<MechanicResult>): MechanicResult => ({
  key: 'm', name: 'M', spellId: 1, kind: 'avoidable_damage', severity: 'minor', tip: '', evaluated: true, failures: 0,
  summary: '', players: [], events: [], ...over,
});
const mp = (guid: string, count: number, credit = false) => ({ guid, name: `${guid}-Realm`, count, amount: 0, firstT: 0, credit, message: '' });

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

  it('reordena sem sair da lista', () => {
    expect(moveMetric(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveMetric(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
  });
});
