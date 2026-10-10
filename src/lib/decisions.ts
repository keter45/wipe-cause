// Decisões da rotação comparadas com as dos tops: procs (quem gasta cada um, quantos se perdem,
// quantos casts saem com ele esperando) e cooldowns (usados assim que ficam prontos ou segurados
// para sair junto de outro). O mesmo código descobre a referência nos tops
// (scripts/rotation/bench.mjs) e compara o pull do player no app. Só funções puras e imports de
// tipo: o script carrega este arquivo direto no Node (--experimental-strip-types).

import type { BuffTrace, PlayerStats, Pull, RotationResult } from '../types';

/** Casts antes disso não contam (pré-pull, abertura). */
export const START_MS = 2000;
/** Carga perdida até isto depois de um cast = gasta por ele (o motor marca o cast). */
export const CONSUME_MS = 200;
/** Tempo de reação depois do proc antes de contar um cast "no lugar dele". */
export const REACTION_MS = 300;
/** "Junto": até isto antes ou depois. */
export const NEAR_MS = 3000;
/** Usado até isto depois de pronto = "assim que saiu". */
export const READY_SLACK_MS = 1500;
/** Buff que já estava ativo há pelo menos isso no cast (não é efeito do próprio cast). */
const BUFF_BEFORE_MS = 500;
/** Proc que os tops perdem mais que isso (mediana) se perde por natureza: não é cobrado. */
const LOST_MAX_TOPS = 0.2;
/** Buff ativo mais que essa fração do pull não serve de parceiro de alinhamento. */
const PARTNER_MAX_UPTIME = 0.4;

// ---------------------------------------------------------------- o pull visto pelas decisões

export interface Cast {
  t: number;
  id: number;
}

export interface Pov {
  casts: Cast[];
  buffs: BuffTrace[];
  /** até quando conta: a morte ou o fim do tempo analisado */
  until: number;
  /** nome de cada habilidade castada (para as dicas) */
  names: Map<number, string>;
}

/**
 * Os casts da rotação (prioridades e cooldowns) e os buffs do player, até a morte. `r`/`buffs`:
 * de outro lugar, para o top do Warcraft Logs (sem leitura de rotação: usa a do player comparado).
 */
export function povOf(pull: Pull, p: PlayerStats, r: RotationResult | undefined = p.rotation, buffs: BuffTrace[] | undefined = r?.buffs): Pov | null {
  if (!r) return null;
  const rot = new Set([...r.prioritySt, ...r.priorityAoe].map((x) => x.spellId).concat(r.cooldowns.map((c) => c.spellId)));
  const death = pull.deaths.find((d) => d.guid === p.guid && !d.ignored)?.t;
  const until = Math.min(death ?? Infinity, pull.analyzedMs);
  const casts = (p.casts ?? [])
    .filter((c) => rot.has(c.spellId))
    .flatMap((c) => c.times.filter((t) => t >= START_MS && t <= until).map((t) => ({ t, id: c.spellId })))
    .sort((a, b) => a.t - b.t);
  const names = new Map((p.casts ?? []).map((c) => [c.spellId, c.name]));
  return { casts, buffs: buffs ?? [], until, names };
}

const activeAt = (b: BuffTrace, t: number, before = 0) => b.spans.some(([a, z]) => t - a >= before && t <= z);
const uptime = (b: BuffTrace, until: number) => b.spans.reduce((s, [a, z]) => s + Math.min(z, until) - a, 0) / Math.max(1, until - START_MS);

const quant = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---------------------------------------------------------------- referência (nos tops)

export interface ProcRef {
  name: string;
  /** habilidades que gastam o proc, e os nomes delas */
  consumers: number[];
  consumerNames: string[];
  /** fração dos procs perdidos nos tops (mediana e p90 entre os pulls) */
  lost: { med: number; p90: number } | null;
  /** casts de outras habilidades por proc, com ele esperando (só procs curtos de poucas cargas) */
  wait: { med: number; p90: number } | null;
}

