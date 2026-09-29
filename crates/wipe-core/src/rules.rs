//! Regras por boss (`encounters/*.yaml`) e avaliação delas durante o streaming do log.
//!
//! Formato documentado em `.claude/skills/boss-rules/references/schema.md`.

use crate::report::{MechanicEvent, MechanicPlayer, MechanicResult, Positions};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use yaml_serde::Value;

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/encounters.rs"));
}

/// Hits do mesmo spell com menos que isso de intervalo são a mesma "rajada".
const BURST_MS: i64 = 1_500;
const MAX_EVENTS: usize = 60;
/// Fotos de posição guardadas por mecânica (as primeiras falhas bastam para ver o padrão).
const MAX_SNAPSHOTS: usize = 3;
/// Aura aplicada no mesmo instante do hit (vulnerabilidade do próprio soak) não conta como
/// "já estava com a aura"; e aura removida logo antes do hit (a explosão consome o debuff do
/// portador ~20ms antes do dano) ainda conta como "tinha a aura".
const AURA_GRACE_MS: i64 = 500;
/// Janela em volta do 1º hit de uma falha em que perder uma `culprit_auras` culpa o player.
/// Depois disso a remoção costuma ser pela morte na própria explosão.
const CULPRIT_BEFORE_MS: i64 = 500;
const CULPRIT_AFTER_MS: i64 = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MechanicType {
    AvoidableDamage,
    StackLimit,
    Soak,
    Interrupt,
    CcRequired,
    Spread,
    TankSoak,
    AddKill,
    HpBalance,
    TankRange,
    Positioning,
    Unavoidable,
    Enrage,
    FailureEvent,
    Info,
}

