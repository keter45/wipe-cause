import { describe, expect, it, vi } from 'vitest';
import { buildTrends, byGroup, progAwards, dedupeNights, playerMoves, trendBosses, type NightInput, type PlayerTrend } from './trends';
import * as fx from './test-fixtures';
import { death, player, pull } from './test-fixtures';

const guillotine = { key: 'guillotine', name: 'Guillotine', amount: 1, pct: 100, failT: 1000 };
const orb = { key: 'orb', name: 'Orb roxo', amount: 1, pct: 100, failT: 1000 };
const def = [{ spellId: 1, name: 'Ice Block', kind: 'personal' as const }];

/** noite com `wipes` wipes; `orbs` deles com gatilho no orb; A morre para Guillotine sem defensivo */
function night(id: string, title: string, start: number, wipes: number, orbs: number, bestHp: number): NightInput {
  return {
    id,
    title,
    raidStartMs: start,
    pulls: Array.from({ length: wipes }, (_, i) =>
      pull(i, start + i * 300_000, 120_000, {
        bosses: [{ guid: 'b', name: 'Boss', npcId: 1, maxHp: 1, hpPct: i === 0 ? bestHp : 90, hpPctAtCutoff: null }],
        trigger: i < orbs ? { key: 'orb', name: 'Orb roxo', t: 1, deaths: 2 } : null,
        deaths: [death('A', 10_000, { causedBy: guillotine, defensivesAvailable: def }), death('B', 20_000, { causedBy: orb })],
      }),
    ),
  };
}

describe('buildTrends', () => {
  const nights = [night('n2', '24/09 · Boss Mythic', 2_000_000, 4, 1, 40), night('n1', '21/09 · Boss Mythic', 1_000_000, 4, 3, 60)];
  const t = buildTrends(nights, 'Boss · Mythic');

  it('ordena as noites pela data e resume cada uma', () => {
    expect(t.nights.map((n) => n.label)).toEqual(['21/09', '24/09']);
    expect(t.nights.map((n) => n.summary.best?.hp)).toEqual([60, 40]);
  });

  it('conta gatilhos por noite', () => {
    expect(t.causes[0]).toMatchObject({ key: 'orb', perNight: [3, 1], total: 4 });
  });

  it('acha o que se repete com cada player', () => {
    const a = t.players.find((p) => p.guid === 'A')!;
    expect(a.topKiller).toEqual(['Guillotine', 8]);
    expect(a.topKillerNights).toBe(2);
    expect(a.deathsNoDefensive).toBe(8);
    expect(a.deathsPerPull).toEqual([1, 1]);
  });

  it('escreve as conclusões', () => {
    expect(t.insights).toContain('Melhor pull por noite: 60.0% → 40.0%.');
    expect(t.insights).toContain('Orb roxo: gatilho em 75% dos wipes em 21/09 → 25% em 24/09 (melhorou).');
    expect(t.insights).toContain('A morreu para Guillotine 8× em 2 noites, 8 delas com defensivo sobrando.');
  });

  it('lista os bosses do histórico', () => {
    expect(trendBosses(nights)).toEqual([{ key: "Boss · Mythic", encounterId: 1, name: "Boss", difficultyId: 16, difficultyName: "Mythic", nights: 2, pulls: 8 }]);
  });

  it("Mythic antes de Heroic e, em cada um, a ordem da raide (não a quantidade de pulls)", () => {
    const at = (encounterId: number, encounterName: string, difficultyId: number, difficultyName: string, n: number) =>
      Array.from({ length: n }, (_, i) => fx.pull(i, i * 1_000, 60_000, { encounterId, encounterName, difficultyId, difficultyName }));
    const night = { id: "n", title: "x", raidStartMs: 0, pulls: [
      ...at(3421, "The Twin Fangs", 16, "Mythic", 30),
      ...at(3470, "Nek'zali the Soulcoiler", 16, "Mythic", 2),
      ...at(3429, "The Coiled Altar", 15, "Heroic", 9),
      ...at(3445, "Entombed Sentinels", 15, "Heroic", 1),
    ] };
    expect(trendBosses([night]).map((b) => b.key)).toEqual([
      "Nek'zali the Soulcoiler · Mythic", "The Twin Fangs · Mythic", "Entombed Sentinels · Heroic", "The Coiled Altar · Heroic",
    ]);
  });
});

