//! Regras por boss (`encounters/*.yaml`) e avaliação delas durante o streaming do log.
//!
//! Formato documentado em `.claude/skills/boss-rules/references/schema.md`.

use crate::i18n::Text;
use crate::tx;
use crate::report::{CastOutcome, DispelOutcome, MechanicEvent, MechanicPlayer, MechanicResult, PhaseWindow, Positions};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use yaml_serde::Value;

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/encounters.rs"));
}

/// Regras embutidas no binário: (caminho, conteúdo).
pub fn embedded_sources() -> &'static [(&'static str, &'static str)] {
    embedded::EMBEDDED
}

/// Hits do mesmo spell com menos que isso de intervalo são a mesma "rajada".
const BURST_MS: i64 = 1_500;
const MAX_EVENTS: usize = 60;
/// Fotos de posição guardadas por mecânica (as primeiras falhas bastam para ver o padrão).
const MAX_SNAPSHOTS: usize = 3;
/// SPELL_DISPEL chega logo depois do SPELL_AURA_REMOVED do mesmo debuff.
const DISPEL_AFTER_REMOVAL_MS: i64 = 250;
/// Aura aplicada no mesmo instante do hit (vulnerabilidade do próprio soak) não conta como
/// "já estava com a aura"; e aura removida logo antes do hit (a explosão consome o debuff do
/// portador ~20ms antes do dano) ainda conta como "tinha a aura".
const AURA_GRACE_MS: i64 = 500;
/// Janela em volta do 1º hit de uma falha em que perder uma `culprit_auras` culpa o player.
/// Depois disso a remoção costuma ser pela morte na própria explosão.
const CULPRIT_BEFORE_MS: i64 = 500;
const CULPRIT_AFTER_MS: i64 = 50;
/// Fase que termina tão perto do fim de um wipe acabou pelo reset do boss, não pelo raid.
const PHASE_WIPE_SLACK_MS: i64 = 1_500;
/// Mortes dentro de uma fase que mostram que a mecânica deu errado (não só alguém azarado).
const PHASE_FAIL_DEATHS: u32 = 3;

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
    Dispel,
    PhaseDuration,
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
            Self::Dispel => "dispel",
            Self::PhaseDuration => "phase_duration",
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
    pub tip: Text,
    #[serde(default)]
    pub message: Text,
    /// texto por jogador numa falha coletiva (ex.: culpado da explosão); padrão = `message`
    pub blame_message: Option<Text>,
    #[serde(default)]
    pub detect: Detect,
    #[serde(default)]
    pub tolerance: u32,
    pub lethal_stacks: Option<u32>,
    pub warn_stacks: Option<u32>,
    #[serde(default)]
    pub ignore_first_hit_in_burst: bool,
    /// dispel: segundos até o dispel antes de contar como atrasado
    pub max_delay: Option<f64>,
    /// phase_duration: segundos de uma fase bem feita, e acima de quanto conta como lenta
    pub target_s: Option<f64>,
    pub max_s: Option<f64>,
    /// ajustes do usuário (preenchidos pela camada de ajustes, não pelo YAML)
    #[serde(default)]
    pub focus: bool,
    #[serde(default)]
    pub tuned: Vec<String>,
    #[serde(default)]
    pub custom: bool,
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

// ---------------------------------------------------------------------------
// Ajustes do usuário

/// Campos de uma mecânica que o usuário pode ajustar sem editar a regra.
pub const TUNABLE_FIELDS: &[&str] = &["severity", "tolerance", "warn_stacks", "lethal_stacks", "max_delay", "target_s", "max_s", "roles", "tip", "message", "focus"];

/// Ajustes de um boss: uma camada por cima da regra (só o que mudou), para os ajustes
/// continuarem valendo quando a regra do app for atualizada.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Tuning {
    pub encounter_id: u32,
    /// nome do boss (para regras criadas em bosses sem regra no app)
    #[serde(default)]
    pub name: Option<String>,
    /// key da mecânica -> campos ajustados (`enabled: false` desliga)
    #[serde(default)]
    pub mechanics: BTreeMap<String, serde_json::Map<String, serde_json::Value>>,
    /// mecânicas criadas pelo usuário, no mesmo formato do YAML
    #[serde(default)]
    pub custom: Vec<serde_json::Value>,
}

