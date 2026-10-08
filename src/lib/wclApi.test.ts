import { describe, expect, it } from 'vitest';
import { groupCasts, matchFight, parseCombatantInfo, parseRankings, pickTops, profileUrls, realmSlug, tableAmounts, wclCompareUrl, wclRangeUrl, wowAnalyzerUrl } from './wclApi';
import { pull } from './test-fixtures';

// formato real de `characterRankings` (gear e talents direto na entrada; números às vezes como texto)
const ranking = (name: string, amount: number, ilvl: number, duration = 600_000) => ({
  name,
  class: 'Hunter',
  spec: 'Marksmanship',
  amount,
  duration,
  report: { code: `code${name}`, fightID: 7, startTime: 0 },
  server: { name: 'Tichondrius', region: 'US' },
  bracketData: ilvl,
  talents: [{ talentID: 117555, points: 1 }],
  gear: [{ id: 271492, slot: 0, itemLevel: '334', permanentEnchant: '8017', gems: [{ id: '240914', itemLevel: '295' }] }],
});

describe('Warcraft Logs', () => {
  it('lê os rankings no formato da API', () => {
    const [r] = parseRankings({ rankings: [ranking('A', 300_000, 331), { name: 'sem report' }] });
    expect(r).toMatchObject({ name: 'A', server: 'Tichondrius', amount: 300_000, code: 'codeA', fightId: 7, itemLevel: 331 });
    const setup = parseCombatantInfo(r.combatantInfo)!;
    expect(setup.talents).toEqual([[0, 117555, 1]]);
    expect(setup.items[0]).toEqual({ slot: 0, itemId: 271492, ilvl: 334, enchant: 8017, gems: [240914] });
  });

  it('status e talentos do playerDetails', () => {
    const s = parseCombatantInfo({ stats: { Crit: { min: 1808, max: 1808 }, Haste: { min: 214, max: 214 } }, talentTree: [{ id: 117562, rank: 1, nodeID: 94965 }], gear: [] })!;
    expect([s.stats.crit, s.stats.haste, s.stats.mastery]).toEqual([1808, 214, 0]);
    expect(s.talents).toEqual([[94965, 117562, 1]]);
  });

  it('escolhe tops com ilvl parecido; com kill, tempo de kill parecido', () => {
    const list = parseRankings({ rankings: [ranking('A', 500, 340), ranking('B', 400, 327), ranking('C', 300, 328), ranking('D', 200, 326, 300_000)] });
    expect(pickTops(list, 327, null).map((t) => t.name)).toEqual(['B', 'C', 'D']);
    // poucos na faixa: alarga até ter 3
    expect(pickTops(list, 338, null).map((t) => t.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(pickTops(list, 327, 290_000)[0].name).toBe('B');
  });

  it('casts em ms desde o início do fight, só os concluídos', () => {
    const ev = [
      { timestamp: 1500, type: 'cast', abilityGameID: 19434 },
      { timestamp: 1400, type: 'begincast', abilityGameID: 19434 },
      { timestamp: 3000, type: 'cast', abilityGameID: 19434 },
    ];
    expect(groupCasts(ev, 1000, new Map([[19434, 'Aimed Shot']]))).toEqual([{ spellId: 19434, name: 'Aimed Shot', times: [500, 2000] }]);
  });

  it('tabela de dano por habilidade', () => {
    const t = { data: { entries: [{ name: 'Steady Shot', guid: 56641, total: 2893081 }, { name: 'x', guid: 1, total: 0 }] } };
    expect(tableAmounts(t)).toEqual([{ spellId: 56641, name: 'Steady Shot', amount: 2893081, pet: false }]);
  });

  it('acha o fight do pull no report: pelo horário, senão pela ordem', () => {
    const p = pull(0, 1_000_000, 100_000, { difficultyId: 16, pullNumberAll: 2 });
    const report = { startTime: 500_000, fights: [{ id: 3, startTime: 0, difficulty: 5 }, { id: 9, startTime: 500_500, difficulty: 5 }, { id: 4, startTime: 0, difficulty: 4 }] };
    expect(matchFight(report, p)).toBe(9);
    expect(matchFight({ ...report, startTime: 10_000_000 }, p)).toBe(9); // pela ordem (2ª tentativa no mítico)
  });

  it('link do WoWAnalyzer', () => {
    expect(wowAnalyzerUrl({ code: 'AbC', fightId: 12, name: 'Fulano' })).toBe('https://wowanalyzer.com/report/AbC/12/Fulano/standard');
  });
});

describe('links do Warcraft Logs', () => {
  const f = { code: 'AbC123', fightId: 7, actorId: 42, fightStart: 1_000_000, name: 'Fulano' };
  it('fight filtrado no player', () => {
    expect(wclRangeUrl(f, 'damage-done')).toBe('https://www.warcraftlogs.com/reports/AbC123?fight=7&type=damage-done&source=42');
  });
  it('trecho: start/end contam do começo do report (início do fight + ms do pull)', () => {
    expect(wclRangeUrl(f, 'healing', 60_000, 75_000)).toBe('https://www.warcraftlogs.com/reports/AbC123?fight=7&type=healing&source=42&start=1060000&end=1075000');
  });
  it('comparação de dois reports, no formato do próprio site', () => {
    const a = { code: 'VnyDcjLCpX8gxNBA', fightId: 6, actorId: 24, fightStart: 0, name: 'A' };
    const b = { code: 'pATgFZ7Ld4fk9cwM', fightId: 8, actorId: 8, fightStart: 0, name: 'B' };
    expect(wclCompareUrl(a, b, 'damage-done')).toBe('https://www.warcraftlogs.com/reports/compare/VnyDcjLCpX8gxNBA/pATgFZ7Ld4fk9cwM?fight=6%2C8&type=damage-done&source=24%2C8');
    // o mesmo trecho (42,5s) nos dois, cada um contado do começo do próprio report
    const at = (f: typeof a, start: number) => ({ ...f, fightStart: start });
    expect(wclCompareUrl(at(a, 3_191_252 - 60_000), at(b, 2_336_635 - 60_000), 'damage-done', 60_000, 102_513)).toBe(
      'https://www.warcraftlogs.com/reports/compare/VnyDcjLCpX8gxNBA/pATgFZ7Ld4fk9cwM?fight=6%2C8&type=damage-done&source=24%2C8&start=3191252%2C2336635&end=3233765%2C2379148',
    );
  });
});

describe('perfil da referência', () => {
  it('reino na URL', () => {
    expect(realmSlug('Moon Guard')).toBe('moon-guard');
    expect(realmSlug("Mal'Ganis")).toBe('malganis');
  });
  it('Raider.IO e Warcraft Logs (sem rede social: nenhuma fonte confiável)', () => {
    expect(profileUrls({ name: 'Yonderwayz', server: 'Moon Guard', region: 'US' })).toEqual([
      { site: 'raiderio', url: 'https://raider.io/characters/us/moon-guard/Yonderwayz' },
      { site: 'wcl', url: 'https://www.warcraftlogs.com/character/us/moon-guard/Yonderwayz' },
    ]);
  });
  it('China: sem perfil (Raider.IO e o perfil do WCL não cobrem)', () => {
    expect(profileUrls({ name: '奥丶小丁', server: '凤凰之神', region: 'CN' })).toEqual([]);
  });
});
