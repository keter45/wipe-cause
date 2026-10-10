// O contexto da luta na comparação com os tops: a rotação muda entre alvo único e AoE (e cada boss
// tem AoE em momentos diferentes), e alguns buffs e debuffs precisam ficar ativos o tempo todo. O
// mesmo código resume os tops (scripts/rotation/bench.mjs) e compara o pull do player no app. Só
// funções puras e imports de tipo (o script carrega este arquivo direto no Node).

import type { PlayerStats, Pull, RotationResult } from '../types';

/** Trecho da contagem de alvos do motor (TARGET_BUCKET_MS). */
export const TARGET_BUCKET_MS = 2000;
/** Alvos num trecho a partir disso = AoE; até ST_MAX = alvo único (2 alvos fica de fora: cleave). */
export const AOE_MIN = 3;
const ST_MAX = 1;
/** Casts mínimos num contexto para comparar a mistura dele. */
const CTX_MIN_CASTS = 20;
/** Diferença mínima na fatia de uma habilidade, além de sair da faixa dos tops. */
const CTX_MIN_DIFF = 0.1;
/** Aura que os tops mantêm: mediana e p10 do uptime acima disso. */
const KEPT_MEDIAN = 0.8;
const KEPT_P10 = 0.6;
/** Aura aplicada logo depois de um cast da rotação em pelo menos isso das vezes (mediana dos tops): o
 * player controla pela rotação. Equipamento, encantamento e buff de outro player ficam de fora. */
const KEPT_BY_ROTATION = 0.5;
/** A mistura só é comparada com o pull cobrindo pelo menos isso da duração típica dos tops (fases). */
const MIX_MIN_COVER = 0.6;
/** Uptime do player abaixo do p10 dos tops por pelo menos isso. */
const UPTIME_MARGIN = 0.1;
/** Pulls mínimos dos tops para cada referência. */
const MIN_REF = 6;

export type Ctx = 'st' | 'aoe';

const quant = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const round = (x: number) => Math.round(x * 1000) / 1000;

/** Até quando o player conta: a morte ou o fim do tempo analisado. */
const untilOf = (pull: Pull, p: PlayerStats) => Math.min(pull.deaths.find((d) => d.guid === p.guid && !d.ignored)?.t ?? Infinity, pull.analyzedMs);

/** Fatia de cada habilidade da rotação nos trechos de alvo único e de AoE (e quantos casts em cada). */
export function contextMix(pull: Pull, p: PlayerStats, r: RotationResult = p.rotation!): Record<Ctx, { n: number; share: Map<number, number> }> {
  const out = { st: { n: 0, share: new Map<number, number>() }, aoe: { n: 0, share: new Map<number, number>() } };
  const targets = r.targets ?? [];
  if (!targets.length) return out;
  const rot = new Set([...r.prioritySt, ...r.priorityAoe].map((x) => x.spellId));
  const until = untilOf(pull, p);
  for (const c of p.casts ?? []) {
    if (!rot.has(c.spellId)) continue;
    for (const t of c.times) {
      if (t > until) continue;
      const n = targets[Math.floor(t / TARGET_BUCKET_MS)] ?? 0;
      const ctx: Ctx | null = n >= AOE_MIN ? 'aoe' : n <= ST_MAX ? 'st' : null;
      if (!ctx) continue;
      out[ctx].n++;
      out[ctx].share.set(c.spellId, (out[ctx].share.get(c.spellId) ?? 0) + 1);
    }
  }
  for (const ctx of ['st', 'aoe'] as const) for (const [id, k] of out[ctx].share) out[ctx].share.set(id, k / out[ctx].n);
  return out;
}

/** Uptime de cada aura no pull: as mantidas (`uptimes`) e as curtas (pelos trechos ativos). */
export function uptimeOf(pull: Pull, p: PlayerStats, r: RotationResult = p.rotation!): Map<number, number> {
  const out = new Map<number, number>();
  for (const u of r.uptimes ?? []) out.set(u.id, u.uptime);
  const alive = Math.max(1, untilOf(pull, p));
  for (const b of r.buffs ?? []) if (!out.has(b.id)) out.set(b.id, Math.min(1, b.spans.reduce((s, [a, z]) => s + Math.min(z, alive) - Math.min(a, alive), 0) / alive));
  return out;
}

