import { describe, expect, it } from 'vitest';
import type { MechanicResult, PlayerStackOrigins } from '../types';
import { stackOriginsOfNight } from './stackOrigins';
import { player, pull } from './test-fixtures';

const o = (guid: string, over: Partial<PlayerStackOrigins>): PlayerStackOrigins => ({
  guid, name: `${guid}-Realm`, maxStacks: 0, avoidable: [], unavoidable: [], removed: [], unknown: 0, ...over,
});
const venom = (stackOrigins: PlayerStackOrigins[]): MechanicResult => ({
  key: 'venom', name: 'Eternal Venom', spellId: 1, kind: 'stack_limit', severity: 'wipe', tip: '', evaluated: true, failures: 0,
  summary: '', players: [], events: [], stackOrigins,
});
const wave = { key: 'wave', name: 'Wave' };
const orb = { key: 'orb', name: 'Orb' };
const adds = { key: 'adds', name: 'Adds' };

describe('stackOriginsOfNight', () => {
  const night = stackOriginsOfNight([
    pull(0, 0, 100_000, {
      players: [player('A', { class: 'Priest' }), player('B')],
      mechanics: [
        venom([
          o('A', { maxStacks: 6, avoidable: [{ ...wave, count: 2 }], unavoidable: [{ ...adds, count: 4 }], removed: [{ key: 'feast', name: 'Feast', count: 1 }] }),
          o('B', { maxStacks: 4, unavoidable: [{ ...adds, count: 4 }], unknown: 1 }),
        ]),
        { ...venom([]), key: 'wave', name: 'Wave', kind: 'avoidable_damage', spellId: 77, stackOrigins: undefined },
      ],
    }),
    pull(1, 200_000, 100_000, {
      players: [player('A'), player('B')],
      mechanics: [venom([o('B', { maxStacks: 9, avoidable: [{ ...orb, count: 1 }, { ...wave, count: 2 }] })])],
    }),
  ]);

  it('soma o raid por fonte, com as evitáveis que mais deram stack primeiro', () => {
    expect(night).toHaveLength(1);
    const n = night[0];
    expect(n.avoidable.map((s) => [s.key, s.count, s.spellId])).toEqual([
      ['wave', 4, 77],
      ['orb', 1, null],
    ]);
    expect(n.unavoidable.map((s) => [s.key, s.count])).toEqual([['adds', 8]]);
    expect(n.removed[0].count).toBe(1);
    expect(n.unknown).toBe(1);
  });

  it('cada player com os evitáveis por fonte, quem pegou mais evitável primeiro', () => {
    const rows = night[0].players.map((p) => [p.guid, p.avoidableTotal, p.avoidable, p.unavoidableTotal, p.maxStacks, p.pulls]);
    expect(rows).toEqual([
      ['B', 3, { orb: 1, wave: 2 }, 4, 9, 2],
      ['A', 2, { wave: 2 }, 4, 6, 2],
    ]);
    expect(night[0].players[1].class).toBe('Priest');
  });
});
