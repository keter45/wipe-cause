// Espelho de crates/wipe-core/src/report.rs (serde camelCase).

export interface LogReport {
  file: string;
  logVersion: number | null;
  advancedLogging: boolean;
  lines: number;
  parseMs: number;
  pulls: Pull[];
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
  startMs: number;
  startLocal: string;
  tzOffsetHours: number;
  durationMs: number;
  success: boolean;
  incomplete: boolean;
  bosses: BossState[];
  players: PlayerStats[];
  deaths: Death[];
  enemySpells: EnemySpell[];
  rulesFile: string | null;
  mechanics: MechanicResult[];
}

export interface BossState {
  guid: string;
  name: string;
  npcId: number | null;
  maxHp: number;
  hpPct: number | null;
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
  killingBlow: RecapEntry | null;
  killingBlowMechanic: string | null;
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
  kind: 'damage' | 'heal' | 'buff';
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
}

export type MechanicSeverity = 'wipe' | 'major' | 'minor' | 'none';

export interface MechanicResult {
  key: string;
  name: string;
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
