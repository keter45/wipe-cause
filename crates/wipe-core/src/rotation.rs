//! Rotação base por spec (`rotations/<classe>-<spec>.yaml`) e a leitura dela no log do player.
//!
//! Cada spec tem a rotação escrita (pontos principais, prioridade por árvore de herói, abertura)
//! e uma lista de checagens objetivas, cada uma de um tipo:
//!   - `proc`: o buff (ex.: Precise Shots) precisa ser gasto por um dos spenders; saiu sem
//!     spender (expirou ou foi sobrescrito) = desperdício;
//!   - `requires_buff`: em AoE (N+ alvos), estes casts precisam do buff (ex.: Trick Shots);
//!   - `downtime`: tempo sem castar estando vivo;
//!   - `cooldown`: casts de cada cooldown vs. quantos cabiam no tempo vivo.
//!
//! O `RotationTracker` acompanha um player durante o pull (casts, buffs nele, quantos inimigos
//! ele acertou nos últimos segundos) e no fim devolve os achados e o aproveitamento.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::OnceLock;

include!(concat!(env!("OUT_DIR"), "/rotations.rs"));

/// Spender que sai logo depois da remoção do buff ainda conta (a ordem dos eventos varia).
const SPEND_WINDOW_MS: i64 = 400;
/// Buff removido há pouco ainda vale para o cast (o cast consome o buff antes de aparecer).
const BUFF_GRACE_MS: i64 = 500;
/// Inimigos acertados nesta janela = alvos "ativos" (para AoE).
const TARGETS_WINDOW_MS: i64 = 3000;
/// Começo do pull sem contar tempo parado (posicionamento, pré-cast).
const START_GRACE_MS: i64 = 2000;

