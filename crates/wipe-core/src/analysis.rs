//! Análise em streaming: cada linha dentro de um encontro alimenta um `PullBuilder`,
//! que no ENCOUNTER_END vira um `Pull`. Nada do log fica em memória além do estado agregado.

use crate::data::{Consumable, GameData};
use crate::report::*;
use crate::rotation::{RotationBook, RotationTracker};
use crate::rules::{RuleBook, RuleTracker};
use std::collections::{HashMap, HashSet, VecDeque};

/// Janela do death recap.
/// Origem de dano do ambiente (queda, lava...) e de dano sem origem no log: marcadores que a
/// interface traduz (o relatório salvo não fica preso a uma língua).
pub const ENVIRONMENT: &str = "@environment";
pub const NO_SOURCE: &str = "@none";

const RECAP_WINDOW_MS: i64 = 15_000;
/// Janela para "defensivo usado logo antes de morrer".
const RECENT_DEFENSIVE_MS: i64 = 10_000;
const MAX_RECAP_ENTRIES: usize = 150;
const FEIGN_DEATH: u32 = 5384;
/// Histórico de HP guardado por player (para slow death).
const HP_HISTORY_MS: i64 = 60_000;
/// Posição de player mais velha que isso não entra na foto (ele pode ter andado).
const SNAPSHOT_PLAYER_MS: i64 = 5_000;
/// Inimigos grandes mudam pouco de lugar (e nem sempre apanham a todo momento).
const SNAPSHOT_ENEMY_MS: i64 = 15_000;
/// Janela de dano/cura para classificar a morte.
const DEATH_STATS_MS: i64 = 10_000;
/// Uma mecânica "causou" a morte se deu o golpe final ou este % do dano recebido no recap.
const CAUSE_MIN_PCT: f32 = 35.0;
const NIL_GUID: &str = "0000000000000000";

// Flags de unidade (COMBATLOG_OBJECT_*)
const AFFILIATION_GROUP: u32 = 0x1 | 0x2 | 0x4;
/// "meu": a unidade é quem gravou o log
const AFFILIATION_MINE: u32 = 0x1;
/// Tamanho de cada janela da linha do tempo de dano/cura por player.
pub const TIMELINE_MS: i64 = 5_000;
const REACTION_HOSTILE_OR_NEUTRAL: u32 = 0x40 | 0x20;
const TYPE_PLAYER: u32 = 0x400;
/// Tamanhos conhecidos do bloco advanced: 19 no 12.x, 17 em versões anteriores.
const ADVANCED_LENS: [usize; 5] = [19, 17, 20, 21, 18];

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
    /// posição no mundo (jardas)
    x: f32,
    y: f32,
    /// quantidade de campos do bloco (varia entre patches)
    len: usize,
}

fn is_decimal(s: &str) -> bool {
    s.contains('.') && s.parse::<f64>().is_ok()
}

/// O bloco começa com guid,owner,hp,maxHp e termina com posX,posY,uiMapID,facing,level.
/// Os campos do meio mudam entre patches, então o tamanho é descoberto pelo formato do final.
fn advanced_at<'a>(f: &[&'a str], at: usize) -> Option<Advanced<'a>> {
    if f.len() < at + 17 || !is_guid_like(f[at]) {
        return None;
    }
    let hp = f[at + 2].parse::<i64>().ok()?;
    let max_hp = f[at + 3].parse::<i64>().ok()?;
    let len = ADVANCED_LENS.into_iter().find(|&len| {
        f.len() >= at + len && {
            let end = &f[at + len - 5..at + len];
            is_decimal(end[0])
                && is_decimal(end[1])
                && end[2].parse::<i64>().is_ok()
                && is_decimal(end[3])
                && end[4].parse::<i64>().is_ok()
        }
    })?;
    let x = f[at + len - 5].parse().unwrap_or(0.0);
    let y = f[at + len - 4].parse().unwrap_or(0.0);
    Some(Advanced { info_guid: f[at], owner_guid: f[at + 1], hp, max_hp, x, y, len })
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
    max_hp: Option<i64>,
    /// (ms do pull, HP%) dos últimos 60s
    hp_hist: VecDeque<(i64, f32)>,
    /// debuffs ativos: spell id -> estado
    debuffs: HashMap<u32, ActiveDebuff>,
    interrupt_log: Vec<InterruptUse>,
    interrupt_attempts: u32,
    /// última posição vista: (x, y, ms do pull)
    pos: Option<(f32, f32, i64)>,
    /// casts do próprio player (sem pets): spell -> (nome, tempos)
    casts: HashMap<u32, (String, Vec<i64>)>,
    /// dano/cura por habilidade: (spell, veio de pet) -> (nome, total)
    damage_by_spell: HashMap<(u32, bool), (String, i64)>,
    healing_by_spell: HashMap<(u32, bool), (String, i64)>,
    /// morto desde (até voltar a castar: battle rez) e tempo morto acumulado
    dead_since: Option<i64>,
    dead_ms: i64,
    setup: Option<Setup>,
    /// leitura da rotação, para specs com rotação base escrita
    rotation: Option<RotationTracker>,
    /// dano e cura por janela de TIMELINE_MS (pets somados)
    damage_timeline: Vec<i64>,
    healing_timeline: Vec<i64>,
}

fn add_at(v: &mut Vec<i64>, rel: i64, amount: i64) {
    let i = (rel.max(0) / TIMELINE_MS) as usize;
    if v.len() <= i {
        v.resize(i + 1, 0);
    }
    v[i] += amount;
}

struct ActiveDebuff {
    name: String,
    stacks: u32,
    source: String,
    applied_t: i64,
}

struct UnitHp {
    name: String,
    hp: i64,
    max_hp: i64,
    pos: Option<(f32, f32, i64)>,
}

#[derive(Default)]
struct EnemySpellAcc {
    name: String,
    sources: HashSet<String>,
    casts: u32,
    cast_times: Vec<i64>,
    hits: u32,
    damage: i64,
    interrupted: u32,
}

