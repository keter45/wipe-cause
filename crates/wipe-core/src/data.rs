//! Tabelas de dados do jogo (defensivos, specs, consumíveis, interrupts) vindas de `data/*.json`.

use serde::Deserialize;
use std::collections::HashMap;

const DEFENSIVES_JSON: &str = include_str!("../../../data/defensives.json");
const CONSUMABLES_JSON: &str = include_str!("../../../data/consumables.json");
const INTERRUPTS_JSON: &str = include_str!("../../../data/interrupts.json");
const UTILITY_JSON: &str = include_str!("../../../data/utility.json");

#[derive(Debug, Clone, Deserialize)]
pub struct SpecInfo {
    pub class: String,
    pub role: String,
    /// `melee` ou `ranged`, como o jogo separa os alvos (tanks e os healers paladino e monge são melee)
    pub range: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Defensive {
    pub id: u32,
    pub name: String,
    pub class: String,
    pub cd: u32,
    pub kind: String,
    /// defensivo em área (para o replay): onde fica, raio e duração
    #[serde(default)]
    pub zone: Option<ZoneDef>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ZoneDef {
    pub radius: f32,
    /// segundos
    pub duration: f32,
    pub at: ZoneAt,
    /// at = buffed: o buff que os players ganham dentro
    #[serde(default)]
    pub buff: Option<u32>,
}

/// Controle de grupo de um player no replay: área em volta de quem usou, ou no inimigo alvo.
#[derive(Debug, Clone, Deserialize)]
pub struct CcDef {
    pub id: u32,
    pub name: String,
    #[serde(default)]
    pub radius: Option<f32>,
    /// quanto o mapa mostra (s)
    pub duration: f32,
    pub at: CcAt,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CcAt {
    Caster,
    Target,
}

/// Demonic Gateway: o cast que cria e a aura de quem passou por ele.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct GatewayDef {
    pub cast: u32,
    pub used_aura: u32,
}

#[derive(Debug, Deserialize)]
struct UtilityFile {
    cc: Vec<CcDef>,
    gateway: GatewayDef,
}

/// Onde fica a área: onde quem usou estava, onde caiu o totem, ou no meio dos primeiros buffados.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ZoneAt {
    Caster,
    Summon,
    Buffed,
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

#[derive(Debug, Clone, Deserialize)]
pub struct Interrupt {
    pub id: u32,
    pub name: String,
    pub class: String,
    #[serde(default)]
    pub specs: Vec<u32>,
}

#[derive(Debug, Deserialize)]
struct InterruptsFile {
    interrupts: Vec<Interrupt>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Consumable {
    Healthstone,
    HealthPotion,
}

pub struct GameData {
    pub specs: HashMap<u32, SpecInfo>,
    pub defensives: HashMap<u32, Defensive>,
    pub interrupts: HashMap<u32, Interrupt>,
    /// controle de grupo dos players (replay completo)
    pub cc: HashMap<u32, CcDef>,
    pub gateway: GatewayDef,
    healthstone: ConsumableDef,
    health_potion: ConsumableDef,
}

impl GameData {
    pub fn embedded() -> Self {
        let d: DefensivesFile = serde_json::from_str(DEFENSIVES_JSON).expect("data/defensives.json inválido");
        let c: ConsumablesFile = serde_json::from_str(CONSUMABLES_JSON).expect("data/consumables.json inválido");
        let i: InterruptsFile = serde_json::from_str(INTERRUPTS_JSON).expect("data/interrupts.json inválido");
        let u: UtilityFile = serde_json::from_str(UTILITY_JSON).expect("data/utility.json inválido");
        GameData {
            specs: d
                .specs
                .into_iter()
                .filter_map(|(k, v)| k.parse().ok().map(|id| (id, v)))
                .collect(),
            defensives: d.defensives.into_iter().map(|x| (x.id, x)).collect(),
            interrupts: i.interrupts.into_iter().map(|x| (x.id, x)).collect(),
            cc: u.cc.into_iter().map(|x| (x.id, x)).collect(),
            gateway: u.gateway,
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

impl GameData {
    /// A spec tem algum interrupt na tabela?
    pub fn spec_can_interrupt(&self, spec_id: u32) -> bool {
        let Some(spec) = self.specs.get(&spec_id) else { return false };
        self.interrupts.values().any(|i| i.class == spec.class && (i.specs.is_empty() || i.specs.contains(&spec_id)))
    }
}

fn lowercase_patterns(mut c: ConsumableDef) -> ConsumableDef {
    c.name_patterns.iter_mut().for_each(|p| *p = p.to_lowercase());
    c
}

/// Dificuldades de masmorra (normal, heroica, mítica, M+, timewalking, follower, delve).
const DUNGEON_DIFFICULTIES: [u32; 8] = [1, 2, 8, 23, 24, 150, 205, 208];

/// Encontro de masmorra (M+, delve…) e não de raid: o app é para raid, então esses ficam à parte.
/// `group_size` 0 = desconhecido (só a dificuldade decide).
pub fn is_dungeon(difficulty_id: u32, group_size: u32) -> bool {
    DUNGEON_DIFFICULTIES.contains(&difficulty_id) || (1..=5).contains(&group_size)
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
        _ => "Other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_dungeons_from_raids() {
        assert!(is_dungeon(8, 5), "M+");
        assert!(is_dungeon(23, 0), "masmorra mítica");
        assert!(!is_dungeon(16, 20), "raid mítica");
        assert!(!is_dungeon(233, 25), "world boss do tier");
        assert!(is_dungeon(0, 5), "grupo de 5");
    }

    #[test]
    fn matches_consumables_by_id_and_name() {
        let d = GameData::embedded();
        assert_eq!(d.consumable(1295247, "Concentrated Silvermoon Health Potion"), Some(Consumable::HealthPotion));
        assert_eq!(d.consumable(999, "Poção de Cura Qualquer"), Some(Consumable::HealthPotion));
        assert_eq!(d.consumable(6262, "Healthstone"), Some(Consumable::Healthstone));
        assert_eq!(d.consumable(6201, "Create Healthstone"), None, "warlock criando pedra não é uso");
        assert_eq!(d.consumable(1236994, "Potion of Recklessness"), None, "poção de dano não é de vida");
    }

    #[test]
    fn every_spec_is_melee_or_ranged() {
        let d = GameData::embedded();
        assert!(d.specs.values().all(|s| s.range == "melee" || s.range == "ranged"));
        // como o jogo escolhe os alvos da Gloombomb: tanks, Holy Paladin e Mistweaver contam como melee
        assert!(d.specs.values().filter(|s| s.role == "tank").all(|s| s.range == "melee"));
        assert_eq!((d.specs[&65].range.as_str(), d.specs[&270].range.as_str()), ("melee", "melee"));
        assert_eq!((d.specs[&256].range.as_str(), d.specs[&1468].range.as_str()), ("ranged", "ranged"));
    }
}
