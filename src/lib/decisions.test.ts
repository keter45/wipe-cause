import { describe, expect, it } from 'vitest';
import type { BuffTrace, RotationResult } from '../types';
import { buildDecisionRef, compareDecisions, discoverConsumers, discoverCooldowns, povOf, type Pov } from './decisions';
import { death, player, pull } from './test-fixtures';

const PROC = 900; // buff: o próximo Hammer of Wrath
const HOW = 24275; // Hammer of Wrath (gasta o proc)
const JUDG = 20271; // Judgment
const WAKE = 255937; // cooldown de 30s
const WRATH = 31884; // cooldown que anda junto do Wake

const rotation = (buffs: BuffTrace[]): RotationResult => ({
  specName: 'Retribution Paladin',
  patch: '12.1',
  tree: 'Herald of the Sun',
  score: 90,
  findings: [],
  opener: null,
  downtimeMs: 0,
  activeMs: 300000,
  cooldowns: [
    { spellId: WAKE, name: 'Wake of Ashes', casts: 1, possible: 1, usage: 1 },
    { spellId: WRATH, name: 'Avenging Wrath', casts: 1, possible: 1, usage: 1 },
  ],
  keyPoints: [],
  prioritySt: [
    { spellId: HOW, name: 'Hammer of Wrath', note: null },
    { spellId: JUDG, name: 'Judgment', note: null },
  ],
  priorityAoe: [],
  sources: [],
  buffs,
});

/**
 * Um pull de 300s: o proc vem a cada 10s; `spend` diz se o Hammer of Wrath sai 1s depois (e gasta)
 * ou se sai Judgment e o proc acaba sozinho. Wake a cada 30s; `aligned` põe o Wrath junto.
 */
function fight(spend: (i: number) => boolean, opts: { wakeLate?: number; aligned?: boolean } = {}) {
  const how: number[] = [];
  const judg: number[] = [];
  const spans: [number, number][] = [];
  const drops: [number, number][] = [];
  for (let i = 0; i < 28; i++) {
    const t = 5000 + i * 10000;
    if (spend(i)) {
      how.push(t + 1000);
      spans.push([t, t + 1050]);
      drops.push([t + 1050, HOW]);
    } else {
      judg.push(t + 1000);
      spans.push([t, t + 8000]);
      drops.push([t + 8000, 0]);
    }
  }
  const wake: number[] = [];
  for (let t = 3000; t < 290000; t += 30000 + (opts.wakeLate ?? 0)) wake.push(t);
  const wrath = opts.aligned === false ? wake.map((t) => t + 12000) : wake.map((t) => t + 500);
  const casts = [
    { spellId: HOW, name: 'Hammer of Wrath', times: how },
    { spellId: JUDG, name: 'Judgment', times: judg },
    { spellId: WAKE, name: 'Wake of Ashes', times: wake },
    { spellId: WRATH, name: 'Avenging Wrath', times: wrath },
  ];
  const buff: BuffTrace = { id: PROC, name: 'Divine Resonance', maxStacks: 1, gains: 28, spans, drops };
  const p = player('A', { specId: 70, rotation: rotation([buff]), casts });
  return { pull: pull(1, 0, 300000, { players: [p] }), p };
}

const povs = (n: number, f: () => ReturnType<typeof fight>): Pov[] =>
  Array.from({ length: n }, () => {
    const x = f();
    return povOf(x.pull, x.p)!;
  });

const name = (id: number, fallback: string) => ({ [HOW]: 'Hammer of Wrath', [WAKE]: 'Wake of Ashes', [WRATH]: 'Avenging Wrath' })[id] ?? fallback;

describe('referência das decisões nos tops', () => {
  const tops = povs(10, () => fight(() => true));

  it('descobre quem gasta o proc', () => {
    expect([...(discoverConsumers(tops).get(PROC) ?? [])]).toEqual([HOW]);
  });

  it('cooldown pelo intervalo entre usos e o parceiro que sai junto', () => {
    const cds = discoverCooldowns(tops);
    expect(cds.get(WAKE)).toBe(30000);
    const ref = buildDecisionRef(tops, discoverConsumers(tops), cds, name);
    expect(ref.procs[PROC]).toMatchObject({ consumers: [HOW], consumerNames: ['Hammer of Wrath'], lost: { med: 0, p90: 0 } });
    expect(ref.cds[WAKE].partners.map((p) => p.key)).toContain(`c${WRATH}`);
  });
});

describe('o player contra os tops', () => {
  const tops = povs(10, () => fight(() => true));
  const ref = buildDecisionRef(tops, discoverConsumers(tops), discoverCooldowns(tops), name);

  it('proc que ele deixa acabar, com os momentos', () => {
    const me = fight((i) => i % 2 === 0);
    const f = compareDecisions(povOf(me.pull, me.p)!, ref).find((x) => x.kind === 'proc_lost');
    expect(f).toMatchObject({ kind: 'proc_lost', name: 'Divine Resonance', consumers: [{ spellId: HOW, name: 'Hammer of Wrath' }] });
    expect(f!.kind === 'proc_lost' && f!.you).toBeCloseTo(0.5);
    expect(f!.times.length).toBe(14);
  });

  it('sem nenhum uso de quem gasta: outro build, não cobra', () => {
    const me = fight(() => false);
    expect(compareDecisions(povOf(me.pull, me.p)!, ref).filter((x) => x.kind === 'proc_lost')).toEqual([]);
  });

  it('cooldown que os tops usam junto de outro e ele não', () => {
    const me = fight(() => true, { aligned: false });
    expect(compareDecisions(povOf(me.pull, me.p)!, ref)).toContainEqual(expect.objectContaining({ kind: 'cd_align', spellId: WAKE, partner: `c${WRATH}`, partnerKind: 'cast' }));
  });

  it('cooldown segurado depois de pronto', () => {
    const me = fight(() => true, { wakeLate: 8000 });
    expect(compareDecisions(povOf(me.pull, me.p)!, ref)).toContainEqual(expect.objectContaining({ kind: 'cd_held', spellId: WAKE }));
  });

  it('jogando igual aos tops: nada', () => {
    const me = fight(() => true);
    expect(compareDecisions(povOf(me.pull, me.p)!, ref)).toEqual([]);
  });

  it('depois da morte não conta', () => {
    const me = fight((i) => i < 3);
    const dead = { ...me.pull, deaths: [death('A', 30000)] };
    expect(compareDecisions(povOf(dead, me.p)!, ref)).toEqual([]);
  });
});
