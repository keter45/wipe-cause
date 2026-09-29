import { describe, expect, it } from 'vitest';
import { buildTrends, trendBosses, type NightInput } from './trends';
import { death, pull } from './test-fixtures';

const guillotine = { key: 'guillotine', name: 'Guillotine', amount: 1, pct: 100, failT: 1000 };
const orb = { key: 'orb', name: 'Orb roxo', amount: 1, pct: 100, failT: 1000 };
const def = [{ spellId: 1, name: 'Ice Block', kind: 'personal' as const }];

/** noite com `wipes` wipes; `orbs` deles com gatilho no orb; A morre para Guillotine sem defensivo */
function night(id: string, title: string, start: number, wipes: number, orbs: number, bestHp: number): NightInput {
  return {
    id,
    title,
    raidStartMs: start,
    pulls: Array.from({ length: wipes }, (_, i) =>
      pull(i, start + i * 300_000, 120_000, {
        bosses: [{ guid: 'b', name: 'Boss', npcId: 1, maxHp: 1, hpPct: i === 0 ? bestHp : 90, hpPctAtCutoff: null }],
        trigger: i < orbs ? { key: 'orb', name: 'Orb roxo', t: 1, deaths: 2 } : null,
        deaths: [death('A', 10_000, { causedBy: guillotine, defensivesAvailable: def }), death('B', 20_000, { causedBy: orb })],
      }),
    ),
  };
}

describe('buildTrends', () => {
  const nights = [night('n2', '24/09 · Boss Mythic', 2_000_000, 4, 1, 40), night('n1', '21/09 · Boss Mythic', 1_000_000, 4, 3, 60)];
  const t = buildTrends(nights, 'Boss · Mythic');

  it('ordena as noites pela data e resume cada uma', () => {
    expect(t.nights.map((n) => n.label)).toEqual(['21/09', '24/09']);
    expect(t.nights.map((n) => n.summary.best?.hp)).toEqual([60, 40]);
  });

  it('conta gatilhos por noite', () => {
    expect(t.causes[0]).toMatchObject({ key: 'orb', perNight: [3, 1], total: 4 });
  });

  it('acha o que se repete com cada player', () => {
    const a = t.players.find((p) => p.guid === 'A')!;
    expect(a.topKiller).toEqual(['Guillotine', 8]);
    expect(a.topKillerNights).toBe(2);
    expect(a.deathsNoDefensive).toBe(8);
    expect(a.deathsPerPull).toEqual([1, 1]);
  });

  it('escreve as conclusões', () => {
    expect(t.insights).toContain('Melhor pull por noite: 60.0% → 40.0%.');
    expect(t.insights).toContain('Orb roxo: gatilho em 75% dos wipes em 21/09 → 25% em 24/09 (melhorou).');
    expect(t.insights).toContain('A morreu para Guillotine 8× em 2 noites, 8 delas com defensivo sobrando.');
  });

  it('lista os bosses do histórico', () => {
    expect(trendBosses(nights)).toEqual([{ key: 'Boss · Mythic', nights: 2, pulls: 8 }]);
  });
});
