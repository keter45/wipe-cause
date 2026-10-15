//! O núcleo no navegador: a versão web do Wipe Cause roda a mesma análise do app, dentro de um
//! Web Worker. O arquivo de log não sai do PC de quem usa: o worker lê pedaços do `File`
//! escolhido (`read(pos, len)`, com `FileReaderSync`) e o Warcraft Logs é baixado pelo próprio
//! navegador, página a página (`WclSession`).
//!
//! Tudo que vai e volta é JSON (o relatório já é serializável e a UI lê o mesmo formato do app).

use js_sys::{Function, Uint8Array};
use serde_json::{json, Value};
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use wasm_bindgen::prelude::*;
use wipe_core::i18n::pick;
use wipe_core::rules::{RuleBook, Tuning, TUNABLE_FIELDS};
use wipe_core::summary::{best_hp, has_raid, main_encounter, title_of};
use wipe_core::wcl::{dedupe, is_short_wipe, slim_events, WclAnalyzer};
use wipe_core::LogReport;

fn err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Idioma das mensagens do núcleo (erros, textos das regras).
#[wasm_bindgen(js_name = setEnglish)]
pub fn set_english(en: bool) {
    wipe_core::i18n::set_english(en);
}

/// Regras embutidas + os ajustes do usuário (lista de `Tuning` em JSON).
fn rule_book(tunings: &str) -> RuleBook {
    let mut book = RuleBook::embedded();
    for t in serde_json::from_str::<Vec<Tuning>>(tunings).unwrap_or_default() {
        let _ = book.apply_tuning(&t);
    }
    book
}

/// Arquivo do navegador lido aos pedaços: `read(pos, len)` devolve um `Uint8Array`.
struct JsFile {
    read: Function,
    size: u64,
    pos: u64,
}

