// Modo solo: o pull, a noite e a evolução do ponto de vista de um player só.
//
// - "dano perdido": cada erro vira uma estimativa do quanto custou, para ordenar o que corrigir
//   primeiro (morte cedo, tempo parado, proc perdido, DoT fora do alvo; mecânica e cooldown sem
//   número, com peso fixo em segundos do próprio dano);
// - "onde a referência abriu vantagem": as janelas de 5s de dano lado a lado e os trechos com a
//   maior diferença, com o que cada um castou ali;
// - mecânicas do próprio player e dano que ele tomou muito mais que a referência.

import type { Pull, PlayerStats, RotationFinding } from '../types';
import { PERSONAL_BLAME } from './blame';
import { bossKey } from './night';
import { castsOf, isHealer, outputPerSec, type Sample } from './performance';
import { meIn } from './mode';

/** Janela da linha do tempo do núcleo (TIMELINE_MS). */
export const BUCKET_MS = 5_000;

const aliveMs = (s: Sample) => Math.max(1, s.player.aliveMs ?? s.pull.analyzedMs);
const fmtSec = (ms: number) => `${Math.round(ms / 1000)}s`;

// ---------------------------------------------------------------- dano perdido

export type LossKind = 'death' | 'downtime' | 'proc' | 'dot' | 'cooldown' | 'resource' | 'rotation' | 'mechanic' | 'avoidable';

export interface Loss {
  key: string;
  kind: LossKind;
  title: string;
  detail: string;
  tip: string;
  /** dano (ou cura) estimado que o erro custou; null = sem como estimar */
  lost: number | null;
  /** peso para ordenar, em segundos do próprio output */
  weightSec: number;
  times: number[];
  spellId: number | null;
}

/** Peso fixo (s) quando não dá para estimar o dano: mecânica pela severidade, cooldown por uso perdido. */
const MECHANIC_SEC = { wipe: 60, major: 30, minor: 8, none: 0 } as const;
const COOLDOWN_USE_SEC = 12;
const FINDING_SEC = { high: 10, medium: 5, low: 2 } as const;

/** Dano médio por cast (sem auto-ataque): base para estimar o que um proc perdido valia. */
function damagePerCast(p: PlayerStats): number {
  const casts = (p.casts ?? []).filter((c) => c.spellId > 1).reduce((n, c) => n + c.times.length, 0);
  const out = isHealer(p) ? p.healingDone : p.damageDone;
  return casts > 0 ? out / casts : 0;
}

/** Dano de uma spell pelo id ou pelo nome (o DoT aparece com o id do debuff ou do cast). */
function spellAmount(p: PlayerStats, spellId: number | null, name: string): number {
  const list = (isHealer(p) ? p.healingBySpell : p.damageBySpell) ?? [];
  return list.filter((s) => s.spellId === spellId || s.name === name).reduce((n, s) => n + s.amount, 0);
}

/** "Flame Shock fora do alvo" -> "Flame Shock" */
const subject = (title: string) => title.replace(/ (fora do alvo|perdido|desperdiçad[oa]|parado)$/i, '');

/** Mortes do player que contam (antes do corte) e o que ainda faltava do pull. */
export function myDeaths(s: Sample) {
  const end = s.pull.cutoffT ?? s.pull.analyzedMs;
  return s.pull.deaths.filter((d) => d.guid === s.player.guid && !d.ignored).map((d) => ({ death: d, remainingMs: Math.max(0, end - d.t) }));
}

/** Falhas de mecânica em que o player é o culpado (dano evitável, posicionamento, stacks...). */
export function myMechanicFailures(s: Sample) {
  return s.pull.mechanics
    .filter((m) => PERSONAL_BLAME.has(m.kind) && m.evaluated)
    .flatMap((m) => {
      const me = m.players.find((p) => p.guid === s.player.guid && !p.credit && p.count > 0);
      return me ? [{ mechanic: m, player: me, times: m.events.filter((e) => e.player === s.player.name || e.player === s.player.guid).map((e) => e.t) }] : [];
    });
}

