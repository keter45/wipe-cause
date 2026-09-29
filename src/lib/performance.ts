// Comparação de desempenho entre dois players da mesma spec: rotação (casts por minuto),
// cooldowns (quando e quantas vezes), consumíveis e setup (ilvl, status, talentos, itens).
//
// Na progressão não há tempo de kill: tudo é comparado por minuto vivo, e os cooldowns só
// dentro da janela em que os dois estavam vivos (0 até o menor tempo vivo).

import type { GearItem, PlayerStats, Pull, SetupStats, SpellCasts } from '../types';

export interface Sample {
  pull: Pull;
  player: PlayerStats;
}

/** Cooldowns longos: menor intervalo visto entre dois usos (por player) a partir disto. */
export const COOLDOWN_MIN_GAP_MS = 40_000;
/** Uso único num pull com pelo menos este tempo vivo também sugere cooldown longo. */
const SINGLE_USE_ALIVE_MS = 90_000;
/** Diferença de tempo que vale apontar no 1º uso de um cooldown. */
export const CD_LATE_MS = 5_000;

const aliveOf = (s: Sample) => Math.max(1, s.player.aliveMs ?? s.pull.analyzedMs);

/**
 * Casts por habilidade, juntando IDs diferentes com o mesmo nome (o log às vezes registra a
 * mesma magia com dois IDs: Charge, Flame Shock, Mutilate).
 */
export function castsOf(p: PlayerStats): SpellCasts[] {
  const byName = new Map<string, SpellCasts>();
  for (const c of p.casts ?? []) {
    const cur = byName.get(c.name);
    if (!cur) byName.set(c.name, { spellId: c.spellId, name: c.name, times: [...c.times] });
    else {
      // o ID com mais casts vira o principal (ícone)
      if (c.times.length > cur.times.length) cur.spellId = c.spellId;
      cur.times = [...cur.times, ...c.times].sort((a, b) => a - b);
    }
  }
  return [...byName.values()];
}
const minutes = (ms: number) => ms / 60_000;

export const isHealer = (p: PlayerStats) => p.role === 'healer';

/** Dano (ou cura, para healer) por segundo vivo. */
export function outputPerSec(s: Sample): number {
  const total = isHealer(s.player) ? s.player.healingDone : s.player.damageDone;
  return total / (aliveOf(s) / 1000);
}

const sameSample = (a: Sample, b: Sample) => a.pull.id === b.pull.id && a.player.guid === b.player.guid;

/**
 * Com quem comparar: a mesma spec neste pull e nos outros pulls do boss na noite
 * (inclusive o próprio player em outras tentativas), do maior para o menor output.
 */
export function candidates(me: Sample, nightPulls: Pull[]): Sample[] {
  const spec = me.player.specId;
  if (spec == null) return [];
  const pulls = nightPulls.some((p) => p.id === me.pull.id) ? nightPulls : [me.pull, ...nightPulls];
  const out: Sample[] = [];
  for (const pull of pulls) {
    if (pull.encounterId !== me.pull.encounterId || pull.difficultyId !== me.pull.difficultyId) continue;
    for (const player of pull.players) {
      const s = { pull, player };
      // pouco tempo vivo não dá base de comparação
      if (player.specId === spec && player.casts?.length && aliveOf(s) >= 30_000 && !sameSample(s, me)) out.push(s);
    }
  }
  return out.sort((a, b) => outputPerSec(b) - outputPerSec(a));
}

/**
 * Referência padrão: alguém que rendeu mais, de preferência neste mesmo pull; se ninguém
 * rendeu mais, o melhor da noite (a lista já vem do maior para o menor).
 */
export function defaultReference(me: Sample, list: Sample[]): Sample | null {
  const mine = outputPerSec(me);
  const better = list.filter((s) => outputPerSec(s) > mine);
  return better.find((s) => s.pull.id === me.pull.id) ?? better[0] ?? list[0] ?? null;
}

// ---- consumíveis