describe('histórico enxuto', () => {
  it('não quebra sem os campos que o backend corta (recap, debuffs, eventos, interrupts)', () => {
    // o histórico da Evolução vem sem os campos pesados (history.rs: compact)
    const n = night('n1', '21/09 · Boss Mythic', 1_000_000, 3, 1, 50);
    for (const p of n.pulls) {
      for (const d of p.deaths) for (const k of ['recap', 'debuffs', 'mechanicDamage', 'positions'] as const) delete (d as Partial<typeof d>)[k];
      for (const pl of p.players) for (const k of ['takenByAbility', 'interruptLog'] as const) delete (pl as Partial<typeof pl>)[k];
    }
    const t = buildTrends([n, night('n2', '24/09 · Boss Mythic', 2_000_000, 2, 0, 30)], 'Boss · Mythic');
    expect(t.nights).toHaveLength(2);
  });
});

describe('quem melhora e quem piora', () => {
  const trend = (guid: string, scores: (number | null)[], perfs: (number | null)[]): PlayerTrend => ({
    guid, name: `${guid}-Realm`, class: null, deathsPerPull: [], scorePerNight: scores, perfPerNight: perfs, avgScore: 0, avgDeathsPerPull: 0, avgParse: null,
    pulls: 10, deaths: 0, deathsNoDefensive: 0, topKiller: null, topKillerSpellId: null, topKillerNights: 0, topKillerNoDefensive: 0, mechanicErrors: 0,
  });
  const m = playerMoves([
    trend('A', [60, 70, 80, 90], [40, 50, 60, 70]), // nota 65 -> 85, parse 45 -> 65
    trend('B', [90, null, 70], [90, null, 30]), // 2 noites: 90 -> 70
    trend('C', [80, 82], [50, 50]), // mudou pouco
    trend('D', [50], [50]), // uma noite só
  ]);
  it('compara o começo com o fim das noites em que jogou', () => {
    expect(m.improving).toHaveLength(1);
    expect(m.improving[0]).toMatchObject({ guid: 'A', nights: 4, scoreFrom: 65, scoreTo: 85 });
    expect([m.improving[0].perfFrom, m.improving[0].perfTo]).toEqual([45, 65]);
    expect(m.worsening.map((x) => [x.guid, x.scoreFrom, x.scoreTo, x.perfTo])).toEqual([['B', 90, 70, 30]]);
  });
});

describe('progressão: melhor e pior nos wipes antes da kill', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  const dps = (guid: string) => player(guid, { role: 'dps', aliveMs: 100_000 });
  // 6 wipes e a kill; E (que só entrou na kill) não conta; C morre cedo em todos os wipes
  const wipe = (i: number) =>
    pull(i, 1_000_000 + i * 300_000, 100_000, { analyzedMs: 100_000, players: [dps('A'), dps('B'), dps('C'), dps('D')], deaths: [death('C', 10_000)] });
  const kill = pull(6, 3_000_000, 100_000, { success: true, players: [dps('E'), dps('A'), dps('B'), dps('C'), dps('D')] });
  const parse = (percent: number) => ({ metric: 'dps', kind: 'kill', percent });
  store.set(`wipe-cause:parses:${kill.encounterId}:${kill.startMs}`, JSON.stringify({ 'A-Realm': parse(60), 'B-Realm': parse(95), 'C-Realm': parse(40), 'D-Realm': parse(12), 'E-Realm': parse(99) }));
  const t = buildTrends([{ id: 'n', title: '01/10 · Boss Mythic', raidStartMs: 1_000_000, pulls: [...Array.from({ length: 6 }, (_, i) => wipe(i)), kill] }], 'Boss · Mythic');
  it('nota nos wipes antes da kill; parse na kill; só quem jogou o bastante', () => {
    const pr = t.progression!;
    expect(pr.pulls).toBe(6);
    expect(pr.killedOn).toBe('01/10');
    expect(pr.worst?.guid).toBe('C');
    expect(pr.bestPerf).toMatchObject({ guid: 'B', killParse: 95 });
    expect(pr.worstPerf).toMatchObject({ guid: 'D', killParse: 12 });
    expect([pr.best, pr.worst, pr.bestPerf, pr.worstPerf].some((x) => x?.guid === 'E')).toBe(false);
  });
});

