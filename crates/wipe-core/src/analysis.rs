//! Análise em streaming: cada linha dentro de um encontro alimenta um `PullBuilder`,
//! que no ENCOUNTER_END vira um `Pull`. Nada do log fica em memória além do estado agregado.

use crate::data::{Consumable, GameData};
use crate::report::*;
use std::collections::{HashMap, HashSet, VecDeque};

/// Janela do death recap.
const RECAP_WINDOW_MS: i64 = 15_000;
/// Janela para "defensivo usado logo antes de morrer".
const RECENT_DEFENSIVE_MS: i64 = 10_000;
const MAX_RECAP_ENTRIES: usize = 60;
const FEIGN_DEATH: u32 = 5384;
const NIL_GUID: &str = "0000000000000000";

// Flags de unidade (COMBATLOG_OBJECT_*)
const AFFILIATION_GROUP: u32 = 0x1 | 0x2 | 0x4;
const REACTION_HOSTILE_OR_NEUTRAL: u32 = 0x40 | 0x20;
const TYPE_PLAYER: u32 = 0x400;
const ADVANCED_LEN: usize = 17;

fn hex(s: &str) -> u32 {
    u32::from_str_radix(s.trim_start_matches("0x"), 16).unwrap_or(0)
}
fn num(s: Option<&&str>) -> i64 {
    s.and_then(|v| v.parse::<f64>().ok()).map(|v| v as i64).unwrap_or(0)
}
fn is_guid_like(s: &str) -> bool {
    s == NIL_GUID || (s.len() > 8 && s.contains('-'))
}
fn npc_id(guid: &str) -> Option<u32> {
    // Creature-0-3767-2769-12345-257361-0000ABCDEF -> penúltimo segmento
    if !(guid.starts_with("Creature-") || guid.starts_with("Vehicle-")) {
        return None;
    }
    guid.rsplit('-').nth(1).and_then(|s| s.parse().ok())
}

/// Bloco do advanced combat logging.
struct Advanced<'a> {
    info_guid: &'a str,
    owner_guid: &'a str,
    hp: i64,
    max_hp: i64,
}

fn advanced_at<'a>(f: &[&'a str], at: usize) -> Option<Advanced<'a>> {
    if f.len() < at + ADVANCED_LEN || !is_guid_like(f[at]) {
        return None;
    }
    let hp = f[at + 2].parse::<i64>().ok()?;
    let max_hp = f[at + 3].parse::<i64>().ok()?;
    Some(Advanced { info_guid: f[at], owner_guid: f[at + 1], hp, max_hp })
}

#[derive(Default)]
struct PlayerAcc {
    name: String,
    spec_id: Option<u32>,
    damage_done: i64,
    healing_done: i64,
    damage_taken: i64,
    deaths: u32,
    health_potions: Vec<i64>,
    healthstones: Vec<i64>,
    /// defensivos pessoais castados pelo player
    defensive_casts: Vec<SpellUse>,
    /// defensivos externos recebidos (aura aplicada no player)
    externals_received: Vec<SpellUse>,
    taken: HashMap<(u32, String), (String, i64, u32)>,
    recap: VecDeque<RecapEntry>,
    last_hp_pct: Option<f32>,
    feigning: bool,
}

struct UnitHp {
    name: String,
    hp: i64,
    max_hp: i64,
}

#[derive(Default)]
struct EnemySpellAcc {
    name: String,
    sources: HashSet<String>,
    casts: u32,
    hits: u32,
    damage: i64,
}

/// Morte ainda sem a checagem de defensivos disponíveis (feita depois, com dados do log inteiro).
pub(crate) struct PendingDeath {
    pub death: Death,
    pub casts_before: Vec<(u32, i64)>,
}

