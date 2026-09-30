import { describe, expect, it } from 'vitest';
import { dungeonsOnly, isDungeon, raidOnly } from './content';
import { logTitle } from './format';
import { buildTrends, trendBosses } from './trends';
import { pull } from './test-fixtures';

describe('raid x masmorra', () => {
  it('reconhece M+, masmorras e grupos de 5; world boss do tier é raid', () => {
    expect(isDungeon({ difficultyId: 8, groupSize: 5 })).toBe(true);
    expect(isDungeon({ difficultyId: 23 })).toBe(true);
    expect(isDungeon({ difficultyId: 16, groupSize: 20 })).toBe(false);
    expect(isDungeon({ difficultyId: 233, groupSize: 25 })).toBe(false);
    // o campo do núcleo vence (análises novas)
    expect(isDungeon({ difficultyId: 16, dungeon: true })).toBe(true);
  });

  const raid = pull(0, 1_000, 200_000, { encounterName: 'Sszorak', difficultyName: 'Mythic', startLocal: '9/29/2026 21:00:00.000-3' });
  const mplus = (id: number, name: string) =>
    pull(id, id * 1_000, 120_000, { encounterId: 100 + id, encounterName: name, difficultyId: 8, difficultyName: 'Mythic+', groupSize: 5, startLocal: '9/29/2026 18:00:00.000-3' });
  const pulls = [mplus(1, 'Adderis'), mplus(2, 'Merektha'), mplus(3, 'Galvazzt'), raid];

  it('título do log e Evolução ficam só com a raid', () => {
    expect(raidOnly(pulls)).toEqual([raid]);
    expect(dungeonsOnly(pulls)).toHaveLength(3);
    expect(logTitle(pulls)).toBe('29/09 · Sszorak Mythic');
    const nights = [{ id: 'n', title: '29/09', raidStartMs: 0, pulls }];
    expect(trendBosses(nights).map((b) => b.key)).toEqual(['Sszorak · Mythic']);
    expect(buildTrends(nights, 'Sszorak · Mythic').nights).toHaveLength(1);
  });

  it('log só de masmorra ainda tem título', () => {
    expect(logTitle([mplus(1, 'Adderis')])).toBe('29/09 · Adderis Mythic+');
  });
});