describe('médias compactas dos jogadores', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  const bad = {
    key: 'bad', name: 'Bad', spellId: 1, kind: 'avoidable_damage', severity: 'major' as const, tip: { pt: '', en: '' }, evaluated: true, failures: 1,
    summary: { pt: '', en: '' }, events: [],
    players: [{ guid: 'A', name: 'A-Realm', count: 1, amount: 100, firstT: 0, credit: false, message: { pt: '', en: '' } }],
  };
  const players = [player('A'), player('B')];
  const clean = pull(0, 1_000_000, 60_000, { players });
  const error = (id: number) => pull(id, 1_000_000 + id * 100_000, 60_000, { players, mechanics: [bad], deaths: [death('A', 10_000)] });
  const kill = pull(3, 1_400_000, 60_000, { players, mechanics: [bad], success: true });
  store.set(`wipe-cause:parses:${kill.encounterId}:${kill.startMs}`, JSON.stringify({ 'A-Realm': { metric: 'dps', kind: 'kill', percent: 80 } }));
  const t = buildTrends(
    [
      { id: 'n1', title: '01/10 · Boss Mythic', raidStartMs: 1_000_000, pulls: [clean] },
      { id: 'n2', title: '02/10 · Boss Mythic', raidStartMs: 1_100_000, pulls: [error(1), error(2), kill] },
    ],
    'Boss · Mythic',
  );

  it('pondera a nota média pelos pulls de cada noite', () => {
    const a = t.players.find((p) => p.guid === 'A')!;
    expect(a.scorePerNight[0]).toBe(100);
    expect(a.scorePerNight[1]!).toBeLessThan(100);
    // 1 pull na 1ª noite e 3 na 2ª: a média puxa para a noite em que jogou mais
    expect(a.avgScore).toBe(Math.round((a.scorePerNight[0]! * 1 + a.scorePerNight[1]! * 3) / 4));
    expect(a.avgScore).toBeLessThan(Math.round((a.scorePerNight[0]! + a.scorePerNight[1]!) / 2));
    // ordena pela nota média (B não errou nem morreu)
    expect(t.players[0].guid).toBe('B');
  });

  it('dá a morte por pull e o parse médio', () => {
    const a = t.players.find((p) => p.guid === 'A')!;
    expect(a.deaths).toBe(2);
    expect(a.pulls).toBe(4);
    expect(a.avgDeathsPerPull).toBe(0.5);
    expect(a.avgParse).toBe(80);
    expect(t.players.find((p) => p.guid === 'B')!.avgParse).toBeNull();
  });
});

describe('mass wipe na Evolução', () => {
  it('mortes de mass wipe não contam nas mortes nem no "mais morre para" de ninguém', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const blast = { key: 'boom', name: 'Detonation', amount: 1, pct: 100, failT: 90_000 };
    const pullWith = (id: number) =>
      fx.pull(id, id * 100_000, 95_000, {
        players: names.map((n) => fx.player(n)),
        deaths: [fx.death('A', 30_000, { causedBy: { ...blast, key: 'axe', name: 'Axegrinder' } }), ...names.map((n, i) => fx.death(n, 90_000 + i * 50, { causedBy: blast }))],
      });
    const n = (id: string, start: number) => ({ id, title: `${id} · Boss Mythic`, raidStartMs: start, pulls: [pullWith(0), pullWith(1)] });
    const tr = buildTrends([n('n1', 0), n('n2', 10_000_000)], 'Boss · Mythic');
    const a = tr.players.find((p) => p.guid === 'A')!;
    expect(a.deaths).toBe(4); // só as do Axegrinder, 1 por pull
    expect(a.topKiller?.[0]).toBe('Axegrinder');
    expect(tr.players.find((p) => p.guid === 'B')?.deaths ?? 0).toBe(0);
  });
});

