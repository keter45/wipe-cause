import { describe, expect, it } from 'vitest';
import type { PlayerStats, Pull, RaidSeries } from '../types';
import type { HealRefEntry } from './healer';
import { parseNote } from './healNote';
import { judgeUse, matchLines, phaseOffsets, type RefsOf } from './healNoteCheck';
import type { Hit, Moment } from './raidHits';
import { death, player, pull } from './test-fixtures';
import { defaultPull, GAP_JOIN_S, GAP_MIN_S, GAP_SHARE, gaps, nightGaps, stackLanes, uses, withNote, type CdUse, type Gap } from './healTimeline';

// Os CDs usados nos testes: 740 Tranquility (sustained, 6 s, 180 s), 64843 Divine Hymn (burst, 5 s),
// 31821 Aura Mastery (mitigation active, 8 s), 97462 Rallying Cry (mitigation active, 10 s),
// 391528 Convoke (sustained, 120 s) e 106898 Stampeding Roar (sem kind).
const V = 20_000;
const casts = (m: Record<number, number[]>): PlayerStats['casts'] => Object.entries(m).map(([id, times]) => ({ spellId: Number(id), name: '', times }));
const druidAs = (guid: string, m: Record<number, number[]> = {}, cdHeals?: PlayerStats['cdHeals']) =>
  player(guid, { specId: 105, class: 'Druid', role: 'healer', casts: casts(m), cdHeals });
const druid = (m: Record<number, number[]> = {}, cdHeals?: PlayerStats['cdHeals']) => druidAs('Druida', m, cdHeals);
const marks = [{ key: 'p1', name: 'P1', t: 0 }];
/** Pulso de dano que deixa Wt/V em `ratio` da `first` à `last` (os 4 s anteriores completam a janela). */
const highRun = (first: number, last: number, ratio = GAP_SHARE + 0.05) => {
  const c = (ratio * V) / 5;
  return (i: number) => (i >= Math.max(0, first - 4) && i <= last ? c : 0);
};
const series = (n: number, unavoidable: (i: number) => number = () => 0, low: (i: number) => number = () => 0): RaidSeries => ({
  alive: Array(n).fill(20),
  low: Array.from({ length: n }, (_, i) => low(i)),
  maxHpK: Array(n).fill(V),
  unavoidableK: Array.from({ length: n }, (_, i) => unavoidable(i)),
});
const mk = (id: number, players: PlayerStats[], raidSeries: RaidSeries, over: Partial<Pull> = {}) =>
  pull(id, id * 1_000_000, raidSeries.unavoidableK.length * 1000, { players, raidSeries, phaseMarks: marks, ...over });
/** Cobertura artificial de um segundo, para testar falhas entre trechos de buraco. */
const cover = (start: number, end: number) => ({ window: [start, end] }) as CdUse;
const hit = (start: number, end: number): Hit => ({ start, end, size: 1, spellId: 900, key: null });
const moment = (key: string, at: number, ids: number[] = [0]): Moment => ({
  key, anchorSpell: 900, k: Number(key.split(':')[1]), spellId: 900, phaseKey: 'p1', inPhaseMs: at,
  pulls: new Map(ids.map((id) => [id, { at, end: at + 5_000, hit: true, size: 1 }])), withHit: ids.length, medianSize: 1,
});
const ref = (overheal: number) => ({ cdSpells: { 157982: { share: 1, overheal } } }) as unknown as HealRefEntry;
const refsOf = (overheals: number[]): RefsOf => () => overheals.map(ref);

