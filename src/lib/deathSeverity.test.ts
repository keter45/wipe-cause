import { describe, expect, it } from 'vitest';
import type { Death } from '../types';
import { death, player, pull } from './test-fixtures';
import { computeDeathSeverity, EVOLUTION_RULES, NIGHT_RULES, severityLevel, wipeDeaths } from './deathSeverity';

const BLUR = { spellId: 198589, name: 'Blur', kind: 'personal' as const };
const EVASION = { spellId: 5277, name: 'Evasion', kind: 'personal' as const };
const rules = { minPulls: 0, minPullsFrac: 0, dimBelow: 2, minDeaths: 0 };

/** morte "tudo livre": defensivo grande, healthstone e poção livres */
const allFree = (guid: string, t: number, over: Partial<Death> = {}) =>
  death(guid, t, { defensivesAvailable: [BLUR], healthstoneKnown: true, usedHealthstone: false, usedHealthPotion: false, ...over });

describe('severityLevel', () => {
  it('kit com defensivo grande: máximo 4', () => {
    expect(severityLevel(true, true, true, true)).toBe(4);
    expect(severityLevel(false, true, true, true)).toBe(2);
    expect(severityLevel(false, true, false, true)).toBe(1);
    expect(severityLevel(true, true, false, true)).toBe(3);
    expect(severityLevel(false, false, false, true)).toBe(0);
  });
  it('kit sem defensivo grande: máximo 2', () => {
    expect(severityLevel(false, true, true, false)).toBe(4);
    expect(severityLevel(false, true, false, false)).toBe(2);
    expect(severityLevel(false, false, false, false)).toBe(0);
  });
});

describe('wipeDeaths', () => {
  it('5 ou mais mortes em 1,5s são wipe; 4 não', () => {
    const four = ['a', 'b', 'c', 'd'].map((g, i) => death(g, 1000 + i * 400));
    expect(wipeDeaths(four).size).toBe(0);
    const five = [...four, death('e', 2200)];
    expect(wipeDeaths(five).size).toBe(5);
  });
  it('a janela é de 1,5s para cada lado de cada morte', () => {
    const ds = [death('a', 0), death('b', 500), death('c', 1000), death('d', 1500), death('e', 1500), death('f', 9000)];
    const w = wipeDeaths(ds);
    expect(w.has(ds[5])).toBe(false);
    expect(w.has(ds[0])).toBe(true);
  });
});