export interface CdRef {
  name: string;
  /** cooldown efetivo (com haste), pelos intervalos dos tops; null = tem cargas (só alinhamento) */
  cd: number | null;
  /** quanto tempo depois de pronto os tops usam (mediana e p90 entre os pulls) e quantos "na hora" */
  held: { med: number; p90: number; onCd: number } | null;
  /** o que sai junto: `c<id>` = outro cooldown castado perto, `b<id>` = buff ativo */
  partners: { key: string; name: string; share: number; p10: number }[];
}

export interface DecisionRef {
  n: number;
  procs: Record<string, ProcRef>;
  cds: Record<string, CdRef>;
}

/** Procs e quem os gasta: o buff cai logo depois do cast na maioria das vezes, bem acima do acaso. */
export function discoverConsumers(povs: Pov[]): Map<number, Set<number>> {
  const act = new Map<string, number>();
  const cons = new Map<string, number>();
  const drops = new Map<number, number>();
  const activeMs = new Map<number, number>();
  for (const p of povs)
    for (const b of p.buffs) {
      const ds = b.drops.filter(([t]) => t <= p.until);
      drops.set(b.id, (drops.get(b.id) ?? 0) + ds.length);
      activeMs.set(b.id, (activeMs.get(b.id) ?? 0) + uptime(b, p.until) * (p.until - START_MS));
      for (const c of p.casts) {
        if (!activeAt(b, c.t)) continue;
        const k = `${b.id}:${c.id}`;
        act.set(k, (act.get(k) ?? 0) + 1);
        if (ds.some(([t, by]) => by === c.id && t >= c.t && t - c.t <= CONSUME_MS)) cons.set(k, (cons.get(k) ?? 0) + 1);
      }
    }
  const out = new Map<number, Set<number>>();
  for (const [k, n] of act) {
    const [b, s] = k.split(':').map(Number);
    const c = cons.get(k) ?? 0;
    const base = ((drops.get(b) ?? 0) * CONSUME_MS) / Math.max(1, activeMs.get(b) ?? 1);
    if (n >= 20 && c / n >= 0.6 && c / n >= 5 * base) (out.get(b) ?? out.set(b, new Set()).get(b)!).add(s);
  }
  return out;
}

export interface ProcStat {
  used: number;
  lost: number;
  /** quando cada carga se perdeu */
  lostAt: number[];
  /** cargas ganhas e casts de outras habilidades com o proc esperando (e quais, e quando) */
  gains: number;
  others: number;
  wrong: Record<number, number>;
  wrongAt: number[];
}

/** Um proc no pull: gasto x perdido, e o que saiu com ele esperando. */
export function procStat(p: Pov, b: BuffTrace, consumers: Set<number>): ProcStat {
  const s: ProcStat = { used: 0, lost: 0, lostAt: [], gains: b.gains, others: 0, wrong: {}, wrongAt: [] };
  for (const [t, by] of b.drops) {
    if (t > p.until) continue;
    if (consumers.has(by)) s.used++;
    else {
      s.lost++;
      s.lostAt.push(t);
    }
  }
  for (const c of p.casts) {
    if (consumers.has(c.id) || !activeAt(b, c.t, REACTION_MS)) continue;
    s.others++;
    s.wrong[c.id] = (s.wrong[c.id] ?? 0) + 1;
    s.wrongAt.push(c.t);
  }
  return s;
}

/** Cooldowns pelos intervalos entre usos nos tops (sem os usos que vieram de um proc/reset). */
export function discoverCooldowns(povs: Pov[]): Map<number, number | null> {
  const gaps = new Map<number, number[]>();
  const perPull = new Map<number, number[]>();
  for (const p of povs) {
    const last = new Map<number, number>();
    const mine = new Map<number, number[]>();
    for (const c of p.casts) {
      const prev = last.get(c.id);
      if (prev != null && !resetCast(p, c)) {
        (gaps.get(c.id) ?? gaps.set(c.id, []).get(c.id)!).push(c.t - prev);
        (mine.get(c.id) ?? mine.set(c.id, []).get(c.id)!).push(c.t - prev);
      }
      last.set(c.id, c.t);
    }
    for (const [id, g] of mine) if (g.length >= 4) (perPull.get(id) ?? perPull.set(id, []).get(id)!).push(quant(g, 0.1));
  }
  const out = new Map<number, number | null>();
  for (const [id, g] of gaps) {
    if (g.length < 30) continue;
    // dois usos seguidos = cargas: dá para ver o alinhamento, não o tempo segurado
    const short = g.filter((x) => x < 2500).length / g.length;
    const pp = perPull.get(id) ?? [];
    const cd = pp.length >= 8 ? quant(pp, 0.5) : quant(g, 0.05);
    if (cd >= 4000 && short < 0.05) out.set(id, cd);
    else if (quant(g, 0.5) >= 4000) out.set(id, null);
  }
  return out;
}

