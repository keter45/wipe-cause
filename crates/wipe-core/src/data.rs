//! Tabelas de dados do jogo (defensivos, specs, consumíveis) vindas de `data/*.json`.

use serde::Deserialize;
use std::collections::HashMap;

const DEFENSIVES_JSON: &str = include_str!("../../../data/defensives.json");
const CONSUMABLES_JSON: &str = include_str!("../../../data/consumables.json");

#[derive(Debug, Clone, Deserialize)]
pub struct SpecInfo {
    pub class: String,
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Defensive {
    pub id: u32,
    pub name: String,
    pub class: String,
    pub cd: u32,
    pub kind: String,
}

#[derive(Debug, Deserialize)]
struct DefensivesFile {
    specs: HashMap<String, SpecInfo>,
    defensives: Vec<Defensive>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConsumableDef {
    pub ids: Vec<u32>,
    pub name_patterns: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ConsumablesFile {
    healthstone: ConsumableDef,
    health_potion: ConsumableDef,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Consumable {
    Healthstone,
    HealthPotion,
}

pub struct GameData {
    pub specs: HashMap<u32, SpecInfo>,
    pub defensives: HashMap<u32, Defensive>,
    healthstone: ConsumableDef,
    health_potion: ConsumableDef,
}

impl GameData {
    pub fn embedded() -> Self {
        let d: DefensivesFile = serde_json::from_str(DEFENSIVES_JSON).expect("data/defensives.json inválido");
        let c: ConsumablesFile = serde_json::from_str(CONSUMABLES_JSON).expect("data/consumables.json inválido");
        GameData {
            specs: d
                .specs
                .into_iter()
                .filter_map(|(k, v)| k.parse().ok().map(|id| (id, v)))
                .collect(),
            defensives: d.defensives.into_iter().map(|x| (x.id, x)).collect(),
            healthstone: lowercase_patterns(c.healthstone),
            health_potion: lowercase_patterns(c.health_potion),
        }
    }

    pub fn consumable(&self, spell_id: u32, spell_name: &str) -> Option<Consumable> {
        let name = spell_name.to_lowercase();
        // "Create Healthstone" é o warlock criando as pedras, não alguém usando
        let creating = name.starts_with("create ") || name.starts_with("criar ");
        let hit = |c: &ConsumableDef| {
            c.ids.contains(&spell_id) || (!creating && c.name_patterns.iter().any(|p| name.contains(p.as_str())))
        };
        if hit(&self.healthstone) {
            Some(Consumable::Healthstone)
        } else if hit(&self.health_potion) {
            Some(Consumable::HealthPotion)
        } else {
            None
        }
    }
}

fn lowercase_patterns(mut c: ConsumableDef) -> ConsumableDef {
    c.name_patterns.iter_mut().for_each(|p| *p = p.to_lowercase());
    c
}

pub fn difficulty_name(id: u32) -> &'static str {
    match id {
        1 => "Normal (dungeon)",
        2 => "Heroic (dungeon)",
        8 => "Mythic+",
        14 => "Normal",
        15 => "Heroic",
        16 => "Mythic",
        17 => "LFR",
        23 => "Mythic (dungeon)",
        _ => "Outra",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_consumables_by_id_and_name() {
        let d = GameData::embedded();
        assert_eq!(d.consumable(1295247, "Concentrated Silvermoon Health Potion"), Some(Consumable::HealthPotion));
        assert_eq!(d.consumable(999, "Poção de Cura Qualquer"), Some(Consumable::HealthPotion));
        assert_eq!(d.consumable(6262, "Healthstone"), Some(Consumable::Healthstone));
        assert_eq!(d.consumable(6201, "Create Healthstone"), None, "warlock criando pedra não é uso");
        assert_eq!(d.consumable(1236994, "Potion of Recklessness"), None, "poção de dano não é de vida");
    }
}
