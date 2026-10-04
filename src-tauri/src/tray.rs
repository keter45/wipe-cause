//! Ícone na bandeja: fechar a janela só esconde o app (o ao vivo e o ao vivo automático
//! continuam rodando). Clique no ícone reabre; "Sair" no menu do ícone fecha de verdade.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use wipe_core::i18n::pick;

/// O aviso "continua na bandeja" aparece só na primeira vez da sessão.
static WARNED: AtomicBool = AtomicBool::new(false);

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let (open_label, quit_label) = labels();
    let open = MenuItem::with_id(app, "open", open_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    app.manage(TrayItems { open: open.clone(), quit: quit.clone() });
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Wipe Cause")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Itens do menu do ícone, para trocar o texto quando o idioma muda.
struct TrayItems {
    open: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

fn labels() -> (String, String) {
    (pick("Abrir o Wipe Cause", "Open Wipe Cause"), pick("Sair", "Quit"))
}

/// Idioma mudou: menu do ícone no idioma novo.
pub fn relabel(app: &AppHandle) {
    if let Some(items) = app.try_state::<TrayItems>() {
        let (open, quit) = labels();
        let _ = items.open.set_text(open);
        let _ = items.quit.set_text(quit);
    }
}

/// Traz a janela de volta (mesmo minimizada ou escondida).
pub fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Fechar (X) esconde na bandeja em vez de encerrar.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
        if !WARNED.swap(true, Ordering::Relaxed) {
            let _ = window
                .app_handle()
                .notification()
                .builder()
                .title(pick("O Wipe Cause continua aberto", "Wipe Cause is still open"))
                .body(pick("Ele fica na bandeja (perto do relógio). Para fechar de vez, clique com o botão direito no ícone e escolha Sair.", "It stays in the tray (near the clock). To close it for good, right-click the icon and choose Quit."))
                .show();
        }
    }
}