// ---------------------------------------------------------------- referência (nos tops)

export interface ContextRef {
  n: number;
  /** duração típica analisada dos tops (ms): a mistura muda com as fases, então pull curto não compara */
  ms: number;
  /** fatia de cada habilidade em cada contexto: mediana, p10 e p90 entre os pulls dos tops */
  mix: Record<Ctx, Record<string, { name: string; med: number; p10: number; p90: number }>>;
  /** auras que os tops mantêm o tempo todo */
  kept: Record<string, { name: string; kind: 'buff' | 'debuff'; med: number; p10: number }>;
}

/** Referência de contexto dos pulls dos tops (de um boss, ou da spec inteira). */
export function buildContextRef(samples: { pull: Pull; player: PlayerStats }[], name: (id: number, fallback: string) => string): ContextRef | null {
  const list = samples.filter((s) => s.player.rotation?.targets?.length);
  if (list.length < MIN_REF) return null;
  const ref: ContextRef = { n: list.length, ms: Math.round(quant(list.map((s) => untilOf(s.pull, s.player)), 0.5)), mix: { st: {}, aoe: {} }, kept: {} };
  const mixes = list.map((s) => contextMix(s.pull, s.player));
  const names = new Map<number, string>();
  for (const s of list) for (const c of s.player.casts ?? []) names.set(c.spellId, c.name);
  for (const ctx of ['st', 'aoe'] as const) {
    const have = mixes.filter((m) => m[ctx].n >= CTX_MIN_CASTS);
    if (have.length < MIN_REF) continue;
    const ids = new Set(have.flatMap((m) => [...m[ctx].share.keys()]));
    for (const id of ids) {
      const xs = have.map((m) => m[ctx].share.get(id) ?? 0);
      ref.mix[ctx][id] = { name: name(id, names.get(id) ?? `${id}`), med: round(quant(xs, 0.5)), p10: round(quant(xs, 0.1)), p90: round(quant(xs, 0.9)) };
    }
  }
  // auras mantidas: as que quase todo top tem, com uptime alto e pouca variação
  const ups = list.map((s) => uptimeOf(s.pull, s.player));
  const kinds = new Map<number, { name: string; kind: 'buff' | 'debuff'; byRot: number[] }>();
  for (const s of list)
    for (const u of s.player.rotation!.uptimes ?? []) {
      const k = kinds.get(u.id) ?? kinds.set(u.id, { name: u.name, kind: u.kind, byRot: [] }).get(u.id)!;
      k.byRot.push(u.byRotation ?? 0);
    }
  for (const [id, k] of kinds) {
    if (quant(k.byRot, 0.5) < KEPT_BY_ROTATION) continue;
    const xs = ups.map((u) => u.get(id)).filter((x): x is number => x != null);
    if (xs.length < Math.max(MIN_REF, list.length * 0.8)) continue;
    const med = quant(xs, 0.5);
    const p10 = quant(xs, 0.1);
    if (med >= KEPT_MEDIAN && p10 >= KEPT_P10) ref.kept[id] = { name: name(id, k.name), kind: k.kind, med: round(med), p10: round(p10) };
  }
  return ref;
}

// ---------------------------------------------------------------- comparação (no app)

export type ContextFinding =
  /** habilidade com fatia bem diferente da dos tops num contexto (alvo único ou AoE) */
  | { kind: 'mix'; ctx: Ctx; spellId: number; name: string; you: number; tops: number; casts: number }
  /** aura que os tops mantêm e o player deixa cair */
  | { kind: 'uptime'; id: number; name: string; auraKind: 'buff' | 'debuff'; you: number; tops: number };

/**
 * O pull do player contra o contexto dos tops (do boss, ou da spec): a mistura em alvo único e em
 * AoE, e o uptime das auras que eles mantêm. `skip`: auras que a rotação já cobra (checagem de DoT).
 */
