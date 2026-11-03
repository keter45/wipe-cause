import { describe, expect, it } from 'vitest';
import { PAN_SLOP_PX, ZOOM_MIN_MS, ZOOM_STEP, panBy, zoomAt } from './useTimeWindow';

const DURATION = 300_000;

describe('zoomAt', () => {
  it('não passa do trecho mínimo', () => {
    const [a, b] = zoomAt([0, ZOOM_MIN_MS], DURATION, ZOOM_MIN_MS / 2, -1);
    expect(b - a).toBe(ZOOM_MIN_MS);
    expect(a).toBe(0);
  });

  it('não passa da duração do pull', () => {
    const [a, b] = zoomAt([0, DURATION], DURATION, DURATION / 2, 1);
    expect(a).toBe(0);
    expect(b).toBe(DURATION);
  });

  it('mantém o instante do cursor no lugar', () => {
    const win: [number, number] = [60_000, 120_000];
    const at = 90_000;
    const [a, b] = zoomAt(win, DURATION, at, -1);
    expect(b - a).toBe((win[1] - win[0]) / ZOOM_STEP);
    expect(a + ((at - win[0]) / (win[1] - win[0])) * (b - a)).toBeCloseTo(at);
    expect(a).toBe(66_000);
    expect(b).toBe(114_000);
  });

});

describe('panBy', () => {
  it('não passa de zero', () => {
    expect(panBy([10_000, 40_000], DURATION, -50_000)).toEqual([0, 30_000]);
  });

  it('não passa da duração', () => {
    expect(panBy([250_000, 280_000], DURATION, 100_000)).toEqual([270_000, 300_000]);
  });

  it('anda pelo deslocamento quando cabe', () => {
    expect(panBy([100_000, 130_000], DURATION, 20_000)).toEqual([120_000, 150_000]);
  });

  it('exporta a sensibilidade do arrasto', () => {
    expect(PAN_SLOP_PX).toBe(4);
  });
});
