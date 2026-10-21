// Perfil do SimulationCraft a partir do log ("comparar com o robô", docs/simulation.md).
//
// Tudo sai do pull: equipamento, talentos, buffs e consumíveis daquele pull, a duração em que o
// player esteve vivo, os alvos e o tempo sem alvo da raid. O movimento é o que a luta pediu (o
// quartil dos DPS que menos andaram, trecho a trecho), não o do player; análises antigas, sem as
// posições medidas, ficam com o padrão (LightMovement).

import type { Pull, PlayerStats, StartAura } from '../types';
import { SPEC_NAMES } from './specs';
import { bossKey } from './night';
import { myDeaths } from './solo';
import type { TalentTree } from './talents';

/** Pulls do "mesmo dia": até tantas horas do pull de referência. */
const SAME_DAY_MS = 12 * 3600_000;
/** Menos que isso não dá uma simulação que preste. */
export const MIN_SIM_MS = 30_000;
/** Trechos de alvos (o núcleo conta inimigos acertados a cada 2s). */
const TARGET_BUCKET_MS = 2_000;
/** Mediana móvel dos alvos (em trechos): tira o vai e vem de quem troca de alvo. */
const TARGET_SMOOTH = 3;
/** Janelas de adds e de tempo sem alvo mais curtas que isso ficam de fora. */
const MIN_EVENT_MS = 6_000;
/**
 * Quantos inimigos havia para acertar: o quantil 75% dos DPS em cada trecho. A mediana subestima
 * os packs de adds (metade da raid fica no boss); o máximo pega quem espalha DoT em tudo.
 */
const TARGET_QUANTILE = 0.75;
/** Trechos em que o movimento da luta é medido. */
const MOVE_CHUNK_MS = 30_000;
/** O movimento da luta: o quanto andaram os DPS que menos andaram (o quartil de baixo). */
const MOVE_QUANTILE = 0.25;
/** Com menos DPS vivos no trecho que isso, não dá para dizer o que a luta pediu. */
const MOVE_MIN_PLAYERS = 3;
/** Cada deslocamento do robô, em segundos (o log tem pulos curtos: desviar, sair de área). */
const MOVE_BOUT_S = 1.5;
/** Movimento padrão (LightMovement), quando a análise não tem o movimento medido. */
const LIGHT_MOVEMENT = 'movement,players_only=1,cooldown=40,cooldown_stddev=10,distance=15,move_distance_min=10,move_distance_max=20,first=15';

// ---------------------------------------------------------------- escolha do pull

export interface SimPick {
  pull: Pull;
  player: PlayerStats;
  /** janela simulada: do pull até a morte do player, o corte ou o fim */
  windowMs: number;
  /** pull em que o boss morreu */
  kill: boolean;
  /** ficou vivo até o fim */
  alive: boolean;
}

/** Até onde o player jogou: a primeira morte que conta ou o fim do tempo analisado. */
export function playedMs(pull: Pull, player: PlayerStats): number {
  const end = pull.cutoffT ?? pull.analyzedMs;
  const death = myDeaths({ pull, player }).map((d) => d.death.t).sort((a, b) => a - b)[0];
  return Math.max(0, Math.min(end, death ?? end));
}

/**
 * O pull para simular: do mesmo boss e dificuldade, no mesmo dia do pull de referência. A kill;
 * sem kill, o mais longo em que o player não morreu; sem nenhum assim, o de mais tempo vivo.
 */
export function pickSimPull(pulls: Pull[], ref: Pull, playerName: string): SimPick | null {
  const key = bossKey(ref);
  const cands: SimPick[] = [];
  for (const pull of pulls) {
    if (bossKey(pull) !== key || Math.abs(pull.startMs - ref.startMs) > SAME_DAY_MS) continue;
    const player = pull.players.find((p) => p.name === playerName);
    if (!player?.setup) continue;
    const windowMs = playedMs(pull, player);
    if (windowMs < MIN_SIM_MS) continue;
    cands.push({ pull, player, windowMs, kill: pull.success, alive: myDeaths({ pull, player }).length === 0 });
  }
  // entre kills, a que ele terminou vivo; depois a mais longa
  const rank = (c: SimPick) => (c.kill ? 2 : 0) + (c.alive ? 1 : 0);
  return cands.sort((a, b) => rank(b) - rank(a) || b.windowMs - a.windowMs || a.pull.startMs - b.pull.startMs)[0] ?? null;
}

