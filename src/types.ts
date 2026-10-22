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
  /** boss de várias fases: vida somada dos bosses da fase em que o pull acabou (como o Warcraft Logs) */
  phaseHpPct?: number;
  /** o mesmo no corte ("ignorar após N mortes"), na fase em que o corte caiu */
  phaseHpPctAtCutoff?: number;
  /** quantas fases o boss tem (regra com fases) */
  phaseCount?: number;
  /** vida do alvo da vez (por mil) a cada 5s até o corte: a da fase ou a menor entre os bosses; análises antigas não têm */
  bossHpTimeline?: number[];
  /** call de wipe: o grupo desistiu e o resto morreu de propósito; a análise para nela (cutoffT) */
  wipeCall?: WipeCall;
  players: PlayerStats[];
  deaths: Death[];
  enemySpells: EnemySpell[];
  rulesFile: string | null;
  mechanics: MechanicResult[];
  trigger: PullTrigger | null;
  /** quem gravou o log (flag "meu" do combat log); no Warcraft Logs não tem */
  ownerGuid?: string;
  /** posições de players e bosses nos trechos dos replays */
  tracks?: PullTracks;
  /** onde caiu cada acerto de mecânica "de chão" (gota, poça, soak), nos trechos dos replays */
  ground?: PullGround;
  /** chão da arena: células em que algum player pisou no pull (o log não tem o mapa) */
  arena?: { cellYd: number; cells: [number, number][] };
  /** casts dos bosses nos trechos dos replays */
  casts?: BossCast[];
  /** de onde o pull veio no log (para o replay completo); vazio no Warcraft Logs */
  logFile?: string;
  logOffset?: number;
  /** quando cada fase começou */
  phaseMarks?: PhaseMark[];
  /** replay completo (só no pull relido sozinho) */
  fight?: FightData;
  /** replay completo: orbs no chão e carregados */
  orbs?: OrbTracks;
  /** replay completo: áreas das habilidades do boss */
  areas?: AreaView[];
  /** soaks (regra com `soak`): onde cada um caiu e quantos entraram */
  soaks?: SoakView[];
  blasts?: BlastView[];
  /** marcas de chão do grupo (world markers) durante o pull */
  markers?: WorldMarker[];
  /** tempo de cast típico (ms) de cada spell dos inimigos (medido no log inteiro) */
  castMs?: Record<number, number>;
  /** replay completo: fragmentos que alguém tinha que pegar (regra com `pickup`) */
  pickups?: Pickups;
  /** replay completo: auras nos inimigos que o mapa mostra (escudo do add, véu do boss) */
  unitAuras?: UnitAuraView[];
  /** poças de tamanho conhecido (regra com `pool`), cada vez que o cast saiu */
  pools?: PoolView[];
  /** ondas que saem de quem tinha uma aura (regra `waves`) */
  waves?: WaveView[];
  /** quantas unidades de um tipo estão vivas ao longo do pull (regra `units` com `count`): [ms, quantas] */
  unitCounts?: { npc: number; name: string; series: [number, number][] }[];
  /** cara de cada tipo de unidade no mapa (regra `units` com `color` / `icon`) */
  unitLooks?: { npc: number; color?: string; icon?: number }[];
}

/**
 * Ondas de um player marcado: a marca de `from` a `at` (no player); em `at` saem de (x, y) nas direções
 * `angles` (radianos), a frente a `start` + `speed`·t jardas, por `durationMs`, com `width` jardas de largura.
 */
export interface WaveView {
  key: string;
  name: string;
  spellId: number;
  guid: string;
  from: number;
  at: number;
  x: number;
  y: number;
  angles: number[];
  start: number;
  speed: number;
  width: number;
  durationMs: number;
}

/** Poça: anunciada no cast (`from`), no chão de `on` a `to`, crescendo e recuando em `growMs`; círculos [x, y, raio] no log. */
export interface PoolView {
  key: string;
  name: string;
  spellId: number;
  from: number;
  on: number;
  to: number;
  growMs: number;
  circles: [number, number, number][];
}

/** Fragmentos para pegar: onde cada um estava (onde foi pego). Itens: [tipo, player, no chão desde, pego em, x, y em décimos de jarda]. */
export interface Pickups {
  kinds: { key: string; name: string; spellId: number; aura: number }[];
  items: [number, string, number, number, number, number][];
}

/** Aura num inimigo: de quando até quando, as stacks ([t, n]) e o que o escudo já absorveu ([t, total]). */
export interface UnitAuraView {
  key: string;
  name: string;
  spellId: number;
  guid: string;
  from: number;
  to: number;
  stacks: [number, number][];
  absorbed?: [number, number][];
}

