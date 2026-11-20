//! CLI para analisar um log sem abrir o app.
//!
//!   wipe-cli analyze <arquivo> [--json] [--cutoff N]   resumo dos pulls (ou o relatório em JSON);
//!                                                      --cutoff N ignora eventos após N mortes;
//!                                                      --tuning <pasta> aplica os ajustes do usuário (<encounter>.json)
//!   wipe-cli spells <arquivo>             spells inimigas por encontro (para calibrar regras de boss)
//!   wipe-cli rules                        regras de boss embutidas, em JSON (para scripts/replay-check.mjs)
//!   wipe-cli peek <arquivo>               só os encontros do log (leitura rápida, como a lista de logs do app)
//!   wipe-cli positions <arquivo>          onde os players pisaram em cada boss (para alinhar a imagem da arena)
//!   wipe-cli radius <arquivo> --damage <id> (--aura <id> | --npc <id> | --soak)  raio de uma área: distância de
//!                                         quem levou o dano até o portador da aura (ou a unidade) mais perto, ou
//!                                         até o meio do soak (e quantos entraram em cada um)
//!   wipe-cli wcl <pasta>[,<pasta>] [--json]  analisa reports baixados do Warcraft Logs (scripts/wcl-fetch.mjs)
//!   wipe-cli wcl <pasta>[,<pasta>] --fight <report>:<fight>  replay completo de um pull do WCL (o mesmo JSON do
//!                                         `fight`); <report> é o índice da pasta na lista (0 = a primeira)
//!   wipe-cli probe <medida> <fonte>[,<fonte>] --encounter <id> [--difficulty 16] [--json] [opções]
//!                                         medidas do boss (docs/replay-methods.md). Fonte: combat log ou pasta do
//!                                         wcl-fetch. Saída em texto; com --json, JSON (sempre com encounter e pulls):
//!     ids                                 por spell: { spells: [{ spellId, name, castStart, castSuccess, casters,
//!                                         auraOnPlayers, auraOnEnemies, auraSources, damageHits, damage,
//!                                         damageSources, summons }] } (só inimigos ou sem origem lançando/aplicando)
//!     units                               por npc inimigo: { units: [{ npcId, name, units, lines, posPct, firstLineS,
//!                                         firstPosS, noPos, spawns: [[x, y, n]], hpMedian, hpMax, diedPct, maxGapS }] }
//!     falloff --damage <id> | --all       dano bruto por faixa de 5 jd até quem lançou: { spells: [{ spellId, name,
//!                                         hits, rho, verdict: cai|nao_cai|incerto, bands: [[jd, n, mediana]] }] }
//!                                         (--all: só spells com 30 acertos ou mais)
//!     pulse-radius --damage <id> [--aura <id> | --npc <id>]  raio pelo Youden por pulso (sem aura nem npc, o centro é
//!                                         quem lançou): { damageId, center: aura|npc|source, centerId, lots, radius,
//!                                         tpr, fpr, hits, others, byAge: [{ fromS, toS, radius, tpr, fpr, hits, others }] }
//!     ahead (--cast <id> | --damage <id>) [--damage <id> | --aura <id>] [--window 3]  onde cai em relação a quem
//!                                         lança no fim do cast: { castId, pointsFrom: aura|damage, pointsId, damageIds,
//!                                         casts, withPoints, r, along, side, angle, dist, points: [p10, p50, p90],
//!                                         offset: [p50, p90] } (side > 0 = à esquerda; offset = do meio do lote até
//!                                         o ponto a r jd na frente)
//!     cone --cast <id> [--damage <id>] [--window 3]  setor no fim do cast pelo Youden: { castId, damageIds, casts,
//!                                         halfAngle, range, tpr, fpr, hits, others }
//!     wave-dir (--aura <id> | --cast <id>) --damage <id> [--directions 4] [--duration 6]  direção das ondas por
//!                                         hipóteses: { damageId, sources, hits, directions, bases: [{ base, phi,
//!                                         explained, random, hits }], best: {...}, start, speed, width, lateralMax,
//!                                         farthest: [jd, s] } (base: world|facingOut|facingIn|fromBoss; no cast,
//!                                         facingOut é a direção de quem lança)
//!     pool --cast <id> --damage <id> [--duration 30]  por vez que o cast sai: { castId, damageId, casts: [{ pull, n,
//!                                         t, ticks, delayS, durationS, circles: [[x, y, r]], tpr, fpr, j }] }