export function compareContext(pull: Pull, p: PlayerStats, ref: ContextRef, skip: Set<number> = new Set()): ContextFinding[] {
  const r = p.rotation;
  if (!r) return [];
  const out: ContextFinding[] = [];
  const mine = contextMix(pull, p);
  const names = new Map((p.casts ?? []).map((c) => [c.spellId, c.name]));
  // wipe numa fase do começo tem outra mistura que a luta inteira dos tops
  const covers = !ref.ms || untilOf(pull, p) >= ref.ms * MIX_MIN_COVER;
  for (const ctx of ['st', 'aoe'] as const) {
    if (!covers || mine[ctx].n < CTX_MIN_CASTS) continue;
    for (const [id, m] of Object.entries(ref.mix[ctx])) {
      const you = mine[ctx].share.get(+id) ?? 0;
      const out_ = you < m.p10 - 0.05 || you > m.p90 + 0.05;
      if (out_ && Math.abs(you - m.med) >= CTX_MIN_DIFF) out.push({ kind: 'mix', ctx, spellId: +id, name: names.get(+id) ?? m.name, you, tops: m.med, casts: mine[ctx].n });
    }
  }
  const ups = uptimeOf(pull, p);
  // nome do próprio log do player quando ele tem a aura (o da referência pode vir de outra língua)
  const auraNames = new Map<number, string>([...(r.buffs ?? []).map((b) => [b.id, b.name] as const), ...(r.uptimes ?? []).map((u) => [u.id, u.name] as const)]);
  for (const [id, k] of Object.entries(ref.kept)) {
    if (skip.has(+id)) continue;
    const you = ups.get(+id);
    // nunca teve a aura: outro build, não cobra
    if (you == null || you >= k.p10 - UPTIME_MARGIN) continue;
    out.push({ kind: 'uptime', id: +id, name: auraNames.get(+id) ?? k.name, auraKind: k.kind, you, tops: k.med });
  }
  // as maiores diferenças primeiro
  return out.sort((a, b) => Math.abs(b.you - b.tops) - Math.abs(a.you - a.tops));
}

// ---------------------------------------------------------------- builds (talentos que mudam a rotação)

/** Talento presente em menos que isso (ou mais que 1 - isso) dos tops não divide builds. */
const BUILD_MIN_SHARE = 0.2;
/** Mudança mínima na fatia de alguma habilidade entre quem pega e quem não pega o talento. */
const BUILD_MIN_DIFF = 0.08;
/** Pulls mínimos de cada lado, e de cada combinação para ter referência própria. */
const BUILD_MIN_SIDE = 6;
const BUILD_MIN_GROUP = 8;
const BUILD_MAX_TALENTS = 2;
/** Bosses mínimos com os dois lados do talento (para separar o efeito do talento do efeito da luta). */
const BUILD_MIN_BOSSES = 4;

export interface BuildRef {
  /** talentos (id da entrada na árvore) que mudam a rotação, e a habilidade que mais muda com eles */
  talents: { entry: number; name: string; ability: string; with: number; without: number }[];
  /** contexto de cada combinação desses talentos ("10" = tem o 1º, não tem o 2º) */
  contexts: Record<string, ContextRef>;
  /** a combinação mais comum entre os tops */
  majority: string;
}

/** A combinação do player nos talentos do build ("10"...). */
export const buildKeyOf = (p: PlayerStats, entries: number[]) => entries.map((e) => ((p.setup?.talents ?? []).some((t) => t[1] === e) ? '1' : '0')).join('');

/** Fatia de cada habilidade da rotação na luta inteira (até a morte). */
function wholeMix(pull: Pull, p: PlayerStats): Map<number, number> {
  const r = p.rotation!;
  const rot = new Set([...r.prioritySt, ...r.priorityAoe].map((x) => x.spellId));
  const until = untilOf(pull, p);
  const out = new Map<number, number>();
  let n = 0;
  for (const c of p.casts ?? []) {
    if (!rot.has(c.spellId)) continue;
    const k = c.times.filter((t) => t <= until).length;
    out.set(c.spellId, k);
    n += k;
  }
  for (const [id, k] of out) out.set(id, k / Math.max(1, n));
  return out;
}

/**
 * Os talentos que mudam a rotação dos tops (quem pega joga com outra mistura de habilidades) e a
 * referência de contexto de cada combinação deles. null = nenhum talento divide os tops.
 */