/** Orbs no replay completo: no chão [de, até, x, y em décimos de jarda, tipo] e carregados [player, de, até, tipo]. */
export interface OrbTracks {
  kinds: { name: Loc; volatile: boolean }[];
  /** distância em que dois orbs se tocam (o raio do roxo mais a folga) */
  contactYd: number;
  ground: [number, number, number, number, number][];
  carries: [string, number, number, number][];
  /** quando um cast do boss explodiu o que sobrou no chão, ex.: o Toxic Deluge (ausente nos replays antigos) */
  clears?: number[];
}

/** Área de uma habilidade do boss: em volta de quem tem um debuff (`aura`) ou de uma unidade (`npc`). */
/** Um soak no replay: aparece em `from` e cai em `at`, no meio de quem foi atingido (coordenadas do log). */
/** Marca de chão (world marker): 0-7 na ordem do /wm (quadrado azul, triângulo verde, losango roxo, X
 * vermelho, estrela amarela, círculo laranja, lua, caveira), onde (coordenadas do log) e de quando até quando
 * no pull (0 = já estava no chão). */
export interface WorldMarker {
  marker: number;
  x: number;
  y: number;
  from: number;
  to?: number;
}

export interface SoakView {
  key: string;
  name: string;
  spellId: number;
  from: number;
  at: number;
  x: number;
  y: number;
  radius: number;
  /** quantos precisavam entrar (regra) */
  needs?: number;
  /** quantos entraram */
  hit: number;
  caster?: string;
}

export interface BlastView {
  key: string;
  name: string;
  spellId: number;
  from: number;
  at: number;
  x: number;
  y: number;
  radius: number;
  timingEstimated: boolean;
}

export interface AreaView {
  key: string;
  name: string;
  spellId: number | null;
  aura?: number;
  npc?: number;
  radius: number;
  /** a unidade some depois de tanto tempo sem acertar ninguém perto dela, a partir de `vanishFrom` (ms) */
  vanishIdleMs?: number;
  vanishFrom?: number;
  /** a unidade continua desenhada como sempre (ex.: o boss), com o círculo em volta */
  keepUnit?: boolean;
}

/** Call de wipe (ver crates/wipe-core/src/wipecall.rs). */
export interface WipeCall {
  /** quando o grupo parou de jogar (ms do pull) */
  t: number;
  /** "certain": muita gente parou junto; "possible": poucos, pode ser só um desastre */
  confidence: 'certain' | 'possible';
  /** quantos morreram parados depois de parar junto com os outros */
  stopped: number;
  /** o que veio antes e levou à call */
  trigger?: WipeCallTrigger;
}

export interface WipeCallTrigger {
  kind: 'tank' | 'mass' | 'mechanic' | 'deaths';
  t: number;
  name?: string;
  spell?: string;
  spellId?: number;
  deaths: number;
  /** tank: morreu e não voltou antes da call */
  noRez?: boolean;
}

/** Começo de uma fase do boss. */
export interface PhaseMark {
  t: number;
  key: string;
  name: string;
}

/** Replay completo de um pull: vida, debuffs e eventos de cada player (índices em `players`). */
/** Defensivo em área no replay completo: onde ficou (coordenadas do mapa), raio e quando. */
export interface FightZone {
  t: number;
  end: number;
  spellId: number;
  /** índice em `FightData.players` */
  caster: number;
  x: number;
  y: number;
  radius: number;
}

export interface FightData {
  players: string[];
  /** nomes de fontes e alvos dos eventos */
  sources: string[];
  spells: Record<string, string>;
  /** spell das regras do boss -> chave da mecânica */
  ruleSpells: Record<string, string>;
  /** vida de cada player: [t, %] */
  hp: [number, number][][];
  /** [player, spell, início, fim, maior número de stacks, 1 = debuff de inimigo / 0 = defensivo] */
  auras: [number, number, number, number, number, number][];
  /** mudanças de stack: [player, spell, t, stacks] (sem entrada, 1 stack; ausente nos replays antigos) */
  stacks?: [number, number, number, number][];
  /** [t, tipo, player, spell, valor, fonte/alvo (65535 = nenhum)]; tipos: 0 dano, 1 cura, 2 cast, 3 interrupt, 4 dispel, 5 ressurreição */
  events: [number, number, number, number, number, number][];
  /** vida dos bosses: [t, por mil] */
  bosses: { guid: string; name: string; maxHp: number; hp: [number, number][] }[];
  /** dano feito somado por segundo: [segundo, player, alvo em sources, valor] */
  done: [number, number, number, number][];
  /** cura feita e recebida somadas por segundo: [segundo, player, valor] */
  healed: [number, number, number][];
  healIn: [number, number, number][];
  /** defensivos de raid em área (AMZ, Darkness, Spirit Link...); ausente nos replays antigos */
  zones?: FightZone[];
  /** vida dos adds que importam (`units` com `replay: true`): [t, por mil] */
  adds?: { guid: string; name: string; maxHp: number; hp: [number, number][] }[];
  /** controle de grupo dos players (data/utility.json) */
  cc?: FightCc[];
  /** portais do warlock: as duas pontas e quem passou */
  gateways?: FightGateway[];
}