/// Dano/cura por habilidade, maiores primeiro.
/// Linha do tempo cortada no tempo analisado (o resto é depois do corte).
fn timeline(v: &[i64], analyzed_ms: i64) -> Vec<i64> {
    let n = ((analyzed_ms + TIMELINE_MS - 1) / TIMELINE_MS).max(0) as usize;
    // sem nada (healer no dano, dps na cura): vazio, para não pesar o relatório
    if v.iter().all(|&x| x == 0) {
        return Vec::new();
    }
    let mut out: Vec<i64> = v.iter().copied().take(n).collect();
    out.resize(n, 0);
    out
}

fn by_spell(m: &HashMap<(u32, bool), (String, i64)>) -> Vec<SpellAmount> {
    let mut v: Vec<SpellAmount> =
        m.iter().filter(|(_, (_, a))| *a > 0).map(|((id, pet), (name, amount))| SpellAmount { spell_id: *id, name: name.clone(), amount: *amount, pet: *pet }).collect();
    v.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.spell_id.cmp(&b.spell_id)));
    v
}

/// Spec com rotação base escrita: passa a acompanhar os casts e buffs do player.
fn start_rotation(p: &mut PlayerAcc) {
    if p.rotation.is_none() {
        if let Some(spec) = p.spec_id.and_then(|s| RotationBook::embedded().get(s)) {
            p.rotation = Some(RotationTracker::new(spec));
        }
    }
}

/// Morte ainda sem a checagem de defensivos disponíveis (feita depois, com dados do log inteiro).
pub(crate) struct PendingDeath {
    pub death: Death,
    pub casts_before: Vec<(u32, i64)>,
}

pub(crate) struct PullBuilder {
    /// quem gravou o log (flag "meu" nos eventos do próprio player)
    owner: Option<String>,
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
    rules: Option<RuleTracker>,
    /// "ignorar eventos após N mortes" (0 = sem corte)
    death_cutoff: u32,
    /// momento da N-ésima morte; a partir daqui as estatísticas param de contar
    cutoff_t: Option<i64>,
    /// HP dos inimigos no corte
    hp_at_cutoff: HashMap<String, f32>,
    /// segundos do pull em que alguém da raid acertou um inimigo
    raid_active: Vec<bool>,
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
    pub fn start(f: &[&str], t: i64, start_local: &str, tz: f64, book: &RuleBook, death_cutoff: u32) -> Self {
        let encounter_id = f.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
        let encounter_name = f.get(2).unwrap_or(&"?").to_string();
        let difficulty_id = f.get(3).and_then(|v| v.parse().ok()).unwrap_or(0);
        // erros de regra já foram reportados na carga do RuleBook
        let sets = book.for_encounter(encounter_id, &encounter_name);
        let rules = if sets.is_empty() { None } else { RuleTracker::new(&sets, difficulty_id).ok() };
        PullBuilder {
            owner: None,
            encounter_id,
            encounter_name,
            difficulty_id,
            rules,
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
            death_cutoff,
            cutoff_t: None,
            hp_at_cutoff: HashMap::new(),
            raid_active: Vec::new(),
        }
    }

    /// Dono de um pet conhecido de antemão (o Warcraft Logs já diz de quem é cada pet).
    pub(crate) fn set_pet_owner(&mut self, pet: &str, owner: &str) {
        self.pet_owner.insert(pet.to_string(), owner.to_string());
    }

    /// Spec e setup vindos de fora do log (evento combatantinfo do Warcraft Logs).
    pub(crate) fn set_combatant(&mut self, guid: &str, spec: Option<u32>, setup: Setup) {
        let p = self.players.entry(guid.to_string()).or_default();
        if spec.is_some() {
            p.spec_id = spec;
        }
        p.setup = Some(setup);
        start_rotation(p);
    }

    /// Ainda antes do corte: estatísticas contam.
    /// O pull bateu o corte de mortes (as estatísticas pararam numa morte).
    pub fn cut_by_deaths(&self) -> bool {
        self.cutoff_t.is_some()
    }

