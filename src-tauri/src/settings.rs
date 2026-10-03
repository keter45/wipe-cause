//! Configuração do app que varia de PC para PC (pastas cadastradas pelo usuário), em
//! settings.json na pasta de configuração do app.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
pub struct Settings {
    /// vídeos do Warcraft Recorder
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wcr_dir: Option<String>,
    /// pasta Logs do WoW (onde ficam os WoWCombatLog*.txt)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logs_dir: Option<String>,
    /// webhook do Discord para o resumo dos pulls (modo ao vivo)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discord_webhook: Option<String>,
    #[serde(default = "yes")]
    pub discord_on_wipe: bool,
    #[serde(default = "yes")]
    pub discord_on_kill: bool,
    /// resumo da noite no fim da raid (ao vivo)
    #[serde(default = "yes")]
    pub discord_on_night: bool,
    /// chave geral do envio automático (botão no topo): desligada, nada vai sozinho ao Discord
    #[serde(default = "yes")]
    pub discord_auto: bool,
    /// "Pergunte à IA": provedor, URL (compatível com OpenAI) e modelo; a chave fica no cofre do sistema
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_model: Option<String>,
    /// nuvem do Warcraft Recorder: conta e guilda (a senha fica no cofre)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wcr_cloud_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wcr_cloud_guild: Option<String>,
    /// abrir o app quando o WoW abrir (ele inicia com o Windows, escondido na bandeja)
    #[serde(default)]
    pub open_with_wow: bool,
}

pub(crate) fn yes() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings { wcr_dir: None, logs_dir: None, discord_webhook: None, discord_on_wipe: true, discord_on_kill: true, discord_on_night: true, discord_auto: true, ai_provider: None, ai_base_url: None, ai_model: None, wcr_cloud_user: None, wcr_cloud_guild: None, open_with_wow: false }
    }
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Lê, altera e grava de volta.
pub fn update(app: &AppHandle, change: impl FnOnce(&mut Settings)) -> Result<(), String> {
    let mut s = load(app);
    change(&mut s);
    let json = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    std::fs::write(path(app)?, json).map_err(|e| e.to_string())
}

/// Caminho digitado/escolhido: sem espaços nas pontas; vazio = sem cadastro.
pub fn clean_dir(dir: Option<String>) -> Option<String> {
    dir.map(|d| d.trim().to_string()).filter(|d| !d.is_empty())
}
