// Sem janela de console no build de release no Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // vigia do WoW ("ligar o ao vivo quando o WoW abrir"): sem interface
    if std::env::args().any(|a| a == wipe_cause_lib::startup::WATCH_ARG) {
        wipe_cause_lib::startup::run_watcher();
        return;
    }
    wipe_cause_lib::run()
}