    fn counting(&self) -> bool {
        self.cutoff_t.is_none()
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
        let rel = self.last_ms - self.start_ms;
        if let Some(p) = self.players.get_mut(adv.info_guid) {
            p.pos = Some((adv.x, adv.y, rel));
            p.last_hp_pct = Some(pct);
            p.max_hp = Some(adv.max_hp);
            if p.hp_hist.back().is_none_or(|&(t, v)| t != rel || v != pct) {
                p.hp_hist.push_back((rel, pct));
            }
            while p.hp_hist.front().is_some_and(|&(t, _)| rel - t > HP_HISTORY_MS) {
                p.hp_hist.pop_front();
            }
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
                pos: None,
            });
            e.hp = adv.hp;
            e.max_hp = adv.max_hp;
            e.pos = Some((adv.x, adv.y, rel));
        }
    }

    /// Posições de todos agora: players vistos nos últimos segundos e os inimigos grandes
    /// (bosses e adds com HP de boss), para o mini mapa.
    fn snapshot(&self, rel: i64) -> Positions {
        let mut units: Vec<UnitPos> = self
            .players
            .iter()
            .filter_map(|(guid, p)| {
                let (x, y, seen) = p.pos?;
                (rel - seen <= SNAPSHOT_PLAYER_MS).then(|| UnitPos { guid: guid.clone(), name: p.name.clone(), kind: "player".into(), x, y, age_ms: rel - seen })
            })
            .collect();
        let top = self.enemies.values().map(|e| e.max_hp).max().unwrap_or(0);
        let mut enemies: Vec<(&String, &UnitHp)> = self
            .enemies
            .iter()
            .filter(|(_, e)| e.hp > 0 && top > 0 && e.max_hp as f64 >= top as f64 * 0.3 && e.pos.is_some_and(|(_, _, seen)| rel - seen <= SNAPSHOT_ENEMY_MS))
            .collect();
        enemies.sort_by_key(|(_, e)| std::cmp::Reverse(e.max_hp));
        for (guid, e) in enemies.into_iter().take(6) {
            let (x, y, seen) = e.pos.unwrap_or_default();
            units.push(UnitPos { guid: guid.clone(), name: e.name.clone(), kind: "enemy".into(), x, y, age_ms: rel - seen });
        }
        units.sort_by(|a, b| a.guid.cmp(&b.guid));
        Positions { t: rel, units }
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
        if self.owner.is_none() && f[1].starts_with("Player-") && f[3].starts_with("0x") && hex(f[3]) & AFFILIATION_MINE != 0 {
            self.owner = Some(f[1].to_string());
        }
        // eventos SPELL_* precisam do prefixo spellId,spellName,school
        if event.starts_with("SPELL_") && f.len() < 12 {
            return;
        }
        match event {
            "COMBATANT_INFO" => self.combatant_info(f),
            "SPELL_DAMAGE" | "SPELL_PERIODIC_DAMAGE" | "RANGE_DAMAGE" | "SPELL_BUILDING_DAMAGE" => {
                self.damage(f, t, 12)
            }
            "SWING_DAMAGE" | "ENVIRONMENTAL_DAMAGE" => self.damage(f, t, 9),
            // hit absorvido inteiro ou imune: não é dano, mas pode aplicar debuff (origem de stacks)
            "SPELL_MISSED" | "SPELL_PERIODIC_MISSED" => {
                if self.counting() && Self::is_group_player(f[5], hex(f[7])) {
                    let rel = self.rel(t);
                    if let Some(r) = self.rules.as_mut() {
                        r.on_missed(f[9].parse().unwrap_or(0), f[5], rel);
                    }
                }
            }
            "SWING_DAMAGE_LANDED" => {
                if let Some(adv) = advanced_at(f, 9) {
                    self.track_advanced(&adv, f);
                }
            }
            "SPELL_HEAL" | "SPELL_PERIODIC_HEAL" => self.heal(f, t),
            "SPELL_CAST_SUCCESS" => self.cast(f, t, data),
            "SPELL_ENERGIZE" => {
                // recurso ganho (sufixo depois do bloco advanced: amount, overEnergize, powerType, maxPower)
                if self.counting() && Self::is_group_player(f[5], hex(f[7])) {
                    let s = 12 + advanced_at(f, 12).map_or(0, |a| a.len);
                    let (amount, over, power) = (num(f.get(s)), num(f.get(s + 1)), num(f.get(s + 2)) as u32);
                    let rel = self.rel(t);
                    if let Some(r) = self.players.get_mut(f[5]).and_then(|p| p.rotation.as_mut()) {
                        r.on_energize(rel, power, f[9].parse().unwrap_or(0), amount, over);
                    }
                }
            }
            "SPELL_CAST_START" | "SPELL_EMPOWER_START" => {
                // começo de um cast com tempo de cast ou de um empower (a leitura da rotação mede o tempo parado)
                if self.counting() && Self::is_group_player(f[1], hex(f[3])) {
                    let (rel, id) = (self.rel(t), f[9].parse().unwrap_or(0));
                    if let Some(r) = self.players.get_mut(f[1]).and_then(|p| p.rotation.as_mut()) {
                        r.on_cast_start(rel, id);
                    }
                }
            }
            "SPELL_AURA_APPLIED" | "SPELL_AURA_REMOVED" => {
                self.aura_state(f, t);
                self.aura(f, t, data)
            }
            "SPELL_AURA_APPLIED_DOSE" | "SPELL_AURA_REMOVED_DOSE" => self.aura_state(f, t),
            "SPELL_INTERRUPT" => self.interrupt(f, t),
            "SPELL_DISPEL" => self.dispel(f, t),
            "SPELL_SUMMON" => {
                if let Some(owner) = self.owner_of(f[1], hex(f[3])) {
                    self.pet_owner.insert(f[5].to_string(), owner);
                }
            }
            "UNIT_DIED" => self.unit_died(f, t),
            _ => {}
        }
    }

    /// Estado de auras: debuffs ativos em cada player (para a foto na morte) e regras do boss
    /// (stacks de debuff em players, enrage em inimigos).
    fn aura_state(&mut self, f: &[&str], t: i64) {
        let rel = self.rel(t);
        let spell_id: u32 = f[9].parse().unwrap_or(0);
        // APPLIED/REMOVED: auraType[,amount]; *_DOSE: auraType,stacks
        let stacks = match f[0] {
            "SPELL_AURA_APPLIED" => 1,
            "SPELL_AURA_REMOVED" => 0,
            _ => f.get(13).and_then(|v| v.parse().ok()).unwrap_or(1),
        };
        let (dst_guid, dst_name) = (f[5], f[6]);
        let is_player = Self::is_group_player(dst_guid, hex(f[7]));
        // debuffs do player (ou do pet) num inimigo: uptime de DoT da rotação
        if !is_player && self.counting() && matches!(f[0], "SPELL_AURA_APPLIED" | "SPELL_AURA_REMOVED") && f.get(12) == Some(&"DEBUFF") && Self::is_enemy(dst_guid, hex(f[7])) {
            if let Some(owner) = self.owner_of(f[1], hex(f[3])) {
                if let Some(r) = self.players.get_mut(&owner).and_then(|p| p.rotation.as_mut()) {
                    r.on_target_aura(rel, dst_guid, spell_id, f[0] == "SPELL_AURA_APPLIED");
                }
            }
        }
        // buffs no player: leitura da rotação (procs, Trick Shots...)
        if is_player && self.counting() {
            if let Some(r) = self.players.get_mut(dst_guid).and_then(|p| p.rotation.as_mut()) {
                r.on_aura(rel, spell_id, stacks);
            }
        }
        if self.counting() {
            if let Some(r) = self.rules.as_mut() {
                r.on_aura(spell_id, dst_guid, dst_name, stacks, is_player, rel);
            }
        }
        if !is_player || f.get(12) != Some(&"DEBUFF") {
            return;
        }
        let mechanic = self.rules.as_ref().and_then(|r| r.aura_mechanic(spell_id)).map(|(n, _)| n.to_string());
        let source = if f[2] == "nil" { NO_SOURCE } else { f[2] };
        let p = self.player(dst_guid, dst_name);
        if stacks == 0 {
            p.debuffs.remove(&spell_id);
            return;
        }
        let d = p.debuffs.entry(spell_id).or_insert_with(|| ActiveDebuff {
            name: f[10].to_string(),
            stacks,
            source: source.to_string(),
            applied_t: rel,
        });
        d.stacks = stacks;
        // debuffs de mecânica aparecem no death recap (ex.: "Eternal Venom (8)")
        if mechanic.is_some() && f[0] != "SPELL_AURA_REMOVED_DOSE" {
            push_recap(
                p,
                RecapEntry {
                    t: rel,
                    kind: RecapKind::Debuff,
                    spell_id,
                    spell_name: if stacks > 1 { format!("{} ({})", f[10], stacks) } else { f[10].to_string() },
                    source: source.to_string(),
                    amount: 0,
                    overkill: 0,
                    absorbed: 0,
                    hp_pct: None,
                },
            );
        }
    }

    /// SPELL_INTERRUPT: sufixo extraSpellId (o cast cortado), extraSpellName, extraSchool.
    fn interrupt(&mut self, f: &[&str], t: i64) {
        if !self.counting() {
            return;
        }
        let rel = self.rel(t);
        let Some(cut_id) = f.get(12).and_then(|v| v.parse::<u32>().ok()) else { return };
        let cut_name = f.get(13).unwrap_or(&"").to_string();
        // o nome vem daqui também: se todo cast foi cortado, nunca houve SPELL_CAST_SUCCESS
        let e = self.enemy_spells.entry(cut_id).or_default();
        e.interrupted += 1;
        if e.name.is_empty() {
            e.name = cut_name.clone();
        }
        e.sources.insert(f[6].to_string()); // quem estava castando (alvo do interrupt)
        // pets (Spell Lock, Axe Toss) contam para o dono
        let Some(owner) = self.owner_of(f[1], hex(f[3])) else { return };
        let owner_name = if owner == f[1] { f[2] } else { "" };
        if let Some(r) = self.rules.as_mut() {
            let label = self.players.get(&owner).map(|p| p.name.clone()).filter(|n| !n.is_empty());
            r.on_interrupt(cut_id, &owner, label.as_deref().unwrap_or(f[2]), f[5], f[6], rel);
        }
        let kick = f[10].to_string();
        let kick_id: u32 = f[9].parse().unwrap_or(0);
        let p = self.player(&owner, owner_name);
        // a tentativa (SPELL_CAST_SUCCESS) vem logo antes: completa ela em vez de duplicar
        match p.interrupt_log.iter_mut().rev().find(|u| u.target_spell_id.is_none() && rel - u.t <= 500) {
            Some(u) => {
                u.target_spell_id = Some(cut_id);
                u.target_spell = Some(cut_name);
            }
            None => p.interrupt_log.push(InterruptUse {
                t: rel,
                spell_id: kick_id,
                spell: kick,
                target_spell_id: Some(cut_id),
                target_spell: Some(cut_name),
            }),
        }
    }

    /// SPELL_DISPEL: quem dispelou (f[1]), de quem (f[5]) e qual debuff (extraSpellId, f[12]).
    fn dispel(&mut self, f: &[&str], t: i64) {
        if !self.counting() {
            return;
        }
        let Some(aura) = f.get(12).and_then(|v| v.parse::<u32>().ok()) else { return };
        let rel = self.rel(t);
        let Some(owner) = self.owner_of(f[1], hex(f[3])) else { return };
        let name = self.players.get(&owner).map(|p| p.name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| f[2].to_string());
        if let Some(r) = self.rules.as_mut() {
            r.on_dispel(aura, f[5], &owner, &name, rel);
        }
    }

    fn combatant_info(&mut self, f: &[&str]) {
        // COMBATANT_INFO,guid,faction,<stats>,specID,[talentos],...
        // A quantidade de stats muda entre patches (21 no 11.x, 22 no 12.x): a spec é o campo
        // imediatamente antes da lista de talentos.
        let Some(guid) = f.get(1) else { return };
        let Some((spec, setup)) = crate::setup::parse_combatant_info(f) else { return };
        let p = self.players.entry(guid.to_string()).or_default();
        if spec.is_some() {
            p.spec_id = spec;
        }
        p.setup = Some(setup);
        start_rotation(p);
    }

    /// `adv_at`: índice onde começa o bloco advanced (depois do prefixo spell, se houver).
    /// Sufixo de dano: amount, baseAmount, overkill, school, resisted, blocked, absorbed, critical, ...
    fn damage(&mut self, f: &[&str], t: i64, adv_at: usize) {
        let adv = advanced_at(f, adv_at);
        if let Some(a) = &adv {
            self.track_advanced(a, f);
        }
        let mut s = adv_at + adv.as_ref().map_or(0, |a| a.len);
        // ENVIRONMENTAL_DAMAGE: o tipo (Falling, Lava, ...) vem depois do bloco advanced
        let env_type = if f[0] == "ENVIRONMENTAL_DAMAGE" {
            s += 1;
            f.get(s - 1).copied().unwrap_or("Environment")
        } else {
            ""
        };
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
            "ENVIRONMENTAL_DAMAGE" => (0u32, env_type.to_string()),
            _ => (f[9].parse().unwrap_or(0), f[10].to_string()),
        };

        let counting = self.counting();
        // dano causado por player (ou pet) em inimigo
        if counting && Self::is_enemy(dst_guid, dst_flags) {
            if let Some(owner) = self.owner_of(src_guid, src_flags) {
                let pet = owner != src_guid;
                let done = (amount - overkill).max(0);
                let rel = self.rel(t);
                // segundo com a raid batendo (o tempo parado da rotação só conta nesses)
                let s = (rel.max(0) / 1000) as usize;
                if self.raid_active.len() <= s {
                    self.raid_active.resize(s + 1, false);
                }
                self.raid_active[s] = true;
                let p = self.player(&owner, if pet { "" } else { src_name });
                // alvos da rotação: só acerto direto do próprio player (pets e ticks de DoT espalhado inflariam a conta)
                if !pet && f[0] != "SPELL_PERIODIC_DAMAGE" {
                    if let Some(r) = p.rotation.as_mut() {
                        r.on_damage(rel, dst_guid);
                    }
                }
                p.damage_done += done;
                add_at(&mut p.damage_timeline, rel, done);
                p.damage_by_spell.entry((spell_id, pet)).or_insert_with(|| (spell_name.clone(), 0)).1 += done;
            }
        }

        // dano tomado por player
        if Self::is_group_player(dst_guid, dst_flags) {
            let source_label = match (src_name, f[0]) {
                (_, "ENVIRONMENTAL_DAMAGE") => ENVIRONMENT.to_string(),
                ("nil" | "", _) => NO_SOURCE.to_string(),
                (name, _) => name.to_string(),
            };
            if counting && (Self::is_enemy(src_guid, src_flags) || src_guid == NIL_GUID) {
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
            if counting {
                let failed = self.rules.as_mut().map(|r| r.on_damage(spell_id, dst_guid, dst_name, amount + absorbed, rel)).unwrap_or_default();
                // falha coletiva nova: guarda onde cada um estava
                if !failed.is_empty() {
                    let snap = self.snapshot(rel);
                    if let Some(r) = self.rules.as_mut() {
                        for i in failed {
                            r.add_snapshot(i, snap.clone());
                        }
                    }
                }
            }
            let p = self.player(dst_guid, dst_name);
            if counting {
                p.damage_taken += amount + absorbed;
                let entry = p.taken.entry((spell_id, source_label.clone())).or_insert((spell_name.clone(), 0, 0));
                entry.1 += amount + absorbed;
                entry.2 += 1;
            }
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
        let s = 12 + adv.as_ref().map_or(0, |a| a.len);
        let effective = match f.len().saturating_sub(s) {
            // 12.x: amount, baseAmount, overheal, absorbed, critical (amount inclui o overheal)
            5.. => (num(f.get(s)) - num(f.get(s + 2)).max(0)).max(0),
            // formato antigo: amount, overheal, absorbed, critical
            _ => (num(f.get(s)) - num(f.get(s + 1)).max(0)).max(0),
        };

        let (src_guid, src_name, src_flags) = (f[1], f[2], hex(f[3]));
        let (dst_guid, dst_name, dst_flags) = (f[5], f[6], hex(f[7]));
        if self.counting() {
            if let Some(owner) = self.owner_of(src_guid, src_flags) {
                let pet = owner != src_guid;
                let rel = self.rel(t);
                let p = self.player(&owner, if pet { "" } else { src_name });
                p.healing_done += effective;
                add_at(&mut p.healing_timeline, rel, effective);
                if effective > 0 {
                    let (id, name) = (f[9].parse().unwrap_or(0), f[10]);
                    p.healing_by_spell.entry((id, pet)).or_insert_with(|| (name.to_string(), 0)).1 += effective;
                }
            }
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

        let counting = self.counting();
        if Self::is_enemy(src_guid, src_flags) {
            if !counting {
                return;
            }
            if let Some(r) = self.rules.as_mut() {
                r.on_enemy_cast(spell_id, src_guid, src_name, rel);
            }
            let e = self.enemy_spells.entry(spell_id).or_default();
            e.name = spell_name;
            e.sources.insert(src_name.to_string());
            e.casts += 1;
            e.cast_times.push(rel);
            return;
        }
        if counting && data.interrupts.contains_key(&spell_id) {
            if let Some(owner) = self.owner_of(src_guid, src_flags) {
                let owner_name = if owner == src_guid { src_name } else { "" };
                let p = self.player(&owner, owner_name);
                p.interrupt_attempts += 1;
                p.interrupt_log.push(InterruptUse { t: rel, spell_id, spell: spell_name.clone(), target_spell_id: None, target_spell: None });
            }
        }
        if !Self::is_group_player(src_guid, src_flags) {
            return;
        }
        let consumable = data.consumable(spell_id, &spell_name);
        let defensive = data.defensives.get(&spell_id).filter(|d| d.kind == "personal").map(|d| d.name.clone());
        let cut = self.cutoff_t;
        let p = self.player(src_guid, src_name);
        if let Some(d) = p.dead_since.take() {
            // voltou (battle rez): o tempo morto conta só até o corte
            p.dead_ms += (cut.map_or(rel, |c| rel.min(c)) - d).max(0);
        }
        if counting {
            p.casts.entry(spell_id).or_insert_with(|| (spell_name.clone(), Vec::new())).1.push(rel);
            if let Some(r) = p.rotation.as_mut() {
                r.on_cast(rel, spell_id);
            }
        }
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
        // inimigo morto: fecha os DoTs que os players tinham nele
        if Self::is_enemy(dst_guid, dst_flags) {
            let rel = self.rel(t);
            for p in self.players.values_mut() {
                if let Some(r) = p.rotation.as_mut() {
                    r.on_enemy_died(rel, dst_guid);
                }
            }
        }
        if !Self::is_group_player(dst_guid, dst_flags) {
            return;
        }
        let rel = self.rel(t);
        let order = self.deaths.len() as u32 + 1;
        // depois do corte a morte fica registrada (recap), mas não conta em nada
        let ignored = !self.counting();
        let positions = (!ignored).then(|| self.snapshot(rel));
        let p = self.player(dst_guid, dst_name);
        if p.feigning {
            return;
        }
        if !ignored {
            p.deaths += 1;
            p.dead_since.get_or_insert(rel);
            if let Some(r) = p.rotation.as_mut() {
                r.on_death(rel);
            }
        }
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
        let stats = death_stats(p, &recap, rel);
        let death_kind = classify_death(&stats).to_string();
        let mut debuffs: Vec<DeathAura> = p
            .debuffs
            .iter()
            .map(|(id, d)| DeathAura {
                spell_id: *id,
                name: d.name.clone(),
                stacks: d.stacks,
                source: d.source.clone(),
                applied_t: d.applied_t,
                mechanic: None,
                tip: None,
            })
            .collect();
        debuffs.sort_by_key(|d| d.applied_t);
        let mut death = Death {
            order,
            guid: dst_guid.to_string(),
            name: p.name.clone(),
            class: None,
            role: None,
            t: rel,
            ignored,
            killing_blow,
            killing_blow_mechanic: None,
            death_kind,
            stats,
            debuffs,
            mechanic_damage: Vec::new(),
            caused_by: None,
            recap,
            defensives_recent,
            defensives_available: Vec::new(),
            used_health_potion: p.health_potions.iter().any(|&x| x <= rel),
            used_healthstone: p.healthstones.iter().any(|&x| x <= rel),
            healthstone_known: false,
            positions,
        };
        p.recap.clear();
        p.debuffs.clear();
        if let Some(r) = self.rules.as_ref() {
            attribute_death(&mut death, r);
        }
        self.deaths.push(PendingDeath { death, casts_before });

        // N-ésima morte: congela as estatísticas daqui em diante
        let counted = self.deaths.iter().filter(|d| !d.death.ignored).count() as u32;
        if !ignored && self.death_cutoff > 0 && counted == self.death_cutoff {
            self.cutoff_t = Some(rel);
            self.hp_at_cutoff = self
                .enemies
                .iter()
                .filter(|(_, e)| e.max_hp > 0)
                .map(|(g, e)| (g.clone(), (e.hp as f32 / e.max_hp as f32 * 100.0).clamp(0.0, 100.0)))
                .collect();
        }
    }

    pub fn finish(mut self, end: Option<(&[&str], i64)>, id: usize, data: &GameData) -> FinishedPull {
        let (success, end_ms, incomplete) = match end {
            // ENCOUNTER_END,id,name,difficulty,size,success,fightTime
            Some((f, t)) => (f.get(5) == Some(&"1"), t, false),
            None => (false, self.last_ms, true),
        };
        let duration_ms = (end_ms - self.start_ms).max(1);
        // médias (DPS/HPS) sobre o tempo analisado: até o corte, se houver
        let analyzed_ms = self.cutoff_t.map_or(duration_ms, |c| c.max(1));
        let secs = analyzed_ms as f64 / 1000.0;
        let cutoff = self.cutoff_t;
        let before_cut = |t: i64| cutoff.is_none_or(|c| t <= c);

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
                hp_pct_at_cutoff: self.hp_at_cutoff.get(guid).copied(),
            })
            .collect();
        bosses.sort_by(|a, b| b.max_hp.cmp(&a.max_hp).then(a.name.cmp(&b.name)));
        bosses.truncate(5);

        let mut defensives_by_player: HashMap<String, HashSet<u32>> = HashMap::new();
        let mut healthstone_users = HashSet::new();
        let mut players: Vec<PlayerStats> = Vec::new();
        // leitura da rotação: até o corte de mortes, como o resto das estatísticas
        let mut rotations: HashMap<String, RotationTracker> = self.players.iter_mut().filter_map(|(g, p)| Some((g.clone(), p.rotation.take()?))).collect();
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
                p.defensive_casts.iter().chain(p.externals_received.iter()).filter(|u| before_cut(u.t)).cloned().collect();
            defensives_used.sort_by_key(|u| u.t);
            let interrupts = p.interrupt_log.iter().filter(|u| u.target_spell_id.is_some()).count() as u32;
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
                health_potions: p.health_potions.iter().filter(|&&t| before_cut(t)).count() as u32,
                healthstones: p.healthstones.iter().filter(|&&t| before_cut(t)).count() as u32,
                defensives_used,
                taken_by_ability: taken,
                interrupts,
                interrupt_attempts: p.interrupt_attempts.max(interrupts),
                can_interrupt: p.interrupt_attempts > 0 || p.spec_id.is_some_and(|s| data.spec_can_interrupt(s)),
                interrupt_log: p.interrupt_log.clone(),
                casts: {
                    let mut v: Vec<SpellCasts> =
                        p.casts.iter().map(|(id, (name, times))| SpellCasts { spell_id: *id, name: name.clone(), times: times.clone() }).collect();
                    v.sort_by(|a, b| b.times.len().cmp(&a.times.len()).then(a.spell_id.cmp(&b.spell_id)));
                    v
                },
                damage_by_spell: by_spell(&p.damage_by_spell),
                healing_by_spell: by_spell(&p.healing_by_spell),
                alive_ms: (analyzed_ms - p.dead_ms.min(analyzed_ms) - p.dead_since.map_or(0, |d| (analyzed_ms - d).max(0))).max(0),
                setup: p.setup.clone(),
                rotation: rotations.remove(guid).map(|r| r.finish(analyzed_ms, &self.raid_active)),
                damage_timeline: timeline(&p.damage_timeline, analyzed_ms),
                healing_timeline: timeline(&p.healing_timeline, analyzed_ms),
            });
        }
        players.sort_by_key(|a| std::cmp::Reverse(a.damage_done));

        let mut pending = self.deaths;
        for d in &mut pending {
            if let Some(ps) = players.iter().find(|p| p.guid == d.death.guid) {
                d.death.class = ps.class.clone();
                d.death.role = ps.role.clone();
            }
            if let (Some(r), Some(kb)) = (self.rules.as_ref(), d.death.killing_blow.as_ref()) {
                d.death.killing_blow_mechanic = r.mechanic_for_damage(kb.spell_id).map(|(_, name)| name.to_string());
            }
        }

        let roles: HashMap<String, String> =
            players.iter().filter_map(|p| Some((p.guid.clone(), p.role.clone()?))).collect();
        let rules_file = self.rules.as_ref().and_then(|r| r.files.first().cloned());
        let deaths_view: Vec<&Death> = pending.iter().map(|d| &d.death).filter(|d| !d.ignored).collect();
        let trigger = pull_trigger(&deaths_view);
        let mechanics = self
            .rules
            .map(|mut r| {
                let deaths: Vec<i64> = pending.iter().map(|d| d.death.t).collect();
                r.close_pull(duration_ms, success, &deaths);
                r.finish(&roles)
            })
            .unwrap_or_default();

        let mut enemy_spells: Vec<EnemySpell> = self
            .enemy_spells
            .into_iter()
            .map(|(id, e)| {
                let mut sources: Vec<String> = e.sources.into_iter().collect();
                sources.sort();
                EnemySpell {
                    spell_id: id,
                    name: e.name,
                    sources,
                    casts: e.casts,
                    cast_times: e.cast_times,
                    hits_on_players: e.hits,
                    damage_to_players: e.damage,
                    interrupted: e.interrupted,
                    interruptible: e.interrupted > 0,
                }
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
                dungeon: crate::data::is_dungeon(self.difficulty_id, self.group_size),
                pull_number: 0,
                pull_number_all: 0,
                start_ms: self.start_ms,
                start_local: self.start_local,
                tz_offset_hours: self.tz_offset_hours,
                duration_ms,
                cutoff_t: self.cutoff_t,
                analyzed_ms,
                success,
                incomplete,
                bosses,
                players,
                deaths: Vec::new(),
                enemy_spells,
                rules_file,
                mechanics,
                trigger,
                owner_guid: self.owner,
            },
            pending_deaths: pending,
            defensives_by_player,
            healthstone_users,
        }
    }
}

