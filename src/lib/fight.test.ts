import { describe, expect, it } from 'vitest';
import type { Pull } from '../types';
import { aurasAt, bossHpAt, crucialAt, deadAt, eventsBetween, EV, fightMarkers, fightView, hpAt, idleAxegrinders, mechanicLanes, meterAt, seriesAt, vacatedAreas, vacatedSince, vanishedAreas } from './fight';
import type { ReplayData, ReplayUnit } from './replay';

const pull = {
  players: [
    { guid: 'P1', name: 'Alice-R' },
    { guid: 'P2', name: 'Bob-R' },
  ],
  deaths: [{ guid: 'P1', t: 5000, killingBlowMechanic: 'Bite', killingBlow: { spellId: 9, spellName: 'Bite' } }],
  mechanics: [
    { key: 'bite', name: 'Bite', spellId: 9, kind: 'avoidable_damage', severity: 'major', failures: 1, events: [{ t: 4000, player: 'Alice-R', detail: { pt: '', en: '' } }] },
    { key: 'pool', name: 'Pool', spellId: 7, kind: 'avoidable_damage', severity: 'minor', failures: 0, events: [] },
  ],
  casts: [{ t: 3000, end: 3500, guid: 'B', spellId: 11, name: 'Sever', cone: { halfAngle: 40, range: 40 } }],
  fight: {
    players: ['P1', 'P2'],
    sources: ['Boss', 'Bob-R'],
    spells: { 9: 'Bite', 7: 'Venom', 8: 'Heal', 12: 'Kick', 13: 'Fireball' },
    ruleSpells: { 9: 'bite', 7: 'pool' },
    hp: [
      [
        [0, 100],
        [4000, 40],
        [5000, 0],
        [8000, 30],
      ],
      [[0, 100]],
    ],
    auras: [
      [0, 7, 1000, 6000, 3, 1],
      [0, 50, 2000, 2500, 1, 0],
    ],
    events: [
      [4000, EV.damage, 0, 9, 60000, 0],
      [4500, EV.heal, 0, 8, 10000, 1],
      [4600, EV.interrupt, 1, 12, 13, 0],
      [7000, EV.resurrect, 0, 20484, 0, 1],
    ],
    bosses: [{ guid: 'B', name: 'Boss', maxHp: 1000, hp: [[0, 1000], [3000, 436]] }],
    done: [
      [1, 0, 0, 500],
      [2, 1, 0, 300],
      [2, 1, 2, 999],
      [5, 0, 0, 100],
    ],
    healed: [[3, 1, 40]],
    healIn: [[3, 0, 40]],
  },
} as unknown as Pull;

