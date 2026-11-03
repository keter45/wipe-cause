// Timeline dos CDs de cura: usos (com ou sem note), buracos de cura e as contas da noite. Reusa os
// golpes, janelas e a régua de overheal de raidHits.ts e healNoteCheck.ts. Regras em
// docs/designs/heal-cd-timeline.md.

import type { Anchors } from './cdAnchors';
import type { HealCd } from './healCooldowns';
import { castIdsOf, healCd, healCooldowns } from './healCooldowns';
import type { ParsedNote } from './healNote';
import type { LineCheck, LineState, PullVerdicts, RefsOf, UseOverheal, UseVerdict } from './healNoteCheck';
import {
  castTimes,
  momentOf,
  noDamageWindow,
  overlaps,
  overhealOfUse,
  PREP_MS,
  RECOVER_MS,
  refOverheal,
  withRef,
} from './healNoteCheck';
import type { Hit, Moment } from './raidHits';
import { GAP_SHARE, highDamage, keyOf, raidLow, topSpell, trailingShare } from './raidHits';
import type { PlayerStats, Pull } from '../types';

export { GAP_SHARE };
/** Dois ou mais players abaixo de 50% no mesmo segundo: evidência de buraco. */
export const EVIDENCE_LOW = 2;
/** Duração mínima de um buraco, em segundos. */
export const GAP_MIN_S = 3;
/** Falha que ainda junta dois trechos de buraco, em segundos. */
export const GAP_JOIN_S = 1;

export interface CdUse {
  pullId: number;
  player: PlayerStats;
  cd: HealCd;
  /** ms do pull (cast) */
  at: number;
  /** at + duration_ms (a barra) */
  end: number;
  /** noDamageWindow (veredictos e cobertura) */
  window: [number, number];
  momentKey: string | null;
  noDamage: boolean;
  overheal: UseOverheal | null;
  stacked: boolean;
  cycle: boolean;
  /** só com note */
  onHit: boolean | null;
  /** linha casada, com note */
  line?: LineCheck;
}

export interface NoteMark {
  lineIndex: number;
  guid: string;
  /** expectedMs */
  at: number;
  state: LineState;
  cycle: boolean;
  /** spellId da linha da note */
  spellId: number | null;
  /** usedMs do uso casado */
  useAt?: number;
  /** uso − hora ajustada */
  deltaMs?: number;
}

export interface Gap {
  /** ms desde o início do pull */
  start: number;
  end: number;
  /** maior Wt/V do trecho */
  peak: number;
  /** `${spellId}:${k}`, null sem marco */
  key: string | null;
  /** cruza um golpe do pull */
  hit: boolean;
  /** morte não ignorada ou raide baixa */
  evidence: boolean;
  free: { player: PlayerStats; cd: HealCd }[];
}

export interface GapOpts {
  share: number;
  minS: number;
  joinS: number;
}

export interface NightGap {
  key: string;
  spellId: number;
  k: number;
  pulls: Set<number>;
  reached: number;
}

const PLANNED: LineState[] = ['on_time', 'early', 'late', 'not_used', 'dead'];

