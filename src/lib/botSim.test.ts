import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fx from './test-fixtures';
import type { Setup } from '../types';

const saved = new Map<string, unknown>();
const runs: string[] = [];

// o simc de mentira: a média vem da rodada grande; cada seed devolve um DPS e uma sequência
vi.mock('./api', () => ({
  simcRun: vi.fn(async (input: string) => {
    runs.push(input);
    const seed = Number(/seed=(\d+)/.exec(input)?.[1] ?? 0);
    const dps = seed ? [0, 900, 1010, 1300, 700, 1200][seed] : 1000;
    const seq = [
      { time: 0, id: 0, name: 'snapshot_stats', spell_name: '' },
      { time: 0.5, id: 133, name: 'fireball', spell_name: 'Fireball' },
      { time: 1.2, id: 75, name: 'auto_shot', spell_name: 'Auto Shot' },
      { time: seed, id: 11366, name: 'pyroblast', spell_name: 'Pyroblast' },
    ];
    return {
      json: {
        sim: {
          players: [
            {
              collected_data: { dps: { mean: dps, min: 800, max: 1200, mean_std_dev: 3 }, action_sequence: seq, timeline_dmg: { data: Array(10).fill(1000) } },
              stats: [
                { id: 133, spell_name: 'Fireball', type: 'damage', compound_amount: 40_000 },
                { id: 1, spell_name: 'Heal', type: 'heal', compound_amount: 9 },
              ],
              stats_pets: { mirror_image: [{ id: 2, spell_name: 'Frostbolt', type: 'damage', compound_amount: 5_000 }] },
            },
          ],
        },
      },
      log: null,
      commit: 'abc1234',
      banner: 'SimulationCraft 1210-01',
      seconds: 1,
    };
  }),
  simcSavedGet: vi.fn(async (k: string) => saved.get(k) ?? null),
  simcSavedPut: vi.fn(async (k: string, v: unknown) => void saved.set(k, v)),
}));
vi.mock('./talents', () => ({ talentTree: vi.fn(async () => new Map()) }));

const { runBot, loadBotRun, botMe, botSample, BOT_ITERATIONS } = await import('./botSim');

const setup: Setup = {
  stats: { strength: 0, agility: 0, stamina: 0, intellect: 0, crit: 0, haste: 0, mastery: 0, versatility: 0, leech: 0, avoidance: 0, speed: 0 },
  itemLevel: 330,
  items: [],
  talents: [],
};

beforeEach(() => {
  saved.clear();
  runs.length = 0;
});

describe('runBot', () => {
  it('médias da rodada grande, sequência da seed mais perto da média, e salva', async () => {
    const me = fx.player('Fulano', { name: 'Fulano-Azralon', setup });
    const pull = fx.pull(0, 0, 120_000, { players: [me] });
    const run = await runBot([pull], pull, 'Fulano-Azralon', () => {});

    expect(runs[0]).toContain(`iterations=${BOT_ITERATIONS}`);
    expect(runs.filter((r) => r.includes('iterations=1\n'))).toHaveLength(5);
    expect(run.dps.mean).toBe(1000);
    // seed 2 (1010) é a mais perto de 1000: Pyroblast aos 2s; ataque automático e precombat ficam de fora
    expect(run.casts).toEqual([
      { spellId: 133, name: 'Fireball', times: [500] },
      { spellId: 11366, name: 'Pyroblast', times: [2000] },
    ]);
    expect(run.damageBySpell).toEqual([
      { spellId: 133, name: 'Fireball', amount: 40_000, pet: false },
      { spellId: 2, name: 'Frostbolt', amount: 5_000, pet: true },
    ]);
    expect(run.damageTimeline).toEqual([5000, 5000]);
    expect(await loadBotRun(pull, 'Fulano-Azralon')).toEqual(run);

    const mine = botMe([pull], run, 'Fulano-Azralon')!;
    const bot = botSample(mine, run);
    expect(bot.player.dps).toBe(1000);
    expect(bot.player.damageDone).toBe(120_000);
    expect(bot.pull.players).toEqual([bot.player]);
  });
});