impl Read for JsFile {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let len = (buf.len() as u64).min(self.size.saturating_sub(self.pos));
        if len == 0 {
            return Ok(0);
        }
        let chunk = self
            .read
            .call2(&JsValue::NULL, &JsValue::from_f64(self.pos as f64), &JsValue::from_f64(len as f64))
            .map_err(|e| io::Error::other(e.as_string().unwrap_or_else(|| "read failed".into())))?;
        let chunk = Uint8Array::new(&chunk);
        let n = (chunk.length() as usize).min(buf.len());
        chunk.subarray(0, n as u32).copy_to(&mut buf[..n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for JsFile {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        self.pos = match to {
            SeekFrom::Start(p) => p,
            SeekFrom::End(d) => (self.size as i64 + d).max(0) as u64,
            SeekFrom::Current(d) => (self.pos as i64 + d).max(0) as u64,
        };
        Ok(self.pos)
    }
}

/// Relatório + o resumo que o histórico guarda (título, boss, melhor tentativa).
fn with_summary(report: &LogReport) -> Result<String, JsError> {
    let summary = json!({
        "raid": has_raid(report),
        "title": title_of(report),
        "encounterId": main_encounter(report),
        "bestHp": best_hp(report),
    });
    serde_json::to_string(&json!({ "report": report, "summary": summary })).map_err(err)
}

/// Analisa um combat log escolhido no navegador. `name` vira o `file` do relatório (e o
/// `logFile` de cada pull, para o replay achar o arquivo de novo). `progress(lidos, total)`.
#[wasm_bindgen(js_name = analyzeFile)]
pub fn analyze_file(name: &str, size: f64, read: Function, progress: Function, death_cutoff: u32, tunings: &str) -> Result<String, JsError> {
    let size = size as u64;
    let file = JsFile { read, size, pos: 0 };
    let book = rule_book(tunings);
    let mut report = wipe_core::analyze_reader(BufReader::with_capacity(1 << 20, file), size, &book, death_cutoff, |done, total| {
        let _ = progress.call2(&JsValue::NULL, &JsValue::from_f64(done as f64), &JsValue::from_f64(total as f64));
    })
    .map_err(|e| err(pick(format!("não foi possível ler {name}: {e}"), format!("could not read {name}: {e}"))))?;
    report.file = name.to_string();
    for p in &mut report.pulls {
        p.log_file = Some(name.to_string());
    }
    with_summary(&report)
}

/// Replay completo de um pull (relê só ele, a partir de `offset`).
#[wasm_bindgen(js_name = fightReplay)]
pub fn fight_replay(name: &str, size: f64, read: Function, offset: f64, tunings: &str) -> Result<String, JsError> {
    let file = JsFile { read, size: size as u64, pos: 0 };
    let mut pull = wipe_core::analyze_pull_reader(BufReader::with_capacity(1 << 20, file), offset as u64, &rule_book(tunings))
        .map_err(|e| err(pick(format!("não foi possível reler o pull em {name}: {e}"), format!("could not re-read the pull in {name}: {e}"))))?;
    pull.log_file = Some(name.to_string());
    serde_json::to_string(&pull).map_err(err)
}

/// Regra de um boss como está no app (sem ajustes), para a tela de ajustes.
#[wasm_bindgen(js_name = rulesBase)]
pub fn rules_base(encounter_id: u32) -> Result<String, JsError> {
    let book = RuleBook::embedded();
    let base = book.base(encounter_id);
    let mechanics: Vec<Value> = base.map(|b| b.raw_mechanics().iter().filter_map(|m| serde_json::to_value(m).ok()).collect()).unwrap_or_default();
    serde_json::to_string(&json!({
        "name": base.map(|b| b.name.clone()),
        "file": base.map(|b| b.file.clone()),
        "mechanics": mechanics,
        "tunable": TUNABLE_FIELDS,
    }))
    .map_err(err)
}

/// Confere um ajuste antes de salvar (o mesmo que o app faz).
#[wasm_bindgen(js_name = checkTuning)]
pub fn check_tuning(tuning: &str) -> Result<(), JsError> {
    let t: Tuning = serde_json::from_str(tuning).map_err(err)?;
    RuleBook::embedded().apply_tuning(&t).map_err(err)
}

/// Análise a partir do Warcraft Logs: o navegador baixa e entrega aqui, report a report e
/// página a página (o mesmo caminho do `wcl_source` do app, sem os logs locais).
#[wasm_bindgen]
pub struct WclSession {
    analyzer: Option<WclAnalyzer>,
}

#[wasm_bindgen]
impl WclSession {
    #[wasm_bindgen(constructor)]
    pub fn new(death_cutoff: u32, tz_hours: f64, tunings: &str) -> WclSession {
        WclSession { analyzer: Some(WclAnalyzer::new(rule_book(tunings), death_cutoff, tz_hours)) }
    }

    fn analyzer(&mut self) -> Result<&mut WclAnalyzer, JsError> {
        self.analyzer.as_mut().ok_or_else(|| err("session finished"))
    }

    /// `reportData.report` da consulta do report (fights + masterData).
    #[wasm_bindgen(js_name = addReport)]
    pub fn add_report(&mut self, report: &str) -> Result<(), JsError> {
        let v: Value = serde_json::from_str(report).map_err(err)?;
        self.analyzer()?.add_report(&v, None).map_err(err)?;
        Ok(())
    }

    /// Fights a baixar: bosses de raid, um por pull entre os reports, sem os wipes curtos.
    pub fn fights(&mut self) -> Result<String, JsError> {
        let all: Vec<_> = dedupe(self.analyzer()?.fights()).into_iter().filter(|f| !wipe_core::data::is_dungeon(f.difficulty_id, f.size)).collect();
        if all.is_empty() {
            return Err(err(pick("Nenhum boss nos reports.", "No bosses in the reports.")));
        }
        let list: Vec<Value> = all
            .iter()
            .filter(|f| !is_short_wipe(f))
            .map(|f| json!({ "report": f.report, "id": f.id, "startTime": f.start_time, "endTime": f.end_time }))
            .collect();
        serde_json::to_string(&list).map_err(err)
    }

    #[wasm_bindgen(js_name = beginFight)]
    pub fn begin_fight(&mut self, report: usize, fight_id: f64) -> Result<(), JsError> {
        self.analyzer()?.begin_fight(report, fight_id as i64).map_err(err)
    }

    /// Uma página de eventos da API (`events.data`). Devolve só o que o motor usa, para guardar.
    #[wasm_bindgen(js_name = pushPage)]
    pub fn push_page(&mut self, events: &str) -> Result<String, JsError> {
        let data = match serde_json::from_str::<Value>(events).map_err(err)? {
            Value::Array(v) => slim_events(v),
            _ => Vec::new(),
        };
        self.analyzer()?.push_events(&data);
        serde_json::to_string(&data).map_err(err)
    }

    /// Eventos já enxutos (guardados de uma análise anterior).
    #[wasm_bindgen(js_name = pushSlim)]
    pub fn push_slim(&mut self, events: &str) -> Result<(), JsError> {
        let data: Vec<Value> = serde_json::from_str(events).map_err(err)?;
        self.analyzer()?.push_events(&data);
        Ok(())
    }

    /// Fight para o replay completo (posições, vida, debuffs); feche com `replay`.
    #[wasm_bindgen(js_name = beginReplay)]
    pub fn begin_replay(&mut self, report: usize, fight_id: f64) -> Result<(), JsError> {
        self.analyzer()?.begin_replay(report, fight_id as i64).map_err(err)
    }

    /// Fecha o fight de `beginReplay`: o pull com o replay, em JSON.
    pub fn replay(&mut self) -> Result<String, JsError> {
        let analyzer = self.analyzer.take().ok_or_else(|| err("session finished"))?;
        let pull = analyzer.replay().ok_or_else(|| err(pick("pull curto demais para o replay", "pull too short for the replay")))?;
        serde_json::to_string(&pull).map_err(err)
    }

    /// Fecha a análise. `file` = `wcl:<códigos>`.
    pub fn finish(&mut self, file: &str) -> Result<String, JsError> {
        let analyzer = self.analyzer.take().ok_or_else(|| err("session finished"))?;
        let mut r = analyzer.finish();
        r.file = file.to_string();
        r.wcl_pulls = r.pulls.len() as u32;
        with_summary(&r)
    }
}
