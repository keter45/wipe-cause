//! wipe-core: lê o `WoWCombatLog.txt` e gera um relatório por pull.

pub mod analysis;
pub mod data;
pub mod peek;
pub mod report;
pub mod rules;
pub mod timestamp;
pub mod tokenizer;

use analysis::{finalize, PullBuilder};
use data::GameData;
use rules::RuleBook;
pub use report::*;
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::Path;
use std::time::Instant;
use timestamp::{parse_timestamp, tz_offset_hours};
use tokenizer::{split_fields, split_timestamp};

/// Opções da análise.
#[derive(Debug, Clone, Default)]
pub struct AnalyzeOptions {
    /// Pasta extra com regras de boss (*.yaml) que substituem as embutidas.
    pub rules_dir: Option<std::path::PathBuf>,
    /// "Ignorar eventos após N mortes": depois da N-ésima morte de cada pull as estatísticas
    /// param de contar (0 = conta tudo).
    pub death_cutoff: u32,
}

/// Analisa um arquivo de log. `progress(lidos, total)` é chamado ~200 vezes ao longo do arquivo.
pub fn analyze_file(path: &Path, opts: &AnalyzeOptions, progress: impl FnMut(u64, u64)) -> io::Result<LogReport> {
    let file = File::open(path)?;
    let total = file.metadata()?.len();
    let mut book = RuleBook::embedded();
    if let Some(dir) = &opts.rules_dir {
        book.load_dir(dir);
    }
    let mut report = analyze_reader(BufReader::with_capacity(1 << 20, file), total, &book, opts.death_cutoff, progress)?;
    report.file = path.display().to_string();
    Ok(report)
}

pub fn analyze_reader<R: BufRead>(
    mut reader: R,
    total: u64,
    book: &RuleBook,
    death_cutoff: u32,
    mut progress: impl FnMut(u64, u64),
) -> io::Result<LogReport> {
    let data = GameData::embedded();
    let started = Instant::now();
    let default_year = current_year();

    let mut buf = Vec::with_capacity(4096);
    let mut bytes_read = 0u64;
    let mut last_progress = 0u64;
    let step = total / 200 + 1;
    let mut lines = 0u64;
    let mut log_version = None;
    let mut advanced_logging = false;
    let mut current: Option<PullBuilder> = None;
    let mut finished = Vec::new();

    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 {
            break;
        }
        bytes_read += n as u64;
        lines += 1;
        if bytes_read - last_progress >= step {
            progress(bytes_read, total);
            last_progress = bytes_read;
        }

        let line = String::from_utf8_lossy(&buf);
        let Some((ts, rest)) = split_timestamp(&line) else { continue };

        // Fora de encontro só interessam o cabeçalho e o início de encontros (pula trash rápido).
        let is_start = rest.starts_with("ENCOUNTER_START");
        if current.is_none() && !is_start {
            if rest.starts_with("COMBAT_LOG_VERSION") {
                let mut f = Vec::new();
                split_fields(rest, &mut f);
                log_version = f.get(1).and_then(|v| v.parse().ok());
                advanced_logging = f.iter().position(|v| *v == "ADVANCED_LOG_ENABLED").and_then(|i| f.get(i + 1)) == Some(&"1");
            }
            continue;
        }

        let Some(t) = parse_timestamp(ts, default_year) else { continue };
        let mut f = Vec::with_capacity(48);
        split_fields(rest, &mut f);

        if is_start {
            if let Some(prev) = current.take() {
                finished.push(prev.finish(None, finished.len(), &data));
            }
            current = Some(PullBuilder::start(&f, t, ts, tz_offset_hours(ts), book, death_cutoff));
        } else if f[0] == "ENCOUNTER_END" {
            if let Some(b) = current.take() {
                finished.push(b.finish(Some((f.as_slice(), t)), finished.len(), &data));
            }
        } else if let Some(b) = current.as_mut() {
            b.feed(&f, t, &data);
        }
    }
    if let Some(b) = current.take() {
        finished.push(b.finish(None, finished.len(), &data));
    }
    progress(total, total);

    let (pulls, ignored_short_pulls) = finalize(finished, &data);
    Ok(LogReport {
        file: String::new(),
        log_version,
        advanced_logging,
        lines,
        parse_ms: started.elapsed().as_millis() as u64,
        pulls,
        death_cutoff,
        ignored_short_pulls,
        rule_errors: book.errors.clone(),
    })
}

pub(crate) fn current_year() -> i32 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    1970 + (secs as f64 / 86_400.0 / 365.2425) as i32
}
