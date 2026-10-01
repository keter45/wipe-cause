//! Vídeos do Warcraft Recorder (https://warcraftrecorder.com) gravados localmente.
//!
//! O Recorder salva `<data> - <player> - <boss> [dif] (Wipe).mp4` + um `.json` de metadados
//! com o mesmo nome. O vídeo começa exatamente no ENCOUNTER_START (`start` = data dessa
//! linha do log), então o segundo `t` do pull é o segundo `t` do vídeo.

use crate::settings;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WcrVideo {
    pub video_path: String,
    pub encounter_id: u32,
    pub difficulty_id: Option<u32>,
    /// epoch ms do ENCOUNTER_START
    pub start_ms: i64,
    pub duration_s: f64,
    pub result: bool,
    pub boss_percent: Option<f64>,
    /// dono do POV
    pub player: Option<String>,
    /// da nuvem do Recorder (o caminho é um link assinado)
    pub cloud: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WcrScan {
    /// pasta lida (None = não encontrada)
    pub dir: Option<String>,
    /// de onde veio a pasta: "settings" | "recorder" | "none"
    pub source: String,
    pub videos: Vec<WcrVideo>,
    /// problema com a pasta cadastrada (não existe, sem vídeos do Recorder...)
    pub warning: Option<String>,
}

/// Pasta de vídeos cadastrada (None = usar a detectada do Warcraft Recorder).
#[tauri::command]
pub fn wcr_get_dir(app: AppHandle) -> Option<String> {
    settings::load(&app).wcr_dir
}

/// Cadastra a pasta de vídeos; None/vazio volta para a detecção automática.
#[tauri::command]
pub fn wcr_set_dir(app: AppHandle, dir: Option<String>) -> Result<(), String> {
    settings::update(&app, |s| s.wcr_dir = settings::clean_dir(dir))
}

/// Pasta configurada no próprio Warcraft Recorder, se ele estiver instalado.
#[tauri::command]
pub fn wcr_detect_dir() -> Option<String> {
    recorder_storage_path().map(|p| p.display().to_string())
}

/// Lê só o `storagePath` da config do Warcraft Recorder. O arquivo também tem as
/// credenciais da nuvem do Recorder — não são lidas nem usadas.
fn recorder_storage_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let dir = Path::new(&appdata).join("WarcraftRecorder");
    for name in ["config-v3.json", "config-v2.json", "config.json"] {
        let Ok(text) = std::fs::read_to_string(dir.join(name)) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        if let Some(p) = v.get("storagePath").and_then(|p| p.as_str()).filter(|p| !p.is_empty()) {
            return Some(PathBuf::from(p));
        }
    }
    None
}

fn parse_metadata(json_path: &Path) -> Option<WcrVideo> {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(json_path).ok()?).ok()?;
    let encounter_id = v.get("encounterID")?.as_u64()? as u32;
    let start_ms = v.get("start")?.as_i64()?;
    let video = ["mp4", "mkv"].iter().map(|ext| json_path.with_extension(ext)).find(|p| p.exists())?;
    Some(WcrVideo {
        video_path: video.display().to_string(),
        encounter_id,
        difficulty_id: v.get("difficultyID").and_then(|d| d.as_u64()).map(|d| d as u32),
        start_ms,
        duration_s: v.get("duration").and_then(|d| d.as_f64()).unwrap_or(0.0),
        result: v.get("result").and_then(|r| r.as_bool()).unwrap_or(false),
        boss_percent: v.get("bossPercent").and_then(|b| b.as_f64()),
        player: v.pointer("/player/_name").and_then(|n| n.as_str()).map(str::to_string),
        cloud: false,
    })
}

/// Metadados de encontros (raid/dungeon boss) na pasta e um nível de subpastas.
pub fn scan_dir(dir: &Path) -> Vec<WcrVideo> {
    let mut out = Vec::new();
    let mut dirs = vec![dir.to_path_buf()];
    if let Ok(entries) = std::fs::read_dir(dir) {
        dirs.extend(entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()));
    }
    for d in dirs {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "json") {
                out.extend(parse_metadata(&p));
            }
        }
    }
    out.sort_by_key(|v| v.start_ms);
    out
}

/// Lê os vídeos da pasta cadastrada; sem cadastro, usa a pasta do Warcraft Recorder.
#[tauri::command]
pub fn wcr_videos(app: AppHandle) -> WcrScan {
    let (dir, source) = match settings::load(&app).wcr_dir {
        Some(d) => (Some(PathBuf::from(d)), "settings"),
        None => match recorder_storage_path() {
            Some(d) => (Some(d), "recorder"),
            None => (None, "none"),
        },
    };
    let Some(dir) = dir else {
        return WcrScan { dir: None, source: "none".into(), videos: Vec::new(), warning: None };
    };
    if !dir.is_dir() {
        return WcrScan {
            dir: Some(dir.display().to_string()),
            source: source.into(),
            videos: Vec::new(),
            warning: Some("A pasta não existe ou não está acessível.".into()),
        };
    }
    // libera a pasta para o <video> da UI (protocolo asset)
    let _ = app.asset_protocol_scope().allow_directory(&dir, true);
    let videos = scan_dir(&dir);
    let warning = videos.is_empty().then(|| "Nenhum vídeo do Warcraft Recorder (.mp4 + .json) nesta pasta.".to_string());
    WcrScan { dir: Some(dir.display().to_string()), source: source.into(), videos, warning }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_recorder_metadata() {
        let dir = std::env::temp_dir().join(format!("wcr-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let base = dir.join("2026-09-21 21-49-41 - Magozin - The Twin Fangs [M] (Wipe)");
        std::fs::write(
            base.with_extension("json"),
            r#"{"category":"Raids","encounterID":3421,"difficultyID":16,"duration":53,"result":false,
               "player":{"_name":"Magozin"},"start":1790038180000,"bossPercent":88}"#,
        )
        .unwrap();
        std::fs::write(base.with_extension("mp4"), b"").unwrap();
        // .json sem vídeo e .json que não é encontro são ignorados
        std::fs::write(dir.join("sem-video.json"), r#"{"encounterID":1,"start":1}"#).unwrap();
        std::fs::write(dir.join("m+.json"), r#"{"category":"Mythic+"}"#).unwrap();

        let videos = scan_dir(&dir);
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(videos.len(), 1);
        let v = &videos[0];
        assert_eq!((v.encounter_id, v.start_ms, v.duration_s), (3421, 1790038180000, 53.0));
        assert_eq!(v.player.as_deref(), Some("Magozin"));
        assert!(v.video_path.ends_with(".mp4"));
    }
}
