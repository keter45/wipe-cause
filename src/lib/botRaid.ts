// O robô para a raide toda: simula em fila cada DPS e tank do boss na noite e lê o % do potencial
// das simulações salvas (para o resumo do boss e a aba Jogadores).

import { useEffect, useState } from 'react';
import type { Pull } from '../types';
import { simcCancel } from './api';
import { botMe, loadBotRun, runBot, type BotRun, type BotStep } from './botSim';
import { potential } from './botView';
import { bossKey } from './night';

const ROLE_ORDER: Record<string, number> = { dps: 0, tank: 1 };

/** Quem dá para simular no boss: DPS e tanks com setup no log, DPS primeiro. */
export function raidCandidates(pulls: Pull[], ref: Pull): string[] {
  const seen = new Map<string, string>();
  for (const p of pulls) {
    if (bossKey(p) !== bossKey(ref)) continue;
    for (const pl of p.players) if (pl.role && pl.role !== 'healer' && pl.setup && pl.specId != null) seen.set(pl.name, pl.role);
  }
  return [...seen].sort((a, b) => (ROLE_ORDER[a[1]] ?? 2) - (ROLE_ORDER[b[1]] ?? 2) || a[0].localeCompare(b[0])).map(([n]) => n);
}

export interface RaidPotential {
  name: string;
  pct: number;
  run: BotRun;
}

/** O % do potencial de quem já tem simulação salva deste boss na noite. */
export async function loadPotentials(pulls: Pull[], ref: Pull, names: string[]): Promise<RaidPotential[]> {
  const out: RaidPotential[] = [];
  for (const name of names) {
    const run = await loadBotRun(ref, name);
    const me = run && botMe(pulls, run, name);
    const p = me && potential(me, run);
    if (run && p) out.push({ name, pct: p.pct, run });
  }
  return out;
}

/** % do potencial por nome (vazio enquanto carrega ou sem simulações); `version` recarrega. */
export function usePotentials(pulls: Pull[], ref: Pull | null, version = 0): Map<string, number> {
  const [map, setMap] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!ref) return;
    let alive = true;
    loadPotentials(pulls, ref, raidCandidates(pulls, ref))
      .then((list) => alive && setMap(new Map(list.map((x) => [x.name, x.pct]))))
      .catch(() => alive && setMap(new Map()));
    return () => {
      alive = false;
    };
  }, [pulls, ref, version]);
  return map;
}

export interface RaidProgress {
  index: number;
  total: number;
  name: string;
  step: BotStep;
}

/**
 * Simula em fila. Um player que falha (sem pull que preste, erro do SimC) não para a fila; `stop`
 * cancela a simulação em andamento e o resto. `onDone` a cada player pronto (a tela atualiza).
 */
export async function simulateRaid(
  pulls: Pull[],
  ref: Pull,
  names: string[],
  onProgress: (p: RaidProgress) => void,
  stop: () => boolean,
  onDone?: (name: string) => void,
): Promise<{ done: string[]; failed: { name: string; error: string }[] }> {
  const done: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const [index, name] of names.entries()) {
    if (stop()) break;
    try {
      await runBot(pulls, ref, name, (step) => {
        onProgress({ index, total: names.length, name, step });
        if (stop()) void simcCancel();
      });
      done.push(name);
      onDone?.(name);
    } catch (e) {
      if (stop()) break;
      failed.push({ name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { done, failed };
}
