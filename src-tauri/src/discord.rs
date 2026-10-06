//! Resumo dos pulls no Discord por webhook (o líder cola a URL do webhook do canal da raid).
//! A mensagem é montada na UI (mesma lógica do veredito do pull); aqui só se envia.

use crate::settings;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use wipe_core::i18n::pick;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordConfig {
    pub webhook: Option<String>,
    /// postar automaticamente no modo ao vivo (como imagem): o pull do wipe, o resumo do boss
    /// no kill e o resumo da noite no fim da raid
    pub on_wipe: bool,
    pub on_kill: bool,
    #[serde(default = "settings::yes")]
    pub on_night: bool,
    /// chave geral do envio automático; desligada, os de cima ficam guardados mas nada vai
    #[serde(default = "settings::yes")]
    pub auto: bool,
}

/// Aceita só webhooks do Discord (a URL vai direto para uma requisição HTTP).
pub fn valid_webhook(url: &str) -> bool {
    ["https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/", "https://ptb.discord.com/api/webhooks/", "https://canary.discord.com/api/webhooks/"]
        .iter()
        .any(|p| url.starts_with(p))
}

#[tauri::command]
pub fn discord_get_config(app: AppHandle) -> DiscordConfig {
    let s = settings::load(&app);
    DiscordConfig { webhook: s.discord_webhook, on_wipe: s.discord_on_wipe, on_kill: s.discord_on_kill, on_night: s.discord_on_night, auto: s.discord_auto }
}

#[tauri::command]
pub fn discord_set_config(app: AppHandle, config: DiscordConfig) -> Result<(), String> {
    let webhook = settings::clean_dir(config.webhook);
    if let Some(w) = &webhook {
        if !valid_webhook(w) {
            return Err(pick("Isso não parece um webhook do Discord (https://discord.com/api/webhooks/…).", "That doesn't look like a Discord webhook (https://discord.com/api/webhooks/…)."));
        }
    }
    settings::update(&app, |s| {
        s.discord_webhook = webhook;
        s.discord_on_wipe = config.on_wipe;
        s.discord_on_kill = config.on_kill;
        s.discord_on_night = config.on_night;
        s.discord_auto = config.auto;
    })
}

/// Envia a mensagem (JSON do webhook: content/embeds). `webhook` = outro destino (ex.: testar
/// antes de salvar); sem ele, usa o salvo.
#[tauri::command]
pub async fn discord_post(app: AppHandle, payload: serde_json::Value, webhook: Option<String>) -> Result<(), String> {
    let url = webhook
        .or_else(|| settings::load(&app).discord_webhook)
        .ok_or_else(|| pick("Nenhum webhook do Discord configurado.", "No Discord webhook set up."))?;
    if !valid_webhook(&url) {
        return Err(pick("Webhook do Discord inválido.", "Invalid Discord webhook."));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build();
        match agent.post(&url).send_json(payload) {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(404, _)) => Err(pick("O Discord não achou esse webhook (foi apagado?).", "Discord couldn't find that webhook (was it deleted?).")),
            Err(ureq::Error::Status(429, _)) => Err(pick("O Discord limitou os envios; tente de novo em alguns segundos.", "Discord is rate limiting; try again in a few seconds.")),
            Err(ureq::Error::Status(code, r)) => {
                let body = r.into_string().unwrap_or_default();
                Err(pick(format!("O Discord recusou a mensagem ({code}): {body}"), format!("Discord rejected the message ({code}): {body}")))
            }
            Err(e) => Err(pick(format!("Sem conexão com o Discord: {e}"), format!("No connection to Discord: {e}"))),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Envia uma imagem (PNG em base64) com a mensagem; o embed pode usar
/// `attachment://<file_name>` como imagem.
#[tauri::command]
pub async fn discord_post_image(app: AppHandle, payload: serde_json::Value, file_name: String, data_b64: String, webhook: Option<String>) -> Result<(), String> {
    let url = webhook
        .or_else(|| settings::load(&app).discord_webhook)
        .ok_or_else(|| pick("Nenhum webhook do Discord configurado.", "No Discord webhook set up."))?;
    if !valid_webhook(&url) {
        return Err(pick("Webhook do Discord inválido.", "Invalid Discord webhook."));
    }
    let png = base64::engine::general_purpose::STANDARD.decode(data_b64).map_err(|e| e.to_string())?;
    let (content_type, body) = multipart(&payload.to_string(), &file_name, &png);
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).build();
        match agent.post(&url).set("Content-Type", &content_type).send_bytes(&body) {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(413, _)) => Err(pick("Imagem grande demais para o Discord.", "Image too large for Discord.")),
            Err(ureq::Error::Status(code, r)) => Err(format!("O Discord recusou a imagem ({code}): {}", r.into_string().unwrap_or_default())),
            Err(e) => Err(pick(format!("Sem conexão com o Discord: {e}"), format!("No connection to Discord: {e}"))),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// multipart/form-data com `payload_json` e `files[0]` (formato do webhook do Discord).
fn multipart(payload_json: &str, file_name: &str, png: &[u8]) -> (String, Vec<u8>) {
    let boundary = "----wipecause7f3a9c2e";
    let safe_name: String = file_name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).collect();
    let mut body = Vec::with_capacity(png.len() + payload_json.len() + 512);
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"payload_json\"\r\nContent-Type: application/json\r\n\r\n{payload_json}\r\n").as_bytes(),
    );
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"files[0]\"; filename=\"{safe_name}\"\r\nContent-Type: image/png\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(png);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_discord_webhooks() {
        assert!(valid_webhook("https://discord.com/api/webhooks/123/abc"));
        assert!(valid_webhook("https://discordapp.com/api/webhooks/123/abc"));
        assert!(!valid_webhook("https://example.com/api/webhooks/123/abc"));
        assert!(!valid_webhook("http://discord.com/api/webhooks/123/abc"));
    }

    #[test]
    fn multipart_has_payload_and_file() {
        let (ct, body) = multipart(r#"{"content":"oi"}"#, "pull 12.png", b"PNGDATA");
        let text = String::from_utf8_lossy(&body);
        let boundary = ct.split("boundary=").nth(1).unwrap();
        assert!(text.starts_with(&format!("--{boundary}")));
        assert!(text.contains("name=\"payload_json\"") && text.contains(r#"{"content":"oi"}"#));
        assert!(text.contains("filename=\"pull12.png\"") && text.contains("PNGDATA"));
        assert!(text.ends_with(&format!("\r\n--{boundary}--\r\n")));
        // o Discord exige CRLF entre cabeçalhos e corpo de cada parte
        assert!(text.contains("Content-Type: image/png\r\n\r\nPNGDATA\r\n"));
        assert!(!text.replace("\r\n", "").contains('\n'));
    }
}