const POTION = /potion|poção|pocao|elixir|flask|frasco/i;
const HEALTH = /health|healing|vida|cura|healthstone|pedra de vida/i;

export const isCombatPotion = (name: string) => POTION.test(name) && !HEALTH.test(name);
const isHealthConsumable = (name: string) => HEALTH.test(name) && (POTION.test(name) || /healthstone|pedra de vida/i.test(name));

/** Magias fora da comparação de rotação: defensivos, interrupts e consumíveis. */
function utilityIds(p: PlayerStats): Set<number> {
  const ids = new Set<number>();
  p.defensivesUsed.forEach((d) => ids.add(d.spellId));
  p.interruptLog.forEach((u) => ids.add(u.spellId));
  for (const c of castsOf(p)) if (isCombatPotion(c.name) || isHealthConsumable(c.name)) ids.add(c.spellId);
  return ids;
}

// ---- cooldowns

export interface CooldownInfo {
  /** menor intervalo visto entre dois usos (≈ tempo de recarga); null se nunca repetiu */
  gapMs: number | null;
  /** fração dos pulls (da spec) em que foi usado: perto de 1 = faz parte do plano de dano/cura */
  usage: number;
}

/** Cooldown usado em pelo menos esta fração dos pulls da spec: não usar vira alerta. */
export const CORE_COOLDOWN_USAGE = 0.6;

/**
 * Cooldowns longos da spec, descobertos pelo padrão de uso na noite: nunca usados duas vezes
 * em menos de 40s, ou usados uma única vez em pulls longos.
 */
export function detectCooldowns(samples: Sample[]): Map<number, CooldownInfo> {
  const acc = new Map<number, { gap: number | null; maxCount: number; longSingle: boolean; excluded: boolean; used: number }>();
  for (const s of samples) {
    const skip = utilityIds(s.player);
    for (const c of castsOf(s.player)) {
      const a = acc.get(c.spellId) ?? { gap: null, maxCount: 0, longSingle: false, excluded: false, used: 0 };
      a.used++;
      if (skip.has(c.spellId)) a.excluded = true;
      const times = [...c.times].sort((x, y) => x - y);
      for (let i = 1; i < times.length; i++) {
        const g = times[i] - times[i - 1];
        a.gap = a.gap == null ? g : Math.min(a.gap, g);
      }
      a.maxCount = Math.max(a.maxCount, times.length);
      if (times.length === 1 && aliveOf(s) >= SINGLE_USE_ALIVE_MS) a.longSingle = true;
      acc.set(c.spellId, a);
    }
  }
  const out = new Map<number, CooldownInfo>();
  for (const [id, a] of acc) {
    if (a.excluded) continue;
    const repeatedSlowly = a.gap != null && a.gap >= COOLDOWN_MIN_GAP_MS;
    const onlySingles = a.gap == null && a.maxCount === 1 && a.longSingle;
    if (repeatedSlowly || onlySingles) out.set(id, { gapMs: a.gap, usage: a.used / Math.max(1, samples.length) });
  }
  return out;
}

export interface CooldownRow {
  spellId: number;
  name: string;
  mine: number[];
  ref: number[];
  gapMs: number | null;
  /** usado na maioria dos pulls da spec (não é utilidade de ocasião) */
  core: boolean;
  /** 1º uso: meu - referência (ms); null se um dos dois não usou */
  firstDelta: number | null;
  /** usos que caberiam na janela, pelo intervalo visto */
  possible: number | null;
}

