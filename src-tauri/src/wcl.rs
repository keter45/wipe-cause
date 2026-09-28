//! Integração com a API v2 do Warcraft Logs (client credentials), só para achar o ID
//! de cada fight do report e montar o link da try. As credenciais ficam em
//! `settings.json` na pasta de configuração do app, nesta máquina.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const TOKEN_URL: &str = "https://www.warcraftlogs.com/oauth/token";
const API_URL: &str = "https://www.warcraftlogs.com/api/v2/client";

#[derive(Default, Serialize, Deserialize)]
struct Settings {
    #[serde(default)]
    wcl_client_id: String,
    #[serde(default)]
    wcl_client_secret: String,
}

#[derive(Default)]
pub struct WclState {
    token: Mutex<Option<(String, Instant)>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WclSettingsView {
    client_id: String,
    has_secret: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WclFight {
    id: u32,
    encounter_id: u32,
    /// epoch ms (UTC)
    start_ms: i64,
    end_ms: i64,
    kill: bool,
    fight_percentage: Option<f64>,
    difficulty: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WclReport {
    code: String,
    title: String,
    fights: Vec<WclFight>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn load(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Aceita o código do report ou a URL inteira (…/reports/AbCd1234EfGh5678#fight=3).
pub fn report_code(input: &str) -> Option<String> {
    let s = input.trim();
    let code = match s.find("/reports/") {
        Some(i) => &s[i + "/reports/".len()..],
        None => s,
    };
    let code: String = code.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    (code.len() >= 8).then_some(code)
}

#[tauri::command]
pub fn wcl_get_settings(app: AppHandle) -> WclSettingsView {
    let s = load(&app);
    WclSettingsView { client_id: s.wcl_client_id, has_secret: !s.wcl_client_secret.is_empty() }
}

/// `client_secret` vazio mantém o secret salvo.
#[tauri::command]
pub fn wcl_save_settings(app: AppHandle, state: State<WclState>, client_id: String, client_secret: String) -> Result<(), String> {
    let mut s = load(&app);
    s.wcl_client_id = client_id.trim().to_string();
    if !client_secret.trim().is_empty() {
        s.wcl_client_secret = client_secret.trim().to_string();
    }
    let json = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(&app)?, json).map_err(|e| e.to_string())?;
    *state.token.lock().unwrap() = None;
    Ok(())
}

async fn token(app: &AppHandle, state: &WclState, http: &reqwest::Client) -> Result<String, String> {
    if let Some((tok, exp)) = state.token.lock().unwrap().as_ref() {
        if Instant::now() < *exp {
            return Ok(tok.clone());
        }
    }
    let s = load(app);
    if s.wcl_client_id.is_empty() || s.wcl_client_secret.is_empty() {
        return Err("Configure o client id e o secret do Warcraft Logs (engrenagem no topo).".into());
    }
    #[derive(Deserialize)]
    struct Tok {
        access_token: String,
        expires_in: u64,
    }
    let resp = http
        .post(TOKEN_URL)
        .basic_auth(&s.wcl_client_id, Some(&s.wcl_client_secret))
        .form(&[("grant_type", "client_credentials")])
        .send()
        .await
        .map_err(|e| format!("Warcraft Logs indisponível: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Credenciais do Warcraft Logs recusadas ({}).", resp.status()));
    }
    let t: Tok = resp.json().await.map_err(|e| e.to_string())?;
    // renova 5 min antes de expirar
    let exp = Instant::now() + Duration::from_secs(t.expires_in.saturating_sub(300));
    *state.token.lock().unwrap() = Some((t.access_token.clone(), exp));
    Ok(t.access_token)
}

#[tauri::command]
pub async fn wcl_report(app: AppHandle, state: State<'_, WclState>, report: String) -> Result<WclReport, String> {
    let code = report_code(&report).ok_or("Link ou código de report inválido.")?;
    let http = reqwest::Client::new();
    let tok = token(&app, &state, &http).await?;
    let query = r#"query($code: String!) {
      reportData { report(code: $code) {
        title startTime
        fights(killType: Encounters) { id encounterID startTime endTime kill fightPercentage difficulty }
      } }
    }"#;
    let body = serde_json::json!({ "query": query, "variables": { "code": code } });
    let resp = http.post(API_URL).bearer_auth(tok).json(&body).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Erro na API do Warcraft Logs ({}).", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = v.pointer("/errors/0/message").and_then(|m| m.as_str()) {
        return Err(format!("Warcraft Logs: {err}"));
    }
    let r = v.pointer("/data/reportData/report").filter(|r| !r.is_null()).ok_or("Report não encontrado (privado ou código errado?).")?;
    let base = r["startTime"].as_i64().unwrap_or(0);
    let fights = r["fights"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|f| WclFight {
            id: f["id"].as_u64().unwrap_or(0) as u32,
            encounter_id: f["encounterID"].as_u64().unwrap_or(0) as u32,
            start_ms: base + f["startTime"].as_i64().unwrap_or(0),
            end_ms: base + f["endTime"].as_i64().unwrap_or(0),
            kill: f["kill"].as_bool().unwrap_or(false),
            fight_percentage: f["fightPercentage"].as_f64(),
            difficulty: f["difficulty"].as_u64().map(|d| d as u32),
        })
        .collect();
    Ok(WclReport { code, title: r["title"].as_str().unwrap_or("").to_string(), fights })
}

#[cfg(test)]
mod tests {
    use super::report_code;

    #[test]
    fn extracts_report_code() {
        assert_eq!(report_code("https://www.warcraftlogs.com/reports/AbCd1234EfGh5678#fight=3&type=deaths").as_deref(), Some("AbCd1234EfGh5678"));
        assert_eq!(report_code("  AbCd1234EfGh5678 ").as_deref(), Some("AbCd1234EfGh5678"));
        assert_eq!(report_code("nada"), None);
    }
}
