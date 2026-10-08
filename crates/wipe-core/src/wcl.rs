//! Warcraft Logs como fonte: os eventos da API v2 (`report.events`) viram os mesmos campos
//! de uma linha do combat log e alimentam o mesmo `PullBuilder` do log local. Assim regras,
//! mortes, notas e mecânicas saem iguais nas duas fontes.
//!
//! Uso: `WclAnalyzer::new` + `add_report` para cada report da noite (fights + masterData),
//! `dedupe` para ficar com uma cópia de cada pull, depois, para cada fight, `begin_fight` →
//! `push_events` (página a página); no fim, `finish`. Nada aqui usa relógio ou disco (roda também no navegador, via wasm).

use crate::analysis::{finalize, FinishedPull, PullBuilder};
use crate::data::GameData;
use crate::report::{GearItem, LogReport, Setup, SetupStats};
use crate::rules::RuleBook;
use crate::timestamp::format_timestamp;
use serde_json::Value;
use std::collections::HashMap;

const NIL_GUID: &str = "0000000000000000";
const FLAGS_PLAYER: &str = "0x514";
const FLAGS_PET: &str = "0x1114";
const FLAGS_ENEMY: &str = "0x10a48";
const FLAGS_FRIENDLY_NPC: &str = "0xa18";
const FLAGS_NONE: &str = "0x80000000";

/// Dificuldade do Warcraft Logs -> id de dificuldade do jogo (o que o log local traz).
pub fn game_difficulty(wcl: u32) -> u32 {
    match wcl {
        1 => 17,  // LFR
        3 => 14,  // normal
        4 => 15,  // heroico
        5 => 16,  // mítico
        10 => 8,  // mítica+
        other => other,
    }
}

#[derive(Debug, Clone)]
struct Actor {
    guid: String,
    name: String,
    kind: ActorKind,
    pet_owner: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum ActorKind {
    Player,
    Pet,
    Npc,
}

/// Fight de boss de um dos reports.
#[derive(Debug, Clone)]
pub struct WclFight {
    /// índice do report (ordem do `add_report`)
    pub report: usize,
    pub id: i64,
    pub encounter_id: u32,
    pub name: String,
    /// id do jogo (14/15/16/17, 8 = M+)
    pub difficulty_id: u32,
    pub kill: bool,
    /// ms relativos ao início do report
    pub start_time: i64,
    pub end_time: i64,
    pub size: u32,
    /// início em epoch ms (para casar o mesmo pull entre reports)
    pub abs_start: i64,
}

/// Dois reports do mesmo pull começam com poucos segundos de diferença (relógio de cada PC).
const SAME_PULL_MS: i64 = 20_000;

/// O pull (boss e início em epoch ms) já está entre estes, vindo de outra fonte? A dificuldade
/// não entra: o mesmo pull não tem duas, mas o log e o WCL podem escrever ids diferentes.
pub fn covered_by(pulls: &[crate::Pull], encounter_id: u32, abs_start: i64) -> bool {
    pulls.iter().any(|p| p.encounter_id == encounter_id && (p.start_ms - abs_start).abs() < SAME_PULL_MS)
}

/// Wipe curto (pull falso / reset): a análise descarta, então nem vale baixar.
pub fn is_short_wipe(f: &WclFight) -> bool {
    !f.kill && f.end_time - f.start_time < crate::analysis::MIN_PULL_MS
}

/// Uma fonte da verdade por pull: o report que cobre mais bosses vale; os outros só entram
/// com os pulls que faltam nele. Devolve os fights escolhidos em ordem de horário.
pub fn dedupe(fights: &[WclFight]) -> Vec<WclFight> {
    let mut coverage: HashMap<usize, usize> = HashMap::new();
    for f in fights {
        *coverage.entry(f.report).or_default() += 1;
    }
    let mut reports: Vec<usize> = coverage.keys().copied().collect();
    reports.sort_by_key(|r| (std::cmp::Reverse(coverage[r]), *r));
    let mut chosen: Vec<WclFight> = Vec::new();
    for r in reports {
        for f in fights.iter().filter(|f| f.report == r) {
            let dup = chosen
                .iter()
                .any(|c| c.encounter_id == f.encounter_id && c.difficulty_id == f.difficulty_id && (c.abs_start - f.abs_start).abs() < SAME_PULL_MS);
            if !dup {
                chosen.push(f.clone());
            }
        }
    }
    chosen.sort_by_key(|f| f.abs_start);
    chosen
}

fn int(v: &Value) -> i64 {
    v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)).unwrap_or(0)
}

