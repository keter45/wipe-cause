//! SimulationCraft para o "comparar com o robô" (docs/simulation.md).
//!
//! O simc.exe não vem no instalador: é compilado pelo workflow `.github/workflows/simc.yml` e
//! publicado no release `simc` deste repositório. Na primeira simulação o app baixa o `simc.json`
//! (manifesto), baixa o arquivo que ele aponta, confere o SHA-256 e guarda em `<dados>/simc/`.
//! Antes de cada simulação, no máximo a cada `CHECK_EVERY`, olha se saiu um build novo; sem
//! internet segue com o que já tem.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use wipe_core::i18n::pick;

const MANIFEST_URL: &str = "https://github.com/keter45/wipe-cause/releases/download/simc/simc.json";
const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);
/// Uma sim de raid com muitas iterações leva segundos; isso só pega um simc travado.
const RUN_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Teto do download (o .gz tem dezenas de MB): protege contra um manifesto errado.
const MAX_DOWNLOAD: u64 = 300 * 1024 * 1024;

/// Uma simulação por vez: o simc já usa todos os núcleos.
static RUNNING: Mutex<()> = Mutex::new(());
static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

/// O `simc.json` do release: qual build é o atual e como conferir.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// commit do simulationcraft/simc
    pub commit: String,
    /// primeira linha da ajuda: "SimulationCraft 1205-01 for World of Warcraft 12.0.5.xxxxx Live …"
    pub banner: String,
    pub built: String,
    /// link do código-fonte desse commit (GPL-3)
    pub source: String,
    pub asset: Asset,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimcStatus {
    /// a simulação existe aqui (a versão web responde false)
    pub available: bool,
    pub installed: Option<Manifest>,
    pub latest: Option<Manifest>,
    /// há um build mais novo que o instalado
    pub update: bool,
    /// não deu para consultar o manifesto (offline, release fora do ar)
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimcResult {
    /// o `json2` do simc, inteiro
    pub json: serde_json::Value,
    /// o log de ações (`log=1`), quando pedido
    pub log: Option<String>,
    pub commit: String,
    pub banner: String,
    pub seconds: f64,
}

#[derive(Clone, Serialize)]
struct Progress {
    done: u64,
    total: u64,
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("simc"))
}

fn exe_path(dir: &Path) -> PathBuf {
    dir.join("simc.exe")
}

fn installed(dir: &Path) -> Option<Manifest> {
    if !exe_path(dir).is_file() {
        return None;
    }
    serde_json::from_str(&std::fs::read_to_string(dir.join("installed.json")).ok()?).ok()
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(60))
        .build()
}

fn fetch_manifest() -> Result<Manifest, String> {
    let offline = |e: String| pick(format!("Não consegui ver a versão do SimulationCraft: {e}"), format!("Couldn't check the SimulationCraft version: {e}"));
    let text = agent()
        .get(MANIFEST_URL)
        .call()
        .map_err(|e| offline(e.to_string()))?
        .into_string()
        .map_err(|e| offline(e.to_string()))?;
    parse_manifest(&text)
}

