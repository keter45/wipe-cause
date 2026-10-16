import { describe, expect, it } from 'vitest';
import { death, player, pull } from './test-fixtures';
import { unifyPlayerGuids } from './guids';

describe('GUIDs do WCL e do log', () => {
  // 14/10: 11 pulls do log e 8 do WCL; a Kuraa era Player-3209-0A6FE13C num e Player-0-0A6FE13C no outro
  it('o GUID sintético do WCL vira o real do mesmo player em tudo do pull', () => {
    const real = 'Player-3209-0A6FE13C';
    const fake = 'Player-0-0A6FE13C';
    const local = pull(0, 0, 60_000, { players: [{ ...player('x'), guid: real, name: 'Kuraa-Azralon-US' }] });
    const wcl = pull(1, 100_000, 60_000, {
      players: [{ ...player('x'), guid: fake, name: 'Kuraa-Azralon-US' }, { ...player('y'), guid: 'Player-0-0000BEEF', name: 'Outro-Azralon-US' }],
      deaths: [death(fake, 10_000)],
    });
    unifyPlayerGuids([local, wcl]);
    expect(wcl.players.map((p) => p.guid)).toEqual([real, 'Player-0-0000BEEF']);
    expect(wcl.deaths[0].guid).toBe(real);
  });

  it('mesmo final de GUID com outro nome não é a mesma pessoa', () => {
    const local = pull(0, 0, 60_000, { players: [{ ...player('x'), guid: 'Player-3209-0A6FE13C', name: 'Kuraa-Azralon-US' }] });
    const wcl = pull(1, 100_000, 60_000, { players: [{ ...player('x'), guid: 'Player-0-0A6FE13C', name: 'Outra-Stormrage-US' }] });
    unifyPlayerGuids([local, wcl]);
    expect(wcl.players[0].guid).toBe('Player-0-0A6FE13C');
  });
});
