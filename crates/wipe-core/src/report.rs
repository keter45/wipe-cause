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
    /// Número do pull para este boss + dificuldade no log (1..)
    pub pull_number: u32,
    /// Epoch ms (UTC quando o log tem offset de fuso)
    pub start_ms: i64,
    /// Timestamp original da linha ENCOUNTER_START (hora local do jogo)
    pub start_local: String,
    pub tz_offset_hours: f64,
    pub duration_ms: i64,
    pub success: bool,
    /// ENCOUNTER_END não encontrado (log cortado / desconectou)
    pub incomplete: bool,
    pub bosses: Vec<BossState>,
    pub players: Vec<PlayerStats>,
    pub deaths: Vec<Death>,
    pub enemy_spells: Vec<EnemySpell>,
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
    pub killing_blow: Option<RecapEntry>,
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
}
