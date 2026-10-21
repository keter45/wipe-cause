import { describe, expect, it } from 'vitest';
import * as fx from './test-fixtures';
import { bossEndPct, buildSimProfile, fightMovement, movementEvents, pickSimPull, simcSpec, targetWindows } from './simProfile';
import type { TalentTree } from './talents';
import type { PlayerStats, Setup } from '../types';

const setup = (over: Partial<Setup> = {}): Setup => ({
  stats: { strength: 0, agility: 0, stamina: 0, intellect: 0, crit: 0, haste: 0, mastery: 0, versatility: 0, leech: 0, avoidance: 0, speed: 0 },
  itemLevel: 330,
  items: [
    { slot: 0, itemId: 271492, ilvl: 321, enchant: 7961, gems: [], bonusIds: [6652, 13696] },
    { slot: 3, itemId: 1, ilvl: 1, enchant: null, gems: [] }, // camisa: fica de fora
    { slot: 1, itemId: 268265, ilvl: 334, enchant: null, gems: [240983, 240908] },
  ],
  talents: [[1, 100, 1], [2, 200, 2], [3, 300, 1], [4, 999, 1]],
  faction: 1,
  ...over,
});

const tree: TalentTree = new Map([
  [100, { name: 'a', spellId: null, icon: null, nodeId: 1, maxRanks: 1, tree: 'class' }],
  [200, { name: 'b', spellId: null, icon: null, nodeId: 2, maxRanks: 2, tree: 'spec' }],
  [300, { name: 'c', spellId: null, icon: null, nodeId: 3, maxRanks: 1, tree: 'hero' }],
]);

const mage = (over: Partial<PlayerStats> = {}) => fx.player('Fulano', { name: 'Fulano-Azralon', setup: setup(), ...over });

describe('pickSimPull', () => {
  const at = (h: number) => h * 3600_000;
  it('sem kill: o pull mais longo sem morte, do mesmo dia (erro de mecânica não tira)', () => {
    const pulls = [
      fx.pull(0, at(0), 200_000, { players: [mage()] }),
      fx.pull(1, at(1), 300_000, { players: [mage()], deaths: [fx.death('Fulano', 250_000, { name: 'Fulano-Azralon' })] }),
      fx.pull(2, at(2), 250_000, { players: [mage()] }),
      fx.pull(3, at(30), 400_000, { players: [mage()] }), // outro dia
    ];
    const pick = pickSimPull(pulls, pulls[0], 'Fulano-Azralon')!;
    expect([pick.pull.id, pick.windowMs, pick.kill, pick.alive]).toEqual([2, 250_000, false, true]);
  });

  it('a kill vem antes do pull mais longo, mesmo com morte nela', () => {
    const d = (t: number) => [fx.death('Fulano', t, { name: 'Fulano-Azralon' })];
    const pulls = [
      fx.pull(0, 0, 400_000, { players: [mage()] }),
      fx.pull(1, 1000, 200_000, { players: [mage()], success: true, deaths: d(150_000) }),
    ];
    const pick = pickSimPull(pulls, pulls[0], 'Fulano-Azralon')!;
    expect([pick.pull.id, pick.windowMs, pick.kill, pick.alive]).toEqual([1, 150_000, true, false]);
    // entre kills, a que ele terminou vivo
    pulls.push(fx.pull(2, 2000, 180_000, { players: [mage()], success: true }));
    expect(pickSimPull(pulls, pulls[0], 'Fulano-Azralon')!.pull.id).toBe(2);
  });

  it('morreu em todos: o de mais tempo vivo, cortado na morte', () => {
    const d = (t: number) => [fx.death('Fulano', t, { name: 'Fulano-Azralon' })];
    const pulls = [
      fx.pull(0, 0, 300_000, { players: [mage()], deaths: d(100_000) }),
      fx.pull(1, 1000, 300_000, { players: [mage()], deaths: d(180_000) }),
    ];
    const pick = pickSimPull(pulls, pulls[0], 'Fulano-Azralon')!;
    expect([pick.pull.id, pick.windowMs, pick.alive]).toEqual([1, 180_000, false]);
  });

  it('outro boss ou sem setup não conta', () => {
    const pulls = [fx.pull(0, 0, 300_000, { players: [mage({ setup: null })] }), fx.pull(1, 0, 300_000, { encounterName: 'Outro', players: [mage()] })];
    expect(pickSimPull(pulls, pulls[0], 'Fulano-Azralon')).toBeNull();
  });
});