/** Cooldowns dos dois dentro da janela em que ambos estavam vivos. */
export function compareCooldowns(me: Sample, ref: Sample, cds: Map<number, CooldownInfo>): { windowMs: number; rows: CooldownRow[] } {
  const windowMs = Math.min(aliveOf(me), aliveOf(ref));
  const names = new Map<number, string>();
  const timesOf = (s: Sample, id: number) =>
    castsOf(s.player).find((c) => c.spellId === id)?.times.filter((t) => t <= windowMs).sort((a, b) => a - b) ?? [];
  for (const s of [me, ref]) for (const c of castsOf(s.player)) if (cds.has(c.spellId)) names.set(c.spellId, c.name);
  const rows: CooldownRow[] = [...names].map(([spellId, name]) => {
    const mine = timesOf(me, spellId);
    const refT = timesOf(ref, spellId);
    const gapMs = cds.get(spellId)?.gapMs ?? null;
    return {
      spellId,
      name,
      mine,
      ref: refT,
      gapMs,
      core: (cds.get(spellId)?.usage ?? 0) >= CORE_COOLDOWN_USAGE,
      firstDelta: mine.length && refT.length ? mine[0] - refT[0] : null,
      possible: gapMs ? Math.floor(windowMs / gapMs) + 1 : null,
    };
  });
  // mais usados pela referência primeiro (os cooldowns principais da spec)
  rows.sort((a, b) => Number(b.core) - Number(a.core) || b.ref.length - a.ref.length || b.mine.length - a.mine.length || a.name.localeCompare(b.name));
  return { windowMs, rows };
}

// ---- rotação

export type RotationFlag = 'missing' | 'low' | 'high' | 'extra' | null;

export interface RotationRow {
  spellId: number;
  name: string;
  mineCasts: number;
  refCasts: number;
  mineCpm: number;
  refCpm: number;
  /** % do dano (ou cura) total que veio da habilidade */
  mineShare: number | null;
  refShare: number | null;
  /** faz dano/cura ou é usada com frequência: entra na leitura da rotação */
  core: boolean;
  flag: RotationFlag;
}

/** Diferença de ritmo que vale apontar (fração da referência). */
const CPM_TOLERANCE = 0.25;
/** Ritmo mínimo (casts/min) da referência para uma habilidade contar como parte da rotação. */
const MIN_ROTATION_CPM = 0.5;
/** Sem dano/cura próprio, só conta como rotação se usada pelo menos isto por minuto. */
const FREQUENT_CPM = 3;
/** Fatia mínima do dano/cura para a habilidade contar como rotação. */
const MIN_SHARE = 1;

/** Fatia do dano/cura por nome da habilidade (o cast e o dano às vezes têm IDs diferentes: Rapid Fire). */
function shares(s: Sample): Map<string, number> {
  const list = (isHealer(s.player) ? s.player.healingBySpell : s.player.damageBySpell) ?? [];
  const total = list.reduce((a, x) => a + x.amount, 0);
  const m = new Map<string, number>();
  if (total > 0) for (const x of list) if (!x.pet) m.set(x.name, (m.get(x.name) ?? 0) + (x.amount / total) * 100);
  return m;
}

/** Casts por minuto vivo de cada habilidade (sem cooldowns longos, defensivos e consumíveis). */
export function compareRotation(me: Sample, ref: Sample, cds: Map<number, CooldownInfo>): RotationRow[] {
  const skip = new Set([...utilityIds(me.player), ...utilityIds(ref.player), ...cds.keys()]);
  const [mMin, rMin] = [minutes(aliveOf(me)), minutes(aliveOf(ref))];
  const [mShare, rShare] = [shares(me), shares(ref)];
  const rows = new Map<number, RotationRow>();
  const row = (spellId: number, name: string) =>
    rows.get(spellId) ??
    rows
      .set(spellId, { spellId, name, mineCasts: 0, refCasts: 0, mineCpm: 0, refCpm: 0, mineShare: null, refShare: null, core: false, flag: null })
      .get(spellId)!;
  // mesma magia com IDs diferentes entre os dois: casa pelo nome
  const idByName = new Map<string, number>();
  const add = (c: SpellCasts, k: 'mineCasts' | 'refCasts') => {
    if (skip.has(c.spellId)) return;
    const id = idByName.get(c.name) ?? c.spellId;
    idByName.set(c.name, id);
    row(id, c.name)[k] = c.times.length;
  };
  castsOf(ref.player).forEach((c) => add(c, 'refCasts'));
  castsOf(me.player).forEach((c) => add(c, 'mineCasts'));
  for (const r of rows.values()) {
    r.mineCpm = r.mineCasts / mMin;
    r.refCpm = r.refCasts / rMin;
    r.mineShare = mShare.get(r.name) ?? null;
    r.refShare = rShare.get(r.name) ?? null;
    r.core = Math.max(r.mineShare ?? 0, r.refShare ?? 0) >= MIN_SHARE || Math.max(r.mineCpm, r.refCpm) >= FREQUENT_CPM;
    if (!r.core) continue;
    if (r.refCpm >= MIN_ROTATION_CPM && r.mineCasts === 0) r.flag = 'missing';
    else if (r.refCpm >= MIN_ROTATION_CPM && r.mineCpm < r.refCpm * (1 - CPM_TOLERANCE)) r.flag = 'low';
    else if (r.mineCpm >= MIN_ROTATION_CPM && r.refCasts === 0) r.flag = 'extra';
    else if (r.mineCpm >= MIN_ROTATION_CPM && r.mineCpm > r.refCpm * (1 + CPM_TOLERANCE)) r.flag = 'high';
  }
  return [...rows.values()].sort((a, b) => Number(b.core) - Number(a.core) || b.refCpm + b.mineCpm - (a.refCpm + a.mineCpm));
}

