mod discord;
mod history;
mod live;
mod logs;
mod settings;
mod wcr;

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use wipe_core::LogReport;

#[derive(Clone, Serialize)]
struct Progress {
    read: u64,
    total: u64,
}

/// Pasta onde o usuário pode colocar regras de boss (*.yaml) que substituem as embutidas.
fn user_rules_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("encounters");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Analisa o log e guarda no histórico (se o histórico falhar, a análise continua valendo).
/// `progress(lidos, total)` acompanha a leitura.
pub(crate) fn analyze_and_save(app: &AppHandle, path: &str, death_cutoff: u32, progress: impl FnMut(u64, u64)) -> Result<LogReport, String> {
    let opts = wipe_core::AnalyzeOptions { rules_dir: user_rules_dir(app), death_cutoff };
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
            live::live_start,
            live::live_stop,
            live::live_status,
            discord::discord_get_config,
            discord::discord_set_config,
            discord::discord_post,
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
