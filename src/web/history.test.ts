import { describe, expect, it } from 'vitest';
import type { LogReport } from '../types';
import { compact } from './history';
import { player, pull } from '../lib/test-fixtures';

describe('compact (histórico da Evolução)', () => {
  it('tira as séries da note de CDs de cura', () => {
    const p = pull(0, 0, 1000, {
      raidSeries: { alive: [1], low: [0], maxHpK: [1], unavoidableK: [0] },
      enemyHits: [[0, 1, 2]],
      players: [player('A', { cdHeals: [[0, 740, 1, 0]] })],
    });
    const out = compact({ pulls: [p] } as unknown as LogReport);
    expect(out.pulls[0].raidSeries).toBeUndefined();
    expect(out.pulls[0].enemyHits).toBeUndefined();
    expect(out.pulls[0].players[0].cdHeals).toBeUndefined();
    expect(out.pulls[0].players[0].name).toBe('A-Realm');
  });
});
