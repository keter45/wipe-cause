import { describe, expect, it } from 'vitest';
import type { Pull } from '../types';
import type { WcrVideo } from './api';
import { matchVideos } from './wcr';

const pull = (id: number, startMs: number, encounterId = 3421) => ({ id, startMs, encounterId }) as Pull;
const video = (name: string, startMs: number, encounterId = 3421) =>
  ({ videoPath: name, startMs, encounterId, durationS: 60, result: false, difficultyId: 16, bossPercent: null, player: 'x' }) as WcrVideo;

describe('matchVideos', () => {
  it('casa pelo encounter e pelo início (start do Recorder arredondado para o segundo)', () => {
    const m = matchVideos([pull(0, 1_790_038_180_702), pull(1, 1_790_038_500_000)], [video('a', 1_790_038_180_000), video('b', 1_790_038_499_000)]);
    expect(m.get(0)?.videoPath).toBe('a');
    expect(m.get(1)?.videoPath).toBe('b');
  });

  it('ignora outro boss e vídeos a mais de 5s', () => {
    const m = matchVideos([pull(0, 100_000)], [video('x', 100_000, 1), video('y', 106_000)]);
    expect(m.size).toBe(0);
  });
});
