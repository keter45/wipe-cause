//! Pasta de logs do WoW: o usuário cadastra (ou o app detecta) `World of Warcraft\_retail_\Logs`
//! e escolhe o log numa lista, em vez de procurar o arquivo.
//!
//! Cada arquivo vem com os encontros que tem (leitura rápida do wipe-core), guardados em
//! `log-index.json` por caminho + tamanho + data de modificação: o log da raid em andamento
//! muda de tamanho e é lido de novo.

use crate::settings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};
use wipe_core::peek::LogPeek;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: i64,
    /// está numa subpasta (ex.: warcraftlogsarchive, do uploader do Warcraft Logs)
    pub folder: Option<String>,
    /// encontros do log, se já lidos (senão a UI pede com `logs_peek`)
    pub peek: Option<LogPeek>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsScan {
    pub dir: Option<String>,
    /// "settings" | "detected" | "none"
    pub source: String,
    pub files: Vec<LogFile>,
    pub warning: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct IndexEntry {
    size: u64,
    modified_ms: i64,
    peek: LogPeek,
}

/// Cache em memória do log-index.json (lido uma vez, gravado a cada leitura nova).
static INDEX: Mutex<Option<HashMap<String, IndexEntry>>> = Mutex::new(None);

fn index_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("log-index.json"))
}

fn with_index<T>(app: &AppHandle, f: impl FnOnce(&mut HashMap<String, IndexEntry>) -> T) -> T {
    let mut guard = INDEX.lock().unwrap_or_else(|e| e.into_inner());
    let index = guard.get_or_insert_with(|| {
        index_path(app)
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    });
    f(index)
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// É um combat log? `WoWCombatLog-*.txt`, `Archive-WoWCombatLog-*.txt` (uploader do WCL) e
/// `Split-*.txt` (logs divididos por boss).
pub fn is_combat_log(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".txt") && (lower.contains("combatlog") || lower.starts_with("split-"))
}

/// Combat logs da pasta e das subpastas diretas, do mais recente para o mais antigo.
pub fn list_dir(dir: &Path) -> Vec<(PathBuf, Option<String>, std::fs::Metadata)> {
    let mut out = Vec::new();
    let mut dirs = vec![(dir.to_path_buf(), None)];
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            if e.path().is_dir() {
                dirs.push((e.path(), Some(e.file_name().to_string_lossy().into_owned())));
            }
        }
    }
    for (d, folder) in dirs {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(meta) = e.metadata() else { continue };
            if meta.is_file() && is_combat_log(&name) {
                out.push((e.path(), folder.clone(), meta));
            }
        }
    }
    out.sort_by_key(|(_, _, m)| std::cmp::Reverse(modified_ms(m)));
    out
}

/// Onde o WoW costuma estar instalado, em cada drive.
fn detect() -> Option<PathBuf> {
    const SUBDIRS: [&str; 5] = [
        r"World of Warcraft\_retail_\Logs",
        r"Program Files (x86)\World of Warcraft\_retail_\Logs",
        r"Program Files\World of Warcraft\_retail_\Logs",
        r"Games\World of Warcraft\_retail_\Logs",
        r"Blizzard\World of Warcraft\_retail_\Logs",
    ];
    ('A'..='Z')
        .flat_map(|d| SUBDIRS.iter().map(move |s| PathBuf::from(format!("{d}:\\{s}"))))
        .find(|p| p.is_dir())
}

#[tauri::command]
pub fn logs_get_dir(app: AppHandle) -> Option<String> {
    settings::load(&app).logs_dir
}

#[tauri::command]
pub fn logs_set_dir(app: AppHandle, dir: Option<String>) -> Result<(), String> {
    settings::update(&app, |s| s.logs_dir = settings::clean_dir(dir))
}

#[tauri::command]
pub fn logs_detect_dir() -> Option<String> {
    detect().map(|p| p.display().to_string())
}

/// Pasta de logs em uso: a cadastrada ou, sem cadastro, a detectada. Segundo valor = origem.
pub fn current_dir(app: &AppHandle) -> (Option<PathBuf>, &'static str) {
    match settings::load(app).logs_dir {
        Some(d) => (Some(PathBuf::from(d)), "settings"),
        None => match detect() {
            Some(d) => (Some(d), "detected"),
            None => (None, "none"),
        },
    }
}

/// O log que o WoW está escrevendo agora: o `WoWCombatLog*.txt` mais recente da pasta (sem os
/// arquivos do uploader do Warcraft Logs nem os divididos por boss).
pub fn newest_live_log(dir: &Path) -> Option<PathBuf> {
    list_dir(dir)
        .into_iter()
        .find(|(p, folder, _)| {
            folder.is_none() && p.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().starts_with("wowcombatlog"))
        })
        .map(|(p, _, _)| p)
}

