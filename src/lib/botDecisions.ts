// Decisões contra o robô (docs/simulation.md, etapa 4). As 20 lutas avulsas do SimulationCraft
// viram "pulls de referência" no mesmo formato das decisões dos tops (decisions.ts): quem gasta
// cada proc, quanto se perde, cooldowns na hora ou alinhados. Além disso, cast a cast: com um proc
// ativo, o que o robô casta, e os casts do player que ele quase nunca faria.
//
// O robô é a referência aqui. Quando os tops (src/data/bench) fazem outra coisa, vira um aviso.

import type { BuffTrace, PlayerStats } from '../types';
import type { Sample } from './performance';
import type { BotRun, BotSeq } from './botSim';
import {
  READY_SLACK_MS,
  REACTION_MS,
  START_MS,
  buildDecisionRef,
  compareDecisions,
  discoverConsumers,
  discoverCooldowns,
  povOf,
  type Cast,
  type DecisionFinding,
  type DecisionRef,
  type Pov,
  type Spell,
} from './decisions';

/** Casts do robô com um proc ativo, no mínimo, para dizer o que ele faz. */
const MIN_BOT_CASTS = 30;
/** O cast do player que o robô faz em menos que isso, com o proc ativo, é erro... */
const BOT_RARE = 0.05;
/** ...se o robô tem uma escolha clara (a mais comum em pelo menos isso das vezes). */
const BOT_CLEAR = 0.5;
/** E acontece ao menos tantas vezes no pull (uma vez só pode ser reação a mecânica). */
const MIN_TIMES = 2;
/** Proc que os tops deixam acabar mais que isso se perde por natureza (o mesmo de decisions.ts). */
const TOPS_LOSE = 0.2;

/** "Precise Shots" / "precise_shots" -> "precise_shots" */
const token = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Casts escolhidos pelo robô com um proc ativo e o que o player fez de diferente. */
export interface BotChoice {
  kind: 'bot_choice';
  buff: number;
  buffName: string;
  /** o que o player castou */
  spell: Spell;
  /** a escolha mais comum do robô e com que frequência; quanto ele faz a do player */
  bot: Spell;
  botShare: number;
  botYours: number;
  times: number[];
}

/** O que os tops fazem diferente do robô (o player decide). */
export type TopsDiff =
  | { kind: 'consumers'; buff: number; name: string; bot: string[]; tops: string[] }
  | { kind: 'held'; spellId: number; name: string; bot: number; tops: number }
  | { kind: 'align'; spellId: number; name: string; partnerName: string; who: 'tops' | 'bot'; share: number };

export interface BotDecisions {
  /** procs e cooldowns contra a faixa das 20 lutas do robô */
  findings: DecisionFinding[];
  choices: BotChoice[];
  /** aviso por achado (chave `${kind}-${id}`): os tops fazem outra coisa */
  topsNotes: Record<string, TopsNote>;
  topsDiffs: TopsDiff[];
  ref: DecisionRef;
}

export type TopsNote = { kind: 'agree_you'; spell: string } | { kind: 'lose'; pct: number } | { kind: 'hold'; ms: number } | { kind: 'no_align'; partner: string };

export const findingKey = (d: DecisionFinding | BotChoice) => `${d.kind}-${'buff' in d ? d.buff : d.spellId}${d.kind === 'bot_choice' ? `-${d.spell.spellId}` : ''}`;

interface BotPov extends Pov {
  /** buffs ativos (ids do log) em cada cast de `casts` */
  activeAt: Set<number>[];
}

/** Ids do SimC -> ids do log do player (pelo id, ou pelo nome quando o SimC usa outro id). */
function idMaps(p: PlayerStats, run: BotRun) {
  const castByName = new Map((p.casts ?? []).map((c) => [token(c.name), c.spellId]));
  const castIds = new Set((p.casts ?? []).map((c) => c.spellId));
  const traces = p.rotation?.buffs ?? [];
  const buffIds = new Set(traces.map((b) => b.id));
  const buffByName = new Map(traces.map((b) => [token(b.name), b.id]));
  return {
    cast: (id: number) => (castIds.has(id) ? id : (castByName.get(token(run.names[id] ?? '')) ?? id)),
    /** só os buffs que o motor acompanha no player (os outros não dá para comparar) */
    buff: (id: number) => (buffIds.has(id) ? id : (buffByName.get(token(run.buffNames[id] ?? '')) ?? null)),
    traces,
  };
}