/** CC de um player: em volta de onde ele estava (x, y, raio; coordenadas do log) ou no inimigo alvo. */
export interface FightCc {
  t: number;
  end: number;
  spellId: number;
  /** índice em `FightData.players` */
  caster: number;
  x?: number;
  y?: number;
  radius?: number;
  target?: string;
}

/** Portal do warlock: o cast, de quando até quando aparece, as pontas (log) e cada passagem [t, player]. */
export interface FightGateway {
  caster?: number;
  castFrom?: number;
  castAt?: number;
  from: number;
  to: number;
  a?: [number, number];
  b?: [number, number];
  uses: [number, number][];
}

/** Cast de um boss: começo, fim (cast com tempo) e para onde ele olhava ao terminar. */
export interface BossCast {
  t: number;
  end?: number;
  guid: string;
  spellId: number;
  name: string;
  /** radianos, no mesmo sistema das posições */
  facing?: number;
  interrupted?: boolean;
  /** quem cortou (guid do player) */
  interruptedBy?: string;
  /** o lançador estava com um efeito que aumenta o tempo de cast (Curse of Tongues...): quanto, em % */
  slowPct?: number;
  /** frontal em cone (regra do boss): meio ângulo em graus e alcance em jardas */
  cone?: { halfAngle: number; range: number };
  /** frontal: o alvo do boss (o cone aponta para ele durante o cast); sem alvo, vale `facing` */
  target?: string;
  /** linha do lançador até o alvo (regra do boss), largura em jardas */
  line?: { width: number };
}

/** Marcas no chão: o log não mostra poças nem gotas, só onde estava quem foi atingido. */
export interface PullGround {
  kinds: { key: string; name: string; spellId: number; lingerMs: number; contourCellYd?: number }[];
  /** [t, x, y em décimos de jarda, índice em kinds] */
  marks: [number, number, number, number][];
}

/** Posições guardadas só nos trechos que algum replay usa. */
export interface PullTracks {
  stepMs: number;
  units: UnitTrack[];
}

export interface UnitTrack {
  guid: string;
  name: string;
  /** ghost: caminho simulado de um fantasma que persegue um player (ver gaze.rs) */
  kind: 'player' | 'enemy' | 'ghost';
  /** fantasma: o player que ele persegue */
  owner?: string;
  /** fantasma: daqui em diante o caminho foi puxado até onde o log diz que ele estava */
  estimatedFrom?: number;
  /** unidade de área (machado): passos (t / stepMs) em que o log mostrou onde ela estava; entre um e outro, estimada */
  seen?: number[];
  /** trechos contínuos: posições a cada `stepMs` a partir de `t0`, em décimos de jarda (x, y, x, y...) */
  segs: { t0: number; xy: number[] }[];
}

/** Replay de um momento do pull (morte, falha, encontro); as posições vêm de `Pull.tracks`. */
export interface ReplayRef {
  t: number;
  from: number;
  to: number;
  /** quem acompanhar (vazio = falha coletiva) */
  focus: string[];
  /** stacks do debuff da mecânica: [t, stacks] a cada mudança (0 = sem, -1 = desconhecido) */
  stacks?: { guid: string; pts: [number, number][] }[];
  /** acertos da mecânica em quem o replay acompanha */
  marks?: { t: number; guid: string }[];
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
  /** Bloodlust e afins e Power Infusion recebidos até o corte (análises antigas não têm) */
  buffsReceived?: SpellUse[];
  /** leitura da rotação (specs com rotação base escrita) */
  rotation?: RotationResult;
  /** dano / cura por janela de 5s (pets somados), até o corte; análises antigas não têm */
  damageTimeline?: number[];
  healingTimeline?: number[];
  /** healer: overheal por habilidade e mana % por janela de 5s (análises antigas não têm) */
  overhealBySpell?: SpellAmount[];
  manaTimeline?: number[];
  /** ms andando por janela de 5s (pela distância entre as posições), até o corte; análises antigas não têm */
  moveTimeline?: number[];
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
  /** 0 = Horda, 1 = Aliança */
  faction?: number;
  /** auras no início do pull; o nome só vem do Warcraft Logs */
  auras?: StartAura[];
}

export interface StartAura {
  spellId: number;
  name?: string;
  source?: string;
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
  bonusIds?: number[];
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
  /** replay dos segundos antes da morte (posições em `Pull.tracks`) */
  /** quanto tempo estava sem castar nada ao morrer (ms); muita gente parada morrendo junto = call de wipe */
  idleMs?: number;
  replay?: ReplayRef;
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
  /** mecânica do boss a que o golpe pertence (chave da regra) */
  mechanic?: string;
}