fn to_yaml(v: &serde_json::Value) -> Value {
    yaml_serde::to_value(v).unwrap_or(Value::Null)
}

impl RuleSet {
    /// Mecânicas como estão no arquivo (sem ajustes nem overrides), para a tela de ajustes.
    pub fn raw_mechanics(&self) -> &[Value] {
        &self.mechanics
    }

    /// Esta regra com os ajustes aplicados (e as mecânicas criadas pelo usuário no fim).
    fn tuned(&self, t: &Tuning) -> Result<RuleSet, String> {
        let mut mechanics = Vec::new();
        for raw in &self.mechanics {
            let key = raw.get("key").and_then(Value::as_str).unwrap_or_default();
            let Some(ov) = t.mechanics.get(key) else {
                mechanics.push(raw.clone());
                continue;
            };
            if ov.get("enabled").and_then(serde_json::Value::as_bool) == Some(false) {
                continue;
            }
            let mut m = raw.clone();
            let Some(map) = m.as_mapping_mut() else { continue };
            let mut changed = Vec::new();
            for field in TUNABLE_FIELDS {
                let Some(val) = ov.get(*field) else { continue };
                map.insert(Value::from(*field), to_yaml(val));
                // o ajuste vale em todas as dificuldades: sai dos `overrides` da regra
                if let Some(ovs) = map.get_mut("overrides").and_then(Value::as_mapping_mut) {
                    for (_, diff) in ovs.iter_mut() {
                        if let Some(d) = diff.as_mapping_mut() {
                            d.remove(*field);
                        }
                    }
                }
                if *field != "focus" {
                    changed.push(Value::from(*field));
                }
            }
            map.insert(Value::from("tuned"), Value::Sequence(changed));
            mechanics.push(m);
        }
        for c in &t.custom {
            let mut m = to_yaml(c);
            if let Some(map) = m.as_mapping_mut() {
                map.insert(Value::from("custom"), Value::Bool(true));
            }
            mechanics.push(m);
        }
        let set = RuleSet { file: format!("{} + ajustes", self.file), mechanics, ..self.clone() };
        for diff in [14, 15, 16] {
            set.mechanics_for(diff)?;
        }
        Ok(set)
    }
}

/// Conjunto de regras disponíveis (embutidas + pasta do usuário + ajustes).
#[derive(Debug, Clone, Default)]
pub struct RuleBook {
    pub sets: Vec<RuleSet>,
    pub errors: Vec<String>,
    /// regras de boss com os ajustes do usuário aplicados, por encounter_id
    tuned: HashMap<u32, RuleSet>,
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

    /// Aplica os ajustes de um boss. Ajuste inválido vai para `errors` e o boss usa a regra padrão.
    pub fn apply_tuning(&mut self, t: &Tuning) -> Result<(), String> {
        let base = self.base(t.encounter_id).cloned().unwrap_or_else(|| RuleSet {
            file: format!("ajustes/{}", t.encounter_id),
            name: t.name.clone().unwrap_or_else(|| format!("encounter {}", t.encounter_id)),
            encounter_id: Some(t.encounter_id),
            global: false,
            mechanics: Vec::new(),
        });
        match base.tuned(t) {
            Ok(set) => {
                self.tuned.insert(t.encounter_id, set);
                Ok(())
            }
            Err(e) => {
                let msg = crate::i18n::pick(format!("ajustes do boss {}: {e}", t.encounter_id), format!("boss adjustments {}: {e}", t.encounter_id));
                self.errors.push(msg.clone());
                Err(msg)
            }
        }
    }

