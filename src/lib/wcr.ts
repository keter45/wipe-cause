import { createContext, useContext } from 'react';
import type { Pull } from '../types';
import type { WcrVideo } from './api';

/** O vídeo começa no ENCOUNTER_START; o `start` do Recorder é arredondado para o segundo. */
const MAX_START_DIFF_MS = 5_000;
/** Vídeos da nuvem vêm do PC de outra pessoa: o relógio dele pode estar alguns segundos fora. */
const MAX_CLOUD_DIFF_MS = 10_000;
/** Quanto antes do momento o vídeo começa a tocar. */
export const LEAD_MS = 5_000;

/**
 * Pontos de vista (POVs) de cada pull: o vídeo deste PC e os que a guilda subiu na nuvem do
 * Warcraft Recorder. Um por pessoa (o local vale mais que a cópia na nuvem), o local primeiro.
 */
export function matchVideos(pulls: Pull[], videos: WcrVideo[]): Map<number, WcrVideo[]> {
  const out = new Map<number, WcrVideo[]>();
  for (const p of pulls) {
    const povs: WcrVideo[] = [];
    // local primeiro: a mesma pessoa na nuvem é o mesmo vídeo
    const sorted = [...videos].sort((a, b) => Number(!!a.cloud) - Number(!!b.cloud) || Math.abs(a.startMs - p.startMs) - Math.abs(b.startMs - p.startMs));
    for (const v of sorted) {
      if (v.encounterId !== p.encounterId) continue;
      if (Math.abs(v.startMs - p.startMs) > (v.cloud ? MAX_CLOUD_DIFF_MS : MAX_START_DIFF_MS)) continue;
      if (povs.some((x) => x.player != null && x.player === v.player)) continue;
      povs.push(v);
    }
    if (povs.length) out.set(p.id, povs);
  }
  return out;
}

/** Pula o vídeo do pull para `t` (ms desde o início do pull). null = pull sem vídeo. */
export const SeekContext = createContext<((t: number) => void) | null>(null);
export const useSeek = () => useContext(SeekContext);