/** Casts por minuto de tudo (menos consumíveis): ritmo geral, "ABC" da rotação. */
export function totalCpm(s: Sample): number {
  const skip = utilityIds(s.player);
  const n = castsOf(s.player).filter((c) => !skip.has(c.spellId)).reduce((a, c) => a + c.times.length, 0);
  return n / minutes(aliveOf(s));
}

// ---- consumíveis

export interface ConsumableUse {
  spellId: number;
  name: string;
  times: number[];
}

export const combatPotions = (s: Sample): ConsumableUse[] =>
  castsOf(s.player).filter((c) => isCombatPotion(c.name)).map((c) => ({ spellId: c.spellId, name: c.name, times: c.times }));

// ---- setup

export const SECONDARY: { key: keyof SetupStats; label: string }[] = [
  { key: 'crit', label: 'Crítico' },
  { key: 'haste', label: 'Aceleração' },
  { key: 'mastery', label: 'Maestria' },
  { key: 'versatility', label: 'Versatilidade' },
];

/** Cada secundário como % da soma dos quatro (a "distribuição de status"). */
export function statSplit(stats: SetupStats): Record<string, number> {
  const total = SECONDARY.reduce((a, s) => a + stats[s.key], 0) || 1;
  return Object.fromEntries(SECONDARY.map((s) => [s.key, (stats[s.key] / total) * 100]));
}

export const SLOT_NAMES = [
  'Cabeça', 'Pescoço', 'Ombros', 'Camisa', 'Peito', 'Cintura', 'Pernas', 'Pés', 'Pulsos', 'Mãos',
  'Anel 1', 'Anel 2', 'Berloque 1', 'Berloque 2', 'Costas', 'Arma', 'Mão secundária', 'Tabardo',
];

export interface ItemRow {
  slot: number;
  mine: GearItem | null;
  ref: GearItem | null;
  /** a referência tem encantamento aqui e eu não */
  missingEnchant: boolean;
  missingGems: number;
}

export function compareItems(mine: GearItem[], ref: GearItem[]): ItemRow[] {
  const slots = [...new Set([...mine, ...ref].map((i) => i.slot))].filter((s) => s !== 3 && s !== 17).sort((a, b) => a - b);
  return slots.map((slot) => {
    const m = mine.find((i) => i.slot === slot) ?? null;
    const r = ref.find((i) => i.slot === slot) ?? null;
    return {
      slot,
      mine: m,
      ref: r,
      missingEnchant: !!r?.enchant && !m?.enchant,
      missingGems: Math.max(0, (r?.gems.length ?? 0) - (m?.gems.length ?? 0)),
    };
  });
}

type Talent = [number, number, number];

