import { describe, expect, it } from 'vitest';
import type { Death, MechanicResult, PlayerStats, Pull } from '../types';
import { summarizeNight, topBy } from './night';

const player = (guid: string, over: Partial<PlayerStats> = {}): PlayerStats => ({
  guid, name: `${guid}-Realm`, class: 'Mage', specId: 63, role: 'dps', damageDone: 0, dps: 100, healingDone: 0, hps: 0,
  damageTaken: 0, deaths: 0, healthPotions: 0, healthstones: 0, defensivesUsed: [], takenByAbility: [],
  interrupts: 0, interruptAttempts: 0, canInterrupt: true, interruptLog: [], ...over,
});

const death = (guid: string, t: number, over: Partial<Death> = {}): Death => ({
  order: 1, guid, name: `${guid}-Realm`, class: 'Mage', role: 'dps', t, ignored: false, killingBlow: null, killingBlowMechanic: null,
  deathKind: 'spike', stats: { maxHp: 1, belowHalfMs: 0, maxHpPctLast3s: 90, damageTaken10s: 0, healingReceived10s: 0, healingPctOfMax10s: 0, underhealed: false },
  debuffs: [], mechanicDamage: [], causedBy: null, recap: [], defensivesRecent: [], defensivesAvailable: [],
  usedHealthPotion: false, usedHealthstone: false, healthstoneKnown: false, ...over,
});

const pull = (id: number, startMs: number, durationMs: number, over: Partial<Pull> = {}): Pull => ({
  id, encounterId: 1, encounterName: 'Boss', difficultyId: 16, difficultyName: 'Mythic', groupSize: 20, pullNumber: id + 1,
  pullNumberAll: id + 1, startMs, startLocal: '', tzOffsetHours: 0, durationMs, cutoffT: null, analyzedMs: durationMs, success: false, incomplete: false,
  bosses: [{ guid: 'b', name: 'Boss', npcId: 1, maxHp: 1, hpPct: 50, hpPctAtCutoff: null }], players: [player('A'), player('B'), player('C')],
  deaths: [], enemySpells: [], rulesFile: 'x.yaml', mechanics: [], trigger: null, ...over,
});

const cause = { key: 'orb', name: 'Orb', amount: 1, pct: 100, failT: 1000 };
/** Orb (soak): A foi atingido pela explosão 2x (vítima, não culpado), B ajudou a soakar 3x */
const orbMech: MechanicResult = {
  key: 'orb', name: 'Orb', spellId: null, kind: 'soak', severity: 'wipe', tip: '', evaluated: true, failures: 1, summary: '',
  players: [
    { guid: 'A', name: 'A-Realm', count: 2, amount: 0, firstT: 0, credit: false, message: '' },
    { guid: 'B', name: 'B-Realm', count: 3, amount: 0, firstT: 0, credit: true, message: '' },
  ],
  events: [],
};

/** poça (dano evitável): A pisou 2x — erro pessoal */
const puddle: MechanicResult = {
  key: 'puddle', name: 'Poça', spellId: null, kind: 'avoidable_damage', severity: 'minor', tip: '', evaluated: true, failures: 2, summary: '',
  players: [{ guid: 'A', name: 'A-Realm', count: 2, amount: 0, firstT: 0, credit: false, message: '' }],
  events: [],
};

describe('summarizeNight', () => {
  const pulls = [
    // pull 1: A morre cedo pro Orb (mortes em cascata depois), B soaka
    pull(0, 0, 120_000, {
      trigger: { key: 'orb', name: 'Orb', t: 1000, deaths: 2 },
      deaths: [death('A', 5_000, { causedBy: cause, defensivesAvailable: [{ spellId: 1, name: 'Ice Block', kind: 'personal' }] }), death('C', 100_000, { causedBy: cause })],
      mechanics: [orbMech, puddle],
    }),
    // pull 2 (2 min depois): C corta 4 casts, A não corta nada e casts passaram
    pull(1, 240_000, 60_000, {
      bosses: [{ guid: 'b', name: 'Boss', npcId: 1, maxHp: 1, hpPct: 12, hpPctAtCutoff: null }],
      players: [player('A'), player('B', { canInterrupt: false }), player('C', { interrupts: 4, dps: 300 })],
      enemySpells: [{ spellId: 9, name: 'Burst', sources: [], casts: 2, hitsOnPlayers: 0, damageToPlayers: 0, interrupted: 4, interruptible: true }],
    }),
    // pull 3 depois de uma pausa de 15 min
    pull(2, 300_000 + 15 * 60_000, 30_000, { success: true }),
  ];
  const s = summarizeNight(pulls);

  it('calcula tempos e downtime, separando pausas', () => {
    expect(s.combatMs).toBe(210_000);
    expect(s.gaps.map((g) => g.ms)).toEqual([120_000, 900_000]);
    expect(s.gaps.map((g) => g.isBreak)).toEqual([false, true]);
    expect(s.avgGapMs).toBe(120_000); // pausa fora da média
    expect(s.longestGap?.ms).toBe(900_000);
    expect(s.downtimeMs).toBe(1_020_000);
    expect(s.totalMs).toBe(300_000 + 15 * 60_000 + 30_000);
  });

  it('acha melhor pull, kills e a maior causa', () => {
    expect(s.kills).toBe(1);
    expect(s.wipes).toBe(2);
    expect(s.best?.pull.id).toBe(1);
    expect(s.causes[0]).toMatchObject({ key: 'orb', triggers: 1, deaths: 2, failures: 1 });
  });

  it('monta o placar de vilões e mocinhos', () => {
    const by = (g: string) => s.players.find((p) => p.guid === g)!;
    // os 2 hits da explosão (falha coletiva) não contam; os 2 da poça sim
    expect(by('A')).toMatchObject({ decisiveDeaths: 1, mechanicErrors: 2, deathsNoDefensive: 1, idleInterruptPulls: 1 });
    expect(by('B')).toMatchObject({ assists: 3, idleInterruptPulls: 0 });
    // só 2 mortes no pull: as duas contam como decisivas
    expect(by('C')).toMatchObject({ interrupts: 4, decisiveDeaths: 1 });
    expect(topBy(s.players, (p) => p.villainScore)[0].guid).toBe('A');
    // mocinho = mais pulls limpos (B: 3/3); C lidera interrupts, mas teve morte decisiva
    expect(topBy(s.players, (p) => p.heroScore)[0].guid).toBe('B');
    expect(topBy(s.players, (p) => p.interrupts)[0].guid).toBe('C');
    expect(by('C').avgDps).toBe(500 / 3);
  });
});

it('mortes ignoradas (depois do corte) não entram nas causas', () => {
  const cause = { key: 'orb', name: 'Orb', amount: 1, pct: 100, failT: 0 };
  const p = pull(0, 0, 60_000, {
    cutoffT: 10_000,
    deaths: [death('A', 5_000, { causedBy: cause }), death('B', 20_000, { causedBy: cause, ignored: true })],
  });
  expect(summarizeNight([p]).causes[0].deaths).toBe(1);
});
