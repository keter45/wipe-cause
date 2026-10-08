//! wipe-core: lê o `WoWCombatLog.txt` e gera um relatório por pull.

pub mod analysis;
pub mod data;
pub mod i18n;
pub mod peek;
pub mod report;
pub mod rotation;
pub mod rules;
pub mod setup;
pub mod timestamp;
pub mod tokenizer;
pub mod wcl;

use analysis::{finalize, PullBuilder};
use data::GameData;
use rules::RuleBook;
pub use report::*;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;
use std::time::Instant;
use timestamp::{parse_timestamp, tz_offset_hours};
use tokenizer::{split_fields, split_timestamp};

/// Opções da análise.
#[derive(Debug, Clone, Default)]
pub struct AnalyzeOptions {
    /// Pasta extra com regras de boss (*.yaml) que substituem as embutidas.
    pub rules_dir: Option<std::path::PathBuf>,
    /// ajustes do usuário por boss (`<encounter_id>.json`)
    pub tuning_dir: Option<std::path::PathBuf>,
    /// "Ignorar eventos após N mortes": depois da N-ésima morte de cada pull as estatísticas
    /// param de contar (0 = conta tudo). Pull que termina em kill não tem corte: a raid seguiu e
    /// matou o boss, então o resto da luta conta.
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
    if let Some(dir) = &opts.tuning_dir {
        book.load_tuning_dir(dir);
    }
    let mut report = analyze_reader(BufReader::with_capacity(1 << 20, file), total, &book, opts.death_cutoff, progress)?;
    report.file = path.display().to_string();
    Ok(report)
}

/** Relê um pull desde o `ENCOUNTER_START` em `offset` sem o corte de mortes, até o `ENCOUNTER_END` (sem consumi-lo). */
fn reread_pull<R: BufRead + Seek>(reader: &mut R, offset: u64, default_year: i32, book: &RuleBook, data: &GameData) -> io::Result<Option<PullBuilder>> {
    reader.seek(SeekFrom::Start(offset))?;
    let mut buf = Vec::with_capacity(4096);
    let mut current: Option<PullBuilder> = None;
    loop {
        buf.clear();
        if reader.read_until(b'\n', &mut buf)? == 0 {
            return Ok(current);
        }
        let line = String::from_utf8_lossy(&buf);
        let Some((ts, rest)) = split_timestamp(&line) else { continue };
        let Some(t) = parse_timestamp(ts, default_year) else { continue };
        let mut f = Vec::with_capacity(48);
        split_fields(rest, &mut f);
        match (f[0], current.as_mut()) {
            ("ENCOUNTER_START", None) => current = Some(PullBuilder::start(&f, t, ts, tz_offset_hours(ts), book, 0)),
            ("ENCOUNTER_END", _) => return Ok(current),
            (_, Some(b)) => b.feed(&f, t, data),
            _ => {}
        }
    }
}

pub fn analyze_reader<R: BufRead + Seek>(
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
    // onde começou o pull atual: um kill que bateu o corte de mortes é relido daqui sem o corte
    let mut pull_offset = 0u64;

    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 {
            break;
        }
        let line_start = bytes_read;
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
            pull_offset = line_start;
        } else if f[0] == "ENCOUNTER_END" {
            if let Some(b) = current.take() {
                let kill = f.get(5) == Some(&"1");
                let b = if kill && b.cut_by_deaths() {
                    let again = reread_pull(&mut reader, pull_offset, default_year, book, &data)?;
                    reader.seek(SeekFrom::Start(bytes_read))?;
                    again.unwrap_or(b)
                } else {
                    b
                };
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
        rule_errors: book.errors.iter().chain(&crate::rotation::RotationBook::embedded().errors).cloned().collect(),
        local_logs: Vec::new(),
        wcl_pulls: 0,
    })
}

/// Junta pulls de fontes diferentes da mesma noite (log do PC + Warcraft Logs): ordena pelo
/// horário e refaz a numeração (id e "pull N" de cada boss e dificuldade).
pub fn merge_pulls(mut pulls: Vec<Pull>) -> Vec<Pull> {
    pulls.sort_by_key(|p| p.start_ms);
    let mut counters: std::collections::HashMap<(u32, u32), u32> = std::collections::HashMap::new();
    for (i, p) in pulls.iter_mut().enumerate() {
        p.id = i;
        let c = counters.entry((p.encounter_id, p.difficulty_id)).or_insert(0);
        *c += 1;
        p.pull_number = *c;
        p.pull_number_all = *c;
    }
    pulls
}

pub(crate) fn current_year() -> i32 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    1970 + (secs as f64 / 86_400.0 / 365.2425) as i32
}
