//! API v2 do Warcraft Logs (GraphQL), para comparar com os top players da spec.
//!
//! O usuário cria um client em warcraftlogs.com/api/clients e cola o client ID e o secret no
//! app; os dois ficam no cofre de credenciais do sistema. O token (client credentials) fica só
//! na memória. As consultas são montadas na UI; aqui só se envia, e as respostas de dados que
//! não mudam (fights de reports já enviados) ficam em cache no disco para poupar os pontos
//! da API.

use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "wipe-cause";
const TOKEN_URL: &str = "https://www.warcraftlogs.com/oauth/token";
const API_URL: &str = "https://www.warcraftlogs.com/api/v2/client";

static TOKEN: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, name).map_err(|e| e.to_string())
}

fn credentials() -> Option<(String, String)> {
    let id = entry("wcl-client-id").ok()?.get_password().ok().filter(|v| !v.is_empty())?;
    let secret = entry("wcl-client-secret").ok()?.get_password().ok().filter(|v| !v.is_empty())?;
    Some((id, secret))
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).build()
}

fn http_error(code: u16, body: String) -> String {
    match code {
        400 | 401 | 403 => "O Warcraft Logs recusou o client ID/secret. Confira os dois em warcraftlogs.com/api/clients.".into(),
        429 => "Limite de pontos da API do Warcraft Logs atingido nesta hora. Tente de novo mais tarde.".into(),
        _ => format!("O Warcraft Logs respondeu {code}: {}", body.chars().take(300).collect::<String>()),
    }
}

/// Token de acesso (client credentials), renovado um pouco antes de expirar.
fn token(id: &str, secret: &str) -> Result<String, String> {
    if let Some((t, until)) = TOKEN.lock().unwrap().as_ref() {
        if Instant::now() < *until {
            return Ok(t.clone());
        }
    }
    let basic = base64::engine::general_purpose::STANDARD.encode(format!("{id}:{secret}"));
    let res = agent()
        .post(TOKEN_URL)
        .set("Authorization", &format!("Basic {basic}"))
        .send_form(&[("grant_type", "client_credentials")]);
    let json: serde_json::Value = match res {
        Ok(r) => r.into_json().map_err(|e| e.to_string())?,
        Err(ureq::Error::Status(code, r)) => return Err(http_error(code, r.into_string().unwrap_or_default())),
        Err(e) => return Err(format!("Sem conexão com o Warcraft Logs: {e}")),
    };
    let t = json["access_token"].as_str().ok_or("Resposta de token inválida do Warcraft Logs.")?.to_string();
    let secs = json["expires_in"].as_u64().unwrap_or(3600).saturating_sub(300).max(60);
    *TOKEN.lock().unwrap() = Some((t.clone(), Instant::now() + Duration::from_secs(secs)));
    Ok(t)
}

fn graphql(id: &str, secret: &str, query: &str, variables: &serde_json::Value) -> Result<serde_json::Value, String> {
    let t = token(id, secret)?;
    let res = agent()
        .post(API_URL)
        .set("Authorization", &format!("Bearer {t}"))
        .send_json(serde_json::json!({ "query": query, "variables": variables }));
    let json: serde_json::Value = match res {
        Ok(r) => r.into_json().map_err(|e| e.to_string())?,
        Err(ureq::Error::Status(401, _)) => {
            *TOKEN.lock().unwrap() = None; // token revogado: tenta de novo na próxima
            return Err("Sessão do Warcraft Logs expirou; tente de novo.".into());
        }
        Err(ureq::Error::Status(code, r)) => return Err(http_error(code, r.into_string().unwrap_or_default())),
        Err(e) => return Err(format!("Sem conexão com o Warcraft Logs: {e}")),
    };
    if let Some(errs) = json["errors"].as_array().filter(|e| !e.is_empty()) {
        let msg: Vec<&str> = errs.iter().filter_map(|e| e["message"].as_str()).collect();
        return Err(format!("Erro na consulta ao Warcraft Logs: {}", msg.join("; ")));
    }
    Ok(json["data"].clone())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WclConfig {
    pub configured: bool,
    /// para mostrar qual client está salvo (o secret nunca volta para a UI)
    pub client_id: Option<String>,
}

#[tauri::command]
pub fn wcl_get_config() -> WclConfig {
    let id = entry("wcl-client-id").ok().and_then(|e| e.get_password().ok()).filter(|v| !v.is_empty());
    WclConfig { configured: credentials().is_some(), client_id: id }
}

/// Valida (pedindo um token) e guarda. Strings vazias apagam.
#[tauri::command]
pub async fn wcl_set_config(client_id: String, client_secret: String) -> Result<(), String> {
    let (id, secret) = (client_id.trim().to_string(), client_secret.trim().to_string());
    *TOKEN.lock().unwrap() = None;
    if id.is_empty() && secret.is_empty() {
        let _ = entry("wcl-client-id")?.delete_credential();
        let _ = entry("wcl-client-secret")?.delete_credential();
        return Ok(());
    }
    if id.is_empty() || secret.is_empty() {
        return Err("Preencha o client ID e o client secret.".into());
    }
    let (i, s) = (id.clone(), secret.clone());
    tauri::async_runtime::spawn_blocking(move || token(&i, &s)).await.map_err(|e| e.to_string())??;
    entry("wcl-client-id")?.set_password(&id).map_err(|e| format!("não foi possível guardar: {e}"))?;
    entry("wcl-client-secret")?.set_password(&secret).map_err(|e| format!("não foi possível guardar: {e}"))?;
    Ok(())
}

/// Nome de arquivo seguro para a chave de cache vinda da UI.
fn cache_file(app: &AppHandle, key: &str) -> Option<PathBuf> {
    let safe: String = key.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).take(120).collect();
    (!safe.is_empty()).then(|| Some(app.path().app_data_dir().ok()?.join("wcl-cache").join(format!("{safe}.json"))))?
}

/// Consulta GraphQL. `cache_key`: guarda a resposta no disco (só para dados que não mudam).
#[tauri::command]
pub async fn wcl_query(app: AppHandle, query: String, variables: serde_json::Value, cache_key: Option<String>) -> Result<serde_json::Value, String> {
    let file = cache_key.as_deref().and_then(|k| cache_file(&app, k));
    if let Some(f) = &file {
        if let Some(v) = std::fs::read_to_string(f).ok().and_then(|s| serde_json::from_str(&s).ok()) {
            return Ok(v);
        }
    }
    let (id, secret) = credentials().ok_or("Configure o client do Warcraft Logs primeiro.")?;
    let data = tauri::async_runtime::spawn_blocking(move || graphql(&id, &secret, &query, &variables)).await.map_err(|e| e.to_string())??;
    if let Some(f) = &file {
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(f, data.to_string());
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friendly_errors() {
        assert!(http_error(401, String::new()).contains("client ID"));
        assert!(http_error(429, String::new()).contains("Limite"));
        assert!(http_error(500, "x".repeat(1000)).len() < 400);
    }
}
