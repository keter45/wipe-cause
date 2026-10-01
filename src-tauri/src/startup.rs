//! "Abrir o Wipe Cause quando o WoW abrir": o Windows não tem gatilho de "abriu tal programa",
//! então o app inicia com o Windows escondido na bandeja (`--tray`) e olha a cada poucos
//! segundos se o `Wow.exe` está rodando; quando o WoW abre, a janela aparece.
//!
//! A inicialização com o Windows é a chave `Run` do usuário (HKCU), sem precisar de admin.

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::Duration;
use tauri::AppHandle;

/// Argumento da inicialização com o Windows: começa escondido na bandeja.
pub const TRAY_ARG: &str = "--tray";
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "Wipe Cause";
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
fn is_dev_build(exe: &std::path::Path) -> bool {
    exe.components().any(|c| c.as_os_str().eq_ignore_ascii_case("target"))
}

/// Liga/desliga a inicialização com o Windows (na bandeja).
fn set_run_key(enabled: bool) -> Result<(), String> {
    let out = if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let value = format!("\"{}\" {TRAY_ARG}", exe.display());
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

/// O WoW está aberto? (`tasklist` em CSV: "Wow.exe","1234",...)
fn wow_running() -> bool {
    let Some(out) = run("tasklist", &["/FO", "CSV", "/NH"]) else { return false };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.split(',').next())
        .any(|name| WOW_EXES.contains(&name.trim_matches('"').to_lowercase().as_str()))
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
    crate::settings::update(&app, |s| s.open_with_wow = enabled)
}

/// Com a opção ligada, a entrada do boot aponta para este executável: conserta a que ficou de
/// outra instalação, de uma pasta antiga ou de um build de teste.
pub fn repair_run_key(app: &AppHandle) {
    let Ok(exe) = std::env::current_exe() else { return };
    if crate::settings::load(app).open_with_wow && !is_dev_build(&exe) {
        let _ = set_run_key(true);
    }
}

/// Vigia o WoW em segundo plano: quando ele abre (e a opção está ligada), mostra a janela. O
/// WoW já aberto quando o app inicia também conta (app aberto depois do jogo).
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut was_running = false;
        loop {
            std::thread::sleep(CHECK_EVERY);
            if !crate::settings::load(&app).open_with_wow {
                was_running = false;
                continue;
            }
            let running = wow_running();
            if running && !was_running {
                crate::tray::show(&app);
            }
            was_running = running;
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn dev_builds_do_not_register_for_boot() {
        assert!(super::is_dev_build(std::path::Path::new(r"F:\Projetos\wipe-cause\target\release\wipe-cause-app.exe")));
        assert!(!super::is_dev_build(std::path::Path::new(r"C:\Users\x\AppData\Local\Wipe Cause\wipe-cause-app.exe")));
    }

    #[test]
    fn finds_wow_in_tasklist_csv() {
        let csv = "\"explorer.exe\",\"1\",\"Console\",\"1\",\"10 K\"\r\n\"Wow.exe\",\"2\",\"Console\",\"1\",\"3 GB\"";
        let found = csv.lines().filter_map(|l| l.split(',').next()).any(|n| super::WOW_EXES.contains(&n.trim_matches('"').to_lowercase().as_str()));
        assert!(found);
    }
}
