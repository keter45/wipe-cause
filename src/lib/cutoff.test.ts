import { describe, expect, it } from 'vitest';
import type { Death, MechanicResult, Pull } from '../types';
import { applyCutoff, cutoffTime } from './cutoff';
import { analyzePull } from './verdict';
import { summarizeNight } from './night';

const death = (guid: string, t: number, over: Partial<Death> = {}) =>
  ({ guid, name: `${guid}-R`, t, causedBy: null, defensivesRecent: [], defensivesAvailable: [], usedHealthPotion: true, usedHealthstone: true, healthstoneKnown: false, deathKind: 'spike', stats: {}, role: 'dps', killingBlow: null, killingBlowMechanic: null, ...over }) as unknown as Death;

const cause = (key: string, failT: number) => ({ key, name: key, amount: 1, pct: 90, failT });

const puddle: MechanicResult = {
  key: 'puddle', name: 'Poça', kind: 'avoidable_damage', severity: 'minor', tip: '', evaluated: true, failures: 4, summary: '',
  tolerance: 0, warnStacks: null, lethalStacks: null, messageTemplate: '{player} pisou {count}x', failTimes: [],
  events: [{ t: 10_000, player: 'A-R', detail: 'Poça' }, { t: 90_000, player: 'A-R', detail: 'Poça' }],
  players: [
    { guid: 'A', name: 'A-R', count: 3, amount: 30, firstT: 10_000, credit: false, message: 'A pisou 3x', timeline: [[10_000, 1, 10], [20_000, 1, 10], [90_000, 1, 10]] },
    { guid: 'B', name: 'B-R', count: 1, amount: 10, firstT: 95_000, credit: false, message: 'B pisou 1x', timeline: [[95_000, 1, 10]] },
  ],
};
const venom: MechanicResult = {
  ...puddle, key: 'venom', name: 'Venom', kind: 'stack_limit', severity: 'wipe', warnStacks: 8, lethalStacks: 10,
  messageTemplate: '{player} chegou a {stacks}', failures: 1, events: [],
  players: [{ guid: 'A', name: 'A-R', count: 9, amount: 0, firstT: 50_000, credit: false, message: '', timeline: [[40_000, 7, 0], [80_000, 9, 0]] }],
};
const burst: MechanicResult = {
  ...puddle, key: 'burst', name: 'Burst', kind: 'interrupt', severity: 'wipe', messageTemplate: '{count} passaram', failTimes: [15_000, 70_000], failures: 2, events: [],
  players: [{ guid: 'C', name: 'C-R', count: 2, amount: 0, firstT: 14_000, credit: true, message: '', timeline: [[14_000, 1, 0], [65_000, 1, 0]] }],
};

const pull = {
  id: 0, groupSize: 20, success: false, bosses: [], mechanics: [puddle, venom, burst],
  deaths: [death('A', 30_000, { causedBy: cause('puddle', 20_000) }), death('B', 32_000, { causedBy: cause('puddle', 20_000) }), death('C', 60_000), death('D', 61_000), death('E', 62_000)],
  players: [{ guid: 'C', name: 'C-R', interrupts: 2, interruptAttempts: 3, canInterrupt: true, interruptLog: [{ t: 14_000, spell: 'Kick', targetSpellId: 1, targetSpell: 'Burst' }, { t: 64_000, spell: 'Kick', targetSpellId: null, targetSpell: null }, { t: 65_000, spell: 'Kick', targetSpellId: 1, targetSpell: 'Burst' }] }],
  enemySpells: [{ spellId: 1, name: 'Burst', sources: [], casts: 2, hitsOnPlayers: 0, damageToPlayers: 0, interrupted: 2, interruptible: true, castTimes: [15_000, 70_000], interruptTimes: [14_000, 65_000] }],
  trigger: null,
} as unknown as Pull;

describe('cutoff', () => {
  it('corte = momento da N-ésima morte; 0 desliga', () => {
    expect(cutoffTime(pull.deaths, 3)).toBe(60_000);
    expect(cutoffTime(pull.deaths, 0)).toBeNull();
    expect(cutoffTime(pull.deaths, 9)).toBeNull();
  });

  const cut = applyCutoff(pull, 3); // corte aos 60s

  it('recalcula erros por hit, stacks e falhas coletivas até o corte', () => {
    const get = (k: string) => cut.mechanics.find((m) => m.key === k)!;
    const p = get('puddle');
    expect(p.players.map((x) => [x.guid, x.count])).toEqual([['A', 2]]); // hit das 90s e o B (95s) saem
    expect(p.players[0].message).toBe('A pisou 2x');
    expect(p.failures).toBe(2);
    expect(p.events).toHaveLength(1);
    expect(get('venom').players).toHaveLength(0); // aos 60s tinha 7 stacks (< 8)
    expect(get('venom').failures).toBe(0);
    const b = get('burst');
    expect([b.failures, b.summary, b.players[0].count]).toEqual([1, '1 passaram', 1]);
  });

  it('recorta interrupts, casts e recalcula o gatilho', () => {
    expect(cut.players[0]).toMatchObject({ interrupts: 1, interruptAttempts: 1 });
    expect(cut.enemySpells[0]).toMatchObject({ casts: 1, interrupted: 1 });
    expect(cut.trigger).toMatchObject({ key: 'puddle', deaths: 2, t: 20_000 });
    expect(cut.cutoffT).toBe(60_000);
  });

  it('decisivas passam a ser as N primeiras mortes', () => {
    expect(analyzePull(cut).decisiveDeaths.map((d) => d.guid)).toEqual(['A', 'B', 'C']);
  });

  it('o resumo da noite não conta mortes depois do corte', () => {
    const withDeath = { ...cut, deaths: [...cut.deaths, death('F', 90_000, { causedBy: cause('puddle', 85_000) })] };
    expect(summarizeNight([withDeath]).causes.find((c) => c.key === 'puddle')?.deaths).toBe(2);
  });

  it('sem corte o pull fica igual', () => {
    expect(applyCutoff(pull, 0).mechanics).toBe(pull.mechanics);
  });
});
