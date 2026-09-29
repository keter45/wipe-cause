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
