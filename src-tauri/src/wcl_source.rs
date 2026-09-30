//! Análise a partir do Warcraft Logs, sem o log no PC: baixa os eventos de cada fight de boss
//! pela API e passa para o `WclAnalyzer` do núcleo, página a página (a noite inteira tem ~3
//! milhões de eventos; nada disso fica inteiro na memória).
//!
//! Os eventos de fights já terminados não mudam: ficam no disco (gzip, só os campos que o
//! motor usa) para que reanalisar — regra ajustada, corte de mortes — não gaste os pontos da
//! API de novo. Guardamos os últimos reports abertos.

use crate::wcl::{credentials, graphql};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde_json::{Map, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use wipe_core::rules::RuleBook;
use wipe_core::wcl::WclAnalyzer;
use wipe_core::LogReport;

/// "Caminho" de uma análise do Warcraft Logs (no lugar do arquivo de log).
pub const PREFIX: &str = "wcl:";
/// Reports com eventos guardados no disco.
const KEEP_REPORTS: usize = 6;
/// Um fight que terminou há menos que isso pode ainda estar chegando (log ao vivo): não guarda.
const SETTLE_MS: i64 = 10 * 60_000;

pub fn code_of(path: &str) -> Option<&str> {
    path.strip_prefix(PREFIX).filter(|c| !c.is_empty())
}

const REPORT_QUERY: &str = "query R($code: String!) {
  reportData { report(code: $code) {
    code title startTime endTime
    guild { name server { slug region { slug } } }
    fights { id encounterID name difficulty kill startTime endTime size }
    masterData(translate: false) {
      actors { id gameID name server type subType petOwner }
      abilities { gameID name type }
    }
  } }
}";

const EVENTS_QUERY: &str = "query E($code: String!, $fight: Int!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], startTime: $start, endTime: $end, includeResources: true, limit: 10000) { data nextPageTimestamp }
  } }
}";

/// Tipos de evento que o motor não usa (fora daqui, só o que vira linha do log).
const SKIP_TYPES: &[&str] = &[
    "resourcechange",
    "refreshbuff",
    "refreshdebuff",
    "begincast",
    "absorbed",
    "healabsorbed",
    "extraattacks",
    "empowerstart",
    "empowerend",
    "create",
    "resurrect",
    "encounterstart",
    "encounterend",
];

/// Campos que o conversor lê (o resto — classResources, buffs, ... — é descartado).
const KEEP_FIELDS: &[&str] = &[
    "timestamp",
    "type",
    "sourceID",
    "targetID",
    "sourceInstance",
    "targetInstance",
    "abilityGameID",
    "extraAbilityGameID",
    "amount",
    "overkill",
    "absorbed",
    "overheal",
    "unmitigatedAmount",
    "resisted",
    "blocked",
    "hitType",
    "tick",
    "stack",
    "isBuff",
    "resourceActor",
    "hitPoints",
    "maxHitPoints",
    "attackPower",
    "spellPower",
    "armor",
    "absorb",
    "x",
    "y",
    "facing",
    "mapID",
    "itemLevel",
];

/// Só o que interessa de uma página de eventos.
fn slim(events: Vec<Value>) -> Vec<Value> {
    events
        .into_iter()
        .filter(|e| !SKIP_TYPES.contains(&e["type"].as_str().unwrap_or("")))
        .map(|e| match e {
            Value::Object(o) if o.get("type").and_then(Value::as_str) != Some("combatantinfo") => {
                Value::Object(o.into_iter().filter(|(k, _)| KEEP_FIELDS.contains(&k.as_str())).collect::<Map<_, _>>())
            }
            other => other,
        })
        .collect()
}

fn cache_dir(app: &AppHandle, code: &str) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("wcl-events").join(code))
}