    /// Carrega os ajustes (`<encounter_id>.json`) de uma pasta.
    pub fn load_tuning_dir(&mut self, dir: &Path) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().is_none_or(|x| x != "json") {
                continue;
            }
            let parsed = std::fs::read_to_string(&p).map_err(|e| e.to_string()).and_then(|s| serde_json::from_str::<Tuning>(&s).map_err(|e| e.to_string()));
            match parsed {
                Ok(t) => {
                    let _ = self.apply_tuning(&t);
                }
                Err(err) => self.errors.push(format!("{}: {err}", p.display())),
            }
        }
    }

    /// Regra do boss sem ajustes (o padrão, para a tela de ajustes).
    pub fn base(&self, encounter_id: u32) -> Option<&RuleSet> {
        self.sets.iter().find(|s| !s.global && s.encounter_id == Some(encounter_id))
    }

    pub fn find(&self, encounter_id: u32, name: &str) -> Option<&RuleSet> {
        if let Some(t) = self.tuned.get(&encounter_id) {
            return Some(t);
        }
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
    casts: Vec<CastOutcome>,
    dispels: Vec<DispelOutcome>,
    /// dispel: último debuff de cada player (índice em `dispels`), ainda sem veredito
    open_dispels: HashMap<String, usize>,
    /// dispel: quando o debuff saiu (o SPELL_DISPEL vem logo depois da remoção)
    dispel_removed: HashMap<usize, i64>,
    /// phase_duration: janelas da aura no boss (a última pode estar aberta)
    phases: Vec<PhaseWindow>,
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
    pub fn aura_mechanic(&self, spell_id: u32) -> Option<(&str, &Text)> {
        self.hooks.get(&spell_id)?.iter().find_map(|(i, h)| {
            matches!(h, Hook::Aura | Hook::SoakAura | Hook::Enrage)
                .then(|| (self.mechs[*i].name.as_str(), &self.mechs[*i].tip))
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
                        let n = &m.name;
                        push_event(st, t, None, tx!("{n} (falha)", "{n} (failure)"));
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
                        push_event(st, t, Some(name), Text::same(m.name.clone()));
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
                            let n = &m.name;
                            push_event(st, t, Some(name), tx!("{stacks} stacks de {n}", "{stacks} stacks of {n}"));
                        }
                    }
                }
                Hook::SoakAura if is_player && stacks > 0 => bump(&mut st.credits, guid, name, 0, t),
                Hook::Aura if is_player && m.kind == MechanicType::Dispel => {
                    let open = st.open_dispels.get(guid).copied();
                    if stacks > 0 && open.is_none_or(|i| st.dispel_removed.contains_key(&i)) {
                        // debuff novo: o anterior (se houver) já saiu e pode ser julgado
                        if let Some(i) = open {
                            judge_dispel(m, st, i);
                        }
                        st.open_dispels.insert(guid.to_string(), st.dispels.len());
                        st.dispels.push(DispelOutcome {
                            t,
                            target_guid: guid.to_string(),
                            target: name.to_string(),
                            delay_ms: None,
                            dispelled_by: None,
                            dispelled_by_guid: None,
                        });
                    } else if stacks == 0 {
                        if let Some(i) = open {
                            st.dispel_removed.entry(i).or_insert(t);
                        }
                    }
                }
                // fase: a aura entra no boss no começo e sai quando o raid resolve a mecânica
                // (as duas sentinelas recebem a aura juntas: só a primeira abre a janela)
                Hook::Aura if !is_player && m.kind == MechanicType::PhaseDuration => {
                    let open = st.phases.last().is_some_and(|p| p.end.is_none());
                    if stacks > 0 && !open {
                        st.phases.push(PhaseWindow { start: t, end: None, wiped: false, deaths: 0 });
                    } else if stacks == 0 && open {
                        let p = st.phases.last_mut().unwrap();
                        p.end = Some(t);
                        let secs = (t - p.start) as f64 / 1000.0;
                        let (n, pt, en) = (&m.name, fmt_secs(secs, false), fmt_secs(secs, true));
                        push_event(st, t, None, tx!("{n} em {pt}", "{n} in {en}"));
                    }
                }
                Hook::Enrage if stacks > 0 => {
                    st.failures += 1;
                    st.fail_times.push(t);
                    let n = &m.name;
                    push_event(st, t, Some(name), tx!("{n} em {name}", "{n} on {name}"));
                }
                _ => {}
            }
        }
    }

    pub fn on_enemy_cast(&mut self, spell_id: u32, source_guid: &str, source: &str, t: i64) {
        let Some(hooks) = self.hooks.get(&spell_id) else { return };
        for &(i, hook) in hooks {
            if hook == Hook::Cast && self.mechs[i].kind == MechanicType::Interrupt {
                let st = &mut self.state[i];
                st.failures += 1;
                st.fail_times.push(t);
                let n = &self.mechs[i].name;
                push_event(st, t, None, tx!("{source} completou {n}", "{source} finished {n}"));
                st.casts.push(CastOutcome {
                    t,
                    source_guid: source_guid.to_string(),
                    source: source.to_string(),
                    interrupted_by: None,
                    interrupted_by_guid: None,
                });
            }
        }
    }

    /// `guid`/`name`: quem cortou; `target_*`: o inimigo que castava.
    pub fn on_interrupt(&mut self, interrupted_spell: u32, guid: &str, name: &str, target_guid: &str, target: &str, t: i64) {
        let Some(hooks) = self.hooks.get(&interrupted_spell) else { return };
        for &(i, hook) in hooks {
            if hook == Hook::Cast && self.mechs[i].kind == MechanicType::Interrupt {
                let st = &mut self.state[i];
                bump(&mut st.credits, guid, name, 0, t);
                st.casts.push(CastOutcome {
                    t,
                    source_guid: target_guid.to_string(),
                    source: target.to_string(),
                    interrupted_by: Some(name.to_string()),
                    interrupted_by_guid: Some(guid.to_string()),
                });
            }
        }
    }

    /// Debuff `aura` tirado de `target_guid` pelo dispel de `guid`/`name`.
    pub fn on_dispel(&mut self, aura: u32, target_guid: &str, guid: &str, name: &str, t: i64) {
        let Some(hooks) = self.hooks.get(&aura) else { return };
        for &(i, hook) in hooks {
            if hook == Hook::Aura && self.mechs[i].kind == MechanicType::Dispel {
                let st = &mut self.state[i];
                let Some(&k) = st.open_dispels.get(target_guid) else { continue };
                // a remoção vem antes do SPELL_DISPEL no log (mesmo instante)
                let just_removed = st.dispel_removed.get(&k).is_none_or(|&r| t - r <= DISPEL_AFTER_REMOVAL_MS);
                let d = &mut st.dispels[k];
                if d.delay_ms.is_none() && just_removed {
                    d.delay_ms = Some(t - d.t);
                    d.dispelled_by = Some(name.to_string());
                    d.dispelled_by_guid = Some(guid.to_string());
                    bump(&mut st.credits, guid, name, 0, t);
                }
            }
        }
    }

    /// Fim do pull (ms desde o início) e as mortes de players (ms): conta quem morreu dentro de
    /// cada fase, e a fase que "terminou" junto com um wipe (reset do boss) fica sem fim e marcada
    /// como wipe na fase.
    pub fn close_pull(&mut self, end_t: i64, success: bool, deaths: &[i64]) {
        for (m, st) in self.mechs.iter().zip(&mut self.state) {
            if m.kind != MechanicType::PhaseDuration {
                continue;
            }
            for p in &mut st.phases {
                let until = p.end.unwrap_or(end_t);
                p.deaths = deaths.iter().filter(|&&t| t >= p.start && t <= until).count() as u32;
            }
            if success {
                continue;
            }
            if let Some(p) = st.phases.last_mut() {
                if p.end.is_none_or(|e| e >= end_t - PHASE_WIPE_SLACK_MS) {
                    p.end = None;
                    p.wiped = true;
                }
            }
        }
    }

    /// `roles`: guid -> role, para não culpar quem a mecânica não envolve.
    pub fn finish(self, roles: &HashMap<String, String>) -> Vec<MechanicResult> {
        let mut out = Vec::new();
        let removals = self.removals;
        for (m, mut st) in self.mechs.into_iter().zip(self.state) {
            if m.kind == MechanicType::Dispel {
                let open: Vec<usize> = st.open_dispels.drain().map(|(_, i)| i).collect();
                for i in open {
                    judge_dispel(&m, &mut st, i);
                }
            }
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
                            m.blame_message.as_ref().unwrap_or(&m.message),
                            &p.name,
                            if m.kind == MechanicType::StackLimit { p.max_stacks } else { p.count },
                            lethal,
                        ),
                    })
                })
                .collect();
            let collective = matches!(
                m.kind,
                MechanicType::Soak | MechanicType::TankSoak | MechanicType::Interrupt | MechanicType::Enrage | MechanicType::HpBalance | MechanicType::FailureEvent | MechanicType::Dispel
            );
            let max_ms = m.max_s.map(|s| (s * 1000.0) as i64);
            let failures = match m.kind {
                // fases lentas (acima de max_s) e wipe dentro da fase
                MechanicType::PhaseDuration => st
                    .phases
                    .iter()
                    .filter(|p| p.wiped || p.deaths >= PHASE_FAIL_DEATHS || p.end.zip(max_ms).is_some_and(|(e, max)| round_s(e - p.start) > max))
                    .count() as u32,
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
                    message: Text::default(),
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
            let summary = if m.kind == MechanicType::Dispel {
                dispel_summary(&m.name, st.failures, &st.dispels)
            } else if m.kind == MechanicType::PhaseDuration {
                phase_summary(&st.phases, m.target_s)
            } else if collective {
                render(&m.message, "", st.failures, lethal)
            } else {
                Text::default()
            };
            out.push(MechanicResult {
                spell_id,
                key: m.key,
                name: m.name,
                kind: m.kind.as_str().to_string(),
                severity: m.severity,
                tip: m.tip,
                focus: m.focus,
                tuned: m.tuned,
                custom: m.custom,
                evaluated: m.kind.evaluated(),
                failures,
                summary,
                players,
                events: st.events,
                snapshots: st.snapshots,
                casts: st.casts,
                dispels: st.dispels,
                phases: st.phases,
                target_ms: m.target_s.map(|s| (s * 1000.0) as i64),
                max_ms,
            });
        }
        let rank = |s: &str| match s {
            "wipe" => 0,
            "major" => 1,
            "minor" => 2,
            _ => 3,
        };
        // com falha primeiro; dentro disso, o foco da progressão antes da gravidade
        out.sort_by(|a, b| {
            (a.failures == 0)
                .cmp(&(b.failures == 0))
                .then(b.focus.cmp(&a.focus))
                .then(rank(&a.severity).cmp(&rank(&b.severity)))
                .then(b.failures.cmp(&a.failures))
        });
        out
    }
}