fn parse_manifest(text: &str) -> Result<Manifest, String> {
    let m: Manifest =
        serde_json::from_str(text).map_err(|e| pick(format!("Manifesto do SimulationCraft inválido: {e}"), format!("Invalid SimulationCraft manifest: {e}")))?;
    // só baixa do nosso release, nunca de um endereço que o arquivo mande
    let ours = "https://github.com/keter45/wipe-cause/releases/download/simc/";
    let valid = m.asset.url.starts_with(ours)
        && m.asset.url[ours.len()..] == m.asset.name
        && m.asset.sha256.len() == 64
        && m.asset.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        && m.asset.size > 0
        && m.asset.size <= MAX_DOWNLOAD;
    if !valid {
        return Err(pick("Manifesto do SimulationCraft com endereço ou checksum inválido.", "SimulationCraft manifest has an invalid address or checksum."));
    }
    Ok(m)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Baixa, confere e instala o build do manifesto. Troca o simc.exe só no fim, de uma vez.
fn install(app: &AppHandle, dir: &Path, m: &Manifest) -> Result<(), String> {
    let failed = |e: String| pick(format!("Não consegui baixar o SimulationCraft: {e}"), format!("Couldn't download the SimulationCraft: {e}"));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let resp = agent().get(&m.asset.url).call().map_err(|e| failed(e.to_string()))?;
    let mut reader = resp.into_reader().take(MAX_DOWNLOAD + 1);
    let mut gz = Vec::with_capacity(m.asset.size as usize);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| failed(e.to_string()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        gz.extend_from_slice(&buf[..n]);
        let _ = app.emit("simc-progress", Progress { done: gz.len() as u64, total: m.asset.size });
    }
    if gz.len() as u64 != m.asset.size || hex(&hasher.finalize()) != m.asset.sha256.to_ascii_lowercase() {
        return Err(pick(
            "O SimulationCraft baixado não confere com o checksum publicado; nada foi instalado. Tente de novo.",
            "The downloaded SimulationCraft doesn't match the published checksum; nothing was installed. Try again.",
        ));
    }
    let part = dir.join("simc.exe.part");
    {
        let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        std::io::copy(&mut flate2::read::GzDecoder::new(&gz[..]), &mut out).map_err(|e| failed(e.to_string()))?;
    }
    std::fs::rename(&part, exe_path(dir)).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("installed.json"), serde_json::to_string_pretty(m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    touch_checked(dir);
    Ok(())
}

fn touch_checked(dir: &Path) {
    let _ = std::fs::write(dir.join("checked"), b"");
}

fn checked_recently(dir: &Path) -> bool {
    std::fs::metadata(dir.join("checked"))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < CHECK_EVERY)
}

/// Desenvolvimento: `WIPE_SIMC_EXE` aponta para um simc.exe compilado na máquina (sem download).
fn dev_exe() -> Option<(PathBuf, Manifest)> {
    let exe = PathBuf::from(std::env::var("WIPE_SIMC_EXE").ok()?);
    exe.is_file().then(|| {
        let asset = Asset { name: String::new(), url: String::new(), size: 0, sha256: String::new() };
        let m = Manifest { commit: "local".into(), banner: format!("SimulationCraft (local: {})", exe.display()), built: String::new(), source: String::new(), asset };
        (exe, m)
    })
}

/// O simc pronto para rodar: instala na primeira vez e atualiza quando há build novo.
fn ensure(app: &AppHandle) -> Result<(PathBuf, Manifest), String> {
    if let Some(dev) = dev_exe() {
        return Ok(dev);
    }
    let dir = dir(app)?;
    match installed(&dir) {
        Some(cur) if checked_recently(&dir) => Ok((exe_path(&dir), cur)),
        Some(cur) => match fetch_manifest() {
            Ok(latest) if latest.commit != cur.commit => {
                // build novo; se o download falhar, segue com o que já tem
                match install(app, &dir, &latest) {
                    Ok(()) => Ok((exe_path(&dir), latest)),
                    Err(_) => Ok((exe_path(&dir), cur)),
                }
            }
            Ok(_) => {
                touch_checked(&dir);
                Ok((exe_path(&dir), cur))
            }
            Err(_) => Ok((exe_path(&dir), cur)),
        },
        None => {
            let latest = fetch_manifest()?;
            install(app, &dir, &latest)?;
            Ok((exe_path(&dir), latest))
        }
    }
}

/// Opções que escrevem ou leem arquivos fora da pasta da simulação. A saída é nossa (json2 e
/// log); o perfil que a UI monta nunca precisa delas.
fn check_input(input: &str) -> Result<(), String> {
    for line in input.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        for token in line.split_whitespace() {
            let key = token.split(['=', '+']).next().unwrap_or("").to_ascii_lowercase();
            let file_like = !token.contains('=')
                || key.is_empty()
                || ["output", "html", "json", "xml", "csv", "save", "file", "path", "log", "threads"].iter().any(|k| key.contains(k));
            if file_like {
                return Err(pick(
                    format!("Opção não permitida no perfil do SimulationCraft: {token}"),
                    format!("Option not allowed in the SimulationCraft profile: {token}"),
                ));
            }
        }
    }
    Ok(())
}

