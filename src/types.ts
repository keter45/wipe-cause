// Espelho de crates/wipe-core/src/report.rs (serde camelCase).

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
}

export interface Pull {
  id: number;
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  difficultyName: string;
  groupSize: number;
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
  tip: string | null;
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
  tip: string;
  evaluated: boolean;
  failures: number;
  summary: string;
  players: MechanicPlayer[];
  events: MechanicEvent[];
}

export interface MechanicPlayer {
  guid: string;
  name: string;
  count: number;
  amount: number;
  firstT: number | null;
  /** true = ajudou (interrupt, soak); false = errou */
  credit: boolean;
  message: string;
}

export interface MechanicEvent {
  t: number;
  player: string | null;
  detail: string;
}