/// Atores e habilidades de um report (os ids são por report).
struct Source {
    start_time: i64,
    actors: HashMap<i64, Actor>,
    abilities: HashMap<i64, (String, i64)>,
}

/// Analisa um ou mais reports da mesma noite (de pessoas diferentes da raid) como um log só.
pub struct WclAnalyzer {
    sources: Vec<Source>,
    fights: Vec<WclFight>,
    book: RuleBook,
    data: GameData,
    death_cutoff: u32,
    tz_hours: f64,
    finished: Vec<FinishedPull>,
    current: Option<(WclFight, PullBuilder)>,
    events: u64,
}

impl WclAnalyzer {
    /// `tz_hours`: fuso de quem vê (o WCL guarda em UTC; o log local vem no fuso do PC).
    pub fn new(book: RuleBook, death_cutoff: u32, tz_hours: f64) -> Self {
        WclAnalyzer {
            sources: Vec::new(),
            fights: Vec::new(),
            book,
            data: GameData::embedded(),
            death_cutoff,
            tz_hours,
            finished: Vec::new(),
            current: None,
            events: 0,
        }
    }

    /// Um report só.
    pub fn single(report: &Value, book: RuleBook, death_cutoff: u32, tz_hours: f64) -> Result<Self, String> {
        let mut a = Self::new(book, death_cutoff, tz_hours);
        a.add_report(report, None)?;
        Ok(a)
    }

    /// Report da API: `startTime`, `fights`, `masterData { actors abilities }` e, se houver,
    /// `guild { server { region { slug } } }` (a região completa o nome "Fulano-Reino-US").
    /// Os fights entram em `fights`; para juntar reports da mesma noite, use `dedupe`.
    pub fn add_report(&mut self, report: &Value, region: Option<&str>) -> Result<usize, String> {
        let start_time = int(&report["startTime"]);
        if start_time == 0 {
            return Err(crate::i18n::pick("Report do Warcraft Logs sem startTime.", "Warcraft Logs report without startTime."));
        }
        let index = self.sources.len();
        let region = region
            .map(str::to_string)
            .or_else(|| report["guild"]["server"]["region"]["slug"].as_str().map(str::to_string))
            .unwrap_or_default()
            .to_uppercase();

        let mut actors = HashMap::new();
        for a in report["masterData"]["actors"].as_array().into_iter().flatten() {
            let id = int(&a["id"]);
            let game_id = int(&a["gameID"]);
            let name = a["name"].as_str().unwrap_or("?").to_string();
            let (kind, guid, name) = match a["type"].as_str() {
                Some("Player") => {
                    // o log escreve o reino sem espaços: "Fulano-BurningLegion-EU"
                    let server: String = a["server"].as_str().unwrap_or("").chars().filter(|c| !c.is_whitespace()).collect();
                    let full = match (server.is_empty(), region.is_empty()) {
                        (true, _) => name,
                        (false, true) => format!("{name}-{server}"),
                        (false, false) => format!("{name}-{server}-{region}"),
                    };
                    // o gameID do player é o mesmo em qualquer report: o guid casa entre fontes
                    (ActorKind::Player, format!("Player-0-{:08X}", if game_id > 0 { game_id } else { id }), full)
                }
                Some("Pet") => (ActorKind::Pet, format!("Pet-0-0-{index}-{id}-{game_id}-{id:08X}"), name),
                _ => (ActorKind::Npc, format!("Creature-0-0-{index}-{id}-{game_id}-"), name),
            };
            let pet_owner = a["petOwner"].as_i64();
            actors.insert(id, Actor { guid, name, kind, pet_owner });
        }

        let abilities = report["masterData"]["abilities"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|a| (int(&a["gameID"]), (a["name"].as_str().unwrap_or("?").to_string(), int(&a["type"]))))
            .collect();

        let fights = report["fights"].as_array().into_iter().flatten().filter(|f| int(&f["encounterID"]) > 0);
        self.fights.extend(fights.map(|f| WclFight {
            report: index,
            id: int(&f["id"]),
            encounter_id: int(&f["encounterID"]) as u32,
            name: f["name"].as_str().unwrap_or("?").to_string(),
            difficulty_id: game_difficulty(int(&f["difficulty"]) as u32),
            kill: f["kill"].as_bool().unwrap_or(false),
            start_time: int(&f["startTime"]),
            end_time: int(&f["endTime"]),
            size: int(&f["size"]) as u32,
            abs_start: start_time + int(&f["startTime"]),
        }));
        self.sources.push(Source { start_time, actors, abilities });
        Ok(index)
    }

