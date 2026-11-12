// Linha do tempo do replay completo: o peso que o usuário deu a cada mecânica, os momentos principais
// do pull (os chips em cima da linha do tempo) e as mortes juntas numa bolha quando não cabem lado a lado.

import type { MechanicSeverity, Pull } from '../types';
import type { FightMarker, MechanicLane } from './fight';

/** Peso de uma mecânica na linha do tempo: as graves e gravíssimas aparecem; as leves ficam recolhidas. */
export type MechanicWeight = 'wipe' | 'major' | 'minor' | 'hidden';
export const WEIGHTS: readonly MechanicWeight[] = ['wipe', 'major', 'minor', 'hidden'];
/** Ordem por severidade: gravíssimo primeiro. */
export const WEIGHT_RANK: Record<MechanicWeight, number> = { wipe: 0, major: 1, minor: 2, hidden: 3 };

/** O peso que a regra do boss dá (sem escolha do usuário). Os orbs no chão (gráfico) contam como grave. */
export function defaultWeight(laneKey: string, severity: MechanicSeverity): MechanicWeight {
  if (laneKey === 'orbs') return 'major';
  return severity === 'none' ? 'minor' : severity;
}

/** Peso valendo: a escolha do usuário, ou o da regra. */
export function weightOf(laneKey: string, severity: MechanicSeverity, overrides: Record<string, MechanicWeight>): MechanicWeight {
  return overrides[laneKey] ?? defaultWeight(laneKey, severity);
}

/** Aparece em destaque (faixa à vista, falha na faixa das falhas, momento nos chips). */
export const isPrimary = (w: MechanicWeight) => w === 'wipe' || w === 'major';

export interface WeightedLane extends MechanicLane {
  weight: MechanicWeight;
}

/** Faixas com o peso valendo, por severidade (gravíssimo primeiro) e, dentro do peso, por falhas. */
export function weighLanes(lanes: MechanicLane[], overrides: Record<string, MechanicWeight>): WeightedLane[] {
  return lanes
    .map((l) => ({ ...l, weight: weightOf(l.key, l.severity, overrides) }))
    .sort((a, b) => WEIGHT_RANK[a.weight] - WEIGHT_RANK[b.weight] || b.failures - a.failures);
}

/** Janela do pico de erros (ms) e quantos erros fazem um pico. */
export const PEAK_WINDOW_MS = 5_000;
export const PEAK_MIN = 3;

export type MomentKind = 'firstFail' | 'firstDeath' | 'peak' | 'wipeCall' | 'cutoff';

export interface Moment {
  kind: MomentKind;
  t: number;
  /** fim do trecho (pico) */
  end?: number;
  /** erros no pico */
  count?: number;
  guid?: string;
  spellId?: number | null;
  /** mecânica (primeiro erro) ou quem morreu (primeira morte) */
  label?: string;
}

/**
 * Os momentos principais do pull, em ordem: o primeiro erro grave, a primeira morte, o pico de erros
 * graves (a janela de `PEAK_WINDOW_MS` com mais erros, se tiver pelo menos `PEAK_MIN`) e a call de
 * wipe (ou o corte da análise).
 */
export function fightMoments(pull: Pull, lanes: WeightedLane[]): Moment[] {
  const out: Moment[] = [];
  const fails = lanes
    .filter((l) => l.key !== 'orbs' && isPrimary(l.weight))
    .flatMap((l) => l.marks.filter((m) => !m.ok).map((m) => ({ t: m.t, guid: m.guid, spellId: l.spellId, label: l.name })))
    .sort((a, b) => a.t - b.t);
  if (fails.length) out.push({ kind: 'firstFail', ...fails[0] });
  const death = pull.deaths.filter((d) => !d.ignored).sort((a, b) => a.t - b.t)[0];
  if (death) out.push({ kind: 'firstDeath', t: death.t, guid: death.guid, label: death.name });
  // pico: janela que começa em cada erro, a que pega mais erros (a primeira, no empate)
  let best: { t: number; end: number; count: number } | null = null;
  for (let i = 0, j = 0; i < fails.length; i++) {
    while (j < fails.length && fails[j].t - fails[i].t <= PEAK_WINDOW_MS) j++;
    const count = j - i;
    if (count >= PEAK_MIN && (!best || count > best.count)) best = { t: fails[i].t, end: fails[j - 1].t, count };
  }
  if (best) out.push({ kind: 'peak', ...best });
  if (pull.wipeCall) out.push({ kind: 'wipeCall', t: pull.wipeCall.t });
  else if (pull.cutoffT != null) out.push({ kind: 'cutoff', t: pull.cutoffT });
  return out.sort((a, b) => a.t - b.t);
}

/** Bolha de mortes: as que ficariam a menos de `minPx` uma da outra na largura da faixa. */
export interface DeathCluster {
  t: number;
  end: number;
  deaths: FightMarker[];
}

/** Junta as mortes (em ordem de tempo) que ficariam coladas: `msPerPx` é a escala da faixa agora. */
export function clusterDeaths(deaths: FightMarker[], msPerPx: number, minPx = 14): DeathCluster[] {
  const out: DeathCluster[] = [];
  for (const d of [...deaths].sort((a, b) => a.t - b.t)) {
    const last = out[out.length - 1];
    if (last && (d.t - last.end) / Math.max(1e-9, msPerPx) < minPx) {
      last.deaths.push(d);
      last.end = d.t;
    } else out.push({ t: d.t, end: d.t, deaths: [d] });
  }
  return out;
}
