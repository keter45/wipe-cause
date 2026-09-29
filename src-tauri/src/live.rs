//! Modo ao vivo: acompanha o combat log enquanto a raid acontece e reanalisa quando um pull
//! termina, para a raid ver o motivo do wipe antes do próximo pull.
//!
//! Lê só o que foi acrescentado ao arquivo desde a última olhada (procurando ENCOUNTER_START/END);
//! quando um encontro termina, reanalisa o log inteiro (~4s para 1,3 GB) — assim o resultado é
//! idêntico ao da análise normal (numeração dos pulls, regras, corte, histórico).

use crate::logs;
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// Intervalo entre as olhadas no arquivo.
const POLL: Duration = Duration::from_millis(1000);
/// O WoW grava o log em blocos: espera um pouco depois do ENCOUNTER_END para o fim do pull
/// estar no arquivo.
const SETTLE: Duration = Duration::from_millis(1500);

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    pub active: bool,
    /// "watching" | "in_combat" | "analyzing" | "error" | "stopped"
    pub state: String,
    pub file: Option<String>,
    /// boss em combate agora
    pub encounter: Option<String>,
    /// pulls analisados desde que o modo ao vivo começou
    pub analyzed: u32,
    pub message: Option<String>,
}

struct Session {
    stop: AtomicBool,
    status: Mutex<LiveStatus>,
}

static SESSION: Mutex<Option<Arc<Session>>> = Mutex::new(None);

fn set_status(app: &AppHandle, s: &Session, change: impl FnOnce(&mut LiveStatus)) {
    let snapshot = {
        let mut st = s.status.lock().unwrap_or_else(|e| e.into_inner());
        change(&mut st);
        st.clone()
    };
    let _ = app.emit("live-status", snapshot);
}

/// Começa a acompanhar o log (o indicado ou o mais recente da pasta de logs).
#[tauri::command]
pub fn live_start(app: AppHandle, path: Option<String>, death_cutoff: u32) -> Result<LiveStatus, String> {
    live_stop();
    let dir = logs::current_dir(&app).0;
    let file = match path {
        Some(p) => PathBuf::from(p),
        None => dir
            .as_deref()
            .and_then(logs::newest_live_log)
            .ok_or("Nenhum WoWCombatLog encontrado na pasta de logs. Escolha a pasta em \"Nova análise\".")?,
    };
    let session = Arc::new(Session {
        stop: AtomicBool::new(false),
        status: Mutex::new(LiveStatus {
            active: true,
            state: "watching".into(),
            file: Some(file.display().to_string()),
            ..Default::default()
        }),
    });
    *SESSION.lock().unwrap_or_else(|e| e.into_inner()) = Some(session.clone());
    let status = session.status.lock().unwrap_or_else(|e| e.into_inner()).clone();
    std::thread::spawn(move || watch(app, session, file, dir, death_cutoff));
    Ok(status)
}