/** Usos de CD do pull, pelos casts da tabela; com note, `withNote` troca pelos veredictos da linha. */
export function uses(pull: Pull, ms: Moment[], hits: Hit[], refsOf: RefsOf, cycleRule = true): CdUse[] {
  const low = raidLow(pull);
  const out: CdUse[] = [];
  const all = ms.filter((m) => m.pulls.has(pull.id));
  for (const player of pull.players) {
    for (const cast of player.casts ?? []) {
      const cd = healCd(cast.spellId);
      if (!cd?.kind || !cd.effect || cd.duration_ms == null) continue;
      for (const at of cast.times) {
        const d = cd.duration_ms;
        const window = noDamageWindow(cd.effect, at, d);
        const momentKey = momentOf(cd, at, pull.id, ms)?.key ?? null;
        let noDamage = false;
        if (cd.kind === 'heal')
          noDamage =
            !hits.some((h) => overlaps(h.start, h.end, window[0], window[1])) &&
            !low.some((e) => overlaps(e.start, e.end, window[0], window[1])) &&
            !highDamage(pull, window[0], window[1]);
        const amounts = overhealOfUse(player, cd, at);
        const overheal = amounts ? withRef(amounts, refOverheal(refsOf(pull, player), cd)) : null;
        out.push({ pullId: pull.id, player, cd, at, end: at + d, window, momentKey, noDamage, overheal, stacked: false, cycle: false, onHit: null });
      }
    }
  }
  out.sort((a, b) => a.at - b.at);
  // empilhado: curas com heal_ids no mesmo momento; o rótulo vai em quem tem overheal alto
  const byMoment = new Map<string, CdUse[]>();
  for (const u of out) if (u.momentKey && u.overheal) (byMoment.get(u.momentKey) ?? byMoment.set(u.momentKey, []).get(u.momentKey)!).push(u);
  for (const group of byMoment.values()) if (group.length >= 2) for (const u of group) u.stacked = u.overheal!.high;
  // ciclo provável: gasto cedo para o próximo uso estar pronto num momento
  if (cycleRule) {
    const byPlayerCd = new Map<string, CdUse[]>();
    for (const u of out) {
      const k = `${u.player.guid}:${u.cd.id}`;
      (byPlayerCd.get(k) ?? byPlayerCd.set(k, []).get(k)!).push(u);
    }
    for (const group of byPlayerCd.values()) {
      for (const u of group) {
        if (!u.noDamage || u.cd.cooldown_ms == null) continue;
        const next = group.find((v) => v.at > u.at);
        if (!next || next.momentKey == null) continue;
        const m = all.filter((mm) => mm.pulls.get(pull.id)!.at > u.at).sort((a, b) => a.pulls.get(pull.id)!.at - b.pulls.get(pull.id)!.at)[0];
        if (!m) continue;
        const moved = m.pulls.get(pull.id)!.at - (u.cd.effect === 'burst' ? 0 : PREP_MS);
        if (next.at - moved < u.cd.cooldown_ms) {
          u.cycle = true;
          u.noDamage = false;
        }
      }
    }
  }
  return out;
}

/** Usos com os veredictos da note por cima e as marcas das linhas; cast sem linha mantém os usos. */
export function withNote(_pull: Pull, uses: CdUse[], note: ParsedNote, checks: LineCheck[], verdicts: PullVerdicts | null): { uses: CdUse[]; marks: NoteMark[] } {
  const out = uses.map((u) => ({ ...u }));
  const planned = checks.filter((c) => PLANNED.includes(c.state));
  const marks: NoteMark[] = planned.flatMap((c) => {
    if (c.guid == null || c.expectedMs == null) return [];
    return [{ lineIndex: c.lineIndex, guid: c.guid, at: c.expectedMs, state: c.state, cycle: verdicts?.lines.get(c.lineIndex)?.cycle ?? false, spellId: note.lines[c.lineIndex]?.spellId ?? null, useAt: c.usedMs, deltaMs: c.deltaMs }];
  });
  for (const u of out) {
    const c = planned.find((x) => {
      const line = note.lines[x.lineIndex];
      return x.guid === u.player.guid && x.usedMs === u.at && line?.spellId != null && castIdsOf(line.spellId).includes(u.cd.id);
    });
    if (!c) continue;
    u.line = c;
    const v: UseVerdict | undefined = verdicts?.lines.get(c.lineIndex);
    if (!v) continue;
    u.momentKey = v.momentKey;
    u.onHit = v.onHit;
    u.noDamage = v.noDamage;
    u.cycle = v.cycle;
    u.overheal = v.overheal;
    u.stacked = v.stacked;
  }
  return { uses: out, marks };
}