fn read_cached(file: &Path) -> Option<Vec<Value>> {
    let mut text = String::new();
    GzDecoder::new(std::fs::File::open(file).ok()?).read_to_string(&mut text).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_cached(file: &Path, events: &[Value]) {
    let Some(dir) = file.parent() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let tmp = file.with_extension("tmp");
    let ok = std::fs::File::create(&tmp).ok().and_then(|f| {
        let mut gz = GzEncoder::new(f, Compression::fast());
        serde_json::to_writer(&mut gz, events).ok()?;
        gz.finish().ok()?.flush().ok()
    });
    if ok.is_some() {
        let _ = std::fs::rename(&tmp, file);
    } else {
        let _ = std::fs::remove_file(&tmp);
    }
}

/// Mantém só os reports usados mais recentemente.
fn prune(root: &Path) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    let mut dirs: Vec<(SystemTime, PathBuf)> =
        rd.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).filter(|(_, p)| p.is_dir()).collect();
    dirs.sort_by_key(|a| std::cmp::Reverse(a.0));
    for (_, p) in dirs.into_iter().skip(KEEP_REPORTS) {
        let _ = std::fs::remove_dir_all(p);
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Baixa (ou lê do disco) e analisa o report. `progress(feitos, total)` por fight.
pub fn analyze(app: &AppHandle, code: &str, book: RuleBook, death_cutoff: u32, tz_hours: f64, mut progress: impl FnMut(u64, u64)) -> Result<LogReport, String> {
    let (id, secret) = credentials().ok_or("Conecte o Warcraft Logs em Configurações para abrir reports de lá.")?;
    let data = graphql(&id, &secret, REPORT_QUERY, &serde_json::json!({ "code": code }))?;
    let report = &data["reportData"]["report"];
    if report.is_null() {
        return Err(format!("Report {code} não encontrado no Warcraft Logs (ele é privado ou o código está errado)."));
    }
    let mut analyzer = WclAnalyzer::new(report, book, death_cutoff, tz_hours, None)?;
    let fights: Vec<_> = analyzer.fights().to_vec();
    if fights.is_empty() {
        return Err("Este report não tem nenhum boss.".into());
    }
    let start = report["startTime"].as_i64().unwrap_or(0);
    let end = report["endTime"].as_i64().unwrap_or(0);
    let dir = cache_dir(app, code);
    let total = fights.len() as u64 * 100;

    for (i, f) in fights.iter().enumerate() {
        let done = i as u64 * 100;
        progress(done, total);
        let file = dir.as_ref().map(|d| d.join(format!("fight-{}.json.gz", f.id)));
        analyzer.begin_fight(f.id)?;
        if let Some(events) = file.as_deref().and_then(read_cached) {
            analyzer.push_events(&events);
            continue;
        }
        let mut all = Vec::new();
        let mut from = Some(f.start_time as f64);
        let mut pages = 0u64;
        while let Some(t) = from {
            let vars = serde_json::json!({ "code": code, "fight": f.id, "start": t, "end": f.end_time });
            let mut page = graphql(&id, &secret, EVENTS_QUERY, &vars)?;
            let events = &mut page["reportData"]["report"]["events"];
            from = events["nextPageTimestamp"].as_f64();
            let data = slim(match events["data"].take() {
                Value::Array(v) => v,
                _ => Vec::new(),
            });
            analyzer.push_events(&data);
            all.extend(data);
            pages += 1;
            progress(done + (pages * 8).min(95), total);
        }
        // fight recente de um log ao vivo pode ainda crescer
        let settled = end - f.end_time > SETTLE_MS || now_ms() - (start + end) > SETTLE_MS;
        if let (Some(file), true) = (&file, settled) {
            write_cached(file, &all);
        }
    }
    if let Some(d) = &dir {
        // marca o report como usado agora (a limpeza mantém os mais recentes)
        let _ = std::fs::create_dir_all(d);
        let _ = std::fs::remove_file(d.join(".used"));
        let _ = std::fs::File::create(d.join(".used"));
        if let Some(root) = d.parent() {
            prune(root);
        }
    }
    progress(total, total);
    let mut r = analyzer.finish();
    r.file = format!("{PREFIX}{code}");
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_code_from_the_source_path() {
        assert_eq!(code_of("wcl:abc12345"), Some("abc12345"));
        assert_eq!(code_of("wcl:"), None);
        assert_eq!(code_of("C:/logs/x.txt"), None);
    }

    #[test]
    fn slim_keeps_only_what_the_engine_reads() {
        let v = slim(vec![
            serde_json::json!({ "type": "resourcechange", "timestamp": 1 }),
            serde_json::json!({ "type": "damage", "timestamp": 2, "amount": 5, "classResources": [1], "fight": 3 }),
            serde_json::json!({ "type": "combatantinfo", "timestamp": 3, "gear": [] }),
        ]);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0], serde_json::json!({ "type": "damage", "timestamp": 2, "amount": 5 }));
        assert!(v[1].get("gear").is_some(), "combatantinfo fica inteiro");
    }
}
