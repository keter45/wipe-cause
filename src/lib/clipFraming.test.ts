import { describe, expect, it } from 'vitest';
import { clipBounds } from './clipFraming';
import { decodeReplay, type ReplayData, type ReplayUnit } from './replay';
import type { ClipMoment } from './replayClip';
import type { FightData } from '../types';

const unit = (guid: string, kind: ReplayUnit['kind'], pts: ReplayUnit['pts'], owner?: string): ReplayUnit => ({ guid, name: guid, kind, pts, owner });
const data = (units: ReplayUnit[]): ReplayData => ({ units: new Map(units.map(u => [u.guid, u])), groundKinds: [], ground: [], casts: [], areas: [], soaks: [], markers: [] });
const moment = (focus: string[] = []): ClipMoment => ({ t: 10_000, replay: { t: 10_000, from: 0, to: 12_000, focus }, label: 'Failure', mechanicKey: 'failure', kind: 'trigger' });

describe('clipBounds: câmera no erro', () => {
  it('acompanha o trajeto dos envolvidos sem abrir para o boss e os players distantes', () => {
    const d = data([
      unit('A', 'player', [[0, 200, 0], [3_000, 0, 0], [10_000, 10, 5], [12_000, 12, 5]]),
      unit('B', 'player', [[0, 300, 300], [12_000, 300, 300]]),
      unit('Boss', 'enemy', [[0, 40, 40], [12_000, 40, 40]]),
    ]);
    expect(clipBounds(d, moment(['A']), [3_000, 12_000])).toEqual([-8, 20, -11.5, 16.5]);
  });

  it('enquadra os fantasmas que colidiram, mesmo com os donos longe', () => {
    const d = data([
      unit('A', 'player', [[0, 100, 100], [12_000, 100, 100]]),
      unit('G1', 'ghost', [[0, -80, 0], [7_000, 0, 0], [10_000, 10, 0]], 'A'),
      unit('G2', 'ghost', [[0, 100, 0], [7_000, 20, 0], [10_000, 11, 0]], 'B'),
    ]);
    expect(clipBounds(d, moment(['A']), [3_000, 12_000])).toEqual([-6, 26, -14, 14]);
  });

  it('aproxima dos orbs que detonaram e ignora os outros orbs e as vítimas espalhadas', () => {
    const d = decodeReplay({ orbs: {
      kinds: [{ name: 'Purple', volatile: true }, { name: 'Green', volatile: false }],
      ground: [[0, 10_000, 1000, 200, 0], [0, 10_000, 1040, 220, 0], [0, 11_000, 4000, 4000, 1], [0, 20_000, 5000, 5000, 0]],
      carries: [], contactYd: 8,
    } });
    expect(clipBounds(d, moment(), [3_000, 12_000])).toEqual([-35, -7, 88, 116]);
  });

  it('usa os alvos registrados da colisão quando os fantasmas continuam vivos depois dela', () => {
    const d = data([
      unit('G1', 'ghost', [[7_000, 0, 0], [10_000, 10, 0], [20_000, 10, 0]], 'A'),
      unit('G2', 'ghost', [[7_000, 20, 0], [10_000, 11, 0], [20_000, 11, 0]], 'B'),
      unit('G3', 'ghost', [[7_000, 300, 300], [20_000, 300, 300]], 'C'),
      unit('G4', 'ghost', [[7_000, 300, 300], [20_000, 300, 300]], 'D'),
    ]);
    const fight: FightData = { players: ['A', 'B'], sources: [], spells: {}, ruleSpells: { '42': 'failure' }, hp: [], auras: [], bosses: [], done: [], healed: [], healIn: [],
      events: [[10_000, 0, 0, 42, 1, 0], [10_038, 0, 1, 42, 1, 0]],
    };
    expect(clipBounds(d, moment(), [3_000, 12_000], fight)).toEqual([-6, 26, -14, 14]);
  });

  it('usa a origem da falha certa, sem incluir explosões de outras mecânicas', () => {
    const d = data([]);
    d.blasts = [
      { key: 'failure', name: 'Blast', spellId: 1, from: 5000, at: 10_000, x: 30, y: 40, radius: 40, timingEstimated: false },
      { key: 'other', name: 'Other', spellId: 2, from: 5000, at: 10_000, x: 300, y: 400, radius: 40, timingEstimated: false },
    ];
    expect(clipBounds(d, moment(), [3_000, 12_000])).toEqual([12, 48, 22, 58]);
  });

  it('sem origem conhecida, considera a raid no instante do erro e não o caminho inteiro', () => {
    const d = data([unit('A', 'player', [[0, 500, 500], [10_000, 0, 0]]), unit('B', 'player', [[0, -500, -500], [10_000, 10, 10]])]);
    expect(clipBounds(d, moment(), [0, 12_000])).toEqual([-9, 19, -9, 19]);
  });

  it('sem posições, deixa o replay usar o enquadramento padrão', () => {
    expect(clipBounds(data([]), moment(), [0, 12_000])).toBeUndefined();
  });
});