describe('uses: veredictos sem note', () => {
  it('cura sem golpe nem raide baixa fica "sem dano"', () => {
    const p = mk(0, [druid({ 740: [10_000] })], series(60));
    expect(uses(p, [], [], () => [])[0]).toMatchObject({ noDamage: true, cycle: false, onHit: null });
  });

  it('dano alto na janela, sem golpe, não é "sem dano"', () => {
    const p = mk(0, [druid({ 740: [10_000] })], series(60, highRun(10, 12)));
    expect(uses(p, [], [], () => [])[0]).toMatchObject({ noDamage: false, onHit: null });
  });

  it('ciclo provável dentro do cooldown, fora dele e com o próximo uso sem momento', () => {
    const within = mk(0, [druid({ 740: [10_000, 190_000] })], series(400));
    const w = uses(within, [moment('900:1', 192_000)], [], () => []);
    expect(w[0]).toMatchObject({ cycle: true, noDamage: false });
    expect(w[1]).toMatchObject({ cycle: false });

    const outside = mk(0, [druid({ 740: [10_000, 380_000] })], series(400));
    const o = uses(outside, [moment('900:1', 192_000), moment('900:2', 382_000)], [], () => []);
    expect(o[0]).toMatchObject({ cycle: false, noDamage: true });

    const noNextMoment = mk(0, [druid({ 740: [10_000, 190_000] })], series(400));
    const n = uses(noNextMoment, [], [], () => []);
    expect(n[0]).toMatchObject({ cycle: false, noDamage: true });
  });

  it('cycleRule = false mantém o "sem dano"', () => {
    const p = mk(0, [druid({ 740: [10_000, 190_000] })], series(400));
    const u = uses(p, [moment('900:1', 192_000)], [], () => [], false);
    expect(u[0]).toMatchObject({ cycle: false, noDamage: true });
  });

  it('empilhado: dois usos de cura com heal_ids no mesmo momento e overheal alto', () => {
    const cdHeals: PlayerStats['cdHeals'] = [[10, 740, 100, 100]];
    const p = mk(0, [druidAs('Druida1', { 740: [10_000] }, cdHeals), druidAs('Druida2', { 740: [10_000] }, cdHeals)], series(60));
    const u = uses(p, [moment('900:1', 10_000)], [], refsOf([0.1, 0.1, 0.1]));
    expect(u).toHaveLength(2);
    expect(u.every((x) => x.stacked && x.overheal?.high)).toBe(true);
  });

  it('refs abaixo de MIN_REFS: overheal sem faixa e sem "alto"', () => {
    const p = mk(0, [druid({ 740: [10_000] }, [[10, 740, 100, 100]])], series(60));
    const u = uses(p, [], [], refsOf([0.1, 0.1]));
    expect(u[0].overheal).toMatchObject({ ref: null, high: false, refs: 2 });
  });

  it('player sem casts e spell sem kind não geram uso', () => {
    const p = mk(0, [druidAs('SemCasts'), druid({ 106898: [10_000] })], series(60));
    expect(uses(p, [], [], () => [])).toEqual([]);
  });
});

