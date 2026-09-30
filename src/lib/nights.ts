// Noites para a tela "Nova análise": o log do PC e o Warcraft Logs se completam, não
// concorrem. Cada noite junta os logs do PC e os reports da guilda do mesmo horário; por
// boss, o que está no log do PC é de graça (e rápido) e o que só existe no Warcraft Logs fica
// marcado, para o usuário decidir se baixa (demora) para ter a noite completa.
//
// Masmorras (M+) ficam de fora da comparação: o app é para raid.

import type { LogFile } from './api';
import { uniquePulls, LIVE_MS, type GuildNight } from './guildNights';

/** Wipes mais curtos que isso a análise descarta (pull falso / reset). */
const MIN_PULL_MS = 30_000;
/** Mesmo pull no log do PC e no WCL: começam com poucos segundos de diferença. */
const SAME_PULL_MS = 20_000;
/** Log do PC e reports do WCL são da mesma noite se os horários se encontram (com folga). */
const OVERLAP_MS = 30 * 60_000;
/** Download: ~1 s de API por 11 s de luta (medido: noite de 70 min de luta ≈ 6 min). */
const DOWNLOAD_PER_FIGHT_MS = 0.09;

/** Dificuldade do WCL -> id do jogo (o que o log local traz). */
const GAME_DIFFICULTY: Record<number, number> = { 1: 17, 3: 14, 4: 15, 5: 16, 10: 8 };

export interface NightBossRow {
  encounterId: number;
  name: string;
  /** id do jogo (14/15/16/17) */
  difficultyId: number;
  /** pulls no log do PC */
  local: number;
  localKills: number;
  /** pulls que só existem no Warcraft Logs */
  missing: number;
  missingKills: number;
}

export interface Night {
  key: string;
  startMs: number;
  endMs: number;
  /** logs do WoW neste PC com a noite */
  files: LogFile[];
  /** reports da guilda no Warcraft Logs */
  wcl: GuildNight | null;
  bosses: NightBossRow[];
  /** chefes de masmorra (M+) nos logs do PC: só uma contagem */
  dungeonBosses: number;
  /** pulls que só o Warcraft Logs tem e duração deles (estimativa do download) */
  missingPulls: number;
  missingMs: number;
  live: boolean;
}

/** Estimativa do download dos pulls que faltam, em minutos (pelo menos 1). */
export const downloadMinutes = (n: Night) => Math.max(1, Math.round((n.missingMs * DOWNLOAD_PER_FIGHT_MS) / 60_000));

/** Caminho da análise que completa o log do PC com o Warcraft Logs (o backend baixa só o que falta). */
export const completePath = (n: Night) => (n.wcl ? n.wcl.path : null);

const isMain = (f: LogFile) => f.folder == null && f.name.toLowerCase().startsWith('wowcombatlog');

export function buildNights(files: LogFile[], guild: GuildNight[], now = Date.now()): Night[] {
  // cópias (warcraftlogsarchive, Split-*) só se não houver o log original da mesma hora
  const withPeek = files.filter((f) => f.peek?.firstMs != null);
  const main = withPeek.filter(isMain);
  const copies = withPeek.filter((f) => !isMain(f) && !main.some((m) => overlaps(range(m), range(f), 0)));
  const locals = [...main, ...copies];

  const nights: Night[] = [];
  const used = new Set<LogFile>();
  for (const g of guild) {
    const gr: [number, number] = [g.startTime, g.endTime];
    const mine = locals.filter((f) => overlaps(range(f), gr, OVERLAP_MS));
    mine.forEach((f) => used.add(f));
    nights.push(night(mine, g, now));
  }
  for (const f of locals.filter((f) => !used.has(f))) nights.push(night([f], null, now));
  // arquivos sem encontros lidos ainda: entram sozinhos (a UI mostra "lendo")
  for (const f of files.filter((f) => f.peek?.firstMs == null && !f.peek)) nights.push(night([f], null, now));
  return nights.sort((a, b) => b.startMs - a.startMs);
}

function range(f: LogFile): [number, number] {
  return [f.peek?.firstMs ?? f.modifiedMs, f.peek?.lastMs ?? f.modifiedMs];
}

function overlaps(a: [number, number], b: [number, number], slack: number) {
  return a[0] <= b[1] + slack && b[0] <= a[1] + slack;
}

function night(files: LogFile[], wcl: GuildNight | null, now: number): Night {
  const bosses: NightBossRow[] = [];
  const row = (encounterId: number, name: string, difficultyId: number) => {
    let b = bosses.find((x) => x.encounterId === encounterId && x.difficultyId === difficultyId);
    if (!b) bosses.push((b = { encounterId, name, difficultyId, local: 0, localKills: 0, missing: 0, missingKills: 0 }));
    return b;
  };
  let dungeonBosses = 0;
  const localStarts: { encounterId: number; start: number }[] = [];
  for (const f of files) {
    for (const e of f.peek?.encounters ?? []) {
      if (e.dungeon) {
        dungeonBosses++;
        continue;
      }
      const b = row(e.encounterId, e.name, e.difficultyId);
      b.local += e.pulls;
      b.localKills += e.kills;
      for (const start of e.starts ?? []) localStarts.push({ encounterId: e.encounterId, start });
    }
  }

  let missingPulls = 0;
  let missingMs = 0;
  if (wcl) {
    for (const p of uniquePulls(wcl.reports)) {
      const difficultyId = GAME_DIFFICULTY[p.difficulty] ?? p.difficulty;
      if (difficultyId === 8) continue; // M+
      if (!p.kill && p.durationMs < MIN_PULL_MS) continue; // wipe curto: a análise descarta
      // o mesmo pull casa pelo boss e pelo horário (o log e o WCL podem escrever dificuldades diferentes)
      if (localStarts.some((l) => l.encounterId === p.encounterId && Math.abs(l.start - p.start) < SAME_PULL_MS)) continue;
      // boss que o log do PC tem, com outra dificuldade: soma na linha dele
      const b = bosses.find((x) => x.encounterId === p.encounterId && x.local > 0) ?? row(p.encounterId, p.name, difficultyId);
      b.missing++;
      if (p.kill) b.missingKills++;
      missingPulls++;
      missingMs += p.durationMs;
    }
  }

  const starts = [...files.map((f) => range(f)[0]), ...(wcl ? [wcl.startTime] : [])];
  const ends = [...files.map((f) => range(f)[1]), ...(wcl ? [wcl.endTime] : [])];
  const startMs = Math.min(...starts);
  return {
    key: [...files.map((f) => f.path), wcl?.path ?? ''].join('|'),
    startMs,
    endMs: Math.max(...ends),
    files,
    wcl,
    bosses,
    dungeonBosses,
    missingPulls,
    missingMs,
    live: (wcl?.live ?? false) || files.some((f) => now - f.modifiedMs < LIVE_MS),
  };
}

