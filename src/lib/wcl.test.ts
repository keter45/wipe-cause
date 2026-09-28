import { describe, expect, it } from 'vitest';
import type { Pull } from '../types';
import type { WclFight } from './api';
import { matchFights, reportUrl } from './wcl';

const pull = (id: number, startMs: number, encounterId = 3421) => ({ id, startMs, encounterId }) as Pull;
const fight = (id: number, startMs: number, encounterId = 3421) =>
  ({ id, startMs, encounterId, endMs: startMs + 1, kill: false, fightPercentage: null, difficulty: 5 }) as WclFight;

describe('matchFights', () => {
  it('casa por encounter e horário, ignorando trash e fights distantes', () => {
    const pulls = [pull(0, 1_000_000), pull(1, 1_300_000)];
    const fights = [fight(3, 999_200), fight(4, 1_150_000, 0 /* trash */), fight(5, 1_301_500), fight(9, 5_000_000)];
    expect([...matchFights(pulls, fights)]).toEqual([
      [0, 3],
      [1, 5],
    ]);
  });

  it('não casa com outro boss nem fora da janela de 15s', () => {
    expect(matchFights([pull(0, 0)], [fight(1, 0, 9999), fight(2, 20_000)]).size).toBe(0);
  });
});

it('monta o link da fight', () => {
  expect(reportUrl('AbCd1234', 7)).toBe('https://www.warcraftlogs.com/reports/AbCd1234#fight=7');
});
