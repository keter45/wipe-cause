import type { Pull } from '../types';
import type { WclFight } from './api';

/** Diferença máxima entre o início do pull no log e o da fight no WCL. */
const MAX_START_DIFF_MS = 15_000;

export function reportUrl(code: string, fightId?: number): string {
  const base = `https://www.warcraftlogs.com/reports/${code}`;
  return fightId != null ? `${base}#fight=${fightId}` : base;
}

/** Casa cada pull com a fight do WCL de mesmo encounter e início mais próximo. */
export function matchFights(pulls: Pull[], fights: WclFight[]): Map<number, number> {
  const out = new Map<number, number>();
  const used = new Set<number>();
  for (const p of pulls) {
    let best: WclFight | null = null;
    for (const f of fights) {
      if (f.encounterId !== p.encounterId || used.has(f.id)) continue;
      const diff = Math.abs(f.startMs - p.startMs);
      if (diff <= MAX_START_DIFF_MS && (!best || diff < Math.abs(best.startMs - p.startMs))) best = f;
    }
    if (best) {
      out.set(p.id, best.id);
      used.add(best.id);
    }
  }
  return out;
}
