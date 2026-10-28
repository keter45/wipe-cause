// Golpes do boss e raide baixa, a partir das séries por segundo do núcleo (raidSeries, enemyHits).
// Não dependem da note: a note de CDs de cura (healNoteCheck.ts) usa os momentos daqui. Regras em
// docs/heal-cd-note.md; o limite do golpe é parâmetro da luta e pode ser calibrado nos nossos logs.

import type { Pull } from '../types';
import { anchorTimes } from './benchMetrics';
import { nearestAnchor, SAME_MOMENT_MS, type Anchors } from './cdAnchors';
import { quantile } from './quantile';

/** Golpe: dano inevitável em 5 s acima disso da vida máxima somada da raide sem tanks. */
export const STRONG_HIT_SHARE = 0.8;
/** Início do golpe: primeiro segundo com essa fração do dano da primeira janela forte. */
export const HIT_ONSET_SHARE = 0.2;
/** Raide baixa: um quarto ou mais dos vivos abaixo de 50%, por pelo menos 2 s. */
export const LOW_SHARE = 0.25;
export const LOW_MIN_S = 2;
const WINDOW_S = 5;
/** segundos fortes com até isso de buraco são o mesmo golpe */
const GAP_S = 4;
/** cast do boss que fez o golpe: até isso antes do início */
const OWN_CAST_MS = 15_000;

export interface Hit {
  /** ms do pull */
  start: number;
  end: number;
  /** maior dano em 5 s / vida máxima da raide */
  size: number;
  /** spell inimiga com mais dano no golpe */
  spellId: number | null;
  /** marco: `<spell>:<k>` (k-ésimo cast da spell no pull); null = sem marco */
  key: string | null;
}

const median = (xs: number[]) => quantile(xs, 0.5);

/** Golpes de um pull (`share`: o limite, trocado só pela calibração). Sem vida no log (`low` nulo), não há golpes. */
export function hits(pull: Pull, anchors: Anchors, share = STRONG_HIT_SHARE): Hit[] {
  const s = pull.raidSeries;
  if (!s || !s.low) return [];
  const n = s.unavoidableK.length;
  const W = (i: number) => s.unavoidableK.slice(i, i + WINDOW_S).reduce((a, b) => a + b, 0);
  const strong = (i: number) => s.maxHpK[i] > 0 && W(i) >= share * s.maxHpK[i];
  const groups: { first: number; last: number; size: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!strong(i)) continue;
    const size = W(i) / s.maxHpK[i];
    const g = groups[groups.length - 1];
    if (g && i - g.last <= GAP_S) {
      g.last = i;
      g.size = Math.max(g.size, size);
    } else groups.push({ first: i, last: i, size });
  }
  const raw: Hit[] = groups.map((g) => {
    const w0 = W(g.first);
    let j = g.first;
    while (j < g.last + WINDOW_S - 1 && s.unavoidableK[j] < HIT_ONSET_SHARE * w0) j++;
    const start = j * 1000;
    const end = (g.last + WINDOW_S) * 1000;
    const spellId = topSpell(pull, start, end);
    return { start, end, size: g.size, spellId, key: keyOf(spellId, start, anchors) };
  });
  // golpes colados viram um
  const merged: Hit[] = [];
  for (const h of raw) {
    const prev = merged[merged.length - 1];
    if (prev && h.start - prev.start < SAME_MOMENT_MS) {
      prev.end = h.end;
      prev.size = Math.max(prev.size, h.size);
    } else merged.push({ ...h });
  }
  // a mesma chave duas vezes no pull: fica no maior
  const byKey = new Map<string, Hit>();
  for (const h of merged) {
    if (!h.key) continue;
    const other = byKey.get(h.key);
    if (!other) byKey.set(h.key, h);
    else if (h.size > other.size) {
      other.key = null;
      byKey.set(h.key, h);
    } else h.key = null;
  }
  return merged;
}

function topSpell(pull: Pull, start: number, end: number): number | null {
  const by = new Map<number, number>();
  for (const [sec, spell, dmg] of pull.enemyHits ?? []) if (sec * 1000 >= start && sec * 1000 < end) by.set(spell, (by.get(spell) ?? 0) + dmg);
  let best: number | null = null;
  for (const [spell, dmg] of by) if (best == null || dmg > by.get(best)!) best = spell;
  return best;
}

function keyOf(spellId: number | null, start: number, anchors: Anchors): string | null {
  // o cast da própria spell que fez o golpe, se ela é um marco da noite
  const own = spellId != null ? anchors[String(spellId)] : undefined;
  if (own) {
    let k = -1;
    own.forEach((t, i) => {
      if (t <= start && start - t <= OWN_CAST_MS && (k < 0 || t > own[k])) k = i;
    });
    if (k >= 0) return `${spellId}:${k + 1}`;
  }
  const a = nearestAnchor(start, anchors);
  return a ? `${a.anchor}:${a.k}` : null;
}

/** Fase (chave) em que um instante cai no pull. */
function phaseAt(pull: Pull, t: number): string {
  const marks = [...(pull.phaseMarks ?? [])].sort((a, b) => a.t - b.t);
  return marks.filter((m) => m.t <= t).pop()?.key ?? 'p1';
}

