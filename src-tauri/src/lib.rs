mod ai;
mod discord;
mod history;
mod live;
mod logs;
mod rule_tuning;
mod settings;
mod simc;
pub mod startup;
mod talents;
mod tray;
mod wcl;
mod wcl_auth;
mod wcl_source;
mod wcr;
mod wcr_cloud;

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use rule_tuning::tuning_dir;
use wipe_core::LogReport;
use wipe_core::i18n::pick;

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

/// Regras para a análise pelo Warcraft Logs: as embutidas, as do usuário e os ajustes.
fn wcl_book(opts: &wipe_core::AnalyzeOptions) -> wipe_core::rules::RuleBook {
    let mut book = wipe_core::rules::RuleBook::embedded();
    if let Some(dir) = &opts.rules_dir {
        book.load_dir(dir);
    }
    if let Some(dir) = &opts.tuning_dir {
        book.load_tuning_dir(dir);
    }
    book
}

/// Analisa o log (ou um report do Warcraft Logs, `wcl:<código>`) e guarda no histórico (se o
/// histórico falhar, a análise continua valendo). `progress(lidos, total)` acompanha a leitura;
/// `tz_hours` é o fuso de quem vê (o Warcraft Logs guarda os horários em UTC).
pub(crate) fn analyze_and_save(app: &AppHandle, path: &str, death_cutoff: u32, tz_hours: f64, progress: impl FnMut(u64, u64)) -> Result<LogReport, String> {
    let rules_dir = user_rules_dir(app);
    let codes = wcl_source::codes_of(path);
    let opts = wipe_core::AnalyzeOptions { rules_dir, tuning_dir: tuning_dir(app), death_cutoff };
    let report = if !codes.is_empty() {
        wcl_source::analyze(app, &codes, wcl_book(&opts), &opts, tz_hours, progress)?
    } else {
        wipe_core::analyze_file(&PathBuf::from(path), &opts, progress).map_err(|e| pick(format!("não foi possível ler {path}: {e}"), format!("could not read {path}: {e}")))?
    };
    if let Err(e) = history::save(app, &report, path) {
        eprintln!("could not save to history: {e}");
    }
    Ok(report)
}