pub(crate) struct PullBuilder {
    encounter_id: u32,
    encounter_name: String,
    difficulty_id: u32,
    group_size: u32,
    start_ms: i64,
    start_local: String,
    tz_offset_hours: f64,
    last_ms: i64,
    players: HashMap<String, PlayerAcc>,
    pet_owner: HashMap<String, String>,
    enemies: HashMap<String, UnitHp>,
    enemy_spells: HashMap<u32, EnemySpellAcc>,
    deaths: Vec<PendingDeath>,
}

/// Resultado de um pull antes do pós-processamento global.
pub(crate) struct FinishedPull {
    pub pull: Pull,
    pub pending_deaths: Vec<PendingDeath>,
    /// defensivos usados por player neste pull (guid -> spell ids)
    pub defensives_by_player: HashMap<String, HashSet<u32>>,
    pub healthstone_users: HashSet<String>,
}

impl PullBuilder {
    pub fn start(f: &[&str], t: i64, start_local: &str, tz: f64) -> Self {
        PullBuilder {
            encounter_id: f.get(1).and_then(|v| v.parse().ok()).unwrap_or(0),
            encounter_name: f.get(2).unwrap_or(&"?").to_string(),
            difficulty_id: f.get(3).and_then(|v| v.parse().ok()).unwrap_or(0),
            group_size: f.get(4).and_then(|v| v.parse().ok()).unwrap_or(0),
            start_ms: t,
            start_local: start_local.to_string(),
            tz_offset_hours: tz,
            last_ms: t,
            players: HashMap::new(),
            pet_owner: HashMap::new(),
            enemies: HashMap::new(),
            enemy_spells: HashMap::new(),
            deaths: Vec::new(),
        }
    }

    fn rel(&self, t: i64) -> i64 {
        t - self.start_ms
    }

    fn is_group_player(guid: &str, flags: u32) -> bool {
        guid.starts_with("Player-") && flags & AFFILIATION_GROUP != 0
    }

    fn is_enemy(guid: &str, flags: u32) -> bool {
        !guid.starts_with("Player-") && flags & TYPE_PLAYER == 0 && flags & REACTION_HOSTILE_OR_NEUTRAL != 0
    }

    fn player(&mut self, guid: &str, name: &str) -> &mut PlayerAcc {
        let p = self.players.entry(guid.to_string()).or_default();
        if p.name.is_empty() && !name.is_empty() && name != "nil" {
            p.name = name.to_string();
        }
        p
    }

    /// Dono (player) de uma unidade: o próprio player, ou o dono do pet/guardião.
    fn owner_of(&self, guid: &str, flags: u32) -> Option<String> {
        if Self::is_group_player(guid, flags) {
            return Some(guid.to_string());
        }
        if flags & AFFILIATION_GROUP != 0 {
            return self.pet_owner.get(guid).cloned();
        }
        None
    }

    fn track_advanced(&mut self, adv: &Advanced, f: &[&str]) {
        if adv.max_hp <= 0 {
            return;
        }
        let pct = (adv.hp as f32 / adv.max_hp as f32 * 100.0).clamp(0.0, 100.0);
        if adv.owner_guid != NIL_GUID && adv.owner_guid.starts_with("Player-") {
            self.pet_owner.insert(adv.info_guid.to_string(), adv.owner_guid.to_string());
        }
        if let Some(p) = self.players.get_mut(adv.info_guid) {
            p.last_hp_pct = Some(pct);
        }
        // unidade inimiga: guarda HP para identificar bosses
        let (src, dst) = (f[1], f[5]);
        let (name, flags) = if adv.info_guid == dst {
            (f[6], hex(f[7]))
        } else if adv.info_guid == src {
            (f[2], hex(f[3]))
        } else {
            return;
        };
        if Self::is_enemy(adv.info_guid, flags) {
            let e = self.enemies.entry(adv.info_guid.to_string()).or_insert_with(|| UnitHp {
                name: name.to_string(),
                hp: adv.hp,
                max_hp: adv.max_hp,
            });
            e.hp = adv.hp;
            e.max_hp = adv.max_hp;
        }
    }