impl MechanicType {
    fn as_str(self) -> &'static str {
        match self {
            Self::AvoidableDamage => "avoidable_damage",
            Self::StackLimit => "stack_limit",
            Self::Soak => "soak",
            Self::Interrupt => "interrupt",
            Self::CcRequired => "cc_required",
            Self::Spread => "spread",
            Self::TankSoak => "tank_soak",
            Self::AddKill => "add_kill",
            Self::HpBalance => "hp_balance",
            Self::TankRange => "tank_range",
            Self::Positioning => "positioning",
            Self::Unavoidable => "unavoidable",
            Self::Enrage => "enrage",
            Self::FailureEvent => "failure_event",
            Self::Info => "info",
        }
    }

    /// Tipos que o motor sabe avaliar hoje.
    fn evaluated(self) -> bool {
        !matches!(self, Self::CcRequired | Self::Spread | Self::AddKill | Self::Info)
    }

    /// Dano do tipo "cada hit é erro de quem tomou".
    fn per_hit_blame(self) -> bool {
        matches!(self, Self::AvoidableDamage | Self::TankRange | Self::Positioning)
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Detect {
    #[serde(default)]
    pub damage_ids: Vec<Option<u32>>,
    pub aura_id: Option<u32>,
    pub cast_id: Option<u32>,
    #[serde(default)]
    pub fail_ids: Vec<Option<u32>>,
    pub soak_aura_id: Option<u32>,
    pub enrage_aura_id: Option<u32>,
    /// dano só conta se o player já estava com esta aura antes do hit (ex.: soak com Feasted)
    pub requires_aura: Option<u32>,
    /// dano não conta em quem tem (ou acabou de perder) esta aura: o portador da mecânica
    pub excludes_aura: Option<u32>,
    /// hits abaixo deste valor não contam (ex.: separar a explosão do tick normal do mesmo spell)
    pub min_amount: Option<i64>,
    /// falha coletiva: culpa quem perdeu uma destas auras no instante da falha (ex.: quem
    /// carregava o orb que explodiu); sem elas, a lista é de quem foi atingido
    #[serde(default)]
    pub culprit_auras: Vec<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Mechanic {
    pub key: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: MechanicType,
    #[serde(default = "default_severity")]
    pub severity: String,
    #[serde(default)]
    pub roles: Vec<String>,
    #[serde(default)]
    pub difficulty: Vec<String>,
    #[serde(default)]
    pub tip: String,
    #[serde(default)]
    pub message: String,
    /// texto por jogador numa falha coletiva (ex.: culpado da explosão); padrão = `message`
    pub blame_message: Option<String>,
    #[serde(default)]
    pub detect: Detect,
    #[serde(default)]
    pub tolerance: u32,
    pub lethal_stacks: Option<u32>,
    pub warn_stacks: Option<u32>,
    #[serde(default)]
    pub ignore_first_hit_in_burst: bool,
}

fn default_severity() -> String {
    "minor".into()
}

#[derive(Debug, Clone)]
pub struct RuleSet {
    pub file: String,
    pub name: String,
    pub encounter_id: Option<u32>,
    /// `scope: global` = vale para todos os encontros
    pub global: bool,
    mechanics: Vec<Value>,
}

impl RuleSet {
    pub fn parse(file: &str, src: &str) -> Result<Self, String> {
        let doc: Value = yaml_serde::from_str(src).map_err(|e| format!("{file}: {e}"))?;
        let name = doc.get("name").and_then(Value::as_str).unwrap_or(file).to_string();
        let encounter_id = doc.get("encounter_id").and_then(Value::as_u64).map(|v| v as u32);
        let mechanics = doc.get("mechanics").and_then(Value::as_sequence).cloned().unwrap_or_default();
        let global = doc.get("scope").and_then(Value::as_str) == Some("global");
        let set = RuleSet { file: file.to_string(), name, encounter_id, global, mechanics };
        // valida já na carga, para erro de YAML aparecer cedo
        for diff in [14, 15, 16] {
            set.mechanics_for(diff)?;
        }
        Ok(set)
    }

    /// Mecânicas que valem para a dificuldade, com `overrides` aplicados.
    pub fn mechanics_for(&self, difficulty_id: u32) -> Result<Vec<Mechanic>, String> {
        let diff = difficulty_key(difficulty_id);
        let mut out = Vec::new();
        for raw in &self.mechanics {
            let mut v = raw.clone();
            if let (Some(diff), Some(map)) = (diff, v.as_mapping_mut()) {
                let ov = map.get("overrides").and_then(|o| o.get(diff)).and_then(Value::as_mapping).cloned();
                if let Some(ov) = ov {
                    for (k, val) in ov {
                        map.insert(k, val);
                    }
                }
            }
            let m: Mechanic = yaml_serde::from_value(v).map_err(|e| format!("{}: {e}", self.file))?;
            let applies = m.difficulty.is_empty() || diff.is_some_and(|d| m.difficulty.iter().any(|x| x == d));
            if applies {
                out.push(m);
            }
        }
        Ok(out)
    }
}

fn file_stem(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn difficulty_key(id: u32) -> Option<&'static str> {
    match id {
        14 | 17 => Some("normal"),
        15 => Some("heroic"),
        16 => Some("mythic"),
        _ => None,
    }
}

/// Conjunto de regras disponíveis (embutidas + pasta do usuário).
#[derive(Debug, Clone, Default)]
pub struct RuleBook {
    pub sets: Vec<RuleSet>,
    pub errors: Vec<String>,
}

impl RuleBook {
    pub fn embedded() -> Self {
        let mut book = RuleBook::default();
        for (file, src) in embedded::EMBEDDED {
            book.add(file, src);
        }
        book
    }

    /// Carrega `*.yaml` de uma pasta; regras com o mesmo `encounter_id` substituem as embutidas.
    pub fn load_dir(&mut self, dir: &Path) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                self.load_dir(&p);
            } else if p.extension().is_some_and(|x| x == "yaml" || x == "yml") {
                match std::fs::read_to_string(&p) {
                    Ok(src) => self.add(&p.display().to_string(), &src),
                    Err(err) => self.errors.push(format!("{}: {err}", p.display())),
                }
            }
        }
    }

    fn add(&mut self, file: &str, src: &str) {
        match RuleSet::parse(file, src) {
            Ok(set) => {
                // mesmo encounter_id (ou mesmo nome de arquivo global) substitui
                self.sets.retain(|s| {
                    if set.global {
                        !(s.global && file_stem(&s.file) == file_stem(&set.file))
                    } else {
                        s.encounter_id.is_none() || s.encounter_id != set.encounter_id
                    }
                });
                self.sets.push(set);
            }
            Err(e) => self.errors.push(e),
        }
    }

    pub fn find(&self, encounter_id: u32, name: &str) -> Option<&RuleSet> {
        let boss = self.sets.iter().filter(|s| !s.global);
        boss.clone()
            .find(|s| s.encounter_id == Some(encounter_id))
            .or_else(|| boss.clone().find(|s| s.encounter_id.is_none() && s.name.eq_ignore_ascii_case(name)))
    }

    /// Regras do boss (se houver) + regras globais.
    pub fn for_encounter(&self, encounter_id: u32, name: &str) -> Vec<&RuleSet> {
        let mut out: Vec<&RuleSet> = self.find(encounter_id, name).into_iter().collect();
        out.extend(self.sets.iter().filter(|s| s.global));
        out
    }
}