    /// Fights de boss de todos os reports, na ordem em que entraram.
    pub fn fights(&self) -> &[WclFight] {
        &self.fights
    }

    pub fn begin_fight(&mut self, report: usize, fight_id: i64) -> Result<(), String> {
        self.end_fight();
        let fight = self
            .fights
            .iter()
            .find(|f| f.report == report && f.id == fight_id)
            .cloned()
            .ok_or_else(|| crate::i18n::pick(format!("fight {fight_id} não é de boss"), format!("fight {fight_id} isn't a boss fight")))?;
        let src = &self.sources[report];
        let t = fight.abs_start;
        let start = [
            "ENCOUNTER_START".to_string(),
            fight.encounter_id.to_string(),
            fight.name.clone(),
            fight.difficulty_id.to_string(),
            fight.size.to_string(),
        ];
        let f: Vec<&str> = start.iter().map(String::as_str).collect();
        // kill: sem corte de mortes (a raid seguiu e matou o boss, o resto da luta conta)
        let cutoff = if fight.kill { 0 } else { self.death_cutoff };
        let mut b = PullBuilder::start(&f, t, &format_timestamp(t, self.tz_hours), self.tz_hours, &self.book, cutoff);
        for a in src.actors.values().filter(|a| a.kind == ActorKind::Pet) {
            if let Some(owner) = a.pet_owner.and_then(|o| src.actors.get(&o)).filter(|o| o.kind == ActorKind::Player) {
                b.set_pet_owner(&a.guid, &owner.guid);
            }
        }
        self.current = Some((fight, b));
        Ok(())
    }

    /// Uma página de `events.data` do fight atual.
    pub fn push_events(&mut self, events: &[Value]) {
        let Some((fight, b)) = self.current.as_mut() else { return };
        let src = &self.sources[fight.report];
        let mut fields: Vec<String> = Vec::with_capacity(48);
        for e in events {
            self.events += 1;
            let t = src.start_time + int(&e["timestamp"]);
            if e["type"] == "combatantinfo" {
                if let Some((guid, spec, setup)) = combatant(&src.actors, e) {
                    b.set_combatant(&guid, spec, setup);
                }
                continue;
            }
            fields.clear();
            if !to_fields(&src.actors, &src.abilities, e, &mut fields) {
                continue;
            }
            let f: Vec<&str> = fields.iter().map(String::as_str).collect();
            b.feed(&f, t, &self.data);
        }
    }

