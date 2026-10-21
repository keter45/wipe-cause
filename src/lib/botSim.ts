// "Comparar com o robô" (docs/simulation.md): roda o SimulationCraft com o perfil do pull e
// transforma o resultado num Sample, para as seções do Desempenho compararem como fazem com um top.
//
// Uma simulação com muitas iterações dá as médias (DPS, dano por habilidade, casts); algumas
// iterações sozinhas dão sequências de casts, e fica a de DPS mais perto da média.

import type { Pull, PlayerStats, SpellAmount, SpellCasts } from '../types';
import { simcRun, simcSavedGet, simcSavedPut } from './api';
import { buildSimProfile, pickSimPull, type SimAssumption } from './simProfile';
import { talentTree } from './talents';
import type { Sample } from './performance';
import { BUCKET_MS } from './solo';

export const BOT_ITERATIONS = 1000;
/**
 * Iterações avulsas: cada uma dá uma sequência de casts com os buffs ativos em cada cast. A de DPS
 * mais perto da média vira a dos gráficos; todas juntas são a referência das decisões
 * (botDecisions.ts), como os pulls dos tops.
 */
export const SEQUENCE_SEEDS = 20;
/** Versão do que salvamos: mudou o formato, a simulação antiga é refeita. */
const SAVE_VERSION = 2;
export const BOT_GUID = 'simc-bot';
/** Pulls que começam a menos disso um do outro são o mesmo pull. */
const SAME_PULL_MS = 10_000;

/** Ações do SimC que não são casts no log (ataque automático). */
const NOT_CASTS = new Set(['auto_attack', 'auto_shot', 'melee', 'main_hand', 'off_hand']);

export interface BotRun {
  version: number;
  key: string;
  /** ISO */
  created: string;
  commit: string;
  banner: string;
  /** o pull simulado (o mais longo limpo do dia) */
  pullStartMs: number;
  pullNumber: number;
  windowMs: number;
  clean: boolean;
  assumed: SimAssumption[];
  bossEndPct: number;
  iterations: number;
  dps: { mean: number; min: number; max: number; error: number };
  /** o que as seções leem do robô */
  casts: SpellCasts[];
  damageBySpell: SpellAmount[];
  damageTimeline: number[];
  /** o perfil usado (para conferir ou rodar no Raidbots) */
  input: string;
  /** as lutas avulsas: casts [ms, spell] e, em cada cast, os buffs ativos [id, cargas, id, cargas…] */
  seqs: BotSeq[];
  /** nome de cada habilidade e de cada buff do SimC (buff: o nome interno, "precise_shots") */
  names: Record<number, string>;
  buffNames: Record<number, string>;
}

export interface BotSeq {
  casts: [number, number][];
  active: number[][];
}

/** A noite de um pull: a data local, com a madrugada contando para o dia anterior. */
const nightOf = (startMs: number) => new Date(startMs - 6 * 3600_000).toISOString().slice(0, 10);

/** Uma simulação por player + boss + dificuldade + noite. */
export const botKey = (ref: Pull, playerName: string) => `${playerName}_${ref.encounterId}_${ref.difficultyId}_${nightOf(ref.startMs)}`;

