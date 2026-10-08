import { describe, expect, it } from 'vitest';
import { buildNights, completePath, downloadMinutes, pendingLogs } from './nights';
import { groupNights, type GuildReport } from './guildNights';
import type { EncounterPeek, LogFile } from './api';

const H = 3_600_000;
const M = 60_000;
const T0 = 1000 * H; // 20:00 de uma noite qualquer

const enc = (encounterId: number, starts: number[], kills = 0, dungeon = false): EncounterPeek => ({
  encounterId,
  name: `Boss ${encounterId}`,
  difficultyId: dungeon ? 8 : 16,
  difficultyName: 'Mythic',
  dungeon,
  pulls: starts.length,
  kills,
  starts,
});
const file = (name: string, encounters: EncounterPeek[], folder: string | null = null): LogFile => {
  const all = encounters.flatMap((e) => e.starts ?? []);
  return { path: `C:/Logs/${name}`, name, size: 1e9, modifiedMs: Math.max(...all) + 10 * M, folder, peek: { firstMs: Math.min(...all), lastMs: Math.max(...all), encounters } };
};
const fight = (id: number, encounterID: number, start: number, kill = false, dur = 5 * M, difficulty = 5) => ({
  id,
  encounterID,
  name: `Boss ${encounterID}`,
  difficulty,
  kill,
  startTime: start,
  endTime: start + dur,
});

describe('nova análise: log do PC e Warcraft Logs se completam', () => {
  // noite: 7 bosses no WCL; o log do PC pegou só os 5 primeiros (a pessoa saiu antes)
  const bosses = [3470, 3445, 3455, 3497, 3420, 3379, 3429];
  const report: GuildReport = {
    code: 'AAAAAAAA',
    title: '',
    startTime: T0,
    endTime: T0 + 3 * H,
    owner: 'Fulano',
    zone: 'VA',
    fights: [
      ...bosses.map((b, i) => fight(i + 1, b, i * 20 * M + 1_500, true)),
      fight(20, 3455, 200 * M, false, 10_000), // wipe curto: não conta
      fight(21, 9999, 30 * M, true, 20 * M, 10), // M+: fora
    ],
  };
  const local = file(
    'WoWCombatLog-1.txt',
    [...bosses.slice(0, 5).map((b, i) => enc(b, [T0 + i * 20 * M], 1)), enc(8888, [T0 - 2 * H], 1, true)],
  );
  const archive = file('Archive-WoWCombatLog-1.txt', [enc(3470, [T0])], 'warcraftlogsarchive');

  it('uma noite só, com o que falta marcado por boss', () => {
    const [n, ...rest] = buildNights([local, archive], groupNights([report], T0 + 10 * H), T0 + 10 * H);
    expect(rest).toHaveLength(0);
    expect(n.files.map((f) => f.name)).toEqual(['WoWCombatLog-1.txt']); // a cópia do uploader não duplica
    expect(n.bosses.filter((b) => b.local > 0 && b.missing === 0)).toHaveLength(5);
    expect(n.bosses.filter((b) => b.local === 0).map((b) => [b.encounterId, b.missing, b.missingKills])).toEqual([
      [3379, 1, 1],
      [3429, 1, 1],
    ]);
    expect(n.missingPulls).toBe(2);
    expect(n.dungeonBosses).toBe(1);
    expect(downloadMinutes(n)).toBe(1);
    expect(completePath(n)).toBe('wcl:AAAAAAAA');
  });

  it('sem log no PC, a noite vem só do Warcraft Logs; sem WCL, só do PC', () => {
    const other = file('WoWCombatLog-2.txt', [enc(3470, [T0 + 30 * H])]);
    const nights = buildNights([other], groupNights([report], T0 + 50 * H), T0 + 50 * H);
    expect(nights).toHaveLength(2);
    expect(nights[0].files).toHaveLength(1);
    expect(nights[0].wcl).toBeNull();
    expect(nights[1].files).toHaveLength(0);
    expect(nights[1].missingPulls).toBe(7);
  });

  it('log só de M+ (sem boss de raid) não aparece; o que está sendo gravado agora, sim', () => {
    const mplus = file('WoWCombatLog-3.txt', [enc(8888, [T0 + 60 * H], 1, true), enc(8889, [T0 + 61 * H], 1, true)]);
    expect(buildNights([mplus], [], T0 + 70 * H)).toHaveLength(0);
    // gravando: modificado há pouco
    expect(buildNights([mplus], [], mplus.modifiedMs + M)).toHaveLength(1);
    // ainda sem leitura dos encontros: entra (a UI mostra "lendo")
    expect(buildNights([{ ...mplus, peek: null }], [], T0 + 70 * H)).toHaveLength(1);
  });
});

describe('analisar todos', () => {
  const a = file('WoWCombatLog-a.txt', [enc(3470, [T0 + 100 * H])]);
  const b = file('WoWCombatLog-b.txt', [enc(3470, [T0 + 130 * H])]);
  const live = file('WoWCombatLog-c.txt', [enc(3470, [T0 + 160 * H])]);
  const now = live.modifiedMs + M; // c está sendo gravado agora
  const nights = buildNights([a, b, live], [], now);
  it('só os logs ainda não analisados, sem a noite que está sendo gravada', () => {
    expect(pendingLogs(nights, (p) => p === a.path)).toEqual([b.path]);
    expect(pendingLogs(nights, () => true)).toEqual([]);
  });
});

describe('guilda x pug na lista', () => {
  const core = ['P-A', 'P-B', 'P-C', 'P-D'];
  const withPlayers = (name: string, start: number, groups: [number, string[]][]) => {
    const f = file(name, groups.map(([id], i) => enc(id, [start + i * H])));
    f.peek!.encounters.forEach((e, i) => (e.players = groups[i][1]));
    f.peek!.players = groups.flatMap(([, p]) => p);
    return f;
  };
  const files = [
    withPlayers('g1.txt', T0, [[1, core]]),
    withPlayers('g2.txt', T0 + 30 * H, [[1, core]]),
    withPlayers('g3.txt', T0 + 60 * H, [[1, core]]),
    withPlayers('misto.txt', T0 + 90 * H, [[1, core], [2, ['X-1', 'X-2', 'X-3', 'P-A']]]),
  ];
  const nights = buildNights(files, [], T0 + 200 * H);
  it('boss a boss: núcleo é guilda, gente que não se repete é pug', () => {
    const misto = nights.find((n) => n.files[0].name === 'misto.txt')!;
    expect(misto.kind).toBe('mixed');
    expect(misto.bosses.map((b) => [b.encounterId, b.guild])).toEqual([[1, true], [2, false]]);
    expect(nights.find((n) => n.files[0].name === 'g1.txt')!.kind).toBe('guild');
  });
});