/**
 * Marcos da noite: as spells inimigas que `anchorTimes` aceita na maioria dos pulls que chegaram
 * na fase em que a spell é castada (assim as skills do P2 e do P3 não somem na progressão).
 */
export function nightAnchors(pulls: Pull[]): Map<number, Anchors> {
  const accepted = new Map<number, number>(); // spell -> pulls em que é marco
  const phaseOf = new Map<number, string>(); // spell -> fase do primeiro cast visto
  for (const p of pulls) {
    for (const [spell, a] of anchorTimes(p)) {
      accepted.set(spell, (accepted.get(spell) ?? 0) + 1);
      if (!phaseOf.has(spell)) phaseOf.set(spell, phaseAt(p, a.times[0]));
    }
  }
  const reached = (key: string) => pulls.filter((p) => key === 'p1' || (p.phaseMarks ?? []).some((m) => m.key === key)).length;
  const keep = new Set([...accepted].filter(([spell, n]) => n * 2 > reached(phaseOf.get(spell) ?? 'p1')).map(([spell]) => spell));
  const out = new Map<number, Anchors>();
  for (const p of pulls) {
    const a: Anchors = {};
    for (const [spell, v] of anchorTimes(p)) if (keep.has(spell)) a[String(spell)] = v.times;
    out.set(p.id, a);
  }
  return out;
}

export interface MomentInPull {
  /** ms do pull */
  at: number;
  end: number;
  /** o golpe passou do limite neste pull */
  hit: boolean;
  size: number | null;
}

export interface Moment {
  key: string;
  /** spell do marco e qual cast dela */
  anchorSpell: number;
  k: number;
  /** spell inimiga que mais fez dano no golpe */
  spellId: number | null;
  /** fase (chave da regra) em que o momento cai na maioria dos pulls */
  phaseKey: string;
  /** mediana de (início do golpe − início da fase), no relógio do app */
  inPhaseMs: number;
  /** pulls que chegaram no marco */
  pulls: Map<number, MomentInPull>;
  withHit: number;
  medianSize: number | null;
}

/** Momentos da noite: chaves que foram golpe em pelo menos 2 pulls (ou no único que chegou nelas). */
export function moments(pulls: Pull[], anchors: Map<number, Anchors>, hitsByPull: Map<number, Hit[]>): Moment[] {
  const keys = new Set<string>();
  for (const hs of hitsByPull.values()) for (const h of hs) if (h.key) keys.add(h.key);
  const out: Moment[] = [];
  for (const key of keys) {
    const [spell, kStr] = key.split(':');
    const k = Number(kStr);
    const castOf = (p: Pull) => anchors.get(p.id)?.[spell]?.[k - 1];
    const reached = pulls.filter((p) => castOf(p) != null);
    const withHit = reached.map((p) => ({ p, h: hitsByPull.get(p.id)?.find((x) => x.key === key) })).filter((x) => x.h);
    if (withHit.length < Math.min(2, reached.length) || !withHit.length) continue;
    const offset = median(withHit.map(({ p, h }) => h!.start - castOf(p)!)) ?? 0;
    const phaseVotes = new Map<string, number>();
    for (const { p, h } of withHit) {
      const ph = phaseAt(p, h!.start);
      phaseVotes.set(ph, (phaseVotes.get(ph) ?? 0) + 1);
    }
    const phaseKey = [...phaseVotes].sort((a, b) => b[1] - a[1])[0][0];
    const startOf = (p: Pull) => (p.phaseMarks ?? []).find((m) => m.key === phaseKey)?.t ?? 0;
    const inPhase = median(withHit.filter(({ p, h }) => phaseAt(p, h!.start) === phaseKey).map(({ p, h }) => h!.start - startOf(p))) ?? 0;
    const per = new Map<number, MomentInPull>();
    for (const p of reached) {
      const h = hitsByPull.get(p.id)?.find((x) => x.key === key);
      const at = h ? h.start : castOf(p)! + offset;
      per.set(p.id, { at, end: h ? h.end : at + WINDOW_S * 1000, hit: !!h, size: h?.size ?? null });
    }
    const spells = withHit.map(({ h }) => h!.spellId);
    const spellId = spells.sort((a, b) => spells.filter((x) => x === b).length - spells.filter((x) => x === a).length)[0] ?? null;
    out.push({
      key,
      anchorSpell: Number(spell),
      k,
      spellId,
      phaseKey,
      inPhaseMs: inPhase,
      pulls: per,
      withHit: withHit.length,
      medianSize: median(withHit.map(({ h }) => h!.size)),
    });
  }
  return out.sort((a, b) => a.inPhaseMs - b.inPhaseMs);
}

/** Episódios de raide baixa (ms do pull): um quarto ou mais dos vivos abaixo de 50% por 2 s ou mais. */
export function raidLow(pull: Pull): { start: number; end: number }[] {
  const s = pull.raidSeries;
  if (!s?.low) return [];
  const out: { start: number; end: number }[] = [];
  let from = -1;
  for (let i = 0; i <= s.alive.length; i++) {
    const on = i < s.alive.length && s.alive[i] > 0 && s.low[i] >= LOW_SHARE * s.alive[i];
    if (on && from < 0) from = i;
    if (!on && from >= 0) {
      if (i - from >= LOW_MIN_S) out.push({ start: from * 1000, end: i * 1000 });
      from = -1;
    }
  }
  return out;
}