export async function loadBotRun(ref: Pull, playerName: string): Promise<BotRun | null> {
  const run = await simcSavedGet<BotRun>(botKey(ref, playerName)).catch(() => null);
  return run && run.version === SAVE_VERSION ? run : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type SimcPlayer = any;

const first = (json: any): SimcPlayer => json?.sim?.players?.[0];

function sequence(p: SimcPlayer): SpellCasts[] {
  const by = new Map<number, SpellCasts>();
  for (const a of p?.collected_data?.action_sequence ?? []) {
    if (!a.id || NOT_CASTS.has(a.name)) continue;
    const cur: SpellCasts = by.get(a.id) ?? { spellId: a.id, name: a.spell_name || a.name, times: [] };
    cur.times.push(Math.round(a.time * 1000));
    by.set(a.id, cur);
  }
  return [...by.values()].sort((a, b) => b.times.length - a.times.length || a.spellId - b.spellId);
}

/** A luta avulsa no formato salvo, juntando os nomes. */
function seqOf(p: SimcPlayer, names: Record<number, string>, buffNames: Record<number, string>): BotSeq {
  const out: BotSeq = { casts: [], active: [] };
  for (const a of p?.collected_data?.action_sequence ?? []) {
    if (!a.id || NOT_CASTS.has(a.name)) continue;
    names[a.id] ??= a.spell_name || a.name;
    out.casts.push([Math.round(a.time * 1000), a.id]);
    out.active.push(
      (a.buffs ?? []).filter((b: any) => b.id).flatMap((b: any) => {
        buffNames[b.id] ??= b.name;
        return [b.id, b.stacks ?? 1];
      }),
    );
  }
  return out;
}

function damageBySpell(p: SimcPlayer): SpellAmount[] {
  const out = new Map<string, SpellAmount>();
  const add = (s: any, pet: boolean) => {
    if (s.type !== 'damage' || !(s.compound_amount > 0)) return;
    const name = s.spell_name || s.name;
    const cur = out.get(`${name}:${pet}`);
    if (cur) cur.amount += s.compound_amount;
    else out.set(`${name}:${pet}`, { spellId: s.id ?? 0, name, amount: s.compound_amount, pet });
  };
  for (const s of p?.stats ?? []) add(s, false);
  for (const pet of Object.values(p?.stats_pets ?? {}) as any[]) for (const s of pet ?? []) add(s, true);
  return [...out.values()].map((s) => ({ ...s, amount: Math.round(s.amount) })).sort((a, b) => b.amount - a.amount);
}

/** DPS por segundo do SimC -> dano por janela de 5s, como o damageTimeline do núcleo. */
function timeline(p: SimcPlayer): number[] {
  const perSec: number[] = p?.collected_data?.timeline_dmg?.data ?? [];
  const per = BUCKET_MS / 1000;
  const out: number[] = [];
  for (let i = 0; i < perSec.length; i += per) out.push(Math.round(perSec.slice(i, i + per).reduce((a, b) => a + b, 0)));
  return out;
}

export type BotStep = 'profile' | 'simulating' | 'sequence';

/**
 * Simula o player da noite e salva. `ref` é o pull aberto (dá o boss e o dia); o simulado é o
 * escolhido por `pickSimPull`.
 */
export async function runBot(nightPulls: Pull[], ref: Pull, playerName: string, onStep: (s: BotStep, progress?: number) => void): Promise<BotRun> {
  onStep('profile');
  const pick = pickSimPull(nightPulls, ref, playerName);
  if (!pick) throw new NoPullError();
  const tree = await talentTree(pick.player.specId!);
  const profile = buildSimProfile(pick, tree);
  if (!profile) throw new NoPullError();

  onStep('simulating');
  const main = await simcRun(`${profile.input}iterations=${BOT_ITERATIONS}\n`, { onProgress: (f) => onStep('simulating', f) });
  const p = first(main.json);
  const dps = p?.collected_data?.dps ?? {};
  const mean = Number(dps.mean) || 0;

  // a sequência de casts de uma iteração só: a mais perto da média entre algumas
  onStep('sequence');
  let best: { seq: SpellCasts[]; off: number } | null = null;
  const seqs: BotSeq[] = [];
  const names: Record<number, string> = {};
  const buffNames: Record<number, string> = {};
  for (let seed = 1; seed <= SEQUENCE_SEEDS; seed++) {
    const one = first((await simcRun(`${profile.input}iterations=1\nseed=${seed}\n`)).json);
    onStep('sequence', seed / SEQUENCE_SEEDS);
    seqs.push(seqOf(one, names, buffNames));
    const off = Math.abs((Number(one?.collected_data?.dps?.mean) || 0) - mean);
    if (!best || off < best.off) best = { seq: sequence(one), off };
  }

  const run: BotRun = {
    version: SAVE_VERSION,
    key: botKey(ref, playerName),
    created: new Date().toISOString(),
    commit: main.commit,
    banner: main.banner,
    pullStartMs: pick.pull.startMs,
    pullNumber: pick.pull.pullNumber,
    windowMs: pick.windowMs,
    clean: pick.clean,
    assumed: profile.assumed,
    bossEndPct: profile.bossEndPct,
    iterations: BOT_ITERATIONS,
    dps: { mean, min: Number(dps.min) || 0, max: Number(dps.max) || 0, error: Number(dps.mean_std_dev) || 0 },
    casts: best?.seq ?? sequence(p),
    damageBySpell: damageBySpell(p),
    damageTimeline: timeline(p),
    input: profile.input,
    seqs,
    names,
    buffNames,
  };
  await simcSavedPut(run.key, run);
  return run;
}

export class NoPullError extends Error {}

/** O pull simulado e o player nele (o "você" da comparação com o robô). */
export function botMe(nightPulls: Pull[], run: BotRun, playerName: string): Sample | null {
  // o mesmo pull analisado de outra fonte (log local x Warcraft Logs) começa uns ms diferente
  const pull = nightPulls.find((p) => p.startMs === run.pullStartMs) ?? nightPulls.find((p) => Math.abs(p.startMs - run.pullStartMs) < SAME_PULL_MS);
  const player = pull?.players.find((p) => p.name === playerName);
  return pull && player ? { pull, player } : null;
}

/** O robô como um Sample: o mesmo pull, com um player que tem os números do SimC. */
export function botSample(me: Sample, run: BotRun): Sample {
  const window = run.windowMs;
  const bot: PlayerStats = {
    ...me.player,
    guid: BOT_GUID,
    name: 'SimulationCraft',
    damageDone: Math.round(run.dps.mean * (window / 1000)),
    dps: run.dps.mean,
    healingDone: 0,
    hps: 0,
    damageTaken: 0,
    deaths: 0,
    healthPotions: 0,
    healthstones: 0,
    defensivesUsed: [],
    takenByAbility: [],
    interrupts: 0,
    interruptAttempts: 0,
    interruptLog: [],
    casts: run.casts,
    damageBySpell: run.damageBySpell,
    healingBySpell: [],
    aliveMs: window,
    damageTimeline: run.damageTimeline,
    healingTimeline: [],
    rotation: undefined,
  };
  return { pull: { ...me.pull, players: [bot], deaths: [], cutoffT: window, analyzedMs: window }, player: bot };
}
