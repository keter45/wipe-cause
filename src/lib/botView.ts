// O que a tela do robô mostra além das seções da comparação: a ficha do que o robô jogou (lida do
// perfil salvo, então vale também para simulações antigas), o % do potencial e quanto cada achado
// das decisões custou, para dizer o que mudar primeiro.

import type { PlayerStats } from '../types';
import type { BotRun } from './botSim';
import type { BotChoice, BotDecisions } from './botDecisions';
import type { DecisionFinding } from './decisions';
import { outputPerSec, type Sample } from './performance';

export type Have = 'had' | 'missing' | 'default';

export interface SimFacts {
  durationMs: number;
  bossEndPct: number;
  /** ms */
  lust: number | null;
  pi: number[];
  adds: { from: number; to: number; count: number }[];
  noTarget: { from: number; to: number }[];
  /** momentos de movimento do padrão (LightMovement: aos 15s e a cada ~40s) */
  movement: number[];
  consumables: { kind: 'flask' | 'food' | 'rune'; have: Have }[];
  raidBuffs: { key: string; spellId: number; name: string; on: boolean }[];
  race: string;
  raceGuessed: boolean;
}

/** Buffs e debuffs de raid do perfil, com o spell para o ícone. */
export const RAID_BUFF_INFO: Record<string, { spellId: number; name: string }> = {
  arcane_intellect: { spellId: 1459, name: 'Arcane Intellect' },
  battle_shout: { spellId: 6673, name: 'Battle Shout' },
  mark_of_the_wild: { spellId: 1126, name: 'Mark of the Wild' },
  power_word_fortitude: { spellId: 21562, name: 'Power Word: Fortitude' },
  skyfury: { spellId: 462854, name: 'Skyfury' },
  blessing_of_the_bronze: { spellId: 381748, name: 'Blessing of the Bronze' },
  chaos_brand: { spellId: 1490, name: 'Chaos Brand' },
  mystic_touch: { spellId: 8647, name: 'Mystic Touch' },
  hunters_mark: { spellId: 257284, name: "Hunter's Mark" },
};

const MOVE_FIRST_MS = 15_000;
const MOVE_EVERY_MS = 40_000;
const ms = (s: string | undefined) => Math.round(Number(s ?? 0) * 1000);