#[tauri::command]
pub fn live_stop() {
    if let Some(s) = SESSION.lock().unwrap_or_else(|e| e.into_inner()).take() {
        s.stop.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn live_status() -> LiveStatus {
    SESSION
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|s| s.status.lock().unwrap_or_else(|e| e.into_inner()).clone())
        .unwrap_or(LiveStatus { state: "stopped".into(), ..Default::default() })
}

fn watch(app: AppHandle, s: Arc<Session>, mut file: PathBuf, dir: Option<PathBuf>, death_cutoff: u32) {
    // a raid pode já estar em andamento: mostra o que já aconteceu
    analyze(&app, &s, &file, death_cutoff, false);
    let mut offset = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    let mut carry: Vec<u8> = Vec::new();

    while !s.stop.load(Ordering::Relaxed) {
        std::thread::sleep(POLL);
        if s.stop.load(Ordering::Relaxed) {
            break;
        }
        // o WoW abre um arquivo novo ao religar o /combatlog ou relogar
        if let Some(newer) = dir.as_deref().and_then(logs::newest_live_log).filter(|n| *n != file && is_newer(n, &file)) {
            file = newer;
            offset = 0;
            carry.clear();
            set_status(&app, &s, |st| {
                st.file = Some(file.display().to_string());
                st.encounter = None;
                st.state = "watching".into();
            });
        }
        let len = match std::fs::metadata(&file) {
            Ok(m) => m.len(),
            Err(e) => {
                set_status(&app, &s, |st| {
                    st.state = "error".into();
                    st.message = Some(format!("não foi possível ler o log: {e}"));
                });
                continue;
            }
        };
        if len < offset {
            offset = 0; // arquivo recriado
            carry.clear();
        }
        if len == offset {
            continue;
        }
        let events = match read_new(&file, offset, len, &mut carry) {
            Ok(ev) => ev,
            Err(_) => continue,
        };
        offset = len;
        for ev in events {
            match ev {
                Encounter::Start(name) => set_status(&app, &s, |st| {
                    st.state = "in_combat".into();
                    st.encounter = Some(name);
                    st.message = None;
                }),
                Encounter::End => {
                    std::thread::sleep(SETTLE);
                    analyze(&app, &s, &file, death_cutoff, true);
                    offset = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(offset);
                    carry.clear();
                }
            }
        }
    }
    set_status(&app, &s, |st| {
        st.active = false;
        st.state = "stopped".into();
        st.encounter = None;
    });
}

fn is_newer(a: &Path, b: &Path) -> bool {
    let m = |p: &Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
    matches!((m(a), m(b)), (Some(x), Some(y)) if x > y)
}

enum Encounter {
    Start(String),
    End,
}

/// Lê `offset..len` e devolve os inícios/fins de encontro das linhas completas; a linha
/// incompleta do fim fica em `carry` para a próxima leitura.
fn read_new(file: &Path, offset: u64, len: u64, carry: &mut Vec<u8>) -> std::io::Result<Vec<Encounter>> {
    let mut f = File::open(file)?;
    f.seek(SeekFrom::Start(offset))?;
    let mut buf = Vec::with_capacity((len - offset).min(64 << 20) as usize);
    f.take(len - offset).read_to_end(&mut buf)?;
    carry.extend_from_slice(&buf);
    let mut out = Vec::new();
    let last_nl = carry.iter().rposition(|&b| b == b'\n');
    let Some(end) = last_nl else { return Ok(out) };
    for line in carry[..end].split(|&b| b == b'\n') {
        out.extend(parse_encounter(line));
    }
    carry.drain(..=end);
    Ok(out)
}

fn parse_encounter(line: &[u8]) -> Option<Encounter> {
    // o evento vem logo depois do timestamp: não precisa olhar a linha toda
    let head = &line[..line.len().min(64)];
    let pos = head.windows(10).position(|w| w == b"ENCOUNTER_")?;
    let rest = String::from_utf8_lossy(&line[pos..]);
    if rest.starts_with("ENCOUNTER_END") {
        Some(Encounter::End)
    } else if rest.starts_with("ENCOUNTER_START") {
        // ENCOUNTER_START,id,"nome",...
        let name = rest.split(',').nth(2).unwrap_or("").trim_matches('"').to_string();
        Some(Encounter::Start(name))
    } else {
        None
    }
}

fn analyze(app: &AppHandle, s: &Session, file: &Path, death_cutoff: u32, after_pull: bool) {
    set_status(app, s, |st| st.state = "analyzing".into());
    match crate::analyze_and_save(app, &file.display().to_string(), death_cutoff, |_, _| {}) {
        Ok(report) => {
            if after_pull {
                notify(app, &report);
            }
            let _ = app.emit("live-report", &report);
            set_status(app, s, |st| {
                st.state = "watching".into();
                st.encounter = None;
                st.message = None;
                if after_pull {
                    st.analyzed += 1;
                }
            });
        }
        Err(e) => set_status(app, s, |st| {
            st.state = "error".into();
            st.message = Some(e);
        }),
    }
}

/// Notificação do Windows com o resultado do pull, se o app não estiver em primeiro plano.
fn notify(app: &AppHandle, report: &wipe_core::LogReport) {
    let focused = app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
    let Some(p) = report.pulls.last() else { return };
    if focused {
        return;
    }
    let hp = p
        .bosses
        .iter()
        .filter_map(|b| if p.cutoff_t.is_some() { b.hp_pct_at_cutoff.or(b.hp_pct) } else { b.hp_pct })
        .fold(f32::INFINITY, f32::min);
    let title = if p.success {
        format!("Kill! {} {}", p.encounter_name, p.difficulty_name)
    } else if hp.is_finite() {
        format!("Wipe {} · {} {:.1}%", p.pull_number, p.encounter_name, hp)
    } else {
        format!("Wipe {} · {}", p.pull_number, p.encounter_name)
    };
    let body = match &p.trigger {
        Some(t) if !p.success => format!("Gatilho: {}", t.name),
        _ => "Abra o Wipe Cause para ver o pull.".into(),
    };
    let _ = app.notification().builder().title(title).body(body).show();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_complete_new_lines() {
        let path = std::env::temp_dir().join(format!("live-test-{}.txt", std::process::id()));
        let head = "9/28/2026 21:00:00.000-3  COMBAT_LOG_VERSION,22\n";
        std::fs::write(&path, head).unwrap();
        let mut carry = Vec::new();
        let mut offset = head.len() as u64;

        // linha do ENCOUNTER_START ainda pela metade: nada até completar
        let part = "9/28/2026 21:00:01.000-3  ENCOUNTER_START,3429,\"The Coiled";
        std::fs::write(&path, format!("{head}{part}")).unwrap();
        let len = std::fs::metadata(&path).unwrap().len();
        assert!(read_new(&path, offset, len, &mut carry).unwrap().is_empty());
        offset = len;

        let rest = " Altar\",16,20,3004\n9/28/2026 21:01:00.000-3  SPELL_DAMAGE,x\n9/28/2026 21:02:00.000-3  ENCOUNTER_END,3429,\"The Coiled Altar\",16,20,0,60000\n";
        std::fs::write(&path, format!("{head}{part}{rest}")).unwrap();
        let len = std::fs::metadata(&path).unwrap().len();
        let ev = read_new(&path, offset, len, &mut carry).unwrap();
        std::fs::remove_file(&path).ok();
        assert!(matches!(&ev[0], Encounter::Start(n) if n == "The Coiled Altar"));
        assert!(matches!(ev[1], Encounter::End));
        assert_eq!(ev.len(), 2);
        assert!(carry.is_empty());
    }
}
