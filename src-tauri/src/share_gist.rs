// Link fixo do link de visualização: o endereço do túnel muda a cada vez que ele abre, então o app
// grava o endereço atual (e a chave) num Gist secreto da conta do GitHub de quem compartilha. O site
// do projeto (`<site>?v=<id do gist>`) lê o Gist e abre a interface "Só para ver" buscando os dados
// pelo túnel. O link que vai para os outros nunca muda; desligar grava `url: null` (o site mostra
// "offline"), e "Gerar link novo" apaga o Gist e troca a chave.
//
// O token do GitHub (permissão `gist`) fica no cofre do sistema, como as chaves da IA.

use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::AppHandle;
use wipe_core::i18n::pick;

use crate::settings;

const KEYRING_SERVICE: &str = "wipe-cause";
const TOKEN_KEY: &str = "github-gist-token";
const FILE: &str = "wipe-cause-link.json";
const API: &str = "https://api.github.com";

/// O site que abre o link fixo. No desenvolvimento, `WIPE_SHARE_SITE` troca (ex.: o `npm run dev:web`).
pub fn site() -> String {
    let dev = cfg!(debug_assertions).then(|| std::env::var("WIPE_SHARE_SITE").ok()).flatten();
    let s = dev.unwrap_or_else(|| "https://keter45.github.io/wipe-cause/".into());
    if s.ends_with('/') { s } else { format!("{s}/") }
}

/// A origem do site (`https://host`), a única que pode chamar a API do link de outro domínio.
pub fn site_origin() -> String {
    let s = site();
    let rest = s.split_once("://").map(|(_, r)| r).unwrap_or(&s);
    let host = rest.split('/').next().unwrap_or(rest);
    format!("{}://{host}", s.split("://").next().unwrap_or("https"))
}

/// O link fixo de um Gist.
pub fn fixed_url(gist: &str) -> String {
    format!("{}?v={gist}", site())
}

fn entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, TOKEN_KEY).ok()
}

fn token() -> Option<String> {
    entry()?.get_password().ok().filter(|t| !t.is_empty())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    connected: bool,
    user: Option<String>,
}

#[tauri::command]
pub fn share_github_get(app: AppHandle) -> GithubStatus {
    GithubStatus { connected: token().is_some(), user: settings::load(&app).share_github_user }
}

/// Guarda (ou tira, com vazio) o token do GitHub. Confere o token e a permissão `gist` antes.
#[tauri::command]
pub async fn share_github_set(app: AppHandle, token: Option<String>) -> Result<GithubStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let token = token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        let Some(token) = token else {
            if let Some(e) = entry() {
                let _ = e.delete_credential();
            }
            settings::update(&app, |s| s.share_github_user = None)?;
            crate::share::republish(&app);
            return Ok(share_github_get(app));
        };
        let resp = agent()
            .get(&format!("{API}/user"))
            .set("Authorization", &format!("Bearer {token}"))
            .set("Accept", "application/vnd.github+json")
            .set("User-Agent", "wipe-cause")
            .call()
            .map_err(|e| match e {
                ureq::Error::Status(401, _) => pick(String::from("o GitHub recusou o token"), String::from("GitHub rejected the token")),
                e => e.to_string(),
            })?;
        // token clássico: o GitHub diz as permissões; o fino (fine-grained) não diz, e vale o teste ao publicar
        let scopes = resp.header("x-oauth-scopes").map(str::to_string);
        if scopes.as_deref().is_some_and(|s| !s.split(',').any(|x| x.trim() == "gist")) {
            return Err(pick(String::from("o token não tem a permissão gist"), String::from("the token does not have the gist scope")));
        }
        let user: Value = resp.into_json().map_err(|e| e.to_string())?;
        let login = user.get("login").and_then(Value::as_str).map(str::to_string);
        entry().ok_or("keyring")?.set_password(&token).map_err(|e| e.to_string())?; // i18n-ignore: não é texto para o usuário
        settings::update(&app, |s| s.share_github_user = login)?;
        crate::share::republish(&app);
        Ok(share_github_get(app))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build()
}

/// Chama a API de Gists com o token; erro com o status HTTP (0 = sem resposta).
fn api(method: &str, path: &str, token: &str, body: Option<Value>) -> Result<Value, (u16, String)> {
    let req = agent()
        .request(method, &format!("{API}{path}"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "wipe-cause");
    let resp = match body {
        Some(b) => req.send_json(b),
        None => req.call(),
    };
    match resp {
        Ok(r) if r.status() == 204 => Ok(Value::Null),
        Ok(r) => r.into_json().map_err(|e| (0, e.to_string())),
        Err(ureq::Error::Status(code, r)) => Err((code, r.into_string().unwrap_or_default())),
        Err(e) => Err((0, e.to_string())),
    }
}

/// Grava o endereço atual do túnel (ou `None`: offline) e a chave no Gist; cria o Gist na primeira
/// vez. Devolve o id do Gist, ou `None` sem GitHub conectado.
pub fn publish(app: &AppHandle, url: Option<&str>, key: &str) -> Result<Option<String>, String> {
    let Some(token) = token() else { return Ok(None) };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let content = json!({ "v": 1, "url": url, "key": key, "updatedAt": now }).to_string();
    let files = json!({ FILE: { "content": content } });
    if let Some(id) = settings::load(app).share_gist {
        match api("PATCH", &format!("/gists/{id}"), &token, Some(json!({ "files": files }))) {
            Ok(_) => return Ok(Some(id)),
            // apagado no GitHub: cria outro (o link fixo muda)
            Err((404, _)) => {}
            Err((code, e)) => return Err(gist_error(code, &e)),
        }
    }
    let created = api("POST", "/gists", &token, Some(json!({ "description": "Wipe Cause: link de visualização / viewing link", "public": false, "files": files }))) // i18n-ignore: descrição do Gist nas duas línguas
        .map_err(|(code, e)| gist_error(code, &e))?;
    let id = created.get("id").and_then(Value::as_str).ok_or("no gist id")?.to_string(); // i18n-ignore: não é texto para o usuário
    settings::update(app, |s| s.share_gist = Some(id.clone()))?;
    Ok(Some(id))
}

/// Apaga o Gist (o link fixo para de funcionar de vez).
pub fn delete(app: &AppHandle) {
    if let (Some(token), Some(id)) = (token(), settings::load(app).share_gist) {
        let _ = api("DELETE", &format!("/gists/{id}"), &token, None);
    }
    let _ = settings::update(app, |s| s.share_gist = None);
}

fn gist_error(code: u16, body: &str) -> String {
    let short: String = body.chars().take(160).collect();
    pick(format!("não foi possível gravar o link fixo no GitHub ({code}): {short}"), format!("could not save the fixed link on GitHub ({code}): {short}"))
}