export interface EnemySpell {
  spellId: number;
  name: string;
  sources: string[];
  casts: number;
  /** ms desde o início do pull de cada cast */
  castTimes?: number[];
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
  /** importância dentro do boss (regra): maior vem antes */
  priority?: number;
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
  /** debuff de parear (Helical Toxins): cada encontro com soma errada */
  pairings?: PairFault[];
  /** dano evitável: erros por ocorrência (ticks seguidos são um só), somando os culpados */
  incidents?: number;
  /** replays das falhas (um por culpado, ou por falha coletiva) */
  replays?: ReplayRef[];
  /** fantasmas (gaze com simulação): quantas jardas o fantasma de cada um andou no pull */
  ghostYards?: GhostYards;
}

/** Quanto o fantasma de cada player andou no pull (caminho simulado): cada jarda é tempo de costas para ele. */
export interface GhostYards {
  /** a fixação do fantasma (ícone) */
  spellId: number;
  /** nome do fantasma */
  name: string;
  /** quem deixou andar mais primeiro */
  players: { guid: string; name: string; yards: number; ghosts: number }[];
}

/** Encontro de players com soma errada num debuff de parear (ex.: Helical Toxins, soma 4). */
export interface PairFault {
  /** instante do encontro (ms do pull) */
  t: number;
  /** começo da rodada (aplicação do debuff) */
  roundStart: number;
  members: PairMember[];
  /** stacks de cada um depois do encontro */
  sum: number;
  /** soma que limpa */
  target: number;
  /** passou da soma: ninguém limpa mais o debuff deles */
  over: boolean;
  /** true: a rodada tinha solução e deixou de ter aqui; false: não mudou; null: stack desconhecido */
  broke: boolean | null;
  /** conta como falha */
  counted: boolean;
  /** guid de quem andou até o outro (null = os dois, ou já estavam juntos) */
  culprit: string | null;
  /** v0.21.0 guardava as posições dentro do replay (`LegacyPairReplay`) */
  replay?: ReplayRef | LegacyPairReplay;
}

export interface PairMember {
  guid: string;
  name: string;
  /** stacks antes do encontro (null = desconhecido) */
  before: number | null;
  /** jardas andadas na direção do outro antes do encontro */
  approachYd: number;
  /** parte da aproximação feita por ele (0 a 1) */
  share: number;
  /** parceiro certo mais perto naquele instante */
  better?: { guid: string; name: string; stacks: number; distYd: number };
}

/** Replay do Helical Toxins da v0.21.0, com as posições dentro. */
export interface LegacyPairReplay {
  from: number;
  to: number;
  tracks: PairTrack[];
  /** bosses no instante do encontro */
  enemies: UnitPos[];
}

export interface PairTrack {
  guid: string;
  name: string;
  /** um dos que se encostaram */
  focus: boolean;
  /** [t, x, y] em passos fixos */
  pts: [number, number, number][];
  /** [t, stacks] a cada mudança: 0 = limpou, -1 = desconhecido */
  stacks: [number, number][];
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
  /** dano evitável: ocorrências (ticks seguidos são uma só); é o número de erros */
  incidents?: number;
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
  /** trechos parados (ms do pull) que entram no tempo parado */
  idle?: [number, number][];
  cooldowns: { spellId: number; name: string; casts: number; possible: number; usage: number }[];
  keyPoints: Loc[];
  prioritySt: (RotationSpellRef & { note: Loc | null })[];
  priorityAoe: (RotationSpellRef & { note: Loc | null })[];
  sources: { title: string; url: string }[];
  /** buffs curtos que o player pôs em si mesmo (procs, janelas de cooldown) */
  buffs?: BuffTrace[];
  /** buffs no player e debuffs dele nos inimigos mantidos boa parte da luta (fração do tempo vivo) */
  /** "ally": buff do healer em gente da raid (Atonement, Beacon, HoTs); `targets` = alvos ao mesmo tempo, em média */
  uptimes?: { id: number; name: string; kind: 'buff' | 'debuff' | 'ally'; uptime: number; byRotation: number; targets?: number }[];
  /** inimigos diferentes acertados em cada trecho de 2s (alvo único x AoE) */
  targets?: number[];
}

export interface BuffTrace {
  id: number;
  name: string;
  maxStacks: number;
  /** cargas ganhas no pull */
  gains: number;
  /** quando esteve ativo (ms do pull) */
  spans: [number, number][];
  /** cada carga perdida: [ms, spellId do cast do player logo antes (0 = acabou sozinho)] */
  drops: [number, number][];
}
