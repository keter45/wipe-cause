//! Estruturas de saída da análise, serializadas para a UI (camelCase).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogReport {
    pub file: String,
    pub log_version: Option<u32>,
    pub advanced_logging: bool,
    pub lines: u64,
    pub parse_ms: u64,
    pub pulls: Vec<Pull>,
    /// "Ignorar eventos após N mortes" usado na análise (0 = sem corte)
    pub death_cutoff: u32,
    /// Wipes com menos de 30s descartados (pull falso / reset)
    pub ignored_short_pulls: u32,
    /// Erros ao carregar regras de boss (YAML inválido etc.)
    pub rule_errors: Vec<String>,
    /// Análise do Warcraft Logs: logs do PC usados no lugar do download (mais barato)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub local_logs: Vec<String>,
    /// Análise do Warcraft Logs: pulls que vieram de lá (os outros saíram do log do PC)
    #[serde(skip_serializing_if = "is_zero")]
    pub wcl_pulls: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pull {
    /// Índice do pull no log (0..)
    pub id: usize,
    pub encounter_id: u32,
    pub encounter_name: String,
    pub difficulty_id: u32,
    pub difficulty_name: String,
    pub group_size: u32,
    /// encontro de masmorra (M+, delve…): o app é para raid, fica à parte na interface
    pub dungeon: bool,
    /// Número do pull para este boss + dificuldade no log (1..), sem os pulls curtos descartados
    pub pull_number: u32,
    /// Mesmo número contando os pulls curtos — é a numeração do Warcraft Logs ("Wipe N")
    pub pull_number_all: u32,
    /// Epoch ms (UTC quando o log tem offset de fuso)
    pub start_ms: i64,
    /// Timestamp original da linha ENCOUNTER_START (hora local do jogo)
    pub start_local: String,
    pub tz_offset_hours: f64,
    pub duration_ms: i64,
    /// Momento (ms do pull) da N-ésima morte: estatísticas param de contar aqui
    pub cutoff_t: Option<i64>,
    /// Tempo usado nas médias (DPS/HPS): até o corte, ou o pull inteiro
    pub analyzed_ms: i64,
    pub success: bool,
    /// ENCOUNTER_END não encontrado (log cortado / desconectou)
    pub incomplete: bool,
    pub bosses: Vec<BossState>,
    pub players: Vec<PlayerStats>,
    pub deaths: Vec<Death>,
    pub enemy_spells: Vec<EnemySpell>,
    /// Arquivo de regras usado (encounters/*.yaml), se houver para este boss
    pub rules_file: Option<String>,
    /// Resultado das regras do boss, falhas primeiro
    pub mechanics: Vec<MechanicResult>,
    /// Falha de mecânica que puxou as mortes do wipe, quando dá para apontar
    pub trigger: Option<PullTrigger>,
    /// player que gravou o log (flag "meu" do combat log); no Warcraft Logs não tem
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_guid: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullTrigger {
    pub key: String,
    pub name: String,
    /// momento da falha (ou da 1ª morte ligada a ela)
    pub t: i64,
    /// mortes atribuídas a esta mecânica
    pub deaths: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MechanicResult {
    pub key: String,
    pub name: String,
    /// spell que representa a mecânica (para o ícone)
    pub spell_id: Option<u32>,
    /// tipo da regra (avoidable_damage, soak, interrupt, ...)
    pub kind: String,
    /// wipe | major | minor | none
    pub severity: String,
    pub tip: String,
    /// marcada pelo usuário como foco da progressão
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub focus: bool,
    /// campos que o usuário ajustou (vazio = regra padrão)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tuned: Vec<String>,
    /// regra criada pelo usuário (não existe nas regras do app)
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub custom: bool,
    /// false = tipo de regra que o motor ainda não avalia (só dica)
    pub evaluated: bool,
    pub failures: u32,
    /// mensagem da falha coletiva (soak, interrupt, enrage), já renderizada
    pub summary: String,
    /// culpados primeiro; depois quem ajudou (`credit`: interrupts, soaks)
    pub players: Vec<MechanicPlayer>,
    pub events: Vec<MechanicEvent>,
    /// posições no momento das primeiras falhas coletivas (explosão, Execution...)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub snapshots: Vec<Positions>,
    /// interrupt: cada cast do inimigo, em ordem (para conferir a escala de interrupts)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub casts: Vec<CastOutcome>,
    /// dispel: cada debuff aplicado e o que aconteceu com ele
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub dispels: Vec<DispelOutcome>,
    /// phase_duration: cada janela (intermissão) e quanto durou
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub phases: Vec<PhaseWindow>,
    /// phase_duration: tempo bom e tempo máximo aceitável (ms)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastOutcome {
    pub t: i64,
    /// quem castou (cada add tem o seu guid)
    pub source_guid: String,
    pub source: String,
    /// quem cortou; None = o cast passou
    pub interrupted_by: Option<String>,
    pub interrupted_by_guid: Option<String>,
}

/// Uma janela de fase (ex.: intermissão em que o boss fica imune até o raid resolver a mecânica).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseWindow {
    pub start: i64,
    /// None = não terminou no tempo analisado (wipe na fase ou corte de mortes)
    pub end: Option<i64>,
    /// o raid wipou durante a fase
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub wiped: bool,
    /// players que morreram dentro da fase (mecânica errada costuma matar vários de uma vez)
    #[serde(skip_serializing_if = "is_zero")]
    pub deaths: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispelOutcome {
    /// quando o debuff entrou
    pub t: i64,
    pub target_guid: String,
    pub target: String,
    /// ms até o dispel; None = saiu sem dispel (expirou ou o player morreu)
    pub delay_ms: Option<i64>,
    pub dispelled_by: Option<String>,
    pub dispelled_by_guid: Option<String>,
}

/// Foto das posições (advanced logging) num momento do pull. Coordenadas do mundo, em jardas.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Positions {
    /// ms desde o início do pull
    pub t: i64,
    pub units: Vec<UnitPos>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitPos {
    pub guid: String,
    pub name: String,
    /// "player" | "enemy"
    pub kind: String,
    pub x: f32,
    pub y: f32,
    /// há quanto tempo a posição foi vista (a posição só vem com eventos da unidade)
    pub age_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MechanicPlayer {
    pub guid: String,
    pub name: String,
    /// hits, stacks máximos ou vezes que ajudou
    pub count: u32,
    pub amount: i64,
    pub first_t: Option<i64>,
    pub credit: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MechanicEvent {
    pub t: i64,
    pub player: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BossState {
    pub guid: String,
    pub name: String,
    pub npc_id: Option<u32>,
    pub max_hp: i64,
    /// HP restante no fim do pull (0-100). None sem advanced logging.
    pub hp_pct: Option<f32>,
    /// HP no momento do corte ("ignorar após N mortes")
    pub hp_pct_at_cutoff: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStats {
    pub guid: String,
    pub name: String,
    pub class: Option<String>,
    pub spec_id: Option<u32>,
    pub role: Option<String>,
    pub damage_done: i64,
    pub dps: f64,
    pub healing_done: i64,
    pub hps: f64,
    pub damage_taken: i64,
    pub deaths: u32,
    pub health_potions: u32,
    pub healthstones: u32,
    pub defensives_used: Vec<SpellUse>,
    pub taken_by_ability: Vec<AbilityDamage>,
    pub interrupts: u32,
    pub interrupt_attempts: u32,
    /// spec tem interrupt ou o player usou um no log
    pub can_interrupt: bool,
    pub interrupt_log: Vec<InterruptUse>,
    /// Casts do player (sem pets) até o corte, por habilidade: base da comparação de desempenho
    pub casts: Vec<SpellCasts>,
    /// Dano e cura por habilidade (pets somados ao dono), maiores primeiro
    pub damage_by_spell: Vec<SpellAmount>,
    pub healing_by_spell: Vec<SpellAmount>,
    /// Tempo vivo dentro do tempo analisado (até a morte ou o corte)
    pub alive_ms: i64,
    /// Talentos, itens e status (COMBATANT_INFO do início do pull)
    pub setup: Option<Setup>,
    /// rotação da spec (se ela tiver rotação base escrita): achados e aproveitamento
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<crate::rotation::RotationResult>,
    /// dano / cura por janela de 5s (pets somados), até o corte
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub damage_timeline: Vec<i64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub healing_timeline: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellCasts {
    pub spell_id: u32,
    pub name: String,
    /// ms desde o início do pull
    pub times: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellAmount {
    pub spell_id: u32,
    pub name: String,
    pub amount: i64,
    /// veio de pet/guardião
    pub pet: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub stats: SetupStats,
    /// média dos itens equipados (arma de duas mãos conta duas vezes, como no jogo)
    pub item_level: f32,
    pub items: Vec<GearItem>,
    /// entradas de talento escolhidas: (nó, entrada, rank)
    pub talents: Vec<[u32; 3]>,
}

/// Rating secundário (não %) e atributos primários, como vêm no log.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStats {
    pub strength: u32,
    pub agility: u32,
    pub stamina: u32,
    pub intellect: u32,
    pub crit: u32,
    pub haste: u32,
    pub mastery: u32,
    pub versatility: u32,
    pub leech: u32,
    pub avoidance: u32,
    pub speed: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GearItem {
    /// posição na lista do COMBATANT_INFO (0 = cabeça … 15 = arma, 16 = mão secundária)
    pub slot: u8,
    pub item_id: u32,
    pub ilvl: u32,
    pub enchant: Option<u32>,
    pub gems: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellUse {
    pub spell_id: u32,
    pub name: String,
    /// ms desde o início do pull
    pub t: i64,
    /// guid de quem aplicou (externals); igual ao player para pessoais
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityDamage {
    pub spell_id: u32,
    pub name: String,
    pub source: String,
    pub amount: i64,
    pub hits: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Death {
    /// 1 = primeira morte do pull
    pub order: u32,
    pub guid: String,
    pub name: String,
    pub class: Option<String>,
    pub role: Option<String>,
    pub t: i64,
    /// Depois do corte ("ignorar após N mortes"): só para consulta, não conta em nada
    pub ignored: bool,
    pub killing_blow: Option<RecapEntry>,
    /// Mecânica do boss (regras) que deu o golpe final, se reconhecida
    pub killing_blow_mechanic: Option<String>,
    /// spike | slow | normal | unknown
    pub death_kind: String,
    pub stats: DeathStats,
    /// Debuffs ativos no player no momento da morte
    pub debuffs: Vec<DeathAura>,
    /// Dano recebido no recap vindo de mecânicas com falha (regras), maior primeiro
    pub mechanic_damage: Vec<MechanicShare>,
    /// Mecânica que causou a morte: golpe final ou >= 35% do dano recebido
    pub caused_by: Option<MechanicShare>,
    /// Eventos dos últimos segundos antes da morte, em ordem cronológica
    pub recap: Vec<RecapEntry>,
    /// Defensivos (pessoais ou externos) ativados nos últimos 10s
    pub defensives_recent: Vec<SpellUse>,
    /// Defensivos que o player usou em algum pull do log e estavam fora de cooldown
    pub defensives_available: Vec<AvailableSpell>,
    pub used_health_potion: bool,
    pub used_healthstone: bool,
    /// Player usou healthstone em algum pull do log (logo provavelmente tinha)
    pub healthstone_known: bool,
    /// onde cada um estava na hora da morte (só mortes antes do corte)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub positions: Option<Positions>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathStats {
    pub max_hp: Option<i64>,
    /// tempo contínuo abaixo de 50% de HP antes de morrer
    pub below_half_ms: Option<i64>,
    /// maior HP% nos 3s antes da morte
    pub max_hp_pct_last_3s: Option<f32>,
    pub damage_taken_10s: i64,
    pub healing_received_10s: i64,
    /// cura recebida nos últimos 10s em % do HP máximo
    pub healing_pct_of_max_10s: Option<f32>,
    /// cura baixa: < 25% do HP máximo nos últimos 10s
    pub underhealed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathAura {
    pub spell_id: u32,
    pub name: String,
    pub stacks: u32,
    pub source: String,
    /// ms desde o início do pull
    pub applied_t: i64,
    /// mecânica do boss (regras) a que esse debuff pertence
    pub mechanic: Option<String>,
    pub tip: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MechanicShare {
    pub key: String,
    pub name: String,
    pub amount: i64,
    /// % do dano recebido no recap
    pub pct: f32,
    /// última falha coletiva dessa mecânica antes da morte (soak, interrupt...)
    pub fail_t: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptUse {
    pub t: i64,
    /// interrupt usado (Kick, Pummel, ...)
    pub spell_id: u32,
    pub spell: String,
    /// cast cortado; None = tentativa que não cortou nada
    pub target_spell_id: Option<u32>,
    pub target_spell: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableSpell {
    pub spell_id: u32,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecapKind {
    Damage,
    Heal,
    Buff,
    Debuff,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapEntry {
    pub t: i64,
    pub kind: RecapKind,
    pub spell_id: u32,
    pub spell_name: String,
    pub source: String,
    pub amount: i64,
    pub overkill: i64,
    pub absorbed: i64,
    /// HP do player depois do evento (0-100), quando o log informa
    pub hp_pct: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemySpell {
    pub spell_id: u32,
    pub name: String,
    pub sources: Vec<String>,
    pub casts: u32,
    pub hits_on_players: u32,
    pub damage_to_players: i64,
    /// vezes que foi interrompido neste pull
    pub interrupted: u32,
    /// foi interrompido ao menos uma vez em algum pull do log
    pub interruptible: bool,
}