// ---------------------------------------------------------------- tradução para o SimC

/** "DeathKnight" -> "death_knight", "BeastMastery" -> "beast_mastery" */
const token = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

export function simcSpec(specId: number | null | undefined): { cls: string; spec: string } | null {
  const s = specId != null ? SPEC_NAMES[specId] : undefined;
  // classe junta ("demonhunter"), spec com sublinhado ("beast_mastery"), como nos perfis do SimC
  return s ? { cls: s.class.toLowerCase(), spec: token(s.spec) } : null;
}

/** Posição na lista do COMBATANT_INFO -> nome do slot no SimC (camisa e tabardo ficam de fora). */
const SLOTS: Record<number, string> = {
  0: 'head', 1: 'neck', 2: 'shoulder', 4: 'chest', 5: 'waist', 6: 'legs', 7: 'feet', 8: 'wrist', 9: 'hands',
  10: 'finger1', 11: 'finger2', 12: 'trinket1', 13: 'trinket2', 14: 'back', 15: 'main_hand', 16: 'off_hand',
};

/** Racial usada no pull -> raça (as passivas não aparecem no log). */
const RACIALS: [number[], string][] = [
  [[26297], 'troll'],
  [[20572, 33702, 33697], 'orc'],
  [[265221], 'dark_iron_dwarf'],
  [[274738], 'maghar_orc'],
  [[255647], 'lightforged_draenei'],
  [[312411], 'vulpera'],
  [[260364], 'nightborne'],
  [[28730, 25046, 50613, 69179, 80483, 129597, 155145, 202719, 232633], 'blood_elf'],
  [[58984], 'night_elf'],
  [[59752], 'human'],
  [[20594], 'dwarf'],
  [[7744], 'undead'],
  [[20549], 'tauren'],
  [[69041, 69070], 'goblin'],
  [[68992], 'worgen'],
  [[256948], 'void_elf'],
  [[255654], 'highmountain_tauren'],
  [[287712], 'kul_tiran'],
  [[312924], 'mechagnome'],
  [[291944], 'zandalari_troll'],
  [[20589], 'gnome'],
  [[28880, 59542, 59543, 59544, 59545, 59547, 59548, 121093, 370626], 'draenei'],
];

const ALLIANCE = 1;

function race(player: PlayerStats): { race: string; guessed: boolean } {
  const used = new Set((player.casts ?? []).map((c) => c.spellId));
  const hit = RACIALS.find(([ids]) => ids.some((id) => used.has(id)));
  if (hit) return { race: hit[1], guessed: false };
  const side = player.setup?.faction === ALLIANCE ? 'alliance' : 'horde';
  if (player.class === 'Evoker') return { race: `dracthyr_${side}`, guessed: false };
  return { race: side === 'alliance' ? 'human' : 'orc', guessed: true };
}

/** Nome do player num perfil: só letras e números (o SimC usa como identificador). */
const actorName = (name: string) => name.split('-')[0].normalize('NFD').replace(/[^A-Za-z0-9]/g, '') || 'Player';

// consumíveis pelas auras do início do pull. O Warcraft Logs traz o nome; o log local só o id
const FLASK_IDS = new Set([1235057, 1235108, 1235109, 1235110, 1235111]);
const FOOD_IDS = new Set([1294727, 1285644, 1233724, 451916]);
const isFlask = (a: StartAura) => FLASK_IDS.has(a.spellId) || /^(flask|phial) of /i.test(a.name ?? '');
const isFood = (a: StartAura) => FOOD_IDS.has(a.spellId) || /well fed/i.test(a.name ?? '');
const isRune = (a: StartAura) => /augment(ation)? rune|^draconic augmentation$|augment rune/i.test(a.name ?? '');