    pub fn end_fight(&mut self) {
        let Some((fight, b)) = self.current.take() else { return };
        let t = self.sources[fight.report].start_time + fight.end_time;
        let end = [
            "ENCOUNTER_END".to_string(),
            fight.encounter_id.to_string(),
            fight.name.clone(),
            fight.difficulty_id.to_string(),
            fight.size.to_string(),
            if fight.kill { "1" } else { "0" }.to_string(),
        ];
        let f: Vec<&str> = end.iter().map(String::as_str).collect();
        let id = self.finished.len();
        self.finished.push(b.finish(Some((&f, t)), id, &self.data));
    }

    pub fn finish(mut self) -> LogReport {
        self.end_fight();
        // pulls de reports diferentes: a numeração e o contexto entre pulls seguem o horário
        self.finished.sort_by_key(|fp| fp.pull.start_ms);
        let (pulls, ignored_short_pulls) = finalize(self.finished, &self.data);
        LogReport {
            file: String::new(),
            log_version: None,
            advanced_logging: true,
            lines: self.events,
            parse_ms: 0,
            pulls,
            death_cutoff: self.death_cutoff,
            ignored_short_pulls,
            rule_errors: self.book.errors.iter().chain(&crate::rotation::RotationBook::embedded().errors).cloned().collect(),
            local_logs: Vec::new(),
            wcl_pulls: 0,
        }
    }
}

/// Unidade de um evento: guid, nome e flags (NPC por instância, reação pelo lado do evento).
fn unit(actors: &HashMap<i64, Actor>, e: &Value, side: &str) -> Option<(String, String, &'static str)> {
    // -1 é o ator "Environment": no log, origem vazia (nil)
    let id = int(&e[format!("{side}ID")]);
    if id == -1 {
        return None;
    }
    let a = actors.get(&id)?;
    Some(match a.kind {
        ActorKind::Player => (a.guid.clone(), a.name.clone(), FLAGS_PLAYER),
        ActorKind::Pet => (a.guid.clone(), a.name.clone(), FLAGS_PET),
        ActorKind::Npc => {
            let instance = int(&e[format!("{side}Instance")]);
            let friendly = e[format!("{side}IsFriendly")].as_bool().unwrap_or(false);
            (format!("{}{:010X}", a.guid, instance), a.name.clone(), if friendly { FLAGS_FRIENDLY_NPC } else { FLAGS_ENEMY })
        }
    })
}

fn ability(abilities: &HashMap<i64, (String, i64)>, id: i64) -> (String, String) {
    let (name, school) = abilities.get(&id).cloned().unwrap_or_else(|| (format!("Spell {id}"), 1));
    (name, format!("0x{school:x}"))
}

/// Bloco advanced (19 campos, como no 12.x) a partir dos recursos do evento
/// (`includeResources`): HP e posição de quem `resourceActor` indica (1 = origem, 2 = alvo).
fn advanced(actors: &HashMap<i64, Actor>, e: &Value, src: &str, dst: &str, out: &mut Vec<String>) {
    let max_hp = int(&e["maxHitPoints"]);
    if max_hp <= 0 {
        return;
    }
    let (guid, actor_id) = if int(&e["resourceActor"]) == 1 { (src, int(&e["sourceID"])) } else { (dst, int(&e["targetID"])) };
    let owner = actors
        .get(&actor_id)
        .and_then(|a| a.pet_owner)
        .and_then(|o| actors.get(&o))
        .map_or(NIL_GUID.to_string(), |o| o.guid.clone());
    // o WCL guarda a posição em centésimos de jarda e com os eixos girados: (x, y) = (-yLog, xLog)
    let (x, y) = (int(&e["y"]) as f64 / 100.0, -int(&e["x"]) as f64 / 100.0);
    let facing = int(&e["facing"]) as f64 / 100.0;
    out.extend([
        guid.to_string(),
        owner,
        int(&e["hitPoints"]).to_string(),
        max_hp.to_string(),
        int(&e["attackPower"]).to_string(),
        int(&e["spellPower"]).to_string(),
        int(&e["armor"]).to_string(),
        int(&e["absorb"]).to_string(),
        "0".into(),
        "0".into(),
        "0".into(),
        "0".into(),
        "0".into(),
        "0".into(),
        format!("{x:.2}"),
        format!("{y:.2}"),
        int(&e["mapID"]).to_string(),
        format!("{facing:.4}"),
        int(&e["itemLevel"]).max(1).to_string(),
    ]);
}