/// Últimas linhas do que o simc imprimiu, para a mensagem de erro.
fn tail(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

fn run(app: &AppHandle, input: &str, log: bool) -> Result<SimcResult, String> {
    check_input(input)?;
    let _one = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    let (exe, manifest) = ensure(app)?;
    CANCEL.store(false, Ordering::SeqCst);
    let (json, log, seconds) = execute(&exe, &dir(app)?.join("run"), input, log)?;
    Ok(SimcResult { json, log, commit: manifest.commit, banner: manifest.banner, seconds })
}

/// Roda o simc numa pasta limpa: o perfil entra como arquivo, sai o json2 (e o log de ações).
fn execute(exe: &Path, work: &Path, input: &str, log: bool) -> Result<(serde_json::Value, Option<String>, f64), String> {
    let _ = std::fs::remove_dir_all(work);
    std::fs::create_dir_all(work).map_err(|e| e.to_string())?;
    std::fs::write(work.join("input.simc"), input).map_err(|e| e.to_string())?;
    let stdout = std::fs::File::create(work.join("stdout.txt")).map_err(|e| e.to_string())?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;

    // deixa um núcleo livre para o jogo e o app
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).saturating_sub(1).max(1);
    let mut cmd = Command::new(exe);
    cmd.current_dir(work)
        .arg("input.simc")
        .arg("json2=out.json")
        .arg(format!("threads={threads}"))
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);
    if log {
        cmd.arg("log=1").arg("output=log.txt");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        cmd.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }

    let started = Instant::now();
    let mut child = cmd.spawn().map_err(|e| pick(format!("Não consegui abrir o SimulationCraft: {e}"), format!("Couldn't start the SimulationCraft: {e}")))?;
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if CANCEL.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(pick("Simulação cancelada.", "Simulation cancelled."));
        }
        if started.elapsed() > RUN_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(pick("O SimulationCraft passou de 15 minutos e foi parado.", "The SimulationCraft ran past 15 minutes and was stopped."));
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let printed = std::fs::read_to_string(work.join("stdout.txt")).unwrap_or_default();
    let json = std::fs::read_to_string(work.join("out.json")).ok();
    let (true, Some(json)) = (status.success(), json) else {
        return Err(pick(
            format!("O SimulationCraft parou com erro:\n{}", tail(&printed, 12)),
            format!("The SimulationCraft stopped with an error:\n{}", tail(&printed, 12)),
        ));
    };
    let json = serde_json::from_str(&json).map_err(|e| pick(format!("Resultado do SimulationCraft inválido: {e}"), format!("Invalid SimulationCraft result: {e}")))?;
    let log = log.then(|| std::fs::read_to_string(work.join("log.txt")).unwrap_or_default());
    Ok((json, log, started.elapsed().as_secs_f64()))
}

/// O que está instalado e, com `check`, o que há de novo no release.
#[tauri::command]
pub async fn simc_status(app: AppHandle, check: Option<bool>) -> Result<SimcStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let installed = dev_exe().map(|(_, m)| m).or(installed(&dir(&app)?));
        let (latest, error) = if check.unwrap_or(false) {
            match fetch_manifest() {
                Ok(m) => (Some(m), None),
                Err(e) => (None, Some(e)),
            }
        } else {
            (None, None)
        };
        let update = matches!((&installed, &latest), (Some(i), Some(l)) if i.commit != l.commit);
        Ok(SimcStatus { available: true, installed, latest, update, error })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Baixa (ou atualiza) o simc agora; o progresso sai no evento `simc-progress`.
#[tauri::command]
pub async fn simc_install(app: AppHandle) -> Result<Manifest, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = dir(&app)?;
        let latest = fetch_manifest()?;
        if installed(&dir).as_ref().map(|m| &m.commit) != Some(&latest.commit) {
            install(&app, &dir, &latest)?;
        }
        Ok(latest)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Roda um perfil do simc e devolve o json2 (e o log de ações com `log`).