/// Analisa o combat log fora da thread da UI, emitindo `analyze-progress` durante a leitura.
#[tauri::command]
async fn analyze_log(app: AppHandle, path: String, death_cutoff: Option<u32>, tz_hours: Option<f64>) -> Result<LogReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        analyze_and_save(&app, &path, death_cutoff.unwrap_or(0), tz_hours.unwrap_or(0.0), |read, total| {
            let _ = app.emit("analyze-progress", Progress { read, total });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Imagem de fundo da arena (raidplan.io) como data URL: a CDN não libera a imagem para o canvas
/// (sem CORS), e o clipe do replay precisa dela. Só desse endereço, até 15 MB.
#[tauri::command]
async fn fetch_image(url: String) -> Result<String, String> {
    const ALLOWED: &str = "https://cdn.raidplan.io/";
    const MAX_BYTES: u64 = 15 * 1024 * 1024;
    if !url.starts_with(ALLOWED) || url.contains("..") {
        return Err("address not allowed".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        use std::io::Read;
        let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(20)).build();
        let r = agent.get(&url).call().map_err(|e| e.to_string())?;
        let mime = r.content_type().to_string();
        if !mime.starts_with("image/") {
            return Err(format!("not an image: {mime}"));
        }
        let mut data = Vec::new();
        r.into_reader().take(MAX_BYTES + 1).read_to_end(&mut data).map_err(|e| e.to_string())?;
        if data.len() as u64 > MAX_BYTES {
            return Err("image too large".into());
        }
        Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&data)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Replay completo de um pull: relê só ele no log (posições do pull inteiro, vida, debuffs e
/// eventos de cada player). Pull do Warcraft Logs (`wcl:<código>`): `offset` é o id do fight.
#[tauri::command]
async fn fight_replay(app: AppHandle, path: String, offset: u64, tz_hours: Option<f64>) -> Result<wipe_core::Pull, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let opts = wipe_core::AnalyzeOptions { rules_dir: user_rules_dir(&app), tuning_dir: tuning_dir(&app), death_cutoff: 0 };
        if let Some(code) = wcl_source::codes_of(&path).first() {
            return wcl_source::replay(&app, code, offset as i64, wcl_book(&opts), tz_hours.unwrap_or(0.0));
        }
        wipe_core::analyze_pull_full(&PathBuf::from(&path), offset, &opts).map_err(|e| pick(format!("não foi possível reler o pull em {path}: {e}"), format!("could not re-read the pull in {path}: {e}")))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Grava um arquivo escolhido pelo usuário no diálogo "Salvar" (imagem ou HTML do resumo).
#[tauri::command]
fn save_file(path: String, data_b64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_b64).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| pick(format!("não foi possível salvar {path}: {e}"), format!("could not save {path}: {e}")))
}

/// Idioma da UI: vale para as mensagens do backend, o menu da bandeja e os avisos do Windows.
/// `chosen` = o usuário escolheu (fica salvo para o app abrir já nele, mesmo escondido na bandeja);
/// sem escolha, o app segue o idioma do sistema.
#[tauri::command]
fn set_locale(app: AppHandle, locale: String, chosen: bool) -> Result<(), String> {
    wipe_core::i18n::set_english(locale == "en");
    tray::relabel(&app);
    settings::update(&app, |s| s.locale = chosen.then_some(locale))
}

/// O Windows está em português (idioma da interface)? Inglês é o padrão.
#[cfg(windows)]
fn system_is_portuguese() -> bool {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetUserDefaultUILanguage() -> u16;
    }
    // LANGID: os 10 bits de baixo são o idioma principal; 0x16 = LANG_PORTUGUESE
    unsafe { GetUserDefaultUILanguage() & 0x3ff == 0x16 }
}

#[cfg(not(windows))]
fn system_is_portuguese() -> bool {
    ["LC_ALL", "LC_MESSAGES", "LANG"].iter().find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty())).is_some_and(|v| v.to_lowercase().starts_with("pt"))
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
        // fechar a janela esconde na bandeja (o ao vivo continua); Sair fica no menu do ícone
        .setup(|app| {
            let english = match settings::load(app.handle()).locale.as_deref() {
                Some(l) => l == "en",
                None => !system_is_portuguese(),
            };
            wipe_core::i18n::set_english(english);
            tray::setup(app.handle())?;
            // a janela nasce escondida: aparece, a não ser quando o Windows abriu o app na bandeja
            if !std::env::args().any(|a| a == startup::TRAY_ARG) {
                tray::show(app.handle());
            }
            startup::repair(app.handle());
            startup::watch(app.handle().clone());
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            analyze_log,
            fight_replay,
            set_locale,
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
            wcl_auth::wcl_login,
            wcl_auth::wcl_logout,
            wcl_auth::wcl_refresh_user,
            live::live_start,
            live::live_stop,
            live::live_status,
            discord::discord_get_config,
            discord::discord_set_config,
            discord::discord_post,
            discord::discord_post_image,
            discord::discord_post_files,
            fetch_image,
            save_file,
            startup::startup_get,
            startup::startup_set,
            logs::logs_list,
            logs::logs_peek,
            logs::logs_get_dir,
            logs::logs_set_dir,
            logs::logs_detect_dir,
            wcr::wcr_videos,
            wcr::wcr_get_dir,
            wcr::wcr_set_dir,
            wcr::wcr_detect_dir,
            wcr_cloud::wcr_cloud_get_config,
            wcr_cloud::wcr_cloud_set_config,
            wcr_cloud::wcr_cloud_videos,
            history::history_list,
            history::history_load,
            history::history_set_pinned,
            history::history_delete,
            history::history_delete_unpinned,
            history::history_trends,
            simc::simc_status,
            simc::simc_install,
            simc::simc_run,
            simc::simc_cancel,
            simc::simc_saved_get,
            simc::simc_saved_put
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Wipe Cause");
}
