//! "Ligar o ao vivo quando o WoW abrir": com o app fechado, abrir o WoW abre o Wipe Cause já
//! minimizado na bandeja e com o modo ao vivo ligado.
//!
//! O Windows não tem gatilho de "abriu tal programa", então algo precisa estar rodando: no boot
//! o Windows abre só um vigia leve — o mesmo executável com `--watch`, sem interface (sem
//! webview, poucos MB) — que olha a cada 5 s se o `Wow.exe` abriu. Quando abre:
//!   - app fechado: o vigia abre o app com `--tray` (escondido na bandeja);
//!   - app aberto: nada a fazer aqui.
//!
//! Em ambos os casos o próprio app, ao ver o WoW aberto, avisa a interface (`wow-started`) e
//! ela liga o ao vivo, sem abrir a janela.
//!
//! A inicialização com o Windows é a chave `Run` do usuário (HKCU), sem precisar de admin.

use serde_json::Value;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

/// App aberto pelo vigia (ou pelo boot antigo): começa escondido na bandeja.
pub const TRAY_ARG: &str = "--tray";
/// Só o vigia do WoW, sem interface.
pub const WATCH_ARG: &str = "--watch";
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "Wipe Cause";
/// Pasta de configuração do app (a mesma do Tauri: %APPDATA%\<identifier>).
const IDENTIFIER: &str = "gg.wipecause.app";
/// Executáveis do WoW (retail, PTR, beta).
const WOW_EXES: [&str; 3] = ["wow.exe", "wowt.exe", "wowb.exe"];
const CHECK_EVERY: Duration = Duration::from_secs(5);
/// Sem abrir janela de console a cada checagem.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn run(cmd: &str, args: &[&str]) -> Option<std::process::Output> {
    Command::new(cmd).args(args).creation_flags(CREATE_NO_WINDOW).output().ok()
}

/// Build de desenvolvimento (`target\debug` ou `target\release` do projeto): não vira o
/// programa que o Windows abre no boot.
fn is_dev_build(exe: &Path) -> bool {
    exe.components().any(|c| c.as_os_str().eq_ignore_ascii_case("target"))
}

/// Liga/desliga a inicialização com o Windows (o vigia).
fn set_run_key(enabled: bool) -> Result<(), String> {
    let out = if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let value = format!("\"{}\" {WATCH_ARG}", exe.display());
        run("reg", &["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &value, "/f"])
    } else {
        run("reg", &["delete", RUN_KEY, "/v", RUN_VALUE, "/f"])
    };
    match out {
        Some(o) if o.status.success() => Ok(()),
        // desligar o que já não existe não é erro
        Some(_) if !enabled => Ok(()),
        Some(o) => Err(format!("não foi possível configurar a inicialização com o Windows: {}", String::from_utf8_lossy(&o.stderr).trim())),
        None => Err("não foi possível configurar a inicialização com o Windows".into()),
    }
}

/// Nomes dos processos rodando (minúsculos), do `tasklist` em CSV ("Wow.exe","1234",...).
fn processes() -> Vec<String> {
    let Some(out) = run("tasklist", &["/FO", "CSV", "/NH"]) else { return Vec::new() };
    names_in(&String::from_utf8_lossy(&out.stdout))
}

fn names_in(csv: &str) -> Vec<String> {
    csv.lines().filter_map(|l| l.split(',').next()).map(|n| n.trim_matches('"').to_lowercase()).filter(|n| !n.is_empty()).collect()
}

fn wow_running(procs: &[String]) -> bool {
    procs.iter().any(|n| WOW_EXES.contains(&n.as_str()))
}

fn exe_name() -> Option<String> {
    Some(std::env::current_exe().ok()?.file_name()?.to_string_lossy().to_lowercase())
}

fn config_dir() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("APPDATA")?).join(IDENTIFIER))
}

