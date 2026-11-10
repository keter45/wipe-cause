// Link de visualização: o próprio app (a mesma interface) servido deste PC, só para ver.
//
// Um servidor HTTP em 127.0.0.1 serve a interface embutida no app e uma rota `/api/invoke` que
// responde só aos comandos de leitura (histórico, replay de um pull da lista, regras, árvore de
// talentos, simulações salvas). Um túnel rápido do Cloudflare (`cloudflared`, baixado na primeira
// vez, sem conta) dá um endereço público https para o servidor. O link leva uma chave aleatória
// (`?k=`); sem ela a API não responde. Só funciona enquanto o app estiver aberto.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Request, Response, Server};
use wipe_core::i18n::pick;

use crate::{history, rule_tuning, simc, talents, wcl_source};

/// Comandos que o visitante pode chamar: todos só leem.
const READ_ONLY: &[&str] = &["live_status", "history_list", "history_load", "history_trends", "fight_replay", "rules_get", "talent_tree", "simc_saved_get", "fetch_image"];

struct Running {
    server: Arc<Server>,
    port: u16,
    key: String,
    tunnel: Option<Child>,
    url: Option<String>,
    error: Option<String>,
}

static STATE: Mutex<Option<Running>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareStatus {
    active: bool,
    /// link público (túnel) com a chave
    url: Option<String>,
    /// o mesmo link neste PC (funciona mesmo se o túnel cair)
    local_url: Option<String>,
    error: Option<String>,
}

fn status_of(state: &mut Option<Running>) -> ShareStatus {
    let Some(r) = state.as_mut() else {
        return ShareStatus { active: false, url: None, local_url: None, error: None };
    };
    // o túnel caiu: o link público para de funcionar
    if let Some(child) = r.tunnel.as_mut() {
        if let Ok(Some(_)) = child.try_wait() {
            r.tunnel = None;
            r.url = None;
            r.error = Some(pick(String::from("o túnel do Cloudflare caiu; desligue e ligue o link de novo"), String::from("the Cloudflare tunnel stopped; turn the link off and on again")));
        }
    }
    ShareStatus {
        active: true,
        url: r.url.as_ref().map(|u| format!("{u}/?k={}", r.key)),
        local_url: Some(format!("http://127.0.0.1:{}/?k={}", r.port, r.key)),
        error: r.error.clone(),
    }
}

#[tauri::command]
pub fn share_status() -> ShareStatus {
    status_of(&mut STATE.lock().unwrap_or_else(|e| e.into_inner()))
}

/// Liga o servidor e o túnel. Demora na primeira vez (baixa o cloudflared, ~60 MB).
#[tauri::command]
pub async fn share_start(app: AppHandle) -> Result<ShareStatus, String> {
    if !crate::settings::load(&app).experimental {
        return Err(pick(String::from("o link de visualização é experimental: destrave em Configurações → Sobre"), String::from("the viewing link is experimental: unlock it in Settings → About")));
    }
    tauri::async_runtime::spawn_blocking(move || start(&app, true)).await.map_err(|e| e.to_string())?
}

/// Recursos experimentais ligados neste PC?
#[tauri::command]
pub fn experimental_get(app: AppHandle) -> bool {
    crate::settings::load(&app).experimental
}

/// Liga ou desliga os recursos experimentais; desligar também derruba o link.
#[tauri::command]
pub fn experimental_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    crate::settings::update(&app, |s| s.experimental = enabled)?;
    if !enabled {
        stop();
    }
    Ok(())
}

#[tauri::command]
pub fn share_stop() {
    stop();
}

/// Desenvolvimento: `WIPE_DEV_SHARE=1` liga o link ao abrir o app, só neste PC (sem túnel; com
/// `=tunnel`, também pelo Cloudflare), e
/// escreve o endereço no terminal.
pub fn dev_autostart(app: &AppHandle) {
    if !cfg!(debug_assertions) || std::env::var_os("WIPE_DEV_SHARE").is_none() {
        return;
    }
    let app = app.clone();
    // `WIPE_DEV_SHARE=tunnel` abre também o túnel do Cloudflare
    let tunnel = std::env::var("WIPE_DEV_SHARE").is_ok_and(|v| v == "tunnel");
    std::thread::spawn(move || match start(&app, tunnel) {
        Ok(s) => eprintln!("WIPE_DEV_SHARE {} {} {}", s.local_url.unwrap_or_default(), s.url.unwrap_or_default(), s.error.unwrap_or_default()), // i18n-ignore: só no terminal de desenvolvimento
        Err(e) => eprintln!("WIPE_DEV_SHARE error: {e}"), // i18n-ignore: só no terminal de desenvolvimento
    });
}

