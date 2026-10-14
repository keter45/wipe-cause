import { describe, expect, it } from 'vitest';
import { movedUntil, posAt, type ReplayUnit } from './replay';

const ghost: ReplayUnit = {
  guid: 'G1',
  name: 'Manifestation of Dread',
  kind: 'ghost',
  owner: 'P1',
  pts: [
    [1000, 0, 0],
    [2000, 0, 0],
    [3000, 3, 4],
    [4000, 3, 4],
  ],
};

describe('fantasma no replay', () => {
  it('soma o caminho até o instante, com o trecho do meio proporcional', () => {
    expect(movedUntil(ghost, 1500)).toBe(0);
    expect(movedUntil(ghost, 2500)).toBeCloseTo(2.5);
    expect(movedUntil(ghost, 3000)).toBeCloseTo(5);
    expect(movedUntil(ghost, Infinity)).toBeCloseTo(5);
  });

  it('some depois do fim (como inimigo), não fica parado como corpo de player', () => {
    expect(posAt(ghost, 4100)).toEqual([3, 4]);
    expect(posAt(ghost, 5000)).toBeNull();
    expect(posAt({ ...ghost, kind: 'player' }, 5000)).toEqual([3, 4]);
  });
});