/// Evento da API -> campos de uma linha do combat log. `false` = evento que o motor não usa.
fn to_fields(actors: &HashMap<i64, Actor>, abilities: &HashMap<i64, (String, i64)>, e: &Value, out: &mut Vec<String>) -> bool {
    let kind = e["type"].as_str().unwrap_or("");
    let src = unit(actors, e, "source");
    let dst = unit(actors, e, "target");
    let (src_guid, src_name, src_flags) = src.clone().unwrap_or((NIL_GUID.into(), "nil".into(), FLAGS_NONE));
    let (dst_guid, dst_name, dst_flags) = dst.clone().unwrap_or((NIL_GUID.into(), "nil".into(), FLAGS_NONE));
    let spell_id = int(&e["abilityGameID"]);
    let (spell_name, school) = ability(abilities, spell_id);
    let tick = e["tick"].as_bool().unwrap_or(false);

    let event = match kind {
        // golpes absorvidos por inteiro: no log são SPELL_MISSED (ABSORB), que o motor não conta
        "damage" if int(&e["amount"]) == 0 => return false,
        // queda, lava, afogamento...; magias sem origem (sourceID -1 também) são SPELL_DAMAGE
        "damage" if int(&e["sourceID"]) == -1 && (1..100).contains(&spell_id) => "ENVIRONMENTAL_DAMAGE",
        "damage" if spell_id == 1 => "SWING_DAMAGE",
        "damage" if tick => "SPELL_PERIODIC_DAMAGE",
        "damage" => "SPELL_DAMAGE",
        "heal" if tick => "SPELL_PERIODIC_HEAL",
        "heal" => "SPELL_HEAL",
        "cast" => "SPELL_CAST_SUCCESS",
        // começo de cast / empower (o app não baixa; os tops da calibração da rotação sim)
        "begincast" => "SPELL_CAST_START",
        "empowerstart" => "SPELL_EMPOWER_START",
        "applybuff" | "applydebuff" => "SPELL_AURA_APPLIED",
        "removebuff" | "removedebuff" => "SPELL_AURA_REMOVED",
        "applybuffstack" | "applydebuffstack" => "SPELL_AURA_APPLIED_DOSE",
        "removebuffstack" | "removedebuffstack" => "SPELL_AURA_REMOVED_DOSE",
        "interrupt" => "SPELL_INTERRUPT",
        "dispel" => "SPELL_DISPEL",
        "summon" => "SPELL_SUMMON",
        "resourcechange" => "SPELL_ENERGIZE",
        "death" => "UNIT_DIED",
        _ => return false,
    };
    out.extend([event.to_string(), src_guid.clone(), src_name, src_flags.into(), "0x0".into(), dst_guid.clone(), dst_name, dst_flags.into(), "0x0".into()]);

    match event {
        "UNIT_DIED" => {
            // UNIT_DIED não tem origem; o morto é o alvo
            out[1] = NIL_GUID.into();
            out[2] = "nil".into();
            out[3] = FLAGS_NONE.into();
            out.push("0".into());
        }
        "SWING_DAMAGE" | "ENVIRONMENTAL_DAMAGE" => {
            advanced(actors, e, &src_guid, &dst_guid, out);
            if event == "ENVIRONMENTAL_DAMAGE" {
                out.push(spell_name);
            }
            damage_suffix(e, &school, out);
        }
        _ => {
            out.extend([spell_id.to_string(), spell_name, school.clone()]);
            match event {
                "SPELL_DAMAGE" | "SPELL_PERIODIC_DAMAGE" => {
                    advanced(actors, e, &src_guid, &dst_guid, out);
                    damage_suffix(e, &school, out);
                }
                "SPELL_HEAL" | "SPELL_PERIODIC_HEAL" => {
                    advanced(actors, e, &src_guid, &dst_guid, out);
                    // 12.x: amount, baseAmount, overheal, absorbed, critical; no WCL amount já é o efetivo
                    let (amount, overheal) = (int(&e["amount"]), int(&e["overheal"]));
                    let total = (amount + overheal).to_string();
                    out.extend([total.clone(), total, overheal.to_string(), int(&e["absorbed"]).to_string(), "nil".into()]);
                }
                "SPELL_CAST_SUCCESS" => advanced(actors, e, &src_guid, &dst_guid, out),
                "SPELL_ENERGIZE" => {
                    advanced(actors, e, &src_guid, &dst_guid, out);
                    // amount, overEnergize, powerType, maxPower (no WCL o resourceChange já inclui o desperdício;
                    // no log o amount vem sem ele)
                    out.extend([(int(&e["resourceChange"]) - int(&e["waste"])).max(0).to_string(), int(&e["waste"]).to_string(), int(&e["resourceChangeType"]).to_string(), int(&e["maxResourceAmount"]).to_string()]);
                }
                "SPELL_AURA_APPLIED" | "SPELL_AURA_REMOVED" => out.push(aura_type(kind).into()),
                "SPELL_AURA_APPLIED_DOSE" | "SPELL_AURA_REMOVED_DOSE" => {
                    out.push(aura_type(kind).into());
                    out.push(int(&e["stack"]).to_string());
                }
                "SPELL_INTERRUPT" | "SPELL_DISPEL" => {
                    let extra = int(&e["extraAbilityGameID"]);
                    let (extra_name, extra_school) = ability(abilities, extra);
                    out.extend([extra.to_string(), extra_name, extra_school]);
                    if event == "SPELL_DISPEL" {
                        out.push(if e["isBuff"].as_bool().unwrap_or(false) { "BUFF" } else { "DEBUFF" }.into());
                    }
                }
                _ => {}
            }
        }
    }
    true
}

