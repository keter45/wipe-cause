//! Histórico de análises: cada análise é salva (JSON comprimido) com data, para reabrir
//! depois sem reprocessar o log. Uma entrada por arquivo de log; reanalisar atualiza.
//! O log bruto (1+ GB) não é copiado — guardamos só o caminho dele.

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use wipe_core::summary::{best_hp, best_phase, has_raid, main_encounter, title_of};
use wipe_core::LogReport;
use wipe_core::i18n::pick;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    /// quando a análise foi salva (epoch ms)
    pub saved_at: i64,
    /// "24/09 · The Twin Fangs Mythic"
    pub title: String,
    /// encontro do título (ícone do boss); entradas antigas não têm
    #[serde(default)]
    pub encounter_id: Option<u32>,
    /// início do 1º pull (epoch ms), para ordenar pela data da raid
    pub raid_start_ms: Option<i64>,
    pub log_path: String,
    pub pulls: usize,
    pub kills: usize,
    /// vida do boss no wipe que mais avançou (0-100)
    pub best_hp: Option<f32>,
    /// fase em que esse wipe acabou ("P2"), quando passou da primeira
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub best_phase: Option<String>,
    pub death_cutoff: u32,
    /// fixada = o usuário quer manter (não sai no "apagar não fixadas")
    pub pinned: bool,
    /// tamanho do arquivo salvo (bytes)
    pub size: u64,
    /// o log original ainda existe (preenchido na listagem)
    #[serde(default)]
    pub log_exists: bool,
    /// tem pull de raid; entradas antigas não têm (a listagem confere uma vez)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raid: Option<bool>,
}

fn history_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("history");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("index.json")
}

