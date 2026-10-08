import { describe, expect, it, vi } from 'vitest';
import { historyQuery, killParseOf, metricFor, ownPreviousParses, parseColor, rankingEntries, serverSlug, splitName, storedKillParses, wholeParse } from './wclParses';
import { player as fixturePlayer, pull } from './test-fixtures';
import type { PlayerStats } from '../types';

const player = (name: string, role: PlayerStats['role']) => ({ name, role, guid: name }) as PlayerStats;

describe('wclParses', () => {
  it('ranking do papel: healer em HPS, dps e tank em DPS', () => {
    expect(metricFor('healer')).toBe('hps');
    expect(metricFor('dps')).toBe('dps');
    expect(metricFor('tank')).toBe('dps');
  });

  it('separa nome, reino e região', () => {
    expect(splitName('Markíno-Azralon-US')).toEqual({ name: 'Markíno', server: 'Azralon', region: 'US' });
    expect(splitName('Foo-Area-52-US')).toEqual({ name: 'Foo', server: 'Area-52', region: 'US' });
    expect(serverSlug("Quel'Thalas")).toBe('quelthalas');
    expect(serverSlug('Burning Legion')).toBe('burning-legion');
  });

  it('pega cada papel do seu ranking', () => {
    const json = {
      data: [
        {
          roles: {
            tanks: { characters: [{ name: 'Tank', server: { name: 'Azralon' }, rankPercent: 40 }] },
            healers: { characters: [{ name: 'Heal', server: { name: 'Azralon' }, rankPercent: 90 }] },
            dps: { characters: [{ name: 'Mage', server: { name: 'Azralon' }, rankPercent: 70 }] },
          },
        },
      ],
    };
    expect([...rankingEntries(json, 'dps').keys()].sort()).toEqual(['mage|azralon', 'tank|azralon']);
    expect([...rankingEntries(json, 'hps').keys()]).toEqual(['heal|azralon']);
    expect(rankingEntries(null, 'dps').size).toBe(0);
  });

  it('histórico pede a métrica do papel de cada player', () => {
    const q = historyQuery([player('Heal-Azralon-US', 'healer'), player('Mage-Azralon-US', 'dps')], 3470, 5);
    expect(q).toContain('p0: character(name: "Heal", serverSlug: "azralon", serverRegion: "us")');
    expect(q).toContain('encounterID: 3470, difficulty: 5, metric: hps');
    expect(q).toContain('p1: character(name: "Mage"');
    expect(q).toMatch(/p1:.*metric: dps/);
  });

  it('cores do site', () => {
    expect(parseColor(100)).toBe('#e5cc80');
    expect(parseColor(96)).toBe('#ff8000');
    expect(parseColor(10)).toBe('#9d9d9d');
  });
});

describe('parses salvos', () => {
  // Node não tem localStorage: um substituto em memória (com key/length, para varrer os kills)
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
  const save = (p: { encounterId: number; startMs: number; difficultyId: number }, byName: Record<string, number>) =>
    store.set(`wipe-cause:parses:${p.encounterId}:${p.startMs}`, JSON.stringify({ difficultyId: p.difficultyId, byName: Object.fromEntries(Object.entries(byName).map(([n, percent]) => [n, { metric: 'dps', kind: 'kill', percent }])) }));
  const kill = (start: number, difficultyId = 16) => pull(0, start, 300_000, { success: true, difficultyId, players: [fixturePlayer('A')] });

  it('parse inteiro, como no site', () => {
    expect(wholeParse(87.4)).toBe(87);
    expect(wholeParse(87.6)).toBe(88);
    save(kill(1_000), { 'A-Realm': 64.7 });
    expect(storedKillParses(kill(1_000))!['A-Realm'].percent).toBe(65);
    expect(killParseOf(kill(1_000), fixturePlayer('A'))).toBe(65);
  });

  it('compara com os kills anteriores dele no mesmo boss e dificuldade', () => {
    save(kill(2_000), { 'A-Realm': 50 });
    save(kill(2_500, 15), { 'A-Realm': 99 }); // heroico: não entra
    save(kill(3_000), { 'A-Realm': 80 });
    save(kill(9_000), { 'A-Realm': 10 }); // depois: não entra
    expect(ownPreviousParses(kill(4_000), 'A-Realm')).toEqual({ previous: { percent: 80, startMs: 3_000 }, avg: 65, kills: 3 });
    expect(ownPreviousParses(kill(500), 'A-Realm')).toEqual({ previous: null, avg: null, kills: 0 });
  });

  it('wipe não tem parse', () => {
    expect(killParseOf({ ...kill(1_000), success: false }, fixturePlayer('A'))).toBeNull();
  });
});