describe('gaps: buracos do pull', () => {
  it('burst logo depois do golpe cobre o trecho e não há buraco', () => {
    const p = mk(0, [druid({ 64843: [24_000] })], series(60, highRun(20, 25)));
    const u = uses(p, [], [], () => []);
    expect(u).toHaveLength(1);
    expect(gaps(p, u, {}, [], new Set())).toEqual([]);
  });

  it('duração no limite: GAP_MIN_S + 1 s vira buraco, GAP_MIN_S − 1 s não', () => {
    const long = mk(0, [], series(60, highRun(10, 10 + GAP_MIN_S)));
    const g = gaps(long, [], {}, [], new Set());
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ start: 10_000, end: (10 + GAP_MIN_S + 1) * 1000 });

    const short = mk(1, [], series(60, highRun(10, 10 + GAP_MIN_S - 2)));
    expect(gaps(short, [], {}, [], new Set())).toEqual([]);
  });

  it('falha de GAP_JOIN_S junta dois trechos; de GAP_JOIN_S + 1 separa', () => {
    const first = 8;
    const len = GAP_MIN_S;
    const joinedLast = first + len + GAP_JOIN_S + len - 1;
    const joined = mk(0, [], series(60, highRun(first, joinedLast)));
    const gj = gaps(joined, [cover((first + len) * 1000, (first + len) * 1000 + 999)], {}, [], new Set());
    expect(gj).toHaveLength(1);
    expect(gj[0]).toMatchObject({ start: first * 1000, end: (joinedLast + 1) * 1000 });

    const second = first + len + GAP_JOIN_S + 1;
    const splitLast = second + len - 1;
    const split = mk(1, [], series(60, highRun(first, splitLast)));
    const covers = [cover((first + len) * 1000, (first + len) * 1000 + 999), cover((first + len + 1) * 1000, (first + len + 1) * 1000 + 999)];
    const gs = gaps(split, covers, {}, [], new Set());
    expect(gs).toHaveLength(2);
    expect(gs.map((x) => [x.start, x.end])).toEqual([
      [first * 1000, (first + len) * 1000],
      [second * 1000, (splitLast + 1) * 1000],
    ]);
  });

  it('raide baixa sem dano alto e sem uso vira buraco com evidência', () => {
    const p = mk(0, [], series(60, () => 0, (i) => (i >= 10 && i < 13 ? 6 : 0)));
    const g = gaps(p, [], {}, [], new Set());
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ start: 10_000, end: 13_000, evidence: true, hit: false });
  });

  it('evidência: dois abaixo de 50% tem, um não, morte ignorada não', () => {
    const two = mk(0, [], series(60, highRun(10, 13), (i) => (i === 11 ? 2 : 0)));
    expect(gaps(two, [], {}, [], new Set())[0]).toMatchObject({ evidence: true });

    const one = mk(1, [], series(60, highRun(10, 13), (i) => (i === 11 ? 1 : 0)));
    expect(gaps(one, [], {}, [], new Set())[0]).toMatchObject({ evidence: false });

    const ignored = mk(2, [], series(60, highRun(10, 13)), { deaths: [death('A', 11_000, { ignored: true })] });
    expect(gaps(ignored, [], {}, [], new Set())[0]).toMatchObject({ evidence: false });
  });

  it('golpe sem uso vira buraco com hit e o pico é o maior Wt/V', () => {
    const p = mk(0, [], series(60, highRun(10, 13)), { enemyHits: [[10, 900, 1_000]] });
    const g = gaps(p, [], {}, [hit(11_000, 13_000)], new Set());
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ start: 10_000, end: 14_000, hit: true });
    expect(g[0].peak).toBeCloseTo(GAP_SHARE + 0.05);
  });

  it('chave pelo topSpell, pelo nearestAnchor e null sem marco', () => {
    const base = (id: number, over: Partial<Pull>) => mk(id, [], series(60, highRun(10, 13)), over);
    const byTop = gaps(base(0, { enemyHits: [[10, 900, 1_000]] }), [], { '900': [9_000] }, [], new Set());
    expect(byTop[0].key).toBe('900:1');
    const byNear = gaps(base(1, { enemyHits: [[10, 999, 1_000]] }), [], { '900': [12_000] }, [], new Set());
    expect(byNear[0].key).toBe('900:1');
    const none = gaps(base(2, {}), [], {}, [], new Set());
    expect(none[0].key).toBeNull();
  });

  it('sustained, active e mitigation cobrindo o trecho não deixam buraco', () => {
    const cases: [number, number][] = [
      [740, 4_000],
      [31821, 8_000],
      [97462, 8_000],
    ];
    for (const [spellId, at] of cases) {
      const p = mk(0, [druid({ [spellId]: [at] })], series(60, highRun(8, 15)));
      const u = uses(p, [], [], () => []);
      expect(gaps(p, u, {}, [], new Set())).toEqual([]);
    }
  });

  it('pull sem vida no log: gaps devolve vazio', () => {
    const p = pull(0, 0, 60_000, {
      phaseMarks: marks,
      raidSeries: { alive: Array(60).fill(20), low: null, maxHpK: Array(60).fill(V), unavoidableK: Array(60).fill(V) },
    });
    expect(gaps(p, [], {}, [], new Set())).toEqual([]);
  });

  it('CDs livres: usado há pouco não entra; usado em outro pull, sem uso aqui, entra', () => {
    const main = mk(0, [druid({ 740: [5_000] })], series(120, highRun(100, 107)));
    const other = mk(1, [druid({ 391528: [10_000] })], series(60));
    const usedInNight = new Set([...uses(main, [], [], () => []), ...uses(other, [], [], () => [])].map((u) => `${u.player.guid}:${u.cd.id}`));
    usedInNight.add('Druida:106898');
    const g = gaps(main, uses(main, [], [], () => []), {}, [], usedInNight);
    expect(g).toHaveLength(1);
    expect(g[0].free.map((f) => f.cd.id)).toEqual([391528]);
  });
});

