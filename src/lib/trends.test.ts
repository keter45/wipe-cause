import { describe, expect, it, vi } from 'vitest';
import { buildTrends, byGroup, progAwards, progDeathTable, dedupeNights, playerMoves, trendBosses, type NightInput, type PlayerTrend } from './trends';
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
    const players = ['A', 'B', 'C', 'D', 'E', 'F'].map((g) => player(g));
    const wipe = (i: number) =>
      pull(i, i * 300_000, 100_000, {
        players,
        mechanics: [hit({ A: 100, B: 500, C: 300, D: 150, E: 200, F: 250 })],
        // A morre cedo (decisiva); B só depois da call de wipe (ignorada)
        deaths: [death('A', 10_000), { ...death('B', 60_000), ignored: true }],
      });
    const t = nightOf(Array.from({ length: 4 }, (_, i) => wipe(i)));
    const aw = t.progAwards;
    // a barra é valor / maior valor entre todos os candidatos (B, com 500)
    expect(aw.leastDamage![0]).toMatchObject({ guid: 'A', value: 100, pulls: 4, scale: 500 });
    expect(aw.mostDamage![0]).toMatchObject({ guid: 'B', value: 500, scale: 500 });
    expect(t.deathTable.most[0]).toMatchObject({ guid: 'A', deaths: 1 });
    expect(t.deathTable.scale).toBe(1);
    // B só teve morte ignorada: os que menos morrem empatam em 0 e o lado "menos" some
    expect(t.deathTable.least).toEqual([]);
    // quem está no top do menos dano não está no de mais dano
    const least = aw.leastDamage!.map((x) => x.guid);
    expect(aw.mostDamage!.every((x) => !least.includes(x.guid))).toBe(true);
  });

  it('dano tomado deixa os tanks de fora; healers concorrem com os DPS', () => {
    const players = [player('T', { role: 'tank' }), player('H', { role: 'healer' }), player('A'), player('B'), player('C'), player('D')];
    const wipe = (i: number) =>
      pull(i, i * 300_000, 100_000, {
        players,
        mechanics: [hit({ T: 5000, H: 400, A: 300, B: 500, C: 200, D: 250 })],
        deaths: [],
      });
    const aw = progAwards(nightOf(Array.from({ length: 4 }, (_, i) => wipe(i))).nights);
    // o tank tomou muito mais dano, mas não entra em nenhum dos dois lados
    expect(aw.mostDamage!.some((x) => x.guid === 'T')).toBe(false);
    expect(aw.leastDamage!.some((x) => x.guid === 'T')).toBe(false);
    expect(aw.leastDamage![0]).toMatchObject({ guid: 'C', value: 200 });
    // healer concorre junto com os DPS (fica atrás de B, que tomou mais)
    expect(aw.mostDamage![0]).toMatchObject({ guid: 'B', value: 500 });
    expect(aw.mostDamage![1]).toMatchObject({ guid: 'H', value: 400 });
  });

  it('mortes de wipe geral não contam', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const blast = { key: 'boom', name: 'Detonation', amount: 1, pct: 100, failT: 90_000 };
    const wipe = (i: number) =>
      pull(i, i * 300_000, 95_000, { players: names.map((n) => player(n)), deaths: names.map((n, k) => death(n, 90_000 + k * 50, { causedBy: blast })) });
    expect(progDeathTable(nightOf([wipe(0), wipe(1)]).nights).most).toEqual([]);
  });

  it('mortes nos melhores pulls: 20% da noite, mínimo de 10 melhores, sem call nem wipe geral', () => {
    const players = ['A', 'B', 'C', 'D'].map((g) => player(g));
    const mass = ['A', 'B', 'C', 'D', 'E'].map((g, k) => death(g, 20_000 + k * 50));
    // 50 pulls: os 10 melhores (os primeiros, com o boss mais baixo) têm A morrendo; B só morre fora deles
    const wipe = (i: number) =>
      pull(i, i * 300_000, 100_000, {
        players,
        bosses: [{ guid: 'b', name: 'Boss', npcId: 1, maxHp: 1, hpPct: i < 10 ? 5 : 50, hpPctAtCutoff: null }],
        deaths: i < 10 ? [{ ...death('B', 5_000), ignored: true }, death('A', 10_000)] : i === 20 ? [death('B', 10_000)] : i === 30 ? mass : [],
      });
    const table = progDeathTable(nightOf(Array.from({ length: 50 }, (_, i) => wipe(i))).nights);
    expect(table.most.map((x) => x.guid)).toEqual(['A', 'B']);
    expect(table.most[0].bestRate).toBe(1);
    expect(table.most[1].bestRate).toBe(0);
    // menos de 10 melhores jogados: sem taxa ("—" na tela)
    const short = progDeathTable(nightOf(Array.from({ length: 20 }, (_, i) => wipe(i))).nights);
    expect(short.most.length).toBeGreaterThan(0);
    expect(short.most.every((x) => x.bestRate === null)).toBe(true);
  });

  it('tabela de mortes: ordem, parte com algo livre e taxa de 1ª morte', () => {
    const players = ['A', 'B', 'C', 'D', 'E', 'F'].map((g) => player(g));
    const usedAll = { usedHealthPotion: true, usedHealthstone: true, healthstoneKnown: true };
    // 4 pulls: A morre sempre com pot livre (e é a 1ª morte); B sempre sem nada livre; C em 2; D só no 1º pull, antes de todos
    const wipe = (i: number) =>
      pull(i, i * 300_000, 100_000, {
        players,
        deaths: [
          ...(i === 0 ? [death('D', 5_000, usedAll)] : []),
          death('A', 10_000, { usedHealthPotion: false }),
          { ...death('A', 15_000, { usedHealthPotion: false }), ignored: true },
          death('B', 30_000, usedAll),
          ...(i < 2 ? [death('C', 50_000, usedAll)] : []),
        ],
      });
    const t = progDeathTable(nightOf(Array.from({ length: 4 }, (_, i) => wipe(i))).nights);
    // mais: A e B (1 por pull; empate pelo nome), depois C (0,5)
    expect(t.most.map((x) => x.guid)).toEqual(['A', 'B', 'C']);
    expect(t.most[0]).toMatchObject({ deaths: 1, free: 1, pulls: 4 });
    expect(t.most[0].first).toBeCloseTo(0.75);
    expect(t.most[1]).toMatchObject({ deaths: 1, free: 0, first: 0 });
    expect(t.most[2].deaths).toBeCloseTo(0.5);
    // menos: E e F (0), depois D (0,25)
    expect(t.least.map((x) => x.guid)).toEqual(['E', 'F', 'D']);
    expect(t.least[2].first).toBeCloseTo(0.25);
    expect(t.scale).toBe(1);
    // ninguém repetido entre os dois lados
    expect(t.most.some((x) => t.least.some((y) => y.guid === x.guid))).toBe(false);
  });

  it('só entra quem jogou ao menos 30% dos pulls e a kill fecha a prog', () => {
    const wipe = (i: number, guids: string[]) => pull(i, i * 300_000, 100_000, { players: guids.map((g) => player(g)), mechanics: [hit({ A: 400, Z: 0 })], deaths: [] });
    // 10 wipes: Z só em 2 (20%) com dano zero, não pode ganhar; depois a kill, que não entra
    const pulls = [...Array.from({ length: 10 }, (_, i) => wipe(i, i < 2 ? ['A', 'B', 'Z'] : ['A', 'B'])), pull(10, 4_000_000, 100_000, { success: true, players: [player('A'), player('B')], mechanics: [hit({ A: 9999 })] })];
    const aw = progAwards(nightOf(pulls).nights);
    expect(aw.leastDamage![0].guid).toBe('B');
    expect(aw.leastDamage!.map((x) => x.guid)).not.toContain('Z');
    expect(aw.mostDamage).toBeUndefined(); // só A e B jogaram 30%: os dois já estão no top positivo
  });

  it('esconde a categoria cujo top inteiro empata no mesmo valor', () => {
    const players = ['A', 'B', 'C'].map((g) => player(g));
    // ninguém morre: tempo vivo 100% para os três
    const t = nightOf(Array.from({ length: 4 }, (_, i) => pull(i, i * 300_000, 100_000, { players })));
    expect(t.progAwards.mostTimeAlive).toBeUndefined();
    expect(t.deathTable.least).toEqual([]);
    expect(t.deathTable.most).toEqual([]);
  });

  it('sem candidatos, sem prêmios', () => {
    expect(progAwards([])).toEqual({});
    expect(progDeathTable([])).toEqual({ most: [], least: [], scale: 0 });
  });

  it('tabela de mortes ordenada, sem repetir entre os dois lados e sem valor 0 no "mais"', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    // A..H morrem em 0..7 dos 8 pulls
    const wipe = (i: number) =>
      pull(i, i * 300_000, 100_000, {
        players: names.map((n) => player(n)),
        deaths: names.filter((_, k) => i < k).map((n, j) => death(n, 10_000 + j * 20_000)),
      });
    const t = progDeathTable(nightOf(Array.from({ length: 8 }, (_, i) => wipe(i))).nights);
    // 8 jogadores: 4 de cada lado
    expect(t.least.map((x) => x.guid)).toEqual(['A', 'B', 'C', 'D']);
    expect(t.least[0].deaths).toBe(0);
    expect(t.most.map((x) => x.guid)).toEqual(['H', 'G', 'F', 'E']);
    expect(t.most[0].deaths).toBeCloseTo(7 / 8);
    expect(t.scale).toBeCloseTo(7 / 8);
  });
  it('erros de mecânica por pull: menos e mais, sem créditos', () => {
    const players = ['A', 'B', 'C', 'D'].map((g) => player(g));
    const err = (counts: Record<string, number>) => ({
      ...hit({}),
      key: 'err',
      kind: 'avoidable_damage',
      players: Object.entries(counts).map(([guid, count]) => ({ guid, name: `${guid}-Realm`, count, amount: 1, firstT: 0, credit: false, message: { pt: '', en: '' } })),
    });
    const wipe = (i: number) => pull(i, i * 300_000, 100_000, { players, mechanics: [err({ A: 0, B: 1, C: 3, D: 2 })], deaths: [] });
    const aw = progAwards(nightOf(Array.from({ length: 4 }, (_, i) => wipe(i))).nights);
    expect(aw.fewestMechErrors![0].guid).toBe('A');
    expect(aw.mostMechErrors![0].guid).toBe('C');
    expect(aw.mostMechErrors!.some((x) => aw.fewestMechErrors!.some((y) => y.guid === x.guid))).toBe(false);
  });

  it('tempo vivo: morte ignorada e de wipe geral contam como vivo; fim é a call de wipe', () => {
    const players = ['A', 'B', 'C'].map((g) => player(g));
    const wipe = (i: number) =>
      pull(i, i * 300_000, 100_000, {
        players,
        // A morre aos 25% do pull; B só depois da call (ignorada); C vivo
        deaths: [death('A', 25_000), { ...death('B', 90_000), ignored: true }],
      });
    const aw = progAwards(nightOf(Array.from({ length: 4 }, (_, i) => wipe(i))).nights);
    expect(aw.mostTimeAlive!.map((x) => x.guid).slice(-1)).toEqual(['A']);
    expect(aw.mostTimeAlive!.find((x) => x.guid === 'A')!.value).toBeCloseTo(0.25);
    expect(aw.mostTimeAlive!.find((x) => x.guid === 'B')!.value).toBe(1);
    // com call de wipe aos 50s, a morte de A aos 25s vale 50%
    const called = (i: number) => pull(i, i * 300_000, 100_000, { players, wipeCall: { t: 50_000 } as never, deaths: [death('A', 25_000)] });
    const aw2 = progAwards(nightOf(Array.from({ length: 4 }, (_, i) => called(i))).nights);
    expect(aw2.mostTimeAlive!.find((x) => x.guid === 'A')!.value).toBeCloseTo(0.5);
  });

  it('1ª morte: conta a primeira morte válida do pull, por pull', () => {
    const players = ['A', 'B', 'C', 'D', 'E', 'F'].map((g) => player(g));
    const wipe = (i: number) =>
      pull(i, i * 300_000, 100_000, {
        players,
        // A morre primeiro em 3 de 4 pulls; B no outro; a morte ignorada de C não conta
        deaths: i < 3 ? [{ ...death('C', 1_000), ignored: true }, death('A', 10_000), death('B', 20_000)] : [death('B', 10_000), death('A', 20_000)],
      });
    const t = progDeathTable(nightOf(Array.from({ length: 4 }, (_, i) => wipe(i))).nights);
    expect(t.most.find((x) => x.guid === 'A')!.first).toBeCloseTo(0.75);
    expect(t.most.find((x) => x.guid === 'B')!.first).toBeCloseTo(0.25);
    expect(t.most.some((x) => x.guid === 'C')).toBe(false);
  });

  it('mais evoluiu e mais piorou: nota do começo contra o fim da prog; parse na kill', () => {
    const players = ['A', 'B', 'C'].map((g) => player(g));
    // A morre nos 4 primeiros pulls (nota baixa) e depois não; B ao contrário; C estável
    const wipe = (i: number) =>
      pull(i, i * 300_000, 100_000, {
        players,
        deaths: [...(i < 4 ? [death('A', 10_000)] : [death('B', 10_000)])],
      });
    const aw = progAwards(nightOf(Array.from({ length: 8 }, (_, i) => wipe(i))).nights);
    expect(aw.mostImproved![0].guid).toBe('A');
    expect(aw.mostImproved![0].to! - aw.mostImproved![0].from!).toBe(aw.mostImproved![0].value);
    expect(aw.mostImproved![0].value).toBeGreaterThanOrEqual(5);
    // a barra escala pela maior mudança entre todos, em módulo
    expect(aw.mostImproved![0].scale).toBeGreaterThanOrEqual(Math.abs(aw.mostWorsened![0].value));
    expect(aw.mostWorsened![0].guid).toBe('B');
    expect(aw.mostWorsened![0].value).toBeLessThanOrEqual(-5);
    expect(aw.mostImproved!.some((x) => x.guid === 'C')).toBe(false);
    // sem kill, não há parse
    expect(aw.bestKillParse).toBeUndefined();
  });

  it('melhor parse na kill: top 3 pelos parses salvos, só de quem jogou 30% da prog', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    const players = ['A', 'B', 'C', 'D'].map((g) => player(g));
    const wipes = Array.from({ length: 4 }, (_, i) => pull(i, i * 300_000, 100_000, { players, deaths: [] }));
    const kill = pull(4, 2_000_000, 100_000, { success: true, players });
    const parse = (percent: number) => ({ metric: 'dps', kind: 'kill', percent });
    store.set(`wipe-cause:parses:${kill.encounterId}:${kill.startMs}`, JSON.stringify({ 'A-Realm': parse(40), 'B-Realm': parse(95), 'C-Realm': parse(70), 'D-Realm': parse(12) }));
    const aw = progAwards(nightOf([...wipes, kill]).nights);
    expect(aw.bestKillParse!.map((x) => [x.guid, x.value])).toEqual([['B', 95], ['C', 70], ['A', 40]]);
    // sem kill a categoria some
    expect(progAwards(nightOf(wipes).nights).bestKillParse).toBeUndefined();
  });
  describe('quem mais causou wipes', () => {
    const players = ['A', 'B', 'C', 'D'].map((g) => player(g));
    const mech = (kind: string, guids: string[], over: Record<string, unknown> = {}) => ({ ...hit({}), key: 'boom', name: 'Boom', spellId: 77, kind, players: guids.map((guid) => ({ guid, name: `${guid}-Realm`, count: 1, amount: 1, firstT: 0, credit: false, message: { pt: '', en: '' } })), ...over });
    const run = (n: number, make: (i: number) => ReturnType<typeof pull>, extra: ReturnType<typeof pull>[] = []) => progAwards(nightOf([...Array.from({ length: n }, (_, i) => make(i)), ...extra]).nights).mostWipesCaused;

    it('morte decisiva: só até 25 s antes do fim do pull, ignoradas fora', () => {
      const top = run(4, (i) => pull(i, i * 300_000, 100_000, { players, deaths: [death('A', 80_000), death('B', 60_000), { ...death('C', 90_000), ignored: true }] }))!;
      expect(top.map((x) => x.guid)).toEqual(['A']);
      expect(top[0]).toMatchObject({ value: 1, byDeath: 4, byMechanic: 0, byTank: 0, scale: 1 });
    });

    it('mecânica que puxou o wipe (trigger) aponta quem errou; uma vez por pull, junto da morte', () => {
      const top = run(4, (i) =>
        pull(i, i * 300_000, 100_000, {
          players,
          mechanics: [mech('avoidable_damage', ['A', 'B'])],
          trigger: { key: 'boom', name: 'Boom', t: 1000, deaths: 2 },
          deaths: [death('A', 90_000), death('A', 95_000), death('C', 10_000)],
        }),
      )!;
      const a = top.find((x) => x.guid === 'A')!;
      expect(a).toMatchObject({ value: 1, byDeath: 4, byMechanic: 4 });
      expect(top.find((x) => x.guid === 'B')).toMatchObject({ byDeath: 0, byMechanic: 4 });
      expect(top.some((x) => x.guid === 'C')).toBe(false);
    });

    it('mecânica coletiva não aponta ninguém', () => {
      const top = run(4, (i) =>
        pull(i, i * 300_000, 100_000, { players, mechanics: [mech('soak', ['A', 'B'])], trigger: { key: 'boom', name: 'Boom', t: 1000, deaths: 2 }, deaths: [] }),
      );
      expect(top).toBeUndefined();
    });

    it('wipeCall de mecânica e de tank', () => {
      const viaCall = run(4, (i) =>
        pull(i, i * 300_000, 100_000, { players, mechanics: [mech('failure_event', ['D'])], wipeCall: { t: 50_000, trigger: { kind: 'mechanic', t: 40_000, spellId: 77, deaths: 1 } } as never, deaths: [] }),
      )!;
      expect(viaCall[0]).toMatchObject({ guid: 'D', byMechanic: 4 });
      const tank = [player('T', { role: 'tank' }), ...players];
      const viaTank = run(4, (i) =>
        pull(i, i * 300_000, 100_000, { players: tank, wipeCall: { t: 50_000, trigger: { kind: 'tank', name: 'T-Realm', t: 40_000, deaths: 1 } } as never, deaths: [] }),
      )!;
      expect(viaTank[0]).toMatchObject({ guid: 'T', byTank: 4, byDeath: 0, byMechanic: 0 });
    });

    it('kill não conta e o mínimo é 30% dos pulls', () => {
      const kill = pull(9, 5_000_000, 100_000, { success: true, players, deaths: [death('A', 95_000)] });
      const top = run(
        10,
        (i) => pull(i, i * 300_000, 100_000, { players: i < 5 ? players : players.filter((x) => x.guid !== 'D'), deaths: [death(i < 5 ? 'D' : 'A', 90_000)] }),
        [kill],
      )!;
      // D jogou 5 de 10 pulls (>= 30%) e causou 5; A causou 5 dos 10 pulls
      expect(top.map((x) => [x.guid, x.byDeath])).toEqual([['D', 5], ['A', 5]]);
      expect(top[0].value).toBe(1);
      // sem ninguém com 30% dos pulls que causou wipe, nada aparece
      const few = run(10, (i) => pull(i, i * 300_000, 100_000, { players: i === 0 ? [...players, player('X')] : players, deaths: i === 0 ? [death('X', 90_000)] : [] }));
      expect(few).toBeUndefined();
    });
  });
});