/** A ficha da simulação, lida do perfil que foi para o SimC. */
export function simFacts(run: BotRun): SimFacts {
  const opt = new Map<string, string>();
  const events: string[] = [];
  for (const line of run.input.split('\n')) {
    const m = /^([a-z_.]+)\+?=(.*)$/.exec(line.trim());
    if (!m) continue;
    if (m[1] === 'raid_events') events.push(m[2]);
    else opt.set(m[1], m[2]);
  }
  const durationMs = ms(opt.get('max_time')) || run.windowMs;
  const adds: SimFacts['adds'] = [];
  const noTarget: SimFacts['noTarget'] = [];
  for (const e of events) {
    const kv = Object.fromEntries(e.replace(/^\//, '').split(',').slice(1).map((x) => x.split('=') as [string, string]));
    const from = ms(kv.first);
    const to = from + ms(kv.duration);
    if (e.startsWith('/adds')) adds.push({ from, to, count: Number(kv.count) || 1 });
    else if (e.startsWith('/invulnerable')) noTarget.push({ from, to });
  }
  const movement: number[] = [];
  for (let t = MOVE_FIRST_MS; t < durationMs; t += MOVE_EVERY_MS) movement.push(t);
  const have = (kind: 'flask' | 'food' | 'rune', option: string): Have =>
    opt.get(option) === 'disabled' ? 'missing' : run.assumed.includes(kind) ? 'default' : 'had';
  return {
    durationMs,
    bossEndPct: Number(opt.get('enemy_death_pct') ?? run.bossEndPct) || 0,
    lust: opt.get('override.bloodlust') === '1' ? ms(opt.get('bloodlust_time')) : null,
    pi: (opt.get('external_buffs.power_infusion') ?? '').split('/').filter(Boolean).map(ms),
    adds,
    noTarget,
    movement,
    consumables: [
      { kind: 'flask', have: have('flask', 'flask') },
      { kind: 'food', have: have('food', 'food') },
      { kind: 'rune', have: have('rune', 'augmentation') },
    ],
    raidBuffs: Object.entries(RAID_BUFF_INFO).map(([key, info]) => ({ key, ...info, on: opt.get(`override.${key}`) === '1' })),
    race: opt.get('race') ?? '',
    raceGuessed: run.assumed.includes('race'),
  };
}

/** "dark_iron_dwarf" -> "Dark Iron Dwarf" */
export const raceName = (r: string) =>
  r
    .replace(/_(alliance|horde)$/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

// ---------------------------------------------------------------- % do potencial

export interface Potential {
  /** dano por segundo vivo do player ÷ média do robô */
  pct: number;
  /** a faixa do robô nas 1000 lutas, na mesma escala (média = 1) */
  low: number;
  high: number;
}

export function potential(me: Sample, run: BotRun): Potential | null {
  const mean = run.dps.mean;
  if (!(mean > 0)) return null;
  return { pct: outputPerSec(me) / mean, low: run.dps.min / mean, high: run.dps.max / mean };
}

// ---------------------------------------------------------------- o que mudar primeiro

/** Dano médio de um cast: o do player quando ele usou a habilidade, senão o do robô (luta típica). */
function perCast(id: number, name: string | undefined, p: PlayerStats, run: BotRun): number {
  const of = (list: { spellId: number; name: string; amount: number }[] | undefined, casts: { spellId: number; name: string; times: number[] }[] | undefined) => {
    const n = (casts ?? []).filter((c) => c.spellId === id || c.name === name).reduce((s, c) => s + c.times.length, 0);
    const dmg = (list ?? []).filter((s) => s.spellId === id || s.name === name).reduce((s, x) => s + x.amount, 0);
    return n > 0 && dmg > 0 ? dmg / n : 0;
  };
  return of(p.damageBySpell, p.casts) || of(run.damageBySpell, run.casts);
}

export interface Fix {
  key: string;
  /** dano estimado perdido no pull */
  damage: number;
  item: DecisionFinding | BotChoice;
}

/**
 * Quanto cada achado custou, aproximado: casts trocados × diferença de dano por cast; procs perdidos
 * a mais que o robô × o dano de quem gasta; usos perdidos de um cooldown segurado × o dano dele.
 * Alinhamento não tem estimativa (fica de fora do ranking).
 */
export function fixes(me: Sample, run: BotRun, d: BotDecisions, keyOf: (x: DecisionFinding | BotChoice) => string): Fix[] {
  const p = me.player;
  const out: Fix[] = [];
  for (const c of d.choices) {
    const diff = perCast(c.bot.spellId, c.bot.name, p, run) - perCast(c.spell.spellId, c.spell.name, p, run);
    if (diff > 0) out.push({ key: keyOf(c), damage: diff * c.times.length, item: c });
  }
  for (const f of d.findings) {
    if (f.kind === 'proc_lost') {
      const extra = Math.max(0, (f.you - f.tops) * f.n);
      const c = f.consumers[0];
      out.push({ key: keyOf(f), damage: c ? extra * perCast(c.spellId, c.name, p, run) : 0, item: f });
    } else if (f.kind === 'cd_held') {
      const cd = d.ref.cds[f.spellId]?.cd;
      const uses = cd ? ((f.you - f.tops) * f.times.length) / cd : 0;
      out.push({ key: keyOf(f), damage: Math.max(0, uses) * perCast(f.spellId, f.name, p, run), item: f });
    }
  }
  return out.filter((x) => x.damage > 0).sort((a, b) => b.damage - a.damage);
}