/** O que corrigir primeiro: os erros do pull ordenados pelo que custaram. */
export function losses(s: Sample): Loss[] {
  const p = s.player;
  const ops = outputPerSec(s);
  const perCast = damagePerCast(p);
  const out: Loss[] = [];

  for (const { death, remainingMs } of myDeaths(s)) {
    if (remainingMs < 10_000) continue;
    const unused = death.defensivesAvailable.filter((d) => d.kind === 'personal').map((d) => d.name);
    const tips = [
      unused.length ? `tinha ${unused.join(', ')} disponível` : null,
      !death.usedHealthstone && death.healthstoneKnown ? 'não usou Healthstone' : null,
      !death.usedHealthPotion ? 'não usou poção de vida' : null,
    ].filter(Boolean);
    const kb = death.killingBlow ? `${death.killingBlow.spellName} (${death.killingBlow.source})` : 'causa desconhecida';
    const lost = ops * (remainingMs / 1000);
    out.push({
      key: `death:${death.t}`,
      kind: 'death',
      title: `Morreu com ${fmtSec(remainingMs)} de luta pela frente`,
      detail: `Golpe final: ${kb}${death.causedBy ? `, depois de ${death.causedBy.name}` : ''}.`,
      tip: tips.length ? `Na hora: ${tips.join('; ')}.` : 'Veja no vídeo o que veio antes do golpe final.',
      lost,
      weightSec: remainingMs / 1000,
      times: [death.t],
      spellId: death.killingBlow?.spellId ?? null,
    });
  }

  const r = p.rotation;
  for (const f of r?.findings ?? []) {
    const l = findingLoss(f, s, ops, perCast);
    if (l) out.push(l);
  }

  for (const { mechanic: m, player: mp, times } of myMechanicFailures(s)) {
    out.push({
      key: `mech:${m.key}`,
      kind: m.kind === 'avoidable_damage' ? 'avoidable' : 'mechanic',
      title: `${m.name}: ${mp.count} erro${mp.count > 1 ? 's' : ''}`,
      detail: mp.message || m.summary,
      tip: m.tip,
      lost: null,
      weightSec: MECHANIC_SEC[m.severity] * Math.min(3, mp.count),
      times: times.length ? times : mp.firstT != null ? [mp.firstT] : [],
      spellId: m.spellId,
    });
  }
  return out.sort((a, b) => b.weightSec - a.weightSec);
}

function findingLoss(f: RotationFinding, s: Sample, ops: number, perCast: number): Loss | null {
  const base = { key: `rot:${f.id}`, title: f.title, detail: f.detail, tip: f.tip, times: f.times, spellId: f.spellId };
  // análises antigas não têm o tipo: os ids padrão das rotações escritas resolvem o principal
  const kind = f.kind ?? (f.id === 'cooldowns' ? 'cooldown' : f.id === 'always_be_casting' ? 'downtime' : '');
  if (kind === 'downtime') {
    const r = s.player.rotation!;
    if (r.downtimeMs < 3000) return null;
    return { ...base, kind: 'downtime', lost: ops * (r.downtimeMs / 1000), weightSec: r.downtimeMs / 1000 };
  }
  if (f.count === 0) return null;
  if (kind === 'proc') {
    const lost = perCast * f.count;
    return { ...base, kind: 'proc', lost, weightSec: ops > 0 ? lost / ops : f.count };
  }
  if (kind === 'dot_uptime') {
    // dano do DoT no tempo em que estava no alvo, estendido ao tempo em que faltou
    const dmg = spellAmount(s.player, f.spellId, subject(f.title));
    const lost = f.rate > 0.05 ? dmg * ((1 - f.rate) / f.rate) : null;
    return { ...base, kind: 'dot', lost, weightSec: lost != null && ops > 0 ? lost / ops : FINDING_SEC[f.importance] };
  }
  if (kind === 'cooldown') {
    const missing = (s.player.rotation?.cooldowns ?? []).reduce((n, c) => n + Math.max(0, c.possible - c.casts), 0);
    if (missing === 0) return null;
    return { ...base, kind: 'cooldown', lost: null, weightSec: missing * COOLDOWN_USE_SEC };
  }
  if (kind === 'resource_waste') return { ...base, kind: 'resource', lost: null, weightSec: (1 - f.rate) * 60 };
  return { ...base, kind: 'rotation', lost: null, weightSec: FINDING_SEC[f.importance] * Math.min(3, f.count) * (1 - f.rate + 0.2) };
}

