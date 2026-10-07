import { describe, expect, it } from 'vitest';
import type { Night, NightBossRow } from './nights';
import { bossOptions, filterNights, matchesBoss } from './logFilter';

const boss = (encounterId: number, difficultyId = 16): NightBossRow => ({
  encounterId, name: `Boss ${encounterId}`, difficultyId, local: 5, localKills: 0, missing: 0, missingKills: 0,
});
const night = (key: string, startMs: number, bosses: NightBossRow[]): Night => ({
  key, startMs, endMs: startMs + 1, files: [], wcl: null, bosses, dungeonBosses: 0, missingPulls: 0, missingMs: 0, live: false,
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
    expect(filterNights(nights, { encounterId: null, difficultyId: null })).toHaveLength(3);
    expect(filterNights(nights, { encounterId: 1, difficultyId: null }).map((n) => n.key)).toEqual(['seg', 'dom']);
    expect(filterNights(nights, { encounterId: 2, difficultyId: 16 }).map((n) => n.key)).toEqual(['qua']);
    expect(matchesBoss(boss(2, 15), { encounterId: 2, difficultyId: 16 })).toBe(false);
  });
});
