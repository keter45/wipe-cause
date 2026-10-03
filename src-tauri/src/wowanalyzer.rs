//! WoWAnalyzer numa janela do próprio app. Dentro de um iframe não dá: o site fica atrás da
//! verificação do Cloudflare, cuja página não pode ser mostrada em iframe (X-Frame-Options).
//! Numa janela de verdade a verificação aparece (quando o Cloudflare pede) e o cookie fica.
//!
//! A janela não tem nenhuma permissão do app (as capabilities valem só para a "main").

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "wowanalyzer";
const SITE: &str = "https://wowanalyzer.com/";

#[tauri::command]
pub async fn wowanalyzer_open(app: AppHandle, url: String, title: String) -> Result<(), String> {
    if !url.starts_with(SITE) {
        return Err("Só abre páginas do WoWAnalyzer.".into());
    }
    let parsed: tauri::Url = url.parse().map_err(|e| format!("link inválido: {e}"))?;
    if let Some(w) = app.get_webview_window(LABEL) {
        w.navigate(parsed).map_err(|e| e.to_string())?;
        let _ = w.set_title(&title);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(1280.0, 900.0)
        .min_inner_size(800.0, 600.0)
        .build()
        .map_err(|e| format!("não foi possível abrir a janela do WoWAnalyzer: {e}"))?;
    Ok(())
}
