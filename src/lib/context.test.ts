import { describe, expect, it } from 'vitest';
import type { RotationResult } from '../types';
import { buildContextRef, buildKeyOf, compareContext, contextMix, discoverBuild } from './context';
import { player, pull } from './test-fixtures';

const FV = 383328; // Final Verdict (alvo único)
const DS = 53385; // Divine Storm (AoE)
const DOT = 383346; // debuff mantido pela rotação
const GEAR = 999; // buff de equipamento (não é da rotação)

const rotation = (over: Partial<RotationResult> = {}): RotationResult => ({
  specName: 'Retribution Paladin',
  patch: '12.1',
  tree: 'Herald of the Sun',
  score: 90,
  findings: [],
  opener: null,
  downtimeMs: 0,
  activeMs: 240000,
  cooldowns: [],
  keyPoints: [],
  prioritySt: [{ spellId: FV, name: 'Final Verdict', note: null }],
  priorityAoe: [{ spellId: DS, name: 'Divine Storm', note: null }],
  sources: [],
  ...over,
});

/**
 * 240s: os primeiros 120s com 1 alvo, os outros 120s com 4. Em cada trecho, `stShare` dos casts são
 * Final Verdict no alvo único e `aoeShare` Divine Storm na AoE. `dot` = uptime do debuff.
 */
function fight(stShare: number, aoeShare: number, dot = 0.97, talents: number[] = []) {
  const targets = Array.from({ length: 121 }, (_, i) => (i < 60 ? 1 : 4));
  const fv: number[] = [];
  const ds: number[] = [];
  for (let k = 0; k < 100; k++) {
    const st = 2000 + k * 1150;
    (k < stShare * 100 ? fv : ds).push(st);
    const aoe = 122000 + k * 1150;
    (k < aoeShare * 100 ? ds : fv).push(aoe);
  }
  const p = player('A', {
    specId: 70,
    casts: [
      { spellId: FV, name: 'Final Verdict', times: fv },
      { spellId: DS, name: 'Divine Storm', times: ds },
    ],
    setup: { stats: {} as never, itemLevel: 700, items: [], talents: talents.map((t) => [1, t, 1] as [number, number, number]) },
    rotation: rotation({
      targets,
      uptimes: [
        { id: DOT, name: 'Expurgation', kind: 'debuff', uptime: dot, byRotation: 1 },
        { id: GEAR, name: 'Gear', kind: 'buff', uptime: dot, byRotation: 0 },
      ],
    }),
  });
  return { pull: pull(1, 0, 240000, { players: [p] }), player: p };
}

const tops = Array.from({ length: 10 }, (_, i) => fight(0.8 + (i % 3) * 0.02, 0.8 + (i % 2) * 0.03));
const name = (_: number, n: string) => n;

describe('contexto da luta', () => {
  it('mistura separada em alvo único e AoE pela contagem de alvos', () => {
    const m = contextMix(tops[0].pull, tops[0].player);
    expect(m.st.share.get(FV)).toBeCloseTo(0.8);
    expect(m.aoe.share.get(DS)).toBeCloseTo(0.8);
  });

  it('referência: mistura por contexto e só as auras que a rotação controla', () => {
    const ref = buildContextRef(tops, name)!;
    expect(ref.mix.aoe[DS].med).toBeGreaterThan(0.75);
    expect(Object.keys(ref.kept)).toEqual([String(DOT)]);
  });

  it('o player usando alvo único na AoE e deixando o debuff cair', () => {
    const me = fight(0.8, 0.2, 0.6);
    const out = compareContext(me.pull, me.player, buildContextRef(tops, name)!);
    expect(out).toContainEqual(expect.objectContaining({ kind: 'mix', ctx: 'aoe', spellId: DS }));
    expect(out).toContainEqual(expect.objectContaining({ kind: 'uptime', id: DOT }));
  });

  it('jogando igual aos tops: nada', () => {
    const me = fight(0.82, 0.81);
    expect(compareContext(me.pull, me.player, buildContextRef(tops, name)!)).toEqual([]);
  });

  it('pull bem mais curto que a luta dos tops: a mistura não compara (outra fase)', () => {
    const me = fight(0.8, 0.2, 0.97);
    const short = { ...me.pull, analyzedMs: 100000 };
    expect(compareContext(short, me.player, buildContextRef(tops, name)!).filter((x) => x.kind === 'mix')).toEqual([]);
  });
});

describe('builds', () => {
  it('talento que muda a mistura em todos os bosses vira build; o player é comparado com o dele', () => {
    // 4 bosses; em cada um, quem tem o talento 7 usa Divine Storm no alvo único
    const list = [1, 2, 3, 4].flatMap((enc) =>
      Array.from({ length: 4 }, (_, i) => {
        const has = i % 2 === 0;
        const x = fight(has ? 0.4 : 0.8, 0.8, 0.97, has ? [7] : [8]);
        return { pull: { ...x.pull, encounterId: enc }, player: x.player };
      }),
    );
    const b = discoverBuild(list, (e) => `talento ${e}`, name)!;
    expect(b.talents.map((t) => t.entry)).toContain(7);
    expect(buildKeyOf(list[0].player, b.talents.map((t) => t.entry))).not.toEqual(buildKeyOf(list[1].player, b.talents.map((t) => t.entry)));
  });

  it('talento que só aparece nos bosses de AoE não é build (quem muda é a luta)', () => {
    // boss 1 e 2: alvo único, ninguém com o talento; boss 3 e 4: AoE, todos com ele
    const list = [1, 2, 3, 4].flatMap((enc) =>
      Array.from({ length: 4 }, () => {
        const aoe = enc > 2;
        const x = fight(aoe ? 0.4 : 0.8, 0.8, 0.97, aoe ? [9] : []);
        return { pull: { ...x.pull, encounterId: enc }, player: x.player };
      }),
    );
    expect(discoverBuild(list, (e) => `talento ${e}`, name)).toBeNull();
  });
});
