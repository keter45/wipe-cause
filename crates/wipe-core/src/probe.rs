//! Medidas de um boss nos logs (`wipe-cli probe`): os métodos de `docs/replay-methods.md` (raio por
//! pulso, golpe na frente, cone, ondas, poça, queda do dano com a distância) e o inventário de ids e
//! unidades. A fonte é um combat log ou uma pasta do `scripts/wcl-fetch.mjs`; os eventos das duas viram
//! os mesmos campos de linha e chegam às medidas um pull por vez. Posição vale até 1,5 s.

use crate::analysis::{advanced_at, npc_id};
use crate::timestamp::parse_timestamp;
use crate::tokenizer::{split_fields, split_timestamp};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::f32::consts::{PI, TAU};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Uma posição vale até 1,5 s antes ou depois da linha que a trouxe.
pub const MAX_AGE_MS: i64 = 1_500;
const NIL_GUID: &str = "0000000000000000";
const NONE: u32 = u32::MAX;

/// Tipo de linha que as medidas usam.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    CastStart,
    CastSuccess,
    AuraApplied,
    AuraRemoved,
    /// stack, refresh
    AuraDose,
    Damage,
    Periodic,
    Missed,
    Swing,
    Summon,
    Died,
    Other,
}

fn kind(ev: &str) -> Kind {
    match ev {
        "SPELL_CAST_START" => Kind::CastStart,
        "SPELL_CAST_SUCCESS" => Kind::CastSuccess,
        "SPELL_AURA_APPLIED" => Kind::AuraApplied,
        "SPELL_AURA_REMOVED" => Kind::AuraRemoved,
        "SPELL_AURA_APPLIED_DOSE" | "SPELL_AURA_REMOVED_DOSE" | "SPELL_AURA_REFRESH" => Kind::AuraDose,
        "SPELL_DAMAGE" | "RANGE_DAMAGE" => Kind::Damage,
        "SPELL_PERIODIC_DAMAGE" => Kind::Periodic,
        "SPELL_MISSED" | "SPELL_PERIODIC_MISSED" | "RANGE_MISSED" => Kind::Missed,
        "SWING_DAMAGE" => Kind::Swing,
        "SPELL_SUMMON" => Kind::Summon,
        "UNIT_DIED" | "UNIT_DESTROYED" => Kind::Died,
        _ => Kind::Other,
    }
}

/// Acerto de dano (ou golpe que errou/foi absorvido por inteiro: o player estava lá).
fn is_hit(k: Kind) -> bool {
    matches!(k, Kind::Damage | Kind::Periodic | Kind::Missed | Kind::Swing)
}

/// Uma linha do pull. `t` em ms desde o início; `src`/`dst`/`pos` são índices em `Pull::units`.
#[derive(Debug, Clone, Copy)]
pub struct Event {
    pub t: i64,
    pub kind: Kind,
    pub src: u32,
    pub dst: u32,
    pub spell: u32,
    pub amount: i64,
    /// dano bruto, antes da mitigação (`baseAmount`)
    pub base: i64,
    /// dono do bloco advanced da linha (`NONE` sem bloco)
    pub pos: u32,
}

#[derive(Debug, Clone, Copy)]
pub struct Sample {
    pub t: i64,
    pub x: f32,
    pub y: f32,
    /// NaN sem direção
    pub facing: f32,
    pub max_hp: i64,
}

#[derive(Debug, Clone, Default)]
pub struct Unit {
    pub guid: String,
    pub name: String,
    pub flags: u32,
    /// já apareceu controlado por player (pet, guardião): o log às vezes escreve o pet como NPC neutro
    pub player_owned: bool,
}

impl Unit {
    pub fn is_player(&self) -> bool {
        self.guid.starts_with("Player-")
    }
    pub fn is_nil(&self) -> bool {
        self.guid == NIL_GUID || self.guid.is_empty()
    }
    /// Inimigo: hostil ou neutro e não controlado por player (como no `analysis.rs`).
    pub fn is_enemy(&self) -> bool {
        !self.is_player() && !self.player_owned && self.flags & 0x400 == 0 && self.flags & 0x100 == 0 && self.flags & 0x60 != 0
    }
    pub fn npc(&self) -> Option<u32> {
        npc_id(&self.guid)
    }
}

/// Um pull do encontro pedido, inteiro na memória.
#[derive(Debug, Default)]
pub struct Pull {
    pub encounter: u32,
    pub difficulty: u32,
    pub kill: bool,
    /// arquivo ou pasta de onde veio
    pub source: String,
    /// início em ms (epoch ou do relógio do log)
    pub start: i64,
    pub duration: i64,
    pub units: Vec<Unit>,
    pub events: Vec<Event>,
    pub tracks: Vec<Vec<Sample>>,
    pub deaths: Vec<Vec<i64>>,
    pub spell_names: HashMap<u32, String>,
    index: HashMap<String, u32>,
}

fn hex(s: &str) -> u32 {
    u32::from_str_radix(s.trim_start_matches("0x"), 16).unwrap_or(0)
}

fn num(s: Option<&&str>) -> i64 {
    s.and_then(|v| v.parse::<f64>().ok()).map_or(0, |v| v as i64)
}

impl Pull {
    pub fn new(encounter: u32, difficulty: u32, start: i64, source: &str) -> Self {
        Pull { encounter, difficulty, start, source: source.to_string(), ..Default::default() }
    }

    /// `src`: as flags de quem age são confiáveis; as do alvo às vezes não (no SPELL_SUMMON o pet do
    /// player aparece como NPC neutro) e só valem enquanto não há outras.
    fn intern(&mut self, guid: &str, name: &str, flags: &str, src: bool) -> u32 {
        if let Some(&i) = self.index.get(guid) {
            let u = &mut self.units[i as usize];
            if (u.name.is_empty() || u.name == "nil") && !name.is_empty() {
                u.name = name.to_string();
            }
            if !flags.is_empty() && (src || u.flags == 0) {
                u.flags = hex(flags);
            }
            u.player_owned |= u.flags & 0x100 != 0;
            return i;
        }
        let i = self.units.len() as u32;
        let flags = if flags.is_empty() { 0 } else { hex(flags) };
        self.units.push(Unit { guid: guid.to_string(), name: name.to_string(), flags, player_owned: flags & 0x100 != 0 });
        self.tracks.push(Vec::new());
        self.deaths.push(Vec::new());
        self.index.insert(guid.to_string(), i);
        i
    }

    /// Uma linha do log (sem o timestamp), já separada em campos; `t_abs` no mesmo relógio de `start`.
    pub fn push_line(&mut self, t_abs: i64, f: &[&str]) {
        if f.len() < 9 {
            return;
        }
        let k = kind(f[0]);
        let swing = f[0].starts_with("SWING_") || f[0] == "ENVIRONMENTAL_DAMAGE";
        let adv_at = if swing { 9 } else { 12 };
        let t = t_abs - self.start;
        let src = self.intern(f[1], f[2], f[3], true);
        let dst = self.intern(f[5], f[6], f[7], false);
        let spell = if f[0].starts_with("SWING_") {
            1
        } else if f[0].starts_with("SPELL_") || f[0].starts_with("RANGE_") {
            let id = f.get(9).and_then(|v| v.parse().ok()).unwrap_or(0);
            if id > 0 && !self.spell_names.contains_key(&id) {
                self.spell_names.insert(id, f.get(10).copied().unwrap_or("").to_string());
            }
            id
        } else {
            0
        };
        // o bloco advanced: de quem lança, menos no dano (do alvo); cast start, summon, absorbed e
        // morte não têm (o `advanced_at` não acha o formato e devolve None)
        let adv = advanced_at(f, adv_at);
        let mut pos = NONE;
        if let Some(a) = &adv {
            let u = self.intern(a.info_guid, "", "", false);
            pos = u;
            self.tracks[u as usize].push(Sample { t, x: a.x, y: a.y, facing: a.facing.unwrap_or(f32::NAN), max_hp: a.max_hp });
        }
        let (mut amount, mut base) = (0, 0);
        if matches!(k, Kind::Damage | Kind::Periodic | Kind::Swing) {
            let s = adv_at + adv.as_ref().map_or(0, |a| a.len);
            amount = num(f.get(s));
            base = num(f.get(s + 1));

        }
        if k == Kind::Died {
            self.deaths[dst as usize].push(t);
        }
        // o que um player invoca é dele
        if k == Kind::Summon && (self.units[src as usize].is_player() || self.units[src as usize].player_owned) {
            self.units[dst as usize].player_owned = true;
        }

        self.events.push(Event { t, kind: k, src, dst, spell, amount, base, pos });
    }

    pub fn finish(&mut self, end_abs: i64, kill: bool) {
        self.duration = end_abs - self.start;
        self.kill = kill;
        // linhas do mesmo ms podem vir fora de ordem entre fontes; as trilhas precisam estar em ordem
        for tr in &mut self.tracks {
            if tr.windows(2).any(|w| w[0].t > w[1].t) {
                tr.sort_by_key(|s| s.t);
            }
        }
    }

    pub fn name(&self, u: u32) -> &str {
        self.units.get(u as usize).map_or("", |u| if u.is_nil() { "nil" } else { u.name.as_str() })
    }

    pub fn unit(&self, u: u32) -> &Unit {
        &self.units[u as usize]
    }

    pub fn is_player(&self, u: u32) -> bool {
        self.units.get(u as usize).is_some_and(Unit::is_player)
    }

    /// Posição de `u` em `t` (interpolada entre as linhas vizinhas, cada uma a até 1,5 s); nada depois
    /// de morrer.
    pub fn pos(&self, u: u32, t: i64) -> Option<(f32, f32)> {
        let tr = self.tracks.get(u as usize)?;
        let i = tr.partition_point(|s| s.t <= t);
        let prev = i.checked_sub(1).map(|j| tr[j]).filter(|s| t - s.t <= MAX_AGE_MS);
        let next = tr.get(i).copied().filter(|s| s.t - t <= MAX_AGE_MS);
        let died_after = |from: i64| self.deaths[u as usize].iter().any(|&d| d >= from && d <= t);
        match (prev, next) {
            (Some(a), _) if a.t == t => Some((a.x, a.y)),
            (Some(a), Some(b)) => {
                if died_after(a.t) {
                    return None;
                }
                let k = (t - a.t) as f32 / (b.t - a.t).max(1) as f32;
                Some((a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k))
            }
            (Some(a), None) => (!died_after(a.t)).then_some((a.x, a.y)),
            (None, Some(b)) => Some((b.x, b.y)),
            (None, None) => None,
        }
    }

