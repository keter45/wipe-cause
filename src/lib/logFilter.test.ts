import { describe, expect, it } from 'vitest';
import type { Night, NightBossRow } from './nights';
import { bossOptions, filterNights, matchesBoss } from './logFilter';

const boss = (encounterId: number, difficultyId = 16): NightBossRow => ({
  encounterId, name: `Boss ${encounterId}`, difficultyId, local: 5, localKills: 0, missing: 0, missingKills: 0, guild: null,
});
const night = (key: string, startMs: number, bosses: NightBossRow[]): Night => ({
  key, startMs, endMs: startMs + 1, files: [], wcl: null, bosses, dungeonBosses: 0, missingPulls: 0, missingMs: 0, live: false, kind: null,
});

describe('filtro de noites por boss', () => {
  const nights = [
    night('seg', 100, [boss(1, 15), boss(2, 15)]),
    night('qua', 300, [boss(2, 16), boss(2, 15), boss(3, 16)]),
    night('dom', 200, [boss(1, 16)]),
  ];

  it('lista os bosses das noites, o que apareceu mais recente primeiro', () => {
    expect(bossOptions(nights).map((b) => [b.encounterId, b.nights, b.difficulties])).toEqual([
      [2, 2, [16, 15]],
      [3, 1, [16]],
      [1, 2, [16, 15]],
    ]);
  });

  it('sem boss escolhido mostra tudo; com boss, só as noites dele; com dificuldade, só nela', () => {
    expect(filterNights(nights, { encounterId: null, difficultyId: null, group: 'all' })).toHaveLength(3);
    expect(filterNights(nights, { encounterId: 1, difficultyId: null, group: 'all' }).map((n) => n.key)).toEqual(['seg', 'dom']);
    expect(filterNights(nights, { encounterId: 2, difficultyId: 16, group: 'all' }).map((n) => n.key)).toEqual(['qua']);
    expect(matchesBoss(boss(2, 15), { encounterId: 2, difficultyId: 16, group: 'all' })).toBe(false);
  });
});

describe('guilda x pug', () => {
  const g = (encounterId: number, guild: boolean | null): NightBossRow => ({ ...boss(encounterId), guild });
  const nights = [night('guilda', 3, [g(1, true)]), night('misto', 2, [g(1, true), g(2, false)]), night('pug', 1, [g(2, false)]), night('sem-roster', 0, [g(3, null)])];
  const keys = (group: 'guild' | 'pug' | 'all') => filterNights(nights, { encounterId: null, difficultyId: null, group }).map((n) => n.key);
  it('guilda inclui o misto e o que não dá para saber; pug inclui o misto', () => {
    expect(keys('guild')).toEqual(['guilda', 'misto', 'sem-roster']);
    expect(keys('pug')).toEqual(['misto', 'pug']);
    expect(keys('all')).toHaveLength(4);
  });
  it('os bosses do filtro são só os do grupo', () => {
    expect(bossOptions(nights, 'pug').map((b) => [b.encounterId, b.nights])).toEqual([[2, 2]]);
  });
});