/// Logs da pasta cadastrada (ou detectada), com os encontros que já estão no índice.
#[tauri::command]
pub fn logs_list(app: AppHandle) -> LogsScan {
    let (dir, source) = current_dir(&app);
    let Some(dir) = dir else {
        return LogsScan { dir: None, source: source.into(), files: Vec::new(), warning: None };
    };
    let shown = Some(dir.display().to_string());
    if !dir.is_dir() {
        let warning = Some("A pasta não existe ou não está acessível.".into());
        return LogsScan { dir: shown, source: source.into(), files: Vec::new(), warning };
    }
    let files: Vec<LogFile> = with_index(&app, |index| {
        list_dir(&dir)
            .into_iter()
            .map(|(p, folder, meta)| {
                let path = p.display().to_string();
                let (size, modified_ms) = (meta.len(), modified_ms(&meta));
                let peek = index
                    .get(&path)
                    .filter(|e| e.size == size && e.modified_ms == modified_ms)
                    .map(|e| e.peek.clone());
                let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                LogFile { path, name, size, modified_ms, folder, peek }
            })
            .collect()
    });
    let warning = files.is_empty().then(|| "Nenhum combat log (WoWCombatLog*.txt) nesta pasta.".to_string());
    LogsScan { dir: shown, source: source.into(), files, warning }
}

/// Encontros de um log: do índice, se o arquivo não mudou; senão lê (rápido) e guarda.
fn peek_cached(app: &AppHandle, path: &Path) -> Result<LogPeek, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let key = path.display().to_string();
    let (size, modified) = (meta.len(), modified_ms(&meta));
    if let Some(p) = with_index(app, |index| index.get(&key).filter(|e| e.size == size && e.modified_ms == modified).map(|e| e.peek.clone())) {
        return Ok(p);
    }
    let peek = wipe_core::peek::peek_file(path).map_err(|e| e.to_string())?;
    let entry = IndexEntry { size, modified_ms: modified, peek: peek.clone() };
    with_index(app, |index| {
        index.insert(key, entry);
        // esquece logs que sumiram
        index.retain(|p, _| Path::new(p).exists());
        if let (Some(p), Ok(json)) = (index_path(app), serde_json::to_string(index)) {
            let _ = std::fs::write(p, json);
        }
    });
    Ok(peek)
}

/// Encontros de um log (leitura rápida), guardados no índice.
#[tauri::command]
pub async fn logs_peek(app: AppHandle, path: String) -> Result<LogPeek, String> {
    tauri::async_runtime::spawn_blocking(move || peek_cached(&app, Path::new(&path))).await.map_err(|e| e.to_string())?
}

/// Logs do PC com encontros entre `from` e `to` (epoch ms): antes de baixar do Warcraft Logs,
/// usa o que já está aqui. Os logs do WoW vêm primeiro; cópias (warcraftlogsarchive, Split-*)
/// só entram se nenhum log do WoW cobrir o horário, para não analisar a mesma noite duas vezes.
pub fn local_logs_between(app: &AppHandle, from: i64, to: i64) -> Vec<PathBuf> {
    let (Some(dir), _) = current_dir(app) else { return Vec::new() };
    let overlaps = |p: &LogPeek| p.first_ms.zip(p.last_ms).is_some_and(|(a, b)| a <= to && b >= from);
    let (mut main, mut copies) = (Vec::new(), Vec::new());
    for (path, folder, meta) in list_dir(&dir) {
        // escrito antes da noite começar: não tem nada dela
        if modified_ms(&meta) < from {
            continue;
        }
        let original = folder.is_none() && path.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().starts_with("wowcombatlog"));
        if peek_cached(app, &path).is_ok_and(|p| overlaps(&p)) {
            if original { main.push(path) } else { copies.push(path) }
        }
    }
    if main.is_empty() {
        copies
    } else {
        main
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_combat_logs_in_folder_and_subfolders() {
        let dir = std::env::temp_dir().join(format!("logs-test-{}", std::process::id()));
        let archive = dir.join("warcraftlogsarchive");
        std::fs::create_dir_all(&archive).unwrap();
        std::fs::write(dir.join("WoWCombatLog-092826_204129.txt"), b"x").unwrap();
        std::fs::write(dir.join("Split-2026-09-26T161959.646Z-Boss Mythic.txt"), b"x").unwrap();
        std::fs::write(archive.join("Archive-WoWCombatLog-092226_180441.txt"), b"x").unwrap();
        std::fs::write(dir.join("Hotfix.log"), b"x").unwrap();
        std::fs::write(dir.join("notas.txt"), b"x").unwrap();

        let mut found: Vec<(String, Option<String>)> = list_dir(&dir)
            .into_iter()
            .map(|(p, f, _)| (p.file_name().unwrap().to_string_lossy().into_owned(), f))
            .collect();
        std::fs::remove_dir_all(&dir).ok();
        found.sort();
        assert_eq!(
            found,
            [
                ("Archive-WoWCombatLog-092226_180441.txt".to_string(), Some("warcraftlogsarchive".to_string())),
                ("Split-2026-09-26T161959.646Z-Boss Mythic.txt".to_string(), None),
                ("WoWCombatLog-092826_204129.txt".to_string(), None),
            ]
        );
    }
}