/// Veredito de um debuff que já saiu: sem dispel, ou dispel depois de `max_delay` = falha.
/// Debuff ainda ativo no fim do pull não é julgado.
fn judge_dispel(m: &Mechanic, st: &mut MechState, i: usize) {
    if !st.dispel_removed.contains_key(&i) {
        return;
    }
    let d = &st.dispels[i];
    let late = m.max_delay.map(|s| (s * 1000.0) as i64);
    let failed = match d.delay_ms {
        None => true,
        Some(ms) => late.is_some_and(|l| ms > l),
    };
    if !failed {
        return;
    }
    let what = match d.delay_ms {
        None => Text::new("sem dispel", "no dispel"),
        Some(ms) => {
            let s = ms as f64 / 1000.0;
            Text::new(format!("dispel em {}", fmt_secs(s, false)), format!("dispel after {}", fmt_secs(s, true)))
        }
    };
    let (t0, guid, target) = (d.t, d.target_guid.clone(), d.target.clone());
    st.failures += 1;
    st.fail_times.push(t0);
    bump(&mut st.players, &guid, &target, 0, t0);
    let n = &m.name;
    push_event(st, t0, Some(&target), Text::new(format!("{n} {}", what.pt), format!("{n} {}", what.en)));
}

/// "2 de 9 Venomfang sem dispel a tempo · dispel médio 2,4s"
/// "3 intermissões: 18s, 13s, 14s · média 15s (alvo 12s)"
fn phase_summary(phases: &[PhaseWindow], target_s: Option<f64>) -> Text {
    if phases.is_empty() {
        return Text::default();
    }
    Text::new(phase_summary_in(phases, target_s, false), phase_summary_in(phases, target_s, true))
}

