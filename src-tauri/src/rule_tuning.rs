//! Ajustes do usuário nas regras de boss (ligar/desligar, gravidade, tolerância, foco…) e
//! mecânicas criadas por ele. Ficam em `rule-tuning/<encounter_id>.json` na pasta do app, como
//! uma camada por cima da regra: quando o app atualiza as regras, os ajustes continuam valendo.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use wipe_core::rules::{RuleBook, Tuning, TUNABLE_FIELDS};

/// Pasta dos ajustes (criada se não existir).
pub fn tuning_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("rule-tuning");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn tuning_file(app: &AppHandle, encounter_id: u32) -> Result<PathBuf, String> {
    Ok(tuning_dir(app).ok_or("Sem pasta de dados do app.")?.join(format!("{encounter_id}.json")))
}

/// Regras do app + as da pasta do usuário (sem ajustes).
fn base_book(app: &AppHandle) -> RuleBook {
    let mut book = RuleBook::embedded();
    if let Some(dir) = crate::user_rules_dir(app) {
        book.load_dir(&dir);
    }
    book
}

fn load(app: &AppHandle, encounter_id: u32) -> Option<Tuning> {
    let s = std::fs::read_to_string(tuning_file(app, encounter_id).ok()?).ok()?;
    serde_json::from_str(&s).ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BossRules {
    pub encounter_id: u32,
    pub name: String,
    /// arquivo de regra do app (None: boss sem regra, só as criadas pelo usuário)
    pub file: Option<String>,
    /// mecânicas como estão na regra (o padrão), no formato do YAML
    pub mechanics: Vec<serde_json::Value>,
    pub tuning: Option<Tuning>,
    pub tunable: Vec<&'static str>,
}

#[tauri::command]
pub fn rules_get(app: AppHandle, encounter_id: u32, name: String) -> BossRules {
    let book = base_book(&app);
    let base = book.base(encounter_id);
    BossRules {
        encounter_id,
        name: base.map(|b| b.name.clone()).unwrap_or(name),
        file: base.map(|b| b.file.clone()),
        mechanics: base
            .map(|b| b.raw_mechanics().iter().filter_map(|m| serde_json::to_value(m).ok()).collect())
            .unwrap_or_default(),
        tuning: load(&app, encounter_id),
        tunable: TUNABLE_FIELDS.to_vec(),
    }
}

/// Salva os ajustes de um boss, depois de conferir que a regra continua válida.
/// Ajustes vazios apagam o arquivo (volta ao padrão).
#[tauri::command]
pub fn rules_save_tuning(app: AppHandle, tuning: Tuning) -> Result<(), String> {
    let file = tuning_file(&app, tuning.encounter_id)?;
    let empty = tuning.mechanics.values().all(|m| m.is_empty()) && tuning.custom.is_empty();
    if empty {
        let _ = std::fs::remove_file(&file);
        return Ok(());
    }
    base_book(&app).apply_tuning(&tuning)?;
    let json = serde_json::to_string_pretty(&tuning).map_err(|e| e.to_string())?;
    std::fs::write(&file, json).map_err(|e| format!("não foi possível salvar os ajustes: {e}"))
}

#[tauri::command]
pub fn rules_reset_tuning(app: AppHandle, encounter_id: u32) -> Result<(), String> {
    let file = tuning_file(&app, encounter_id)?;
    match std::fs::remove_file(&file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
