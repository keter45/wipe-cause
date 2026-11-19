import { describe, expect, it } from 'vitest';
import { fightSettled } from './wcl';

// tempos do report em epoch ms; tempos de fight relativos ao início do report (como no WCL)
describe('fightSettled', () => {
  const start = 1_760_000_000_000;
  const now = start + 3 * 3_600_000;

  it('o último fight de um report ao vivo ainda não assentou', () => {
    expect(fightSettled([start, now - 1_000], 3 * 3_600_000 - 1_000, now)).toBe(false);
  });
  it('fight com eventos do report depois dele assentou', () => {
    expect(fightSettled([start, now - 1_000], 3_600_000, now)).toBe(true);
  });
  it('report parado há mais de 10 min assentou', () => {
    expect(fightSettled([start, now - 11 * 60_000], 3 * 3_600_000 - 11 * 60_000, now)).toBe(true);
  });
});