// ---------------------------------------------------------------- onde a referência abriu vantagem

export const timelineOf = (p: PlayerStats) => (isHealer(p) ? p.healingTimeline : p.damageTimeline) ?? [];

export interface AdvantageWindow {
  startMs: number;
  endMs: number;
  mine: number;
  ref: number;
  /** casts de cada um no trecho (ms desde o início do trecho) */
  myCasts: { spellId: number; name: string; t: number }[];
  refCasts: { spellId: number; name: string; t: number }[];
  /** você morreu antes do fim do trecho */
  deadAt: number | null;
}

const castsIn = (p: PlayerStats, from: number, to: number) =>
  castsOf(p)
    .flatMap((c) => c.times.filter((t) => t >= from && t < to).map((t) => ({ spellId: c.spellId, name: c.name, t: t - from })))
    .filter((c) => c.spellId > 1)
    .sort((a, b) => a.t - b.t);

/**
 * Trechos (de `span` janelas) em que a referência fez mais que você, maiores primeiro e sem
 * sobrepor. Compara pelo tempo desde o pull, até onde as duas linhas do tempo vão.
 */
export function advantageWindows(me: Sample, ref: Sample, span = 3, count = 3): AdvantageWindow[] {
  const [a, b] = [timelineOf(me.player), timelineOf(ref.player)];
  const n = Math.min(a.length, b.length);
  if (n < span) return [];
  const scored: { i: number; gap: number }[] = [];
  for (let i = 0; i + span <= n; i++) {
    let gap = 0;
    for (let k = i; k < i + span; k++) gap += b[k] - a[k];
    scored.push({ i, gap });
  }
  scored.sort((x, y) => y.gap - x.gap);
  const picked: number[] = [];
  for (const { i, gap } of scored) {
    if (gap <= 0 || picked.length >= count) break;
    if (picked.every((j) => Math.abs(j - i) >= span)) picked.push(i);
  }
  const death = myDeaths(me)[0]?.death.t ?? null;
  return picked.map((i) => {
    const [from, to] = [i * BUCKET_MS, (i + span) * BUCKET_MS];
    const sum = (v: number[]) => v.slice(i, i + span).reduce((x, y) => x + y, 0);
    return {
      startMs: from,
      endMs: to,
      mine: sum(a),
      ref: sum(b),
      myCasts: castsIn(me.player, from, to),
      refCasts: castsIn(ref.player, from, to),
      deadAt: death != null && death < to ? death : null,
    };
  });
}

/**
 * Habilidades que contam na comparação de casts: as que dão dano/cura para um dos dois ou estão na
 * rotação (fora movimento, trinket, consumível).
 */
export function relevantSpells(...ps: PlayerStats[]): Set<string> {
  const out = new Set<string>();
  for (const p of ps) {
    for (const s of [...(p.damageBySpell ?? []), ...(p.healingBySpell ?? [])]) out.add(s.name);
    for (const s of [...(p.rotation?.prioritySt ?? []), ...(p.rotation?.priorityAoe ?? []), ...(p.rotation?.cooldowns ?? [])]) out.add(s.name);
  }
  return out;
}

