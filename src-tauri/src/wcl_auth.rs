//! Entrar com a conta do Warcraft Logs (OAuth 2 + PKCE): sem client/secret para cadastrar.
//!
//! O app abre a página de autorização do Warcraft Logs no navegador; o site volta para
//! `http://127.0.0.1:47813/callback` (servidor local de uma requisição só) com um código, que
//! vira o token do usuário. Com ele, a API mostra os reports que a pessoa vê no site —
//! inclusive os não listados e privados das guildas dela. Token e perfil ficam no cofre de
//! credenciais do sistema.

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// Client público do Wipe Cause no Warcraft Logs (o id não é segredo; PKCE dispensa o secret).
/// `WIPE_WCL_CLIENT_ID` troca em tempo de execução (desenvolvimento).
const CLIENT_ID: &str = "01a0f443-ee6e-716a-8671-bd4e73b7df36";
const AUTHORIZE_URL: &str = "https://www.warcraftlogs.com/oauth/authorize";
const TOKEN_URL: &str = "https://www.warcraftlogs.com/oauth/token";
pub const USER_API: &str = "https://www.warcraftlogs.com/api/v2/user";
const PORT: u16 = 47813;
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

const KEYRING_SERVICE: &str = "wipe-cause";
const SESSION_KEY: &str = "wcl-user-session";
const PROFILE_KEY: &str = "wcl-user-profile";

pub fn client_id() -> Option<String> {
    std::env::var("WIPE_WCL_CLIENT_ID").ok().filter(|v| !v.is_empty()).or_else(|| Some(CLIENT_ID.to_string()).filter(|v| !v.is_empty()))
}

fn redirect_uri() -> String {
    format!("http://127.0.0.1:{PORT}/callback")
}

#[derive(Serialize, Deserialize)]
struct Session {
    access_token: String,
    refresh_token: Option<String>,
    /// epoch ms
    expires_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WclGuild {
    pub id: i64,
    pub name: String,
    pub server_slug: String,
    pub server_name: String,
    pub region: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WclUser {
    pub id: i64,
    pub name: String,
    pub guilds: Vec<WclGuild>,
}

fn entry(name: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, name).ok()
}

/// O cofre do Windows aceita ~1280 caracteres por credencial e o token do Warcraft Logs (JWT)
/// passa disso: o valor vai em pedaços (`nome#0`, `nome#1`, ...) e `nome` guarda quantos são.
const CHUNK: usize = 1000;

fn set_secret(name: &str, value: &str) -> Result<(), String> {
    let chars: Vec<char> = value.chars().collect();
    let parts: Vec<String> = chars.chunks(CHUNK).map(|c| c.iter().collect()).collect();
    for (i, part) in parts.iter().enumerate() {
        entry(&format!("{name}#{i}")).ok_or("cofre de credenciais indisponível")?.set_password(part).map_err(|e| e.to_string())?;
    }
    entry(name).ok_or("cofre de credenciais indisponível")?.set_password(&parts.len().to_string()).map_err(|e| e.to_string())
}

fn get_secret(name: &str) -> Option<String> {
    let n: usize = entry(name)?.get_password().ok()?.parse().ok()?;
    (0..n).map(|i| entry(&format!("{name}#{i}"))?.get_password().ok()).collect()
}

fn delete_secret(name: &str) {
    let n: usize = entry(name).and_then(|e| e.get_password().ok()).and_then(|v| v.parse().ok()).unwrap_or(0);
    for i in 0..n {
        if let Some(e) = entry(&format!("{name}#{i}")) {
            let _ = e.delete_credential();
        }
    }
    if let Some(e) = entry(name) {
        let _ = e.delete_credential();
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random(n: usize) -> Result<String, String> {
    let mut buf = vec![0u8; n];
    getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
    Ok(b64url(&buf))
}

/// Percent-encoding de um valor de query string.
fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| {
            // o que o WCL devolve é base64url/alfanumérico; só decodifica %XX
            let mut out = Vec::new();
            let b = v.as_bytes();
            let mut i = 0;
            while i < b.len() {
                if b[i] == b'%' && i + 2 < b.len() {
                    if let Ok(x) = u8::from_str_radix(&v[i + 1..i + 3], 16) {
                        out.push(x);
                        i += 3;
                        continue;
                    }
                }
                out.push(if b[i] == b'+' { b' ' } else { b[i] });
                i += 1;
            }
            String::from_utf8_lossy(&out).into_owned()
        })
    })
}