#[derive(Debug, Clone, Deserialize)]
pub struct Source {
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HeroTree {
    pub key: String,
    pub name: String,
    /// spells que só essa árvore casta
    pub markers: Vec<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Ability {
    pub id: u32,
    pub name: String,
    #[serde(default)]
    pub cast_ms: Option<i64>,
    #[serde(default)]
    pub channel_ms: Option<i64>,
    #[serde(default)]
    pub cooldown_ms: Option<i64>,
    #[serde(default)]
    pub charges: Option<u32>,
    /// casts por cooldown (ex.: Explosive Shot sai duas vezes com Unstable Trigger)
    #[serde(default)]
    pub uses_per_cooldown: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BuffDef {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrioItem {
    pub spell: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Priority {
    #[serde(default)]
    pub st: Vec<PrioItem>,
    #[serde(default)]
    pub aoe: Vec<PrioItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Opener {
    pub window_ms: i64,
    /// sequência por árvore de herói
    #[serde(flatten)]
    pub by_tree: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Channel {
    pub spell: String,
    pub ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Check {
    Proc {
        id: String,
        buff: String,
        spenders: Vec<String>,
        #[serde(default)]
        channel: Option<Channel>,
        importance: String,
        title: String,
        tip: String,
    },
    RequiresBuff {
        id: String,
        casts: Vec<String>,
        buff: String,
        min_targets: usize,
        /// a checagem só vale se o buff veio destes casts ao menos uma vez (o player tem o
        /// talento); vazio = sempre vale
        #[serde(default)]
        applied_by: Vec<String>,
        importance: String,
        title: String,
        tip: String,
    },
    Downtime {
        id: String,
        gcd_ms: i64,
        min_gap_ms: i64,
        importance: String,
        title: String,
        tip: String,
    },
    Cooldown {
        id: String,
        spells: Vec<String>,
        min_usage: f32,
        importance: String,
        title: String,
        tip: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct RotationSpec {
    pub spec: u32,
    pub name: String,
    pub patch: String,
    pub sources: Vec<Source>,
    pub key_points: Vec<String>,
    pub hero_trees: Vec<HeroTree>,
    pub abilities: BTreeMap<String, Ability>,
    pub buffs: BTreeMap<String, BuffDef>,
    pub priority: BTreeMap<String, Priority>,
    pub opener: Opener,
    pub checks: Vec<Check>,
}

impl RotationSpec {
    pub fn parse(file: &str, src: &str) -> Result<Self, String> {
        let spec: RotationSpec = yaml_serde::from_str(src).map_err(|e| format!("{file}: {e}"))?;
        spec.validate().map_err(|e| format!("{file}: {e}"))?;
        Ok(spec)
    }

    /// Toda referência (prioridade, abertura, checagens) aponta para habilidade/buff declarado.
    fn validate(&self) -> Result<(), String> {
        let ability = |k: &String| if self.abilities.contains_key(k) { Ok(()) } else { Err(format!("habilidade desconhecida: {k}")) };
        let buff = |k: &String| if self.buffs.contains_key(k) { Ok(()) } else { Err(format!("buff desconhecido: {k}")) };
        for p in self.priority.values() {
            p.st.iter().chain(&p.aoe).try_for_each(|i| ability(&i.spell))?;
        }
        self.opener.by_tree.values().flatten().try_for_each(ability)?;
        for c in &self.checks {
            match c {
                Check::Proc { buff: b, spenders, channel, .. } => {
                    buff(b)?;
                    spenders.iter().try_for_each(ability)?;
                    channel.iter().try_for_each(|ch| ability(&ch.spell))?;
                }
                Check::RequiresBuff { casts, buff: b, applied_by, .. } => {
                    buff(b)?;
                    casts.iter().chain(applied_by).try_for_each(ability)?;
                }
                Check::Downtime { .. } => {}
                Check::Cooldown { spells, .. } => {
                    for s in spells {
                        ability(s)?;
                        if self.abilities[s].cooldown_ms.is_none() {
                            return Err(format!("{s} sem cooldown_ms"));
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

/// Rotações embutidas, por spec id.
pub struct RotationBook {
    pub specs: HashMap<u32, RotationSpec>,
    pub errors: Vec<String>,
}

impl RotationBook {
    pub fn embedded() -> &'static RotationBook {
        static BOOK: OnceLock<RotationBook> = OnceLock::new();
        BOOK.get_or_init(|| {
            let mut specs = HashMap::new();
            let mut errors = Vec::new();
            for (file, src) in EMBEDDED_ROTATIONS {
                match RotationSpec::parse(file, src) {
                    Ok(s) => {
                        specs.insert(s.spec, s);
                    }
                    Err(e) => errors.push(e),
                }
            }
            RotationBook { specs, errors }
        })
    }

    pub fn get(&self, spec_id: u32) -> Option<&RotationSpec> {
        self.specs.get(&spec_id)
    }
}

// ---------------------------------------------------------------- resultado

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellRef {
    pub spell_id: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrioView {
    pub spell_id: u32,
    pub name: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotationFinding {
    pub id: String,
    pub title: String,
    pub tip: String,
    /// "high" | "medium" | "low"
    pub importance: String,
    /// quantas vezes errou (ou spells abaixo do esperado, no de cooldown)
    pub count: u32,
    /// aproveitamento 0–1 (1 = sem erro)
    pub rate: f32,
    /// quando (ms desde o início do pull), para pular na linha do tempo / vídeo
    pub times: Vec<i64>,
    pub detail: String,
    /// spell para o ícone
    pub spell_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenerResult {
    pub expected: Vec<SpellRef>,
    /// primeiros casts das habilidades da rotação, na ordem em que saíram
    pub actual: Vec<SpellRef>,
    /// itens esperados que não saíram na ordem dentro da janela
    pub missing: Vec<SpellRef>,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CooldownUse {
    pub spell_id: u32,
    pub name: String,
    pub casts: u32,
    pub possible: u32,
    pub usage: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotationResult {
    pub spec_name: String,
    pub patch: String,
    /// árvore de herói reconhecida pelos casts
    pub tree: Option<String>,
    /// aproveitamento geral 0–100 (média das checagens pelo peso da importância)
    pub score: u32,
    pub findings: Vec<RotationFinding>,
    pub opener: Option<OpenerResult>,
    pub downtime_ms: i64,
    pub active_ms: i64,
    pub cooldowns: Vec<CooldownUse>,
    pub key_points: Vec<String>,
    pub priority_st: Vec<PrioView>,
    pub priority_aoe: Vec<PrioView>,
    pub sources: Vec<SpellSource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellSource {
    pub title: String,
    pub url: String,
}

// ---------------------------------------------------------------- acompanhamento

pub(crate) struct RotationTracker {
    spec: &'static RotationSpec,
    ability_by_id: HashMap<u32, String>,
    buff_by_id: HashMap<u32, String>,
    /// (ms do pull, habilidade) de todo cast de habilidade da rotação
    casts: Vec<(i64, String)>,
    /// spells que só uma árvore casta
    markers: HashSet<u32>,
    seen_markers: HashSet<u32>,
    active: HashSet<String>,
    removed_at: HashMap<String, i64>,
    /// remoções de buff de `proc` aguardando o spender: (índice da checagem, ms)
    pending: Vec<(usize, i64)>,
    proc_total: HashMap<usize, u32>,
    proc_waste: HashMap<usize, Vec<i64>>,
    req_total: HashMap<usize, u32>,
    req_miss: HashMap<usize, Vec<i64>>,
    /// checagens requires_buff cujo buff já veio de um dos casts de `applied_by` (tem o talento)
    req_talent: HashSet<usize>,
    /// inimigo -> último acerto
    hits: HashMap<String, i64>,
    /// livre para o próximo cast a partir de (ms); None = morto
    free_at: Option<i64>,
    casting_since: Option<i64>,
    gaps: Vec<(i64, i64)>,
    dead_since: Option<i64>,
    dead_ms: i64,
}

impl RotationTracker {
    pub fn new(spec: &'static RotationSpec) -> Self {
        RotationTracker {
            spec,
            ability_by_id: spec.abilities.iter().map(|(k, a)| (a.id, k.clone())).collect(),
            buff_by_id: spec.buffs.iter().map(|(k, b)| (b.id, k.clone())).collect(),
            casts: Vec::new(),
            markers: spec.hero_trees.iter().flat_map(|t| t.markers.iter().copied()).collect(),
            seen_markers: HashSet::new(),
            active: HashSet::new(),
            removed_at: HashMap::new(),
            pending: Vec::new(),
            proc_total: HashMap::new(),
            proc_waste: HashMap::new(),
            req_total: HashMap::new(),
            req_miss: HashMap::new(),
            req_talent: HashSet::new(),
            hits: HashMap::new(),
            free_at: Some(START_GRACE_MS),
            casting_since: None,
            gaps: Vec::new(),
            dead_since: None,
            dead_ms: 0,
        }
    }

    fn downtime_cfg(&self) -> Option<(i64, i64)> {
        self.spec.checks.iter().find_map(|c| match c {
            Check::Downtime { gcd_ms, min_gap_ms, .. } => Some((*gcd_ms, *min_gap_ms)),
            _ => None,
        })
    }

    /// Começou a agir em `t`: fecha o intervalo parado desde que ficou livre.
    fn act(&mut self, t: i64) {
        if self.dead_since.is_some() {
            return;
        }
        let Some((_, min_gap)) = self.downtime_cfg() else { return };
        if let Some(free) = self.free_at {
            if t - free >= min_gap {
                self.gaps.push((free, t));
            }
        }
    }

    pub fn on_cast_start(&mut self, t: i64, spell_id: u32) {
        self.resolve(t);
        self.act(t);
        self.casting_since = Some(t);
        let cast = self.ability_by_id.get(&spell_id).and_then(|k| self.spec.abilities[k].cast_ms).unwrap_or(1500);
        self.free_at = Some(t + cast);
    }

    pub fn on_cast(&mut self, t: i64, spell_id: u32) {
        self.resolve(t);
        if self.markers.contains(&spell_id) {
            self.seen_markers.insert(spell_id);
        }
        let gcd = self.downtime_cfg().map_or(1200, |(g, _)| g);
        let key = self.ability_by_id.get(&spell_id).cloned();
        // cast com tempo de cast terminou agora; instantâneo começa (e ocupa o GCD) agora
        let had_start = self.casting_since.take().is_some_and(|s| t - s <= 4000);
        if self.dead_since.is_some() {
            // voltou (battle rez)
            if let Some(d) = self.dead_since.take() {
                self.dead_ms += t - d;
            }
        } else if !had_start {
            self.act(t);
        }
        let busy = key.as_ref().and_then(|k| self.spec.abilities[k].channel_ms).unwrap_or(if had_start { 0 } else { gcd });
        self.free_at = Some((t + busy).max(if had_start { t } else { t + gcd }));
        let Some(key) = key else { return };

        // AoE: o cast precisava do buff?
        let targets = self.targets(t);
        for (i, c) in self.spec.checks.iter().enumerate() {
            if let Check::RequiresBuff { casts, buff, min_targets, .. } = c {
                if casts.contains(&key) && targets >= *min_targets {
                    *self.req_total.entry(i).or_default() += 1;
                    let up = self.active.contains(buff) || self.removed_at.get(buff).is_some_and(|r| t - r <= BUFF_GRACE_MS);
                    if !up {
                        self.req_miss.entry(i).or_default().push(t);
                    }
                }
            }
        }
        self.casts.push((t, key));
    }

    /// Buff no próprio player (aplicado / removido).
    pub fn on_aura(&mut self, t: i64, spell_id: u32, applied: bool) {
        self.resolve(t);
        let Some(buff) = self.buff_by_id.get(&spell_id).cloned() else { return };
        if applied {
            self.active.insert(buff.clone());
            for (i, c) in self.spec.checks.iter().enumerate() {
                if let Check::RequiresBuff { buff: b, applied_by, .. } = c {
                    if *b == buff && self.casts.iter().rev().take_while(|(ct, _)| t - ct <= SPEND_WINDOW_MS + 100).any(|(_, k)| applied_by.contains(k)) {
                        self.req_talent.insert(i);
                    }
                }
            }
            for (i, c) in self.spec.checks.iter().enumerate() {
                if matches!(c, Check::Proc { buff: b, .. } if *b == buff) {
                    *self.proc_total.entry(i).or_default() += 1;
                }
            }
        } else {
            self.active.remove(&buff);
            self.removed_at.insert(buff.clone(), t);
            for (i, c) in self.spec.checks.iter().enumerate() {
                if matches!(c, Check::Proc { buff: b, .. } if *b == buff) {
                    self.pending.push((i, t));
                }
            }
        }
    }

    /// Dano do player num inimigo (conta os alvos ativos para AoE).
    pub fn on_damage(&mut self, t: i64, enemy: &str) {
        self.hits.insert(enemy.to_string(), t);
    }

    pub fn on_death(&mut self, t: i64) {
        self.resolve(t);
        self.dead_since.get_or_insert(t);
        self.free_at = None;
        self.casting_since = None;
    }

    fn targets(&self, t: i64) -> usize {
        self.hits.values().filter(|&&h| t - h <= TARGETS_WINDOW_MS).count()
    }

    /// Classifica as remoções de proc que já passaram da janela do spender.
    fn resolve(&mut self, now: i64) {
        let mut keep = Vec::new();
        for (i, t) in std::mem::take(&mut self.pending) {
            if now - t <= SPEND_WINDOW_MS {
                keep.push((i, t));
                continue;
            }
            self.classify(i, t);
        }
        self.pending = keep;
    }

    fn classify(&mut self, i: usize, t: i64) {
        let Check::Proc { spenders, channel, .. } = &self.spec.checks[i] else { return };
        let spent = self.casts.iter().any(|(ct, k)| (ct - t).abs() <= SPEND_WINDOW_MS && spenders.contains(k))
            || channel.as_ref().is_some_and(|ch| self.casts.iter().any(|(ct, k)| *k == ch.spell && t >= *ct && t - ct <= ch.ms));
        if !spent {
            self.proc_waste.entry(i).or_default().push(t);
        }
    }

/// `raid_active[s]`: alguém da raid acertou um inimigo no segundo `s` do pull. Segundo em que
    /// ninguém acertava nada (intermissão, boss inatacável) não conta como tempo parado.
    pub fn finish(mut self, end_ms: i64, raid_active: &[bool]) -> RotationResult {
        // tempo parado só nos segundos em que a raid estava batendo
        let active_s = |s: i64| raid_active.get(s.max(0) as usize).copied().unwrap_or(false);
        self.gaps = std::mem::take(&mut self.gaps)
            .into_iter()
            .flat_map(|(a, b)| {
                // quebra o intervalo nos trechos com a raid ativa
                let mut parts = Vec::new();
                let mut start: Option<i64> = None;
                let mut t = a;
                while t < b {
                    let next = ((t / 1000) + 1) * 1000;
                    let end = next.min(b);
                    if active_s(t / 1000) {
                        start.get_or_insert(t);
                    } else if let Some(s0) = start.take() {
                        parts.push((s0, t));
                    }
                    t = end;
                }
                if let Some(s0) = start {
                    parts.push((s0, b));
                }
                parts
            })
            .filter(|(a, b)| b - a >= self.downtime_cfg().map_or(0, |(_, m)| m))
            .collect();
        for (i, t) in std::mem::take(&mut self.pending) {
            self.classify(i, t);
        }
        if let Some(d) = self.dead_since.take() {
            self.dead_ms += end_ms - d;
        }
        let spec = self.spec;
        let active_ms = (end_ms - START_GRACE_MS - self.dead_ms).max(1);
        let tree = spec
            .hero_trees
            .iter()
            .find(|t| t.markers.iter().any(|m| self.seen_markers.contains(m)))
            .or_else(|| spec.hero_trees.first());
        let view = |items: &[PrioItem]| -> Vec<PrioView> {
            items.iter().map(|i| PrioView { spell_id: spec.abilities[&i.spell].id, name: spec.abilities[&i.spell].name.clone(), note: i.note.clone() }).collect()
        };
        let prio = tree.and_then(|t| spec.priority.get(&t.key));

        let mut findings = Vec::new();
        let mut cooldowns = Vec::new();
        let downtime_ms: i64 = self.gaps.iter().map(|(a, b)| b - a).sum();
        for (i, c) in spec.checks.iter().enumerate() {
            match c {
                Check::Proc { id, buff, importance, title, tip, .. } => {
                    let total = self.proc_total.get(&i).copied().unwrap_or(0);
                    let waste = self.proc_waste.remove(&i).unwrap_or_default();
                    if total == 0 {
                        continue;
                    }
                    let n = waste.len() as u32;
                    findings.push(RotationFinding {
                        id: id.clone(),
                        title: title.clone(),
                        tip: tip.clone(),
                        importance: importance.clone(),
                        count: n,
                        rate: 1.0 - n.min(total) as f32 / total as f32,
                        times: waste,
                        detail: format!("{n} de {total} {} sem gastar", spec.buffs[buff].name),
                        spell_id: Some(spec.buffs[buff].id),
                    });
                }
                Check::RequiresBuff { id, buff, importance, title, tip, casts, applied_by, .. } => {
                    // sem o talento (o buff nunca veio dos casts que o colocam), não se aplica
                    if !applied_by.is_empty() && !self.req_talent.contains(&i) {
                        continue;
                    }
                    let total = self.req_total.get(&i).copied().unwrap_or(0);
                    let miss = self.req_miss.remove(&i).unwrap_or_default();
                    if total == 0 {
                        continue;
                    }
                    let n = miss.len() as u32;
                    findings.push(RotationFinding {
                        id: id.clone(),
                        title: title.clone(),
                        tip: tip.clone(),
                        importance: importance.clone(),
                        count: n,
                        rate: 1.0 - n as f32 / total as f32,
                        times: miss,
                        detail: format!("{n} de {total} casts em AoE sem {}", spec.buffs[buff].name),
                        spell_id: casts.first().map(|k| spec.abilities[k].id),
                    });
                }
                Check::Downtime { id, importance, title, tip, .. } => {
                    let mut long: Vec<&(i64, i64)> = self.gaps.iter().filter(|(a, b)| b - a >= 2000).collect();
                    long.sort_by_key(|(a, b)| std::cmp::Reverse(b - a));
                    findings.push(RotationFinding {
                        id: id.clone(),
                        title: title.clone(),
                        tip: tip.clone(),
                        importance: importance.clone(),
                        count: self.gaps.len() as u32,
                        rate: 1.0 - (downtime_ms as f32 / active_ms as f32).min(1.0),
                        times: long.iter().take(10).map(|(a, _)| *a).collect(),
                        detail: format!("{:.1} s parado ({:.0}% do tempo vivo)", downtime_ms as f32 / 1000.0, downtime_ms as f32 / active_ms as f32 * 100.0),
                        spell_id: None,
                    });
                }
                Check::Cooldown { id, spells, min_usage, importance, title, tip } => {
                    let mut low = Vec::new();
                    let mut rates = Vec::new();
                    for s in spells {
                        let a = &spec.abilities[s];
                        let cd = a.cooldown_ms.unwrap_or(1).max(1);
                        let per = a.uses_per_cooldown.unwrap_or(1);
                        let possible = (a.charges.unwrap_or(1) + (active_ms / cd) as u32) * per;
                        let casts = self.casts.iter().filter(|(_, k)| k == s).count() as u32;
                        let usage = (casts as f32 / possible.max(1) as f32).min(1.0);
                        rates.push(usage);
                        if usage < *min_usage {
                            low.push(format!("{} {casts}/{possible}", a.name));
                        }
                        cooldowns.push(CooldownUse { spell_id: a.id, name: a.name.clone(), casts, possible, usage });
                    }
                    findings.push(RotationFinding {
                        id: id.clone(),
                        title: title.clone(),
                        tip: tip.clone(),
                        importance: importance.clone(),
                        count: low.len() as u32,
                        rate: rates.iter().sum::<f32>() / rates.len().max(1) as f32,
                        times: Vec::new(),
                        detail: if low.is_empty() { "todos no cooldown".into() } else { format!("abaixo do esperado: {}", low.join(", ")) },
                        spell_id: None,
                    });
                }
            }
        }

        let opener = tree.and_then(|t| spec.opener.by_tree.get(&t.key)).map(|expected| {
            let firsts: Vec<&String> = self.casts.iter().filter(|(t, _)| *t <= spec.opener.window_ms).map(|(_, k)| k).collect();
            // esperado como subsequência: cada item precisa sair depois do anterior
            let mut pos = 0;
            let mut missing = Vec::new();
            for e in expected {
                match firsts[pos..].iter().position(|k| *k == e) {
                    Some(p) => pos += p + 1,
                    None => missing.push(e),
                }
            }
            let r = |k: &String| SpellRef { spell_id: spec.abilities[k].id, name: spec.abilities[k].name.clone() };
            OpenerResult {
                expected: expected.iter().map(r).collect(),
                actual: firsts.iter().take(10).map(|k| r(k)).collect(),
                missing: missing.iter().map(|k| r(k)).collect(),
                ok: missing.is_empty(),
            }
        });

        let weight = |imp: &str| match imp {
            "high" => 3.0,
            "medium" => 2.0,
            _ => 1.0,
        };
        let (sum, w) = findings.iter().fold((0.0, 0.0), |(s, w), f| (s + f.rate * weight(&f.importance), w + weight(&f.importance)));
        let score = if w > 0.0 { (sum / w * 100.0).round() as u32 } else { 100 };
        // o que mais pesa primeiro: importância, depois o pior aproveitamento
        findings.sort_by(|a, b| weight(&b.importance).partial_cmp(&weight(&a.importance)).unwrap().then(a.rate.partial_cmp(&b.rate).unwrap()));

        RotationResult {
            spec_name: spec.name.clone(),
            patch: spec.patch.clone(),
            tree: tree.map(|t| t.name.clone()),
            score,
            findings,
            opener,
            downtime_ms,
            active_ms,
            cooldowns,
            key_points: spec.key_points.clone(),
            priority_st: prio.map(|p| view(&p.st)).unwrap_or_default(),
            priority_aoe: prio.map(|p| view(&p.aoe)).unwrap_or_default(),
            sources: spec.sources.iter().map(|s| SpellSource { title: s.title.clone(), url: s.url.clone() }).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mm() -> &'static RotationSpec {
        let book = RotationBook::embedded();
        assert!(book.errors.is_empty(), "{:?}", book.errors);
        book.get(254).expect("marksmanship")
    }

    #[test]
    fn embedded_rotations_parse() {
        let s = mm();
        assert_eq!(s.name, "Marksmanship Hunter");
        assert!(s.priority.contains_key("sentinel") && s.priority.contains_key("dark_ranger"));
    }

    #[test]
    fn precise_shots_spent_wasted_and_eaten_by_rapid_fire() {
        let mut r = RotationTracker::new(mm());
        // 1) Aimed -> Precise Shots -> Arcane Shot: gasto
        r.on_cast(3000, 19434);
        r.on_aura(3100, 260242, true);
        r.on_cast(4000, 185358);
        r.on_aura(4000, 260242, false);
        // 2) Aimed -> Precise Shots -> outro Aimed sem spender: sobrescrito
        r.on_cast(6000, 19434);
        r.on_aura(6100, 260242, true);
        r.on_cast(9000, 19434);
        r.on_aura(9100, 260242, false);
        // 3) Rapid Fire (Unload) gasta o próprio durante o canal
        r.on_cast(12000, 257044);
        r.on_aura(12500, 260242, true);
        r.on_aura(13500, 260242, false);
        let res = r.finish(20000, &[true; 40]);
        let ps = res.findings.iter().find(|f| f.id == "precise_shots").unwrap();
        assert_eq!((ps.count, ps.times.clone()), (1, vec![9100]));
        assert!((ps.rate - 2.0 / 3.0).abs() < 0.01);
        assert_eq!(res.tree.as_deref(), Some("Sentinel"));
    }

    #[test]
    fn trick_shots_only_counts_in_aoe() {
        let mut r = RotationTracker::new(mm());
        for e in ["a", "b", "c"] {
            r.on_damage(5000, e);
        }
        r.on_cast(5500, 19434); // 3 alvos, sem Trick Shots: erro
        r.on_cast(5900, 257620); // Multi-Shot coloca o Trick Shots: o player tem o talento
        r.on_aura(6000, 257622, true);
        r.on_cast(6500, 19434); // com Trick Shots: ok
        r.on_cast(20000, 19434); // alvos sumiram (sem acerto há 3 s): single target, não conta
        let res = r.finish(25000, &[true; 40]);
        let ts = res.findings.iter().find(|f| f.id == "trick_shots").unwrap();
        assert_eq!((ts.count, ts.times.clone()), (1, vec![5500]));
        assert!((ts.rate - 0.5).abs() < 0.01);

        // sem o talento: o Trick Shots só aparece pelo Volley; a checagem não vale
        let mut r = RotationTracker::new(mm());
        for e in ["a", "b", "c"] {
            r.on_damage(5000, e);
        }
        r.on_cast(5200, 260243); // Volley
        r.on_aura(5300, 257622, true);
        r.on_cast(5500, 19434);
        r.on_cast(9000, 19434);
        assert!(r.finish(25000, &[true; 40]).findings.iter().all(|f| f.id != "trick_shots"));
    }

    #[test]
    fn downtime_counts_gaps_while_alive_only() {
        let mut r = RotationTracker::new(mm());
        r.on_cast_start(2000, 19434); // começa logo
        r.on_cast(4500, 19434);
        r.on_cast(9500, 185358); // 5 s parado (4500 -> 9500)
        r.on_death(11000);
        r.on_cast(30000, 185358); // rez: o tempo morto não conta
        let res = r.finish(31000, &[true; 40]);
        assert_eq!(res.downtime_ms, 5000);
        assert_eq!(res.active_ms, 31000 - 2000 - 19000);

        // intermissão: ninguém da raid batendo entre 6 s e 9 s -> conta 4500..6000; o pedaço
        // 9000..9500 é menor que o intervalo mínimo
        let mut r = RotationTracker::new(mm());
        r.on_cast_start(2000, 19434);
        r.on_cast(4500, 19434);
        r.on_cast(9500, 185358);
        let mut raid = [true; 40];
        raid[6..9].fill(false);
        let res = r.finish(12000, &raid);
        assert_eq!(res.downtime_ms, 1500);
    }

    #[test]
    fn opener_follows_the_tree_sequence() {
        let mut r = RotationTracker::new(mm());
        for (t, id) in [(500, 212431), (1700, 212431), (2900, 260243), (4100, 288613), (5300, 257044), (6500, 1264949)] {
            r.on_cast(t, id);
        }
        let res = r.finish(20000, &[true; 40]);
        let o = res.opener.unwrap();
        assert!(o.ok, "{:?}", o.missing);
        let mut r = RotationTracker::new(mm());
        for (t, id) in [(500, 288613), (1700, 212431), (2900, 260243)] {
            r.on_cast(t, id); // Trueshot antes: Explosive x2 / Volley / Rapid Fire fora de ordem
        }
        let o = r.finish(20000, &[true; 40]).opener.unwrap();
        assert!(!o.ok);
    }
}