// ---------------------------------------------------------------------------
// Avaliação

#[derive(Clone, Copy, PartialEq, Eq)]
enum Hook {
    Damage,
    Fail,
    Aura,
    SoakAura,
    Cast,
    Enrage,
}

#[derive(Default)]
struct PlayerHits {
    name: String,
    count: u32,
    amount: i64,
    stacks: u32,
    max_stacks: u32,
    first_t: Option<i64>,
}

#[derive(Default)]
struct MechState {
    players: HashMap<String, PlayerHits>,
    /// jogadores que cortaram (interrupt) ou soakaram
    credits: HashMap<String, PlayerHits>,
    failures: u32,
    /// momentos das falhas coletivas (explosão, cast não cortado, enrage)
    fail_times: Vec<i64>,
    last_fail_t: Option<i64>,
    last_burst_t: Option<i64>,
    events: Vec<MechanicEvent>,
    snapshots: Vec<Positions>,
}

pub struct RuleTracker {
    /// arquivos de regra usados (boss primeiro, depois globais)
    pub files: Vec<String>,
    mechs: Vec<Mechanic>,
    state: Vec<MechState>,
    hooks: HashMap<u32, Vec<(usize, Hook)>>,
    /// auras que alguma regra precisa acompanhar (requires_aura, excludes_aura, culprit_auras)
    watched_auras: HashSet<u32>,
    /// (guid, aura) -> (aplicada em, removida em)
    auras: HashMap<(String, u32), (i64, Option<i64>)>,
    /// remoções de auras acompanhadas: (t, aura, guid, nome) — para achar culpados depois
    removals: Vec<(i64, u32, String, String)>,
}

impl RuleTracker {
    pub fn new(sets: &[&RuleSet], difficulty_id: u32) -> Result<Self, String> {
        let mut mechs = Vec::new();
        for set in sets {
            mechs.extend(set.mechanics_for(difficulty_id)?);
        }
        let mut hooks: HashMap<u32, Vec<(usize, Hook)>> = HashMap::new();
        let mut watched_auras = HashSet::new();
        for (i, m) in mechs.iter().enumerate() {
            let d = &m.detect;
            let mut add = |id: Option<u32>, h: Hook| {
                if let Some(id) = id {
                    hooks.entry(id).or_default().push((i, h));
                }
            };
            d.damage_ids.iter().for_each(|id| add(*id, Hook::Damage));
            d.fail_ids.iter().for_each(|id| add(*id, Hook::Fail));
            add(d.aura_id, Hook::Aura);
            add(d.soak_aura_id, Hook::SoakAura);
            add(d.cast_id, Hook::Cast);
            add(d.enrage_aura_id, Hook::Enrage);
            watched_auras.extend(d.requires_aura.iter().chain(&d.excludes_aura).chain(&d.culprit_auras));
        }
        let state = mechs.iter().map(|_| MechState::default()).collect();
        let files = sets.iter().map(|s| s.file.clone()).collect();
        Ok(RuleTracker { files, mechs, state, hooks, watched_auras, auras: HashMap::new(), removals: Vec::new() })
    }

