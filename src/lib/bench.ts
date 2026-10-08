// O pull do player comparado com os tops da mesma spec no mesmo boss (src/data/bench, gerado por
// scripts/rotation/bench.mjs a partir dos logs dos tops do Warcraft Logs).

import type { PlayerStats, Pull } from '../types';
import { ANCHOR_WINDOW_MS, EARLY_MS, anchorTimes, castMix, defensivesNear, firstUse, idleIn, potionTimes } from './benchMetrics';
import { isCombatPotion } from './performance';

interface Named {
  spellId: number;
  name: string;
}

export interface BossBench {
  name: string;
  n: number;
  downtimePct: number | null;
  cpm: number | null;
  checks: Record<string, number | null>;
  cooldowns: Record<string, { name: string; usage: number | null; first: number | null; early: number | null }>;
  mix: Record<string, { name: string; share: number | null }>;
  potion: { used: number; first: number | null; second: number | null };
  anchors: (Named & { k: number; t: number; idle: number; use: (Named & { share: number })[] })[];
  defensives: (Named & { share: number; spells: (Named & { share: number })[] })[];
}

interface SpecBench {
  spec: number;
  name: string;
  pulls: number;
  bosses: Record<string, BossBench>;
}

const files = import.meta.glob<SpecBench>('../data/bench/*.json', { eager: true, import: 'default' });
const bySpec = new Map(Object.values(files).map((b) => [b.spec, b]));

/** Referência dos tops da spec neste boss, se houver. */
export const benchFor = (specId: number | null | undefined, encounterId: number): BossBench | null =>
  (specId != null && bySpec.get(specId)?.bosses[String(encounterId)]) || null;

/** Diferença mínima na fatia de uma habilidade para valer a dica (pontos percentuais / 100). */
export const MIX_MIN_DIFF = 0.08;
/** Segundos a mais parado que os tops depois de uma mecânica para aparecer. */
export const WINDOW_MIN_EXTRA_MS = 2500;
/** Defensivo que os tops usam em pelo menos isso das vezes numa mecânica. */
export const DEF_SHOW_SHARE = 0.5;
/** Cooldown que os tops seguram: menos que isso deles usa nos primeiros 15s. */
const HELD_EARLY = 0.5;
/** Cooldown que os tops usam no pull: pelo menos isso deles. */
const PULL_EARLY = 0.8;

export interface BenchView {
  /** lutas dos tops neste boss */
  n: number;
  /** aproveitamento mediano dos tops em cada checagem da rotação (id do achado) */
  checks: Record<string, number>;
  /** uso mediano dos tops em cada cooldown (spellId) */
  cdUsage: Record<number, number>;
  /** habilidades com fatia bem diferente da dos tops (AoE x alvo único) */
  mix: (Named & { you: number; tops: number })[];
  /** cooldown que os tops seguram (e o player soltou no pull) ou que eles usam no pull (e o player não) */
  cooldowns: (Named & { kind: 'held' | 'pull'; tops: number | null; you: number | null })[];
  potion: { topsFirst: number | null; topsSecond: number | null; you: number[] } | null;
  /** mecânicas depois das quais o player ficou parado bem mais que os tops */
  windows: (Named & { k: number; t: number; you: number; tops: number; use: Named[] })[];
  /** mecânicas em que os tops usam defensivo, e quantas vezes o player usou */
  defensives: (Named & { share: number; spells: Named[]; used: number; of: number })[];
}

/** Até quando o player conta: a morte (se houve) ou o fim do tempo analisado. */
function aliveUntil(pull: Pull, p: PlayerStats): number {
  const d = pull.deaths.find((d) => d.guid === p.guid && !d.ignored);
  return Math.min(d ? d.t : Infinity, pull.analyzedMs);
}

/** O pull do player comparado com os tops do boss; null sem referência (spec ou boss sem dados). */
export function compareWithTops(pull: Pull, p: PlayerStats, b = benchFor(p.specId, pull.encounterId)): BenchView | null {
  const r = p.rotation;
  if (!r || !b) return null;

  const checks: Record<string, number> = {};
  for (const f of r.findings) if (b.checks[f.id] != null) checks[f.id] = b.checks[f.id]!;
  const cdUsage: Record<number, number> = {};
  for (const c of r.cooldowns) {
    const u = b.cooldowns[String(c.spellId)]?.usage;
    if (u != null) cdUsage[c.spellId] = u;
  }

  const mine = castMix(p, r);
  const mix = Object.entries(b.mix)
    .filter(([, m]) => m.share != null)
    .map(([id, m]) => ({ spellId: +id, name: m.name, you: mine.get(+id)?.share ?? 0, tops: m.share! }))
    .filter((m) => Math.abs(m.you - m.tops) >= MIX_MIN_DIFF)
    .sort((a, b) => Math.abs(b.you - b.tops) - Math.abs(a.you - a.tops));

  const cooldowns: BenchView['cooldowns'] = [];
  for (const c of r.cooldowns) {
    const t = b.cooldowns[String(c.spellId)];
    if (!t || t.early == null) continue;
    const you = firstUse(p, c.spellId);
    // segurado pelos tops: só vale apontar se o player soltou logo no pull
    if (t.early < HELD_EARLY && t.first != null && t.first > EARLY_MS && you != null && you <= EARLY_MS) cooldowns.push({ spellId: c.spellId, name: c.name, kind: 'held', tops: t.first, you });
    else if (t.early >= PULL_EARLY && (you == null || you > EARLY_MS)) cooldowns.push({ spellId: c.spellId, name: c.name, kind: 'pull', tops: t.first, you });
  }

  const potion = b.potion.used >= 0.5 && b.potion.first != null ? { topsFirst: b.potion.first, topsSecond: b.potion.second, you: potionTimes(p, isCombatPotion) } : null;

  const until = aliveUntil(pull, p);
  const anchors = anchorTimes(pull);
  const windows: BenchView['windows'] = [];
  for (const a of b.anchors) {
    const t = anchors.get(a.spellId)?.times[a.k];
    if (t == null || t + ANCHOR_WINDOW_MS > until) continue;
    const you = idleIn(r.idle, t, t + ANCHOR_WINDOW_MS);
    if (you - a.idle >= WINDOW_MIN_EXTRA_MS) windows.push({ spellId: a.spellId, name: anchors.get(a.spellId)!.name, k: a.k, t, you, tops: a.idle, use: a.use.filter((u) => u.share >= 0.5) });
  }
  windows.sort((x, y) => y.you - y.tops - (x.you - x.tops));
  // a mesma parada depois de duas mecânicas quase juntas aparece uma vez (a de maior diferença)
  const distinct = windows.filter((w, i) => !windows.slice(0, i).some((o) => Math.abs(o.t - w.t) < ANCHOR_WINDOW_MS));

  const defensives: BenchView['defensives'] = [];
  for (const d of b.defensives) {
    if (d.share < DEF_SHOW_SHARE) continue;
    const times = (anchors.get(d.spellId)?.times ?? []).filter((t) => t < until);
    if (!times.length) continue;
    defensives.push({
      spellId: d.spellId,
      name: anchors.get(d.spellId)!.name,
      share: d.share,
      spells: d.spells,
      used: times.filter((t) => defensivesNear(p, t).length > 0).length,
      of: times.length,
    });
  }

  return { n: b.n, checks, cdUsage, mix, cooldowns, potion, windows: distinct.slice(0, 5), defensives };
}