fn save_session(json: &serde_json::Value, old_refresh: Option<String>) -> Result<Session, String> {
    let access_token = json["access_token"].as_str().ok_or("O Warcraft Logs não devolveu o token.")?.to_string();
    let secs = json["expires_in"].as_i64().unwrap_or(3600);
    let s = Session {
        access_token,
        refresh_token: json["refresh_token"].as_str().map(str::to_string).or(old_refresh),
        expires_at: now_ms() + secs * 1000,
    };
    let text = serde_json::to_string(&s).map_err(|e| e.to_string())?;
    set_secret(SESSION_KEY, &text).map_err(|e| format!("não foi possível guardar o login: {e}"))?;
    Ok(s)
}

fn post_token(form: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    match ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).build().post(TOKEN_URL).send_form(form) {
        Ok(r) => r.into_json().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, r)) => {
            // OAuth: {"error", "error_description", "hint"}; o hint diz qual parâmetro faltou
            let body = r.into_string().unwrap_or_default();
            let json: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
            let detail = match (json["error"].as_str(), json["hint"].as_str()) {
                (Some(e), Some(h)) if !h.is_empty() => format!("{e}: {h}"),
                (Some(e), _) => format!("{e}: {}", json["error_description"].as_str().unwrap_or("")),
                _ => body.chars().take(400).collect(),
            };
            Err(format!("O Warcraft Logs recusou o login ({code}): {detail}"))
        }
        Err(e) => Err(format!("Sem conexão com o Warcraft Logs: {e}")),
    }
}

/// Token do usuário logado (renovado se estiver para vencer). `None` = ninguém logado.
pub fn user_token() -> Option<String> {
    let s: Session = serde_json::from_str(&get_secret(SESSION_KEY)?).ok()?;
    if s.expires_at - now_ms() > 60_000 {
        return Some(s.access_token);
    }
    let (id, refresh) = (client_id()?, s.refresh_token.clone()?);
    let json = post_token(&[("grant_type", "refresh_token"), ("client_id", &id), ("refresh_token", &refresh)]).ok()?;
    save_session(&json, Some(refresh)).ok().map(|s| s.access_token)
}

/// Sessão recusada pela API (revogada): esquece o login.
pub fn forget_session() {
    delete_secret(SESSION_KEY);
}

const PROFILE_QUERY: &str = "query { userData { currentUser { id name guilds { id name server { slug name region { slug } } } } } }";

fn fetch_profile(token: &str) -> Result<WclUser, String> {
    let data = crate::wcl::post_graphql(USER_API, token, PROFILE_QUERY, &serde_json::json!({}))?;
    let u = &data["userData"]["currentUser"];
    let guilds = u["guilds"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|g| WclGuild {
            id: g["id"].as_i64().unwrap_or(0),
            name: g["name"].as_str().unwrap_or("").to_string(),
            server_slug: g["server"]["slug"].as_str().unwrap_or("").to_string(),
            server_name: g["server"]["name"].as_str().unwrap_or("").to_string(),
            region: g["server"]["region"]["slug"].as_str().unwrap_or("").to_uppercase(),
        })
        .collect();
    Ok(WclUser { id: u["id"].as_i64().unwrap_or(0), name: u["name"].as_str().unwrap_or("").to_string(), guilds })
}

