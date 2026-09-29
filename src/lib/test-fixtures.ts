// Pulls/players/mortes mínimos para os testes da UI.
import type { Death, PlayerStats, Pull } from '../types';

export const player = (guid: string, over: Partial<PlayerStats> = {}): PlayerStats => ({
  guid, name: `${guid}-Realm`, class: 'Mage', specId: 63, role: 'dps', damageDone: 0, dps: 100, healingDone: 0, hps: 0,
  damageTaken: 0, deaths: 0, healthPotions: 0, healthstones: 0, defensivesUsed: [], takenByAbility: [],
  interrupts: 0, interruptAttempts: 0, canInterrupt: true, interruptLog: [], ...over,
});

export const death = (guid: string, t: number, over: Partial<Death> = {}): Death => ({
  order: 1, guid, name: `${guid}-Realm`, class: 'Mage', role: 'dps', t, ignored: false, killingBlow: null, killingBlowMechanic: null,
  deathKind: 'spike', stats: { maxHp: 1, belowHalfMs: 0, maxHpPctLast3s: 90, damageTaken10s: 0, healingReceived10s: 0, healingPctOfMax10s: 0, underhealed: false },
  debuffs: [], mechanicDamage: [], causedBy: null, recap: [], defensivesRecent: [], defensivesAvailable: [],
  usedHealthPotion: false, usedHealthstone: false, healthstoneKnown: false, ...over,
});

export const pull = (id: number, startMs: number, durationMs: number, over: Partial<Pull> = {}): Pull => ({
  id, encounterId: 1, encounterName: 'Boss', difficultyId: 16, difficultyName: 'Mythic', groupSize: 20, pullNumber: id + 1,
  pullNumberAll: id + 1, startMs, startLocal: '', tzOffsetHours: 0, durationMs, cutoffT: null, analyzedMs: durationMs, success: false, incomplete: false,
  bosses: [{ guid: 'b', name: 'Boss', npcId: 1, maxHp: 1, hpPct: 50, hpPctAtCutoff: null }], players: [player('A'), player('B'), player('C')],
  deaths: [], enemySpells: [], rulesFile: 'x.yaml', mechanics: [], trigger: null, ...over,
});