/// Números da janela antes da morte (HP ao longo do tempo, dano e cura recebidos).
fn death_stats(p: &PlayerAcc, recap: &[RecapEntry], death_t: i64) -> DeathStats {
    let window: Vec<&RecapEntry> = recap.iter().filter(|e| death_t - e.t <= DEATH_STATS_MS).collect();
    let damage_taken_10s = window.iter().filter(|e| e.kind == RecapKind::Damage).map(|e| e.amount + e.absorbed).sum();
    let healing_received_10s = window.iter().filter(|e| e.kind == RecapKind::Heal).map(|e| e.amount).sum();
    let hist: Vec<(i64, f32)> = p.hp_hist.iter().copied().filter(|&(t, _)| t <= death_t).collect();

    // tempo contínuo abaixo de 50% até a morte
    let below_half_ms = (!hist.is_empty()).then(|| match hist.iter().rposition(|&(_, v)| v >= 50.0) {
        Some(i) => hist.get(i + 1).map_or(0, |&(t, _)| death_t - t),
        None => death_t - hist[0].0, // o histórico todo já estava abaixo de 50%
    });
    // maior HP nos 3s finais, incluindo o HP com que o player entrou na janela
    let start = death_t - 3_000;
    let entering = hist.iter().rev().find(|&&(t, _)| t < start).map(|&(_, v)| v);
    let max_hp_pct_last_3s = hist
        .iter()
        .filter(|&&(t, _)| t >= start)
        .map(|&(_, v)| v)
        .chain(entering)
        .reduce(f32::max);
    let healing_pct_of_max_10s = p.max_hp.filter(|&m| m > 0).map(|m| healing_received_10s as f32 / m as f32 * 100.0);
    DeathStats {
        max_hp: p.max_hp,
        below_half_ms,
        max_hp_pct_last_3s,
        damage_taken_10s,
        healing_received_10s,
        healing_pct_of_max_10s,
        underhealed: healing_pct_of_max_10s.is_some_and(|v| v < 25.0),
    }
}

