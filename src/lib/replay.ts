// Replays: posições guardadas no pull (`Pull.tracks`, só nos trechos usados) e as contas do
// player de replay (posição num instante, stacks num instante).

import type { WorldMarker, SoakView, AreaView, BossCast, Death, LegacyPairReplay, MechanicResult, OrbTracks, Pull, PullGround, PullTracks, ReplayRef } from '../types';
import { arenaFor, facingToMap, toMap, type ArenaMap } from './arenas';

export interface ReplayUnit {
  guid: string;
  name: string;
  kind: 'player' | 'enemy' | 'ghost';
  /** [t, x, y] em ordem (jardas) */
  pts: [number, number, number][];
  /** fantasma: o player que ele persegue */
  owner?: string;
  /** fantasma: daqui em diante o caminho é estimado */
  estimatedFrom?: number;
  /** unidade de área: momentos (ms) em que o log mostrou onde ela estava */
  seen?: number[];
}

export type GroundKind = PullGround['kinds'][number];

/** Limites da câmera em jardas do mapa: x mínimo/máximo, y mínimo/máximo. */
export type ReplayBounds = [number, number, number, number];

export function coneDirection(facing: number | undefined, done: boolean, origin: [number, number], target: [number, number] | null): number | undefined {
  if (done && facing != null) return facing;
  return target ? Math.atan2(target[1] - origin[1], target[0] - origin[0]) : facing;
}

/** Acerto de mecânica "de chão": onde a vítima estava (jardas). */
export interface GroundMark {
  t: number;
  x: number;
  y: number;
  kind: number;
}

export interface ReplayData {
  /** guid -> unidade com as posições já em jardas */
  units: Map<string, ReplayUnit>;
  groundKinds: GroundKind[];
  /** em ordem de tempo */
  ground: GroundMark[];
  /** chão da arena (células de `cellYd`) */
  arena?: Pull['arena'];
  /** casts dos bosses, em ordem */
  casts: BossCast[];
  /** imagem e chão da arena (data/arenas.json), no mapa */
  map?: ArenaMap;
  /** soaks, no mapa */
  soaks: SoakView[];
  blasts?: NonNullable<Pull['blasts']>;
  /** marcas de chão do grupo, no mapa */
  markers: WorldMarker[];
  /** tempo de cast típico (ms) de cada spell dos inimigos */
  castMs?: Record<number, number>;
  /** replay completo: áreas das habilidades e orbs */
  areas: AreaView[];
  orbs?: OrbTracks;
}

/** npc id de um guid de criatura (Creature-0-...-<npc>-<spawn>). */
export const npcOf = (guid: string): number | null => {
  if (!guid.startsWith('Creature-') && !guid.startsWith('Vehicle-')) return null;
  const n = Number(guid.split('-').at(-2));
  return Number.isFinite(n) ? n : null;
};

/**
 * Posições e marcas no chão de um pull (vazio em relatórios antigos), já no mapa com o norte para cima
 * (ver `arenas.ts`): tudo o que o replay desenha passa por aqui.
 */
export function decodeReplay(pull: Pick<Pull, 'tracks' | 'ground' | 'arena' | 'casts' | 'areas' | 'orbs' | 'soaks' | 'blasts' | 'markers' | 'castMs'> & { encounterId?: number }): ReplayData {
  return {
    castMs: pull.castMs ?? {},
    markers: (pull.markers ?? []).map((m) => {
      const [x, y] = toMap(m.x, m.y);
      return { ...m, x, y };
    }),
    soaks: (pull.soaks ?? []).map((k) => {
      const [x, y] = toMap(k.x, k.y);
      return { ...k, x, y };
    }),
    areas: pull.areas ?? [],
    blasts: (pull.blasts ?? []).map((blast) => {
      const [x, y] = toMap(blast.x, blast.y);
      return { ...blast, x, y };
    }),
    orbs: pull.orbs && { ...pull.orbs, ground: pull.orbs.ground.map(([from, to, x, y, k]) => [from, to, -y, x, k]) },
    // células do chão: a de (c, l) cobre x em [c, c+1) e y em [l, l+1) (vezes o lado); no mapa, (-l-1, c)
    arena: pull.arena && { ...pull.arena, cells: pull.arena.cells.map(([c, l]) => [-l - 1, c]) },
    map: pull.encounterId != null ? arenaFor(pull.encounterId) : undefined,
    casts: [...(pull.casts ?? [])].map((c) => (c.facing != null ? { ...c, facing: facingToMap(c.facing) } : c)).sort((a, b) => a.t - b.t),
    units: decodeTracks(pull.tracks),
    groundKinds: pull.ground?.kinds ?? [],
    ground: (pull.ground?.marks ?? []).map(([t, x, y, kind]) => ({ t, x: -y / 10, y: x / 10, kind })).sort((a, b) => a.t - b.t),
  };
}

function decodeTracks(tracks: PullTracks | undefined | null): Map<string, ReplayUnit> {
  const out = new Map<string, ReplayUnit>();
  if (!tracks) return out;
  for (const u of tracks.units) {
    const pts: [number, number, number][] = [];
    for (const s of u.segs) {
      for (let i = 0; i + 1 < s.xy.length; i += 2) pts.push([s.t0 + (i / 2) * tracks.stepMs, ...toMap(s.xy[i] / 10, s.xy[i + 1] / 10)]);
    }
    out.set(u.guid, { guid: u.guid, name: u.name, kind: u.kind, pts, owner: u.owner, estimatedFrom: u.estimatedFrom, seen: u.seen?.map((s) => s * tracks.stepMs) });
  }
  return out;
}