/** Buracos do pull: dano alto ou raide baixa sem nenhum uso ativo, juntando falhas curtas. */
export function gaps(pull: Pull, uses: CdUse[], anchors: Anchors, hits: Hit[], usedInNight: Set<string>, opts: Partial<GapOpts> = {}): Gap[] {
  const s = pull.raidSeries;
  if (!s || !s.low) return [];
  const lows = s.low;
  const share = opts.share ?? GAP_SHARE;
  const minS = opts.minS ?? GAP_MIN_S;
  const joinS = opts.joinS ?? GAP_JOIN_S;
  const low = raidLow(pull);
  const n = s.unavoidableK.length;
  const buraco: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const at = i * 1000;
    const forte = s.maxHpK[i] > 0 && trailingShare(pull, i) >= share;
    const baixa = low.some((e) => at >= e.start && at < e.end);
    const coberto = uses.some((u) => overlaps(u.window[0], u.window[1], at, at + 999));
    buraco.push((forte || baixa) && !coberto);
  }
  const out: Gap[] = [];
  let i0 = -1;
  let i1 = -1;
  const flush = () => {
    if (i0 < 0) return;
    if (i1 - i0 + 1 >= minS) {
      const start = i0 * 1000;
      const end = (i1 + 1) * 1000;
      let peak = 0;
      for (let i = i0; i <= i1; i++) peak = Math.max(peak, trailingShare(pull, i));
      const free: { player: PlayerStats; cd: HealCd }[] = [];
      for (const player of pull.players) {
        for (const cd of healCooldowns()) {
          if (!cd.kind || cd.cooldown_ms == null || !usedInNight.has(`${player.guid}:${cd.id}`)) continue;
          const before = castTimes(player, cd.id).filter((t) => t < start);
          const last = before.length ? Math.max(...before) : null;
          if (last == null || start - last > cd.cooldown_ms) free.push({ player, cd });
        }
      }
      out.push({
        start,
        end,
        peak,
        key: keyOf(topSpell(pull, start, end), start, anchors),
        hit: hits.some((h) => overlaps(h.start, h.end, start, end)),
        evidence:
          pull.deaths.some((d) => !d.ignored && d.t >= start && d.t <= end + RECOVER_MS) ||
          lows.some((n, i) => n >= EVIDENCE_LOW && i * 1000 >= start && i * 1000 + 999 <= end + RECOVER_MS),
        free,
      });
    }
    i0 = -1;
    i1 = -1;
  };
  for (let i = 0; i < n; i++) {
    if (!buraco[i]) continue;
    if (i0 < 0) {
      i0 = i;
      i1 = i;
    } else if (i - i1 - 1 <= joinS) i1 = i;
    else {
      flush();
      i0 = i;
      i1 = i;
    }
  }
  flush();
  return out;
}

/** Chaves de buraco que se repetem na noite (2+ pulls) e quantos pulls chegaram no golpe. */
export function nightGaps(pulls: Pull[], anchors: Map<number, Anchors>, gapsByPull: Map<number, Gap[]>): NightGap[] {
  const byKey = new Map<string, Set<number>>();
  for (const [pullId, gs] of gapsByPull)
    for (const g of gs) if (g.key) (byKey.get(g.key) ?? byKey.set(g.key, new Set()).get(g.key)!).add(pullId);
  const out: NightGap[] = [];
  for (const [key, ids] of byKey) {
    if (ids.size < 2) continue;
    const [spell, kStr] = key.split(':');
    const k = Number(kStr);
    const reached = pulls.filter((p) => anchors.get(p.id)?.[spell]?.[k - 1] != null).length;
    out.push({ key, spellId: Number(spell), k, pulls: ids, reached });
  }
  return out;
}

/** Sub-faixa de cada barra: a primeira livre do player (barras sobrepostas não se cobrem). */
export function stackLanes(uses: CdUse[]): Map<CdUse, number> {
  const out = new Map<CdUse, number>();
  const byPlayer = new Map<string, CdUse[]>();
  for (const u of uses) (byPlayer.get(u.player.guid) ?? byPlayer.set(u.player.guid, []).get(u.player.guid)!).push(u);
  for (const list of byPlayer.values()) {
    const laneEnds: number[] = [];
    for (const u of [...list].sort((a, b) => a.at - b.at)) {
      const start = u.at;
      const end = Math.max(u.end, u.at + 1);
      let lane = laneEnds.findIndex((e) => e <= start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else laneEnds[lane] = end;
      out.set(u, lane);
    }
  }
  return out;
}

/** Pull padrão da noite: mais fases, menor vida da fase, o mais longo e o mais recente. */
export function defaultPull(pulls: Pull[]): Pull {
  return [...pulls].sort(
    (a, b) =>
      (b.phaseMarks?.length ?? 0) - (a.phaseMarks?.length ?? 0) ||
      (a.phaseHpPct ?? Infinity) - (b.phaseHpPct ?? Infinity) ||
      b.durationMs - a.durationMs ||
      b.startMs - a.startMs,
  )[0];
}