describe('computeDeathSeverity', () => {
  it('só DPS: healer e tank ficam fora, pelo papel da morte ou do player no pull', () => {
    const p = pull(0, 0, 1000, {
      players: [player('A'), player('H', { role: 'healer' }), player('T', { role: 'tank' }), player('N', { role: 'dps' })],
      deaths: [allFree('A', 100), allFree('H', 200, { role: 'healer' }), allFree('T', 300, { role: null }), allFree('N', 400, { role: null })],
    });
    const r = computeDeathSeverity([p], rules);
    expect(r.rows.map((x) => x.guid).sort()).toEqual(['A', 'N']);
  });

  it('não conta morte depois da call de wipe', () => {
    const p = pull(0, 0, 1000, { players: [player('A')], deaths: [allFree('A', 100), allFree('A', 5000, { ignored: true })] });
    expect(computeDeathSeverity([p], rules).rows[0].deaths).toBe(1);
  });

  it('não conta morte em wipe (5+ em 1,5s, contando todas as mortes do pull)', () => {
    const others = ['H', 'T', 'X', 'Y'].map((g, i) => death(g, 10_000 + i * 100, { role: 'healer' }));
    const p = pull(0, 0, 20_000, {
      players: [player('A'), player('B')],
      deaths: [...others, allFree('A', 10_300), allFree('B', 2000)],
    });
    const rows = computeDeathSeverity([p], rules).rows;
    expect(rows.find((x) => x.guid === 'A')!.deaths).toBe(0);
    expect(rows.find((x) => x.guid === 'B')!.deaths).toBe(1);
  });

  it('golpes fatais da lista do boss não contam (sem diferenciar maiúsculas); em outro boss contam', () => {
    const blow = { t: 0, kind: 'damage' as const, spellId: 1, spellName: 'ETERNAL Nightfall', source: '', amount: 1, overkill: 0, absorbed: 0, hpPct: null };
    const mk = (encounterId: number) =>
      pull(0, 0, 1000, {
        encounterId,
        players: [player('A')],
        deaths: [allFree('A', 100, { killingBlow: blow }), allFree('A', 300, { killingBlow: { ...blow, spellName: 'Venom Rupture' } })],
      });
    expect(computeDeathSeverity([mk(3429)], rules).rows[0].deaths).toBe(1);
    expect(computeDeathSeverity([mk(1)], rules).rows[0].deaths).toBe(2);
  });

  it('kit sem defensivo grande tem máximo 2 (Evasion não conta)', () => {
    const p = pull(0, 0, 1000, {
      players: [player('A')],
      deaths: [death('A', 100, { defensivesAvailable: [EVASION], healthstoneKnown: true, usedHealthstone: false, usedHealthPotion: false })],
    });
    const row = computeDeathSeverity([p], rules).rows[0];
    expect(row.hasBigKit).toBe(false);
    expect(row.full).toBe(1);
    expect(row.defensive).toBeNull();
  });

  it('o kit conta defensivo usado (defensivesRecent) em qualquer morte', () => {
    const recent = { spellId: 198589, name: 'Blur', t: 0, source: null };
    const p = pull(0, 0, 1000, {
      players: [player('A')],
      deaths: [
        death('A', 100, { defensivesRecent: [recent], healthstoneKnown: true, usedHealthPotion: false }),
        death('A', 9000, { healthstoneKnown: true, usedHealthPotion: false }),
      ],
    });
    const row = computeDeathSeverity([p], rules).rows[0];
    expect(row.hasBigKit).toBe(true);
    // healthstone + poção = 2 de 4 nas duas mortes: nível 2
    expect(row.partial).toBe(2);
    expect(row.full).toBe(0);
  });

  it('níveis, contagens livres, ícone do defensivo e o mais esquecido', () => {
    const p = pull(0, 0, 1000, {
      players: [player('A')],
      deaths: [
        allFree('A', 100),
        allFree('A', 5000),
        death('A', 9000, { usedHealthstone: true, healthstoneKnown: true, usedHealthPotion: true, defensivesRecent: [{ spellId: 198589, name: 'Blur', t: 0, source: null }] }),
      ],
    });
    const row = computeDeathSeverity([p], rules).rows[0];
    expect(row).toMatchObject({ deaths: 3, full: 2, partial: 0, used: 1 });
    expect(row.fullPct).toBeCloseTo(2 / 3);
    expect(row.free).toEqual({ defensive: 2, healthstone: 2, potion: 2 });
    expect(row.defensive?.spellId).toBe(198589);
    expect([...row.forgotten].sort()).toEqual(['defensive', 'healthstone', 'potion']);
  });

  it('ordena por % de tudo livre, decrescente', () => {
    const p = pull(0, 0, 1000, {
      players: [player('A'), player('B')],
      deaths: [death('A', 100, { usedHealthPotion: true }), allFree('B', 5000)],
    });
    expect(computeDeathSeverity([p], rules).rows.map((x) => x.guid)).toEqual(['B', 'A']);
  });

  it('mínimo de pulls: 50 na Evolução, 30% dos pulls na noite', () => {
    const mk = (i: number) => pull(i, i * 10_000, 1000, { players: i < 3 ? [player('A'), player('B')] : [player('A')], deaths: [] });
    const ten = Array.from({ length: 10 }, (_, i) => mk(i));
    // B jogou 3 de 10 = 30%: entra na noite (aqui sem o filtro de mortes, que é testado à parte)
    const night = { ...NIGHT_RULES, minDeaths: 0 };
    expect(computeDeathSeverity(ten, night).rows.map((x) => x.guid).sort()).toEqual(['A', 'B']);
    expect(computeDeathSeverity(ten.slice(1), night).rows.map((x) => x.guid)).toEqual(['A']);
    const sixty = Array.from({ length: 60 }, (_, i) => pull(i, i * 10_000, 1000, { players: i < 49 ? [player('A'), player('B')] : [player('A')] }));
    const r = computeDeathSeverity(sixty, EVOLUTION_RULES);
    expect(r.rows.map((x) => x.guid)).toEqual(['A']);
    expect(r.minPulls).toBe(50);
  });

  it('resumo da noite: só quem tem ao menos 1 morte contada; a Evolução mostra todos', () => {
    const p = pull(0, 0, 1000, {
      players: [player('A'), player('B'), player('C')],
      // B só tem morte ignorada (depois da call): zero mortes contadas
      deaths: [allFree('A', 100), allFree('B', 200, { ignored: true })],
    });
    expect(computeDeathSeverity([p], NIGHT_RULES).rows.map((x) => x.guid)).toEqual(['A']);
    expect(computeDeathSeverity([p], { ...EVOLUTION_RULES, minPulls: 0 }).rows.map((x) => x.guid).sort()).toEqual(['A', 'B', 'C']);
  });

  it('esmaece quem tem menos mortes que o limite', () => {
    const p = pull(0, 0, 1000, { players: [player('A'), player('B')], deaths: [allFree('A', 100), allFree('A', 5000), allFree('B', 9000)] });
    const rows = computeDeathSeverity([p], rules).rows;
    expect(rows.find((x) => x.guid === 'A')!.dim).toBe(false);
    expect(rows.find((x) => x.guid === 'B')!.dim).toBe(true);
  });
});