describe('withNote', () => {
  const text = ['time:60;ph:1;tag:Druida;spellid:740;', 'time:200;ph:1;tag:Druida;spellid:391528;'].join('\n');

  it('uso casado recebe o veredicto da linha; cast sem linha mantém o de uses; not_used vira marca sem useAt', () => {
    const p = mk(0, [druid({ 740: [60_000], 391528: [100_000] })], series(400));
    const note = parseNote(text);
    const offsets = phaseOffsets([p], () => note);
    const checks = matchLines([p], () => note, offsets);
    const ms = [moment('900:1', 60_000)];
    const before = uses(p, ms, [], () => []);
    expect(before[0]).toMatchObject({ noDamage: true });
    const verdicts = judgeUse([p], () => note, offsets, checks, ms).get(0)!;
    const { uses: after, marks } = withNote(p, before, note, checks.get(0)!, verdicts);
    expect(after[0]).toMatchObject({ noDamage: false, onHit: true, line: { lineIndex: 0 } });
    expect(after[1]).toMatchObject({ noDamage: true, onHit: null });
    expect(after[1].line).toBeUndefined();
    expect(marks.find((m) => m.lineIndex === 0)).toMatchObject({ state: 'on_time', spellId: 740, useAt: 60_000, deltaMs: 0 });
    expect(marks.find((m) => m.lineIndex === 1)).toMatchObject({ state: 'not_used', spellId: 391528, useAt: undefined, deltaMs: undefined });
  });
});

describe('noite', () => {
  it('nightGaps: chave em 1 pull não entra; em 2+ entra com os pulls que chegaram', () => {
    const pulls = [0, 1, 2, 3].map((id) => pull(id, id * 1_000_000, 60_000, { phaseMarks: marks }));
    const anchors = new Map<number, Record<string, number[]>>([0, 1, 2].map((id) => [id, { '900': [10_000] }]));
    anchors.set(3, {});
    const gap = (key: string) => ({ key }) as Gap;
    const out = nightGaps(pulls, anchors, new Map([
      [0, [gap('900:1'), gap('900:2')]],
      [1, [gap('900:1')]],
    ]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: '900:1', spellId: 900, k: 1, reached: 3 });
    expect([...out[0].pulls]).toEqual([0, 1]);
  });

  it('stackLanes: sobrepostos em 0 e 1; sem sobreposição volta para 0', () => {
    const p = player('Druida');
    const use = (at: number, end: number) => ({ player: p, at, end }) as CdUse;
    const a = use(10_000, 20_000);
    const b = use(15_000, 25_000);
    const c = use(30_000, 35_000);
    const lanes = stackLanes([a, b, c]);
    expect(lanes.get(a)).toBe(0);
    expect(lanes.get(b)).toBe(1);
    expect(lanes.get(c)).toBe(0);
  });

  it('defaultPull: mais fases ganha; empate pelo mais longo e depois pelo mais recente', () => {
    const two = [...marks, { key: 'p2', name: 'P2', t: 50_000 }];
    const later = (id: number, durationMs: number, phaseMarks = two, phaseHpPct = 50) => pull(id, id * 1_000_000, durationMs, { phaseMarks, phaseHpPct });
    const many = later(0, 100_000, two, 50);
    const lowHp = later(1, 200_000, marks, 10);
    expect(defaultPull([lowHp, many]).id).toBe(0);
    const short = later(2, 100_000);
    const long = later(3, 200_000);
    expect(defaultPull([short, long]).id).toBe(3);
    const older = later(4, 200_000);
    const newer = pull(5, 5_000_000, 200_000, { phaseMarks: two, phaseHpPct: 50 });
    expect(defaultPull([older, newer]).id).toBe(5);
  });
});
