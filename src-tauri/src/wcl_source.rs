//! Análise a partir do Warcraft Logs, sem o log no PC: baixa os eventos de cada fight de boss
//! pela API e passa para o `WclAnalyzer` do núcleo, página a página (a noite inteira tem ~3
//! milhões de eventos; nada disso fica inteiro na memória).
//!
//! Os eventos de fights já terminados não mudam: ficam no disco (gzip, só os campos que o
//! motor usa) para que reanalisar — regra ajustada, corte de mortes — não gaste os pontos da
//! API de novo. Guardamos os últimos reports abertos.

use crate::wcl::api_query;
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde_json::{Map, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use wipe_core::rules::RuleBook;
use wipe_core::wcl::{covered_by, dedupe, is_short_wipe, WclAnalyzer};
use wipe_core::{merge_pulls, AnalyzeOptions, LogReport, Pull};
use wipe_core::i18n::pick;

/// "Caminho" de uma análise do Warcraft Logs (no lugar do arquivo de log).
pub const PREFIX: &str = "wcl:";
/// Reports com eventos guardados no disco.
const KEEP_REPORTS: usize = 6;
/// Fight com eventos do report depois dele (ou report parado há um tempo) não muda mais;
/// antes disso, num log ao vivo, ainda pode estar chegando: não vai para o disco.
const SETTLED_AFTER_MS: i64 = 30_000;
const REPORT_IDLE_MS: i64 = 10 * 60_000;

/// Códigos dos reports de uma análise do Warcraft Logs (`wcl:A` ou, noite com vários
/// reports, `wcl:A,B`). Vazio se o caminho é de um log local.
pub fn codes_of(path: &str) -> Vec<&str> {
    path.strip_prefix(PREFIX).map(|c| c.split(',').filter(|c| !c.is_empty()).collect()).unwrap_or_default()
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
    // resourcechange (recurso da rotação: ganho e desperdício)
    "resourceChange",
    "resourceChangeType",
    "waste",
    "maxResourceAmount",
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
    Some(app.path().app_data_dir().ok()?.join("wcl-events-v2").join(code))
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

/// Folga ao procurar a noite nos logs do PC.
const NIGHT_MARGIN_MS: i64 = 10 * 60_000;

/// Analisa a noite dos reports (um ou mais, da mesma raid), sempre pelo mais barato: o que
/// estiver num log deste PC sai do log; do Warcraft Logs só se baixa o que falta. Entre
/// reports, cada pull vem de uma fonte só (`dedupe`). `progress(feitos, total)` por fight.
pub fn analyze(
    app: &AppHandle,
    codes: &[&str],
    book: RuleBook,
    local_opts: &AnalyzeOptions,
    tz_hours: f64,
    mut progress: impl FnMut(u64, u64),
) -> Result<LogReport, String> {
    let death_cutoff = local_opts.death_cutoff;
    let mut analyzer = WclAnalyzer::new(book, death_cutoff, tz_hours);
    // (início, fim) de cada report, para saber se um fight já não muda
    let mut spans = Vec::new();
    for code in codes {
        let data = api_query(REPORT_QUERY, &serde_json::json!({ "code": code }))?;
        let report = &data["reportData"]["report"];
        if report.is_null() {
            return Err(pick(format!("Report {code} não encontrado no Warcraft Logs (ele é privado ou o código está errado)."), format!("Report {code} not found on Warcraft Logs (it's private or the code is wrong).")));
        }
        analyzer.add_report(report, None)?;
        spans.push((report["startTime"].as_i64().unwrap_or(0), report["endTime"].as_i64().unwrap_or(0)));
    }
    // o app é para raid: fights de masmorra (M+) nem entram
    let all: Vec<_> = dedupe(analyzer.fights()).into_iter().filter(|f| !wipe_core::data::is_dungeon(f.difficulty_id, f.size)).collect();
    if all.is_empty() {
        return Err(pick("Nenhum boss nos reports.", "No bosses in the reports."));
    }

    // 1) o que já está num log do PC
    let from = all.iter().map(|f| f.abs_start).min().unwrap_or(0) - NIGHT_MARGIN_MS;
    let to = all.iter().map(|f| spans[f.report].0 + f.end_time).max().unwrap_or(0) + NIGHT_MARGIN_MS;
    let mut local_pulls: Vec<Pull> = Vec::new();
    let mut local_logs = Vec::new();
    let mut local_errors = Vec::new();
    for path in crate::logs::local_logs_between(app, from, to) {
        let Ok(r) = wipe_core::analyze_file(&path, local_opts, |_, _| {}) else { continue };
        let fresh: Vec<Pull> = r
            .pulls
            .into_iter()
            .filter(|p| p.start_ms >= from && p.start_ms <= to && !covered_by(&local_pulls, p.encounter_id, p.start_ms))
            .collect();
        if !fresh.is_empty() {
            local_logs.push(path.display().to_string());
            local_pulls.extend(fresh);
            local_errors = r.rule_errors;
        }
    }

    // 2) do Warcraft Logs, só os pulls que faltam (wipes curtos a análise descarta: nem baixa)
    let fights: Vec<_> = all.into_iter().filter(|f| !is_short_wipe(f) && !covered_by(&local_pulls, f.encounter_id, f.abs_start)).collect();
    let total = (fights.len() as u64 * 100).max(1);

    for (i, f) in fights.iter().enumerate() {
        let done = i as u64 * 100;
        progress(done, total);
        let code = codes[f.report];
        let file = cache_dir(app, code).map(|d| d.join(format!("fight-{}.json.gz", f.id)));
        analyzer.begin_fight(f.report, f.id)?;
        if let Some(events) = file.as_deref().and_then(read_cached) {
            analyzer.push_events(&events);
            continue;
        }
        let mut all = Vec::new();
        let mut from = Some(f.start_time as f64);
        let mut pages = 0u64;
        while let Some(t) = from {
            let vars = serde_json::json!({ "code": code, "fight": f.id, "start": t, "end": f.end_time });
            let mut page = api_query(EVENTS_QUERY, &vars)?;
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
        let (start, end) = spans[f.report];
        let settled = end - f.end_time > SETTLED_AFTER_MS || now_ms() - (start + end) > REPORT_IDLE_MS;
        if let (Some(file), true) = (&file, settled) {
            write_cached(file, &all);
        }
    }
    for code in codes {
        if let Some(d) = cache_dir(app, code) {
            // marca o report como usado agora (a limpeza mantém os mais recentes)
            let _ = std::fs::create_dir_all(&d);
            let _ = std::fs::remove_file(d.join(".used"));
            let _ = std::fs::File::create(d.join(".used"));
        }
    }
    if let Some(root) = cache_dir(app, "x").and_then(|d| d.parent().map(Path::to_path_buf)) {
        prune(&root);
    }
    progress(total, total);
    let mut r = analyzer.finish();
    r.file = format!("{PREFIX}{}", codes.join(","));
    r.wcl_pulls = r.pulls.len() as u32;
    if !local_pulls.is_empty() {
        let mut pulls = r.pulls;
        pulls.extend(local_pulls);
        r.pulls = merge_pulls(pulls);
        r.local_logs = local_logs;
        if r.rule_errors.is_empty() {
            r.rule_errors = local_errors;
        }
    }
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_codes_from_the_source_path() {
        assert_eq!(codes_of("wcl:abc12345"), vec!["abc12345"]);
        assert_eq!(codes_of("wcl:abc12345,def67890"), vec!["abc12345", "def67890"]);
        assert!(codes_of("wcl:").is_empty());
        assert!(codes_of("C:/logs/x.txt").is_empty());
    }

    #[test]
    fn slim_keeps_only_what_the_engine_reads() {
        let v = slim(vec![
            serde_json::json!({ "type": "refreshbuff", "timestamp": 1 }),
            serde_json::json!({ "type": "damage", "timestamp": 2, "amount": 5, "classResources": [1], "fight": 3 }),
            serde_json::json!({ "type": "combatantinfo", "timestamp": 3, "gear": [] }),
        ]);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0], serde_json::json!({ "type": "damage", "timestamp": 2, "amount": 5 }));
        assert!(v[1].get("gear").is_some(), "combatantinfo fica inteiro");
    }
}