    pub fn feed(&mut self, f: &[&str], t: i64, data: &GameData) {
        if f.len() < 9 {
            if f.first() == Some(&"COMBATANT_INFO") {
                self.combatant_info(f);
            }
            return;
        }
        self.last_ms = t;
        let event = f[0];
        // eventos SPELL_* precisam do prefixo spellId,spellName,school
        if event.starts_with("SPELL_") && f.len() < 12 {
            return;
        }
        match event {
            "COMBATANT_INFO" => self.combatant_info(f),
            "SPELL_DAMAGE" | "SPELL_PERIODIC_DAMAGE" | "RANGE_DAMAGE" | "SPELL_BUILDING_DAMAGE" => {
                self.damage(f, t, 12)
            }
            "SWING_DAMAGE" => self.damage(f, t, 9),
            "ENVIRONMENTAL_DAMAGE" => self.damage(f, t, 10),
            "SWING_DAMAGE_LANDED" => {
                if let Some(adv) = advanced_at(f, 9) {
                    self.track_advanced(&adv, f);
                }
            }
            "SPELL_HEAL" | "SPELL_PERIODIC_HEAL" => self.heal(f, t),
            "SPELL_CAST_SUCCESS" => self.cast(f, t, data),
            "SPELL_AURA_APPLIED" | "SPELL_AURA_REMOVED" => self.aura(f, t, data),
            "SPELL_SUMMON" => {
                if let Some(owner) = self.owner_of(f[1], hex(f[3])) {
                    self.pet_owner.insert(f[5].to_string(), owner);
                }
            }
            "UNIT_DIED" => self.unit_died(f, t),
            _ => {}
        }
    }

    fn combatant_info(&mut self, f: &[&str]) {
        // COMBATANT_INFO,guid,faction,21 stats...,specID,[talentos],...
        let Some(guid) = f.get(1) else { return };
        let spec = f.get(24).and_then(|v| v.parse::<u32>().ok());
        let p = self.players.entry(guid.to_string()).or_default();
        if spec.is_some() {
            p.spec_id = spec;
        }
    }

    /// `prefix_end`: índice onde começa o bloco advanced (ou o sufixo, sem advanced).
    fn damage(&mut self, f: &[&str], t: i64, prefix_end: usize) {
        let adv = advanced_at(f, prefix_end);
        if let Some(a) = &adv {
            self.track_advanced(a, f);
        }
        let s = prefix_end + if adv.is_some() { ADVANCED_LEN } else { 0 };
        if f.len() <= s {
            return;
        }
        let amount = num(f.get(s));
        let overkill = num(f.get(s + 2)).max(0);
        let absorbed = num(f.get(s + 6));

        let (src_guid, src_name, src_flags) = (f[1], f[2], hex(f[3]));
        let (dst_guid, dst_name, dst_flags) = (f[5], f[6], hex(f[7]));
        let (spell_id, spell_name) = match f[0] {
            "SWING_DAMAGE" => (1u32, "Melee".to_string()),
            "ENVIRONMENTAL_DAMAGE" => (0u32, f[9].to_string()),
            _ => (f[9].parse().unwrap_or(0), f[10].to_string()),
        };

        // dano causado por player (ou pet) em inimigo
        if Self::is_enemy(dst_guid, dst_flags) {
            if let Some(owner) = self.owner_of(src_guid, src_flags) {
                self.player(&owner, if owner == src_guid { src_name } else { "" }).damage_done +=
                    (amount - overkill).max(0);
            }
        }

        // dano tomado por player
        if Self::is_group_player(dst_guid, dst_flags) {
            let source_label = if src_name == "nil" || src_name.is_empty() { "Ambiente".to_string() } else { src_name.to_string() };
            if Self::is_enemy(src_guid, src_flags) || src_guid == NIL_GUID {
                let e = self.enemy_spells.entry(spell_id).or_default();
                e.name = spell_name.clone();
                e.sources.insert(source_label.clone());
                e.hits += 1;
                e.damage += amount + absorbed;
            }
            let hp_pct = match &adv {
                Some(a) if a.info_guid == dst_guid && a.max_hp > 0 => {
                    Some((a.hp as f32 / a.max_hp as f32 * 100.0).clamp(0.0, 100.0))
                }
                _ => None,
            };
            let rel = self.rel(t);
            let p = self.player(dst_guid, dst_name);
            p.damage_taken += amount + absorbed;
            let entry = p.taken.entry((spell_id, source_label.clone())).or_insert((spell_name.clone(), 0, 0));
            entry.1 += amount + absorbed;
            entry.2 += 1;
            if hp_pct.is_some() {
                p.last_hp_pct = hp_pct;
            }
            push_recap(
                p,
                RecapEntry {
                    t: rel,
                    kind: RecapKind::Damage,
                    spell_id,
                    spell_name,
                    source: source_label,
                    amount,
                    overkill,
                    absorbed,
                    hp_pct,
                },
            );
        }
    }