    /// O player já estava com a aura antes de `t` (aplicada há pelo menos AURA_GRACE_MS)?
    fn had_aura_before(&self, guid: &str, aura: u32, t: i64) -> bool {
        self.auras
            .get(&(guid.to_string(), aura))
            .is_some_and(|&(applied, removed)| removed.is_none() && t - applied >= AURA_GRACE_MS)
    }

    /// O player está com a aura ou a perdeu há menos de AURA_GRACE_MS?
    fn has_or_just_lost(&self, guid: &str, aura: u32, t: i64) -> bool {
        self.auras
            .get(&(guid.to_string(), aura))
            .is_some_and(|&(_, removed)| removed.is_none_or(|r| t - r <= AURA_GRACE_MS))
    }

    /// Chave e nome da mecânica que causa dano com este spell (para anotar golpes finais).
    pub fn mechanic_for_damage(&self, spell_id: u32) -> Option<(&str, &str)> {
        self.hooks.get(&spell_id)?.iter().find_map(|(i, h)| {
            matches!(h, Hook::Damage | Hook::Fail)
                .then(|| (self.mechs[*i].key.as_str(), self.mechs[*i].name.as_str()))
        })
    }

    /// Mecânica cuja falha este spell representa: `fail_ids`, dano de mecânica evitável
    /// ou dano do debuff acumulativo (stack_limit). Unavoidable não conta.
    /// `amount` = dano do hit (com absorvido), para regras com `min_amount`.
    pub fn failure_mechanic(&self, spell_id: u32, amount: i64) -> Option<(&str, &str)> {
        self.hooks.get(&spell_id)?.iter().find_map(|(i, h)| {
            let m = &self.mechs[*i];
            // regra que depende de aura não dá para confirmar só pelo spell
            let d = &m.detect;
            if d.requires_aura.is_some() || d.excludes_aura.is_some() || d.min_amount.is_some_and(|min| amount < min) {
                return None;
            }
            let is_failure = *h == Hook::Fail
                || (*h == Hook::Damage && (m.kind.per_hit_blame() || m.kind == MechanicType::StackLimit));
            is_failure.then_some((m.key.as_str(), m.name.as_str()))
        })
    }

    /// Última falha coletiva da mecânica até `t`.
    pub fn last_failure_before(&self, key: &str, t: i64) -> Option<i64> {
        let i = self.mechs.iter().position(|m| m.key == key)?;
        self.state[i].fail_times.iter().copied().filter(|&f| f <= t).max()
    }

    /// Mecânica (nome, dica) a que pertence uma aura.
    pub fn aura_mechanic(&self, spell_id: u32) -> Option<(&str, &str)> {
        self.hooks.get(&spell_id)?.iter().find_map(|(i, h)| {
            matches!(h, Hook::Aura | Hook::SoakAura | Hook::Enrage)
                .then(|| (self.mechs[*i].name.as_str(), self.mechs[*i].tip.as_str()))
        })
    }

    /// Primeira falha coletiva registrada (para apontar o gatilho do wipe).
    pub fn failure_times(&self) -> Vec<(i64, &str, &str)> {
        let mut out: Vec<(i64, &str, &str)> = self
            .mechs
            .iter()
            .zip(&self.state)
            .flat_map(|(m, st)| st.fail_times.iter().map(move |&t| (t, m.key.as_str(), m.name.as_str())))
            .collect();
        out.sort_by_key(|x| x.0);
        out
    }

