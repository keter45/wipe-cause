import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addMark, getMarks, removeMark } from './marks';
import { analyzePull } from './verdict';
import { scorePull } from './score';
import { player, pull } from './test-fixtures';

// Node não tem localStorage: um substituto em memória
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

describe('erros marcados à mão', () => {
  beforeEach(() => store.clear());

  it('entram no veredito e na nota do player, e saem quando removidos', () => {
    const p = pull(0, 1_000, 100_000, { analyzedMs: 100_000, players: [player('A'), player('B')] });
    addMark(p, { guid: 'A', name: 'A-Realm', what: 'soakou o orb errado', severity: 'major' });
    expect(analyzePull(p, new Map()).findings.some((f) => f.title === 'A: soakou o orb errado' && f.player === 'A')).toBe(true);
    expect(scorePull(p, new Map()).get('A')).toEqual({ score: 88, parts: ['−12 ✎ soakou o orb errado'], perf: null });
    removeMark(p, getMarks(p)[0].id);
    expect(scorePull(p, new Map()).get('A')!.score).toBe(100);
  });

  it('são por pull (boss + início)', () => {
    const a = pull(0, 1_000, 60_000);
    const b = pull(1, 2_000, 60_000);
    addMark(a, { guid: 'A', name: 'A-Realm', what: 'x', severity: 'minor' });
    expect(getMarks(a)).toHaveLength(1);
    expect(getMarks(b)).toHaveLength(0);
  });
});
