import { describe, expect, it } from 'vitest';
import type { MechanicResult } from '../types';
import { scorePull } from './score';
import { analyzePull } from './verdict';
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

describe('wipe geral', () => {
  it('mais de 5 mortes juntas não contam na nota', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    const def = [{ spellId: 1, name: 'Ice Block', kind: 'personal' as const }];
    const p = pull(0, 0, 100_000, {
      analyzedMs: 100_000,
      players: [...names, 'G'].map((n) => player(n)),
      // 6 mortes em 0,5s aos 20s (wipe geral) e G morre sozinho aos 50s
      deaths: [...names.map((n, i) => death(n, 20_000 + i * 100, { defensivesAvailable: def })), death('G', 50_000)],
    });
    const s = scorePull(p, new Map());
    expect(s.get('A')!.score).toBe(100);
    expect(s.get('A')!.parts).toEqual(['morreu no wipe geral aos 0:20 (6+ mortes juntas: não conta)']);
    // G morreu sozinho: continua descontando (decisiva e tempo vivo)
    expect(s.get('G')!.score).toBeLessThan(100);
  });

  it('5 mortes juntas ainda contam', async () => {
    const { massDeathKeys } = await import('./massDeaths');
    const ds = ['A', 'B', 'C', 'D', 'E'].map((n, i) => death(n, 1000 + i * 100));
    expect(massDeathKeys(ds).size).toBe(0);
    expect(massDeathKeys([...ds, death('F', 2400)]).size).toBe(6);
    expect(massDeathKeys([...ds, death('F', 2600)]).size).toBe(0); // fora da janela de 1,5s
  });
});

describe('tank', () => {
  it('dano evitável pesa metade para tank; outras regras não mudam', () => {
    const p = pull(0, 0, 100_000, {
      analyzedMs: 100_000,
      players: [player('T', { role: 'tank' }), player('D')],
      mechanics: [
        mech({ key: 'poca', severity: 'major', players: [blame('T', 1), blame('D', 1)] }),
        mech({ key: 'alcance', name: 'Alcance', kind: 'tank_range', severity: 'major', players: [blame('T', 1)] }),
      ],
    });
    const s = scorePull(p, new Map());
    expect(s.get('T')!.parts).toEqual(['−6 Poça (tank: metade do peso)', '−12 Alcance']);
    expect(s.get('D')!.parts).toEqual(['−12 Poça']);
  });

  it('regra com peso inteiro para tank não divide', () => {
    const p = pull(0, 0, 100_000, {
      analyzedMs: 100_000,
      players: [player('T', { role: 'tank' })],
      mechanics: [mech({ key: 'onda', name: 'Onda', severity: 'major', tankFull: true, players: [blame('T', 1)] })],
    });
    expect(scorePull(p, new Map()).get('T')!.parts).toEqual(['−12 Onda']);
  });
});

describe('foco da progressão', () => {
  it('mecânica de foco entra no veredito mesmo leve, vem primeiro e pesa mais na nota', () => {
    const p = pull(0, 0, 100_000, {
      analyzedMs: 100_000,
      players: [player('A'), player('B')],
      mechanics: [
        mech({ key: 'sever', name: 'Sever', severity: 'major', summary: 'Sever', players: [blame('B', 1)] }),
        mech({ key: 'poca', name: 'Poça', severity: 'minor', focus: true, summary: 'Poça', players: [blame('A', 2)] }),
      ],
    });
    const v = analyzePull(p, new Map());
    expect(v.findings[0]).toMatchObject({ title: 'Poça', focus: true, severity: 'major' });
    const s = scorePull(p, new Map());
    expect(s.get('A')!.parts).toEqual(['−12 ★ Poça (2×)']); // 4 × 1,5 = 6 por erro
  });
});