describe('noite salva duas vezes', () => {
  it('cada pull conta uma vez e a cópia sem pull novo sai', () => {
    const pulls = (base: number) => [0, 1, 2].map((i) => fx.pull(i, base + i * 300_000, 60_000));
    const a = { id: 'a', title: '26/09 · Boss Mythic', raidStartMs: 0, pulls: pulls(1_000_000) };
    // a mesma raide de outro arquivo (ou do WCL, com o início 1s diferente)
    const b = { id: 'b', title: '26/09 · Boss Mythic', raidStartMs: 0, pulls: pulls(1_001_000) };
    const c = { id: 'c', title: '27/09 · Boss Mythic', raidStartMs: 0, pulls: pulls(90_000_000) };
    expect(dedupeNights([a, b, c]).map((n) => n.id)).toEqual(['a', 'c']);
    expect(trendBosses(byGroup([a, b, c], 'all').nights)[0].nights).toBe(2);
  });
});

describe('destaques da prog', () => {
  const hit = (amounts: Record<string, number>) => ({
    key: 'hit', name: 'Hit', spellId: 1, kind: 'avoidable_damage', severity: 'major' as const, tip: { pt: '', en: '' }, evaluated: true, failures: 1,
    summary: { pt: '', en: '' }, events: [],
    players: Object.entries(amounts).map(([guid, amount]) => ({ guid, name: `${guid}-Realm`, count: 1, amount, firstT: 0, credit: false, message: { pt: '', en: '' } })),
  });
  const nightOf = (pulls: ReturnType<typeof pull>[]) => buildTrends([{ id: 'n', title: '01/10 · Boss Mythic', raidStartMs: 0, pulls }], 'Boss · Mythic');

  it('dano evitável por pull, mortes e quem causa o wipe; mortes após a call não contam', () => {
    const players = [player('A'), player('B'), player('C')];
    const wipe = (i: number) =>
      pull(i, i * 300_000, 100_000, {
        players,
        mechanics: [hit({ A: 100, B: 500, C: 300 })],
        // A morre cedo (decisiva); B só depois da call de wipe (ignorada)
        deaths: [death('A', 10_000), { ...death('B', 60_000), ignored: true }],
      });
    const aw = nightOf(Array.from({ length: 4 }, (_, i) => wipe(i))).progAwards;
    expect(aw.leastDamage).toMatchObject({ guid: 'A', value: 100, pulls: 4 });
    expect(aw.mostDamage).toMatchObject({ guid: 'B', value: 500 });
    expect(aw.mostDeaths).toMatchObject({ guid: 'A', value: 1 });
    expect(aw.wipeCauser).toMatchObject({ guid: 'A', wipes: 4 });
    // B só teve morte ignorada: é um dos que menos morrem
    expect(['B', 'C']).toContain(aw.fewestDeaths?.guid);
    // quem tem o menos dano não é o de mais dano
    expect(aw.mostDamage?.guid).not.toBe(aw.leastDamage?.guid);
  });

  it('mortes de wipe geral não contam', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const blast = { key: 'boom', name: 'Detonation', amount: 1, pct: 100, failT: 90_000 };
    const wipe = (i: number) =>
      pull(i, i * 300_000, 95_000, { players: names.map((n) => player(n)), deaths: names.map((n, k) => death(n, 90_000 + k * 50, { causedBy: blast })) });
    const aw = progAwards(nightOf([wipe(0), wipe(1)]).nights);
    expect(aw.mostDeaths).toBeUndefined();
    expect(aw.wipeCauser).toBeUndefined();
  });

  it('só entra quem jogou ao menos 30% dos pulls e a kill fecha a prog', () => {
    const wipe = (i: number, guids: string[]) => pull(i, i * 300_000, 100_000, { players: guids.map((g) => player(g)), mechanics: [hit({ A: 400, Z: 0 })], deaths: [] });
    // 10 wipes: Z só em 2 (20%) com dano zero, não pode ganhar; depois a kill, que não entra
    const pulls = [...Array.from({ length: 10 }, (_, i) => wipe(i, i < 2 ? ['A', 'B', 'Z'] : ['A', 'B'])), pull(10, 4_000_000, 100_000, { success: true, players: [player('A'), player('B')], mechanics: [hit({ A: 9999 })] })];
    const aw = progAwards(nightOf(pulls).nights);
    expect(aw.leastDamage?.guid).toBe('B');
    expect(aw.mostDamage).toMatchObject({ guid: 'A', value: 400, pulls: 10 });
  });

  it('sem candidatos, sem prêmios', () => {
    expect(progAwards([])).toEqual({});
  });
});