    fn heal(&mut self, f: &[&str], t: i64) {
        let adv = advanced_at(f, 12);
        if let Some(a) = &adv {
            self.track_advanced(a, f);
        }
        let s = 12 + if adv.is_some() { ADVANCED_LEN } else { 0 };
        // Sufixo: amount, baseAmount, overheal, absorbed, critical. A ordem dos dois
        // primeiros variou entre versões; o maior dos dois é o total com overheal.
        let total = num(f.get(s)).max(num(f.get(s + 1)));
        let overheal = num(f.get(s + 2)).max(0);
        let effective = (total - overheal).max(0);

        let (src_guid, src_name, src_flags) = (f[1], f[2], hex(f[3]));
        let (dst_guid, dst_name, dst_flags) = (f[5], f[6], hex(f[7]));
        if let Some(owner) = self.owner_of(src_guid, src_flags) {
            self.player(&owner, if owner == src_guid { src_name } else { "" }).healing_done += effective;
        }
        if effective > 0 && Self::is_group_player(dst_guid, dst_flags) {
            let hp_pct = match &adv {
                Some(a) if a.info_guid == dst_guid && a.max_hp > 0 => {
                    Some((a.hp as f32 / a.max_hp as f32 * 100.0).clamp(0.0, 100.0))
                }
                _ => None,
            };
            let rel = self.rel(t);
            let p = self.player(dst_guid, dst_name);
            if hp_pct.is_some() {
                p.last_hp_pct = hp_pct;
            }
            push_recap(
                p,
                RecapEntry {
                    t: rel,
                    kind: RecapKind::Heal,
                    spell_id: f[9].parse().unwrap_or(0),
                    spell_name: f[10].to_string(),
                    source: src_name.to_string(),
                    amount: effective,
                    overkill: 0,
                    absorbed: 0,
                    hp_pct,
                },
            );
        }
    }