export function discoverBuild(
  samples: { pull: Pull; player: PlayerStats }[],
  talentName: (entry: number) => string,
  name: (id: number, fallback: string) => string,
): BuildRef | null {
  const list = samples.filter((s) => s.player.rotation && s.player.setup?.talents?.length);
  if (list.length < 2 * BUILD_MIN_SIDE) return null;
  const mixes = list.map((s) => wholeMix(s.pull, s.player));
  const has = list.map((s) => new Set((s.player.setup?.talents ?? []).map((t) => t[1])));
  const count = new Map<number, number>();
  for (const h of has) for (const e of h) count.set(e, (count.get(e) ?? 0) + 1);
  const names = new Map<number, string>();
  for (const s of list) for (const c of s.player.casts ?? []) names.set(c.spellId, c.name);
  const cands: { entry: number; score: number; ability: number; with: number; without: number; members: boolean[] }[] = [];
  for (const [e, k] of count) {
    const share = k / list.length;
    if (share < BUILD_MIN_SHARE || share > 1 - BUILD_MIN_SHARE) continue;
    const members = has.map((h) => h.has(e));
    if (members.filter(Boolean).length < BUILD_MIN_SIDE || members.filter((m) => !m).length < BUILD_MIN_SIDE) continue;
    // dentro do mesmo boss: talento escolhido só para lutas de AoE parece mudar a rotação, mas quem
    // muda é a luta. A diferença é a média das diferenças em cada boss com os dois lados.
    const byBoss = new Map<number, number[]>();
    list.forEach((s, i) => (byBoss.get(s.pull.encounterId) ?? byBoss.set(s.pull.encounterId, []).get(s.pull.encounterId)!).push(i));
    const strata = [...byBoss.values()].map((ix) => ({ yes: ix.filter((i) => members[i]), no: ix.filter((i) => !members[i]) })).filter((g) => g.yes.length >= 1 && g.no.length >= 1);
    if (strata.length < BUILD_MIN_BOSSES) continue;
    const ids = new Set(mixes.flatMap((m) => [...m.keys()]));
    let best = { ability: 0, diff: 0, with: 0, without: 0 };
    for (const id of ids) {
      let w = 0;
      let wo = 0;
      let weight = 0;
      for (const g of strata) {
        const k = Math.min(g.yes.length, g.no.length);
        w += quant(g.yes.map((i) => mixes[i].get(id) ?? 0), 0.5) * k;
        wo += quant(g.no.map((i) => mixes[i].get(id) ?? 0), 0.5) * k;
        weight += k;
      }
      [w, wo] = [w / weight, wo / weight];
      if (Math.abs(w - wo) > Math.abs(best.diff)) best = { ability: id, diff: w - wo, with: w, without: wo };
    }
    if (Math.abs(best.diff) >= BUILD_MIN_DIFF) cands.push({ entry: e, score: Math.abs(best.diff), ability: best.ability, with: best.with, without: best.without, members });
  }
  cands.sort((a, b) => b.score - a.score);
  // até dois talentos, sem repetir a mesma divisão (talentos que andam juntos)
  const chosen: typeof cands = [];
  for (const c of cands) {
    const same = chosen.some((o) => {
      const agree = c.members.filter((m, i) => m === o.members[i]).length / c.members.length;
      return agree >= 0.85 || agree <= 0.15;
    });
    if (!same) chosen.push(c);
    if (chosen.length >= BUILD_MAX_TALENTS) break;
  }
  if (!chosen.length) return null;
  const entries = chosen.map((c) => c.entry);
  const groups = new Map<string, typeof list>();
  for (const s of list) {
    const k = buildKeyOf(s.player, entries);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  const contexts: Record<string, ContextRef> = {};
  for (const [k, g] of groups) {
    if (g.length < BUILD_MIN_GROUP) continue;
    const ref = buildContextRef(g, name);
    if (ref) contexts[k] = ref;
  }
  const majority = [...groups].sort((a, b) => b[1].length - a[1].length)[0][0];
  return {
    talents: chosen.map((c) => ({ entry: c.entry, name: talentName(c.entry), ability: name(c.ability, names.get(c.ability) ?? `${c.ability}`), with: round(c.with), without: round(c.without) })),
    contexts,
    majority,
  };
}
