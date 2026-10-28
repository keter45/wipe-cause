//! Confere a tabela de CDs de cura (data/heal-cooldowns.json) contra as outras fontes dos mesmos
//! números: as rotações (rotations/*.yaml) e os defensivos (data/defensives.json). A interface não
//! lê os YAMLs, então a tabela guarda uma cópia; este teste não deixa a cópia se separar.

use serde_json::Value as Json;
use std::collections::HashSet;
use std::path::PathBuf;
use yaml_serde::Value as Yaml;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn json(rel: &str) -> Json {
    serde_json::from_str(&std::fs::read_to_string(root().join(rel)).unwrap()).unwrap()
}

fn ids(v: &Json, key: &str) -> Vec<u64> {
    v.get(key).and_then(Json::as_array).map(|a| a.iter().filter_map(Json::as_u64).collect()).unwrap_or_default()
}

/// Habilidades de uma rotação: (id, alt_ids, cooldown_ms, channel_ms).
struct Ability {
    id: u64,
    alt_ids: Vec<u64>,
    cooldown_ms: Option<u64>,
    channel_ms: Option<u64>,
}

struct Rotation {
    file: String,
    spec: u64,
    abilities: Vec<Ability>,
}

fn rotations() -> Vec<Rotation> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(root().join("rotations")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
            continue;
        }
        let doc: Yaml = yaml_serde::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let Some(spec) = doc.get("spec").and_then(Yaml::as_u64) else { continue };
        let abilities = doc
            .get("abilities")
            .and_then(Yaml::as_mapping)
            .map(|m| {
                m.values()
                    .filter_map(|a| {
                        Some(Ability {
                            id: a.get("id")?.as_u64()?,
                            alt_ids: a.get("alt_ids").and_then(Yaml::as_sequence).map(|s| s.iter().filter_map(Yaml::as_u64).collect()).unwrap_or_default(),
                            cooldown_ms: a.get("cooldown_ms").and_then(Yaml::as_u64),
                            channel_ms: a.get("channel_ms").and_then(Yaml::as_u64),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        out.push(Rotation { file: path.file_name().unwrap().to_string_lossy().into_owned(), spec, abilities });
    }
    out
}

#[test]
fn heal_cooldowns_match_rotations_and_defensives() {
    let table = json("data/heal-cooldowns.json");
    let defensives = json("data/defensives.json");
    let defs = defensives["defensives"].as_array().unwrap();
    let rots = rotations();
    let mut errors = Vec::new();

    for cd in table["cooldowns"].as_array().unwrap() {
        let id = cd["id"].as_u64().unwrap();
        let name = cd["name"].as_str().unwrap_or("?");
        let Some(_) = cd.get("kind") else { continue };
        let specs: HashSet<u64> = ids(cd, "specs").into_iter().collect();
        let alt_ids = ids(cd, "alt_ids");
        let heal_ids = ids(cd, "heal_ids");
        let cooldown = cd.get("cooldown_ms").and_then(Json::as_u64);
        let duration = cd.get("duration_ms").and_then(Json::as_u64);
        for field in ["specs", "effect", "duration_ms", "cooldown_ms"] {
            if cd.get(field).is_none() {
                errors.push(format!("{name}: sem `{field}`"));
            }
        }
        let own: HashSet<u64> = std::iter::once(id).chain(alt_ids.iter().copied()).collect();

        for rot in rots.iter().filter(|r| specs.contains(&r.spec)) {
            for ab in rot.abilities.iter().filter(|a| own.contains(&a.id) || a.alt_ids.iter().any(|x| own.contains(x))) {
                if let (Some(want), Some(have)) = (ab.cooldown_ms, cooldown) {
                    if want != have {
                        errors.push(format!("{name}: cooldown_ms {have} ≠ {want} em {}", rot.file));
                    }
                }
                if let (Some(want), Some(have)) = (ab.channel_ms, duration) {
                    if want != have {
                        errors.push(format!("{name}: duration_ms {have} ≠ channel_ms {want} em {}", rot.file));
                    }
                }
                for alt in &ab.alt_ids {
                    if !own.contains(alt) {
                        errors.push(format!("{name}: falta o alt_id {alt} de {}", rot.file));
                    }
                }
            }
            // a cura do CD não pode ser uma habilidade comum da spec
            for h in heal_ids.iter().filter(|h| !own.contains(h)) {
                if rot.abilities.iter().any(|a| a.id == *h || a.alt_ids.contains(h)) {
                    errors.push(format!("{name}: heal_id {h} é habilidade de {}", rot.file));
                }
            }
        }

        if let Some(d) = defs.iter().find(|d| d["id"].as_u64().is_some_and(|x| own.contains(&x))) {
            if let (Some(cd_s), Some(have)) = (d["cd"].as_u64(), cooldown) {
                if cd_s * 1000 != have {
                    errors.push(format!("{name}: cooldown_ms {have} ≠ cd {cd_s} s em defensives.json"));
                }
            }
            if let (Some(z), Some(have)) = (d.get("zone").and_then(|z| z["duration"].as_u64()), duration) {
                if z * 1000 != have {
                    errors.push(format!("{name}: duration_ms {have} ≠ zone.duration {z} s em defensives.json"));
                }
            }
        }
    }
    assert!(errors.is_empty(), "data/heal-cooldowns.json:\n{}", errors.join("\n"));
}
