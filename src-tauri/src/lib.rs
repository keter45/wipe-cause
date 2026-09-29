mod history;
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

/// Analisa o combat log fora da thread da UI, emitindo `analyze-progress` durante a leitura.
#[tauri::command]
async fn analyze_log(app: AppHandle, path: String, death_cutoff: Option<u32>) -> Result<LogReport, String> {
    let opts = wipe_core::AnalyzeOptions { rules_dir: user_rules_dir(&app), death_cutoff: death_cutoff.unwrap_or(0) };
    tauri::async_runtime::spawn_blocking(move || {
        let report = wipe_core::analyze_file(&PathBuf::from(&path), &opts, |read, total| {
            let _ = app.emit("analyze-progress", Progress { read, total });
        })
        .map_err(|e| format!("não foi possível ler {path}: {e}"))?;
        // guarda no histórico; se falhar, a análise continua valendo
        if let Err(e) = history::save(&app, &report, &path) {
            eprintln!("não foi possível salvar no histórico: {e}");
        }
        Ok(report)
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
        .invoke_handler(tauri::generate_handler![
            analyze_log,
            rules_dir,
            wcr::wcr_videos,
            wcr::wcr_get_dir,
            wcr::wcr_set_dir,
            wcr::wcr_detect_dir,
            history::history_list,
            history::history_load,
            history::history_set_pinned,
            history::history_delete,
            history::history_delete_unpinned
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Wipe Cause");
}
