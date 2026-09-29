//! Nomes e ícones dos talentos. O COMBATANT_INFO só traz números (nó, entrada, rank); a árvore
//! de cada spec vem dos dados públicos do Raidbots, guardada em cache no app.

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

const TALENTS_URL: &str = "https://www.raidbots.com/static/data/live/talents.json";
/// Árvores mudam com patches: busca de novo depois disso (o cache velho segue valendo offline).
const MAX_AGE: Duration = Duration::from_secs(3 * 24 * 3600);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TalentEntry {
    pub name: String,
    pub spell_id: Option<u32>,
    pub icon: Option<String>,
    pub node_id: u32,
    pub max_ranks: u32,
    /// class | spec | hero
    pub tree: String,
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("talents.json"))
}

fn fresh(p: &PathBuf) -> bool {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|m| SystemTime::now().duration_since(m).ok())
        .is_some_and(|age| age < MAX_AGE)
}

fn download() -> Result<String, String> {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .build()
        .get(TALENTS_URL)
        .call()
        .map_err(|e| format!("Não consegui baixar a lista de talentos: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())
}

/// Entradas de talento da spec: id da entrada -> nome, spell e ícone.
pub fn tree_for(json: &str, spec_id: u32) -> Result<HashMap<u32, TalentEntry>, String> {
    let trees: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Lista de talentos inválida: {e}"))?;
    let spec = trees
        .as_array()
        .into_iter()
        .flatten()
        .find(|t| t["specId"].as_u64() == Some(spec_id as u64))
        .ok_or_else(|| format!("Spec {spec_id} não está na lista de talentos."))?;
    let mut out = HashMap::new();
    for (key, tree) in [
        ("classNodes", "class"),
        ("specNodes", "spec"),
        ("heroNodes", "hero"),
    ] {
        for node in spec[key].as_array().into_iter().flatten() {
            let node_id = node["id"].as_u64().unwrap_or(0) as u32;
            for e in node["entries"].as_array().into_iter().flatten() {
                let Some(id) = e["id"].as_u64() else { continue };
                out.insert(
                    id as u32,
                    TalentEntry {
                        name: e["name"].as_str().unwrap_or("?").to_string(),
                        spell_id: e["spellId"].as_u64().map(|s| s as u32),
                        icon: e["icon"].as_str().map(str::to_string),
                        node_id,
                        max_ranks: e["maxRanks"].as_u64().unwrap_or(1) as u32,
                        tree: tree.to_string(),
                    },
                );
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn talent_tree(
    app: AppHandle,
    spec_id: u32,
) -> Result<HashMap<u32, TalentEntry>, String> {
    let path = cache_path(&app).ok_or("Sem pasta de dados do app.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let json = if fresh(&path) {
            std::fs::read_to_string(&path).map_err(|e| e.to_string())?
        } else {
            match download() {
                Ok(j) => {
                    if let Some(dir) = path.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    let _ = std::fs::write(&path, &j);
                    j
                }
                // sem internet: usa o cache antigo, se houver
                Err(e) => std::fs::read_to_string(&path).map_err(|_| e)?,
            }
        };
        tree_for(&json, spec_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_entries_of_the_spec() {
        let json = r#"[{"specId":254,"classNodes":[{"id":1,"entries":[{"id":10,"name":"A","spellId":100,"icon":"a","maxRanks":2}]}],
            "specNodes":[{"id":2,"entries":[{"id":20,"name":"B","spellId":200,"icon":"b"},{"id":21,"name":"C"}]}],"heroNodes":[]},
            {"specId":253,"classNodes":[{"id":9,"entries":[{"id":90,"name":"X"}]}]}]"#;
        let t = tree_for(json, 254).unwrap();
        assert_eq!(t.len(), 3);
        assert_eq!(t[&10].max_ranks, 2);
        assert_eq!(t[&20].tree, "spec");
        assert_eq!(t[&21].spell_id, None);
        assert!(!t.contains_key(&90));
        assert!(tree_for(json, 1).is_err());
    }
}