/** Cast que gastou um proc (reset, grátis): não conta no tempo segurado. */
const resetCast = (p: Pov, c: Cast) => p.buffs.some((b) => b.drops.some(([t, by]) => by === c.id && t >= c.t && t - c.t <= CONSUME_MS));

export interface CdStat {
  /** tempo segurado depois de pronto, em cada uso (sem o primeiro e os que vieram de reset) */
  held: { t: number; held: number }[];
  /** usos e o que saiu junto em cada um */
  n: number;
  with: Record<string, number>;
  /** em quais usos faltou cada parceiro */
  missing: Record<string, number[]>;
}

/** Um cooldown no pull: quanto foi segurado e com o que saiu junto. */
export function cdStat(p: Pov, id: number, cd: number | null, cds: Set<number>): CdStat {
  const s: CdStat = { held: [], n: 0, with: {}, missing: {} };
  let last: number | null = null;
  const partners = partnerKeys(p, cds);
  for (const c of p.casts) {
    if (c.id !== id) continue;
    if (cd != null && last != null && !resetCast(p, c)) s.held.push({ t: c.t, held: Math.max(0, c.t - (last + cd)) });
    last = c.t;
    s.n++;
    const near = new Set<string>();
    for (const o of p.casts) if (o.id !== id && cds.has(o.id) && Math.abs(o.t - c.t) <= NEAR_MS) near.add(`c${o.id}`);
    for (const b of p.buffs) if (partners.has(`b${b.id}`) && activeAt(b, c.t, BUFF_BEFORE_MS)) near.add(`b${b.id}`);
    for (const k of near) s.with[k] = (s.with[k] ?? 0) + 1;
    for (const k of partners) if (!near.has(k)) (s.missing[k] ??= []).push(c.t);
  }
  return s;
}

/** Possíveis parceiros de alinhamento no pull: os outros cooldowns e os buffs curtos. */
function partnerKeys(p: Pov, cds: Set<number>): Set<string> {
  const out = new Set<string>();
  for (const id of cds) out.add(`c${id}`);
  for (const b of p.buffs) if (uptime(b, p.until) < PARTNER_MAX_UPTIME) out.add(`b${b.id}`);
  return out;
}

/** Chance de um parceiro estar "junto" por acaso no pull (para separar alinhamento de coincidência). */
function chance(p: Pov, key: string): number {
  if (key[0] === 'b') {
    const b = p.buffs.find((x) => x.id === +key.slice(1));
    return b ? uptime(b, p.until) : 0;
  }
  const n = p.casts.filter((c) => c.id === +key.slice(1)).length;
  return Math.min(1, (n * 2 * NEAR_MS) / Math.max(1, p.until - START_MS));
}

const summarizeHeld = (s: CdStat) => {
  if (s.held.length < 3) return null;
  const xs = s.held.map((h) => h.held);
  return { med: quant(xs, 0.5), onCd: xs.filter((x) => x <= READY_SLACK_MS).length / xs.length, n: xs.length };
};