    /// Devolve as mecânicas (índices) que registraram uma falha coletiva nova com este hit.
    pub fn on_damage(&mut self, spell_id: u32, guid: &str, name: &str, amount: i64, t: i64) -> Vec<usize> {
        let mut failed = Vec::new();
        let Some(hooks) = self.hooks.get(&spell_id) else { return failed };
        for &(i, hook) in hooks {
            let m = &self.mechs[i];
            if m.detect.min_amount.is_some_and(|min| amount < min) {
                continue;
            }
            if let Some(aura) = m.detect.excludes_aura {
                if self.has_or_just_lost(guid, aura, t) {
                    continue;
                }
            }
            if hook == Hook::Damage {
                if let Some(aura) = m.detect.requires_aura {
                    if !self.had_aura_before(guid, aura, t) {
                        continue;
                    }
                }
            }
            let st = &mut self.state[i];
            match hook {
                Hook::Fail => {
                    let new_burst = st.last_fail_t.is_none_or(|last| t - last > BURST_MS);
                    if new_burst {
                        st.failures += 1;
                        st.fail_times.push(t);
                        push_event(st, t, None, format!("{} (falha)", m.name));
                        failed.push(i);
                    }
                    st.last_fail_t = Some(t);
                    // failure_event / culprit_auras: a lista é só de culpados (resolvidos no finish),
                    // não de quem foi atingido
                    if m.detect.culprit_auras.is_empty() && m.kind != MechanicType::FailureEvent {
                        bump(&mut st.players, guid, name, amount, t);
                    }
                }
                Hook::Damage => {
                    if m.ignore_first_hit_in_burst {
                        let new_burst = st.last_burst_t.is_none_or(|last| t - last > BURST_MS);
                        st.last_burst_t = Some(t);
                        if new_burst {
                            continue; // primeiro hit da rajada = alvo da mecânica
                        }
                    }
                    if m.kind.per_hit_blame() {
                        bump(&mut st.players, guid, name, amount, t);
                        push_event(st, t, Some(name), m.name.clone());
                    } else if matches!(m.kind, MechanicType::Soak | MechanicType::TankSoak) {
                        bump(&mut st.credits, guid, name, amount, t);
                    }
                }
                _ => {}
            }
        }
        failed
    }

    /// Guarda as posições no momento de uma falha coletiva (só as primeiras de cada mecânica).
    pub fn add_snapshot(&mut self, mech: usize, snap: Positions) {
        let st = &mut self.state[mech];
        if st.snapshots.len() < MAX_SNAPSHOTS {
            st.snapshots.push(snap);
        }
    }

    /// Aura aplicada/removida em qualquer unidade. `stacks` = 0 na remoção total.
    pub fn on_aura(&mut self, spell_id: u32, guid: &str, name: &str, stacks: u32, is_player: bool, t: i64) {
        if self.watched_auras.contains(&spell_id) {
            let key = (guid.to_string(), spell_id);
            if stacks > 0 {
                // dose nova não muda quando a aura começou
                match self.auras.get_mut(&key) {
                    Some(span) if span.1.is_none() => {}
                    _ => {
                        self.auras.insert(key, (t, None));
                    }
                }
            } else {
                if let Some(span) = self.auras.get_mut(&key) {
                    span.1 = Some(t);
                }
                if is_player {
                    self.removals.push((t, spell_id, guid.to_string(), name.to_string()));
                }
            }
        }
        let Some(hooks) = self.hooks.get(&spell_id) else { return };
        for &(i, hook) in hooks {
            let m = &self.mechs[i];
            let st = &mut self.state[i];
            match hook {
                Hook::Aura if is_player && m.kind == MechanicType::StackLimit => {
                    let p = st.players.entry(guid.to_string()).or_default();
                    if p.name.is_empty() {
                        p.name = name.to_string();
                    }
                    p.stacks = stacks;
                    if stacks > p.max_stacks {
                        p.max_stacks = stacks;
                        let warn = m.warn_stacks.unwrap_or(u32::MAX);
                        if stacks == warn || m.lethal_stacks == Some(stacks) {
                            p.first_t.get_or_insert(t);
                            push_event(st, t, Some(name), format!("{} stacks de {}", stacks, m.name));
                        }
                    }
                }
                Hook::SoakAura if is_player && stacks > 0 => bump(&mut st.credits, guid, name, 0, t),
                Hook::Enrage if stacks > 0 => {
                    st.failures += 1;
                    st.fail_times.push(t);
                    push_event(st, t, Some(name), format!("{} em {}", m.name, name));
                }
                _ => {}
            }
        }
    }

    pub fn on_enemy_cast(&mut self, spell_id: u32, source: &str, t: i64) {
        let Some(hooks) = self.hooks.get(&spell_id) else { return };
        for &(i, hook) in hooks {
            if hook == Hook::Cast && self.mechs[i].kind == MechanicType::Interrupt {
                let st = &mut self.state[i];
                st.failures += 1;
                st.fail_times.push(t);
                push_event(st, t, None, format!("{} completou {}", source, self.mechs[i].name));
            }
        }
    }