    /// Direção de `u` (radianos) na linha mais perto de `t` com direção, a até 1,5 s.
    pub fn facing(&self, u: u32, t: i64) -> Option<f32> {
        let tr = self.tracks.get(u as usize)?;
        let i = tr.partition_point(|s| s.t <= t);
        let back = tr[..i].iter().rev().take_while(|s| t - s.t <= MAX_AGE_MS).find(|s| s.facing.is_finite());
        let fwd = tr[i..].iter().take_while(|s| s.t - t <= MAX_AGE_MS).find(|s| s.facing.is_finite());
        match (back, fwd) {
            (Some(a), Some(b)) => Some(if t - a.t <= b.t - t { a.facing } else { b.facing }),
            (a, b) => a.or(b).map(|s| s.facing),
        }
    }

    /// Players (sem pets) do pull.
    pub fn players(&self) -> impl Iterator<Item = u32> + '_ {
        (0..self.units.len() as u32).filter(|&u| self.units[u as usize].is_player())
    }

    /// O boss: o inimigo com mais vida.
    pub fn boss(&self) -> Option<u32> {
        (0..self.units.len() as u32)
            .filter(|&u| self.units[u as usize].is_enemy())
            .filter_map(|u| self.tracks[u as usize].iter().map(|s| s.max_hp).max().map(|hp| (u, hp)))
            .max_by_key(|&(_, hp)| hp)
            .map(|(u, _)| u)
    }

    pub fn spell_name(&self, id: u32) -> String {
        if id == 1 {
            return "Melee".into();
        }
        self.spell_names.get(&id).cloned().unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------------------------
// Fontes

/// Encontro e dificuldade (id do jogo: 16 = mítico).
#[derive(Debug, Clone, Copy)]
pub struct Filter {
    pub encounter: u32,
    pub difficulty: u32,
}

/// Chama `each` em cada pull do encontro em cada fonte (log ou pasta do WCL), um por vez.
/// Wipe com menos de 30 s fica de fora (pull falso). Devolve quantos pulls passaram.
pub fn for_each_pull(sources: &[String], flt: Filter, mut each: impl FnMut(&Pull)) -> Result<usize, String> {
    let mut n = 0;
    let mut keep = |p: &Pull| {
        if p.kill || p.duration >= crate::analysis::MIN_PULL_MS {
            n += 1;
            each(p);
        }
    };
    for s in sources {
        let path = Path::new(s);
        if path.is_dir() {
            read_wcl(path, flt, &mut keep)?;
        } else {
            read_log(path, flt, &mut keep).map_err(|e| format!("{s}: {e}"))?;
        }
    }
    Ok(n)
}

/// Combat log: só as linhas dos pulls pedidos são separadas em campos.
pub fn read_log(path: &Path, flt: Filter, each: &mut dyn FnMut(&Pull)) -> std::io::Result<()> {
    let r = BufReader::with_capacity(1 << 20, File::open(path)?);
    read_log_reader(r, &path.display().to_string(), flt, each)
}

pub fn read_log_reader<R: BufRead>(mut r: R, label: &str, flt: Filter, each: &mut dyn FnMut(&Pull)) -> std::io::Result<()> {
    let year = crate::current_year();
    let mut buf = Vec::with_capacity(4096);
    let mut cur: Option<Pull> = None;
    loop {
        buf.clear();
        if r.read_until(b'\n', &mut buf)? == 0 {
            break;
        }
        let line = String::from_utf8_lossy(&buf);
        let Some((ts, rest)) = split_timestamp(&line) else { continue };
        if rest.starts_with("ENCOUNTER_START") {
            if let Some(mut p) = cur.take() {
                let end = p.start + p.events.last().map_or(0, |e| e.t);
                p.finish(end, false);
                each(&p);
            }
            let mut f = Vec::with_capacity(8);
            split_fields(rest, &mut f);
            let id: u32 = f.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
            let diff: u32 = f.get(3).and_then(|v| v.parse().ok()).unwrap_or(0);
            if id == flt.encounter && diff == flt.difficulty {
                if let Some(t) = parse_timestamp(ts, year) {
                    cur = Some(Pull::new(id, diff, t, label));
                }
            }
            continue;
        }
        let Some(p) = cur.as_mut() else { continue };
        let Some(t) = parse_timestamp(ts, year) else { continue };
        let mut f = Vec::with_capacity(48);
        split_fields(rest, &mut f);
        if f[0] == "ENCOUNTER_END" {
            let kill = f.get(5) == Some(&"1");
            let mut p = cur.take().expect("pull aberto");
            p.finish(t, kill);
            each(&p);
            continue;
        }
        p.push_line(t, &f);
    }
    if let Some(mut p) = cur.take() {
        let end = p.start + p.events.last().map_or(0, |e| e.t);
        p.finish(end, false);
        each(&p);
    }
    Ok(())
}

/// Pasta do `wcl-fetch.mjs` (report.json + fight-<id>.json): os eventos viram linhas pelo `to_fields`.
fn read_wcl(dir: &Path, flt: Filter, each: &mut dyn FnMut(&Pull)) -> Result<(), String> {
    let read = |name: &str| -> Result<Value, String> {
        let p = dir.join(name);
        let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))
    };
    let mut a = crate::wcl::WclAnalyzer::new(crate::rules::RuleBook::default(), 0, 0.0);
    a.add_report(&read("report.json")?, None)?;
    let fights: Vec<_> = a.fights().iter().filter(|f| f.encounter_id == flt.encounter && f.difficulty_id == flt.difficulty).cloned().collect();
    for fight in fights {
        let Ok(events) = read(&format!("fight-{}.json", fight.id)) else { continue };
        let label = format!("{}#{}", dir.display(), fight.id);
        let mut p = Pull::new(fight.encounter_id, fight.difficulty_id, fight.abs_start, &label);
        a.each_line(0, events.as_array().map_or(&[][..], |v| v.as_slice()), |t, f| p.push_line(t, f));
        p.finish(fight.abs_start + fight.end_time - fight.start_time, fight.kill);
        each(&p);
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Contas

fn pct(sorted: &[f32], p: f32) -> f32 {
    if sorted.is_empty() {
        return f32::NAN;
    }
    sorted[((sorted.len() - 1) as f32 * p).round() as usize]
}

fn sorted(mut v: Vec<f32>) -> Vec<f32> {
    v.retain(|x| x.is_finite());
    v.sort_by(f32::total_cmp);
    v
}

fn median(v: &[f32]) -> f32 {
    pct(&sorted(v.to_vec()), 0.5)
}

/// Arredonda para JSON (NaN vira null).
fn r(x: f32, places: i32) -> Value {
    if !x.is_finite() {
        return Value::Null;
    }
    if places == 0 {
        return json!(x.round() as i64);
    }
    let k = 10f64.powi(places);
    json!((x as f64 * k).round() / k)
}

fn p3(v: &[f32], places: i32) -> Value {
    let s = sorted(v.to_vec());
    json!([r(pct(&s, 0.1), places), r(pct(&s, 0.5), places), r(pct(&s, 0.9), places)])
}

/// Ângulo em (-π, π].
fn wrap(a: f32) -> f32 {
    let a = a.rem_euclid(TAU);
    if a > PI {
        a - TAU
    } else {
        a
    }
}

/// Raio pelo índice de Youden (acertos dentro − de fora dentro): (raio, TPR, FPR). Empate fica com o
/// menor raio (a borda de dentro do platô).
pub fn youden(hits: &[f32], others: &[f32], step: f32, max: f32) -> Option<(f32, f32, f32)> {
    if hits.is_empty() {
        return None;
    }
    let h = sorted(hits.to_vec());
    let o = sorted(others.to_vec());
    let (mut best, mut ih, mut io) = ((0.0, 0.0, 0.0, f32::MIN), 0, 0);
    let mut radius = step;
    while radius <= max + 1e-4 {
        while ih < h.len() && h[ih] <= radius {
            ih += 1;
        }
        while io < o.len() && o[io] <= radius {
            io += 1;
        }
        let tpr = ih as f32 / h.len() as f32;
        let fpr = if o.is_empty() { 0.0 } else { io as f32 / o.len() as f32 };
        if tpr - fpr > best.3 + 1e-6 {
            best = (radius, tpr, fpr, tpr - fpr);
        }
        radius += step;
    }
    Some((best.0, best.1, best.2))
}

fn ranks(v: &[f64]) -> Vec<f64> {
    let mut idx: Vec<usize> = (0..v.len()).collect();
    idx.sort_by(|&a, &b| v[a].total_cmp(&v[b]));
    let mut out = vec![0.0; v.len()];
    let mut i = 0;
    while i < idx.len() {
        let mut j = i;
        while j + 1 < idx.len() && v[idx[j + 1]] == v[idx[i]] {
            j += 1;
        }
        let rank = (i + j) as f64 / 2.0 + 1.0;
        for &k in &idx[i..=j] {
            out[k] = rank;
        }
        i = j + 1;
    }
    out
}

/// Correlação de Spearman (postos, com empates pela média).
pub fn spearman(x: &[f64], y: &[f64]) -> f64 {
    let (rx, ry) = (ranks(x), ranks(y));
    let n = rx.len() as f64;
    if n < 2.0 {
        return 0.0;
    }
    let (mx, my) = (rx.iter().sum::<f64>() / n, ry.iter().sum::<f64>() / n);
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for (a, b) in rx.iter().zip(&ry) {
        sxy += (a - mx) * (b - my);
        sxx += (a - mx).powi(2);
        syy += (b - my).powi(2);
    }
    if sxx == 0.0 || syy == 0.0 {
        0.0
    } else {
        sxy / (sxx * syy).sqrt()
    }
}

/// Inclinação de Theil–Sen (mediana das inclinações entre pares).
fn theil_sen(pts: &[(f32, f32)]) -> Option<(f32, f32)> {
    let mut slopes = Vec::new();
    for i in 0..pts.len() {
        for j in i + 1..pts.len() {
            let dx = pts[j].0 - pts[i].0;
            if dx.abs() > 1e-6 {
                slopes.push((pts[j].1 - pts[i].1) / dx);
            }
        }
    }
    let m = median(&slopes);
    if !m.is_finite() {
        return None;
    }
    let b = median(&pts.iter().map(|p| p.1 - m * p.0).collect::<Vec<_>>());
    Some((m, b))
}

// ---------------------------------------------------------------------------------------------
// Medidas

/// Opções da linha de comando.
#[derive(Debug, Clone, Default)]
pub struct Opts {
    pub damage: Option<u32>,
    pub aura: Option<u32>,
    pub npc: Option<u32>,
    pub cast: Option<u32>,
    pub all: bool,
    /// janela depois do fim do cast (s)
    pub window_s: Option<f32>,
    pub directions: Option<u32>,
    pub duration_s: Option<f32>,
}

pub const MEASURES: [&str; 8] = ["ids", "units", "falloff", "pulse-radius", "ahead", "cone", "wave-dir", "pool"];

trait Measure {
    fn pull(&mut self, p: &Pull);
    fn finish(self: Box<Self>) -> Value;
}

/// Roda a medida nas fontes; o JSON (camelCase) traz `encounter` e `pulls`.
pub fn run(measure: &str, sources: &[String], flt: Filter, o: &Opts) -> Result<Value, String> {
    let need = |v: Option<u32>, k: &str| v.ok_or_else(|| format!("{measure} precisa de {k}"));
    let mut m: Box<dyn Measure> = match measure {
        "ids" => Box::<Ids>::default(),
        "units" => Box::<Units>::default(),
        "falloff" => {
            if o.damage.is_none() && !o.all {
                return Err("falloff precisa de --damage <id> ou --all".into());
            }
            Box::new(Falloff { only: o.damage, ..Default::default() })
        }
        "pulse-radius" => Box::new(PulseRadius { damage: need(o.damage, "--damage")?, aura: o.aura, npc: o.npc, ..Default::default() }),
        "ahead" => {
            if o.cast.is_none() && o.damage.is_none() {
                return Err("ahead precisa de --cast ou --damage".into());
            }
            Box::new(Ahead { cast: o.cast, damage: o.damage, aura: o.aura, window: (o.window_s.unwrap_or(3.0) * 1000.0) as i64, ..Default::default() })
        }
        "cone" => Box::new(Cone { cast: need(o.cast, "--cast")?, damage: o.damage, window: (o.window_s.unwrap_or(3.0) * 1000.0) as i64, ..Default::default() }),
        "wave-dir" => {
            if o.aura.is_none() && o.cast.is_none() {
                return Err("wave-dir precisa de --aura ou --cast".into());
            }
            Box::new(WaveDir {
                aura: o.aura,
                cast: o.cast,
                damage: need(o.damage, "--damage")?,
                directions: o.directions.unwrap_or(4).max(1),
                duration: (o.duration_s.unwrap_or(6.0) * 1000.0) as i64,
                ..Default::default()
            })
        }
        "pool" => Box::new(Pool { cast: need(o.cast, "--cast")?, damage: need(o.damage, "--damage")?, duration: (o.duration_s.unwrap_or(30.0) * 1000.0) as i64, ..Default::default() }),
        _ => return Err(format!("medida desconhecida: {measure} (use {})", MEASURES.join(", "))),
    };
    let pulls = for_each_pull(sources, flt, |p| m.pull(p))?;
    let mut v = m.finish();
    if let Value::Object(obj) = &mut v {
        obj.insert("encounter".into(), json!(flt.encounter));
        obj.insert("pulls".into(), json!(pulls));
    }
    Ok(v)
}

/// Quem lança conta como inimigo (ou sem origem: o areatrigger do boss no log local).
fn enemy_or_nil(p: &Pull, u: u32) -> bool {
    let unit = p.unit(u);
    unit.is_enemy() || unit.is_nil()
}

// --- ids --------------------------------------------------------------------------------------

#[derive(Default)]
struct IdAcc {
    name: String,
    cast_start: u32,
    cast_success: u32,
    casters: BTreeSet<String>,
    aura_players: u32,
    aura_enemies: u32,
    aura_sources: BTreeSet<String>,
    damage_hits: u32,
    damage: i64,
    damage_sources: BTreeSet<String>,
    summons: u32,
}

#[derive(Default)]
struct Ids {
    spells: BTreeMap<u32, IdAcc>,
}

impl Measure for Ids {
    fn pull(&mut self, p: &Pull) {
        for e in &p.events {
            if e.spell == 0 || !enemy_or_nil(p, e.src) {
                continue;
            }
            let dst_player = p.is_player(e.dst);
            let acc = self.spells.entry(e.spell).or_default();
            if acc.name.is_empty() {
                acc.name = p.spell_name(e.spell);
            }
            let src = p.name(e.src).to_string();
            match e.kind {
                Kind::CastStart | Kind::CastSuccess => {
                    if e.kind == Kind::CastStart {
                        acc.cast_start += 1;
                    } else {
                        acc.cast_success += 1;
                    }
                    acc.casters.insert(src);
                }
                Kind::AuraApplied if dst_player => {
                    acc.aura_players += 1;
                    acc.aura_sources.insert(src);
                }
                Kind::AuraApplied if p.unit(e.dst).is_enemy() => {
                    acc.aura_enemies += 1;
                    acc.aura_sources.insert(src);
                }
                k if is_hit(k) && dst_player => {
                    acc.damage_hits += 1;
                    acc.damage += e.amount;
                    acc.damage_sources.insert(src);
                }
                Kind::Summon => acc.summons += 1,
                _ => {}
            }
        }
    }

    fn finish(self: Box<Self>) -> Value {
        let spells: Vec<Value> = self
            .spells
            .into_iter()
            .filter(|(_, a)| a.cast_start + a.cast_success + a.aura_players + a.aura_enemies + a.damage_hits + a.summons > 0)
            .map(|(id, a)| {
                json!({
                    "spellId": id, "name": a.name, "castStart": a.cast_start, "castSuccess": a.cast_success,
                    "casters": a.casters, "auraOnPlayers": a.aura_players, "auraOnEnemies": a.aura_enemies,
                    "auraSources": a.aura_sources, "damageHits": a.damage_hits, "damage": a.damage,
                    "damageSources": a.damage_sources, "summons": a.summons
                })
            })
            .collect();
        json!({ "spells": spells })
    }
}

// --- units ------------------------------------------------------------------------------------

#[derive(Default)]
struct NpcAcc {
    name: String,
    units: u32,
    lines: u64,
    lines_pos: u64,
    first_line: Vec<f32>,
    first_pos: Vec<f32>,
    no_pos: u32,
    spawns: Vec<(f32, f32)>,
    max_hp: Vec<f32>,
    died: u32,
    max_gap: f32,
}

#[derive(Default)]
struct Units {
    npcs: BTreeMap<u32, NpcAcc>,
}

impl Measure for Units {
    fn pull(&mut self, p: &Pull) {
        // por unidade: linhas, linhas com a própria posição, primeira e última linha, maior vão
        let n = p.units.len();
        let (mut lines, mut with_pos) = (vec![0u64; n], vec![0u64; n]);
        let (mut first, mut last, mut gap) = (vec![i64::MAX; n], vec![i64::MIN; n], vec![0i64; n]);
        for e in &p.events {
            let mut cite = |u: u32| {
                let i = u as usize;
                lines[i] += 1;
                if e.pos == u {
                    with_pos[i] += 1;
                }
                if last[i] != i64::MIN {
                    gap[i] = gap[i].max(e.t - last[i]);
                }
                first[i] = first[i].min(e.t);
                last[i] = e.t;
            };
            cite(e.src);
            if e.dst != e.src {
                cite(e.dst);
            }
            if e.pos != NONE && e.pos != e.src && e.pos != e.dst {
                cite(e.pos);
            }
        }
        for (i, u) in p.units.iter().enumerate() {
            let Some(npc) = u.npc() else { continue };
            if !u.is_enemy() || lines[i] == 0 {
                continue;
            }
            let acc = self.npcs.entry(npc).or_default();
            if acc.name.is_empty() {
                acc.name = u.name.clone();
            }
            acc.units += 1;
            acc.lines += lines[i];
            acc.lines_pos += with_pos[i];
            acc.first_line.push(first[i] as f32 / 1000.0);
            match p.tracks[i].first() {
                Some(s) => {
                    acc.first_pos.push(s.t as f32 / 1000.0);
                    acc.spawns.push((s.x, s.y));
                }
                None => acc.no_pos += 1,
            }
            if let Some(hp) = p.tracks[i].iter().map(|s| s.max_hp).max() {
                acc.max_hp.push(hp as f32);
            }
            if !p.deaths[i].is_empty() {
                acc.died += 1;
            }
            acc.max_gap = acc.max_gap.max(gap[i] as f32 / 1000.0);
        }
    }

    fn finish(self: Box<Self>) -> Value {
        let mut out: Vec<(u32, Value)> = self
            .npcs
            .into_iter()
            .map(|(npc, a)| {
                let spawns: Vec<Value> = clusters(&a.spawns, 3.0).into_iter().take(10).map(|(x, y, n)| json!([r(x, 1), r(y, 1), n])).collect();
                let hp = sorted(a.max_hp.clone());
                let v = json!({
                    "npcId": npc, "name": a.name, "units": a.units, "lines": a.lines,
                    "posPct": r(100.0 * a.lines_pos as f32 / a.lines.max(1) as f32, 1),
                    "firstLineS": r(median(&a.first_line), 1), "firstPosS": r(median(&a.first_pos), 1), "noPos": a.no_pos,
                    "spawns": spawns, "hpMedian": r(pct(&hp, 0.5), 0), "hpMax": r(hp.last().copied().unwrap_or(f32::NAN), 0),
                    "diedPct": r(100.0 * a.died as f32 / a.units.max(1) as f32, 1), "maxGapS": r(a.max_gap, 1)
                });
                (a.units, v)
            })
            .collect();
        out.sort_by_key(|(n, _)| std::cmp::Reverse(*n));
        json!({ "units": out.into_iter().map(|(_, v)| v).collect::<Vec<_>>() })
    }
}

/// Grupos de pontos a até `radius` do meio do grupo, do maior para o menor: (x, y, quantos).
fn clusters(pts: &[(f32, f32)], radius: f32) -> Vec<(f32, f32, usize)> {
    let mut groups: Vec<(f32, f32, usize)> = Vec::new();
    for &(x, y) in pts {
        match groups.iter_mut().find(|g| (g.0 - x).hypot(g.1 - y) <= radius) {
            Some(g) => {
                let n = g.2 as f32;
                g.0 = (g.0 * n + x) / (n + 1.0);
                g.1 = (g.1 * n + y) / (n + 1.0);
                g.2 += 1;
            }
            None => groups.push((x, y, 1)),
        }
    }
    groups.sort_by_key(|g| std::cmp::Reverse(g.2));
    groups
}

// --- falloff ----------------------------------------------------------------------------------

#[derive(Default)]
struct Falloff {
    only: Option<u32>,
    /// spell -> (nome, [(distância, dano bruto)])
    hits: BTreeMap<u32, (String, Vec<(f32, i64)>)>,
}

impl Measure for Falloff {
    fn pull(&mut self, p: &Pull) {
        for e in &p.events {
            // quem lança: inimigo, ou player só quando a mecânica sai dele (não pets, totens, Spirit Link)
            let src = p.unit(e.src);
            if !matches!(e.kind, Kind::Damage | Kind::Periodic | Kind::Swing) || e.base <= 0 || e.src == e.dst || src.is_nil() || src.player_owned || !p.is_player(e.dst) {
                continue;
            }
            if self.only.is_some_and(|id| id != e.spell) {
                continue;
            }
            let (Some(v), Some(s)) = (p.pos(e.dst, e.t), p.pos(e.src, e.t)) else { continue };
            let acc = self.hits.entry(e.spell).or_insert_with(|| (p.spell_name(e.spell), Vec::new()));
            acc.1.push(((v.0 - s.0).hypot(v.1 - s.1), e.base));
        }
    }

    fn finish(self: Box<Self>) -> Value {
        let min = if self.only.is_some() { 1 } else { 30 };
        let spells: Vec<Value> = self.hits.into_iter().filter(|(_, (_, h))| h.len() >= min).map(|(id, (name, h))| falloff_spell(id, &name, &h)).collect();
        json!({ "spells": spells })
    }
}

/// Faixas de 5 jd, Spearman e o veredito de uma spell.
pub fn falloff_spell(id: u32, name: &str, h: &[(f32, i64)]) -> Value {
    let rho = spearman(&h.iter().map(|x| x.0 as f64).collect::<Vec<_>>(), &h.iter().map(|x| x.1 as f64).collect::<Vec<_>>());
    let mut bands: BTreeMap<u32, Vec<f32>> = BTreeMap::new();
    for &(d, b) in h {
        bands.entry((d / 5.0) as u32).or_default().push(b as f32);
    }
    let bands: Vec<(u32, usize, f32)> = bands.into_iter().map(|(k, v)| (k * 5, v.len(), median(&v))).collect();
    let solid: Vec<&(u32, usize, f32)> = bands.iter().filter(|b| b.1 >= 10).collect();
    let drops = match (solid.first(), solid.last()) {
        (Some(near), Some(far)) if solid.len() >= 2 => far.2 <= 0.8 * near.2,
        _ => false,
    };
    // medianas iguais em todas as faixas (com 10 ou mais): o rho vem de poucos acertos fora da curva
    // (a Caustic Explosion: 222153 de 0 a 55 jd e rho 0,27)
    let flat = solid.len() >= 2 && solid.iter().all(|b| (b.2 - solid[0].2).abs() <= 0.05 * solid[0].2.abs());
    let verdict = if rho <= -0.3 && drops {
        "cai"
    } else if rho.abs() < 0.15 || flat {
        "nao_cai"
    } else {
        "incerto"
    };
    json!({
        "spellId": id, "name": name, "hits": h.len(), "rho": r(rho as f32, 3), "verdict": verdict,
        "bands": bands.iter().map(|b| json!([b.0, b.1, b.2.round() as i64])).collect::<Vec<_>>()
    })
}

// --- pulse-radius -----------------------------------------------------------------------------

/// Até onde quem não tomou conta (jardas do centro mais perto).
const PULSE_NEAR: f32 = 25.0;
/// Quem perdeu a aura ainda solta o último pulso.
const AURA_GRACE_MS: i64 = 1_000;

#[derive(Default)]
struct PulseRadius {
    damage: u32,
    aura: Option<u32>,
    npc: Option<u32>,
    lots: u32,
    /// (distância, idade do debuff em ms)
    hits: Vec<(f32, i64)>,
    others: Vec<(f32, i64)>,
}

/// Quem teve a aura e quando: (unidade, início, fim, saiu de verdade).
fn aura_intervals(p: &Pull, aura: u32, players_only: bool) -> Vec<(u32, i64, i64, bool)> {
    let mut open: HashMap<u32, i64> = HashMap::new();
    let mut out = Vec::new();
    for e in p.events.iter().filter(|e| e.spell == aura) {
        if players_only && !p.is_player(e.dst) {
            continue;
        }
        match e.kind {
            Kind::AuraApplied => {
                open.entry(e.dst).or_insert(e.t);
            }
            Kind::AuraRemoved => {
                if let Some(s) = open.remove(&e.dst) {
                    out.push((e.dst, s, e.t, true));
                }
            }
            _ => {}
        }
    }
    out.extend(open.into_iter().map(|(u, s)| (u, s, p.duration, false)));
    out.sort_by_key(|x| x.1);
    out
}

impl Measure for PulseRadius {
    fn pull(&mut self, p: &Pull) {
        let holders = self.aura.map(|a| aura_intervals(p, a, true)).unwrap_or_default();
        let hits: Vec<&Event> = p.events.iter().filter(|e| e.spell == self.damage && is_hit(e.kind) && p.is_player(e.dst)).collect();
        let players: Vec<u32> = p.players().collect();
        let mut i = 0;
        while i < hits.len() {
            let t = hits[i].t;
            let j = i + hits[i..].iter().take_while(|e| e.t == t).count();
            let lot = &hits[i..j];
            i = j;
            // centros: portadores da aura, unidades do npc ou quem lançou
            let centers: Vec<(u32, f32, f32, i64)> = if self.aura.is_some() {
                holders.iter().filter(|h| h.1 <= t && t <= h.2 + AURA_GRACE_MS).filter_map(|h| p.pos(h.0, t).map(|(x, y)| (h.0, x, y, t - h.1))).collect()
            } else if let Some(npc) = self.npc {
                (0..p.units.len() as u32).filter(|&u| p.unit(u).npc() == Some(npc)).filter_map(|u| p.pos(u, t).map(|(x, y)| (u, x, y, 0))).collect()
            } else {
                let srcs: HashSet<u32> = lot.iter().map(|e| e.src).collect();
                srcs.into_iter().filter_map(|u| p.pos(u, t).map(|(x, y)| (u, x, y, 0))).collect()
            };
            if centers.is_empty() {
                continue;
            }
            let is_center: HashSet<u32> = centers.iter().map(|c| c.0).collect();
            let nearest = |x: f32, y: f32, among: &[(u32, f32, f32, i64)]| among.iter().map(|c| ((c.1 - x).hypot(c.2 - y), c.3)).min_by(|a, b| a.0.total_cmp(&b.0));
            // centros que pulsaram: o mais perto de cada acerto
            let mut active: Vec<(u32, f32, f32, i64)> = Vec::new();
            let mut hit_set: HashSet<u32> = HashSet::new();
            let mut lot_hits = Vec::new();
            for e in lot {
                hit_set.insert(e.dst);
                if is_center.contains(&e.dst) {
                    continue;
                }
                let Some((x, y)) = p.pos(e.dst, t) else { continue };
                let c = centers.iter().min_by(|a, b| (a.1 - x).hypot(a.2 - y).total_cmp(&(b.1 - x).hypot(b.2 - y))).copied().expect("centros");
                if !active.iter().any(|a| a.0 == c.0) {
                    active.push(c);
                }
                lot_hits.push(((c.1 - x).hypot(c.2 - y), c.3));
            }
            // o portador tomou o próprio pulso: ele é o centro ativo
            for e in lot.iter().filter(|e| is_center.contains(&e.dst)) {
                if let Some(c) = centers.iter().find(|c| c.0 == e.dst) {
                    if !active.iter().any(|a| a.0 == c.0) {
                        active.push(*c);
                    }
                }
            }
            if active.is_empty() {
                continue;
            }
            self.lots += 1;
            self.hits.extend(lot_hits);
            for &u in &players {
                if hit_set.contains(&u) || is_center.contains(&u) {
                    continue;
                }
                let Some((x, y)) = p.pos(u, t) else { continue };
                if let Some((d, age)) = nearest(x, y, &active).filter(|n| n.0 <= PULSE_NEAR) {
                    self.others.push((d, age));
                }
            }
        }
    }

    fn finish(self: Box<Self>) -> Value {
        let fit = |h: &[(f32, i64)], o: &[(f32, i64)]| {
            let hd: Vec<f32> = h.iter().map(|x| x.0).collect();
            let od: Vec<f32> = o.iter().map(|x| x.0).collect();
            youden(&hd, &od, 0.25, PULSE_NEAR).map(|(rad, tpr, fpr)| (rad, tpr, fpr, hd.len(), od.len()))
        };
        let main = fit(&self.hits, &self.others);
        let mut by_age = Vec::new();
        if self.aura.is_some() {
            for k in 0..8 {
                let (a, b) = (k * 3000, (k + 1) * 3000);
                let h: Vec<_> = self.hits.iter().filter(|x| x.1 >= a && x.1 < b).copied().collect();
                let o: Vec<_> = self.others.iter().filter(|x| x.1 >= a && x.1 < b).copied().collect();
                if h.len() < 10 {
                    continue;
                }
                if let Some((rad, tpr, fpr, nh, no)) = fit(&h, &o) {
                    by_age.push(json!({ "fromS": a / 1000, "toS": b / 1000, "radius": r(rad, 2), "tpr": r(tpr, 3), "fpr": r(fpr, 3), "hits": nh, "others": no }));
                }
            }
        }
        let (center, center_id) = match (self.aura, self.npc) {
            (Some(a), _) => ("aura", Some(a)),
            (None, Some(n)) => ("npc", Some(n)),
            _ => ("source", None),
        };
        let (rad, tpr, fpr, nh, no) = main.unwrap_or((f32::NAN, f32::NAN, f32::NAN, 0, self.others.len()));
        json!({
            "damageId": self.damage, "center": center, "centerId": center_id, "lots": self.lots,
            "radius": r(rad, 2), "tpr": r(tpr, 3), "fpr": r(fpr, 3), "hits": nh, "others": no, "byAge": by_age
        })
    }
}

// --- casts (ahead e cone) ---------------------------------------------------------------------

/// Fim de um cast: quem lançou, onde e para onde olhava.
#[derive(Debug, Clone, Copy)]
struct CastEnd {
    t: i64,
    caster: u32,
    x: f32,
    y: f32,
    facing: f32,
}

/// Fins de cast do id (de inimigo), com posição e direção de quem lançou.
fn cast_ends(p: &Pull, id: u32) -> Vec<CastEnd> {
    p.events
        .iter()
        .filter(|e| e.kind == Kind::CastSuccess && e.spell == id && !p.is_player(e.src))
        .filter_map(|e| {
            let (x, y) = p.pos(e.src, e.t)?;
            Some(CastEnd { t: e.t, caster: e.src, x, y, facing: p.facing(e.src, e.t).unwrap_or(f32::NAN) })
        })
        .collect()
}

/// Sem `--damage`: o dano em players de quem lançou que aparece depois de mais casts (fora o Melee).
fn guess_damage(p: &Pull, casts: &[CastEnd], window: i64) -> Option<u32> {
    let mut count: HashMap<u32, u32> = HashMap::new();
    for c in casts {
        let seen: HashSet<u32> = p
            .events
            .iter()
            .filter(|e| e.t >= c.t && e.t <= c.t + window && e.src == c.caster && e.spell > 1 && matches!(e.kind, Kind::Damage | Kind::Missed) && p.is_player(e.dst))
            .map(|e| e.spell)
            .collect();
        for s in seen {
            *count.entry(s).or_default() += 1;
        }
    }
    count.into_iter().max_by_key(|&(s, n)| (n, std::cmp::Reverse(s))).map(|(s, _)| s)
}

/// Junta pontos (t, x, y) aos casts: cada ponto vai para o cast cuja referência (`refpt`) está mais
/// perto, entre os casts com `t` a até `window` depois do fim. Fica o primeiro lote (600 ms) de cada um.
fn assign(casts: &[CastEnd], pts: &[(i64, f32, f32)], window: i64, refpt: impl Fn(&CastEnd) -> (f32, f32)) -> Vec<Vec<(i64, f32, f32)>> {
    let mut out: Vec<Vec<(i64, f32, f32)>> = vec![Vec::new(); casts.len()];
    for &pt in pts {
        let best = casts
            .iter()
            .enumerate()
            .filter(|(_, c)| pt.0 >= c.t && pt.0 <= c.t + window)
            .map(|(i, c)| {
                let (rx, ry) = refpt(c);
                (i, (rx - pt.1).hypot(ry - pt.2))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((i, _)) = best {
            out[i].push(pt);
        }
    }
    for v in &mut out {
        if let Some(t0) = v.iter().map(|p| p.0).min() {
            v.retain(|p| p.0 - t0 <= 600);
        }
    }
    out
}

fn centroid(v: &[(i64, f32, f32)]) -> (f32, f32) {
    let n = v.len() as f32;
    (v.iter().map(|p| p.1).sum::<f32>() / n, v.iter().map(|p| p.2).sum::<f32>() / n)
}

// --- ahead ------------------------------------------------------------------------------------

#[derive(Default)]
struct Ahead {
    cast: Option<u32>,
    damage: Option<u32>,
    aura: Option<u32>,
    window: i64,
    casts: u32,
    damage_ids: BTreeSet<u32>,
    /// por cast com pontos: (ao longo, de lado, ângulo em graus, distância, quantos, posição relativa)
    rows: Vec<(f32, f32, f32, f32, usize)>,
    /// meio do lote de cada cast em relação a quem lançou (ao longo, de lado), para o desvio no fim
    offsets: Vec<(f32, f32)>,
}

impl Measure for Ahead {
    fn pull(&mut self, p: &Pull) {
        // sem cast: o primeiro acerto de cada lote (600 ms) de quem lança é o "fim do cast"
        let casts: Vec<CastEnd> = match self.cast {
            Some(id) => cast_ends(p, id),
            None => {
                let id = self.damage.expect("validado");
                let mut last: HashMap<u32, i64> = HashMap::new();
                p.events
                    .iter()
                    .filter(|e| e.spell == id && is_hit(e.kind) && p.is_player(e.dst) && !p.unit(e.src).is_nil())
                    .filter_map(|e| {
                        if last.get(&e.src).is_some_and(|&l| e.t - l <= 600) {
                            return None;
                        }
                        last.insert(e.src, e.t);
                        let (x, y) = p.pos(e.src, e.t)?;
                        Some(CastEnd { t: e.t, caster: e.src, x, y, facing: p.facing(e.src, e.t).unwrap_or(f32::NAN) })
                    })
                    .collect()
            }
        };
        let casts: Vec<CastEnd> = casts.into_iter().filter(|c| c.facing.is_finite()).collect();
        self.casts += casts.len() as u32;
        if casts.is_empty() {
            return;
        }
        let pts: Vec<(i64, f32, f32)> = if let Some(aura) = self.aura {
            p.events.iter().filter(|e| e.kind == Kind::AuraApplied && e.spell == aura && p.is_player(e.dst)).filter_map(|e| p.pos(e.dst, e.t).map(|(x, y)| (e.t, x, y))).collect()
        } else {
            let Some(dmg) = self.damage.or_else(|| guess_damage(p, &casts, self.window)) else { return };
            self.damage_ids.insert(dmg);
            p.events.iter().filter(|e| e.spell == dmg && is_hit(e.kind) && p.is_player(e.dst)).filter_map(|e| p.pos(e.dst, e.t).map(|(x, y)| (e.t, x, y))).collect()
        };
        let rel = |c: &CastEnd, (x, y): (f32, f32)| {
            let (dx, dy) = (x - c.x, y - c.y);
            let (cs, sn) = (c.facing.cos(), c.facing.sin());
            (dx * cs + dy * sn, -dx * sn + dy * cs)
        };
        // 1ª passada pela posição de quem lançou; a 2ª pelo ponto na frente
        let first = assign(&casts, &pts, self.window, |c| (c.x, c.y));
        let along0: Vec<f32> = casts.iter().zip(&first).filter(|(_, v)| !v.is_empty()).map(|(c, v)| rel(c, centroid(v)).0).collect();
        let r0 = median(&along0);
        let lots = if r0.is_finite() { assign(&casts, &pts, self.window, |c| (c.x + r0 * c.facing.cos(), c.y + r0 * c.facing.sin())) } else { first };
        for (c, v) in casts.iter().zip(&lots) {
            if v.is_empty() {
                continue;
            }
            let (a, s) = rel(c, centroid(v));
            self.rows.push((a, s, s.atan2(a).to_degrees(), a.hypot(s), v.len()));
            self.offsets.push((a, s));
        }
    }

    fn finish(self: Box<Self>) -> Value {
        let col = |k: usize| -> Vec<f32> {
            self.rows
                .iter()
                .map(|r| match k {
                    0 => r.0,
                    1 => r.1,
                    2 => r.2,
                    3 => r.3,
                    _ => r.4 as f32,
                })
                .collect()
        };
        let along = col(0);
        let big_r = median(&along);
        let off: Vec<f32> = self.offsets.iter().map(|o| (o.0 - big_r).hypot(o.1)).collect();
        let off_s = sorted(off);
        json!({
            "castId": self.cast, "pointsFrom": if self.aura.is_some() { "aura" } else { "damage" },
            "pointsId": self.aura.or(self.damage).or(self.damage_ids.iter().next().copied()),
            "damageIds": self.damage_ids, "casts": self.casts, "withPoints": self.rows.len(),
            "r": r(big_r, 1), "along": p3(&along, 1), "side": p3(&col(1), 1), "angle": p3(&col(2), 1),
            "dist": p3(&col(3), 1), "points": p3(&col(4), 0), "offset": [r(pct(&off_s, 0.5), 1), r(pct(&off_s, 0.9), 1)]
        })
    }
}

// --- cone -------------------------------------------------------------------------------------

#[derive(Default)]
struct Cone {
    cast: u32,
    damage: Option<u32>,
    window: i64,
    casts: u32,
    damage_ids: BTreeSet<u32>,
    /// (ângulo até a direção em graus, distância, tomou)
    samples: Vec<(f32, f32, bool)>,
}

impl Measure for Cone {
    fn pull(&mut self, p: &Pull) {
        let casts: Vec<CastEnd> = cast_ends(p, self.cast).into_iter().filter(|c| c.facing.is_finite()).collect();
        self.casts += casts.len() as u32;
        let Some(dmg) = self.damage.or_else(|| guess_damage(p, &casts, self.window)) else { return };
        self.damage_ids.insert(dmg);
        // cada acerto vai para o cast mais recente
        let mut per: Vec<Vec<(i64, u32)>> = vec![Vec::new(); casts.len()];
        for e in p.events.iter().filter(|e| e.spell == dmg && is_hit(e.kind) && p.is_player(e.dst)) {
            if let Some(i) = casts.iter().rposition(|c| e.t >= c.t && e.t <= c.t + self.window) {
                per[i].push((e.t, e.dst));
            }
        }
        let players: Vec<u32> = p.players().collect();
        for (c, hs) in casts.iter().zip(&per) {
            let th = hs.iter().map(|h| h.0).min().unwrap_or(c.t);
            let hit: HashSet<u32> = hs.iter().map(|h| h.1).collect();
            for &u in &players {
                let t = hs.iter().find(|h| h.1 == u).map_or(th, |h| h.0);
                let Some((x, y)) = p.pos(u, t) else { continue };
                let (dx, dy) = (x - c.x, y - c.y);
                let ang = wrap(dy.atan2(dx) - c.facing).abs().to_degrees();
                self.samples.push((ang, dx.hypot(dy), hit.contains(&u)));
            }
        }
    }

    fn finish(self: Box<Self>) -> Value {
        let nh = self.samples.iter().filter(|s| s.2).count();
        let no = self.samples.len() - nh;
        let mut best = (f32::NAN, f32::NAN, f32::NAN, f32::NAN, f32::MIN);
        if nh > 0 {
            let mut a = 5.0f32;
            while a <= 180.0 {
                let mut range = 2.0f32;
                while range <= 80.0 {
                    let (mut ih, mut io) = (0, 0);
                    for s in &self.samples {
                        if s.0 <= a && s.1 <= range {
                            if s.2 {
                                ih += 1;
                            } else {
                                io += 1;
                            }
                        }
                    }
                    let tpr = ih as f32 / nh as f32;
                    let fpr = if no == 0 { 0.0 } else { io as f32 / no as f32 };
                    if tpr - fpr > best.4 + 1e-6 {
                        best = (a, range, tpr, fpr, tpr - fpr);
                    }
                    range += 1.0;
                }
                a += 2.5;
            }
        }
        json!({
            "castId": self.cast, "damageIds": self.damage_ids, "casts": self.casts,
            "halfAngle": r(best.0, 1), "range": r(best.1, 1), "tpr": r(best.2, 3), "fpr": r(best.3, 3), "hits": nh, "others": no
        })
    }
}

// --- wave-dir ---------------------------------------------------------------------------------

/// Bases de direção: eixos do mundo, direção de quem solta (na saída, na aplicação), do boss até ele.
const BASES: [&str; 4] = ["world", "facingOut", "facingIn", "fromBoss"];
/// Acerto a até isto de um raio conta como explicado.
const WAVE_LANE: f32 = 2.5;
/// Acertos perto da fonte não dizem a direção.
const WAVE_MIN_DIST: f32 = 4.0;

/// Um acerto visto de cada fonte ativa: (dx, dy, tempo desde a saída em ms, ângulo de cada base).
type WaveHit = Vec<(f32, f32, i64, [f32; 4])>;

#[derive(Default)]
struct WaveDir {
    aura: Option<u32>,
    cast: Option<u32>,
    damage: u32,
    directions: u32,
    duration: i64,
    sources: u32,
    hits: Vec<WaveHit>,
}

impl Measure for WaveDir {
    fn pull(&mut self, p: &Pull) {
        let boss = p.boss();
        // fontes: (t, x, y, ângulos das bases; NaN = sem)
        let mut srcs: Vec<(i64, f32, f32, [f32; 4])> = Vec::new();
        let from_boss = |u: u32, t: i64, x: f32, y: f32| match boss.filter(|&b| b != u).and_then(|b| p.pos(b, t)) {
            Some((bx, by)) => (y - by).atan2(x - bx),
            None => f32::NAN,
        };
        if let Some(aura) = self.aura {
            for (u, start, end, real) in aura_intervals(p, aura, true) {
                let Some((x, y)) = p.pos(u, end).filter(|_| real) else { continue };
                let out = p.facing(u, end).unwrap_or(f32::NAN);
                let inn = p.facing(u, start).unwrap_or(f32::NAN);
                srcs.push((end, x, y, [0.0, out, inn, from_boss(u, end, x, y)]));
            }
        } else if let Some(cast) = self.cast {
            for c in cast_ends(p, cast) {
                srcs.push((c.t, c.x, c.y, [0.0, c.facing, f32::NAN, from_boss(c.caster, c.t, c.x, c.y)]));
            }
        }
        self.sources += srcs.len() as u32;
        for e in p.events.iter().filter(|e| e.spell == self.damage && is_hit(e.kind) && p.is_player(e.dst)) {
            let Some((x, y)) = p.pos(e.dst, e.t) else { continue };
            let rels: WaveHit = srcs
                .iter()
                .filter(|s| e.t >= s.0 && e.t <= s.0 + self.duration)
                .map(|s| (x - s.1, y - s.2, e.t - s.0, s.3))
                .filter(|r| r.0.hypot(r.1) > WAVE_MIN_DIST)
                .collect();
            if !rels.is_empty() {
                self.hits.push(rels);
            }
        }
    }

    fn finish(self: Box<Self>) -> Value {
        let k = self.directions;
        let step = TAU / k as f32;
        // o raio que explica o acerto: (ao longo, de lado, ms)
        let lane = |h: &WaveHit, b: usize, phi: f32| -> Option<(f32, f32, i64)> {
            let mut best: Option<(f32, f32, i64)> = None;
            for &(dx, dy, dt, bases) in h {
                if !bases[b].is_finite() {
                    continue;
                }
                for j in 0..k {
                    let th = bases[b] + phi + j as f32 * step;
                    let (cs, sn) = (th.cos(), th.sin());
                    let along = dx * cs + dy * sn;
                    let lat = (-dx * sn + dy * cs).abs();
                    if along > 0.0 && best.is_none_or(|b| lat < b.1) {
                        best = Some((along, lat, dt));
                    }
                }
            }
            best
        };
        let degs = (360 / k).max(1);
        let mut bases_out = Vec::new();
        let mut best: Option<(usize, u32, usize, f32, usize)> = None;
        for (b, base) in BASES.iter().enumerate() {
            let usable = self.hits.iter().filter(|h| h.iter().any(|r| r.3[b].is_finite())).count();
            if usable == 0 {
                continue;
            }
            let counts: Vec<usize> = (0..degs).map(|d| self.hits.iter().filter(|h| lane(h, b, (d as f32).to_radians()).is_some_and(|l| l.1 <= WAVE_LANE)).count()).collect();
            let (phi, &n) = counts.iter().enumerate().max_by_key(|(i, n)| (**n, std::cmp::Reverse(*i))).expect("ângulos");
            let random = counts.iter().sum::<usize>() as f32 / counts.len() as f32;
            bases_out.push(json!({ "base": base, "phi": phi, "explained": n, "random": r(random, 1), "hits": usable }));
            if best.is_none_or(|x| n as f32 - random > x.2 as f32 - x.3) {
                best = Some((b, phi as u32, n, random, usable));
            }
        }
        let Some((b, phi, n, random, usable)) = best else {
            return json!({ "damageId": self.damage, "sources": self.sources, "hits": self.hits.len(), "bases": bases_out, "best": null });
        };
        let phi_r = (phi as f32).to_radians();
        let lanes: Vec<(f32, f32, i64)> = self.hits.iter().filter_map(|h| lane(h, b, phi_r)).collect();
        // velocidade: o acerto é quando a frente chega no player. Por faixa de 250 ms, a mediana (tempo,
        // distância ao longo) dos acertos; a reta pelas faixas sai pelo Theil–Sen. O máximo de cada faixa
        // (o envelope puro) pega acertos de outra onda que passou a 2,5 jd do raio e erra a reta
        // (Plague Wave: 7,5 jd/s em vez de 12,3).
        let mut env: BTreeMap<i64, (Vec<f32>, Vec<f32>)> = BTreeMap::new();
        for l in lanes.iter().filter(|l| l.1 <= WAVE_LANE) {
            let e = env.entry(l.2 / 250).or_default();
            e.0.push(l.2 as f32 / 1000.0);
            e.1.push(l.0);
        }
        let front: Vec<(f32, f32)> = env.values().map(|(t, a)| (median(t), median(a))).collect();
        let fit = if front.len() >= 3 { theil_sen(&front) } else { None };
        let lat = sorted(lanes.iter().map(|l| l.1).filter(|&l| l <= 5.0).collect());
        let far = lanes.iter().filter(|l| l.1 <= WAVE_LANE).max_by(|a, b| a.0.total_cmp(&b.0));
        json!({
            "damageId": self.damage, "sources": self.sources, "hits": self.hits.len(), "directions": k, "bases": bases_out,
            "best": { "base": BASES[b], "phi": phi, "explained": n, "random": r(random, 1), "hits": usable },
            "start": r(fit.map_or(f32::NAN, |f| f.1), 1), "speed": r(fit.map_or(f32::NAN, |f| f.0), 2),
            "width": r(2.0 * pct(&lat, 0.95), 1), "lateralMax": r(lat.last().copied().unwrap_or(f32::NAN), 1),
            "farthest": far.map(|l| json!([r(l.0, 1), r(l.2 as f32 / 1000.0, 2)]))
        })
    }
}

// --- pool -------------------------------------------------------------------------------------

#[derive(Default)]
struct Pool {
    cast: u32,
    damage: u32,
    duration: i64,
    pulls: u32,
    rows: Vec<Value>,
}

/// Círculos (x, y, raio), TPR e FPR.
pub type CircleFit = (Vec<(f32, f32, f32)>, f32, f32);

/// Até 2 círculos pelo Youden: amostras (x, y, tomou).
pub fn fit_circles(s: &[(f32, f32, bool)]) -> Option<CircleFit> {
    let one = |s: &[(f32, f32, bool)], nh: usize, no: usize| -> Option<(f32, f32, f32, usize, usize)> {
        let hits: Vec<&(f32, f32, bool)> = s.iter().filter(|p| p.2).collect();
        if hits.is_empty() {
            return None;
        }
        let (x0, x1) = hits.iter().fold((f32::MAX, f32::MIN), |a, p| (a.0.min(p.0), a.1.max(p.0)));
        let (y0, y1) = hits.iter().fold((f32::MAX, f32::MIN), |a, p| (a.0.min(p.1), a.1.max(p.1)));
        let mut best: Option<(f32, f32, f32, usize, usize, f32)> = None;
        let mut d: Vec<(f32, bool)> = Vec::with_capacity(s.len());
        let mut cy = y0 - 5.0;
        while cy <= y1 + 5.0 {
            let mut cx = x0 - 5.0;
            while cx <= x1 + 5.0 {
                d.clear();
                d.extend(s.iter().map(|p| ((p.0 - cx).hypot(p.1 - cy), p.2)));
                d.sort_by(|a, b| a.0.total_cmp(&b.0));
                let (mut ih, mut io, mut k) = (0, 0, 0);
                let mut rad = 1.0f32;
                while rad <= 40.0 {
                    while k < d.len() && d[k].0 <= rad {
                        if d[k].1 {
                            ih += 1;
                        } else {
                            io += 1;
                        }
                        k += 1;
                    }
                    let j = ih as f32 / nh as f32 - if no == 0 { 0.0 } else { io as f32 / no as f32 };
                    // empate: o menor círculo (o centro que precisa de menos raio está mais perto do certo)
                    if best.is_none_or(|b| j > b.5 + 1e-6 || (j > b.5 - 1e-6 && rad < b.2)) {
                        best = Some((cx, cy, rad, ih, io, j));
                    }
                    rad += 0.5;
                }
                cx += 1.0;
            }
            cy += 1.0;
        }
        best.map(|b| (b.0, b.1, b.2, b.3, b.4))
    };
    let nh = s.iter().filter(|p| p.2).count();
    let no = s.len() - nh;
    let (x, y, rad, ih, io) = one(s, nh, no)?;
    let mut circles = vec![(x, y, rad)];
    let (mut tpr, mut fpr) = (ih as f32 / nh as f32, if no == 0 { 0.0 } else { io as f32 / no as f32 });
    // segundo círculo: nos acertos que o primeiro não pegou
    let outside: Vec<(f32, f32, bool)> = s.iter().filter(|p| (p.0 - x).hypot(p.1 - y) > rad).copied().collect();
    if outside.iter().filter(|p| p.2).count() >= 5 {
        if let Some((x2, y2, r2, ih2, io2)) = one(&outside, nh, no) {
            let (t2, f2) = (tpr + ih2 as f32 / nh as f32, fpr + if no == 0 { 0.0 } else { io2 as f32 / no as f32 });
            if (t2 - f2) - (tpr - fpr) >= 0.05 {
                circles.push((x2, y2, r2));
                tpr = t2;
                fpr = f2;
            }
        }
    }
    Some((circles, tpr, fpr))
}

impl Measure for Pool {
    fn pull(&mut self, p: &Pull) {
        self.pulls += 1;
        // vezes que o cast sai (casts a até 1 s um do outro são a mesma vez)
        let mut starts: Vec<i64> = Vec::new();
        for e in p.events.iter().filter(|e| e.kind == Kind::CastSuccess && e.spell == self.cast && !p.is_player(e.src)) {
            if starts.last().is_none_or(|&l| e.t - l > 1000) {
                starts.push(e.t);
            }
        }
        let players: Vec<u32> = p.players().collect();
        for (n, &t0) in starts.iter().enumerate() {
            let until = starts.get(n + 1).copied().unwrap_or(i64::MAX).min(t0 + self.duration);
            let ticks: Vec<&Event> = p.events.iter().filter(|e| e.t >= t0 && e.t < until && e.spell == self.damage && is_hit(e.kind) && p.is_player(e.dst)).collect();
            let mut row = json!({ "pull": self.pulls, "n": n + 1, "t": r(t0 as f32 / 1000.0, 1), "ticks": ticks.len() });
            if let (Some(first), Some(last)) = (ticks.first(), ticks.last()) {
                row["delayS"] = r((first.t - t0) as f32 / 1000.0, 1);
                row["durationS"] = r((last.t - first.t) as f32 / 1000.0, 1);
                // janelas de 1 s: cada player vivo, tomou ou não
                let mut samples: Vec<(f32, f32, bool)> = Vec::new();
                let mut w = first.t;
                while w <= last.t {
                    let in_w: Vec<&&Event> = ticks.iter().filter(|e| e.t >= w && e.t < w + 1000).collect();
                    for &u in &players {
                        let hit = in_w.iter().find(|e| e.dst == u);
                        let t = hit.map_or(w + 500, |e| e.t);
                        if let Some((x, y)) = p.pos(u, t) {
                            samples.push((x, y, hit.is_some()));
                        }
                    }
                    w += 1000;
                }
                if ticks.len() >= 5 {
                    if let Some((circles, tpr, fpr)) = fit_circles(&samples) {
                        row["circles"] = json!(circles.iter().map(|c| json!([r(c.0, 1), r(c.1, 1), r(c.2, 1)])).collect::<Vec<_>>());
                        row["tpr"] = r(tpr, 3);
                        row["fpr"] = r(fpr, 3);
                        row["j"] = r(tpr - fpr, 3);
                    }
                }
            }
            self.rows.push(row);
        }
    }

    fn finish(self: Box<Self>) -> Value {
        json!({ "castId": self.cast, "damageId": self.damage, "casts": self.rows })
    }
}

// ---------------------------------------------------------------------------------------------
// Texto

fn f(v: &Value) -> String {
    match v {
        Value::Null => "-".into(),
        Value::Number(n) => {
            let s = n.to_string();
            s.replace('.', ",")
        }
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(f).collect::<Vec<_>>().join(" / "),
        other => other.to_string(),
    }
}

/// Valor como texto, para as colunas (o Display do `Value` ignora largura).
fn c(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => f(other),
    }
}

fn names(v: &Value) -> String {
    v.as_array().map_or(String::new(), |a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "))
}

/// A saída em texto (tabelas curtas, pt-BR).
pub fn text(measure: &str, v: &Value) -> String {
    let mut o = format!("encontro {} · {} pulls\n", v["encounter"], v["pulls"]);
    let mut line = |s: String| {
        o.push_str(&s);
        o.push('\n');
    };
    match measure {
        "ids" => {
            line(format!("{:>9}  {:<32} {:>6} {:>6} {:>7} {:>7} {:>7} {:>11} {:>5}  quem", "spell", "nome", "início", "fim", "aura pl", "aura in", "acertos", "dano", "invoc"));
            let mut spells: Vec<&Value> = v["spells"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
            spells.sort_by_key(|s| std::cmp::Reverse(s["damage"].as_i64().unwrap_or(0)));
            for s in spells {
                let who: BTreeSet<String> = ["casters", "auraSources", "damageSources"].iter().flat_map(|k| names(&s[*k]).split(", ").map(str::to_string).collect::<Vec<_>>()).filter(|x| !x.is_empty()).collect();
                line(format!(
                    "{:>9}  {:<32} {:>6} {:>6} {:>7} {:>7} {:>7} {:>11} {:>5}  {}",
                    c(&s["spellId"]), s["name"].as_str().unwrap_or("").chars().take(32).collect::<String>(), c(&s["castStart"]), c(&s["castSuccess"]), c(&s["auraOnPlayers"]), c(&s["auraOnEnemies"]), c(&s["damageHits"]), c(&s["damage"]), c(&s["summons"]),
                    who.into_iter().collect::<Vec<_>>().join(", ")
                ));
            }
        }
        "units" => {
            line(format!("{:>7}  {:<26} {:>5} {:>6} {:>7} {:>8} {:>6} {:>12} {:>6} {:>6}  onde nascem", "npc", "nome", "unid", "%pos", "1ª lin", "1ª pos", "s/pos", "vida med", "%morre", "vão s"));
            for u in v["units"].as_array().into_iter().flatten() {
                let spawns: Vec<String> = u["spawns"].as_array().into_iter().flatten().take(4).map(|s| format!("({}, {}) ×{}", f(&s[0]), f(&s[1]), s[2])).collect();
                line(format!(
                    "{:>7}  {:<26} {:>5} {:>6} {:>7} {:>8} {:>6} {:>12} {:>6} {:>6}  {}",
                    c(&u["npcId"]), u["name"].as_str().unwrap_or("").chars().take(26).collect::<String>(), c(&u["units"]), f(&u["posPct"]), f(&u["firstLineS"]), f(&u["firstPosS"]), c(&u["noPos"]), f(&u["hpMedian"]), f(&u["diedPct"]), f(&u["maxGapS"]), spawns.join(" ")

                ));
            }
        }
        "falloff" => {
            for s in v["spells"].as_array().into_iter().flatten() {
                line(format!("{} {} · {} acertos · rho {} · {}", s["spellId"], s["name"].as_str().unwrap_or(""), s["hits"], f(&s["rho"]), s["verdict"].as_str().unwrap_or("").replace("nao_cai", "não cai")));
                let bands: Vec<String> = s["bands"].as_array().into_iter().flatten().map(|b| format!("{}-{} jd: {} × {}", b[0], b[0].as_u64().unwrap_or(0) + 5, b[1], b[2])).collect();
                line(format!("    {}", bands.join(" | ")));
            }
        }
        "pulse-radius" => {
            line(format!("dano {} · centro: {} {} · {} pulsos", v["damageId"], v["center"].as_str().unwrap_or(""), f(&v["centerId"]), v["lots"]));
            line(format!("raio {} jd · TPR {} · FPR {} · {} acertos × {} de fora (até 25 jd)", f(&v["radius"]), f(&v["tpr"]), f(&v["fpr"]), v["hits"], v["others"]));
            for a in v["byAge"].as_array().into_iter().flatten() {
                line(format!("  debuff {}-{} s: raio {} jd · TPR {} · FPR {} · n {} × {}", a["fromS"], a["toS"], f(&a["radius"]), f(&a["tpr"]), f(&a["fpr"]), a["hits"], a["others"]));
            }
        }
        "ahead" => {
            line(format!("cast {} · pontos: {} {} · {} casts, {} com pontos", f(&v["castId"]), v["pointsFrom"].as_str().unwrap_or(""), f(&v["pointsId"]), v["casts"], v["withPoints"]));
            line(format!("R {} jd na direção de quem lança (p10/p50/p90: ao longo {} · de lado {} · ângulo {}° · distância {})", f(&v["r"]), f(&v["along"]), f(&v["side"]), f(&v["angle"]), f(&v["dist"])));
            line(format!("desvio do ponto a R jd: p50 {} · p90 {} jd · pontos por cast {}", f(&v["offset"][0]), f(&v["offset"][1]), f(&v["points"])));
        }
        "cone" => {
            line(format!("cast {} · dano {} · {} casts", v["castId"], f(&v["damageIds"]), v["casts"]));
            line(format!("meio ângulo {}° · alcance {} jd · TPR {} · FPR {} · {} acertos × {} sem", f(&v["halfAngle"]), f(&v["range"]), f(&v["tpr"]), f(&v["fpr"]), v["hits"], v["others"]));
        }
        "wave-dir" => {
            line(format!("dano {} · {} fontes · {} acertos a mais de 4 jd · {} direções", v["damageId"], v["sources"], v["hits"], f(&v["directions"])));
            for b in v["bases"].as_array().into_iter().flatten() {
                line(format!("  {:<10} φ {:>3}° · explica {} de {} (ao acaso {})", b["base"].as_str().unwrap_or(""), b["phi"], b["explained"], b["hits"], f(&b["random"])));
            }
            if !v["best"].is_null() {
                let b = &v["best"];
                line(format!("melhor: {} φ {}° · início {} jd · velocidade {} jd/s · largura {} jd (de lado até {}) · mais longe {}", b["base"].as_str().unwrap_or(""), b["phi"], f(&v["start"]), f(&v["speed"]), f(&v["width"]), f(&v["lateralMax"]), f(&v["farthest"])));
            }
        }
        "pool" => {
            line(format!("cast {} · dano {}", v["castId"], v["damageId"]));
            for c in v["casts"].as_array().into_iter().flatten() {
                let circles: Vec<String> = c["circles"].as_array().into_iter().flatten().map(|x| format!("({}, {}) r {}", f(&x[0]), f(&x[1]), f(&x[2]))).collect();
                line(format!(
                    "  pull {} vez {} em {} s · {} ticks · atraso {} s · dura {} s · {} · TPR {} FPR {}",
                    c["pull"], c["n"], f(&c["t"]), c["ticks"], f(&c["delayS"]), f(&c["durationS"]), if circles.is_empty() { "-".into() } else { circles.join(" + ") }, f(&c["tpr"]), f(&c["fpr"])
                ));
            }
        }
        _ => line(v.to_string()),
    }
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENEMY: &str = "0x10a48";
    const PLAYER: &str = "0x511";

    fn guid(i: u32) -> String {
        format!("Player-1-{i:08X}")
    }

    /// Bloco advanced de 19 campos com posição e direção.
    fn adv(g: &str, x: f32, y: f32, facing: f32) -> Vec<String> {
        let mut v: Vec<String> = vec![g.into(), "0000000000000000".into(), "100".into(), "100".into()];
        v.extend(["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"].map(String::from));
        v.extend([format!("{x:.2}"), format!("{y:.2}"), "2500".into(), format!("{facing:.4}"), "80".into()]);
        v
    }

    fn line(p: &mut Pull, t: i64, f: Vec<String>) {
        let r: Vec<&str> = f.iter().map(String::as_str).collect();
        p.push_line(t, &r);
    }

    fn head(ev: &str, src: &str, src_flags: &str, dst: &str, dst_flags: &str, spell: u32) -> Vec<String> {
        vec![ev.into(), src.into(), "src".into(), src_flags.into(), "0x0".into(), dst.into(), "dst".into(), dst_flags.into(), "0x0".into(), spell.to_string(), format!("Spell {spell}"), "0x1".into()]
    }

    /// Dano em player com a posição dele.
    #[allow(clippy::too_many_arguments)]
    fn damage(p: &mut Pull, t: i64, src: &str, dst: &str, spell: u32, x: f32, y: f32, base: i64) {
        let mut f = head("SPELL_DAMAGE", src, ENEMY, dst, PLAYER, spell);
        f.extend(adv(dst, x, y, 0.0));
        f.extend([base.to_string(), base.to_string()]);
        f.extend(["-1", "1", "0", "0", "0", "nil", "nil", "nil"].map(String::from));
        line(p, t, f);
    }

    /// Linha qualquer que só traz a posição de `g` (um cast dele).
    fn at(p: &mut Pull, t: i64, g: &str, flags: &str, x: f32, y: f32, facing: f32) {
        let mut f = head("SPELL_CAST_SUCCESS", g, flags, "0000000000000000", "0x80000000", 99);
        f.extend(adv(g, x, y, facing));
        line(p, t, f);
    }

    fn aura(p: &mut Pull, t: i64, ev: &str, dst: &str, spell: u32) {
        let mut f = head(ev, "Creature-0-0-0-0-5000-0000000001", ENEMY, dst, PLAYER, spell);
        f.push("DEBUFF".into());
        line(p, t, f);
    }

    #[test]
    fn reads_position_amount_and_base_from_lines() {
        let mut p = Pull::new(1, 16, 0, "t");
        damage(&mut p, 1000, "Creature-0-0-0-0-5000-0000000001", &guid(1), 7, 10.0, 20.0, 5000);
        at(&mut p, 2000, &guid(1), PLAYER, 12.0, 20.0, 1.0);
        assert_eq!(p.events[0].base, 5000);
        assert_eq!(p.pos(1, 1000), Some((10.0, 20.0)));
        // interpolado entre as duas linhas
        assert_eq!(p.pos(1, 1500), Some((11.0, 20.0)));
        // fora de 1,5 s, nada
        assert_eq!(p.pos(1, 4000), None);
        assert_eq!(p.facing(1, 1900), Some(1.0));
    }

    #[test]
    fn pulse_radius_youden_separates_hit_from_near_but_safe() {
        let mut m = PulseRadius { damage: 7, aura: Some(9), ..Default::default() };
        let mut p = Pull::new(1, 16, 0, "t");
        let holder = guid(0);
        aura(&mut p, 0, "SPELL_AURA_APPLIED", &holder, 9);
        for k in 0..20i64 {
            let t = 1000 + k * 1000;
            at(&mut p, t - 1, &holder, PLAYER, 0.0, 0.0, 0.0);
            // a 3 e 4,5 jd tomam; a 6 e 9 jd não tomam
            damage(&mut p, t, "Creature-0-0-0-0-5000-0000000001", &guid(1), 7, 3.0, 0.0, 100);
            damage(&mut p, t, "Creature-0-0-0-0-5000-0000000001", &guid(2), 7, 0.0, 4.5, 100);
            at(&mut p, t - 1, &guid(3), PLAYER, -6.0, 0.0, 0.0);
            at(&mut p, t - 1, &guid(4), PLAYER, 0.0, -9.0, 0.0);
            // longe demais para contar
            at(&mut p, t - 1, &guid(5), PLAYER, 40.0, 0.0, 0.0);
        }
        p.finish(30_000, true);
        m.pull(&p);
        let v = Box::new(m).finish();
        assert_eq!(v["radius"], json!(4.5));
        assert_eq!(v["tpr"], json!(1.0));
        assert_eq!(v["fpr"], json!(0.0));
        assert_eq!(v["hits"], json!(40));
        assert_eq!(v["others"], json!(40));
    }

    #[test]
    fn ahead_finds_the_point_in_front_of_the_caster() {
        let boss = "Creature-0-0-0-0-5000-0000000001";
        let mut m = Ahead { cast: Some(50), window: 2000, ..Default::default() };
        let mut p = Pull::new(1, 16, 0, "t");
        for k in 0..10i64 {
            let t = 1000 + k * 5000;
            let f = k as f32 * 0.6;
            let mut c = head("SPELL_CAST_SUCCESS", boss, ENEMY, "0000000000000000", "0x80000000", 50);
            c.extend(adv(boss, 100.0, 50.0, f));
            line(&mut p, t, c);
            // o tank toma a 25 jd na frente, 1 jd para o lado
            let (x, y) = (100.0 + 25.0 * f.cos() - 1.0 * f.sin(), 50.0 + 25.0 * f.sin() + 1.0 * f.cos());
            damage(&mut p, t + 200, boss, &guid(1), 51, x, y, 100);
        }
        p.finish(60_000, true);
        m.pull(&p);
        let v = Box::new(m).finish();
        assert_eq!(v["withPoints"], json!(10));
        assert_eq!(v["r"], json!(25.0));
        assert_eq!(v["side"][1], json!(1.0));
        assert_eq!(v["damageIds"], json!([51]));
    }

    #[test]
    fn falloff_tells_flat_damage_from_damage_that_drops() {
        let mut flat = Vec::new();
        let mut drop = Vec::new();
        for i in 0..200 {
            let d = (i % 50) as f32;
            flat.push((d, 222_000));
            drop.push((d, (300_000.0 - d * 5000.0) as i64));
        }
        assert_eq!(falloff_spell(1, "a", &flat)["verdict"], json!("nao_cai"));
        assert_eq!(falloff_spell(2, "b", &drop)["verdict"], json!("cai"));
        assert_eq!(falloff_spell(2, "b", &drop)["bands"][0][1], json!(20));
    }

    #[test]
    fn falloff_measures_victim_to_source() {
        let boss = "Creature-0-0-0-0-5000-0000000001";
        let mut p = Pull::new(1, 16, 0, "t");
        for k in 0..40i64 {
            let t = 1000 + k * 100;
            at(&mut p, t, boss, ENEMY, 0.0, 0.0, 0.0);
            damage(&mut p, t, boss, &guid(1), 7, k as f32 * 0.5, 0.0, 1000 - k * 20);
        }
        p.finish(10_000, true);
        let mut m = Falloff::default();
        m.pull(&p);
        let v = Box::new(m).finish();
        assert_eq!(v["spells"][0]["hits"], json!(40));
        assert_eq!(v["spells"][0]["rho"], json!(-1.0));
        assert_eq!(v["spells"][0]["verdict"], json!("cai"));
    }

    #[test]
    fn wave_dir_finds_world_axes_and_speed() {
        // ondas nos eixos do mundo (φ = 0), saindo de 4 jd a 12 jd/s
        let mut m = WaveDir { aura: Some(9), damage: 7, directions: 4, duration: 6000, ..Default::default() };
        let mut p = Pull::new(1, 16, 0, "t");
        let boss = "Creature-0-0-0-0-5000-0000000001";
        let mut victim = 10;
        for s in 0..6i64 {
            let t0 = 1000 + s * 10_000;
            let (sx, sy) = (s as f32 * 7.0, -(s as f32) * 3.0);
            let holder = guid(1 + s as u32);
            aura(&mut p, t0 - 5000, "SPELL_AURA_APPLIED", &holder, 9);
            at(&mut p, t0 - 1, &holder, PLAYER, sx, sy, 0.7 * s as f32);
            aura(&mut p, t0, "SPELL_AURA_REMOVED", &holder, 9);
            at(&mut p, t0, boss, ENEMY, 50.0, 50.0, 0.0);
            for j in 0..4 {
                let th = j as f32 * PI / 2.0;
                for d in [8.0f32, 16.0, 24.0, 32.0] {
                    let dt = ((d - 4.0) / 12.0 * 1000.0) as i64;
                    let lat = if d as i32 % 16 == 0 { 1.0 } else { -1.0 };
                    let (x, y) = (sx + d * th.cos() - lat * th.sin(), sy + d * th.sin() + lat * th.cos());
                    damage(&mut p, t0 + dt, boss, &guid(victim), 7, x, y, 100);
                    victim += 1;
                }
            }
        }
        p.finish(70_000, true);
        m.pull(&p);
        let v = Box::new(m).finish();
        assert_eq!(v["best"]["base"], json!("world"));
        assert_eq!(v["best"]["phi"], json!(0));
        assert_eq!(v["best"]["explained"], json!(96));
        let speed = v["speed"].as_f64().unwrap();
        assert!((speed - 12.0).abs() < 0.3, "{speed}");
        let start = v["start"].as_f64().unwrap();
        assert!((start - 4.0).abs() < 1.0, "{start}");
    }

    #[test]
    fn pool_fits_a_circle_between_hit_and_safe() {
        let mut s = Vec::new();
        for i in 0..36 {
            let a = i as f32 * TAU / 36.0;
            s.push((20.0 + 4.0 * a.cos(), 10.0 + 4.0 * a.sin(), true));
            s.push((20.0 + 9.0 * a.cos(), 10.0 + 9.0 * a.sin(), false));
        }
        let (c, tpr, fpr) = fit_circles(&s).unwrap();
        assert_eq!(c.len(), 1);
        assert!((c[0].0 - 20.0).abs() <= 1.0 && (c[0].1 - 10.0).abs() <= 1.0);
        assert!(c[0].2 >= 4.0 && c[0].2 < 9.0);
        assert_eq!((tpr, fpr), (1.0, 0.0));
    }

    #[test]
    fn log_reader_keeps_only_the_asked_encounter() {
        let text = "\
9/29/2026 21:00:00.000-3  ENCOUNTER_START,3455,\"Vashnik\",16,20,2900\n\
9/29/2026 21:00:01.000-3  SPELL_CAST_SUCCESS,Creature-0-0-0-0-5000-0000000001,\"Boss\",0x10a48,0x0,0000000000000000,nil,0x80000000,0x80000000,50,\"Smash\",0x1\n\
9/29/2026 21:00:40.000-3  ENCOUNTER_END,3455,\"Vashnik\",16,20,0,40000\n\
9/29/2026 21:01:00.000-3  ENCOUNTER_START,3455,\"Vashnik\",15,20,2900\n\
9/29/2026 21:01:40.000-3  ENCOUNTER_END,3455,\"Vashnik\",15,20,0,40000\n";
        let mut got = Vec::new();
        read_log_reader(std::io::Cursor::new(text), "t", Filter { encounter: 3455, difficulty: 16 }, &mut |p| got.push((p.events.len(), p.duration, p.kill))).unwrap();
        assert_eq!(got, vec![(1, 40_000, false)]);
    }

    #[test]
    fn spearman_and_youden_basics() {
        assert!((spearman(&[1.0, 2.0, 3.0], &[3.0, 2.0, 1.0]) + 1.0).abs() < 1e-9);
        let (rad, tpr, fpr) = youden(&[1.0, 2.0, 3.0], &[5.0, 6.0], 0.25, 10.0).unwrap();
        assert_eq!((rad, tpr, fpr), (3.0, 1.0, 0.0));
    }
}