/** Referência de decisões a partir dos pulls dos tops (mesma spec e árvore; ou só um boss). */
export function buildDecisionRef(
  povs: Pov[],
  consumers: Map<number, Set<number>>,
  cooldowns: Map<number, number | null>,
  name: (id: number, fallback: string) => string,
): DecisionRef {
  const ref: DecisionRef = { n: povs.length, procs: {}, cds: {} };
  // procs: perdidos e casts com ele esperando
  const profile = buffProfile(povs);
  for (const [b, set] of consumers) {
    const stats = povs.flatMap((p) => p.buffs.filter((x) => x.id === b).map((x) => procStat(p, x, set)));
    const rates = stats.filter((s) => s.used + s.lost >= 3).map((s) => s.lost / (s.used + s.lost));
    const waits = profile.short.has(b) ? stats.filter((s) => s.gains >= 3).map((s) => s.others / s.gains) : [];
    ref.procs[b] = {
      name: name(b, profile.names.get(b) ?? `${b}`),
      consumers: [...set],
      consumerNames: [...set].map((c) => name(c, `${c}`)),
      lost: rates.length >= 8 ? { med: quant(rates, 0.5), p90: quant(rates, 0.9) } : null,
      wait: waits.length >= 8 ? { med: quant(waits, 0.5), p90: quant(waits, 0.9) } : null,
    };
  }
  // cooldowns: segurado e parceiros
  const cds = new Set(cooldowns.keys());
  for (const [id, cd] of cooldowns) {
    const stats = povs.map((p) => ({ p, s: cdStat(p, id, cd, cds) })).filter((x) => x.s.n > 0);
    const held = stats.map((x) => summarizeHeld(x.s)).filter((h): h is NonNullable<typeof h> => h != null);
    const partners: CdRef['partners'] = [];
    const have = stats.filter((x) => x.s.n >= 3);
    if (have.length >= 8) {
      const keys = new Set(have.flatMap((x) => Object.keys(x.s.with)));
      for (const k of keys) {
        const shares = have.map((x) => (x.s.with[k] ?? 0) / x.s.n);
        const m = mean(shares);
        const agree = shares.filter((s) => s >= 0.5).length / shares.length;
        const base = mean(have.map((x) => chance(x.p, k)));
        const pid = +k.slice(1);
        if (m >= 0.75 && agree >= 0.8 && m >= 2.5 * base) partners.push({ key: k, name: name(pid, profile.names.get(pid) ?? `${pid}`), share: round(m), p10: round(quant(shares, 0.1)) });
      }
    }
    if (!held.length && !partners.length) continue;
    ref.cds[id] = {
      name: name(id, `${id}`),
      cd,
      held: held.length >= 8 ? { med: Math.round(quant(held.map((h) => h.med), 0.5)), p90: Math.round(quant(held.map((h) => h.med), 0.9)), onCd: round(quant(held.map((h) => h.onCd), 0.5)) } : null,
      partners,
    };
  }
  for (const p of Object.values(ref.procs)) {
    if (p.lost) p.lost = { med: round(p.lost.med), p90: round(p.lost.p90) };
    if (p.wait) p.wait = { med: round(p.wait.med), p90: round(p.wait.p90) };
  }
  return ref;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** Cargas máximas e duração típica de cada buff: "casts com o proc esperando" só vale para procs curtos de poucas cargas. */
function buffProfile(povs: Pov[]) {
  const max = new Map<number, number>();
  const dur = new Map<number, number[]>();
  const names = new Map<number, string>();
  for (const p of povs)
    for (const b of p.buffs) {
      names.set(b.id, b.name);
      max.set(b.id, Math.max(max.get(b.id) ?? 0, b.maxStacks));
      for (const [a, z] of b.spans) (dur.get(b.id) ?? dur.set(b.id, []).get(b.id)!).push(z - a);
    }
  const short = new Set<number>();
  for (const [id, m] of max) if (m <= 3 && quant(dur.get(id) ?? [1e9], 0.5) <= 15000) short.add(id);
  return { short, names };
}

// ---------------------------------------------------------------- comparação (no app)

export interface Spell {
  spellId: number;
  name: string;
}

export type DecisionFinding =
  /** proc que o player deixa acabar bem mais que os tops */
  | { kind: 'proc_lost'; buff: number; name: string; consumers: Spell[]; you: number; tops: number; n: number; times: number[] }
  /** casts de outras habilidades com o proc esperando */
  | { kind: 'proc_wait'; buff: number; name: string; consumers: Spell[]; you: number; tops: number; instead: Spell; times: number[] }
  /** cooldown que os tops usam assim que fica pronto e o player segura */
  | { kind: 'cd_held'; spellId: number; name: string; you: number; tops: number; times: number[] }
  /** cooldown que os tops usam junto de outro (ou com um buff ativo) e o player não */
  | { kind: 'cd_align'; spellId: number; name: string; partner: string; partnerName: string; partnerKind: 'cast' | 'buff'; you: number; tops: number; n: number; times: number[] };

/**
 * O pull do player contra a referência dos tops (da spec e árvore, com os cooldowns do boss quando
 * houver tops suficientes nele). Só o que passa bem do que os próprios tops fazem.
 */
export function compareDecisions(p: Pov, ref: DecisionRef, bossCds?: Record<string, CdRef>): DecisionFinding[] {
  const out: DecisionFinding[] = [];
  const spell = (id: number, fallback?: string): Spell => ({ spellId: id, name: p.names.get(id) ?? fallback ?? ref.cds[id]?.name ?? `#${id}` });
  for (const [bid, pr] of Object.entries(ref.procs)) {
    const b = p.buffs.find((x) => x.id === +bid);
    if (!b) continue;
    const s = procStat(p, b, new Set(pr.consumers));
    const total = s.used + s.lost;
    // só proc que os tops quase não perdem (os que se perdem por natureza variam demais entre
    // eles), e o player usou quem gasta ao menos uma vez (sem nenhum uso, é outro build)
    if (pr.lost && pr.lost.med <= LOST_MAX_TOPS && s.used >= 1 && total >= 6) {
      const you = s.lost / total;
      if (you > pr.lost.p90 + 0.15 && you - pr.lost.med >= 0.2) out.push({ kind: 'proc_lost', buff: b.id, name: pr.name, consumers: pr.consumers.map((c, i) => spell(c, pr.consumerNames[i])), you, tops: pr.lost.med, n: total, times: s.lostAt });
    }
    // idem: proc que os tops perdem bastante não precisa ser gasto na hora
    if (pr.wait && pr.lost && pr.lost.med <= LOST_MAX_TOPS && s.gains >= 5) {
      const you = s.others / s.gains;
      if (pr.wait.med <= 0.5 && you > pr.wait.p90 + 0.5 && you >= 2 * pr.wait.med + 0.5) {
        const instead = +Object.entries(s.wrong).sort((x, y) => y[1] - x[1])[0][0];
        out.push({ kind: 'proc_wait', buff: b.id, name: pr.name, consumers: pr.consumers.map((c, i) => spell(c, pr.consumerNames[i])), you, tops: pr.wait.med, instead: spell(instead), times: s.wrongAt });
      }
    }
  }
  const cds = { ...ref.cds, ...bossCds };
  const cdIds = new Set(Object.keys(cds).map(Number));
  for (const [sid, cr] of Object.entries(cds)) {
    const s = cdStat(p, +sid, cr.cd, cdIds);
    const h = summarizeHeld(s);
    if (cr.held && h && h.n >= 5 && cr.held.med <= READY_SLACK_MS && h.med >= Math.max(cr.held.p90 + 2000, 3000))
      out.push({ kind: 'cd_held', spellId: +sid, name: cr.name, you: h.med, tops: cr.held.med, times: s.held.filter((x) => x.held > READY_SLACK_MS).map((x) => x.t) });
    if (s.n < 5) continue;
    // um parceiro por cooldown: o de maior diferença
    let best: Extract<DecisionFinding, { kind: 'cd_align' }> | null = null;
    for (const pt of cr.partners) {
      const you = (s.with[pt.key] ?? 0) / s.n;
      if (you < pt.p10 && pt.share - you >= 0.4 && (!best || pt.share - you > best.tops - best.you))
        best = { kind: 'cd_align', spellId: +sid, name: cr.name, partner: pt.key, partnerName: pt.name, partnerKind: pt.key[0] === 'c' ? 'cast' : 'buff', you, tops: pt.share, n: s.n, times: s.missing[pt.key] ?? [] };
    }
    if (best) out.push(best);
  }
  return out;
}

// ---------------------------------------------------------------- contra um log só (Y)

/** Amostras mínimas de cada lado numa comparação com um log só. */
const Y_MIN_PROCS = 6;
const Y_MIN_GAINS = 5;
const Y_MIN_USES = 4;

/**
 * O pull do player (X) contra um log só (Y): os mesmos tipos de dica, mas sem a faixa de vários
 * pulls dos tops para dizer o que é normal, então só diferenças grandes entre os dois. Quem gasta
 * cada proc e o cooldown efetivo vêm da referência dos tops (`base`) quando a spec tem; o "tops"
 * de cada dica é o número do Y.
 */
export function compareWithLog(x: Pov, y: Pov, base: DecisionRef | null): DecisionFinding[] {
  const out: DecisionFinding[] = [];
  const spell = (id: number, fallback?: string): Spell => ({ spellId: id, name: x.names.get(id) ?? y.names.get(id) ?? fallback ?? base?.cds[id]?.name ?? `#${id}` });
  // procs: os da referência dos tops; sem ela, os que os dois logs mostram
  const procs: [number, ProcRef | null, Set<number>][] = base
    ? Object.entries(base.procs).map(([b, pr]) => [+b, pr, new Set(pr.consumers)])
    : [...discoverConsumers([x, y])].map(([b, set]) => [b, null, set]);
  for (const [bid, pr, set] of procs) {
    const bx = x.buffs.find((b) => b.id === bid);
    const by = y.buffs.find((b) => b.id === bid);
    if (!bx || !by) continue;
    const sx = procStat(x, bx, set);
    const sy = procStat(y, by, set);
    const tx = sx.used + sx.lost;
    const ty = sy.used + sy.lost;
    if (tx < Y_MIN_PROCS || ty < Y_MIN_PROCS || sx.used < 1) continue;
    const rx = sx.lost / tx;
    const ry = sy.lost / ty;
    // proc que se perde por natureza (nos tops, ou no próprio Y) não é cobrado
    if ((pr?.lost?.med ?? ry) > LOST_MAX_TOPS) continue;
    const name = pr?.name ?? bx.name;
    const consumers = [...set].map((c, i) => spell(c, pr?.consumerNames[i]));
    // e você fora do normal dos tops: diferença que dois tops também teriam entre si é estilo, não erro
    const pastTops = (v: number, band: { p90: number } | null | undefined, margin: number) => !band || v > band.p90 + margin;
    if (rx - ry >= 0.25 && rx >= 0.3 && pastTops(rx, pr?.lost, 0.1)) out.push({ kind: 'proc_lost', buff: bid, name, consumers, you: rx, tops: ry, n: tx, times: sx.lostAt });
    // casts com o proc esperando: só procs que os tops gastam quase na hora
    if (pr?.wait && pr.wait.med <= 0.5 && sx.gains >= Y_MIN_GAINS && sy.gains >= Y_MIN_GAINS) {
      const wx = sx.others / sx.gains;
      const wy = sy.others / sy.gains;
      if (wx - wy >= 1 && wx >= 2 * wy + 0.5 && pastTops(wx, pr.wait, 0.3)) {
        const instead = +Object.entries(sx.wrong).sort((a, b) => b[1] - a[1])[0][0];
        out.push({ kind: 'proc_wait', buff: bid, name, consumers, you: wx, tops: wy, instead: spell(instead), times: sx.wrongAt });
      }
    }
  }
  // cooldowns: os da referência dos tops (com o cooldown efetivo deles)
  const cds = base ? Object.entries(base.cds).map(([id, c]) => [+id, c] as const) : [];
  const ids = new Set(cds.map(([id]) => id));
  for (const [id, cr] of cds) {
    const sx = cdStat(x, id, cr.cd, ids);
    const sy = cdStat(y, id, cr.cd, ids);
    const hx = summarizeHeld(sx);
    const hy = summarizeHeld(sy);
    // segurado: só cooldown que os tops usam assim que fica pronto, com usos suficientes dos dois lados
    if (cr.held && cr.held.med <= READY_SLACK_MS && hx && hy && hx.n >= Y_MIN_USES && hy.n >= Y_MIN_USES && hy.med <= READY_SLACK_MS + 500 && hx.med >= hy.med + 4000 && hx.med >= cr.held.p90 + 1000)
      out.push({ kind: 'cd_held', spellId: id, name: cr.name, you: hx.med, tops: hy.med, times: sx.held.filter((h) => h.held > READY_SLACK_MS).map((h) => h.t) });
    if (sx.n < Y_MIN_USES || sy.n < Y_MIN_USES) continue;
    // o que os tops soltam junto (alinhamento confirmado neles), o Y também e o player não: num pull
    // só, 3 ou 4 usos "sempre juntos" de outra coisa acontecem por acaso
    let best: Extract<DecisionFinding, { kind: 'cd_align' }> | null = null;
    for (const pt of cr.partners) {
      const k = pt.key;
      const share = (sy.with[k] ?? 0) / sy.n;
      const you = (sx.with[k] ?? 0) / sx.n;
      if (share < 0.75 || share < 2.5 * chance(y, k) || share - you < 0.4 || you >= pt.p10) continue;
      if (best && share - you <= best.tops - best.you) continue;
      const pid = +k.slice(1);
      const partnerName = k[0] === 'c' ? spell(pid).name : (y.buffs.find((b) => b.id === pid)?.name ?? x.buffs.find((b) => b.id === pid)?.name ?? `#${pid}`);
      best = { kind: 'cd_align', spellId: id, name: cr.name, partner: k, partnerName, partnerKind: k[0] === 'c' ? 'cast' : 'buff', you, tops: share, n: sx.n, times: sx.missing[k] ?? [] };
    }
    if (best) out.push(best);
  }
  return out;
}

// ---------------------------------------------------------------- buffs de quem não passou pelo motor

/** Buff ativo mais que essa fração do pull não é proc nem janela (as mesmas regras do motor). */
const BUFF_MAX_UPTIME = 0.4;
const MAX_BUFFS = 40;

/** Mudança de cargas de um buff que o player se deu: `stacks` = cargas depois (0 = acabou). */
export interface AuraChange {
  t: number;
  id: number;
  name: string;
  stacks: number;
}

/**
 * Os buffs curtos no formato do motor (`RotationResult.buffs`) a partir das mudanças de cargas e dos
 * casts: para o top baixado do Warcraft Logs, que não passa pelo motor. Cada carga perdida leva o
 * cast de até CONSUME_MS antes.
 */
export function buffTraces(changes: AuraChange[], casts: Cast[], until: number): BuffTrace[] {
  const sorted = [...casts].sort((a, b) => a.t - b.t);
  const by = (t: number) => {
    let id = 0;
    for (const c of sorted) {
      if (c.t > t) break;
      if (t - c.t <= CONSUME_MS) id = c.id;
    }
    return id;
  };
  const acc = new Map<number, BuffTrace & { stacks: number; since: number | null }>();
  for (const e of [...changes].sort((a, b) => a.t - b.t)) {
    if (e.t > until) break;
    const b = acc.get(e.id) ?? acc.set(e.id, { id: e.id, name: e.name, maxStacks: 0, gains: 0, spans: [], drops: [], stacks: 0, since: null }).get(e.id)!;
    if (e.stacks > b.stacks) {
      b.gains += e.stacks - b.stacks;
      b.since ??= e.t;
    } else if (e.stacks < b.stacks) {
      const cast = by(e.t);
      for (let i = 0; i < b.stacks - e.stacks; i++) b.drops.push([e.t, cast]);
    }
    if (e.stacks === 0 && b.since != null) {
      b.spans.push([b.since, e.t]);
      b.since = null;
    }
    b.maxStacks = Math.max(b.maxStacks, e.stacks);
    b.stacks = e.stacks;
  }
  const out: BuffTrace[] = [];
  for (const { stacks: _s, since, ...b } of acc.values()) {
    if (since != null) b.spans.push([since, until]);
    const up = b.spans.reduce((s, [a, z]) => s + z - a, 0);
    if (b.gains > 0 && up <= until * BUFF_MAX_UPTIME) out.push(b);
  }
  return out.sort((a, b) => b.gains - a.gains || a.id - b.id).slice(0, MAX_BUFFS);
}
