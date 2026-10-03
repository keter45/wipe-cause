import { describe, expect, it } from 'vitest';
import type { MechanicResult, RotationFinding, RotationResult } from '../types';
import { advantageWindows, castDiff, losses, soloEvolution, soloNight, takenMoreThan } from './solo';
import { meIn } from './mode';
import { graphTimeline } from './wclApi';
import { death, player, pull } from './test-fixtures';

const finding = (over: Partial<RotationFinding>): RotationFinding => ({
  id: 'x', kind: 'proc', title: 'X perdido', tip: '', importance: 'medium', count: 0, rate: 1, times: [], detail: '', spellId: null, ...over,
});
const rotation = (findings: RotationFinding[], over: Partial<RotationResult> = {}): RotationResult => ({
  specName: 'Fire Mage', patch: '12.1', tree: null, score: 80, findings, opener: null, downtimeMs: 0, activeMs: 120_000, cooldowns: [],
  keyPoints: [], prioritySt: [], priorityAoe: [], sources: [], ...over,
});
const mechanic = (over: Partial<MechanicResult>): MechanicResult => ({
  key: 'm', name: 'Onda', spellId: 5, kind: 'avoidable_damage', severity: 'major', tip: 'Saia da onda.', evaluated: true, failures: 1, summary: '',
  players: [], events: [], ...over,
});

describe('modo solo', () => {
  it('você: o personagem escolhido se estiver no pull, senão quem gravou o log', () => {
    const p = pull(0, 0, 60_000, { ownerGuid: 'B' });
    expect(meIn(p, null)?.guid).toBe('B');
    expect(meIn(p, 'C-Realm')?.guid).toBe('C');
    expect(meIn(p, 'Outro-Realm')?.guid).toBe('B');
    expect(meIn(pull(1, 0, 60_000), null)).toBeNull();
  });

  it('dano perdido: morte cedo, tempo parado, proc e DoT viram dano; mecânica pesa pela severidade', () => {
    const me = player('A', {
      damageDone: 12_000_000, // 100k por segundo vivo
      aliveMs: 120_000,
      casts: [{ spellId: 10, name: 'Fireball', times: Array.from({ length: 60 }, (_, i) => i * 2000) }],
      damageBySpell: [{ spellId: 20, name: 'Ignite', amount: 1_800_000, pet: false }],
      rotation: rotation(
        [
          finding({ id: 'always_be_casting', kind: 'downtime', title: 'Tempo sem castar' }),
          finding({ id: 'hot_streak', kind: 'proc', title: 'Hot Streak perdido', count: 3, rate: 0.8 }),
          finding({ id: 'ignite', kind: 'dot_uptime', title: 'Ignite fora do alvo', count: 2, rate: 0.6, spellId: 20 }),
        ],
        { downtimeMs: 15_000 },
      ),
    });
    const p = pull(0, 0, 180_000, {
      analyzedMs: 180_000,
      players: [me],
      deaths: [death('A', 120_000, { defensivesAvailable: [{ spellId: 45438, name: 'Ice Block', kind: 'personal' }] })],
      mechanics: [mechanic({ players: [{ guid: 'A', name: 'A-Realm', count: 2, amount: 0, firstT: 30_000, credit: false, message: '2 ondas' }] })],
    });
    const ls = losses({ pull: p, player: me });
    const by = Object.fromEntries(ls.map((l) => [l.kind, l]));
    expect(by.death.lost).toBe(6_000_000); // 60s restantes × 100k
    expect(by.death.tip).toContain('Ice Block');
    expect(by.downtime.lost).toBe(1_500_000);
    expect(by.proc.lost).toBe(600_000); // 3 × 200k por cast
    expect(by.dot.lost).toBeCloseTo(1_200_000); // 1,8M em 60% do tempo -> faltaram 40%
    expect(by.avoidable.weightSec).toBe(60); // grave × 2 erros
    expect(ls[0].kind).toBe('death');
  });

  it('onde a referência abriu vantagem: trechos sem sobrepor, maiores primeiro, com os casts', () => {
    const mine = [100, 100, 100, 100, 100, 100, 100, 100, 100];
    const ref = [100, 100, 900, 900, 900, 100, 100, 400, 100];
    const me = player('A', { damageTimeline: mine, casts: [{ spellId: 10, name: 'Fireball', times: [11_000] }] });
    const top = player('B', { damageTimeline: ref, casts: [{ spellId: 30, name: 'Combustion', times: [10_500] }, { spellId: 10, name: 'Fireball', times: [12_000] }] });
    const p = pull(0, 0, 45_000, { players: [me, top] });
    const ws = advantageWindows({ pull: p, player: me }, { pull: p, player: top });
    expect(ws.map((w) => w.startMs)).toEqual([10_000, 25_000]);
    expect(ws[0].ref - ws[0].mine).toBe(2400);
    expect(castDiff(ws[0]).map((c) => c.name)).toEqual(['Combustion']);
  });

  it('dano tomado bem acima da referência, por minuto vivo', () => {
    const me = player('A', { aliveMs: 60_000, takenByAbility: [{ spellId: 5, name: 'Onda', source: 'Boss', amount: 900, hits: 3 }, { spellId: 6, name: 'Aura', source: 'Boss', amount: 100, hits: 9 }] });
    const top = player('B', { aliveMs: 120_000, takenByAbility: [{ spellId: 5, name: 'Onda', source: '', amount: 200, hits: 1 }, { spellId: 6, name: 'Aura', source: '', amount: 200, hits: 9 }] });
    const p = pull(0, 0, 120_000, { players: [me, top] });
    expect(takenMoreThan({ pull: p, player: me }, { pull: p, player: top }).map((r) => r.name)).toEqual(['Onda']);
  });

  it('noite e evolução: erros que se repetem por boss e o melhor de cada noite', () => {
    const me = (dmg: number, t: number | null) =>
      pull(0, 0, 120_000, {
        ownerGuid: 'A',
        players: [player('A', { damageDone: dmg, aliveMs: 120_000, rotation: rotation([finding({ id: 'always_be_casting', kind: 'downtime', title: 'Tempo sem castar' })], { downtimeMs: 10_000 }) })],
        deaths: t != null ? [death('A', t)] : [],
      });
    const night = soloNight([me(12e6, 30_000), me(24e6, null), { ...me(1, null), dungeon: true }], null);
    expect(night).toHaveLength(1);
    expect(night[0].pulls).toHaveLength(2);
    expect(Math.round(night[0].best!.output)).toBe(200_000);
    expect(night[0].recurring.map((r) => r.title)).toEqual(['Tempo sem castar']);
    const evo = soloEvolution(
      [
        { id: '2', title: 'n2', raidStartMs: 2, pulls: [me(24e6, null)] },
        { id: '1', title: 'n1', raidStartMs: 1, pulls: [me(12e6, 30_000)] },
      ],
      'Boss · Mythic',
      null,
    );
    expect(evo.map((e) => [e.id, Math.round(e.bestOutput), e.deathsPerPull])).toEqual([
      ['1', 100_000, 1],
      ['2', 200_000, 0],
    ]);
  });

  it('gráfico do Warcraft Logs vira dano por janela de 5s (série Total, por segundo)', () => {
    const json = { data: { series: [{ name: 'Player', data: [9, 9] }, { name: 'Total', pointStart: 1000, pointInterval: 2500, data: [100, 100, 200, 400] }] } };
    expect(graphTimeline(json, 1000, 10_000)).toEqual([500, 1500]);
  });
});
