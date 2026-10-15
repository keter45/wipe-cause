import { describe, expect, it } from 'vitest';
import { clockText, fitClipRange, parseClock } from './clipSpan';

describe('fitClipRange', () => {
  const bounds: [number, number] = [10_000, 100_000];

  it('fica dentro do replay', () => {
    expect(fitClipRange([5_000, 20_000], bounds, 'from')).toEqual([10_000, 20_000]);
    expect(fitClipRange([90_000, 120_000], bounds, 'to')).toEqual([90_000, 100_000]);
  });

  it('mexer numa ponta empurra a outra (no máximo 30 s, no mínimo 1 s)', () => {
    expect(fitClipRange([20_000, 80_000], bounds, 'from')).toEqual([20_000, 50_000]);
    expect(fitClipRange([20_000, 80_000], bounds, 'to')).toEqual([50_000, 80_000]);
    expect(fitClipRange([40_000, 30_000], bounds, 'from')).toEqual([40_000, 41_000]);
    expect(fitClipRange([40_000, 30_000], bounds, 'to')).toEqual([29_000, 30_000]);
  });

  it('no fim do replay, o início recua para caber 1 s', () => {
    expect(fitClipRange([100_000, 100_000], bounds, 'from')).toEqual([99_000, 100_000]);
  });
});

describe('parseClock / clockText', () => {
  it('lê m:ss e segundos', () => {
    expect(parseClock('1:23.4')).toBe(83_400);
    expect(parseClock('1:23,4')).toBe(83_400);
    expect(parseClock('83.4')).toBe(83_400);
    expect(parseClock(' 0:05 ')).toBe(5_000);
    expect(parseClock('1:75')).toBeNull();
    expect(parseClock('abc')).toBeNull();
  });

  it('escreve m:ss.d', () => {
    expect(clockText(83_400)).toBe('1:23.4');
    expect(clockText(5_000)).toBe('0:05.0');
    expect(clockText(59_960)).toBe('1:00.0');
  });
});