/// Desliga tudo (também ao sair do app, para o túnel não ficar órfão).
pub fn stop() {
    if let Some(mut r) = STATE.lock().unwrap_or_else(|e| e.into_inner()).take() {
        r.server.unblock();
        if let Some(mut c) = r.tunnel.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

fn start(app: &AppHandle, tunnel: bool) -> Result<ShareStatus, String> {
    {
        let mut st = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if st.as_ref().is_some_and(|r| r.url.is_some()) {
            return Ok(status_of(&mut st));
        }
    }
    stop();
    let server = Arc::new(Server::http("127.0.0.1:0").map_err(|e| e.to_string())?);
    let port = server.server_addr().to_ip().map(|a| a.port()).ok_or("no port")?; // i18n-ignore: não é texto para o usuário
    let key = random_key()?;
    {
        let (server, app, key) = (server.clone(), app.clone(), key.clone());
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                let (app, key) = (app.clone(), key.clone());
                std::thread::spawn(move || handle(&app, &key, req));
            }
        });
    }
    *STATE.lock().unwrap_or_else(|e| e.into_inner()) = Some(Running { server, port, key, tunnel: None, url: None, error: None });

    if !tunnel {
        return Ok(share_status());
    }
    let tunnel = cloudflared(app).and_then(|exe| open_tunnel(&exe, port));
    let mut st = STATE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(r) = st.as_mut() {
        match tunnel {
            Ok((child, url)) => {
                r.tunnel = Some(child);
                r.url = Some(url);
            }
            // sem túnel o link deste PC continua valendo
            Err(e) => r.error = Some(e),
        }
    }
    Ok(status_of(&mut st))
}

/// Chave curta do link: 12 letras e números (~71 bits), o bastante para ninguém adivinhar.
fn random_key() -> Result<String, String> {
    const ABC: &[u8] = b"abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut key = String::new();
    while key.len() < 12 {
        let mut b = [0u8; 16];
        getrandom::fill(&mut b).map_err(|e| e.to_string())?;
        // descarta o que daria viés no módulo
        let limit = 256 - 256 % ABC.len();
        key.extend(b.iter().filter(|&&x| (x as usize) < limit).map(|&x| ABC[x as usize % ABC.len()] as char));
    }
    key.truncate(12);
    Ok(key)
}

// ---------------------------------------------------------------- cloudflared

#[cfg(windows)]
const CLOUDFLARED: (&str, &str) = ("cloudflared.exe", "cloudflared-windows-amd64.exe");
#[cfg(not(windows))]
const CLOUDFLARED: (&str, &str) = ("cloudflared", "cloudflared-linux-amd64");

/// O executável do cloudflared: o instalado no sistema, senão o baixado para a pasta do app.
fn cloudflared(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("cloudflared");
    let exe = dir.join(CLOUDFLARED.0);
    if exe.exists() {
        return Ok(exe);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let url = format!("https://github.com/cloudflare/cloudflared/releases/latest/download/{}", CLOUDFLARED.1); // i18n-ignore: não é texto para o usuário
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(300)).build();
    let resp = agent.get(&url).call().map_err(|e| pick(format!("não foi possível baixar o cloudflared: {e}"), format!("could not download cloudflared: {e}")))?;
    let tmp = dir.join("download.part");
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    std::io::copy(&mut resp.into_reader().take(200 * 1024 * 1024), &mut file).map_err(|e| e.to_string())?;
    drop(file);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
    }
    std::fs::rename(&tmp, &exe).map_err(|e| e.to_string())?;
    Ok(exe)
}