fn aura_type(kind: &str) -> &'static str {
    if kind.contains("debuff") {
        "DEBUFF"
    } else {
        "BUFF"
    }
}

/// amount, baseAmount, overkill, school, resisted, blocked, absorbed, critical, glancing, crushing
fn damage_suffix(e: &Value, school: &str, out: &mut Vec<String>) {
    // no WCL o amount não inclui o overkill; no log, inclui
    let overkill = e.get("overkill").map_or(-1, int);
    let amount = int(&e["amount"]) + overkill.max(0);
    out.extend([
        amount.to_string(),
        int(&e["unmitigatedAmount"]).max(amount).to_string(),
        overkill.to_string(),
        school.to_string(),
        int(&e["resisted"]).to_string(),
        int(&e["blocked"]).to_string(),
        int(&e["absorbed"]).to_string(),
        if int(&e["hitType"]) == 2 { "1" } else { "nil" }.into(),
        "nil".into(),
        "nil".into(),
    ]);
}

/// Evento `combatantinfo`: spec, atributos, talentos e equipamento do player.
fn combatant(actors: &HashMap<i64, Actor>, e: &Value) -> Option<(String, Option<u32>, Setup)> {
    let a = actors.get(&int(&e["sourceID"])).filter(|a| a.kind == ActorKind::Player)?;
    let n = |k: &str| int(&e[k]).max(0) as u32;
    let spec = Some(n("specID")).filter(|&s| s > 0);
    let stats = SetupStats {
        strength: n("strength"),
        agility: n("agility"),
        stamina: n("stamina"),
        intellect: n("intellect"),
        crit: n("critMelee").max(n("critSpell")).max(n("critRanged")),
        haste: n("hasteMelee").max(n("hasteSpell")).max(n("hasteRanged")),
        mastery: n("mastery"),
        versatility: n("versatilityDamageDone"),
        leech: n("leech"),
        avoidance: n("avoidance"),
        speed: n("speed"),
    };
    let talents = e["talentTree"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|t| [int(&t["nodeID"]) as u32, int(&t["id"]) as u32, int(&t["rank"]) as u32])
        .collect();
    let items: Vec<GearItem> = e["gear"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter(|(_, g)| int(&g["id"]) > 0)
        .map(|(slot, g)| GearItem {
            slot: g.get("slot").map_or(slot as i64, int) as u8,
            item_id: int(&g["id"]) as u32,
            ilvl: int(&g["itemLevel"]) as u32,
            enchant: Some(int(&g["permanentEnchant"]) as u32).filter(|&v| v > 0),
            gems: g["gems"].as_array().into_iter().flatten().map(|x| int(&x["id"]) as u32).filter(|&v| v > 0).collect(),
        })
        .collect();
    Some((a.guid.clone(), spec, Setup { stats, item_level: crate::setup::item_level(&items), items, talents }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn report() -> Value {
        json!({
            "startTime": 1_790_730_000_000i64,
            "guild": { "server": { "region": { "slug": "us" } } },
            "fights": [
                { "id": 1, "encounterID": 0, "name": "Trash", "difficulty": 0, "kill": true, "startTime": 0, "endTime": 5000, "size": 20 },
                { "id": 2, "encounterID": 3470, "name": "Nek'zali the Soulcoiler", "difficulty": 5, "kill": false, "startTime": 10_000, "endTime": 100_000, "size": 20 }
            ],
            "masterData": {
                "actors": [
                    { "id": 5, "gameID": 111, "name": "Fulano", "server": "Azralon", "type": "Player", "subType": "Mage" },
                    { "id": 6, "gameID": 222, "name": "Ciclano", "server": "Burning Legion", "type": "Player", "subType": "Priest" },
                    { "id": 7, "gameID": 416, "name": "Imp", "type": "Pet", "petOwner": 5 },
                    { "id": 30, "gameID": 250000, "name": "Nek'zali", "type": "NPC" }
                ],
                "abilities": [
                    { "gameID": 1, "name": "Melee", "type": 1 },
                    { "gameID": 133, "name": "Fireball", "type": 4 },
                    { "gameID": 1284034, "name": "Uncoiled Rage", "type": 32 }
                ]
            }
        })
    }

    fn fight(report: usize, id: i64, encounter_id: u32, abs_start: i64) -> WclFight {
        WclFight { report, id, encounter_id, name: String::new(), difficulty_id: 16, kill: false, start_time: 0, end_time: 0, size: 20, abs_start }
    }

    #[test]
    fn one_copy_of_each_pull_from_the_most_complete_report() {
        // report 1 cobre mais; o 0 tem um pull que falta no 1 (e o relógio 2s atrasado)
        let fights = vec![
            fight(0, 1, 3470, 1_000),
            fight(0, 2, 3470, 60_000),
            fight(1, 7, 3470, 2_000),
            fight(1, 8, 3445, 120_000),
            fight(1, 9, 3445, 200_000),
        ];
        let got: Vec<(usize, i64)> = dedupe(&fights).iter().map(|f| (f.report, f.id)).collect();
        assert_eq!(got, vec![(1, 7), (0, 2), (1, 8), (1, 9)]);
    }

    #[test]
    fn local_log_first_then_only_the_missing_pulls() {
        // log do PC: 2 pulls do Nek'zali (a dificuldade pode vir diferente entre as fontes)
        let mut a = WclAnalyzer::single(&report(), RuleBook::embedded(), 0, -3.0).unwrap();
        a.begin_fight(0, 2).unwrap();
        let local = a.finish().pulls;
        assert_eq!(local.len(), 1);
        let start = local[0].start_ms;
        assert!(covered_by(&local, 3470, start + 1_800), "mesmo pull, relógio de outro PC");
        assert!(!covered_by(&local, 3470, start + 60_000), "outro pull do mesmo boss");
        assert!(!covered_by(&local, 3445, start), "outro boss");

        let mut later = local[0].clone();
        later.start_ms += 600_000;
        let merged = crate::merge_pulls(vec![later, local[0].clone()]);
        assert_eq!(merged.iter().map(|p| (p.id, p.pull_number)).collect::<Vec<_>>(), vec![(0, 1), (1, 2)]);
        assert_eq!(merged[0].start_ms, start);
    }

    #[test]
    fn converts_events_into_a_pull() {
        let mut a = WclAnalyzer::single(&report(), RuleBook::embedded(), 0, -3.0).unwrap();
        assert_eq!(a.fights().len(), 1, "trash fica de fora");
        assert_eq!(a.fights()[0].difficulty_id, 16);
        a.begin_fight(0, 2).unwrap();
        a.push_events(&[
            json!({ "timestamp": 10_000, "type": "combatantinfo", "sourceID": 5, "specID": 63, "intellect": 3000, "gear": [], "talentTree": [] }),
            json!({ "timestamp": 11_000, "type": "cast", "sourceID": 5, "sourceIsFriendly": true, "targetID": 30, "targetIsFriendly": false, "abilityGameID": 133 }),
            json!({ "timestamp": 12_000, "type": "damage", "sourceID": 5, "sourceIsFriendly": true, "targetID": 30, "targetIsFriendly": false, "abilityGameID": 133,
                    "amount": 50_000, "hitType": 1, "resourceActor": 2, "hitPoints": 900_000, "maxHitPoints": 1_000_000, "x": 69157, "y": 1616 }),
            json!({ "timestamp": 13_000, "type": "damage", "sourceID": 7, "sourceIsFriendly": true, "targetID": 30, "targetIsFriendly": false, "abilityGameID": 1, "amount": 1_000 }),
            json!({ "timestamp": 20_000, "type": "damage", "sourceID": 30, "sourceIsFriendly": false, "targetID": 6, "targetIsFriendly": true, "abilityGameID": 1284034,
                    "amount": 75_000, "overkill": 5_000, "absorbed": 2_000, "resourceActor": 2, "hitPoints": 0, "maxHitPoints": 75_000, "x": 100, "y": 200 }),
            json!({ "timestamp": 20_010, "type": "death", "sourceID": 30, "targetID": 6, "targetIsFriendly": true, "abilityGameID": 1284034 }),
        ]);
        let r = a.finish();
        assert_eq!(r.pulls.len(), 1);
        let p = &r.pulls[0];
        assert_eq!((p.encounter_id, p.difficulty_id, p.success), (3470, 16, false));
        assert_eq!(p.start_local, "9/29/2026 22:00:10.000-3");
        let mage = p.players.iter().find(|x| x.name == "Fulano-Azralon-US").expect("mage");
        assert_eq!(mage.damage_done, 51_000, "pet conta para o dono");
        assert_eq!(mage.spec_id, Some(63));
        let priest = p.players.iter().find(|x| x.name == "Ciclano-BurningLegion-US").expect("priest");
        assert_eq!(priest.damage_taken, 82_000);
        assert_eq!(p.deaths.len(), 1);
        let kb = p.deaths[0].killing_blow.as_ref().expect("golpe final");
        assert_eq!((kb.spell_id, kb.overkill), (1_284_034, 5_000));
        assert_eq!(p.bosses[0].hp_pct, Some(90.0));
    }
}
