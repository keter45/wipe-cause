import { describe, expect, it } from 'vitest';
import type { MechanicResult } from '../types';
import { scorePull } from './score';
import { death, player, pull } from './test-fixtures';

const mech = (over: Partial<MechanicResult>): MechanicResult => ({
  key: 'm', name: 'Poça', spellId: null, kind: 'avoidable_damage', severity: 'minor', tip: '', evaluated: true, failures: 1,
  summary: '', players: [], events: [], ...over,
});
const blame = (guid: string, count: number) => ({ guid, name: `${guid}-Realm`, count, amount: 0, firstT: 0, credit: false, message: '' });

describe('scorePull', () => {
  const p = pull(0, 0, 100_000, {
    analyzedMs: 100_000,
    players: [player('A'), player('B'), player('C')],
    mechanics: [
      mech({ key: 'poca', players: [blame('A', 10)] }), // minor, conta no máx. 3 → −12
      mech({ key: 'sever', name: 'Sever', severity: 'major', players: [blame('B', 1)] }), // −12
    ],
    // C morre aos 50s (decisiva, com defensivo sobrando)
    deaths: [death('C', 50_000, { defensivesAvailable: [{ spellId: 1, name: 'Ice Block', kind: 'personal' }] })],
  });
  const s = scorePull(p, new Map());

  it('desconta erros pela gravidade, com teto por mecânica', () => {
    expect(s.get('A')!.score).toBe(88);
    expect(s.get('A')!.parts).toEqual(['−12 Poça (3×)']);
    expect(s.get('B')!.score).toBe(88);
  });

  it('morte decisiva e tempo vivo pesam', () => {
    // (100 − 15 − 10) × (0,5 + 0,5 × 0,5) = 75 × 0,75 = 56
    expect(s.get('C')!.score).toBe(56);
    expect(s.get('C')!.parts).toContain('vivo 50% do pull (×0,75)');
  });

  it('quem não errou fica com 100', () => {
    const clean = scorePull(pull(1, 0, 60_000, { players: [player('D')] }), new Map());
    expect(clean.get('D')).toEqual({ score: 100, parts: [] });
  });
});
