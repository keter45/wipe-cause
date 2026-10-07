// Espelho de crates/wipe-core/src/report.rs (serde camelCase).
// Textos com `Loc` vêm do núcleo nas duas línguas (análises antigas: só português); use `tr()`.

import type { Loc } from './i18n';

export interface LogReport {
  file: string;
  logVersion: number | null;
  advancedLogging: boolean;
  lines: number;
  parseMs: number;
  pulls: Pull[];
  /** "ignorar eventos após N mortes" usado na análise (0 = sem corte) */
  deathCutoff: number;
  ignoredShortPulls: number;
  ruleErrors: string[];
  /** análise do Warcraft Logs: logs do PC usados no lugar do download */
  localLogs?: string[];
  /** análise do Warcraft Logs: pulls que vieram de lá (os outros saíram do log do PC) */
  wclPulls?: number;
}

export interface Pull {
  id: number;
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  difficultyName: string;
  groupSize: number;
  /** encontro de masmorra (M+, delve…); análises antigas não têm */
  dungeon?: boolean;
  pullNumber: number;
  /** numeração do Warcraft Logs (conta os pulls curtos) */
  pullNumberAll: number;
  startMs: number;
  startLocal: string;
  tzOffsetHours: number;
  durationMs: number;
  /** momento da N-ésima morte: estatísticas param de contar aqui */
  cutoffT: number | null;
  /** tempo usado nas médias (DPS/HPS): até o corte, ou o pull inteiro */
  analyzedMs: number;
  success: boolean;
  incomplete: boolean;
  bosses: BossState[];
  players: PlayerStats[];
  deaths: Death[];
  enemySpells: EnemySpell[];
  rulesFile: string | null;
  mechanics: MechanicResult[];
  trigger: PullTrigger | null;
  /** quem gravou o log (flag "meu" do combat log); no Warcraft Logs não tem */
  ownerGuid?: string;
}

export interface PullTrigger {
  key: string;
  name: string;
  t: number;
  deaths: number;
}

export interface BossState {
  guid: string;
  name: string;
  npcId: number | null;
  maxHp: number;
  hpPct: number | null;
  /** HP no momento do corte */
  hpPctAtCutoff: number | null;
}

export type Role = 'tank' | 'healer' | 'dps';

export interface PlayerStats {
  guid: string;
  name: string;
  class: string | null;
  specId: number | null;
  role: Role | null;
  damageDone: number;
  dps: number;
  healingDone: number;
  hps: number;
  damageTaken: number;
  deaths: number;
  healthPotions: number;
  healthstones: number;
  defensivesUsed: SpellUse[];
  takenByAbility: AbilityDamage[];
  interrupts: number;
  interruptAttempts: number;
  canInterrupt: boolean;
  interruptLog: InterruptUse[];
  /** Casts do próprio player (sem pets) até o corte. Ausente em análises antigas. */
  casts?: SpellCasts[];
  damageBySpell?: SpellAmount[];
  healingBySpell?: SpellAmount[];
  /** Tempo vivo dentro do tempo analisado */
  aliveMs?: number;
  setup?: Setup | null;
  /** leitura da rotação (specs com rotação base escrita) */
  rotation?: RotationResult;
  /** dano / cura por janela de 5s (pets somados), até o corte; análises antigas não têm */
  damageTimeline?: number[];
  healingTimeline?: number[];
}

export interface SpellCasts {
  spellId: number;
  name: string;
  /** ms desde o início do pull */
  times: number[];
}

export interface SpellAmount {
  spellId: number;
  name: string;
  amount: number;
  pet: boolean;
}

export interface Setup {
  stats: SetupStats;
  itemLevel: number;
  items: GearItem[];
  /** [nó, entrada, rank] */
  talents: [number, number, number][];
}

export interface SetupStats {
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  crit: number;
  haste: number;
  mastery: number;
  versatility: number;
  leech: number;
  avoidance: number;
  speed: number;
}

export interface GearItem {
  /** 0 = cabeça … 15 = arma, 16 = mão secundária */
  slot: number;
  itemId: number;
  ilvl: number;
  enchant: number | null;
  gems: number[];
}

export interface InterruptUse {
  t: number;
  spellId: number;
  spell: string;
  targetSpellId: number | null;
  targetSpell: string | null;
}

export interface DeathStats {
  maxHp: number | null;
  belowHalfMs: number | null;
  maxHpPctLast3s: number | null;
  damageTaken10s: number;
  healingReceived10s: number;
  healingPctOfMax10s: number | null;
  underhealed: boolean;
}

export interface DeathAura {
  spellId: number;
  name: string;
  stacks: number;
  source: string;
  appliedT: number;
  mechanic: string | null;
  tip: Loc | null;
}

export interface MechanicShare {
  key: string;
  name: string;
  amount: number;
  pct: number;
  failT: number | null;
}

export interface SpellUse {
  spellId: number;
  name: string;
  t: number;
  source: string | null;
}

export interface AbilityDamage {
  spellId: number;
  name: string;
  source: string;
  amount: number;
  hits: number;
}

export interface Death {
  order: number;
  guid: string;
  name: string;
  class: string | null;
  role: Role | null;
  t: number;
  /** depois do corte: só para consulta, não conta em nada */
  ignored: boolean;
  killingBlow: RecapEntry | null;
  killingBlowMechanic: string | null;
  deathKind: 'spike' | 'slow' | 'normal' | 'unknown';
  stats: DeathStats;
  debuffs: DeathAura[];
  mechanicDamage: MechanicShare[];
  causedBy: MechanicShare | null;
  recap: RecapEntry[];
  defensivesRecent: SpellUse[];
  defensivesAvailable: AvailableSpell[];
  usedHealthPotion: boolean;
  usedHealthstone: boolean;
  healthstoneKnown: boolean;
  /** onde cada um estava na hora da morte (só mortes antes do corte, com Advanced Logging) */
  positions?: Positions;
}