/**
 * Uma luta do robô no formato das decisões. O SimC dá os buffs ativos em cada cast: o que mudou
 * entre um cast e o seguinte conta logo depois do primeiro (o que sumiu foi gasto por ele).
 */
function botPov(seq: BotSeq, until: number, rot: Set<number>, maps: ReturnType<typeof idMaps>): BotPov {
  const casts: Cast[] = [];
  const activeAt: Set<number>[] = [];
  const acc = new Map<number, BuffTrace & { stacks: number; since: number | null }>();
  const name = new Map(maps.traces.map((b) => [b.id, b.name]));
  let prevT = 0;
  let prevId = 0;
  seq.casts.forEach(([t, raw], i) => {
    if (t > until) return;
    const id = maps.cast(raw);
    const now = new Map<number, number>();
    const a = seq.active[i] ?? [];
    for (let k = 0; k + 1 < a.length; k += 2) {
      const b = maps.buff(a[k]);
      if (b != null) now.set(b, Math.max(now.get(b) ?? 0, a[k + 1]));
    }
    const at = i === 0 ? t : prevT + 1;
    for (const b of new Set([...acc.keys(), ...now.keys()])) {
      const tr = acc.get(b) ?? acc.set(b, { id: b, name: name.get(b) ?? `${b}`, maxStacks: 0, gains: 0, spans: [], drops: [], stacks: 0, since: null }).get(b)!;
      const st = now.get(b) ?? 0;
      if (st > tr.stacks) {
        tr.gains += st - tr.stacks;
        tr.since ??= at;
      } else if (st < tr.stacks) for (let n = 0; n < tr.stacks - st; n++) tr.drops.push([at, prevId]);
      if (st === 0 && tr.since != null) {
        tr.spans.push([tr.since, at]);
        tr.since = null;
      }
      tr.maxStacks = Math.max(tr.maxStacks, st);
      tr.stacks = st;
    }
    if (rot.has(id) && t >= START_MS) {
      casts.push({ t, id });
      activeAt.push(new Set(now.keys()));
    }
    prevT = t;
    prevId = id;
  });
  const buffs: BuffTrace[] = [];
  for (const { stacks: _s, since, ...b } of acc.values()) {
    if (since != null) b.spans.push([since, until]);
    if (b.gains > 0) buffs.push(b);
  }
  return { casts, buffs, until, names: new Map(), activeAt };
}

const activeFor = (b: BuffTrace, t: number) => b.spans.some(([a, z]) => t - a >= REACTION_MS && t <= z);

/** Com cada proc ativo, o que o robô casta e o que o player castou que o robô quase nunca faz. */
function choices(me: Pov, mine: BuffTrace[], bots: BotPov[], consumers: Map<number, Set<number>>, spell: (id: number) => Spell): BotChoice[] {
  const out: BotChoice[] = [];
  for (const b of consumers.keys()) {
    const trace = mine.find((x) => x.id === b);
    if (!trace) continue;
    const dist = new Map<number, number>();
    let total = 0;
    for (const p of bots)
      p.casts.forEach((c, i) => {
        if (!p.activeAt[i].has(b)) return;
        dist.set(c.id, (dist.get(c.id) ?? 0) + 1);
        total++;
      });
    if (total < MIN_BOT_CASTS) continue;
    const [topId, topN] = [...dist].sort((x, y) => y[1] - x[1])[0];
    if (topN / total < BOT_CLEAR) continue;
    const wrong = new Map<number, number[]>();
    for (const c of me.casts) {
      if (!activeFor(trace, c.t) || (dist.get(c.id) ?? 0) / total >= BOT_RARE) continue;
      (wrong.get(c.id) ?? wrong.set(c.id, []).get(c.id)!).push(c.t);
    }
    for (const [id, times] of wrong) {
      if (times.length < MIN_TIMES) continue;
      out.push({ kind: 'bot_choice', buff: b, buffName: trace.name, spell: spell(id), bot: spell(topId), botShare: topN / total, botYours: (dist.get(id) ?? 0) / total, times });
    }
  }
  return out.sort((a, b) => b.times.length - a.times.length);
}

