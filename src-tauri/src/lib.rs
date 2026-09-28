use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use wipe_core::LogReport;

#[derive(Clone, Serialize)]
struct Progress {
    read: u64,
    total: u64,
}

/// Analisa o combat log fora da thread da UI, emitindo `analyze-progress` durante a leitura.
#[tauri::command]
async fn analyze_log(app: AppHandle, path: String) -> Result<LogReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        wipe_core::analyze_file(&PathBuf::from(&path), |read, total| {
            let _ = app.emit("analyze-progress", Progress { read, total });
        })
        .map_err(|e| format!("não foi possível ler {path}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![analyze_log])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Wipe Cause");
}