export const isLegacyReplay = (r: ReplayRef | LegacyPairReplay): r is LegacyPairReplay => 'tracks' in r;

/** Replay do Helical Toxins gravado pela v0.21.0 (posições dentro dele) no formato novo. */
export function fromLegacy(r: LegacyPairReplay, t: number): { data: ReplayData; replay: ReplayRef } {
  const units = new Map<string, ReplayUnit>();
  for (const tr of r.tracks) units.set(tr.guid, { guid: tr.guid, name: tr.name, kind: 'player', pts: tr.pts.map(([t, x, y]) => [t, ...toMap(x, y)]) });
  for (const e of r.enemies) units.set(e.guid, { guid: e.guid, name: e.name, kind: 'enemy', pts: [[r.from, ...toMap(e.x, e.y)], [r.to, ...toMap(e.x, e.y)]] });
  return {
    data: { units, groundKinds: [], ground: [], casts: [], areas: [], soaks: [], markers: [] },
    replay: {
      t,
      from: r.from,
      to: r.to,
      focus: r.tracks.filter((x) => x.focus).map((x) => x.guid),
      stacks: r.tracks.map((x) => ({ guid: x.guid, pts: x.stacks })),
    },
  };
}

/**
 * Posição em `t`, em linha reta entre as amostras. Antes da primeira: nada (ainda não apareceu);
 * depois da última: a última para players (corpo), nada para inimigos (morreu) e fantasmas (sumiu).
 */
export function posAt(u: ReplayUnit, t: number, slackMs = 300): [number, number] | null {
  const p = u.pts;
  if (p.length === 0 || t < p[0][0] - slackMs) return null;
  if (t <= p[0][0]) return [p[0][1], p[0][2]];
  const last = p[p.length - 1];
  if (t >= last[0]) return u.kind !== 'player' && t > last[0] + slackMs ? null : [last[1], last[2]];
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const [t0, x0, y0] = p[lo];
  const [t1, x1, y1] = p[hi];
  const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
}

/** Jardas que a unidade andou do começo do caminho até `t`. */
export function movedUntil(u: ReplayUnit, t: number): number {
  let d = 0;
  const p = u.pts;
  for (let i = 1; i < p.length && p[i - 1][0] < t; i++) {
    const k = p[i][0] <= t ? 1 : (t - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
    d += Math.hypot(p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]) * k;
  }
  return d;
}

/** Valor da série [t, v] em `t` (o último até ali), ou null antes do primeiro. */
export function valueAt(pts: [number, number][] | undefined, t: number): number | null {
  if (!pts) return null;
  let v: number | null = null;
  for (const [st, n] of pts) {
    if (st > t) break;
    v = n;
  }
  return v;
}

/** Golpe tomado por quem o replay acompanha (morte). */
export interface ReplayHit {
  t: number;
  spellId: number;
  name: string;
  amount: number;
  /** da mecânica que causou a morte */
  cause: boolean;
  /** grande o bastante para aparecer no mapa */
  big: boolean;
}

/** Golpe a partir deste tanto da vida máxima aparece no replay da morte (os menores ficam só na vida). */
const BIG_HIT_SHARE = 0.05;

/** Golpes e vida do morto ao longo do replay, a partir do recap da morte. */
export function deathReplayExtras(death: Death): { hits: ReplayHit[]; hp: [number, number][] } {
  const max = death.stats.maxHp ?? 0;
  const causeKey = death.causedBy?.key ?? death.killingBlow?.mechanic ?? null;
  const hits = death.recap
    .filter((e) => e.kind === 'damage' && e.amount + e.absorbed > 0)
    .map((e) => {
      const amount = e.amount + e.absorbed;
      const cause = (causeKey != null && e.mechanic === causeKey) || (death.killingBlow != null && e.spellId === death.killingBlow.spellId);
      return { t: e.t, spellId: e.spellId, name: e.spellName, amount, cause, big: max > 0 ? amount >= max * BIG_HIT_SHARE : true };
    })
    .sort((a, b) => a.t - b.t);
  const hp = death.recap
    .filter((e) => e.hpPct != null)
    .map((e) => [e.t, e.hpPct!] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  return { hits, hp };
}

/** O que acontece no momento de um replay de mecânica. */
export type MechanicMoment = 'touch' | 'hit' | 'failure';

/**
 * Replay de um player numa mecânica: o encontro do debuff de parear, o 1º acerto dele (culpa
 * individual) ou a falha coletiva em que ele é o culpado. `data` vem junto quando o replay é de um
 * relatório antigo (posições dentro dele).
 */
export function playerReplay(m: MechanicResult, guid: string): { replay: ReplayRef; moment: MechanicMoment; data?: ReplayData } | null {
  const touch = (m.pairings ?? []).find((f) => f.replay && f.members.some((x) => x.guid === guid) && (f.counted || f.culprit === guid));
  if (touch?.replay) {
    if (isLegacyReplay(touch.replay)) {
      const old = fromLegacy(touch.replay, touch.t);
      return { replay: old.replay, data: old.data, moment: 'touch' };
    }
    return { replay: touch.replay, moment: 'touch' };
  }
  const own = (m.replays ?? []).find((r) => r.focus.length === 1 && r.focus[0] === guid);
  if (own) return { replay: own, moment: m.kind === 'failure_event' ? 'failure' : 'hit' };
  const shared = (m.replays ?? []).find((r) => r.focus.includes(guid));
  return shared ? { replay: shared, moment: 'failure' } : null;
}