/** Buffs e debuffs de raid do SimC e a classe que traz cada um. */
const RAID_BUFFS: [string, string][] = [
  ['arcane_intellect', 'Mage'],
  ['battle_shout', 'Warrior'],
  ['mark_of_the_wild', 'Druid'],
  ['power_word_fortitude', 'Priest'],
  ['skyfury', 'Shaman'],
  ['blessing_of_the_bronze', 'Evoker'],
  ['chaos_brand', 'DemonHunter'],
  ['mystic_touch', 'Monk'],
  ['hunters_mark', 'Hunter'],
];

const BLOODLUST_IDS = new Set([2825, 32182, 80353, 264667, 390386, 466904, 444257]);
const POWER_INFUSION = 10060;

/** O que não deu para ler do log e ficou no padrão do SimC (a tela avisa). */
export type SimAssumption = 'race' | 'flask' | 'food' | 'rune';

export interface SimProfile {
  input: string;
  assumed: SimAssumption[];
  /** HP do boss no fim da janela (estimado) */
  bossEndPct: number;
}

const sec = (ms: number) => Math.max(0, Math.round(ms / 100) / 10);

/** Inimigos que havia para acertar em cada trecho de 2s, pelo que os DPS acertaram. */
export function raidTargets(pull: Pull): number[] {
  const rows = pull.players.filter((p) => p.role === 'dps' && p.rotation?.targets?.length).map((p) => p.rotation!.targets!);
  const len = Math.max(0, ...rows.map((r) => r.length));
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const v = rows.map((r) => r[i] ?? 0);
    out.push(v.length ? quantile(v, TARGET_QUANTILE) : 1);
  }
  return out;
}

const quantile = (v: number[], q: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * q))];
const median = (v: number[]) => quantile(v, 0.5);

/** Trechos seguidos com o mesmo número de alvos: [início, fim, alvos] em ms. */
export function targetWindows(buckets: number[], windowMs: number): [number, number, number][] {
  const half = Math.floor(TARGET_SMOOTH / 2);
  const smooth = buckets.map((_, i) => median(buckets.slice(Math.max(0, i - half), i + half + 1)));
  const out: [number, number, number][] = [];
  smooth.forEach((n, i) => {
    const from = i * TARGET_BUCKET_MS;
    if (from >= windowMs) return;
    const to = Math.min(windowMs, from + TARGET_BUCKET_MS);
    const last = out[out.length - 1];
    if (last && last[2] === n && last[1] === from) last[1] = to;
    else out.push([from, to, n]);
  });
  return out;
}

/** Trecho da luta em que o robô anda `share` do tempo (0–1). */
export interface MoveWindow {
  from: number;
  to: number;
  share: number;
}

/**
 * O movimento que a luta pediu, a cada 30s da janela: entre os DPS vivos o trecho inteiro, o tempo
 * andando do quartil que menos andou (arredondado a 5%; trechos colados com o mesmo valor viram um).
 * O último bucket de 5s pode estar cortado (corte no meio dele): conta inteiro, um pouco a mais.
 * `null` sem o movimento medido (análise antiga) ou com poucos DPS.
 */
export function fightMovement(pull: Pull, windowMs: number): MoveWindow[] | null {
  const dps = pull.players.filter((p) => p.role === 'dps' && p.moveTimeline?.length);
  if (dps.length < MOVE_MIN_PLAYERS) return null;
  const out: MoveWindow[] = [];
  for (let from = 0, to = 0; from < windowMs; from = to) {
    // a sobra do fim menor que meio trecho vai junto com o último (pouco tempo dá número instável)
    to = windowMs - from < MOVE_CHUNK_MS * 1.5 ? windowMs : from + MOVE_CHUNK_MS;
    const [i, j] = [from / 5_000, Math.ceil(to / 5_000)];
    const shares = dps
      .filter((p) => playedMs(pull, p) >= to)
      .map((p) => p.moveTimeline!.slice(i, j).reduce((s, v) => s + v, 0) / (to - from));
    if (shares.length < MOVE_MIN_PLAYERS) continue;
    const share = Math.min(0.6, Math.round(quantile(shares, MOVE_QUANTILE) * 20) / 20);
    const last = out[out.length - 1];
    if (last && last.to === from && last.share === share) last.to = to;
    else out.push({ from, to, share });
  }
  return out.length ? out : null;
}