describe('replay completo', () => {
  const v = fightView(pull)!;

  it('vida num instante e quem está morto (com ressurreição)', () => {
    expect(seriesAt([[0, 1], [10, 2]], 5)).toBe(1);
    expect(hpAt(v, 'P1', 4500)).toBe(40);
    expect(hpAt(v, 'P1', -1)).toBeNull();
    expect(deadAt(v, 'P1', 4999)).toBe(false);
    expect(deadAt(v, 'P1', 6000)).toBe(true);
    expect(deadAt(v, 'P1', 7500)).toBe(false);
  });

  it('volta à vida no battle rez e fica morto novamente na próxima morte', () => {
    const view = fightView({ ...pull, deaths: [...pull.deaths, { ...pull.deaths[0], t: 9000 }] })!;
    expect(deadAt(view, 'P1', 5000)).toBe(true);
    expect(deadAt(view, 'P1', 6999)).toBe(true);
    expect(deadAt(view, 'P1', 7000)).toBe(false);
    expect(deadAt(view, 'P1', 8999)).toBe(false);
    expect(deadAt(view, 'P1', 9000)).toBe(true);
    expect(deadAt(view, 'P1', 10000)).toBe(true);
    expect(deadAt(view, 'P1', 4000)).toBe(false);
  });

  it('debuffs ativos com a mecânica da regra primeiro', () => {
    const a = aurasAt(v, 'P1', 2200);
    expect(a.map((x) => x.spellId)).toEqual([7, 50]);
    expect(a[0].mechanic?.key).toBe('pool');
    expect(a[0].stacks).toBe(3);
    expect(aurasAt(v, 'P1', 6000)).toEqual([]);
    expect(crucialAt(v, 'P1', 2200)?.spellId).toBe(7);
    expect(crucialAt(v, 'P2', 2200)).toBeNull();
  });

  it('eventos do player, do mais recente, com a mecânica e o spell cortado', () => {
    const e = eventsBetween(v, 'P1', 0, 8000);
    expect(e.map((x) => x.kind)).toEqual([EV.resurrect, EV.heal, EV.damage]);
    expect(e[2].mechanic?.key).toBe('bite');
    expect(e[1].other).toBe('Bob-R');
    const kick = eventsBetween(v, 'P2', 0, 8000)[0];
    expect(kick.extra).toEqual({ spellId: 13, name: 'Fireball' });
    expect(kick.amount).toBe(0);
  });

  it('medidores acumulados até o instante e vida do boss', () => {
    expect(meterAt(v, 'done', 2500).map((r) => [r.key, r.amount])).toEqual([['P1', 500], ['P2', 1299]].sort((a, b) => (b[1] as number) - (a[1] as number)));
    expect(meterAt(v, 'done', 2500, 'Boss').map((r) => [r.key, r.amount])).toEqual([['P1', 500], ['P2', 300]]);
    expect(meterAt(v, 'done', 9000, 'Ninguém')).toEqual([]);
    expect(meterAt(v, 'taken', 4000)).toEqual([{ key: 'P1', name: 'P1', amount: 60000 }]);
    expect(meterAt(v, 'takenBy', 4000)[0]).toMatchObject({ name: 'Bite', spellId: 9, amount: 60000 });
    expect(meterAt(v, 'healed', 3000)[0]).toMatchObject({ key: 'P2', amount: 40 });
    expect(meterAt(v, 'healIn', 2000)).toEqual([]);
    expect(bossHpAt(pull.fight!.bosses[0], 3500)).toBeCloseTo(43.6);
  });

  it('marcadores: morte, falha com culpado e frontal', () => {
    const m = fightMarkers(pull);
    expect(m.map((x) => [x.kind, x.t, x.guid])).toEqual([
      ['cast', 3500, undefined],
      ['failure', 4000, 'P1'],
      ['death', 5000, 'P1'],
    ]);
  });
});

