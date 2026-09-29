//! "Pergunte à IA": conversa sobre o pull com um modelo de linguagem escolhido pelo usuário.
//!
//! Um cliente só, no formato de chat compatível com OpenAI (`/chat/completions`), que atende
//! os provedores com plano gratuito (Gemini, Groq, OpenRouter) e modelos locais (Ollama,
//! LM Studio). O contexto da luta é montado na UI; aqui só se envia.
//!
//! A chave de API fica no cofre de credenciais do sistema (Gerenciador de Credenciais no
//! Windows), nunca no settings.json, e só é enviada para a URL configurada.

use crate::settings;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;

const KEYRING_SERVICE: &str = "wipe-cause";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    /// "gemini" | "groq" | "openrouter" | "ollama" | "custom"
    pub provider: String,
    pub base_url: String,
    pub model: String,
    /// só na leitura: há chave salva para este provedor
    #[serde(default)]
    pub has_key: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

fn key_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("ai-key-{provider}")).map_err(|e| e.to_string())
}

fn load_key(provider: &str) -> Option<String> {
    key_entry(provider).ok()?.get_password().ok().filter(|k| !k.is_empty())
}

/// https em qualquer lugar; http só na própria máquina (Ollama/LM Studio).
pub fn valid_base_url(url: &str) -> bool {
    let u = url.trim().to_lowercase();
    u.starts_with("https://") || ["http://localhost", "http://127.0.0.1", "http://[::1]"].iter().any(|p| u.starts_with(p))
}

fn endpoint(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim().trim_end_matches('/'), path)
}

#[tauri::command]
pub fn ai_get_config(app: AppHandle) -> Option<AiConfig> {
    let s = settings::load(&app);
    let provider = s.ai_provider?;
    Some(AiConfig {
        has_key: load_key(&provider).is_some(),
        provider,
        base_url: s.ai_base_url.unwrap_or_default(),
        model: s.ai_model.unwrap_or_default(),
    })
}

/// Salva provedor/URL/modelo. `api_key`: None = mantém a salva; "" = apaga.
#[tauri::command]
pub fn ai_set_config(app: AppHandle, config: AiConfig, api_key: Option<String>) -> Result<(), String> {
    if !valid_base_url(&config.base_url) {
        return Err("A URL precisa começar com https:// (ou http://localhost para modelos locais).".into());
    }
    if let Some(k) = api_key {
        let entry = key_entry(&config.provider)?;
        if k.trim().is_empty() {
            let _ = entry.delete_credential();
        } else {
            entry.set_password(k.trim()).map_err(|e| format!("não foi possível guardar a chave: {e}"))?;
        }
    }
    settings::update(&app, |s| {
        s.ai_provider = Some(config.provider);
        s.ai_base_url = Some(config.base_url.trim().to_string());
        s.ai_model = Some(config.model.trim().to_string());
    })
}

fn agent(secs: u64) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(secs)).build()
}

fn request(agent: &ureq::Agent, method: &str, url: &str, key: Option<&str>) -> ureq::Request {
    let r = agent.request(method, url).set("Content-Type", "application/json");
    match key {
        Some(k) => r.set("Authorization", &format!("Bearer {k}")),
        None => r,
    }
}

/// Mensagem de erro amigável para os códigos comuns dos provedores.
fn http_error(code: u16, body: String) -> String {
    match code {
        401 | 403 => "O provedor recusou a chave de API (inválida ou sem permissão).".into(),
        404 => "Modelo ou URL não encontrados no provedor. Confira o nome do modelo.".into(),
        429 => "Limite do plano gratuito atingido. Espere um pouco ou troque de modelo/provedor.".into(),
        _ => format!("O provedor respondeu {code}: {}", body.chars().take(400).collect::<String>()),
    }
}

/// Modelos disponíveis no provedor (GET /models), para escolher na lista.
#[tauri::command]
pub async fn ai_list_models(provider: String, base_url: String, api_key: Option<String>) -> Result<Vec<String>, String> {
    if !valid_base_url(&base_url) {
        return Err("URL inválida.".into());
    }
    let key = api_key.filter(|k| !k.trim().is_empty()).or_else(|| load_key(&provider));
    tauri::async_runtime::spawn_blocking(move || {
        let res = request(&agent(20), "GET", &endpoint(&base_url, "models"), key.as_deref()).call();
        let json: serde_json::Value = match res {
            Ok(r) => r.into_json().map_err(|e| e.to_string())?,
            Err(ureq::Error::Status(code, r)) => return Err(http_error(code, r.into_string().unwrap_or_default())),
            Err(e) => return Err(format!("Sem conexão com o provedor: {e}")),
        };
        let mut ids: Vec<String> = json["data"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|m| m["id"].as_str())
            // o Gemini devolve "models/gemini-..."; o chat aceita sem o prefixo
            .map(|id| id.trim_start_matches("models/").to_string())
            .collect();
        ids.sort();
        Ok(ids)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Envia a conversa e devolve a resposta do modelo.
#[tauri::command]
pub async fn ai_chat(app: AppHandle, messages: Vec<ChatMessage>) -> Result<String, String> {
    let cfg = ai_get_config(app).ok_or("Configure a IA primeiro (provedor e modelo).")?;
    if !valid_base_url(&cfg.base_url) {
        return Err("URL do provedor inválida.".into());
    }
    let key = load_key(&cfg.provider);
    let body = serde_json::json!({ "model": cfg.model, "messages": messages, "temperature": 0.3 });
    tauri::async_runtime::spawn_blocking(move || {
        let res = request(&agent(180), "POST", &endpoint(&cfg.base_url, "chat/completions"), key.as_deref()).send_json(body);
        let json: serde_json::Value = match res {
            Ok(r) => r.into_json().map_err(|e| e.to_string())?,
            Err(ureq::Error::Status(code, r)) => return Err(http_error(code, r.into_string().unwrap_or_default())),
            Err(e) => return Err(format!("Sem conexão com o provedor: {e}")),
        };
        json["choices"][0]["message"]["content"]
            .as_str()
            .map(str::to_string)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| format!("Resposta vazia do provedor: {}", json.to_string().chars().take(300).collect::<String>()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_rules() {
        assert!(valid_base_url("https://api.groq.com/openai/v1"));
        assert!(valid_base_url("http://localhost:11434/v1"));
        assert!(valid_base_url("http://127.0.0.1:1234/v1"));
        assert!(!valid_base_url("http://example.com/v1"));
        assert!(!valid_base_url("ftp://x"));
        assert_eq!(endpoint("https://a.b/v1/", "chat/completions"), "https://a.b/v1/chat/completions");
    }

    #[test]
    fn friendly_errors() {
        assert!(http_error(429, String::new()).contains("Limite do plano gratuito"));
        assert!(http_error(401, String::new()).contains("chave"));
    }
}