/// Espera o navegador voltar em /callback e devolve a query string.
fn wait_callback(listener: &TcpListener) -> Result<(TcpStream, String), String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let mut line = String::new();
                BufReader::new(&stream).read_line(&mut line).map_err(|e| e.to_string())?;
                // "GET /callback?code=...&state=... HTTP/1.1"
                let target = line.split_whitespace().nth(1).unwrap_or("");
                let Some(query) = target.strip_prefix("/callback?") else {
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                    continue;
                };
                return Ok((stream, query.to_string()));
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("O login não foi concluído a tempo. Tente de novo.".into());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn login(app: &AppHandle) -> Result<WclUser, String> {
    let id = client_id().ok_or("Esta versão do app ainda não tem o login do Warcraft Logs configurado.")?;
    let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|_| format!("A porta {PORT} está ocupada (outro login aberto?). Feche e tente de novo."))?;
    let verifier = random(48)?;
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let state = random(16)?;
    let url = format!(
        "{AUTHORIZE_URL}?client_id={}&redirect_uri={}&response_type=code&scope=view-user-profile%20view-private-reports&code_challenge={challenge}&code_challenge_method=S256&state={state}",
        enc(&id),
        enc(&redirect_uri()),
    );
    app.opener().open_url(&url, None::<&str>).map_err(|e| format!("não foi possível abrir o navegador: {e}"))?;

    let (mut stream, query) = wait_callback(&listener)?;
    // a aba do navegador só responde depois da troca do código: mostra o resultado de verdade
    let result = finish_login(&id, &verifier, &state, &query);
    let (title, text) = match &result {
        Ok(u) => (format!("Pronto, você entrou como {}.", html_escape(&u.name)), "Pode fechar esta aba e voltar ao Wipe Cause.".to_string()),
        Err(e) => ("Não foi possível entrar.".to_string(), html_escape(e)),
    };
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>Wipe Cause</title><body style=\"font-family:system-ui;background:#0f1115;color:#e6e8ee;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center;max-width:560px;padding:16px\"><h2>{title}</h2><p style=\"color:#8b93a5\">{text}</p></div>"
    );
    let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes());
    result
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Confere a resposta do navegador, troca o código pelo token e busca o perfil.
fn finish_login(id: &str, verifier: &str, state: &str, query: &str) -> Result<WclUser, String> {
    if query_param(query, "state").as_deref() != Some(state) {
        return Err("Resposta de login inválida (state não confere).".into());
    }
    if let Some(err) = query_param(query, "error") {
        return Err(if err == "access_denied" { "Login cancelado no Warcraft Logs.".into() } else { format!("O Warcraft Logs recusou o login: {err}") });
    }
    let code = query_param(query, "code").ok_or("O Warcraft Logs não devolveu o código de login.")?;
    let redirect = redirect_uri();
    let json = post_token(&[
        ("grant_type", "authorization_code"),
        ("client_id", id),
        ("code_verifier", verifier),
        ("redirect_uri", &redirect),
        ("code", &code),
    ])?;
    let session = save_session(&json, None)?;
    let user = fetch_profile(&session.access_token)?;
    if let Ok(text) = serde_json::to_string(&user) {
        let _ = set_secret(PROFILE_KEY, &text);
    }
    Ok(user)
}

#[tauri::command]
pub async fn wcl_login(app: AppHandle) -> Result<WclUser, String> {
    tauri::async_runtime::spawn_blocking(move || login(&app)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn wcl_logout() {
    forget_session();
    delete_secret(PROFILE_KEY);
}

/// Usuário logado (do cofre; não consulta a API).
pub fn saved_user() -> Option<WclUser> {
    get_secret(SESSION_KEY)?;
    serde_json::from_str(&get_secret(PROFILE_KEY)?).ok()
}

/// Atualiza as guildas do usuário logado (ex.: entrou numa guilda nova).
#[tauri::command]
pub async fn wcl_refresh_user() -> Result<Option<WclUser>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(token) = user_token() else { return Ok(None) };
        let user = fetch_profile(&token)?;
        if let Ok(text) = serde_json::to_string(&user) {
            let _ = set_secret(PROFILE_KEY, &text);
        }
        Ok(Some(user))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_and_callback_parsing() {
        // exemplo da RFC 7636
        assert_eq!(b64url(&Sha256::digest(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert_eq!(enc("http://127.0.0.1:47813/callback"), "http%3A%2F%2F127.0.0.1%3A47813%2Fcallback");
        let q = "code=abc%2Fdef&state=xyz";
        assert_eq!(query_param(q, "code").as_deref(), Some("abc/def"));
        assert_eq!(query_param(q, "state").as_deref(), Some("xyz"));
        assert_eq!(query_param(q, "error"), None);
    }
}
