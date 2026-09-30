//! CLI para analisar um log sem abrir o app.
//!
//!   wipe-cli analyze <arquivo> [--json] [--cutoff N]   resumo dos pulls (ou o relatório em JSON);
//!                                                      --cutoff N ignora eventos após N mortes;
//!                                                      --tuning <pasta> aplica os ajustes do usuário (<encounter>.json)
//!   wipe-cli spells <arquivo>             spells inimigas por encontro (para calibrar regras de boss)
//!   wipe-cli peek <arquivo>               só os encontros do log (leitura rápida, como a lista de logs do app)
//!   wipe-cli wcl <pasta>[,<pasta>] [--json]  analisa reports baixados do Warcraft Logs (scripts/wcl-fetch.mjs)

use std::path::PathBuf;
use std::process::ExitCode;
use wipe_core::{analyze_file, AnalyzeOptions, LogReport};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (Some(cmd), Some(path)) = (args.first(), args.get(1)) else {
        eprintln!("uso: wipe-cli <analyze|spells|peek> <WoWCombatLog.txt> [--json]");
        return ExitCode::from(2);
    };
    let death_cutoff = args
        .iter()
        .position(|a| a == "--cutoff")
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if cmd == "peek" {
        return match wipe_core::peek::peek_file(&PathBuf::from(path)) {
            Ok(p) => {
                println!("{}", serde_json::to_string_pretty(&p).unwrap());
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("erro ao ler {path}: {e}");
                ExitCode::FAILURE
            }
        };
    }
    let tuning_dir = args.iter().position(|a| a == "--tuning").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let opts = AnalyzeOptions { death_cutoff, tuning_dir, ..Default::default() };
    let result = if cmd == "wcl" { analyze_wcl_dump(path, death_cutoff) } else { analyze_file(&PathBuf::from(path), &opts, |_, _| {}).map_err(|e| e.to_string()) };
    let report = match result {
        Ok(r) => r,
        Err(e) => {
            eprintln!("erro ao ler {path}: {e}");
            return ExitCode::FAILURE;
        }
    };
    match cmd.as_str() {
        "analyze" | "wcl" if args.iter().any(|a| a == "--json") => {
            println!("{}", serde_json::to_string_pretty(&report).unwrap());
        }
        "analyze" | "wcl" => print_summary(&report),
        "spells" => print_spells(&report),
        _ => {
            eprintln!("comando desconhecido: {cmd}");
            return ExitCode::from(2);
        }
    }
    ExitCode::SUCCESS
}

/// Pastas do scripts/wcl-fetch.mjs (report.json e fight-<id>.json), separadas por vírgula:
/// várias = reports da mesma noite, juntados com uma cópia de cada pull. Fuso em WIPE_TZ
/// (padrão -3, BRT).
fn analyze_wcl_dump(dirs: &str, death_cutoff: u32) -> Result<LogReport, String> {
    let read = |dir: &str, name: &str| -> Result<serde_json::Value, String> {
        let text = std::fs::read_to_string(std::path::Path::new(dir).join(name)).map_err(|e| format!("{dir}/{name}: {e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("{dir}/{name}: {e}"))
    };
    let tz = std::env::var("WIPE_TZ").ok().and_then(|v| v.parse().ok()).unwrap_or(-3.0);
    let dirs: Vec<&str> = dirs.split(',').collect();
    let mut a = wipe_core::wcl::WclAnalyzer::new(wipe_core::rules::RuleBook::embedded(), death_cutoff, tz);
    for dir in &dirs {
        a.add_report(&read(dir, "report.json")?, None)?;
    }
    for f in wipe_core::wcl::dedupe(a.fights()) {
        let Ok(events) = read(dirs[f.report], &format!("fight-{}.json", f.id)) else { continue };
        a.begin_fight(f.report, f.id)?;
        a.push_events(events.as_array().map_or(&[][..], |v| v.as_slice()));
    }
    Ok(a.finish())
}

fn mmss(ms: i64) -> String {
    format!("{}:{:02}", ms / 60_000, (ms / 1000) % 60)
}

fn print_summary(r: &LogReport) {
    println!(
        "{} | versão {:?} | advanced {} | {} linhas em {} ms | {} pulls",
        r.file,
        r.log_version,
        r.advanced_logging,
        r.lines,
        r.parse_ms,
        r.pulls.len()
    );
    for p in &r.pulls {
        let hp = p
            .bosses
            .iter()
            .map(|b| format!("{} {:.1}%", b.name, b.hp_pct.unwrap_or(f32::NAN)))
            .collect::<Vec<_>>()
            .join(", ");
        println!(
            "\n#{} {} ({}) pull {} — {} em {} — {}",
            p.id,
            p.encounter_name,
            p.difficulty_name,
            p.pull_number,
            if p.success { "KILL" } else { "WIPE" },
            mmss(p.duration_ms),
            hp
        );
        for d in &p.deaths {
            let kb = d
                .killing_blow
                .as_ref()
                .map(|k| format!("{} ({}) {}", k.spell_name, k.source, k.amount))
                .unwrap_or_else(|| "?".into());
            let avail: Vec<&str> = d.defensives_available.iter().map(|a| a.name.as_str()).collect();
            println!(
                "  {}. {} {} — {} | pot:{} hs:{} | disponíveis: {}",
                d.order,
                mmss(d.t),
                d.name,
                kb,
                d.used_health_potion,
                d.used_healthstone,
                if avail.is_empty() { "-".to_string() } else { avail.join(", ") }
            );
        }
    }
}

fn print_spells(r: &LogReport) {
    println!("encounter_id,encounter,spell_id,spell,sources,casts,hits_on_players,damage_to_players");
    for p in &r.pulls {
        for s in &p.enemy_spells {
            println!(
                "{},\"{}\",{},\"{}\",\"{}\",{},{},{}",
                p.encounter_id,
                p.encounter_name,
                s.spell_id,
                s.name,
                s.sources.join("|"),
                s.casts,
                s.hits_on_players,
                s.damage_to_players
            );
        }
    }
}
