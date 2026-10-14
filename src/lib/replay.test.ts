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

describe('tempo de cast pelo tooltip', () => {
  it('lê o "X sec cast" do Wowhead; instantâneo ou canalizado fica sem', async () => {
    const { castMsOf } = await import('./wowhead');
    expect(castMsOf({ name: 'Wail of Terror', icon: null, text: 'Wail of Terror 300 yd range 10 sec cast 1 sec cooldown A terrifying scream' })).toBe(10000);
    expect(castMsOf({ name: 'x', icon: null, text: 'x 1.5 sec cast' })).toBe(1500);
    expect(castMsOf({ name: 'x', icon: null, text: 'Instant 30 yd range' })).toBeNull();
    expect(castMsOf(null)).toBeNull();
  });
});