use std::path::PathBuf;
use std::process::ExitCode;
use wipe_core::{analyze_file, AnalyzeOptions, LogReport};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // regras de boss embutidas, em JSON (para os scripts de conferência, que não leem YAML)
    if args.first().map(String::as_str) == Some("rules") {
        let all: Vec<serde_json::Value> = wipe_core::rules::embedded_sources()
            .iter()
            .filter_map(|(file, src)| {
                let mut v: serde_json::Value = yaml_serde::from_str(src).ok()?;
                v["file"] = (*file).into();
                Some(v)
            })
            .collect();
        println!("{}", serde_json::to_string(&all).unwrap_or_default());
        return ExitCode::SUCCESS;
    }
    if args.first().map(String::as_str) == Some("probe") {
        return probe(&args[1..]);
    }
    let (Some(cmd), Some(path)) = (args.first(), args.get(1)) else {
        eprintln!("uso: wipe-cli <analyze|spells|peek|fight> <WoWCombatLog.txt> [--json] [--pull <id>] | wipe-cli wcl <pasta>[,<pasta>] [--json|--spells]");
        return ExitCode::from(2);
    };
    let death_cutoff = args
        .iter()
        .position(|a| a == "--cutoff")
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if cmd == "radius" {
        let num = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).and_then(|v| v.parse::<u32>().ok());
        let Some(damage) = num("--damage") else {
            eprintln!("uso: wipe-cli radius <log> --damage <id> (--aura <id> | --npc <id> | --soak)");
            return ExitCode::from(2);
        };
        return match wipe_core::positions::radius_probe(&PathBuf::from(path), damage, num("--aura"), num("--npc"), args.iter().any(|a| a == "--soak")) {
            Ok((mut d, mut sizes)) => {
                if !sizes.is_empty() {
                    sizes.sort_unstable();
                    let s = |p: f32| sizes[((sizes.len() - 1) as f32 * p) as usize];
                    println!("{} soaks  players por soak p10 {}  p50 {}  p90 {}", sizes.len(), s(0.1), s(0.5), s(0.9));
                }
                d.sort_by(f32::total_cmp);
                let q = |p: f32| d.get(((d.len().max(1) - 1) as f32 * p) as usize).copied().unwrap_or(f32::NAN);
                println!("{} golpes  p10 {:.1}  p50 {:.1}  p90 {:.1}  p95 {:.1}  max {:.1} jd", d.len(), q(0.1), q(0.5), q(0.9), q(0.95), q(1.0));
                // histograma por jarda: o raio é onde a contagem despenca (golpes de outros centros ficam no rabo)
                let mut bins = [0usize; 30];
                for &x in &d {
                    if let Some(b) = bins.get_mut(x as usize) {
                        *b += 1;
                    }
                }
                let top = bins.iter().copied().max().unwrap_or(1).max(1);
                for (i, n) in bins.iter().enumerate() {
                    println!("{i:>3} jd {n:>6} {}", "#".repeat(n * 40 / top));
                }
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("erro ao ler {path}: {e}");
                ExitCode::FAILURE
            }
        };
    }
    if cmd == "positions" {
        return match wipe_core::positions::occupancy_file(&PathBuf::from(path)) {
            Ok(p) => {
                println!("{}", serde_json::to_string(&p).unwrap());
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("erro ao ler {path}: {e}");
                ExitCode::FAILURE
            }
        };
    }
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
    if cmd == "wcl" {
        if let Some(spec) = args.iter().position(|a| a == "--fight").and_then(|i| args.get(i + 1)) {
            return match wcl_replay(path, spec) {
                Ok(p) => {
                    println!("{}", serde_json::to_string(&p).unwrap());
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("erro: {e}");
                    ExitCode::FAILURE
                }
            };
        }
    }
    let tuning_dir = args.iter().position(|a| a == "--tuning").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let opts = AnalyzeOptions { death_cutoff, tuning_dir, ..Default::default() };
    let local = args.iter().position(|a| a == "--local").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let result = if cmd == "wcl" { analyze_wcl_dump(path, death_cutoff, local.as_deref(), &opts) } else { analyze_file(&PathBuf::from(path), &opts, |_, _| {}).map_err(|e| e.to_string()) };
    let report = match result {
        Ok(r) => r,
        Err(e) => {
            eprintln!("erro ao ler {path}: {e}");
            return ExitCode::FAILURE;
        }
    };
    match cmd.as_str() {
        // replay completo de um pull (o mesmo que o app pede ao abrir a aba Replay)
        "fight" => {
            let id: usize = args.iter().position(|a| a == "--pull").and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(0);
            let Some(offset) = report.pulls.iter().find(|p| p.id == id).and_then(|p| p.log_offset) else {
                eprintln!("pull {id} não encontrado");
                return ExitCode::FAILURE;
            };
            match wipe_core::analyze_pull_full(&PathBuf::from(path), offset, &opts) {
                Ok(p) => println!("{}", serde_json::to_string(&p).unwrap()),
                Err(e) => {
                    eprintln!("erro ao reler o pull: {e}");
                    return ExitCode::FAILURE;
                }
            }
        }
        "wcl" if args.iter().any(|a| a == "--spells") => print_spells(&report),
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

/// `wipe-cli probe <medida> <fonte>[,<fonte>] --encounter <id> ...` (ver o topo do arquivo).
fn probe(args: &[String]) -> ExitCode {
    let (Some(measure), Some(sources)) = (args.first(), args.get(1)) else {
        eprintln!("uso: wipe-cli probe <{}> <fonte>[,<fonte>] --encounter <id> [--difficulty 16] [--json] [opções]", wipe_core::probe::MEASURES.join("|"));
        return ExitCode::from(2);
    };
    let val = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1));
    let id = |k: &str| val(k).and_then(|v| v.parse::<u32>().ok());
    let secs = |k: &str| val(k).and_then(|v| v.replace(',', ".").parse::<f32>().ok());
    let Some(encounter) = id("--encounter") else {
        eprintln!("probe precisa de --encounter <id>");
        return ExitCode::from(2);
    };
    let flt = wipe_core::probe::Filter { encounter, difficulty: id("--difficulty").unwrap_or(16) };
    let opts = wipe_core::probe::Opts {
        damage: id("--damage"),
        aura: id("--aura"),
        npc: id("--npc"),
        cast: id("--cast"),
        all: args.iter().any(|a| a == "--all"),
        window_s: secs("--window"),
        directions: id("--directions"),
        duration_s: secs("--duration"),
    };
    let sources: Vec<String> = sources.split(',').map(str::to_string).collect();
    match wipe_core::probe::run(measure, &sources, flt, &opts) {
        Ok(v) => {
            if args.iter().any(|a| a == "--json") {
                println!("{}", serde_json::to_string(&v).unwrap());
            } else {
                print!("{}", wipe_core::probe::text(measure, &v));
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("erro: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Replay completo de um pull do WCL (`--fight <report>:<fight>`), como o app faz ao abrir a aba Replay.
fn wcl_replay(dirs: &str, spec: &str) -> Result<wipe_core::Pull, String> {
    let (report, fight) = spec.split_once(':').ok_or("use --fight <report>:<fight>")?;
    let report: usize = report.parse().map_err(|_| format!("report inválido: {report}"))?;
    let fight: i64 = fight.parse().map_err(|_| format!("fight inválido: {fight}"))?;
    let read = |dir: &str, name: &str| -> Result<serde_json::Value, String> {
        let text = std::fs::read_to_string(std::path::Path::new(dir).join(name)).map_err(|e| format!("{dir}/{name}: {e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("{dir}/{name}: {e}"))
    };
    let dirs: Vec<&str> = dirs.split(',').collect();
    let dir = dirs.get(report).ok_or_else(|| format!("não há a pasta {report}"))?;
    let tz = std::env::var("WIPE_TZ").ok().and_then(|v| v.parse().ok()).unwrap_or(-3.0);
    let mut a = wipe_core::wcl::WclAnalyzer::new(wipe_core::rules::RuleBook::embedded(), 0, tz);
    for d in &dirs {
        a.add_report(&read(d, "report.json")?, None)?;
    }
    let events = read(dir, &format!("fight-{fight}.json"))?;
    a.begin_replay(report, fight)?;
    a.push_events(events.as_array().map_or(&[][..], |v| v.as_slice()));
    a.replay().ok_or_else(|| "pull curto demais".to_string())
}

/// Pastas do scripts/wcl-fetch.mjs (report.json e fight-<id>.json), separadas por vírgula:
/// várias = reports da mesma noite, juntados com uma cópia de cada pull. Fuso em WIPE_TZ
/// (padrão -3, BRT).
/// `--local <log>`: como no app, o que estiver no log do PC sai dele e do Warcraft Logs só
/// entram os pulls que faltam.
fn analyze_wcl_dump(dirs: &str, death_cutoff: u32, local: Option<&std::path::Path>, opts: &AnalyzeOptions) -> Result<LogReport, String> {
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
    let local_pulls = match local {
        Some(p) => analyze_file(p, opts, |_, _| {}).map_err(|e| e.to_string())?.pulls,
        None => Vec::new(),
    };
    for f in wipe_core::wcl::dedupe(a.fights()) {
        if wipe_core::wcl::is_short_wipe(&f) || wipe_core::wcl::covered_by(&local_pulls, f.encounter_id, f.abs_start) {
            continue;
        }
        let Ok(events) = read(dirs[f.report], &format!("fight-{}.json", f.id)) else { continue };
        a.begin_fight(f.report, f.id)?;
        a.push_events(events.as_array().map_or(&[][..], |v| v.as_slice()));
    }
    let mut r = a.finish();
    r.wcl_pulls = r.pulls.len() as u32;
    if !local_pulls.is_empty() {
        let mut pulls = r.pulls;
        pulls.extend(local_pulls);
        r.pulls = wipe_core::merge_pulls(pulls);
    }
    Ok(r)
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
    if let Some((hp, phase)) = wipe_core::summary::best_wipe(r) {
        println!("melhor wipe: {}{hp:.1}%", phase.map(|p| format!("{p} ")).unwrap_or_default());
    }
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