/** Cada achado contra o robô, olhando o que os tops fazem no mesmo ponto. */
function notesFor(list: (DecisionFinding | BotChoice)[], tops: DecisionRef): Record<string, TopsNote> {
  const out: Record<string, TopsNote> = {};
  for (const d of list) {
    const key = findingKey(d);
    if (d.kind === 'bot_choice') {
      const pr = tops.procs[d.buff];
      if (pr?.consumers.includes(d.spell.spellId) && !pr.consumers.includes(d.bot.spellId)) out[key] = { kind: 'agree_you', spell: d.spell.name };
    } else if (d.kind === 'proc_lost' || d.kind === 'proc_wait') {
      const lost = tops.procs[d.buff]?.lost?.med;
      if (lost != null && lost > TOPS_LOSE) out[key] = { kind: 'lose', pct: lost };
    } else if (d.kind === 'cd_held') {
      const held = tops.cds[d.spellId]?.held?.med;
      if (held != null && held > READY_SLACK_MS + 2000) out[key] = { kind: 'hold', ms: held };
    } else if (d.kind === 'cd_align') {
      const cr = tops.cds[d.spellId];
      if (cr && !cr.partners.some((p) => p.key === d.partner)) out[key] = { kind: 'no_align', partner: d.partnerName };
    }
  }
  return out;
}

/** Onde o robô e os tops jogam diferente, independente do player. */
function diffs(bot: DecisionRef, tops: DecisionRef): TopsDiff[] {
  const out: TopsDiff[] = [];
  for (const [id, b] of Object.entries(bot.procs)) {
    const t = tops.procs[+id];
    if (!t) continue;
    const [bs, ts] = [new Set(b.consumers), new Set(t.consumers)];
    if (b.consumers.some((c) => !ts.has(c)) || t.consumers.some((c) => !bs.has(c))) out.push({ kind: 'consumers', buff: +id, name: b.name, bot: b.consumerNames, tops: t.consumerNames });
  }
  for (const [id, b] of Object.entries(bot.cds)) {
    const t = tops.cds[+id];
    if (!t) continue;
    if (b.held && t.held && Math.abs(b.held.med - t.held.med) >= 3000 && Math.min(b.held.med, t.held.med) <= READY_SLACK_MS)
      out.push({ kind: 'held', spellId: +id, name: b.name, bot: b.held.med, tops: t.held.med });
    for (const p of t.partners) if (!b.partners.some((x) => x.key === p.key)) out.push({ kind: 'align', spellId: +id, name: b.name, partnerName: p.name, who: 'tops', share: p.share });
    for (const p of b.partners) if (!t.partners.some((x) => x.key === p.key)) out.push({ kind: 'align', spellId: +id, name: b.name, partnerName: p.name, who: 'bot', share: p.share });
  }
  return out;
}

/**
 * O pull do player contra as lutas do robô. `null` sem leitura de rotação da spec (é ela que diz
 * quais casts e buffs contam).
 */
export function botDecisions(me: Sample, run: BotRun, tops: DecisionRef | null): BotDecisions | null {
  const r = me.player.rotation;
  const mine = povOf(me.pull, me.player);
  if (!r || !mine || !run.seqs?.length) return null;
  const until = Math.min(mine.until, run.windowMs);
  const maps = idMaps(me.player, run);
  const rot = new Set([...r.prioritySt, ...r.priorityAoe].map((x) => x.spellId).concat(r.cooldowns.map((c) => c.spellId)));
  const bots = run.seqs.map((s) => botPov(s, run.windowMs, rot, maps));
  const consumers = discoverConsumers(bots);
  const cooldowns = discoverCooldowns(bots);
  const nameOf = (id: number, fallback: string) => mine.names.get(id) ?? run.names[id] ?? maps.traces.find((b) => b.id === id)?.name ?? fallback;
  const ref = buildDecisionRef(bots, consumers, cooldowns, nameOf);
  const spell = (id: number): Spell => ({ spellId: id, name: nameOf(id, `#${id}`) });

  const me2: Pov = { ...mine, until };
  const ch = choices(me2, r.buffs ?? [], bots, consumers, spell);
  // com a escolha cast a cast do mesmo proc, o "castou outra coisa com o proc esperando" sobra
  const withChoice = new Set(ch.map((c) => c.buff));
  const findings = compareDecisions(me2, ref).filter((d) => !(d.kind === 'proc_wait' && withChoice.has(d.buff)));
  return {
    findings,
    choices: ch,
    topsNotes: tops ? notesFor([...findings, ...ch], tops) : {},
    topsDiffs: tops ? diffs(ref, tops) : [],
    ref,
  };
}
