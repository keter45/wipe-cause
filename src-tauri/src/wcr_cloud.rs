//! Vídeos da guilda na nuvem do Warcraft Recorder: cada pessoa da raid que sobe o vídeo vira
//! mais um ponto de vista (POV) do pull. Mesma API que o próprio Recorder usa
//! (`api.warcraftrecorder.com`, autenticação básica com a conta da nuvem): a lista traz, por
//! vídeo, o boss, o início do encontro, quem gravou e um link já assinado para assistir.
//!
//! A conta é digitada aqui nas Configurações (a senha fica no cofre do sistema); a config do
//! Recorder continua sendo lida só pelo `storagePath`.

use crate::settings;
use crate::wcr::WcrVideo;
use base64::Engine;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

const API: &str = "https://api.warcraftrecorder.com/api";
const KEYRING_SERVICE: &str = "wipe-cause";
const PASS_KEY: &str = "wcr-cloud-pass";
/// A lista muda quando alguém sobe um vídeo: guarda por pouco tempo.
const CACHE_FOR: Duration = Duration::from_secs(60);

static CACHE: Mutex<Option<(Instant, Vec<WcrVideo>)>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WcrCloudConfig {
    pub configured: bool,
    pub user: Option<String>,
    pub guild: Option<String>,
}

fn password() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, PASS_KEY).ok()?.get_password().ok().filter(|p| !p.is_empty())
}

fn get(path: &str, user: &str, pass: &str) -> Result<serde_json::Value, String> {
    let basic = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"));
    let res = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .build()
        .get(&format!("{API}{path}"))
        .set("Authorization", &format!("Basic {basic}"))
        .call();
    match res {
        Ok(r) => r.into_json().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(401, _)) => Err("A nuvem do Warcraft Recorder recusou a conta: confira o usuário e a senha (os mesmos do Recorder).".into()),
        Err(ureq::Error::Status(403, _)) => Err("Sua conta não tem acesso aos vídeos desta guilda na nuvem do Warcraft Recorder.".into()),
        Err(ureq::Error::Status(code, _)) => Err(format!("A nuvem do Warcraft Recorder respondeu {code}.")),
        Err(e) => Err(format!("Sem conexão com a nuvem do Warcraft Recorder: {e}")),
    }
}

/// Guildas a que a conta tem acesso (`/user/affiliations`).
fn guilds(user: &str, pass: &str) -> Result<Vec<String>, String> {
    let data = get("/user/affiliations", user, pass)?;
    Ok(data.as_array().into_iter().flatten().filter_map(|a| a["guildName"].as_str().map(str::to_string)).collect())
}

/// Percent-encoding de um segmento do caminho (nome da guilda).
fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Vídeo da nuvem -> o mesmo formato dos vídeos locais (o caminho é o link assinado).
fn to_video(v: &serde_json::Value) -> Option<WcrVideo> {
    Some(WcrVideo {
        video_path: v["signedVideoKey"].as_str()?.to_string(),
        encounter_id: v["encounterID"].as_u64()? as u32,
        difficulty_id: v["difficultyID"].as_u64().map(|d| d as u32),
        start_ms: v["start"].as_i64()?,
        duration_s: v["duration"].as_f64().unwrap_or(0.0),
        result: v["result"].as_bool().unwrap_or(false),
        boss_percent: v["bossPercent"].as_f64(),
        player: v.pointer("/player/_name").and_then(|n| n.as_str()).map(str::to_string),
        cloud: true,
    })
}

#[tauri::command]
pub fn wcr_cloud_get_config(app: AppHandle) -> WcrCloudConfig {
    let s = settings::load(&app);
    WcrCloudConfig { configured: s.wcr_cloud_user.is_some() && s.wcr_cloud_guild.is_some() && password().is_some(), user: s.wcr_cloud_user, guild: s.wcr_cloud_guild }
}