describe('stacks e áreas desmentidas', () => {
  const base = {
    players: ['P1', 'P2'],
    sources: ['Axe'],
    spells: { 7: 'Venom', 99: 'Axegrinder' },
    ruleSpells: { 7: 'venom', 99: 'axe' },
    hp: [[], []],
    auras: [[0, 7, 1000, 9000, 4, 1]],
    stacks: [[0, 7, 2000, 2], [0, 7, 5000, 4]],
    // P2 levou o golpe do machado aos 3 s
    events: [[3000, 0, 1, 99, 500, 0]],
    bosses: [],
    done: [],
    healed: [],
    healIn: [],
  } as unknown as NonNullable<Pull['fight']>;
  const p = { players: [], deaths: [], mechanics: [], casts: [], fight: base } as unknown as Pull;
  const v = fightView(p)!;

  it('o número de stacks em cada momento', () => {
    expect(crucialAt(v, 'P1', 1500)?.stacks).toBe(1);
    expect(crucialAt(v, 'P1', 3000)?.stacks).toBe(2);
    expect(aurasAt(v, 'P1', 6000)[0].stacks).toBe(4);
  });

  it('machado apagado quando alguém passa por dentro sem levar dano, até o log mostrá-lo de novo', () => {
    const unit = (guid: string, kind: ReplayUnit['kind'], pts: [number, number, number][], seen?: number[]): ReplayUnit => ({ guid, name: guid, kind, pts, seen });
    const axe = unit('Creature-0-0-0-0-260474-01', 'enemy', [[0, 0, 0], [10000, 0, 0]], [0, 8000]);
    // P1 passa pelo machado aos 2 s sem levar dano; P2 está nele aos 3 s e leva
    const p1 = unit('P1', 'player', [[0, 20, 0], [2000, 0, 0], [2500, 20, 0], [10000, 20, 0]]);
    const p2 = unit('P2', 'player', [[0, 20, 20], [3000, 0, 0], [3500, 20, 20], [10000, 20, 20]]);
    const data = { units: new Map([axe, p1, p2].map((u) => [u.guid, u])), areas: [{ key: 'axe', name: 'Axegrinder', spellId: 99, npc: 260474, radius: 4 }], ground: [], groundKinds: [], casts: [], soaks: [], markers: [] } as ReplayData;
    const spans = vacatedAreas(v, data).get(axe.guid);
    expect(spans?.[0][1]).toBe(8000);
    expect(spans![0][0]).toBeGreaterThan(1000);
    expect(spans![0][0]).toBeLessThanOrEqual(2000);
    expect(vacatedSince(spans, 5000)).toBe(spans![0][0]);
    expect(vacatedSince(spans, 9000)).toBeNull();
  });

  it('machado some depois de 10 s sem acertar ninguém perto, a partir da fase', () => {
    const unit = (guid: string, kind: ReplayUnit['kind'], pts: [number, number, number][], seen?: number[]): ReplayUnit => ({ guid, name: guid, kind, pts, seen });
    const axe = unit('Creature-0-0-0-0-260474-03', 'enemy', [[0, 0, 0], [30000, 0, 0]], [0]);
    // P2 levou o golpe aos 3 s, em cima do machado
    const p2 = unit('P2', 'player', [[0, 0, 0], [30000, 0, 0]]);
    const area = { key: 'axe', name: 'Axegrinder', spellId: 99, npc: 260474, radius: 4, vanishIdleMs: 10000, vanishFrom: 5000 };
    const data = { units: new Map([axe, p2].map((u) => [u.guid, u])), areas: [area], ground: [], groundKinds: [], casts: [], soaks: [], markers: [] } as ReplayData;
    expect(vanishedAreas(v, data).get(axe.guid)).toEqual([[13000, 30250]]);
    // longe do machado o golpe (DoT) não segura: some no começo da fase... depois dos 10 s do começo
    const far = unit('P2', 'player', [[0, 50, 50], [30000, 50, 50]]);
    const data2 = { ...data, units: new Map([axe, far].map((u) => [u.guid, u])) } as ReplayData;
    expect(vanishedAreas(v, data2).get(axe.guid)).toEqual([[10000, 30250]]);
  });

  it('quem leva o dano ali confirma o machado', () => {
    const unit = (guid: string, kind: ReplayUnit['kind'], pts: [number, number, number][], seen?: number[]): ReplayUnit => ({ guid, name: guid, kind, pts, seen });
    const axe = unit('Creature-0-0-0-0-260474-02', 'enemy', [[0, 0, 0], [6000, 0, 0]], [0]);
    const p2 = unit('P2', 'player', [[0, 20, 20], [3000, 0, 0], [3500, 20, 20], [6000, 20, 20]]);
    const data = { units: new Map([axe, p2].map((u) => [u.guid, u])), areas: [{ key: 'axe', name: 'Axegrinder', spellId: 99, npc: 260474, radius: 4 }], ground: [], groundKinds: [], casts: [], soaks: [], markers: [] } as ReplayData;
    expect(vacatedAreas(v, data).size).toBe(0);
  });

  it('apaga cada Axegrinder após 5s sem contato próximo e restaura no próximo hit', () => {
    const axe: ReplayUnit = { guid: 'Creature-0-0-0-0-260474-01', name: 'Axe', kind: 'enemy', pts: [[0, 0, 0], [20000, 0, 0]], seen: [0, 9000] };
    const player: ReplayUnit = { guid: 'P2', name: 'Player', kind: 'player', pts: [[0, 0, 0], [20000, 0, 0]] };
    const events = [...base.events, [10000, EV.damage, 1, 99, 500, 0]];
    const view = fightView({ ...pull, fight: { ...base, events } } as unknown as Pull)!;
    const data = { units: new Map([axe, player].map((unit) => [unit.guid, unit])), areas: [{ key: 'axe', name: 'Axegrinder', spellId: 99, npc: 260474, radius: 4, vanishFrom: 18000 }], ground: [], groundKinds: [], casts: [], soaks: [], markers: [] } as ReplayData;
    const distant: ReplayUnit = { ...axe, guid: 'Creature-0-0-0-0-260474-02', pts: [[0, 50, 50], [20000, 50, 50]] };
    data.units.set(distant.guid, distant);
    const idle = idleAxegrinders(view, data);
    const spans = idle.get(axe.guid);
    expect(idle.get(distant.guid)).toEqual([[5000, 18000]]);
    expect(spans).toEqual([[8000, 10000], [15000, 18000]]);
    expect(vacatedSince(spans, 7999)).toBeNull();
    expect(vacatedSince(spans, 9500)).toBe(8000);
    expect(vacatedSince(spans, 10000)).toBeNull();
    expect(vacatedSince(spans, 18000)).toBeNull();
  });

  it('sem hit, conta do nascimento; DoT distante não confirma o machado nem outra unidade', () => {
    const axe: ReplayUnit = { guid: 'Creature-0-0-0-0-260474-01', name: 'Axe', kind: 'enemy', pts: [[0, 0, 0], [10000, 0, 0]], seen: [0] };
    const far: ReplayUnit = { guid: 'P2', name: 'Player', kind: 'player', pts: [[0, 50, 50], [10000, 50, 50]] };
    const other: ReplayUnit = { ...axe, guid: 'Creature-0-0-0-0-12345-01' };
    const data = { units: new Map([axe, far, other].map((unit) => [unit.guid, unit])), areas: [{ key: 'axe', name: 'Axegrinder', spellId: 99, npc: 260474, radius: 4 }], ground: [], groundKinds: [], casts: [], soaks: [], markers: [] } as ReplayData;
    expect([...idleAxegrinders(v, data)]).toEqual([[axe.guid, [[5000, 10250]]]]);
  });
});