/// Abre o túnel rápido (trycloudflare.com) e espera o endereço aparecer no log do cloudflared.
fn open_tunnel(exe: &PathBuf, port: u16) -> Result<(Child, String), String> {
    let mut cmd = Command::new(exe);
    cmd.args(["tunnel", "--no-autoupdate", "--url", &format!("http://127.0.0.1:{port}")]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()); // i18n-ignore: não é texto para o usuário
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| pick(format!("não foi possível abrir o cloudflared: {e}"), format!("could not start cloudflared: {e}")))?;
    #[cfg(windows)]
    die_with_app(&child);
    let stderr = child.stderr.take().ok_or("no stderr")?; // i18n-ignore: não é texto para o usuário
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut tx = Some(tx);
        // continua lendo depois do endereço, para o cloudflared não travar com o pipe cheio
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(url) = tunnel_url(&line) {
                if let Some(tx) = tx.take() {
                    let _ = tx.send(url);
                }
            }
        }
    });
    match rx.recv_timeout(Duration::from_secs(40)) {
        Ok(url) => Ok((child, url)),
        Err(_) => {
            let _ = child.kill();
            Err(pick(String::from("o túnel do Cloudflare não respondeu; tente de novo"), String::from("the Cloudflare tunnel did not answer; try again")))
        }
    }
}

/// Põe o cloudflared num Job Object que o Windows fecha quando o app termina, mesmo se o app cair
/// ou for fechado à força: o túnel nunca fica rodando sozinho.
#[cfg(windows)]
fn die_with_app(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
    static JOB: OnceLock<usize> = OnceLock::new();
    // o handle do job fica aberto até o app sair; aí o Windows encerra os processos dele
    let job = *JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of_val(&info) as u32);
        job as usize
    });
    if job != 0 {
        unsafe { AssignProcessToJobObject(job as _, child.as_raw_handle() as _) };
    }
}

fn tunnel_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let url: String = line[start..].chars().take_while(|c| c.is_ascii_alphanumeric() || "-.:/".contains(*c)).collect();
    (url.ends_with(".trycloudflare.com") && url != "https://api.trycloudflare.com").then_some(url) // i18n-ignore: não é texto para o usuário
}

// ---------------------------------------------------------------- HTTP

fn header(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("valid header")
}

fn handle(app: &AppHandle, key: &str, mut req: Request) {
    let url = req.url().split('?').next().unwrap_or("/").to_string();
    if url == "/api/invoke" {
        let ok = req.headers().iter().any(|h| h.field.equiv("x-wipe-key") && h.value.as_str() == key);
        let gzip = req.headers().iter().any(|h| h.field.equiv("accept-encoding") && h.value.as_str().contains("gzip"));
        if !ok || req.method() != &tiny_http::Method::Post {
            let _ = req.respond(Response::from_string("forbidden").with_status_code(403));
            return;
        }
        let mut body = String::new();
        let _ = req.as_reader().take(1024 * 1024).read_to_string(&mut body);
        let (status, text) = match serde_json::from_str::<Value>(&body).map_err(|e| e.to_string()).and_then(|v| invoke(app, &v)) {
            Ok(v) => (200, v.to_string()),
            Err(e) => (400, Value::String(e).to_string()),
        };
        let _ = req.respond(bytes_response(text.into_bytes(), "application/json", status, gzip));
        return;
    }
    let full = req.url().to_string();
    let _ = match asset(app, &full) {
        Some((bytes, mime)) => req.respond(bytes_response(bytes, &mime, 200, false)),
        None => req.respond(Response::from_string("not found").with_status_code(404)),
    };
}

fn bytes_response(bytes: Vec<u8>, mime: &str, status: u16, gzip: bool) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut extra = vec![header("Cache-Control", "no-store"), header("X-Content-Type-Options", "nosniff"), header("Referrer-Policy", "no-referrer")]; // i18n-ignore: não é texto para o usuário
    let bytes = if gzip && bytes.len() > 16 * 1024 {
        use flate2::{write::GzEncoder, Compression};
        use std::io::Write;
        let mut enc = GzEncoder::new(Vec::new(), Compression::fast());
        if enc.write_all(&bytes).is_ok() {
            extra.push(header("Content-Encoding", "gzip"));
            enc.finish().unwrap_or(bytes)
        } else {
            bytes
        }
    } else {
        bytes
    };
    let mut r = Response::from_data(bytes).with_status_code(status).with_header(header("Content-Type", mime));
    for h in extra {
        r.add_header(h);
    }
    r
}