    fn cast(&mut self, f: &[&str], t: i64, data: &GameData) {
        if let Some(adv) = advanced_at(f, 12) {
            self.track_advanced(&adv, f);
        }
        let (src_guid, src_name, src_flags) = (f[1], f[2], hex(f[3]));
        let spell_id: u32 = f.get(9).and_then(|v| v.parse().ok()).unwrap_or(0);
        let spell_name = f.get(10).unwrap_or(&"").to_string();
        let rel = self.rel(t);

        if Self::is_enemy(src_guid, src_flags) {
            let e = self.enemy_spells.entry(spell_id).or_default();
            e.name = spell_name;
            e.sources.insert(src_name.to_string());
            e.casts += 1;
            return;
        }
        if !Self::is_group_player(src_guid, src_flags) {
            return;
        }
        let consumable = data.consumable(spell_id, &spell_name);
        let defensive = data.defensives.get(&spell_id).filter(|d| d.kind == "personal").map(|d| d.name.clone());
        let p = self.player(src_guid, src_name);
        match consumable {
            Some(Consumable::Healthstone) => p.healthstones.push(rel),
            Some(Consumable::HealthPotion) => p.health_potions.push(rel),
            None => {}
        }
        if let Some(name) = defensive {
            p.defensive_casts.push(SpellUse { spell_id, name: name.clone(), t: rel, source: Some(src_guid.to_string()) });
            push_recap(
                p,
                RecapEntry {
                    t: rel,
                    kind: RecapKind::Buff,
                    spell_id,
                    spell_name: name,
                    source: src_name.to_string(),
                    amount: 0,
                    overkill: 0,
                    absorbed: 0,
                    hp_pct: None,
                },
            );
        } else if consumable.is_some() {
            let label = f.get(10).unwrap_or(&"").to_string();
            push_recap(
                p,
                RecapEntry {
                    t: rel,
                    kind: RecapKind::Buff,
                    spell_id,
                    spell_name: label,
                    source: src_name.to_string(),
                    amount: 0,
                    overkill: 0,
                    absorbed: 0,
                    hp_pct: None,
                },
            );
        }
    }

    fn aura(&mut self, f: &[&str], t: i64, data: &GameData) {
        let (dst_guid, dst_name, dst_flags) = (f[5], f[6], hex(f[7]));
        if !Self::is_group_player(dst_guid, dst_flags) {
            return;
        }
        let spell_id: u32 = f.get(9).and_then(|v| v.parse().ok()).unwrap_or(0);
        let applied = f[0] == "SPELL_AURA_APPLIED";
        if spell_id == FEIGN_DEATH {
            self.player(dst_guid, dst_name).feigning = applied;
            return;
        }
        if !applied {
            return;
        }
        // defensivos externos/de raid recebidos (Pain Suppression, Ironbark, ...)
        let Some(def) = data.defensives.get(&spell_id).filter(|d| d.kind != "personal") else { return };
        let (name, src_guid, src_name) = (def.name.clone(), f[1].to_string(), f[2].to_string());
        let rel = self.rel(t);
        let p = self.player(dst_guid, dst_name);
        p.externals_received.push(SpellUse { spell_id, name: name.clone(), t: rel, source: Some(src_guid) });
        push_recap(
            p,
            RecapEntry {
                t: rel,
                kind: RecapKind::Buff,
                spell_id,
                spell_name: name,
                source: src_name,
                amount: 0,
                overkill: 0,
                absorbed: 0,
                hp_pct: None,
            },
        );
    }

    fn unit_died(&mut self, f: &[&str], t: i64) {
        let (dst_guid, dst_name, dst_flags) = (f[5], f[6], hex(f[7]));
        if !Self::is_group_player(dst_guid, dst_flags) {
            return;
        }
        let rel = self.rel(t);
        let order = self.deaths.len() as u32 + 1;
        let p = self.player(dst_guid, dst_name);
        if p.feigning {
            return;
        }
        p.deaths += 1;
        let recap: Vec<RecapEntry> = p.recap.iter().filter(|e| rel - e.t <= RECAP_WINDOW_MS).cloned().collect();
        let killing_blow = recap.iter().rev().find(|e| e.kind == RecapKind::Damage).cloned();
        let mut defensives_recent: Vec<SpellUse> = p
            .defensive_casts
            .iter()
            .chain(p.externals_received.iter())
            .filter(|u| u.t <= rel && rel - u.t <= RECENT_DEFENSIVE_MS)
            .cloned()
            .collect();
        defensives_recent.sort_by_key(|u| u.t);
        let casts_before = p.defensive_casts.iter().filter(|u| u.t <= rel).map(|u| (u.spell_id, u.t)).collect();
        let death = Death {
            order,
            guid: dst_guid.to_string(),
            name: p.name.clone(),
            class: None,
            role: None,
            t: rel,
            killing_blow,
            recap,
            defensives_recent,
            defensives_available: Vec::new(),
            used_health_potion: p.health_potions.iter().any(|&x| x <= rel),
            used_healthstone: p.healthstones.iter().any(|&x| x <= rel),
            healthstone_known: false,
        };
        p.recap.clear();
        self.deaths.push(PendingDeath { death, casts_before });
    }