#[tauri::command]
pub async fn simc_run(app: AppHandle, input: String, log: Option<bool>) -> Result<SimcResult, String> {
    tauri::async_runtime::spawn_blocking(move || run(&app, &input, log.unwrap_or(false)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn simc_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Simulações salvas (uma por player + boss + noite): `<dados>/simc/saved/<chave>.json`.
fn saved_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    // a chave vem da UI: só letras, números e - _ . no nome do arquivo
    let safe: String = key.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' }).take(160).collect();
    if safe.is_empty() || safe.starts_with('.') {
        return Err("invalid key".into());
    }
    Ok(dir(app)?.join("saved").join(format!("{safe}.json")))
}

#[tauri::command]
pub fn simc_saved_get(app: AppHandle, key: String) -> Result<Option<serde_json::Value>, String> {
    let p = saved_path(&app, &key)?;
    let Ok(text) = std::fs::read_to_string(p) else { return Ok(None) };
    // arquivo estragado conta como sem simulação
    Ok(serde_json::from_str(&text).ok())
}

#[tauri::command]
pub fn simc_saved_put(app: AppHandle, key: String, value: serde_json::Value) -> Result<(), String> {
    let p = saved_path(&app, &key)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, serde_json::to_vec(&value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(url: &str, name: &str, sha: &str) -> String {
        serde_json::json!({
            "commit": "abc", "banner": "SimulationCraft 1205-01", "built": "2026-10-20T00:00:00Z",
            "source": "https://github.com/simulationcraft/simc/tree/abc",
            "asset": { "name": name, "url": url, "size": 10, "sha256": sha }
        })
        .to_string()
    }

    #[test]
    fn manifest_only_from_our_release() {
        let sha = "a".repeat(64);
        let ok = "https://github.com/keter45/wipe-cause/releases/download/simc/simc-x.exe.gz";
        assert!(parse_manifest(&manifest(ok, "simc-x.exe.gz", &sha)).is_ok());
        // outro host, outro release, nome que não bate, checksum curto
        assert!(parse_manifest(&manifest("https://evil.example/simc-x.exe.gz", "simc-x.exe.gz", &sha)).is_err());
        assert!(parse_manifest(&manifest("https://github.com/keter45/wipe-cause/releases/download/v1/simc-x.exe.gz", "simc-x.exe.gz", &sha)).is_err());
        assert!(parse_manifest(&manifest(ok, "outro.exe.gz", &sha)).is_err());
        assert!(parse_manifest(&manifest(ok, "simc-x.exe.gz", "abc")).is_err());
    }

    #[test]
    fn input_keeps_simc_inside_its_folder() {
        let profile = "# comentário\nmage=\"Fulano\"\nspec=fire\nlevel=90\ntalents=C8PAAAAAAAAAAAAAAAAAAAAAAAAAA\nhead=,id=1234,bonus_id=1/2/3\nmax_time=300 vary_combat_length=0\nraid_events+=/adds,count=3,first=30,cooldown=60\n";
        assert!(check_input(profile).is_ok());
        for bad in ["output=C:/x.txt", "html=r.html", "json2=x.json", "save=x.simc", "path=C:/", "other.simc", "log=1", "threads=64", "spell_query_xml_output_file=x"] {
            assert!(check_input(bad).is_err(), "{bad}");
        }
    }

    /// Com um simc.exe de verdade: `WIPE_SIMC_EXE=… cargo test -p wipe-cause-app simc -- --ignored`
    #[test]
    #[ignore]
    fn runs_a_real_simc() {
        let exe = PathBuf::from(std::env::var("WIPE_SIMC_EXE").expect("WIPE_SIMC_EXE"));
        let profile = std::env::var("WIPE_SIMC_PROFILE").expect("WIPE_SIMC_PROFILE (um .simc de exemplo)");
        let input = std::fs::read_to_string(profile).unwrap() + "
iterations=50
max_time=120
vary_combat_length=0
";
        assert!(check_input(&input).is_ok(), "{:?}", check_input(&input));
        let work = std::env::temp_dir().join("wipe-simc-test");
        let (json, log, secs) = execute(&exe, &work, &input, false).unwrap();
        let dps = json["sim"]["players"][0]["collected_data"]["dps"]["mean"].as_f64().unwrap();
        assert!(dps > 0.0 && log.is_none(), "dps {dps}");
        eprintln!("dps {dps:.0} em {secs:.1}s");
        let (_, log, _) = execute(&exe, &work, &(input + "iterations=1
"), true).unwrap();
        let log = log.unwrap();
        assert!(log.contains("performs"), "{}", &log[..log.len().min(500)]);
        // um perfil com opção de arquivo nem chega ao simc
        assert!(check_input("html=x.html").is_err());
    }

    #[test]
    fn hex_is_lowercase() {
        assert_eq!(hex(&[0, 15, 255]), "000fff");
    }

    #[test]
    fn tail_skips_blank_lines() {
        assert_eq!(tail("a\n\nb\nc\n\n", 2), "b\nc");
    }
}