fn phase_summary_in(phases: &[PhaseWindow], target_s: Option<f64>, en: bool) -> String {
    // média só das fases limpas: a que acabou com o raid morrendo não mede a velocidade
    let done: Vec<f64> = phases.iter().filter(|p| p.deaths < PHASE_FAIL_DEATHS).filter_map(|p| p.end.map(|e| (e - p.start) as f64 / 1000.0)).collect();
    let list: Vec<String> = phases
        .iter()
        .map(|p| {
            let time = match p.end {
                Some(e) => fmt_secs((e - p.start) as f64 / 1000.0, en),
                None if p.wiped => "wipe".into(),
                None => "?".into(),
            };
            match (p.deaths, en) {
                (0, _) => time,
                (1, false) => format!("{time} (1 morte)"), // i18n-ignore: par pt/en (en vem do parâmetro)
                (n, false) => format!("{time} ({n} mortes)"), // i18n-ignore: par pt/en
                (1, true) => format!("{time} (1 death)"),
                (n, true) => format!("{time} ({n} deaths)"),
            }
        })
        .collect();
    let avg = if done.len() > 1 {
        let s = fmt_secs(done.iter().sum::<f64>() / done.len() as f64, en);
        if en { format!(" · average {s}") } else { format!(" · média {s}") } // i18n-ignore: par pt/en
    } else {
        String::new()
    };
    let target = target_s.map(|s| if en { format!(" (target {})", fmt_secs(s, true)) } else { format!(" (alvo {})", fmt_secs(s, false)) }).unwrap_or_default();
    let n = phases.len();
    let times = match (n, en) {
        (1, false) => "1 vez".to_string(),
        (n, false) => format!("{n} vezes"),
        (1, true) => "1 time".to_string(),
        (n, true) => format!("{n} times"),
    };
    format!("{times}: {}{avg}{target}", list.join(", "))
}

