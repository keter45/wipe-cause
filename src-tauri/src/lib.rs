mod ai;
mod discord;
mod history;
mod live;
mod logs;
mod rule_tuning;
mod settings;
mod talents;
mod wcl;
mod wcr;

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use rule_tuning::tuning_dir;
use wipe_core::LogReport;

#[derive(Clone, Serialize)]
struct Progress {
    read: u64,
    total: u64,
}

/// Pasta onde o usuário pode colocar regras de boss (*.yaml) que substituem as embutidas.
pub(crate) fn user_rules_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("encounters");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Analisa o log e guarda no histórico (se o histórico falhar, a análise continua valendo).
/// `progress(lidos, total)` acompanha a leitura.
pub(crate) fn analyze_and_save(app: &AppHandle, path: &str, death_cutoff: u32, progress: impl FnMut(u64, u64)) -> Result<LogReport, String> {
    let opts = wipe_core::AnalyzeOptions { rules_dir: user_rules_dir(app), tuning_dir: tuning_dir(app), death_cutoff };
    let report = wipe_core::analyze_file(&PathBuf::from(path), &opts, progress).map_err(|e| format!("não foi possível ler {path}: {e}"))?;
    if let Err(e) = history::save(app, &report, path) {
        eprintln!("não foi possível salvar no histórico: {e}");
    }
    Ok(report)
}

/// Analisa o combat log fora da thread da UI, emitindo `analyze-progress` durante a leitura.
#[tauri::command]
async fn analyze_log(app: AppHandle, path: String, death_cutoff: Option<u32>) -> Result<LogReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        analyze_and_save(&app, &path, death_cutoff.unwrap_or(0), |read, total| {
            let _ = app.emit("analyze-progress", Progress { read, total });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Grava um arquivo escolhido pelo usuário no diálogo "Salvar" (imagem ou HTML do resumo).
#[tauri::command]
fn save_file(path: String, data_b64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_b64).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("não foi possível salvar {path}: {e}"))
}

/// Caminho da pasta de regras do usuário, para mostrar na UI.
#[tauri::command]
fn rules_dir(app: AppHandle) -> Option<String> {
    user_rules_dir(&app).map(|p| p.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // atualização automática: latest.json da última release no GitHub, assinado
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            analyze_log,
            rules_dir,
            rule_tuning::rules_get,
            rule_tuning::rules_save_tuning,
            rule_tuning::rules_reset_tuning,
            ai::ai_get_config,
            ai::ai_set_config,
            ai::ai_list_models,
            ai::ai_chat,
            talents::talent_tree,
            wcl::wcl_get_config,
            wcl::wcl_set_config,
            wcl::wcl_query,
            live::live_start,
            live::live_stop,
            live::live_status,
            discord::discord_get_config,
            discord::discord_set_config,
            discord::discord_post,
            discord::discord_post_image,
            save_file,
            logs::logs_list,
            logs::logs_peek,
            logs::logs_get_dir,
            logs::logs_set_dir,
            logs::logs_detect_dir,
            wcr::wcr_videos,
            wcr::wcr_get_dir,
            wcr::wcr_set_dir,
            wcr::wcr_detect_dir,
            history::history_list,
            history::history_load,
            history::history_set_pinned,
            history::history_delete,
            history::history_delete_unpinned,
            history::history_trends
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Wipe Cause");
}