/// A interface embutida no app (no `tauri dev`, pega do servidor do Vite).
fn asset(app: &AppHandle, full: &str) -> Option<(Vec<u8>, String)> {
    let url = full.split('?').next().unwrap_or("/");
    let path = if url == "/" { "/index.html" } else { url };
    if path.contains("..") {
        return None;
    }
    // `tauri dev`: a interface atual vem do Vite (a embutida pode ser de um build antigo)
    if tauri::is_dev() {
        if let Some(found) = vite(app, full) {
            return Some(found);
        }
    }
    let resolver = app.asset_resolver();
    // rota da SPA (sem extensão): a página
    let found = resolver.get(path.to_string()).or_else(|| (!path.rsplit('/').next().unwrap_or("").contains('.')).then(|| resolver.get("/index.html".into())).flatten());
    found.map(|a| (a.bytes, a.mime_type))
}

fn vite(app: &AppHandle, full: &str) -> Option<(Vec<u8>, String)> {
    let dev = app.config().build.dev_url.clone()?;
    // o Vite precisa da query (`?v=`, `?url`, `?import`)
    let r = ureq::get(dev.join(full.trim_start_matches('/')).ok()?.as_str()).call().ok()?;
    let mime = r.content_type().to_string();
    let mut data = Vec::new();
    r.into_reader().take(64 * 1024 * 1024).read_to_end(&mut data).ok()?;
    Some((data, mime))
}

// ---------------------------------------------------------------- comandos

fn invoke(app: &AppHandle, body: &Value) -> Result<Value, String> {
    let cmd = body.get("cmd").and_then(Value::as_str).unwrap_or("");
    let args = body.get("args").cloned().unwrap_or(Value::Null);
    if !READ_ONLY.contains(&cmd) {
        return Err(pick(String::from("link só para ver: isso só funciona no app de quem compartilhou"), String::from("view-only link: this only works in the sharer's app")));
    }
    let s = |k: &str| args.get(k).and_then(Value::as_str).map(str::to_string).ok_or_else(|| format!("missing {k}"));
    let n = |k: &str| args.get(k).and_then(Value::as_u64).ok_or_else(|| format!("missing {k}"));
    use tauri::async_runtime::block_on as block;
    let app = app.clone();
    match cmd {
        "live_status" => json(Ok(crate::live::live_status())),
        "history_list" => json(history::history_list(app)),
        "history_load" => history::history_load(app, s("id")?),
        "history_trends" => json(block(history::history_trends(app))),
        "fight_replay" => {
            let path = s("path")?;
            if !replay_allowed(&app, &path) {
                return Err("not allowed".into());
            }
            let tz = args.get("tzHours").and_then(Value::as_f64);
            json(block(crate::fight_replay(app, path, n("offset")?, tz)))
        }
        "rules_get" => json(Ok(rule_tuning::rules_get(app, n("encounterId")? as u32, s("name").unwrap_or_default()))),
        "talent_tree" => json(block(talents::talent_tree(app, n("specId")? as u32))),
        "simc_saved_get" => json(simc::simc_saved_get(app, s("key")?)),
        "fetch_image" => json(block(crate::fetch_image(s("url")?))),
        _ => Err("unknown command".into()),
    }
}

fn json<T: Serialize>(v: Result<T, String>) -> Result<Value, String> {
    v.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}

/// O replay relê o log: só combat logs (pelo nome do arquivo) ou reports do Warcraft Logs que já
/// estão no histórico (o login do WCL é de quem compartilhou).
fn replay_allowed(app: &AppHandle, path: &str) -> bool {
    let codes = wcl_source::codes_of(path);
    if codes.is_empty() {
        let name = std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        return name.starts_with("wowcombatlog") && name.ends_with(".txt");
    }
    let known: Vec<String> = history::history_list(app.clone()).unwrap_or_default().iter().flat_map(|e| wcl_source::codes_of(&e.log_path).into_iter().map(str::to_string).collect::<Vec<_>>()).collect();
    codes.iter().all(|c| known.iter().any(|k| k == c))
}