/** Os eventos de movimento do SimC para os trechos: deslocamentos de 1,5s, tantos quanto o trecho pede. */
export function movementEvents(windows: MoveWindow[]): string[] {
  return windows
    .filter((w) => w.share > 0)
    .map((w) => {
      const cd = Math.round((MOVE_BOUT_S / w.share) * 10) / 10;
      const first = sec(w.from + Math.min(cd / 2, 3) * 1000);
      return `movement,players_only=1,first=${first},last=${sec(w.to)},cooldown=${cd},cooldown_stddev=${Math.round(cd * 2.5) / 10},duration=${MOVE_BOUT_S}`;
    });
}

/** Limiares de execute que a vida do robô acerta (os mais comuns nas specs). */
const EXECUTE_PCTS = [20, 35];

/**
 * Vida do boss no fim da janela. O SimC leva a vida em linha reta de 100% até ela, e a luta tem uma
 * barra por fase (a P1 até 0%, a P2 de novo de 100%...). Com a vida do alvo da vez a cada 5s
 * (`bossHpTimeline`), o fim da reta é o que deixa o robô abaixo de 20% e de 35% o mesmo tempo que a
 * luta deixou; entre os que empatam, o mais perto da vida real no fim. Sem ela (análise antiga), a
 * reta vai de 100% até a vida do boss principal no corte.
 */
export function bossEndPct(pull: Pull, windowMs: number): number {
  const line = pull.bossHpTimeline?.slice(0, Math.ceil(windowMs / 5_000));
  if (line?.length) {
    const real = EXECUTE_PCTS.map((x) => (line.filter((v) => v < x * 10).length * 5_000) / windowMs);
    const errOf = (e: number) => EXECUTE_PCTS.reduce((s, x, i) => s + (Math.max(0, x - e) / (100 - e) - real[i]) ** 2, 0);
    const ends = Array.from({ length: 200 }, (_, i) => i / 2);
    const min = Math.min(...ends.map(errOf));
    const last = line[line.length - 1] / 10;
    return ends.filter((e) => errOf(e) <= min + 1e-6).reduce((a, b) => (Math.abs(b - last) < Math.abs(a - last) ? b : a));
  }
  const end = pull.cutoffT ?? pull.analyzedMs;
  const boss = [...pull.bosses].sort((a, b) => (a.hpPctAtCutoff ?? a.hpPct ?? 100) - (b.hpPctAtCutoff ?? b.hpPct ?? 100))[0];
  const atEnd = boss?.hpPctAtCutoff ?? boss?.hpPct ?? (pull.success ? 0 : 50);
  const frac = end > 0 ? Math.min(1, windowMs / end) : 1;
  return Math.max(0, Math.min(100, 100 - (100 - atEnd) * frac));
}

