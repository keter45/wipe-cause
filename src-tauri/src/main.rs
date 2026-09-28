// Sem janela de console no build de release no Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    wipe_cause_lib::run()
}
