import { describe, expect, it } from 'vitest';
import type { GearItem, SpellCasts } from '../types';
import {
  burstCandidates,
  burstWindows,
  pairUses,
  candidates,
  compareCooldowns,
  compareItems,
  compareRotation,
  defaultReference,
  detectCooldowns,
  outputPerSec,
  perfInsights,
  statSplit,
  talentDiff,
} from './performance';
import { player, pull } from './test-fixtures';

const every = (ms: number, until: number, from = 0) => Array.from({ length: Math.floor((until - from) / ms) + 1 }, (_, i) => from + i * ms);
const cast = (spellId: number, name: string, times: number[]): SpellCasts => ({ spellId, name, times });

// 2 minutos: "Frostbolt" a cada 2s, "Icy Veins" (cooldown de 60s) e "Blink" (utilidade rara)
const rotation = (bolt: number, veins: number[], extra: SpellCasts[] = []) => [
  cast(116, 'Frostbolt', every(bolt, 119_000)),
  cast(12472, 'Icy Veins', veins),
  ...extra,
];
const dmg = (bolt: number) => [{ spellId: 116, name: 'Frostbolt', amount: bolt, pet: false }];

describe('comparação de desempenho', () => {
  const me = player('A', { damageDone: 12_000_000, aliveMs: 120_000, casts: rotation(3000, [20_000, 80_000]), damageBySpell: dmg(12e6) });
  const top = player('B', { damageDone: 18_000_000, aliveMs: 120_000, casts: rotation(2000, [5_000, 65_000], [cast(1953, 'Blink', [30_000])]), damageBySpell: dmg(18e6) });
  const other = player('C', { specId: 64, damageDone: 30_000_000, aliveMs: 120_000, casts: rotation(1000, [1_000]) });
  const p = pull(0, 0, 120_000, { players: [me, top, other] });
  // outro pull: B de novo, morto aos 20s (pouco tempo vivo: fora da lista)
  const p2 = pull(1, 200_000, 120_000, { players: [player('B', { aliveMs: 20_000, damageDone: 9e9, casts: rotation(2000, [5_000]) })] });
  const meS = { pull: p, player: me };

  it('compara só com a mesma spec, do melhor para o pior, sem pulls curtos', () => {
    const list = candidates(meS, [p, p2]);
    expect(list.map((s) => s.player.guid)).toEqual(['B']);
    expect(defaultReference(meS, list)?.player.guid).toBe('B');
    expect(outputPerSec(meS)).toBe(100_000);
  });

  it('referência padrão: quem rendeu mais, de preferência no mesmo pull', () => {
    const best = { pull: p2, player: player('X', { damageDone: 60e6, aliveMs: 60_000 }) };
    const worse = { pull: p, player: player('Y', { damageDone: 1e6, aliveMs: 60_000 }) };
    expect(defaultReference(meS, [best, worse])).toBe(best);
    const better = { pull: p, player: player('Z', { damageDone: 30e6, aliveMs: 60_000 }) };
    expect(defaultReference(meS, [best, better, worse])).toBe(better);
    expect(defaultReference(meS, [worse])).toBe(worse);
  });

  it('descobre cooldowns pelo intervalo entre usos', () => {
    const cds = detectCooldowns([meS, { pull: p, player: top }]);
    expect([...cds.keys()].sort((a, b) => a - b)).toEqual([1953, 12472]);
    expect(cds.get(12472)).toEqual({ gapMs: 60_000, usage: 1 });
    expect(cds.get(1953)!.usage).toBe(0.5);
  });

  it('atraso do cooldown e ritmo da rotação', () => {
    const ref = { pull: p, player: top };
    const cds = detectCooldowns([meS, ref]);
    const veins = compareCooldowns(meS, ref, cds).rows.find((r) => r.name === 'Icy Veins')!;
    expect(veins.firstDelta).toBe(15_000);
    expect(veins.possible).toBe(3);
    const bolt = compareRotation(meS, ref, cds).find((r) => r.name === 'Frostbolt')!;
    expect(bolt.flag).toBe('low');
    expect(bolt.mineShare).toBe(100);

    const text = perfInsights(meS, ref, cds).map((i) => i.text);
    expect(text).toContain('Dano por segundo vivo 33% abaixo da referência');
    expect(text).toContain('Icy Veins: 1º uso 15s depois da referência');
    expect(text.some((t) => t.startsWith('Blink'))).toBe(false); // utilidade de ocasião: sem alerta
  });

  it('mesma magia com dois IDs vira uma linha', () => {
    const a = player('A', { aliveMs: 60_000, casts: [cast(100, 'Charge', [1000]), cast(101, 'Charge', [2000, 3000])] });
    const b = player('B', { aliveMs: 60_000, casts: [cast(101, 'Charge', [1000, 2000, 3000])] });
    const rows = compareRotation({ pull: p, player: a }, { pull: p, player: b }, new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].mineCasts).toBe(3);
  });
});