/// spike: saiu de >= 60% para 0 em até 3s. slow: >= 6s abaixo de 50% antes de morrer.
fn classify_death(s: &DeathStats) -> &'static str {
    match (s.max_hp_pct_last_3s, s.below_half_ms) {
        (Some(hp), _) if hp >= 60.0 => "spike",
        (_, Some(ms)) if ms >= 6_000 => "slow",
        (None, None) => "unknown",
        _ => "normal",
    }
}

/// Liga a morte às mecânicas com falha cujo dano aparece no recap.
fn attribute_death(d: &mut Death, rules: &RuleTracker) {
    let dmg = |e: &RecapEntry| e.amount + e.absorbed;
    let total: i64 = d.recap.iter().filter(|e| e.kind == RecapKind::Damage).map(dmg).sum();
    let mut by_mech: Vec<(String, String, i64)> = Vec::new();
    for e in d.recap.iter().filter(|e| e.kind == RecapKind::Damage) {
        if let Some((key, name)) = rules.failure_mechanic(e.spell_id, dmg(e)) {
            match by_mech.iter_mut().find(|m| m.0 == key) {
                Some(m) => m.2 += dmg(e),
                None => by_mech.push((key.to_string(), name.to_string(), dmg(e))),
            }
        }
    }
    by_mech.sort_by_key(|m| std::cmp::Reverse(m.2));
    d.mechanic_damage = by_mech
        .into_iter()
        .map(|(key, name, amount)| MechanicShare {
            fail_t: rules.last_failure_before(&key, d.t),
            pct: if total > 0 { amount as f32 / total as f32 * 100.0 } else { 0.0 },
            key,
            name,
            amount,
        })
        .collect();
    let kb_mech = d.killing_blow.as_ref().and_then(|kb| rules.failure_mechanic(kb.spell_id, dmg(kb))).map(|(k, _)| k.to_string());
    for a in &mut d.debuffs {
        if let Some((name, tip)) = rules.aura_mechanic(a.spell_id) {
            a.mechanic = Some(name.to_string());
            a.tip = (!tip.is_empty()).then(|| tip.clone());
        }
    }
    d.caused_by = match kb_mech {
        Some(k) => d.mechanic_damage.iter().find(|m| m.key == k).cloned(),
        None => d.mechanic_damage.first().filter(|m| m.pct >= CAUSE_MIN_PCT).cloned(),
    };
}