/// A opção, lida direto do settings.json (o vigia não tem o Tauri).
fn option_on() -> bool {
    config_dir()
        .and_then(|d| std::fs::read_to_string(d.join("settings.json")).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .is_some_and(|v| v["open_with_wow"].as_bool() == Some(true))
}

/// O processo `pid` ainda é este programa?
fn alive(pid: u32) -> bool {
    let (Some(name), Some(out)) = (exe_name(), run("tasklist", &["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])) else { return false };
    names_in(&String::from_utf8_lossy(&out.stdout)).contains(&name)
}

fn pid_file() -> Option<PathBuf> {
    config_dir().map(|d| d.join("watch.pid"))
}

/// Já tem um vigia rodando?
fn watcher_running() -> bool {
    pid_file()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| s.trim().parse::<u32>().ok())
        .is_some_and(|pid| pid != std::process::id() && alive(pid))
}

/// O vigia (`--watch`): sem interface, até a opção ser desligada.
pub fn run_watcher() {
    if watcher_running() {
        return;
    }
    let Some(pid) = pid_file() else { return };
    let _ = std::fs::write(&pid, std::process::id().to_string());
    let (Ok(exe), Some(name)) = (std::env::current_exe(), exe_name()) else { return };
    let mut was_running = false;
    loop {
        std::thread::sleep(CHECK_EVERY);
        if !option_on() {
            let _ = std::fs::remove_file(&pid);
            return;
        }
        let procs = processes();
        let running = wow_running(&procs);
        // o vigia é um dos processos com este nome: mais de um = o app está aberto
        let app_open = procs.iter().filter(|n| **n == name).count() > 1;
        if running && !was_running && !app_open {
            let _ = Command::new(&exe).arg(TRAY_ARG).spawn();
        }
        was_running = running;
    }
}

/// Opção ligada e nenhum vigia rodando (acabou de ligar, sem reiniciar o PC): começa um agora.
fn ensure_watcher() {
    let Ok(exe) = std::env::current_exe() else { return };
    if option_on() && !is_dev_build(&exe) && !watcher_running() {
        let _ = Command::new(exe).arg(WATCH_ARG).spawn();
    }
}

#[tauri::command]
pub fn startup_get(app: AppHandle) -> bool {
    crate::settings::load(&app).open_with_wow
}

#[tauri::command]
pub fn startup_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    // build de teste: guarda a opção, mas o boot continua com o app instalado
    if !std::env::current_exe().is_ok_and(|e| is_dev_build(&e)) {
        set_run_key(enabled)?;
    }
    crate::settings::update(&app, |s| s.open_with_wow = enabled)?;
    // desligar: o vigia lê a opção e sai sozinho
    ensure_watcher();
    Ok(())
}

/// Ao abrir o app com a opção ligada: a entrada do boot aponta para o vigia deste executável
/// (conserta a de outra instalação, de uma pasta antiga ou da versão que abria o app inteiro)
/// e o vigia fica rodando, para o próximo WoW depois que o app for fechado.
pub fn repair(app: &AppHandle) {
    let Ok(exe) = std::env::current_exe() else { return };
    if crate::settings::load(app).open_with_wow && !is_dev_build(&exe) {
        let _ = set_run_key(true);
        ensure_watcher();
    }
}

/// Dentro do app: quando o WoW abre (ou já está aberto quando o app abre) e a opção está
/// ligada, a interface liga o ao vivo — sem abrir a janela.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut was_running = false;
        loop {
            std::thread::sleep(CHECK_EVERY);
            if !crate::settings::load(&app).open_with_wow {
                was_running = false;
                continue;
            }
            let running = wow_running(&processes());
            if running && !was_running {
                let _ = app.emit("wow-started", ());
                let _ = app
                    .notification()
                    .builder()
                    .title("Wipe Cause: ao vivo ligado")
                    .body("O WoW abriu: cada pull vai ser analisado assim que terminar. O app fica na bandeja, perto do relógio.")
                    .show();
            }
            was_running = running;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_builds_do_not_register_for_boot() {
        assert!(is_dev_build(Path::new(r"F:\Projetos\wipe-cause\target\release\wipe-cause-app.exe")));
        assert!(!is_dev_build(Path::new(r"C:\Users\x\AppData\Local\Wipe Cause\wipe-cause-app.exe")));
    }

    #[test]
    fn finds_wow_in_tasklist_csv() {
        let procs = names_in("\"explorer.exe\",\"1\",\"Console\",\"1\",\"10 K\"\r\n\"Wow.exe\",\"2\",\"Console\",\"1\",\"3 GB\"");
        assert!(wow_running(&procs));
        assert!(!wow_running(&names_in("\"explorer.exe\",\"1\",\"Console\",\"1\",\"10 K\"")));
    }
}