/** O que mais diferencia os casts de um trecho: spells que a referência usou mais vezes. */
export function castDiff(w: AdvantageWindow, relevant?: Set<string>): { spellId: number; name: string; mine: number; ref: number }[] {
  const m = new Map<string, { spellId: number; name: string; mine: number; ref: number }>();
  for (const c of w.myCasts) (m.get(c.name) ?? m.set(c.name, { spellId: c.spellId, name: c.name, mine: 0, ref: 0 }).get(c.name)!).mine++;
  for (const c of w.refCasts) (m.get(c.name) ?? m.set(c.name, { spellId: c.spellId, name: c.name, mine: 0, ref: 0 }).get(c.name)!).ref++;
  return [...m.values()].filter((x) => x.ref - x.mine >= 1 && (!relevant || relevant.has(x.name))).sort((x, y) => y.ref - y.mine - (x.ref - x.mine)).slice(0, 4);
}

// ---------------------------------------------------------------- dano tomado a mais que a referência

export interface TakenRow {
  spellId: number;
  name: string;
  source: string;
  /** por minuto vivo */
  minePerMin: number;
  refPerMin: number;
  /** fração do seu dano tomado */
  share: number;
}

/** Habilidades em que você tomou bem mais dano (por minuto vivo) que a referência: candidatas a evitáveis. */
export function takenMoreThan(me: Sample, ref: Sample, ratio = 2, minShare = 0.03): TakenRow[] {
  const total = me.player.takenByAbility.reduce((n, x) => n + x.amount, 0) || 1;
  const [ma, ra] = [aliveMs(me) / 60_000, aliveMs(ref) / 60_000];
  const refBy = new Map<string, number>();
  for (const x of ref.player.takenByAbility) refBy.set(x.name, (refBy.get(x.name) ?? 0) + x.amount);
  const mine = new Map<string, TakenRow>();
  for (const x of me.player.takenByAbility) {
    if (x.spellId <= 1) continue; // corpo a corpo
    const row = mine.get(x.name) ?? { spellId: x.spellId, name: x.name, source: x.source, minePerMin: 0, refPerMin: (refBy.get(x.name) ?? 0) / ra, share: 0 };
    row.minePerMin += x.amount / ma;
    row.share += x.amount / total;
    mine.set(x.name, row);
  }
  return [...mine.values()].filter((r) => r.share >= minShare && r.minePerMin >= ratio * Math.max(1, r.refPerMin)).sort((a, b) => b.minePerMin - b.refPerMin - (a.minePerMin - a.refPerMin));
}

// ---------------------------------------------------------------- noite e evolução

export interface SoloPull {
  pull: Pull;
  player: PlayerStats;
  output: number;
  score: number | null;
  died: number | null;
  mechFails: number;
  losses: Loss[];
}

export interface SoloBoss {
  key: string;
  encounterId: number;
  pulls: SoloPull[];
  best: SoloPull | null;
  /** erros que aparecem em metade ou mais dos pulls (2+) */
  recurring: { key: string; title: string; kind: LossKind; pulls: number; spellId: number | null; tip: string }[];
}

export function soloPull(pull: Pull, chosen: string | null): SoloPull | null {
  const player = meIn(pull, chosen);
  if (!player) return null;
  const s = { pull, player };
  const ls = losses(s);
  return {
    pull,
    player,
    output: outputPerSec(s),
    score: player.rotation?.score ?? null,
    died: myDeaths(s)[0]?.death.t ?? null,
    mechFails: myMechanicFailures(s).reduce((n, f) => n + f.player.count, 0),
    losses: ls,
  };
}