describe('bossEndPct', () => {
  it('duas barras até o fim (P1 e P2): a reta do robô quase zera, com o mesmo tempo em execute', () => {
    // 200s: P1 de 100% a 5% em 100s, P2 de novo (a cada 5s): 15% do tempo abaixo de 20%, 30% abaixo de 35%
    const bar = Array.from({ length: 20 }, (_, i) => 1000 - i * 50);
    const pull = fx.pull(0, 0, 200_000, { bossHpTimeline: [...bar, ...bar], bosses: [{ guid: 'b', name: 'B', npcId: 1, maxHp: 1, hpPct: 50, hpPctAtCutoff: 50 }] });
    // sem a linha, a reta iria até 50% (sem execute nenhum)
    expect(bossEndPct(pull, 200_000)).toBe(6.5);
  });

  it('sem execute na luta: termina na vida real (não inventa execute)', () => {
    const line = Array.from({ length: 20 }, (_, i) => 1000 - i * 25); // 100% -> 52,5%
    expect(bossEndPct(fx.pull(0, 0, 100_000, { bossHpTimeline: line }), 100_000)).toBe(52.5);
  });
});

describe('buildSimProfile', () => {
  it('spec, talentos por árvore, itens com bonus id e a luta do pull', () => {
    const pull = fx.pull(0, 0, 200_000, {
      bosses: [{ guid: 'b', name: 'Boss', npcId: 1, maxHp: 1, hpPct: 40, hpPctAtCutoff: 40 }],
      players: [mage({ buffsReceived: [{ spellId: 2825, name: 'Bloodlust', t: 1500, source: null }, { spellId: 10060, name: 'Power Infusion', t: 30_000, source: null }] }), fx.player('Pri', { class: 'Priest' })],
    });
    const { input, bossEndPct } = buildSimProfile({ pull, player: pull.players[0], windowMs: 100_000, kill: false, alive: true }, tree)!;
    const lines = input.split('\n');
    expect(lines).toContain('mage="Fulano"');
    expect(lines).toContain('spec=fire');
    expect(lines).toContain('race=human');
    expect(lines).toContain('class_talents=100:1');
    expect(lines).toContain('spec_talents=200:2');
    expect(lines).toContain('hero_talents=300:1');
    expect(lines).toContain('head=,id=271492,bonus_id=6652/13696,enchant_id=7961,ilevel=321');
    expect(lines).toContain('neck=,id=268265,gem_id=240983/240908,ilevel=334');
    expect(input).not.toMatch(/^shirt=/m);
    expect(lines).toContain('max_time=100');
    expect(lines).toContain('vary_combat_length=0');
    // 100% -> 40% em 200s; a janela é a metade: 70%
    expect(bossEndPct).toBeCloseTo(70);
    expect(lines).toContain('enemy_death_pct=70');
    expect(lines).toContain('override.power_word_fortitude=1');
    expect(lines).toContain('override.battle_shout=0');
    expect(lines).toContain('override.bloodlust=1');
    expect(lines).toContain('bloodlust_time=1.5');
    expect(lines).toContain('external_buffs.power_infusion=30');
    expect(input).not.toContain('fight_style'); // apagaria os raid_events
    // sem o movimento medido (análise antiga): o padrão do SimC
    expect(input).toMatch(/^raid_events=\/movement,players_only=1,cooldown=40,/m);
  });

  it('o movimento da luta: o quartil dos DPS que menos andaram, a cada 30s', () => {
    // 4 DPS; nos primeiros 30s andam 10%, 20%, 30%, 40% (o quartil de baixo: 20%); depois, 50% todos
    const mv = (first: number) => [...Array(6).fill(first * 5_000), ...Array(6).fill(2_500)];
    const ps = [0.1, 0.2, 0.3, 0.4].map((m, i) => mage({ guid: `P${i}`, name: `P${i}-A`, moveTimeline: mv(m) }));
    const pull = fx.pull(0, 0, 60_000, { players: [mage(), ...ps] });
    expect(fightMovement(pull, 60_000)).toEqual([
      { from: 0, to: 30_000, share: 0.2 },
      { from: 30_000, to: 60_000, share: 0.5 },
    ]);
    // quem morreu no trecho não conta nele
    const dead = fx.pull(0, 0, 60_000, { players: [mage(), ...ps], deaths: [fx.death('P1', 10_000, { name: 'P1-A', guid: 'P1' })] });
    expect(fightMovement(dead, 60_000)![0].share).toBe(0.1);
    expect(movementEvents([{ from: 0, to: 30_000, share: 0.25 }])).toEqual(['movement,players_only=1,first=3,last=30,cooldown=6,cooldown_stddev=1.5,duration=1.5']);
    const { input } = buildSimProfile({ pull, player: pull.players[0], windowMs: 60_000, kill: false, alive: true }, tree)!;
    expect(input).toMatch(/^raid_events=\/movement,players_only=1,first=3,last=30,cooldown=7\.5,/m);
    expect(input).toMatch(/^raid_events\+=\/movement,players_only=1,first=31\.5,last=60,cooldown=3,/m);
    // menos de 3 DPS medidos: o padrão
    expect(fightMovement(fx.pull(0, 0, 60_000, { players: ps.slice(0, 2) }), 60_000)).toBeNull();
  });

  it('consumíveis: o que faltou no pull vira disabled; sem nomes (log local) fica o padrão', () => {
    const withNames = mage({ setup: setup({ auras: [{ spellId: 1235111, name: 'Flask of the Shattered Sun' }, { spellId: 6673, name: 'Battle Shout' }] }) });
    const p1 = fx.pull(0, 0, 100_000, { players: [withNames] });
    const a = buildSimProfile({ pull: p1, player: withNames, windowMs: 60_000, kill: false, alive: true }, tree)!;
    expect(a.input).not.toMatch(/^flask=/m);
    expect(a.input).toMatch(/^food=disabled$/m);
    expect(a.input).toMatch(/^augmentation=disabled$/m);
    expect(a.assumed.filter((x) => x !== 'race')).toEqual([]);

    const local = mage({ setup: setup({ auras: [{ spellId: 1235111 }, { spellId: 12345 }] }) });
    const p2 = fx.pull(0, 0, 100_000, { players: [local] });
    const b = buildSimProfile({ pull: p2, player: local, windowMs: 60_000, kill: false, alive: true }, tree)!;
    expect(b.input).not.toMatch(/^(flask|food|augmentation)=/m);
    expect(b.assumed.filter((x) => x !== 'race')).toEqual(['food', 'rune']);
  });

  it('raça pela racial usada; sem racial, pela facção (e avisa)', () => {
    const troll = mage({ casts: [{ spellId: 26297, name: 'Berserking', times: [1000] }] });
    const p = fx.pull(0, 0, 100_000, { players: [troll] });
    expect(buildSimProfile({ pull: p, player: troll, windowMs: 60_000, kill: false, alive: true }, tree)!.input).toMatch(/^race=troll$/m);
    const horde = mage({ setup: setup({ faction: 0 }) });
    const r = buildSimProfile({ pull: p, player: horde, windowMs: 60_000, kill: false, alive: true }, tree)!;
    expect(r.input).toMatch(/^race=orc$/m);
    expect(r.assumed).toContain('race');
  });

  it('nomes de classe e spec como o SimC escreve', () => {
    expect(simcSpec(577)).toEqual({ cls: 'demonhunter', spec: 'havoc' });
    expect(simcSpec(253)).toEqual({ cls: 'hunter', spec: 'beast_mastery' });
    expect(simcSpec(250)).toEqual({ cls: 'deathknight', spec: 'blood' });
  });
});

describe('targetWindows', () => {
  it('suaviza o vai e vem e junta trechos iguais', () => {
    // 2s por trecho: 1 alvo, um pack de 4 por 10s (com um buraco), 0 alvos por 8s
    const b = [1, 1, 1, 4, 4, 1, 4, 4, 1, 1, 0, 0, 0, 0, 1, 1];
    expect(targetWindows(b, 32_000)).toEqual([
      [0, 6_000, 1],
      [6_000, 16_000, 4],
      [16_000, 20_000, 1],
      [20_000, 28_000, 0],
      [28_000, 32_000, 1],
    ]);
  });
});