export interface AvailableSpell {
  spellId: number;
  name: string;
  kind: 'personal' | 'external' | 'raid';
}

export interface RecapEntry {
  t: number;
  kind: 'damage' | 'heal' | 'buff' | 'debuff';
  spellId: number;
  spellName: string;
  source: string;
  amount: number;
  overkill: number;
  absorbed: number;
  hpPct: number | null;
}

export interface EnemySpell {
  spellId: number;
  name: string;
  sources: string[];
  casts: number;
  hitsOnPlayers: number;
  damageToPlayers: number;
  interrupted: number;
  interruptible: boolean;
}

export type MechanicSeverity = 'wipe' | 'major' | 'minor' | 'none';

export interface MechanicResult {
  key: string;
  name: string;
  /** spell que representa a mecânica (para o ícone) */
  spellId: number | null;
  kind: string;
  severity: MechanicSeverity;
  tip: Loc;
  /** foco da progressão (marcado pelo usuário) */
  focus?: boolean;
  /** campos ajustados pelo usuário */
  tuned?: string[];
  /** regra criada pelo usuário */
  custom?: boolean;
  /** dano evitável que pesa inteiro para tank (padrão: metade) */
  tankFull?: boolean;
  evaluated: boolean;
  failures: number;
  summary: Loc;
  players: MechanicPlayer[];
  events: MechanicEvent[];
  /** posições nas primeiras falhas coletivas */
  snapshots?: Positions[];
  /** interrupt: cada cast do inimigo, em ordem */
  casts?: CastOutcome[];
  /** dispel: cada debuff e o que aconteceu com ele */
  dispels?: DispelOutcome[];
  /** phase_duration: cada janela (intermissão) do pull */
  phases?: PhaseWindow[];
  /** phase_duration: tempo bom e tempo máximo aceitável (ms) */
  targetMs?: number;
  maxMs?: number;
  /** stack_limit com fontes: de onde veio cada stack, por player (todos, não só os culpados) */
  stackOrigins?: PlayerStackOrigins[];
}

/** Uma origem de stacks: a mecânica e quantos stacks deu (ou tirou). */
export interface StackOrigin {
  key: string;
  name: string;
  count: number;
}

export interface PlayerStackOrigins {
  guid: string;
  name: string;
  maxStacks: number;
  avoidable: StackOrigin[];
  unavoidable: StackOrigin[];
  removed: StackOrigin[];
  /** stacks sem nenhuma fonte perto no tempo */
  unknown: number;
}

export interface PhaseWindow {
  start: number;
  /** null = não terminou no tempo analisado */
  end: number | null;
  /** o raid wipou durante a fase */
  wiped?: boolean;
  /** players que morreram dentro da fase */
  deaths?: number;
}

export interface CastOutcome {
  t: number;
  sourceGuid: string;
  source: string;
  /** null = o cast passou */
  interruptedBy: string | null;
  interruptedByGuid: string | null;
}

export interface DispelOutcome {
  t: number;
  targetGuid: string;
  target: string;
  /** null = saiu sem dispel */
  delayMs: number | null;
  dispelledBy: string | null;
  dispelledByGuid: string | null;
}

export interface MechanicPlayer {
  guid: string;
  name: string;
  count: number;
  amount: number;
  firstT: number | null;
  /** true = ajudou (interrupt, soak); false = errou */
  credit: boolean;
  message: Loc;
}

export interface MechanicEvent {
  t: number;
  player: string | null;
  detail: Loc;
}

/** Foto das posições num momento do pull (coordenadas do mundo, em jardas). */
export interface Positions {
  t: number;
  units: UnitPos[];
}

export interface UnitPos {
  guid: string;
  name: string;
  kind: 'player' | 'enemy';
  x: number;
  y: number;
  /** há quanto tempo a posição foi vista */
  ageMs: number;
}

export interface RotationSpellRef {
  spellId: number;
  name: string;
}

export interface RotationFinding {
  id: string;
  /** tipo da checagem (proc, downtime, dot_uptime, cooldown, resource_waste...); análises antigas não têm */
  kind?: string;
  title: Loc;
  tip: Loc;
  importance: 'high' | 'medium' | 'low';
  count: number;
  /** aproveitamento 0–1 */
  rate: number;
  /** ms desde o início do pull */
  times: number[];
  detail: Loc;
  spellId: number | null;
}

/** Rotação do player lida contra a rotação base escrita da spec (rotations/*.yaml). */
export interface RotationResult {
  specName: string;
  patch: string;
  tree: string | null;
  /** aproveitamento 0–100 */
  score: number;
  findings: RotationFinding[];
  opener: { expected: RotationSpellRef[]; actual: RotationSpellRef[]; missing: RotationSpellRef[]; ok: boolean } | null;
  downtimeMs: number;
  activeMs: number;
  cooldowns: { spellId: number; name: string; casts: number; possible: number; usage: number }[];
  keyPoints: Loc[];
  prioritySt: (RotationSpellRef & { note: Loc | null })[];
  priorityAoe: (RotationSpellRef & { note: Loc | null })[];
  sources: { title: string; url: string }[];
}