    pub fn finish(self, end: Option<(&[&str], i64)>, id: usize, data: &GameData) -> FinishedPull {
        let (success, end_ms, incomplete) = match end {
            // ENCOUNTER_END,id,name,difficulty,size,success,fightTime
            Some((f, t)) => (f.get(5) == Some(&"1"), t, false),
            None => (false, self.last_ms, true),
        };
        let duration_ms = (end_ms - self.start_ms).max(1);
        let secs = duration_ms as f64 / 1000.0;

        // bosses: inimigos com maior HP máximo (tolerância para lutas de conselho)
        let top_hp = self.enemies.values().map(|e| e.max_hp).max().unwrap_or(0);
        let mut bosses: Vec<BossState> = self
            .enemies
            .iter()
            .filter(|(_, e)| top_hp > 0 && e.max_hp as f64 >= top_hp as f64 * 0.5)
            .map(|(guid, e)| BossState {
                guid: guid.clone(),
                name: e.name.clone(),
                npc_id: npc_id(guid),
                max_hp: e.max_hp,
                hp_pct: Some(if success { 0.0 } else { (e.hp as f32 / e.max_hp as f32 * 100.0).clamp(0.0, 100.0) }),
            })
            .collect();
        bosses.sort_by(|a, b| b.max_hp.cmp(&a.max_hp).then(a.name.cmp(&b.name)));
        bosses.truncate(5);

        let mut defensives_by_player: HashMap<String, HashSet<u32>> = HashMap::new();
        let mut healthstone_users = HashSet::new();
        let mut players: Vec<PlayerStats> = Vec::new();
        for (guid, p) in &self.players {
            if p.name.is_empty() {
                continue; // só apareceu no COMBATANT_INFO (fora do grupo ou sem eventos)
            }
            let spec = p.spec_id.and_then(|s| data.specs.get(&s));
            defensives_by_player.insert(guid.clone(), p.defensive_casts.iter().map(|u| u.spell_id).collect());
            if !p.healthstones.is_empty() {
                healthstone_users.insert(guid.clone());
            }
            let mut taken: Vec<AbilityDamage> = p
                .taken
                .iter()
                .map(|((id, source), (name, amount, hits))| AbilityDamage {
                    spell_id: *id,
                    name: name.clone(),
                    source: source.clone(),
                    amount: *amount,
                    hits: *hits,
                })
                .collect();
            taken.sort_by_key(|a| std::cmp::Reverse(a.amount));
            taken.truncate(15);
            let mut defensives_used: Vec<SpellUse> =
                p.defensive_casts.iter().chain(p.externals_received.iter()).cloned().collect();
            defensives_used.sort_by_key(|u| u.t);
            players.push(PlayerStats {
                guid: guid.clone(),
                name: p.name.clone(),
                class: spec.map(|s| s.class.clone()),
                spec_id: p.spec_id,
                role: spec.map(|s| s.role.clone()),
                damage_done: p.damage_done,
                dps: p.damage_done as f64 / secs,
                healing_done: p.healing_done,
                hps: p.healing_done as f64 / secs,
                damage_taken: p.damage_taken,
                deaths: p.deaths,
                health_potions: p.health_potions.len() as u32,
                healthstones: p.healthstones.len() as u32,
                defensives_used,
                taken_by_ability: taken,
            });
        }
        players.sort_by_key(|a| std::cmp::Reverse(a.damage_done));

        let mut pending = self.deaths;
        for d in &mut pending {
            if let Some(ps) = players.iter().find(|p| p.guid == d.death.guid) {
                d.death.class = ps.class.clone();
                d.death.role = ps.role.clone();
            }
        }

        let mut enemy_spells: Vec<EnemySpell> = self
            .enemy_spells
            .into_iter()
            .map(|(id, e)| {
                let mut sources: Vec<String> = e.sources.into_iter().collect();
                sources.sort();
                EnemySpell { spell_id: id, name: e.name, sources, casts: e.casts, hits_on_players: e.hits, damage_to_players: e.damage }
            })
            .collect();
        enemy_spells.sort_by(|a, b| b.damage_to_players.cmp(&a.damage_to_players).then(b.casts.cmp(&a.casts)));

        FinishedPull {
            pull: Pull {
                id,
                encounter_id: self.encounter_id,
                encounter_name: self.encounter_name,
                difficulty_id: self.difficulty_id,
                difficulty_name: crate::data::difficulty_name(self.difficulty_id).to_string(),
                group_size: self.group_size,
                pull_number: 0,
                start_ms: self.start_ms,
                start_local: self.start_local,
                tz_offset_hours: self.tz_offset_hours,
                duration_ms,
                success,
                incomplete,
                bosses,
                players,
                deaths: Vec::new(),
                enemy_spells,
            },
            pending_deaths: pending,
            defensives_by_player,
            healthstone_users,
        }
    }
}