/** Talentos (entradas) que só um dos dois tem, e os que os dois têm com rank diferente. */
export function talentDiff(mine: Talent[], ref: Talent[]) {
  const m = new Map(mine.map((t) => [t[1], t]));
  const r = new Map(ref.map((t) => [t[1], t]));
  return {
    onlyMine: mine.filter((t) => !r.has(t[1])),
    onlyRef: ref.filter((t) => !m.has(t[1])),
    /** [meu, da referência] */
    rank: mine.filter((t) => r.has(t[1]) && r.get(t[1])![2] !== t[2]).map((t) => [t, r.get(t[1])!] as [Talent, Talent]),
  };
}

// ---- resumo

export interface PerfInsight {
  tone: 'bad' | 'warn' | 'good';
  text: string;
  spellId?: number;
}

const sec = (ms: number) => `${Math.round(Math.abs(ms) / 1000)}s`;

/** Os pontos que mais importam, na ordem de impacto. */
export function perfInsights(me: Sample, ref: Sample, cds: Map<number, CooldownInfo>): PerfInsight[] {
  const out: PerfInsight[] = [];
  const [mo, ro] = [outputPerSec(me), outputPerSec(ref)];
  const what = isHealer(me.player) ? 'Cura' : 'Dano';
  if (ro > 0) {
    const diff = ((mo - ro) / ro) * 100;
    if (Math.abs(diff) >= 3)
      out.push({ tone: diff < 0 ? (diff < -15 ? 'bad' : 'warn') : 'good', text: `${what} por segundo vivo ${Math.abs(diff).toFixed(0)}% ${diff < 0 ? 'abaixo' : 'acima'} da referência` });
  }
  for (const r of compareCooldowns(me, ref, cds).rows) {
    if (!r.core) continue; // utilidade de ocasião (Heroic Leap, Time Warp): sem alerta
    if (r.ref.length > r.mine.length)
      out.push({ tone: 'bad', spellId: r.spellId, text: `${r.name}: ${r.mine.length} uso${r.mine.length === 1 ? '' : 's'} contra ${r.ref.length} da referência no mesmo tempo` });
    else if (r.firstDelta != null && r.firstDelta > CD_LATE_MS)
      out.push({ tone: 'warn', spellId: r.spellId, text: `${r.name}: 1º uso ${sec(r.firstDelta)} depois da referência` });
    else if (r.firstDelta != null && r.firstDelta < -CD_LATE_MS)
      out.push({ tone: 'warn', spellId: r.spellId, text: `${r.name}: 1º uso ${sec(r.firstDelta)} antes da referência` });
  }
  for (const r of compareRotation(me, ref, cds)) {
    if (r.flag === 'missing') out.push({ tone: 'bad', spellId: r.spellId, text: `${r.name}: não usou (referência: ${r.refCpm.toFixed(1)}/min)` });
    else if (r.flag === 'low') out.push({ tone: 'warn', spellId: r.spellId, text: `${r.name}: ${r.mineCpm.toFixed(1)}/min contra ${r.refCpm.toFixed(1)}/min` });
  }
  if (combatPotions(ref).length > 0 && combatPotions(me).length === 0) out.push({ tone: 'warn', text: 'Sem poção de combate (a referência usou)' });
  const [ms, rs] = [me.player.setup, ref.player.setup];
  if (ms && rs) {
    const enchants = compareItems(ms.items, rs.items).filter((i) => i.missingEnchant);
    if (enchants.length) out.push({ tone: 'warn', text: `Sem encantamento: ${enchants.map((i) => SLOT_NAMES[i.slot]).join(', ')}` });
    const t = talentDiff(ms.talents, rs.talents);
    if (t.onlyRef.length) out.push({ tone: 'warn', text: `${t.onlyRef.length} talento${t.onlyRef.length > 1 ? 's' : ''} diferente${t.onlyRef.length > 1 ? 's' : ''} da referência` });
  }
  const rank = { bad: 0, warn: 1, good: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