/** Monta o perfil do SimC (`null` sem setup ou spec conhecida). `iterations` fica de fora: quem roda escolhe. */
export function buildSimProfile(pick: SimPick, tree: TalentTree): SimProfile | null {
  const { pull, player, windowMs } = pick;
  const setup = player.setup;
  const sc = simcSpec(player.specId);
  if (!setup || !sc) return null;
  const assumed: SimAssumption[] = [];
  const lines: string[] = [];
  const out = (s: string) => lines.push(s);

  out(`# wipe-cause: ${player.name} · ${pull.encounterName} (${pull.difficultyName}) · pull ${pull.pullNumber}`);
  out(`${sc.cls}="${actorName(player.name)}"`);
  out(`spec=${sc.spec}`);
  out('level=90');
  const r = race(player);
  if (r.guessed) assumed.push('race');
  out(`race=${r.race}`);
  if (player.role === 'tank') out('role=tank');

  // talentos: o SimC quer cada árvore na sua opção, pelo id da entrada
  const byTree: Record<'class' | 'spec' | 'hero', string[]> = { class: [], spec: [], hero: [] };
  for (const [, entry, rank] of setup.talents) {
    const t = tree.get(entry);
    if (t) byTree[t.tree].push(`${entry}:${rank}`);
  }
  out(`class_talents=${byTree.class.join('/')}`);
  out(`spec_talents=${byTree.spec.join('/')}`);
  if (byTree.hero.length) out(`hero_talents=${byTree.hero.join('/')}`);

  for (const it of setup.items) {
    const slot = SLOTS[it.slot];
    if (!slot) continue;
    const parts = [`${slot}=`, `id=${it.itemId}`];
    if (it.bonusIds?.length) parts.push(`bonus_id=${it.bonusIds.join('/')}`);
    if (it.enchant) parts.push(`enchant_id=${it.enchant}`);
    if (it.gems.length) parts.push(`gem_id=${it.gems.join('/')}`);
    if (it.ilvl) parts.push(`ilevel=${it.ilvl}`);
    out(parts.join(','));
  }

  // consumíveis: os mesmos do pull. Sem o nome da aura (log local) e sem id conhecido, fica o padrão
  const auras = setup.auras ?? [];
  const named = auras.some((a) => a.name);
  const consumable = (kind: SimAssumption, has: (a: StartAura) => boolean, option: string) => {
    if (auras.some(has)) return;
    if (named) out(`${option}=disabled`);
    else assumed.push(kind);
  };
  consumable('flask', isFlask, 'flask');
  consumable('food', isFood, 'food');
  consumable('rune', isRune, 'augmentation');

  // luta: duração da janela, sem variação; o boss termina com o HP que tinha
  const endPct = bossEndPct(pull, windowMs);
  // (sem fight_style: o padrão já é Patchwerk, e a opção apaga os raid_events abaixo)
  out('');
  out(`max_time=${sec(windowMs)}`);
  out('vary_combat_length=0');
  out('fixed_time=1');
  out(`enemy_death_pct=${Math.round(endPct * 10) / 10}`);

  // buffs da raid: só os que a composição daquele pull trazia
  out('optimal_raid=0');
  const classes = new Set(pull.players.map((p) => p.class));
  for (const [buff, cls] of RAID_BUFFS) out(`override.${buff}=${classes.has(cls) ? 1 : 0}`);
  out('override.mortal_wounds=1');
  out('override.bleeding=1');

  // buffs de fora nos mesmos momentos
  const received = (player.buffsReceived ?? []).filter((u) => u.t < windowMs);
  const lust = received.find((u) => BLOODLUST_IDS.has(u.spellId));
  out(`override.bloodlust=${lust ? 1 : 0}`);
  if (lust) out(`bloodlust_time=${sec(lust.t)}`);
  const pi = received.filter((u) => u.spellId === POWER_INFUSION).map((u) => sec(u.t));
  if (pi.length) out(`external_buffs.power_infusion=${pi.join('/')}`);

  // o movimento que a luta pediu (sem ele medido, o padrão), não o do player
  const moves = fightMovement(pull, windowMs);
  const events = moves ? movementEvents(moves) : [LIGHT_MOVEMENT];

  // alvos a mais e tempo sem alvo, pelo que a raid acertou
  for (const [from, to, n] of targetWindows(raidTargets(pull), windowMs)) {
    const dur = sec(to - from);
    if (to - from < MIN_EVENT_MS) continue;
    if (n === 0) {
      events.push(`invulnerable,first=${sec(from)},duration=${dur},cooldown=9999,retarget=1`);
    } else if (n >= 2) {
      events.push(`adds,count=${n - 1},first=${sec(from)},duration=${dur},cooldown=9999`);
    }
  }
  events.forEach((e, i) => out(`raid_events${i ? '+' : ''}=/${e}`));

  return { input: lines.join('\n') + '\n', assumed, bossEndPct: endPct };
}