describe('janelas de burst', () => {
  it('pareia usos pelo mais próximo no tempo', () => {
    expect(pairUses([4_000, 124_000], [4_500, 120_000])).toEqual([
      [4_000, 4_500],
      [124_000, 120_000],
    ]);
    // a referência segurou o cooldown para depois: cada um fica sozinho
    expect(pairUses([4_000], [120_000])).toEqual([
      [4_000, null],
      [null, 120_000],
    ]);
  });

  it('só cooldown de dano da classe vira janela; usados juntos viram uma', () => {
    const casts = (cd: number, racial: number) => [
      cast(288613, 'Trueshot', [cd, cd + 120_000]),
      cast(26297, 'Berserking', [racial, racial + 180_000]),
      cast(1, 'Voracious Heart', [cd, cd + 120_000]), // trinket: aparece na sequência, não abre janela
      cast(192077, 'Wind Rush Totem', [50_000, 170_000]), // utilidade: fora
      cast(19434, 'Aimed Shot', every(3000, 239_000)),
    ];
    const hunter = { class: 'Hunter', specId: 254 };
    const a = { pull: pull(0, 0, 240_000), player: player('A', { ...hunter, aliveMs: 240_000, casts: casts(4_000, 4_200) }) };
    const b = { pull: pull(1, 0, 240_000), player: player('B', { ...hunter, aliveMs: 240_000, casts: casts(10_000, 10_300) }) };
    const w = burstWindows(a, b, detectCooldowns([a, b]));
    expect(w.map((x) => [x.name, x.index, x.mine?.start, x.ref?.start])).toEqual([
      ['Trueshot + Berserking', 1, 4_000, 10_000],
      ['Trueshot', 2, 124_000, 130_000],
      ['Berserking', 2, 184_200, 190_300],
    ]);
    // o usuário escolhe: utilidade aparece como opção desmarcada e vira janela se marcada
    const cds = detectCooldowns([a, b]);
    const cands = burstCandidates(a, b, cds);
    expect(cands.find((c) => c.name === 'Wind Rush Totem')?.preset).toBe(false);
    expect(cands.find((c) => c.name === 'Trueshot')?.preset).toBe(true);
    expect(burstWindows(a, b, cds, new Set(['Wind Rush Totem'])).map((x) => x.name)).toEqual(['Wind Rush Totem', 'Wind Rush Totem']);
    const seq = w[0].mine!.casts;
    expect(seq[0].dt).toBeGreaterThanOrEqual(-3_000);
    expect(seq.at(-1)!.dt).toBeLessThanOrEqual(20_000);
    expect(seq.map((c) => c.name)).toContain('Aimed Shot');
  });
});

describe('setup', () => {
  const item = (slot: number, itemId: number, enchant: number | null = null, gems: number[] = []): GearItem => ({ slot, itemId, ilvl: 300, enchant, gems });

  it('encantamento e gema que faltam em relação à referência', () => {
    const rows = compareItems([item(0, 1), item(10, 2, null, [9])], [item(0, 1, 77), item(10, 3, 5, [9, 9])]);
    expect(rows.map((r) => [r.slot, r.missingEnchant, r.missingGems])).toEqual([
      [0, true, 0],
      [10, true, 1],
    ]);
  });

  it('talentos diferentes e rank diferente', () => {
    const d = talentDiff(
      [[1, 10, 1], [2, 20, 1], [3, 30, 2]],
      [[1, 10, 1], [4, 40, 1], [3, 30, 1]],
    );
    expect(d.onlyMine).toEqual([[2, 20, 1]]);
    expect(d.onlyRef).toEqual([[4, 40, 1]]);
    expect(d.rank).toEqual([[[3, 30, 2], [3, 30, 1]]]);
  });

  it('distribuição dos secundários', () => {
    const s = statSplit({ strength: 0, agility: 0, stamina: 0, intellect: 0, crit: 500, haste: 250, mastery: 250, versatility: 0, leech: 0, avoidance: 0, speed: 0 });
    expect(s).toEqual({ crit: 50, haste: 25, mastery: 25, versatility: 0 });
  });
});
