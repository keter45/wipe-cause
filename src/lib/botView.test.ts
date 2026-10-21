import { describe, expect, it } from 'vitest';
import * as fx from './test-fixtures';
import { fixes, potential, raceName, simFacts } from './botView';
import type { BotRun } from './botSim';
import type { BotDecisions } from './botDecisions';

const input = `# wipe-cause: x
warlock="Fulano"
spec=demonology
race=dark_iron_dwarf
food=disabled
max_time=200
enemy_death_pct=35.5
override.arcane_intellect=1
override.battle_shout=0
override.bloodlust=1
bloodlust_time=1.5
external_buffs.power_infusion=30/150
raid_events=/movement,players_only=1,cooldown=40,first=15
raid_events+=/adds,count=3,first=60,duration=10,cooldown=9999
raid_events+=/invulnerable,first=100,duration=8,cooldown=9999,retarget=1
`;

const run = { input, windowMs: 200_000, assumed: ['rune'], bossEndPct: 35.5, dps: { mean: 1000, min: 900, max: 1150, error: 1 }, damageBySpell: [], casts: [] } as unknown as BotRun;

describe('simFacts', () => {
  it('lê do perfil o que o robô jogou', () => {
    const f = simFacts(run);
    expect(f.durationMs).toBe(200_000);
    expect(f.bossEndPct).toBe(35.5);
    expect(f.lust).toBe(1500);
    expect(f.pi).toEqual([30_000, 150_000]);
    expect(f.adds).toEqual([{ from: 60_000, to: 70_000, count: 3 }]);
    expect(f.noTarget).toEqual([{ from: 100_000, to: 108_000 }]);
    expect(f.movement).toEqual([15_000, 55_000, 95_000, 135_000, 175_000]);
    expect(f.consumables).toEqual([
      { kind: 'flask', have: 'had' },
      { kind: 'food', have: 'missing' },
      { kind: 'rune', have: 'default' },
    ]);
    expect(f.raidBuffs.find((b) => b.key === 'arcane_intellect')?.on).toBe(true);
    expect(f.raidBuffs.find((b) => b.key === 'battle_shout')?.on).toBe(false);
    expect(raceName(f.race)).toBe('Dark Iron Dwarf');
    expect(raceName('dracthyr_horde')).toBe('Dracthyr');
  });
});

describe('potential', () => {
  it('dano por segundo vivo ÷ média do robô, com a faixa das 1000 lutas', () => {
    const me = { pull: fx.pull(0, 0, 100_000), player: fx.player('A', { damageDone: 90_000, aliveMs: 100_000 }) };
    expect(potential(me, run)).toEqual({ pct: 0.9, low: 0.9, high: 1.15 });
  });
});

describe('fixes', () => {
  it('ordena os achados pelo dano estimado', () => {
    const player = fx.player('A', {
      casts: [
        { spellId: 1, name: 'Big', times: [1, 2] },
        { spellId: 2, name: 'Small', times: [1, 2, 3, 4] },
      ],
      damageBySpell: [
        { spellId: 1, name: 'Big', amount: 2000, pet: false },
        { spellId: 2, name: 'Small', amount: 400, pet: false },
      ],
    });
    const me = { pull: fx.pull(0, 0, 100_000), player };
    const d = {
      choices: [{ kind: 'bot_choice', buff: 9, buffName: 'Proc', spell: { spellId: 2, name: 'Small' }, bot: { spellId: 1, name: 'Big' }, botShare: 0.9, botYours: 0, times: [10, 20, 30] }],
      findings: [{ kind: 'proc_lost', buff: 8, name: 'Other', consumers: [{ spellId: 2, name: 'Small' }], you: 0.5, tops: 0, n: 10, times: [] }],
      ref: { n: 20, procs: {}, cds: {} },
    } as unknown as BotDecisions;
    const list = fixes(me, run, d, (x) => x.kind);
    // troca: 3 × (1000 − 100) = 2700; proc: 5 perdidos × 100 = 500
    expect(list.map((f) => [f.key, f.damage])).toEqual([
      ['bot_choice', 2700],
      ['proc_lost', 500],
    ]);
  });
});
