import { createContext, useContext } from 'react';
import type { Pull } from '../types';
import type { WcrVideo } from './api';

/** O vídeo começa no ENCOUNTER_START; o `start` do Recorder é arredondado para o segundo. */
const MAX_START_DIFF_MS = 5_000;
/** Quanto antes do momento o vídeo começa a tocar. */
export const LEAD_MS = 5_000;

export function matchVideos(pulls: Pull[], videos: WcrVideo[]): Map<number, WcrVideo> {
  const out = new Map<number, WcrVideo>();
  for (const p of pulls) {
    let best: WcrVideo | null = null;
    for (const v of videos) {
      if (v.encounterId !== p.encounterId) continue;
      const diff = Math.abs(v.startMs - p.startMs);
      if (diff <= MAX_START_DIFF_MS && (!best || diff < Math.abs(best.startMs - p.startMs))) best = v;
    }
    if (best) out.set(p.id, best);
  }
  return out;
}

/** Pula o vídeo do pull para `t` (ms desde o início do pull). null = pull sem vídeo. */
export const SeekContext = createContext<((t: number) => void) | null>(null);
export const useSeek = () => useContext(SeekContext);