/// Adiciona ao recap; sem HP no evento, usa o último HP conhecido do player.
fn push_recap(p: &mut PlayerAcc, mut e: RecapEntry) {
    if e.hp_pct.is_none() {
        e.hp_pct = p.last_hp_pct;
    }
    let t = e.t;
    p.recap.push_back(e);
    while p.recap.len() > MAX_RECAP_ENTRIES || p.recap.front().is_some_and(|f| t - f.t > RECAP_WINDOW_MS) {
        p.recap.pop_front();
    }
}

/// Pós-processamento com visão do log inteiro: numeração dos pulls por boss e
/// "defensivos disponíveis" (só conta defensivos que o player usou em algum pull).
pub(crate) fn finalize(finished: Vec<FinishedPull>, data: &GameData) -> Vec<Pull> {
    let mut known: HashMap<String, HashSet<u32>> = HashMap::new();
    let mut hs_known: HashSet<String> = HashSet::new();
    for fp in &finished {
        for (guid, set) in &fp.defensives_by_player {
            known.entry(guid.clone()).or_default().extend(set.iter().copied());
        }
        hs_known.extend(fp.healthstone_users.iter().cloned());
    }

    let mut counters: HashMap<(u32, u32), u32> = HashMap::new();
    finished
        .into_iter()
        .map(|fp| {
            let mut pull = fp.pull;
            let c = counters.entry((pull.encounter_id, pull.difficulty_id)).or_insert(0);
            *c += 1;
            pull.pull_number = *c;
            pull.deaths = fp
                .pending_deaths
                .into_iter()
                .map(|pd| {
                    let mut d = pd.death;
                    d.healthstone_known = hs_known.contains(&d.guid);
                    let mut available: Vec<AvailableSpell> = known
                        .get(&d.guid)
                        .into_iter()
                        .flatten()
                        .filter_map(|id| data.defensives.get(id))
                        .filter(|def| {
                            let last = pd.casts_before.iter().filter(|(sid, _)| *sid == def.id).map(|(_, t)| *t).max();
                            match last {
                                None => true,
                                Some(t) => d.t - t >= def.cd as i64 * 1000,
                            }
                        })
                        .map(|def| AvailableSpell { spell_id: def.id, name: def.name.clone(), kind: def.kind.clone() })
                        .collect();
                    available.sort_by(|a, b| a.name.cmp(&b.name));
                    d.defensives_available = available;
                    d
                })
                .collect();
            pull
        })
        .collect()
}