describe('faixas por mecânica', () => {
  const lanesPull = {
    players: [{ guid: 'P1', name: 'Alice-R' }],
    deaths: [],
    mechanics: [
      { key: 'guillotine', name: 'Guillotine', spellId: 5, kind: 'soak', severity: 'wipe', failures: 1, events: [{ t: 21_000, player: null, detail: { pt: '', en: '' } }] },
      { key: 'wail', name: 'Wail', spellId: 6, kind: 'interrupt', severity: 'major', failures: 1, events: [], casts: [{ t: 3000, sourceGuid: 'A', source: 'Add', interruptedBy: 'Alice-R', interruptedByGuid: 'P1' }, { t: 9000, sourceGuid: 'A', source: 'Add', interruptedBy: null, interruptedByGuid: null }] },
      { key: 'sever', name: 'Sever', spellId: 11, kind: 'avoidable_damage', severity: 'major', failures: 0, events: [{ t: 3500, player: 'Alice-R', detail: { pt: '', en: '' } }] },
      { key: 'bite', name: 'Bite', spellId: 9, kind: 'avoidable_damage', severity: 'minor', failures: 1, events: [{ t: 4000, player: 'Alice-R', detail: { pt: '', en: '' } }] },
      { key: 'quiet', name: 'Quiet', spellId: 7, kind: 'info', severity: 'none', failures: 0, events: [] },
    ],
    soaks: [
      { key: 'guillotine', name: 'Guillotine', spellId: 5, from: 1000, at: 5000, x: 0, y: 0, radius: 9, needs: 5, hit: 4 },
      { key: 'guillotine', name: 'Guillotine', spellId: 5, from: 16_000, at: 20_000, x: 0, y: 0, radius: 9, needs: 5, hit: 5 },
    ],
    casts: [{ t: 3000, end: 3500, guid: 'B', spellId: 11, name: 'Sever', cone: { halfAngle: 40, range: 40 } }],
    orbs: { kinds: [], contactYd: 7, ground: [[1000, 4000, 0, 0, 0], [2000, 6000, 0, 0, 1]], carries: [] },
  } as unknown as Pull;

  it('cada vez que a mecânica aconteceu: vazada se deu certo, cheia se deu errado', () => {
    const lanes = mechanicLanes(lanesPull);
    const by = new Map(lanes.map((l) => [l.key, l] as const));
    // soak: errado só onde a regra deu falha (o número de atingidos não basta: imune não conta)
    expect(by.get('guillotine')!.marks.map((m) => [m.t, m.ok, m.label])).toEqual([[5000, true, '4/5'], [20_000, false, '5/5']]);
    expect(by.get('wail')!.marks.map((m) => [m.t, m.ok, m.guid])).toEqual([[3000, true, 'P1'], [9000, false, undefined]]);
    // frontal sem falha (dentro da tolerância): só a marca vazada do cast
    expect(by.get('sever')!.marks.map((m) => [m.t, m.ok])).toEqual([[3500, true]]);
    expect(by.get('bite')!.marks.map((m) => [m.t, m.ok, m.guid])).toEqual([[4000, false, 'P1']]);
    expect(by.has('quiet')).toBe(false);
    // as que mais pesam em cima, depois dos orbs
    expect(lanes.map((l) => l.key)).toEqual(['orbs', 'guillotine', 'wail', 'sever', 'bite']);
  });

  it('orbs no chão ao longo do pull', () => {
    expect(mechanicLanes(lanesPull)[0].series).toEqual([[1000, 1], [2000, 2], [4000, 1], [6000, 0]]);
  });
});