/** Por boss: os seus pulls, o melhor e os erros que se repetem. */
export function soloNight(pulls: Pull[], chosen: string | null): SoloBoss[] {
  const groups = new Map<string, SoloPull[]>();
  for (const p of pulls) {
    if (p.dungeon) continue;
    const sp = soloPull(p, chosen);
    if (!sp) continue;
    groups.set(bossKey(p), [...(groups.get(bossKey(p)) ?? []), sp]);
  }
  return [...groups.entries()].map(([key, ps]) => {
    const best = [...ps].sort((a, b) => b.output - a.output)[0] ?? null;
    const seen = new Map<string, { key: string; title: string; kind: LossKind; pulls: number; spellId: number | null; tip: string }>();
    for (const sp of ps) {
      for (const l of new Set(sp.losses.map((x) => recurringKey(x)))) {
        const ex = sp.losses.find((x) => recurringKey(x) === l)!;
        const cur = seen.get(l) ?? { key: l, title: recurringTitle(ex), kind: ex.kind, pulls: 0, spellId: ex.spellId, tip: ex.tip };
        cur.pulls++;
        seen.set(l, cur);
      }
    }
    const recurring = [...seen.values()].filter((r) => r.pulls >= 2 && r.pulls >= ps.length / 2).sort((a, b) => b.pulls - a.pulls);
    return { key, encounterId: ps[0].pull.encounterId, pulls: ps, best, recurring };
  });
}

/** Referência justa: viveu pelo menos esta fração do seu tempo vivo (um pull curto só tem o burst do começo). */
export const FAIR_ALIVE = 0.6;
export const fairReference = (me: Sample, s: Sample) => (s.player.aliveMs ?? s.pull.analyzedMs) >= FAIR_ALIVE * aliveMs(me);

/** Mortes viram uma chave só (a hora muda de pull para pull). */
const recurringKey = (l: Loss) => (l.kind === 'death' ? 'death' : l.key);
const recurringTitle = (l: Loss) => (l.kind === 'death' ? 'Morre antes do fim' : l.title.replace(/: \d+ erros?$/, ''));

export interface SoloNightPoint {
  id: string;
  title: string;
  raidStartMs: number;
  pulls: number;
  bestOutput: number;
  /** mediana do aproveitamento da rotação */
  score: number | null;
  deathsPerPull: number;
  mechPerPull: number;
}

/** Um boss ao longo das noites salvas: o seu melhor output, rotação, mortes e erros por pull. */
export function soloEvolution(nights: { id: string; title: string; raidStartMs: number; pulls: Pull[] }[], boss: string, chosen: string | null): SoloNightPoint[] {
  const out: SoloNightPoint[] = [];
  for (const n of nights) {
    const sps = n.pulls.filter((p) => bossKey(p) === boss).flatMap((p) => soloPull(p, chosen) ?? []);
    if (!sps.length) continue;
    const scores = sps.map((x) => x.score).filter((x): x is number => x != null).sort((a, b) => a - b);
    out.push({
      id: n.id,
      title: n.title,
      raidStartMs: n.raidStartMs,
      pulls: sps.length,
      bestOutput: Math.max(...sps.map((x) => x.output)),
      score: scores.length ? scores[Math.floor(scores.length / 2)] : null,
      deathsPerPull: sps.filter((x) => x.died != null).length / sps.length,
      mechPerPull: sps.reduce((n2, x) => n2 + x.mechFails, 0) / sps.length,
    });
  }
  return out.sort((a, b) => a.raidStartMs - b.raidStartMs);
}

/** Bosses em que o personagem aparece nas noites salvas. */
export function soloBosses(nights: { pulls: Pull[] }[], chosen: string | null): { key: string; encounterId: number; nights: number }[] {
  const m = new Map<string, { key: string; encounterId: number; nights: number }>();
  for (const n of nights) {
    const keys = new Set(n.pulls.filter((p) => !p.dungeon && meIn(p, chosen)).map((p) => bossKey(p)));
    for (const k of keys) {
      const p = n.pulls.find((x) => bossKey(x) === k)!;
      const cur = m.get(k) ?? { key: k, encounterId: p.encounterId, nights: 0 };
      cur.nights++;
      m.set(k, cur);
    }
  }
  return [...m.values()].sort((a, b) => b.nights - a.nights);
}