/// Confere a conta (e a guilda) e guarda. Usuário vazio desconecta. Devolve as guildas da
/// conta, para a UI oferecer a escolha quando a guilda não foi informada.
#[tauri::command]
pub async fn wcr_cloud_set_config(app: AppHandle, user: String, pass: String, guild: String) -> Result<Vec<String>, String> {
    let (user, guild) = (user.trim().to_string(), guild.trim().to_string());
    *CACHE.lock().unwrap() = None;
    if user.is_empty() {
        if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, PASS_KEY) {
            let _ = e.delete_credential();
        }
        settings::update(&app, |s| {
            s.wcr_cloud_user = None;
            s.wcr_cloud_guild = None;
        })?;
        return Ok(Vec::new());
    }
    // senha em branco = manter a guardada
    let pass = if pass.is_empty() { password().ok_or("Digite a senha da nuvem do Warcraft Recorder.")? } else { pass };
    let (u, p) = (user.clone(), pass.clone());
    let available = tauri::async_runtime::spawn_blocking(move || guilds(&u, &p)).await.map_err(|e| e.to_string())??;
    let chosen = if guild.is_empty() && available.len() == 1 { available[0].clone() } else { guild };
    if chosen.is_empty() {
        return Ok(available); // a UI pede para escolher
    }
    if !available.iter().any(|g| g.eq_ignore_ascii_case(&chosen)) {
        return Err(format!("A conta não está na guilda \"{chosen}\" da nuvem. Guildas da conta: {}.", if available.is_empty() { "nenhuma".into() } else { available.join(", ") }));
    }
    let chosen = available.iter().find(|g| g.eq_ignore_ascii_case(&chosen)).cloned().unwrap_or(chosen);
    keyring::Entry::new(KEYRING_SERVICE, PASS_KEY)
        .and_then(|e| e.set_password(&pass))
        .map_err(|e| format!("não foi possível guardar a senha: {e}"))?;
    settings::update(&app, |s| {
        s.wcr_cloud_user = Some(user);
        s.wcr_cloud_guild = Some(chosen);
    })?;
    Ok(available)
}

/// Vídeos de encontros da guilda na nuvem (vazio se não está configurado).
#[tauri::command]
pub async fn wcr_cloud_videos(app: AppHandle) -> Result<Vec<WcrVideo>, String> {
    if let Some((at, videos)) = CACHE.lock().unwrap().as_ref() {
        if at.elapsed() < CACHE_FOR {
            return Ok(videos.clone());
        }
    }
    let s = settings::load(&app);
    let (Some(user), Some(guild), Some(pass)) = (s.wcr_cloud_user, s.wcr_cloud_guild, password()) else { return Ok(Vec::new()) };
    let videos = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<WcrVideo>, String> {
        let data = get(&format!("/guild/{}/video", enc(&guild)), &user, &pass)?;
        let mut v: Vec<WcrVideo> = data.as_array().into_iter().flatten().filter_map(to_video).collect();
        v.sort_by_key(|x| x.start_ms);
        Ok(v)
    })
    .await
    .map_err(|e| e.to_string())??;
    *CACHE.lock().unwrap() = Some((Instant::now(), videos.clone()));
    Ok(videos)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_cloud_video_metadata() {
        let v = serde_json::json!({
            "videoName": "x", "videoKey": "x.mp4", "signedVideoKey": "https://r2.example/x.mp4?sig=1",
            "category": "Raids", "encounterID": 3455, "difficultyID": 16, "start": 1790730000000i64,
            "duration": 85.2, "result": false, "bossPercent": 74.0, "player": { "_name": "Fulano", "_realm": "Azralon" }
        });
        let w = to_video(&v).unwrap();
        assert_eq!((w.encounter_id, w.start_ms, w.player.as_deref(), w.cloud), (3455, 1_790_730_000_000, Some("Fulano"), true));
        // M+ sem encounterID ou vídeo sem link: fora
        assert!(to_video(&serde_json::json!({ "signedVideoKey": "u", "start": 1 })).is_none());
        assert_eq!(enc("Dynamic Azralon"), "Dynamic%20Azralon");
    }
}