    pub fn on_interrupt(&mut self, interrupted_spell: u32, guid: &str, name: &str, t: i64) {
        let Some(hooks) = self.hooks.get(&interrupted_spell) else { return };
        for &(i, hook) in hooks {
            if hook == Hook::Cast && self.mechs[i].kind == MechanicType::Interrupt {
                bump(&mut self.state[i].credits, guid, name, 0, t);
            }
        }
    }

    /// `roles`: guid -> role, para não culpar quem a mecânica não envolve.
    pub fn finish(self, roles: &HashMap<String, String>) -> Vec<MechanicResult> {
        let mut out = Vec::new();
        let removals = self.removals;
        for (m, mut st) in self.mechs.into_iter().zip(self.state) {
            if m.kind == MechanicType::Unavoidable {
                continue;
            }
            // culpados de falha coletiva: quem perdeu a aura de portador junto com a falha
            if !m.detect.culprit_auras.is_empty() {
                for &ft in &st.fail_times {
                    for (t, aura, guid, name) in &removals {
                        if m.detect.culprit_auras.contains(aura) && (ft - CULPRIT_BEFORE_MS..=ft + CULPRIT_AFTER_MS).contains(t) {
                            bump(&mut st.players, guid, name, 0, *t);
                        }
                    }
                }
            }
            let role_ok = |guid: &str| m.roles.is_empty() || roles.get(guid).is_some_and(|r| m.roles.contains(r));
            let lethal = m.lethal_stacks;
            let mut players: Vec<MechanicPlayer> = st
                .players
                .iter()
                .filter(|(guid, _)| role_ok(guid))
                .filter_map(|(guid, p)| {
                    let blamed = match m.kind {
                        k if k.per_hit_blame() => p.count > m.tolerance,
                        MechanicType::StackLimit => p.max_stacks >= m.warn_stacks.or(lethal).unwrap_or(u32::MAX),
                        _ => true, // atingidos por falha coletiva (explosão, enrage...)
                    };
                    blamed.then(|| MechanicPlayer {
                        guid: guid.clone(),
                        name: p.name.clone(),
                        count: if m.kind == MechanicType::StackLimit { p.max_stacks } else { p.count },
                        amount: p.amount,
                        first_t: p.first_t,
                        credit: false,
                        message: render(
                            m.blame_message.as_deref().unwrap_or(&m.message),
                            &p.name,
                            if m.kind == MechanicType::StackLimit { p.max_stacks } else { p.count },
                            lethal,
                        ),
                    })
                })
                .collect();
            let collective = matches!(
                m.kind,
                MechanicType::Soak | MechanicType::TankSoak | MechanicType::Interrupt | MechanicType::Enrage | MechanicType::HpBalance | MechanicType::FailureEvent
            );
            let failures = match m.kind {
                _ if collective => st.failures,
                // quantos players passaram do limite de stacks
                MechanicType::StackLimit => players.len() as u32,
                _ => players.iter().map(|p| p.count.saturating_sub(m.tolerance)).sum(),
            };
            // créditos (quem cortou / soakou) vêm depois dos culpados
            players.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));
            let mut credits: Vec<MechanicPlayer> = st
                .credits
                .iter()
                .map(|(guid, p)| MechanicPlayer {
                    guid: guid.clone(),
                    name: p.name.clone(),
                    count: p.count,
                    amount: p.amount,
                    first_t: p.first_t,
                    credit: true,
                    message: String::new(),
                })
                .collect();
            credits.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));
            players.extend(credits);

            let d = &m.detect;
            // ícone: o que o jogador vê — dano, depois a aura, o cast, a falha
            let spell_id = d
                .damage_ids
                .iter()
                .flatten()
                .next()
                .copied()
                .or(d.aura_id)
                .or(d.cast_id)
                .or_else(|| d.fail_ids.iter().flatten().next().copied())
                .or(d.soak_aura_id)
                .or(d.enrage_aura_id);
            out.push(MechanicResult {
                spell_id,
                key: m.key,
                name: m.name,
                kind: m.kind.as_str().to_string(),
                severity: m.severity,
                tip: m.tip,
                evaluated: m.kind.evaluated(),
                failures,
                summary: if collective { render(&m.message, "", st.failures, lethal) } else { String::new() },
                players,
                events: st.events,
                snapshots: st.snapshots,
            });
        }
        let rank = |s: &str| match s {
            "wipe" => 0,
            "major" => 1,
            "minor" => 2,
            _ => 3,
        };
        out.sort_by(|a, b| (a.failures == 0).cmp(&(b.failures == 0)).then(rank(&a.severity).cmp(&rank(&b.severity))).then(b.failures.cmp(&a.failures)));
        out
    }
}