fn load_index(dir: &Path) -> Vec<HistoryEntry> {
    std::fs::read_to_string(index_path(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_index(dir: &Path, entries: &[HistoryEntry]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    std::fs::write(index_path(dir), json).map_err(|e| e.to_string())
}

/// Id estável por arquivo de log (FNV-1a do caminho, sem diferenciar maiúsculas no Windows).
pub fn entry_id(log_path: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in log_path.to_lowercase().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Salva (ou atualiza) a análise de um log. Mantém o "fixada" de antes.
pub fn save(app: &AppHandle, report: &LogReport, log_path: &str) -> Result<(), String> {
    save_in(&history_dir(app)?, report, log_path)
}

fn save_in(dir: &Path, report: &LogReport, log_path: &str) -> Result<(), String> {
    let id = entry_id(log_path);
    if !has_raid(report) {
        // só masmorra: não salva, e tira uma análise antiga do mesmo log
        let mut index = load_index(dir);
        if index.iter().any(|e| e.id == id) {
            remove(dir, &mut index, &id);
            save_index(dir, &index)?;
        }
        return Ok(());
    }
    let json = serde_json::to_vec(report).map_err(|e| e.to_string())?;
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    gz.write_all(&json).map_err(|e| e.to_string())?;
    let bytes = gz.finish().map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{id}.json.gz")), &bytes).map_err(|e| e.to_string())?;

    let mut index = load_index(dir);
    let pinned = index.iter().find(|e| e.id == id).is_some_and(|e| e.pinned);
    index.retain(|e| e.id != id);
    index.push(HistoryEntry {
        id,
        saved_at: now_ms(),
        title: title_of(report),
        encounter_id: main_encounter(report),
        raid_start_ms: report.pulls.first().map(|p| p.start_ms),
        log_path: log_path.to_string(),
        pulls: report.pulls.len(),
        kills: report.pulls.iter().filter(|p| p.success).count(),
        best_hp: best_hp(report),
        best_phase: best_phase(report),
        death_cutoff: report.death_cutoff,
        pinned,
        size: bytes.len() as u64,
        log_exists: true,
        raid: Some(true),
    });
    save_index(dir, &index)
}

/// Fixadas primeiro, depois as mais recentes pela data da raid.
#[tauri::command]
pub fn history_list(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    Ok(list_in(&history_dir(&app)?))
}

fn list_in(dir: &Path) -> Vec<HistoryEntry> {
    let mut index = load_index(dir);
    // entradas de antes da regra de raid: confere uma vez e tira as que são só de masmorra (M+)
    let unknown: Vec<String> = index.iter().filter(|e| e.raid.is_none()).map(|e| e.id.clone()).collect();
    if !unknown.is_empty() {
        for id in &unknown {
            let raid = load_in(dir, id).ok().map(|r| r["pulls"].as_array().is_some_and(|ps| ps.iter().any(|p| p["dungeon"] != true)));
            match raid {
                Some(false) => remove(dir, &mut index, id),
                // sem conseguir ler, fica como está (não some do histórico por engano)
                Some(true) => index.iter_mut().filter(|e| &e.id == id).for_each(|e| e.raid = Some(true)),
                None => {}
            }
        }
        let _ = save_index(dir, &index);
    }
    for e in &mut index {
        // report do Warcraft Logs: dá para baixar de novo
        e.log_exists = e.log_path.starts_with(crate::wcl_source::PREFIX) || Path::new(&e.log_path).exists();
    }
    index.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(b.raid_start_ms.unwrap_or(b.saved_at).cmp(&a.raid_start_ms.unwrap_or(a.saved_at)))
    });
    index
}

/// Relatório salvo, como JSON (o LogReport só é serializável).
#[tauri::command]
pub fn history_load(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    load_in(&history_dir(&app)?, &id)
}

fn load_in(dir: &Path, id: &str) -> Result<serde_json::Value, String> {
    let path = dir.join(format!("{id}.json.gz"));
    let file = std::fs::File::open(&path).map_err(|_| pick("Análise não encontrada no histórico.", "Analysis not found in the history."))?;
    let mut json = String::new();
    GzDecoder::new(file).read_to_string(&mut json).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_set_pinned(app: AppHandle, id: String, pinned: bool) -> Result<(), String> {
    set_pinned_in(&history_dir(&app)?, &id, pinned)
}

fn set_pinned_in(dir: &Path, id: &str, pinned: bool) -> Result<(), String> {
    let mut index = load_index(dir);
    if let Some(e) = index.iter_mut().find(|e| e.id == id) {
        e.pinned = pinned;
    }
    save_index(dir, &index)
}

fn remove(dir: &Path, index: &mut Vec<HistoryEntry>, id: &str) {
    let _ = std::fs::remove_file(dir.join(format!("{id}.json.gz")));
    let _ = std::fs::remove_file(compact_path(dir, id));
    index.retain(|e| e.id != id);
}

#[tauri::command]
pub fn history_delete(app: AppHandle, id: String) -> Result<(), String> {
    delete_in(&history_dir(&app)?, &id)
}

fn delete_in(dir: &Path, id: &str) -> Result<(), String> {
    let mut index = load_index(dir);
    remove(dir, &mut index, id);
    save_index(dir, &index)
}

/// Apaga todas as análises não fixadas; devolve quantas saíram.
#[tauri::command]
pub fn history_delete_unpinned(app: AppHandle) -> Result<usize, String> {
    delete_unpinned_in(&history_dir(&app)?)
}

fn delete_unpinned_in(dir: &Path) -> Result<usize, String> {
    let mut index = load_index(dir);
    let ids: Vec<String> = index.iter().filter(|e| !e.pinned).map(|e| e.id.clone()).collect();
    for id in &ids {
        remove(dir, &mut index, id);
    }
    save_index(dir, &index)?;
    Ok(ids.len())
}

// ---------------------------------------------------------------------------
// Evolução entre noites: versão enxuta de cada análise (sem recap, eventos e dano por
// habilidade), guardada ao lado da completa e refeita quando a análise muda.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendNight {
    pub id: String,
    pub title: String,
    pub raid_start_ms: Option<i64>,
    pub report: serde_json::Value,
}

fn compact_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.compact.json"))
}

/// Tira do relatório o que só serve para ver um pull em detalhe.
pub fn compact(mut report: serde_json::Value) -> serde_json::Value {
    let strip = |v: &mut serde_json::Value, keys: &[&str]| {
        if let Some(o) = v.as_object_mut() {
            for k in keys {
                o.remove(*k);
            }
        }
    };
    if let Some(pulls) = report.get_mut("pulls").and_then(|p| p.as_array_mut()) {
        for p in pulls {
            for d in p.get_mut("deaths").and_then(|x| x.as_array_mut()).into_iter().flatten() {
                strip(d, &["recap", "debuffs", "mechanicDamage", "positions"]);
            }
            for m in p.get_mut("mechanics").and_then(|x| x.as_array_mut()).into_iter().flatten() {
                strip(m, &["events", "snapshots"]);
            }
            for pl in p.get_mut("players").and_then(|x| x.as_array_mut()).into_iter().flatten() {
                strip(pl, &["takenByAbility", "interruptLog", "casts", "damageBySpell", "healingBySpell", "setup"]);
            }
        }
    }
    report
}

fn modified(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Todas as análises salvas, enxutas, da mais antiga para a mais nova.
#[tauri::command]
pub async fn history_trends(app: AppHandle) -> Result<Vec<TrendNight>, String> {
    let dir = history_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || Ok(trends_in(&dir))).await.map_err(|e| e.to_string())?
}

fn trends_in(dir: &Path) -> Vec<TrendNight> {
    let mut index = load_index(dir);
    index.sort_by_key(|e| e.raid_start_ms.unwrap_or(e.saved_at));
    index
        .into_iter()
        .filter_map(|e| {
            let cp = compact_path(dir, &e.id);
            let fresh = matches!((modified(&cp), modified(&dir.join(format!("{}.json.gz", e.id)))), (Some(c), Some(g)) if c >= g);
            let report = if fresh {
                std::fs::read_to_string(&cp).ok().and_then(|s| serde_json::from_str(&s).ok())?
            } else {
                let r = compact(load_in(dir, &e.id).ok()?);
                let _ = std::fs::write(&cp, serde_json::to_string(&r).unwrap_or_default());
                r
            };
            Some(TrendNight { id: e.id, title: e.title, raid_start_ms: e.raid_start_ms, report })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_report() -> LogReport {
        let log = Path::new(env!("CARGO_MANIFEST_DIR")).join("../crates/wipe-core/tests/fixtures/twin-fangs.txt");
        wipe_core::analyze_file(&log, &wipe_core::AnalyzeOptions::default(), |_, _| {}).unwrap()
    }

    #[test]
    fn saves_lists_pins_and_deletes() {
        let dir = std::env::temp_dir().join(format!("wipe-history-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let report = fixture_report();

        save_in(&dir, &report, r"C:logsa.txt").unwrap();
        save_in(&dir, &report, r"C:logs.txt").unwrap();
        let list = list_in(&dir);
        assert_eq!(list.len(), 2);
        let a = list.iter().find(|e| e.log_path.ends_with("a.txt")).unwrap();
        assert_eq!(a.title, "28/09 · The Twin Fangs Heroic");
        assert_eq!((a.pulls, a.kills), (3, 1));
        assert!(!a.log_exists, "o log de teste não existe no disco");

        // reabrir devolve o relatório inteiro
        let loaded = load_in(&dir, &a.id).unwrap();
        assert_eq!(loaded["pulls"].as_array().unwrap().len(), 3);

        // fixar sobrevive a reanalisar o mesmo log (sem duplicar)
        set_pinned_in(&dir, &a.id, true).unwrap();
        save_in(&dir, &report, r"c:LOGSA.txt").unwrap();
        let list = list_in(&dir);
        assert_eq!(list.len(), 2);
        assert!(list[0].pinned && list[0].id == a.id, "fixadas primeiro");

        // evolução: versão enxuta, sem recap, e em cache ao lado da completa
        let trends = trends_in(&dir);
        assert_eq!(trends.len(), 2);
        let pulls = trends[0].report["pulls"].as_array().unwrap();
        assert_eq!(pulls.len(), 3);
        assert!(pulls.iter().flat_map(|p| p["deaths"].as_array().unwrap()).all(|d| d.get("recap").is_none()));
        assert!(compact_path(&dir, &a.id).exists());

        // apagar não fixadas deixa só a fixada
        assert_eq!(delete_unpinned_in(&dir).unwrap(), 1);
        assert_eq!(list_in(&dir).len(), 1);
        delete_in(&dir, &a.id).unwrap();
        assert!(list_in(&dir).is_empty());
        assert!(load_in(&dir, &a.id).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn dungeon_only_logs_stay_out_of_the_history() {
        let dir = std::env::temp_dir().join(format!("wipe-history-mplus-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let raid = fixture_report();
        let mut mplus = fixture_report();
        mplus.pulls.iter_mut().for_each(|p| p.dungeon = true);

        save_in(&dir, &mplus, "C:/logs/m.txt").unwrap();
        assert!(list_in(&dir).is_empty(), "só masmorra não é salvo");

        // análise antiga (de antes da regra) só de masmorra: some na listagem, com o arquivo
        save_in(&dir, &raid, "C:/logs/old.txt").unwrap();
        let id = entry_id("C:/logs/old.txt");
        let mut index = load_index(&dir);
        index.iter_mut().for_each(|e| e.raid = None);
        save_index(&dir, &index).unwrap();
        let json = serde_json::to_vec(&mplus).unwrap();
        let mut gz = GzEncoder::new(Vec::new(), Compression::default());
        gz.write_all(&json).unwrap();
        std::fs::write(dir.join(format!("{id}.json.gz")), gz.finish().unwrap()).unwrap();
        assert!(list_in(&dir).is_empty());
        assert!(load_in(&dir, &id).is_err());

        // com raid, entra (e a antiga com raid fica marcada)
        save_in(&dir, &raid, "C:/logs/r.txt").unwrap();
        let list = list_in(&dir);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].raid, Some(true));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn id_is_stable_and_case_insensitive() {
        let a = entry_id(r"A:\World of Warcraft\_retail_\Logs\WoWCombatLog-092426_204015.txt");
        let b = entry_id(r"a:\world of warcraft\_retail_\logs\wowcombatlog-092426_204015.txt");
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
        assert_ne!(a, entry_id(r"A:\outro.txt"));
    }
}