/// Mecânica que puxou as mortes: a mais cedo entre as que causaram 2+ mortes;
/// senão, a causa da primeira morte.
fn pull_trigger(deaths: &[&Death]) -> Option<PullTrigger> {
    let mut groups: Vec<PullTrigger> = Vec::new();
    for d in deaths {
        let Some(c) = &d.caused_by else { continue };
        let t = c.fail_t.unwrap_or(d.t);
        match groups.iter_mut().find(|g| g.key == c.key) {
            Some(g) => {
                g.deaths += 1;
                g.t = g.t.min(t);
            }
            None => groups.push(PullTrigger { key: c.key.clone(), name: c.name.clone(), t, deaths: 1 }),
        }
    }
    let first_death = deaths.iter().min_by_key(|d| d.t)?;
    groups
        .iter()
        .filter(|g| g.deaths >= 2)
        .min_by_key(|g| g.t)
        .cloned()
        .or_else(|| {
            let c = first_death.caused_by.as_ref()?;
            groups.iter().find(|g| g.key == c.key).cloned()
        })
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
/// Wipes mais curtos que isso são descartados (pull falso, reset, pull de posicionamento).
pub const MIN_PULL_MS: i64 = 30_000;

/// Pós-processamento com visão do log inteiro. Devolve os pulls e quantos wipes curtos
/// foram descartados.
pub(crate) fn finalize(mut finished: Vec<FinishedPull>, data: &GameData) -> (Vec<Pull>, u32) {
    // numeração com todos os pulls (igual à do Warcraft Logs), antes de descartar os curtos
    let mut all: HashMap<(u32, u32), u32> = HashMap::new();
    for fp in &mut finished {
        let c = all.entry((fp.pull.encounter_id, fp.pull.difficulty_id)).or_insert(0);
        *c += 1;
        fp.pull.pull_number_all = *c;
    }
    let total = finished.len();
    let finished: Vec<FinishedPull> =
        finished.into_iter().filter(|fp| fp.pull.success || fp.pull.duration_ms >= MIN_PULL_MS).collect();
    let ignored = (total - finished.len()) as u32;

    let mut known: HashMap<String, HashSet<u32>> = HashMap::new();
    let mut hs_known: HashSet<String> = HashSet::new();
    // casts inimigos cortados em algum pull = interrompíveis; players que tentaram cortar algo
    let mut interruptible: HashSet<u32> = HashSet::new();
    let mut kickers: HashSet<String> = HashSet::new();
    for fp in &finished {
        for (guid, set) in &fp.defensives_by_player {
            known.entry(guid.clone()).or_default().extend(set.iter().copied());
        }
        hs_known.extend(fp.healthstone_users.iter().cloned());
        interruptible.extend(fp.pull.enemy_spells.iter().filter(|e| e.interrupted > 0).map(|e| e.spell_id));
        kickers.extend(fp.pull.players.iter().filter(|p| p.interrupt_attempts > 0).map(|p| p.guid.clone()));
    }

    let mut counters: HashMap<(u32, u32), u32> = HashMap::new();
    let pulls = finished
        .into_iter()
        .enumerate()
        .map(|(idx, fp)| {
            let mut pull = fp.pull;
            pull.id = idx;
            for e in &mut pull.enemy_spells {
                e.interruptible = interruptible.contains(&e.spell_id);
            }
            for p in &mut pull.players {
                p.can_interrupt |= kickers.contains(&p.guid);
            }
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
        .collect();
    (pulls, ignored)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tokenizer::split_fields;

    // Linhas reais do build 12.1.0 (nomes trocados).
    const DMG_12_1: &str = "SPELL_DAMAGE,Player-3209-0B7FC171,\"Fulano-Azralon-US\",0x514,0x80000000,Creature-0-3778-3004-13995-257361-000035B455,\"Vexhul\",0x10a48,0x80000000,8092,\"Mind Blast\",0x20,Creature-0-3778-3004-13995-257361-000035B455,0000000000000000,734281151,734324750,0,0,1470,0,0,0,3,0,100,0,691.57,16.16,2607,3.4732,93,37899,36794,-1,32,0,0,0,nil,nil,nil,ST";
    const ENV_12_1: &str = "ENVIRONMENTAL_DAMAGE,0000000000000000,nil,0x80000000,0x80000000,Player-3209-0B7FC6E4,\"Fulano-Azralon-US\",0x514,0x80000000,Player-3209-0B7FC6E4,0000000000000000,1089460,1243920,4250,657,7380,598,116,0,0,250000,250000,0,530.82,0.16,2607,0.0006,324,Falling,44148,44148,0,1,0,0,0,nil,nil,nil";

    #[test]
    fn detects_advanced_block_length() {
        let mut f = Vec::new();
        split_fields(DMG_12_1, &mut f);
        let a = advanced_at(&f, 12).unwrap();
        assert_eq!((a.len, a.hp, a.max_hp), (19, 734281151, 734324750));
        assert_eq!(f[12 + a.len], "37899");

        // formato antigo com 17 campos
        let legacy = "SPELL_DAMAGE,Player-1-A,\"A\",0x514,0x0,Creature-0-1-2-3-4-5,\"B\",0x10a48,0x0,1,\"X\",0x1,Creature-0-1-2-3-4-5,0000000000000000,50,100,0,0,0,0,0,0,0,0,1.00,2.00,2607,0.5000,80,10,10,-1,1,0,0,0,nil,nil,nil";
        split_fields(legacy, &mut f);
        assert_eq!(advanced_at(&f, 12).unwrap().len, 17);
    }

    #[test]
    fn environmental_damage_reads_type_after_advanced() {
        let data = GameData::embedded();
        let start = ["ENCOUNTER_START", "1", "Boss", "16", "20", "1"];
        let mut b = PullBuilder::start(&start, 0, "", 0.0, &RuleBook::default(), 0);
        let mut f = Vec::new();
        split_fields(ENV_12_1, &mut f);
        b.feed(&f, 1000, &data);
        let p = b.players.get("Player-3209-0B7FC6E4").unwrap();
        assert_eq!(p.damage_taken, 44148);
        let e = p.recap.back().unwrap();
        assert_eq!((e.spell_name.as_str(), e.source.as_str()), ("Falling", ENVIRONMENT));
    }
}