fn bump(map: &mut HashMap<String, PlayerHits>, guid: &str, name: &str, amount: i64, t: i64) {
    let p = map.entry(guid.to_string()).or_default();
    if p.name.is_empty() {
        p.name = name.to_string();
    }
    p.count += 1;
    p.amount += amount;
    p.first_t.get_or_insert(t);
}

fn push_event(st: &mut MechState, t: i64, player: Option<&str>, detail: String) {
    if st.events.len() < MAX_EVENTS {
        st.events.push(MechanicEvent { t, player: player.map(str::to_string), detail });
    }
}

fn render(template: &str, player: &str, count: u32, lethal: Option<u32>) -> String {
    let short = player.split('-').next().unwrap_or(player);
    template
        .replace("{player}", short)
        .replace("{count}", &count.to_string())
        .replace("{stacks}", &count.to_string())
        .replace("{lethal_stacks}", &lethal.map(|l| l.to_string()).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    const YAML: &str = r#"
name: "Boss"
encounter_id: 42
mechanics:
  - key: venom
    name: Venom
    type: stack_limit
    severity: major
    detect: { aura_id: 10 }
    lethal_stacks: 11
    warn_stacks: 8
    overrides:
      mythic: { lethal_stacks: 9, warn_stacks: 3, severity: wipe }
  - key: puddle
    name: Puddle
    type: avoidable_damage
    detect: { damage_ids: [20] }
    tolerance: 1
    message: "{player} pisou {count}x"
  - key: mythic_only
    name: M
    type: interrupt
    difficulty: [mythic]
    detect: { cast_id: 30 }
"#;

    #[test]
    fn applies_overrides_and_difficulty_filter() {
        let set = RuleSet::parse("t.yaml", YAML).unwrap();
        let heroic = set.mechanics_for(15).unwrap();
        assert_eq!(heroic.len(), 2);
        assert_eq!(heroic[0].lethal_stacks, Some(11));
        let mythic = set.mechanics_for(16).unwrap();
        assert_eq!(mythic.len(), 3);
        assert_eq!((mythic[0].lethal_stacks, mythic[0].severity.as_str()), (Some(9), "wipe"));
    }

    #[test]
    fn evaluates_hits_stacks_and_interrupts() {
        let set = RuleSet::parse("t.yaml", YAML).unwrap();
        let mut tr = RuleTracker::new(&[&set], 16).unwrap();
        tr.on_damage(20, "P1", "Um-Realm", 100, 1000);
        tr.on_damage(20, "P1", "Um-Realm", 100, 5000);
        tr.on_damage(20, "P2", "Dois-Realm", 100, 6000); // dentro da tolerância
        for s in 1..=4 {
            tr.on_aura(10, "P2", "Dois-Realm", s, true, 7000 + s as i64);
        }
        tr.on_enemy_cast(30, "Add", 8000);
        tr.on_interrupt(30, "P1", "Um-Realm", 9000);

        let res = tr.finish(&HashMap::new());
        let get = |k: &str| res.iter().find(|r| r.key == k).unwrap();
        let puddle = get("puddle");
        assert_eq!(puddle.failures, 1);
        assert_eq!(puddle.players.len(), 1);
        assert_eq!(puddle.players[0].message, "Um pisou 2x");
        let venom = get("venom");
        assert_eq!(venom.players[0].count, 4);
        assert_eq!(venom.failures, 1, "1 player passou do warn_stacks");
        let int = get("mythic_only");
        assert_eq!(int.failures, 1);
        assert!(int.players[0].credit);
    }

    #[test]
    fn aura_options_amount_and_culprits() {
        let yaml = r#"
name: "Boss"
encounter_id: 43
mechanics:
  - key: detonation
    name: Detonation
    type: failure_event
    detect: { fail_ids: [50], min_amount: 800000, culprit_auras: [51] }
    message: "{count} detonação(ões)"
    blame_message: "{player} carregava o orb"
  - key: bomb
    name: Bomb
    type: avoidable_damage
    detect: { damage_ids: [60], excludes_aura: 61 }
  - key: double
    name: Double
    type: avoidable_damage
    detect: { damage_ids: [70], requires_aura: 71 }
"#;
        let set = RuleSet::parse("t.yaml", yaml).unwrap();
        let mut tr = RuleTracker::new(&[&set], 16).unwrap();
        // tick normal não é falha; explosão sim — culpado é quem perdeu a aura junto
        tr.on_aura(51, "C", "Carrier-R", 1, true, 1_000);
        tr.on_aura(51, "D", "Other-R", 1, true, 1_000);
        tr.on_damage(50, "P1", "Um-R", 300_000, 2_000);
        tr.on_aura(51, "C", "Carrier-R", 0, true, 4_990);
        tr.on_damage(50, "P1", "Um-R", 1_200_000, 5_000);
        tr.on_damage(50, "P2", "Dois-R", 1_100_000, 5_010);
        tr.on_aura(51, "D", "Other-R", 0, true, 9_000); // expirou depois: não é culpado
        // bomba: o portador perdeu a aura 20ms antes do dano e não conta; quem estava perto conta
        tr.on_aura(61, "B", "Bomber-R", 1, true, 10_000);
        tr.on_aura(61, "B", "Bomber-R", 0, true, 15_000);
        tr.on_damage(60, "B", "Bomber-R", 500, 15_020);
        tr.on_damage(60, "P1", "Um-R", 500, 15_020);
        // soak duplo: aura aplicada no próprio hit não conta; a de antes conta
        tr.on_aura(71, "P1", "Um-R", 1, true, 20_000);
        tr.on_damage(70, "P1", "Um-R", 500, 20_000);
        tr.on_damage(70, "P1", "Um-R", 500, 60_000);

        let res = tr.finish(&HashMap::new());
        let get = |k: &str| res.iter().find(|r| r.key == k).unwrap();
        let det = get("detonation");
        assert_eq!(det.failures, 1);
        assert_eq!(det.summary, "1 detonação(ões)");
        assert_eq!(det.players.iter().map(|p| p.message.as_str()).collect::<Vec<_>>(), ["Carrier carregava o orb"]);
        let bomb = get("bomb");
        assert_eq!(bomb.players.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Um-R"]);
        assert_eq!(get("double").players[0].count, 1);
    }

    #[test]
    fn embedded_rules_parse() {
        let book = RuleBook::embedded();
        assert!(book.errors.is_empty(), "{:?}", book.errors);
        assert!(book.find(3421, "The Twin Fangs").is_some());
    }

    #[test]
    fn global_rules_join_boss_rules() {
        let book = RuleBook::embedded();
        let sets = book.for_encounter(3421, "The Twin Fangs");
        assert!(sets.len() >= 2 && !sets[0].global && sets[1..].iter().all(|s| s.global));
        // encontro sem regras próprias ainda recebe as globais
        let other = book.for_encounter(9999, "Outro Boss");
        assert!(!other.is_empty() && other.iter().all(|s| s.global));

        let mut tr = RuleTracker::new(&other, 16).unwrap();
        tr.on_damage(0, "P1", "Um-Realm", 5000, 1000); // queda (ENVIRONMENTAL_DAMAGE)
        let res = tr.finish(&HashMap::new());
        assert_eq!(res.iter().find(|m| m.key == "environmental").unwrap().failures, 1);
    }
}
