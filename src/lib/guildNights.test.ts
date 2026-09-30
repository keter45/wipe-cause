import { describe, expect, it } from 'vitest';
import { groupNights, uniquePulls, type GuildReport } from './guildNights';

const H = 3_600_000;
const fight = (id: number, encounterID: number, start: number, kill = false) => ({ id, encounterID, name: `Boss ${encounterID}`, difficulty: 5, kill, startTime: start, endTime: start + 120_000 });

describe('noites da guilda', () => {
  // dois reports da mesma noite (relógios 1.8s diferentes) e um de outra noite
  const a: GuildReport = { code: 'AAAAAAAA', title: '', startTime: 100 * H, endTime: 103 * H, owner: 'Fulano', zone: 'VA', fights: [fight(1, 3470, 0), fight(2, 3470, 10 * 60_000, true)] };
  const b: GuildReport = {
    code: 'BBBBBBBB',
    title: '',
    startTime: 100 * H + 1_800,
    endTime: 104 * H,
    owner: 'Ciclano',
    zone: 'VA',
    fights: [fight(1, 3470, 0), fight(2, 3470, 10 * 60_000, true), fight(5, 3445, 2 * H)],
  };
  const other: GuildReport = { code: 'CCCCCCCC', title: '', startTime: 124 * H, endTime: 126 * H, owner: 'Fulano', zone: 'VA', fights: [fight(1, 3455, 0)] };

  it('junta reports da mesma noite, o mais completo primeiro, sem pull repetido', () => {
    const nights = groupNights([a, other, b], 200 * H);
    expect(nights).toHaveLength(2);
    expect(nights[0].path).toBe('wcl:CCCCCCCC');
    const n = nights[1];
    expect(n.path).toBe('wcl:BBBBBBBB,AAAAAAAA');
    expect(n.bosses).toEqual([
      { encounterId: 3470, name: 'Boss 3470', difficulty: 5, pulls: 2, kills: 1 },
      { encounterId: 3445, name: 'Boss 3445', difficulty: 5, pulls: 1, kills: 0 },
    ]);
    expect(n.live).toBe(false);
  });

  it('marca a noite ao vivo e ignora reports sem boss', () => {
    const empty: GuildReport = { ...other, code: 'DDDDDDDD', fights: [] };
    const nights = groupNights([other, empty], 126 * H + 60_000);
    expect(nights).toHaveLength(1);
    expect(nights[0].live).toBe(true);
  });

  it('pulls únicos em ordem de horário', () => {
    expect(uniquePulls([b, a]).map((p) => p.encounterId)).toEqual([3470, 3470, 3445]);
  });
});