/// A aura sai no tick do servidor (segundo cheio + alguns ms): compara em segundos arredondados.
fn round_s(ms: i64) -> i64 {
    ((ms as f64 / 1000.0).round() as i64) * 1000
}

/// "13s" / "8,5s"
fn fmt_secs(s: f64, en: bool) -> String {
    if (s - s.round()).abs() < 0.05 {
        format!("{}s", s.round() as i64)
    } else if en {
        format!("{s:.1}s")
    } else {
        format!("{s:.1}s").replace('.', ",")
    }
}

fn dispel_summary(name: &str, failures: u32, dispels: &[DispelOutcome]) -> Text {
    let done: Vec<i64> = dispels.iter().filter_map(|d| d.delay_ms).collect();
    let avg = (!done.is_empty()).then(|| done.iter().sum::<i64>() as f64 / done.len() as f64 / 1000.0);
    let total = dispels.len();
    let (avg_pt, avg_en) = match avg {
        Some(a) => (format!(" · dispel médio {}", format!("{a:.1}s").replace('.', ",")), format!(" · average dispel {a:.1}s")), // i18n-ignore: par pt/en
        None => (String::new(), String::new()),
    };
    tx!("{failures} de {total} {name} sem dispel a tempo{avg_pt}", "{failures} of {total} {name} not dispelled in time{avg_en}")
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

fn push_event(st: &mut MechState, t: i64, player: Option<&str>, detail: Text) {
    if st.events.len() < MAX_EVENTS {
        st.events.push(MechanicEvent { t, player: player.map(str::to_string), detail });
    }
}

fn render(template: &Text, player: &str, count: u32, lethal: Option<u32>) -> Text {
    let short = player.split('-').next().unwrap_or(player);
    template.map(|t| {
        t.replace("{player}", short)
            .replace("{count}", &count.to_string())
            .replace("{stacks}", &count.to_string())
            .replace("{lethal_stacks}", &lethal.map(|l| l.to_string()).unwrap_or_default())
    })
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
        tr.on_enemy_cast(30, "Creature-1", "Add", 8000);
        tr.on_interrupt(30, "P1", "Um-Realm", "Creature-1", "Add", 9000);

        let res = tr.finish(&HashMap::new());
        let get = |k: &str| res.iter().find(|r| r.key == k).unwrap();
        let puddle = get("puddle");
        assert_eq!(puddle.failures, 1);
        assert_eq!(puddle.players.len(), 1);
        assert_eq!(puddle.players[0].message.pt, "Um pisou 2x");
        let venom = get("venom");
        assert_eq!(venom.players[0].count, 4);
        assert_eq!(venom.failures, 1, "1 player passou do warn_stacks");
        let int = get("mythic_only");
        assert_eq!(int.failures, 1);
        assert!(int.players[0].credit);
        // cada cast em ordem: o 1º passou, o 2º foi cortado por Um
        let casts: Vec<Option<&str>> = int.casts.iter().map(|c| c.interrupted_by.as_deref()).collect();
        assert_eq!(casts, [None, Some("Um-Realm")]);
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
        assert_eq!(det.summary.pt, "1 detonação(ões)");
        assert_eq!(det.players.iter().map(|p| p.message.pt.as_str()).collect::<Vec<_>>(), ["Carrier carregava o orb"]);
        let bomb = get("bomb");
        assert_eq!(bomb.players.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Um-R"]);
        assert_eq!(get("double").players[0].count, 1);
    }

    #[test]
    fn dispel_delay_and_missed_dispels() {
        let yaml = r#"
name: "Boss"
encounter_id: 44
mechanics:
  - key: poison
    name: Venomfang
    type: dispel
    detect: { aura_id: 80 }
    max_delay: 4
"#;
        let set = RuleSet::parse("t.yaml", yaml).unwrap();
        let mut tr = RuleTracker::new(&[&set], 16).unwrap();
        // A: dispel em 1,5s (ok); B: dispel em 6s (atrasado); C: expirou sem dispel
        // no log a remoção vem antes do SPELL_DISPEL, no mesmo instante
        tr.on_aura(80, "A", "A-R", 1, true, 1_000);
        tr.on_aura(80, "A", "A-R", 0, true, 2_500);
        tr.on_dispel(80, "A", "H", "Healer-R", 2_500);
        tr.on_aura(80, "B", "B-R", 1, true, 3_000);
        tr.on_aura(80, "B", "B-R", 0, true, 9_000);
        tr.on_dispel(80, "B", "H", "Healer-R", 9_000);
        tr.on_aura(80, "C", "C-R", 1, true, 10_000);
        tr.on_aura(80, "C", "C-R", 0, true, 24_000);

        let res = tr.finish(&HashMap::new());
        let m = &res[0];
        assert_eq!(m.failures, 2);
        assert_eq!(m.summary.pt, "2 de 3 Venomfang sem dispel a tempo · dispel médio 3,8s");
        assert_eq!(m.summary.en, "2 of 3 Venomfang not dispelled in time · average dispel 3.8s");
        assert_eq!(m.dispels.iter().map(|d| d.delay_ms).collect::<Vec<_>>(), [Some(1_500), Some(6_000), None]);
        let blamed: Vec<&str> = m.players.iter().filter(|p| !p.credit).map(|p| p.name.as_str()).collect();
        assert_eq!(blamed.len(), 2);
        assert!(m.players.iter().any(|p| p.credit && p.name == "Healer-R" && p.count == 2));
    }

    #[test]
    fn user_tuning_layers_over_the_rules() {
        let mut book = RuleBook::embedded();
        let t: Tuning = serde_json::from_value(serde_json::json!({
            "encounter_id": 3421,
            "mechanics": {
                "caustic_globule": { "enabled": false },
                // no Mítico o YAML sobe para wipe; o ajuste do usuário vale em todas
                "eternal_venom": { "severity": "minor", "warn_stacks": 5, "focus": true }
            },
            "custom": [{ "key": "minha_poca", "name": "Poça", "type": "avoidable_damage", "severity": "major",
                         "detect": { "damage_ids": [123] }, "tip": "sair", "message": "{player} na poça" }]
        }))
        .unwrap();
        book.apply_tuning(&t).unwrap();
        let set = book.find(3421, "The Twin Fangs").unwrap();
        let ms = set.mechanics_for(16).unwrap();
        assert!(ms.iter().all(|m| m.key != "caustic_globule"), "desligada");
        let ev = ms.iter().find(|m| m.key == "eternal_venom").unwrap();
        assert_eq!((ev.severity.as_str(), ev.warn_stacks, ev.focus), ("minor", Some(5), true));
        assert_eq!(ev.tuned, vec!["severity", "warn_stacks"]);
        let c = ms.iter().find(|m| m.key == "minha_poca").unwrap();
        assert!(c.custom && c.kind == MechanicType::AvoidableDamage);
        // o padrão continua disponível para a tela de ajustes
        assert!(book.base(3421).unwrap().raw_mechanics().iter().any(|m| m.get("key").and_then(Value::as_str) == Some("caustic_globule")));

        // ajuste inválido: erro e o boss segue com a regra de antes
        let bad: Tuning = serde_json::from_value(serde_json::json!({ "encounter_id": 3421, "custom": [{ "key": "x", "name": "x", "type": "nao_existe" }] })).unwrap();
        assert!(book.apply_tuning(&bad).is_err());
        assert!(book.find(3421, "The Twin Fangs").unwrap().mechanics_for(16).unwrap().iter().any(|m| m.key == "minha_poca"));
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

    #[test]
    fn phase_duration_times_each_window() {
        let src = r#"
name: "Fase"
encounter_id: 1
mechanics:
  - key: stasis
    name: Stasis
    type: phase_duration
    severity: minor
    detect: { aura_id: 500 }
    target_s: 10
    max_s: 15
    message: "{count} lenta"
"#;
        let set = RuleSet::parse("fase.yaml", src).unwrap();
        let mut tr = RuleTracker::new(&[&set], 16).unwrap();
        // dois bosses recebem a aura juntos: uma janela só
        tr.on_aura(500, "Boss-A", "A", 1, false, 1_000);
        tr.on_aura(500, "Boss-B", "B", 1, false, 1_001);
        tr.on_aura(500, "Boss-A", "A", 0, false, 13_010); // 12s: dentro
        tr.on_aura(500, "Boss-B", "B", 0, false, 13_011);
        tr.on_aura(500, "Boss-A", "A", 1, false, 100_000);
        tr.on_aura(500, "Boss-A", "A", 0, false, 118_005); // 18s: lenta
        tr.on_aura(500, "Boss-A", "A", 1, false, 200_000);
        tr.on_aura(500, "Boss-A", "A", 0, false, 206_000); // 6s, mas o raid morreu nela
        tr.on_aura(500, "Boss-A", "A", 1, false, 300_000); // wipe com a fase aberta
        tr.close_pull(305_000, false, &[201_000, 202_000, 203_000]);
        let m = tr.finish(&HashMap::new()).into_iter().find(|m| m.key == "stasis").unwrap();
        assert_eq!(m.phases.len(), 4);
        assert_eq!(m.phases[0].end, Some(13_010));
        assert_eq!(m.phases[2].deaths, 3);
        assert!(m.phases[3].wiped && m.phases[3].end.is_none());
        assert_eq!(m.failures, 3); // a lenta, a com mortes e o wipe
        assert_eq!(m.target_ms, Some(10_000));
        assert_eq!(m.summary.pt, "4 vezes: 12s, 18s, 6s (3 mortes), wipe · média 15s (alvo 10s)");
        assert_eq!(m.summary.en, "4 times: 12s, 18s, 6s (3 deaths), wipe · average 15s (target 10s)");
    }
}
