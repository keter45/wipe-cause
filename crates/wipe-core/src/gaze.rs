//! Fantasmas que perseguem um player e só param enquanto ele olha para eles (Manifestation of
//! Dread, do Coiled Altar). Dois fantasmas que se encostam dão um debuff nos dois alvos
//! (Malevolent Resonance): quem deixou o próprio fantasma andar?
//!
//! O log não mostra o fantasma andando, só onde ele estava ao começar a perseguir (o cast da
//! fixação, com posição) e a aura dele no player. Mas dá para saber para onde o player olhava
//! (a direção vem em todo evento dele com advanced logging):
//! - olhando, o fantasma fica parado onde começou: a direção até ele é a desse ponto;
//! - de costas, o fantasma vem em linha reta até o player, e do ponto de vista do player a
//!   direção quase não muda (ele está entre o começo e o player).
//!
//! Então "de costas" = a direção até onde o fantasma começou fica fora do cone de visão. Quem
//! passou a maior parte dos segundos antes da colisão de costas é o culpado.
//!
//! Para o replay, `paths` simula o caminho de cada fantasma: depois de uma espera, ele anda em
//! direção ao alvo sempre que o alvo não olha para ele (e fica parado um pouco depois de visto).
//! A direção do player só vem quando ele faz alguma coisa, então a simulação erra; o log dá
//! âncoras para corrigir: na colisão os dois fantasmas estavam juntos, e quando o fantasma
//! alcança o alvo (Dreadmarch só nele) estava em cima dele. Fantasma com âncora ganha a
//! velocidade que melhor bate com ela; o que ainda sobrar é puxado no fim do caminho (estimado).
//! Recalibrado em 14 e 15/10 (19 pulls Mythic, 385 fantasmas; `scripts/ghost-calibrate.mjs` com
//! `WIPE_GAZE_DUMP`): 4,5 jd/s, cone de 30°, 2s de espera, 0,5s parado depois de visto. Antes eram
//! 4 jd/s, 35°, 2,5s e 1,5s: a parada longa deixava o fantasma parado quando ele já andava. Sem
//! âncora, o erro mediano no alcance caiu de ~6,6 para ~1 jd, na colisão de ~7,9 para ~4 jd, e os
//! fantasmas limpos pelo Soul Sever dentro do cone subiram de 73% para 83%.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// O debuff dos dois alvos chega com até isso de diferença da falha.
const HIT_NEAR_MS: i64 = 500;
/// Fixação que acabou até isso antes da colisão ainda conta (o fantasma some ao encostar).
const FIX_GRACE_MS: i64 = 500;
/// Com amostras da direção do player cobrindo menos que isso da janela, não dá para julgar.
const MIN_COVERAGE: f32 = 0.5;
/// Amostras mais espaçadas que isso não valem pelo intervalo inteiro.
const MAX_GAP_MS: i64 = 1_500;

#[derive(Debug, Clone, Deserialize)]
pub struct GazeDetect {
    /// aura que o fantasma põe em quem ele persegue (a fonte é o fantasma)
    pub fixate_aura: u32,
    /// cast do fantasma que mostra onde ele está quando começa a perseguir
    pub fixate_cast: u32,
    /// debuff que os alvos dos dois fantasmas ganham quando eles se encostam
    pub hit_aura: u32,
    /// meio ângulo do cone em que olhar para o fantasma segura ele (graus)
    #[serde(default = "default_half_angle")]
    pub half_angle: f32,
    /// quanto tempo antes da colisão olhar (ms)
    #[serde(default = "default_window")]
    pub window_ms: i64,
    /// culpado = de costas pelo menos esta parte da janela
    #[serde(default = "default_share")]
    pub min_share: f32,
    /// simulação do caminho de cada fantasma, para o replay
    #[serde(default)]
    pub sim: Option<GhostSim>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GhostSim {
    /// nome do fantasma no replay
    pub name: String,
    /// jardas por segundo
    pub speed: f32,
    /// meio ângulo do cone em que o alvo segura o fantasma (graus)
    pub half_angle: f32,
    /// o fantasma só começa a andar este tanto depois da fixação (ms)
    pub delay_ms: i64,
    /// visto, fica parado este tanto (ms)
    pub stun_ms: i64,
    /// aura que o alvo ganha quando o fantasma o alcança (sozinha, não a do cast do boss)
    pub catch_aura: Option<u32>,
    #[serde(default)]
    pub clear_auras: Vec<u32>,
}

fn default_half_angle() -> f32 {
    45.0
}
fn default_window() -> i64 {
    5_000
}
fn default_share() -> f32 {
    0.5
}

#[derive(Serialize)]
struct Fix {
    ghost: String,
    player: String,
    from: i64,
    to: Option<i64>,
    /// onde o fantasma começou a perseguir
    x: f32,
    y: f32,
}

/// Tudo do pull que o julgamento precisa (alimentado pelo streaming).
#[derive(Default, Serialize)]
pub struct GazeLog {
    /// (t, x, y, direção) de cada player, em ordem
    trails: HashMap<String, Vec<(i64, f32, f32, f32)>>,
    names: HashMap<String, String>,
    /// fantasma -> onde ele estava no último cast de fixação
    starts: HashMap<String, (f32, f32)>,
    fixes: Vec<Fix>,
    /// (t, guid) de cada debuff da colisão
    hits: Vec<(i64, String)>,
    /// (t, guid) de cada `catch_aura` aplicada
    catches: Vec<(i64, String)>,
    /// última posição de player vista (fim do pull para fantasma que não acabou)
    last_t: i64,
    /// (t, fantasma, aura) de cada frontal que limpou um fantasma
    clears: Vec<(i64, String, u32)>,
    /// só para calibrar (WIPE_GAZE_DUMP): (t, spell, x, y, direção) de todo cast inimigo
    casts: Vec<(i64, u32, f32, f32, f32)>,
    #[serde(skip)]
    dump: Option<std::path::PathBuf>,
}

impl GazeLog {
    /// `WIPE_GAZE_DUMP=<pasta>` grava os dados de cada pull em JSON (calibração da simulação).
    pub fn new() -> Self {
        GazeLog { dump: std::env::var_os("WIPE_GAZE_DUMP").map(Into::into), ..Default::default() }
    }

    pub fn dumping(&self) -> bool {
        self.dump.is_some()
    }

    pub fn on_cast_seen(&mut self, spell_id: u32, x: f32, y: f32, facing: f32, t: i64) {
        self.casts.push((t, spell_id, x, y, facing));
    }

    /// Grava o pull em `<WIPE_GAZE_DUMP>/gaze-<n>.json` com as colisões dele.
    pub fn write_dump(&self, fail_times: &[i64]) {
        let Some(dir) = &self.dump else { return };
        let _ = std::fs::create_dir_all(dir);
        let n = std::fs::read_dir(dir).map_or(0, |d| d.count());
        let body = serde_json::json!({ "log": self, "fail_times": fail_times });
        let _ = std::fs::write(dir.join(format!("gaze-{n:03}.json")), body.to_string());
    }

    pub fn on_player_pos(&mut self, guid: &str, x: f32, y: f32, facing: f32, t: i64) {
        self.last_t = self.last_t.max(t);
        if !facing.is_finite() { return; }
        let tr = self.trails.entry(guid.to_string()).or_default();
        if tr.last().is_none_or(|&(lt, lx, ly, lf)| lt != t || lx != x || ly != y || lf != facing) {
            tr.push((t, x, y, facing));
        }
    }

    pub fn on_enemy_cast(&mut self, cfg: &GazeDetect, guid: &str, spell_id: u32, x: f32, y: f32) {
        if spell_id == cfg.fixate_cast {
            self.starts.insert(guid.to_string(), (x, y));
        }
    }

    /// Aura com a fonte: a fixação liga o fantasma (fonte) ao player; o debuff da colisão marca os alvos.
    #[allow(clippy::too_many_arguments)]
    pub fn on_aura(&mut self, cfg: &GazeDetect, source: &str, spell_id: u32, guid: &str, name: &str, applied: bool, t: i64) {
        if applied && cfg.sim.as_ref().is_some_and(|sim| sim.clear_auras.contains(&spell_id)) {
            for fix in self.fixes.iter_mut().filter(|fix| fix.ghost == guid) {
                fix.to = Some(fix.to.map_or(t, |end| end.min(t)));
            }
            self.clears.push((t, guid.to_string(), spell_id));
            return;
        }
        self.names.entry(guid.to_string()).or_insert_with(|| name.to_string());
        if spell_id == cfg.hit_aura && applied {
            self.hits.push((t, guid.to_string()));
        }
        if applied && cfg.sim.as_ref().and_then(|s| s.catch_aura) == Some(spell_id) {
            self.catches.push((t, guid.to_string()));
        }
        if spell_id != cfg.fixate_aura {
            return;
        }
        if applied {
            if let Some(&(x, y)) = self.starts.get(source) {
                self.fixes.push(Fix { ghost: source.to_string(), player: guid.to_string(), from: t, to: None, x, y });
            }
        } else if let Some(f) = self.fixes.iter_mut().rev().find(|f| f.player == guid && f.ghost == source && f.to.is_none()) {
            f.to = Some(t);
        }
    }

    pub fn name<'a>(&'a self, guid: &'a str) -> &'a str {
        self.names.get(guid).map(String::as_str).unwrap_or(guid)
    }

    /// Quanto da janela [from, to] o player passou de costas para (x, y): (de costas, coberto) em ms.
    fn away(&self, cfg: &GazeDetect, guid: &str, x: f32, y: f32, from: i64, to: i64) -> (i64, i64) {
        let Some(tr) = self.trails.get(guid) else { return (0, 0) };
        let half = cfg.half_angle.to_radians();
        let (mut away, mut covered) = (0, 0);
        let start = tr.partition_point(|s| s.0 < from).saturating_sub(1);
        for (i, &(t, px, py, facing)) in tr.iter().enumerate().skip(start) {
            if t > to {
                break;
            }
            let next = tr.get(i + 1).map_or(to, |s| s.0.min(to));
            let span = (next.min(t + MAX_GAP_MS) - t.max(from)).max(0);
            if span == 0 {
                continue;
            }
            let a = (y - py).atan2(x - px) - facing;
            let off = a.sin().atan2(a.cos()).abs();
            covered += span;
            if off > half {
                away += span;
            }
        }
        (away, covered)
    }
}

/// Passo da simulação.
const SIM_STEP_MS: i64 = 100;
/// Escalas de velocidade testadas para bater com uma âncora.
const SCALES: [f32; 14] = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5, 3.0];
/// Âncora: diferença até isto (jardas) fica como está; acima, o fim do caminho é puxado.
const ANCHOR_OK_YD: f32 = 2.0;
/// Trecho do fim do caminho que absorve a correção (ms).
const PULL_MS: i64 = 5_000;
/// Alcance: a aura do fantasma sai até isto da fixação acabar; outra aplicação até MASS_MS
/// dela = cast do boss (vários de uma vez), não o fantasma.
const CATCH_NEAR_MS: i64 = 400;
const MASS_MS: i64 = 300;
/// Alcançar o alvo bem antes da hora pesa contra a escala.
const EARLY_MS: i64 = 1_500;
const REACH_YD: f32 = 1.0;
/// Fixação mais curta que isso (reaplicada num player morto, por exemplo) fica fora do replay.
const MIN_LIFE_MS: i64 = 500;

/// Caminho simulado de um fantasma: (t, x, y) a cada SIM_STEP_MS, da fixação até ela acabar.
#[derive(Debug, Clone)]
pub struct GhostPath {
    pub ghost: String,
    pub owner: String,
    pub pts: Vec<(i64, f32, f32)>,
    /// a partir daqui o caminho foi puxado até uma âncora (a simulação não chegou lá)
    pub estimated_from: Option<i64>,
}

impl GhostPath {
    /// Jardas andadas no caminho todo.
    pub fn moved(&self) -> f32 {
        self.pts.windows(2).map(|w| (w[1].1 - w[0].1).hypot(w[1].2 - w[0].2)).sum()
    }
}

/// Posição e direção do player em `t` (posição em linha reta entre amostras; direção da última).
fn state_at(tr: &[(i64, f32, f32, f32)], t: i64) -> Option<(f32, f32, f32)> {
    let i = tr.partition_point(|s| s.0 <= t);
    if i == 0 {
        return tr.first().filter(|s| s.0 - t <= MAX_GAP_MS).map(|s| (s.1, s.2, s.3));
    }
    let a = tr[i - 1];
    match tr.get(i) {
        Some(b) if b.0 - a.0 <= 3_000 => {
            let k = (t - a.0) as f32 / (b.0 - a.0).max(1) as f32;
            Some((a.1 + (b.1 - a.1) * k, a.2 + (b.2 - a.2) * k, a.3))
        }
        _ => Some((a.1, a.2, a.3)),
    }
}

fn recent_state_at(trail: &[(i64, f32, f32, f32)], t: i64) -> Option<(f32, f32, f32)> {
    let index = trail.partition_point(|sample| sample.0 <= t);
    let sample = trail.get(index.checked_sub(1)?)?;
    (t - sample.0 <= MAX_GAP_MS).then(|| state_at(trail, t)).flatten()
}

/// Simula o fantasma com a velocidade vezes `scale` até `until`: o caminho e quando ele
/// alcançou o alvo (None = não alcançou).
fn simulate(sim: &GhostSim, log: &GazeLog, f: &Fix, scale: f32, until: i64) -> (Vec<(i64, f32, f32)>, Option<i64>) {
    let tr = log.trails.get(&f.player).map(Vec::as_slice).unwrap_or(&[]);
    let half = sim.half_angle.to_radians();
    let (mut x, mut y, mut seen, mut reached) = (f.x, f.y, i64::MIN / 2, None);
    let mut pts = Vec::with_capacity(((until - f.from) / SIM_STEP_MS + 2).max(1) as usize);
    let mut t = f.from;
    pts.push((t, x, y));
    while t < until {
        let next = (t + SIM_STEP_MS).min(until);
        let step = sim.speed * scale * (next - t) as f32 / 1000.0;
        t = next;
        if let Some((px, py, facing)) = state_at(tr, t) {
            let a = (y - py).atan2(x - px) - facing;
            if a.sin().atan2(a.cos()).abs() <= half {
                seen = t;
            }
            let d = (px - x).hypot(py - y);
            if t - f.from >= sim.delay_ms && t - seen > sim.stun_ms && d > 0.0 {
                let s = step.min(d);
                x += (px - x) / d * s;
                y += (py - y) / d * s;
            }
            if reached.is_none() && t - f.from >= sim.delay_ms && (px - x).hypot(py - y) < REACH_YD {
                reached = Some(t);
            }
        }
        pts.push((t, x, y));
    }
    (pts, reached)
}

fn at(pts: &[(i64, f32, f32)], t: i64) -> (f32, f32) {
    let i = pts.partition_point(|p| p.0 <= t).saturating_sub(1);
    pts.get(i).map_or((0.0, 0.0), |p| (p.1, p.2))
}

fn keep_gaze_locked(sim: &GhostSim, log: &GazeLog, fix: &Fix, points: &mut [(i64, f32, f32)]) {
    let trail = log.trails.get(&fix.player).map(Vec::as_slice).unwrap_or(&[]);
    let Some(&(start, mut x, mut y)) = points.first() else { return };
    let (mut raw_x, mut raw_y, mut seen) = (x, y, i64::MIN / 2);
    for point in points.iter_mut().skip(1) {
        let (dx, dy) = (point.1 - raw_x, point.2 - raw_y);
        (raw_x, raw_y) = (point.1, point.2);
        if let Some((px, py, facing)) = state_at(trail, point.0) {
            let angle = (y - py).atan2(x - px) - facing;
            if angle.sin().atan2(angle.cos()).abs() <= sim.half_angle.to_radians() {
                seen = point.0;
            }
        }
        if point.0 - start >= sim.delay_ms && point.0 - seen > sim.stun_ms {
            x += dx;
            y += dy;
        }
        (point.1, point.2) = (x, y);
    }
}

/// Alvos do debuff da colisão em `boom`, sem repetir.
fn victims_at(log: &GazeLog, boom: i64) -> Vec<&String> {
    let mut out: Vec<&String> = Vec::new();
    for (_, g) in log.hits.iter().filter(|(t, _)| (t - boom).abs() <= HIT_NEAR_MS) {
        if !out.contains(&g) {
            out.push(g);
        }
    }
    out
}

/// Caminho de cada fantasma do pull, ajustado às colisões (`fail_times`) e aos alcances.
pub fn paths(cfg: &GazeDetect, log: &GazeLog, fail_times: &[i64]) -> Vec<GhostPath> {
    let Some(sim) = &cfg.sim else { return Vec::new() };
    // âncora de cada fixação: (escala, momento, ponto)
    let mut anchors: HashMap<usize, (f32, i64, (f32, f32))> = HashMap::new();
    for &ft in fail_times {
        let who = victims_at(log, ft);
        let live: Vec<usize> = (0..log.fixes.len())
            .filter(|&i| {
                let f = &log.fixes[i];
                who.contains(&&f.player) && f.from <= ft && f.to.is_none_or(|e| e >= ft - FIX_GRACE_MS) && !anchors.contains_key(&i)
            })
            .collect();
        let ends: Vec<Vec<(f32, f32)>> = live.iter().map(|&i| SCALES.iter().map(|&s| at(&simulate(sim, log, &log.fixes[i], s, ft).0, ft)).collect()).collect();
        // o par que se encontra com as escalas mais perto de 1
        let mut best: Option<(f32, usize, usize, usize, usize)> = None;
        for i in 0..live.len() {
            for j in i + 1..live.len() {
                for (a, pa) in ends[i].iter().enumerate() {
                    for (b, pb) in ends[j].iter().enumerate() {
                        let d = (pa.0 - pb.0).hypot(pa.1 - pb.1);
                        let cost = (d - ANCHOR_OK_YD).max(0.0) * 10.0 + SCALES[a].ln().abs() + SCALES[b].ln().abs();
                        if best.is_none_or(|x| cost < x.0) {
                            best = Some((cost, i, j, a, b));
                        }
                    }
                }
            }
        }
        if let Some((_, i, j, a, b)) = best {
            let (pa, pb) = (ends[i][a], ends[j][b]);
            let mid = ((pa.0 + pb.0) / 2.0, (pa.1 + pb.1) / 2.0);
            anchors.insert(live[i], (SCALES[a], ft, mid));
            anchors.insert(live[j], (SCALES[b], ft, mid));
        }
    }
    // alcances: a aura do fantasma sozinha no alvo quando a fixação acaba
    for (i, f) in log.fixes.iter().enumerate() {
        let Some(to) = f.to else { continue };
        if anchors.contains_key(&i) {
            continue;
        }
        let solo = |t: i64| log.catches.iter().filter(|(u, _)| (u - t).abs() <= MASS_MS).count() == 1;
        let Some(&(caught_at, _)) = log.catches.iter().filter(|(t, g)| *g == f.player && *t >= f.from && (t - to).abs() <= CATCH_NEAR_MS && solo(*t)).min_by_key(|(t, _)| (t - to).abs()) else { continue };
        let anchor_t = caught_at.min(to);
        let Some((px, py, _)) = log.trails.get(&f.player).and_then(|tr| recent_state_at(tr, anchor_t)) else { continue };
        let mut best: Option<(f32, f32)> = None;
        for &s in &SCALES {
            let (pts, reached) = simulate(sim, log, f, s, anchor_t);
            let (x, y) = at(&pts, anchor_t);
            let early = if reached.is_some_and(|r| r < anchor_t - EARLY_MS) { 20.0 } else { 0.0 };
            let cost = ((x - px).hypot(y - py) - ANCHOR_OK_YD).max(0.0) * 10.0 + s.ln().abs() + early;
            if best.is_none_or(|b| cost < b.0) {
                best = Some((cost, s));
            }
        }
        if let Some((_, s)) = best {
            anchors.insert(i, (s, anchor_t, (px, py)));
        }
    }
    log.fixes
        .iter()
        .enumerate()
        .filter(|(_, f)| f.to.unwrap_or(log.last_t) - f.from >= MIN_LIFE_MS)
        .map(|(i, f)| {
            let end = f.to.unwrap_or(log.last_t).max(f.from);
            let anchor = anchors.get(&i);
            let (mut pts, _) = simulate(sim, log, f, anchor.map_or(1.0, |a| a.0), end);
            let mut estimated_from = None;
            if let Some(&(_, ta, (ax, ay))) = anchor {
                let (x, y) = at(&pts, ta);
                let (dx, dy) = (ax - x, ay - y);
                if dx.hypot(dy) > ANCHOR_OK_YD {
                    let from = (ta - PULL_MS).max(f.from);
                    let weights: Vec<f32> = pts.windows(2).map(|pair| {
                        if pair[1].0 > from && pair[1].0 <= ta {
                            (pair[1].1 - pair[0].1).hypot(pair[1].2 - pair[0].2)
                        } else { 0.0 }
                    }).collect();
                    let total: f32 = weights.iter().sum();
                    let mut moved = 0.0;
                    for (p, weight) in pts.iter_mut().skip(1).zip(weights) {
                        moved += weight;
                        let k = if total > 0.0 { moved / total } else { 0.0 };
                        p.1 += dx * k;
                        p.2 += dy * k;
                    }
                    estimated_from = Some(from);
                    keep_gaze_locked(sim, log, f, &mut pts);
                }
            }
            GhostPath { ghost: f.ghost.clone(), owner: f.player.clone(), pts, estimated_from }
        })
        .collect()
}

/// Andou pelo menos isto (jardas) na simulação...
const WALK_MIN_YD: f32 = 3.0;
/// ...e pelo menos esta parte do que os dois fantasmas andaram: é dele a culpa.
const WALK_SHARE: f32 = 0.25;
/// A simulação só decide quando os dois fantasmas simulados terminam a até isto um do outro na
/// colisão (o que o log comprova). Medido em 21, 22 e 26/10 (22 colisões no Mythic): 18 de 20
/// pares a até 6 jd.
const SIM_AGREE_YD: f32 = 8.0;
/// Fantasma simulado até a colisão: jardas andadas, onde terminou e o último instante em que andou.
type Walk = (f32, (f32, f32), Option<i64>);

/// Os dois andaram: culpado é o que andou por último (o outro já estava parado quando foi
/// alcançado). Pararem com até isto de diferença conta como os dois andando juntos.
const SAME_WALK_MS: i64 = 1_000;

/// Um dos alvos da colisão: quanto tempo ficou de costas para o próprio fantasma.
#[derive(Debug, Clone, PartialEq)]
pub struct Victim {
    pub guid: String,
    pub away_ms: i64,
    pub window_ms: i64,
    /// None = sem fantasma conhecido ou poucas amostras para julgar
    pub culprit: Option<bool>,
    /// jardas que o fantasma dele andou na simulação até a colisão (sem simulação: None)
    pub walked_yd: Option<f32>,
    /// a culpa veio da simulação (o fantasma andou), não dos 5s de costas
    pub inferred: bool,
    /// quanto antes da colisão o fantasma dele parou de andar na simulação
    pub stopped_ms: Option<i64>,
    /// andou, mas parou antes: o outro fantasma andou por último e foi ele que encostou
    pub walked_earlier: bool,
}

/// Alvos da colisão em `boom` e quem deixou o fantasma andar.
///
/// Primeiro, os 5s antes da colisão: de costas para onde o fantasma começou em pelo menos metade
/// deles = culpado. Isso só vê quem passou o fim de costas; o fantasma pode ter andado antes, e o
/// cone de 45° em volta do ponto de início perdoa quem olhava um pouco de lado. Então, com a
/// simulação do replay (calibrada contra alcances, colisões e Soul Sever), o fantasma que andou
/// boa parte do caminho até encostar também é culpado, quando os dois simulados terminam juntos.
pub fn judge(cfg: &GazeDetect, log: &GazeLog, boom: i64) -> Vec<Victim> {
    let mut out = judge_facing(cfg, log, boom);
    let Some(sim) = &cfg.sim else { return out };
    // o fantasma de cada alvo que mais andou até a colisão, e onde ele terminou
    let walked: Vec<Option<Walk>> = out
        .iter()
        .map(|v| {
            log.fixes
                .iter()
                .filter(|f| f.player == v.guid && f.from <= boom && f.to.is_none_or(|e| e >= boom - FIX_GRACE_MS))
                .map(|f| {
                    let path = GhostPath { ghost: f.ghost.clone(), owner: f.player.clone(), pts: simulate(sim, log, f, 1.0, boom).0, estimated_from: None };
                    let last = path.pts.windows(2).filter(|w| (w[1].1 - w[0].1).hypot(w[1].2 - w[0].2) > 0.01).map(|w| w[1].0).next_back();
                    (path.moved(), at(&path.pts, boom), last)
                })
                .max_by(|a, b| a.0.total_cmp(&b.0))
        })
        .collect();
    let agree = match walked.as_slice() {
        [Some((_, a, _)), Some((_, b, _))] => (a.0 - b.0).hypot(a.1 - b.1) <= SIM_AGREE_YD,
        // um alvo só (os dois fantasmas eram dele, ou o outro alvo morreu/estava imune)
        [Some(_)] => true,
        _ => false,
    };
    let total: f32 = walked.iter().flatten().map(|w| w.0).sum();
    for (v, w) in out.iter_mut().zip(&walked) {
        v.walked_yd = w.map(|w| w.0);
        v.stopped_ms = w.and_then(|w| w.2).map(|t| boom - t);
        let Some((moved, _, _)) = *w else { continue };
        if agree && v.culprit != Some(true) && moved >= WALK_MIN_YD && moved >= total * WALK_SHARE {
            v.culprit = Some(true);
            v.inferred = true;
        }
    }
    // os dois andaram: só quem andou por último encostou no outro, que já estava parado
    if agree && out.len() == 2 && out.iter().all(|v| v.culprit == Some(true)) {
        if let (Some(a), Some(b)) = (out[0].stopped_ms, out[1].stopped_ms) {
            if (a - b).abs() > SAME_WALK_MS {
                let earlier = if a > b { 0 } else { 1 };
                out[earlier].culprit = Some(false);
                out[earlier].walked_earlier = true;
            }
        }
    }
    out
}

/// Os 5s antes da colisão: quanto cada alvo ficou de costas para onde o fantasma começou.
fn judge_facing(cfg: &GazeDetect, log: &GazeLog, boom: i64) -> Vec<Victim> {
    let mut guids: Vec<&String> = Vec::new();
    for (_, g) in log.hits.iter().filter(|(t, _)| (t - boom).abs() <= HIT_NEAR_MS) {
        if !guids.contains(&g) {
            guids.push(g);
        }
    }
    guids
        .into_iter()
        .map(|g| {
            // o fantasma que mais ficou fora da vista (com dois fantasmas, um deles andou)
            let best = log
                .fixes
                .iter()
                .filter(|f| &f.player == g && f.from <= boom && f.to.is_none_or(|e| e >= boom - FIX_GRACE_MS))
                .map(|f| {
                    let from = f.from.max(boom - cfg.window_ms);
                    let (away, covered) = log.away(cfg, g, f.x, f.y, from, boom);
                    (away, covered, boom - from)
                })
                .max_by_key(|&(away, covered, _)| (away, covered));
            match best {
                Some((away, covered, window)) if window > 0 && covered as f32 >= window as f32 * MIN_COVERAGE => Victim {
                    guid: g.clone(),
                    away_ms: away,
                    window_ms: covered,
                    culprit: Some(away as f32 >= covered as f32 * cfg.min_share),
                    walked_yd: None,
                    inferred: false,
                    stopped_ms: None,
                    walked_earlier: false,
                },
                _ => Victim { guid: g.clone(), away_ms: 0, window_ms: 0, culprit: None, walked_yd: None, inferred: false, stopped_ms: None, walked_earlier: false },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> GazeDetect {
        GazeDetect { fixate_aura: 10, fixate_cast: 10, hit_aura: 20, half_angle: 45.0, window_ms: 5_000, min_share: 0.5, sim: None }
    }

    /// Player parado em `at`, olhando na direção `facing` (radianos), de `t0` a `t1`.
    fn stand(log: &mut GazeLog, guid: &str, at: (f32, f32), facing: f32, t0: i64, t1: i64) {
        let mut t = t0;
        while t <= t1 {
            log.on_player_pos(guid, at.0, at.1, facing, t);
            t += 250;
        }
    }

    #[test]
    fn culpa_quem_deu_as_costas_para_o_proprio_fantasma() {
        let c = cfg();
        let mut log = GazeLog::default();
        // fantasma de A começa em (0,0); A está em (20,0)
        log.on_enemy_cast(&c, "G1", 10, 0.0, 0.0);
        log.on_aura(&c, "G1", 10, "A", "Alice-R", true, 0);
        // fantasma de B começa em (20,20); B está em (20,40)
        log.on_enemy_cast(&c, "G2", 10, 20.0, 20.0);
        log.on_aura(&c, "G2", 10, "B", "Bob-R", true, 0);
        // A olha para o leste (de costas para o fantasma, que está a oeste); B olha para o sul, para o dele
        stand(&mut log, "A", (20.0, 0.0), 0.0, 0, 10_000);
        stand(&mut log, "B", (20.0, 40.0), -std::f32::consts::FRAC_PI_2, 0, 10_000);
        log.on_aura(&c, "Boss", 20, "A", "Alice-R", true, 10_000);
        log.on_aura(&c, "Boss", 20, "B", "Bob-R", true, 10_010);
        log.on_aura(&c, "G1", 10, "A", "Alice-R", false, 10_000);
        let v = judge(&c, &log, 10_000);
        assert_eq!(v.len(), 2);
        let a = v.iter().find(|x| x.guid == "A").unwrap();
        let b = v.iter().find(|x| x.guid == "B").unwrap();
        assert_eq!(a.culprit, Some(true));
        assert!(a.away_ms >= 4_500);
        assert_eq!(b.culprit, Some(false));
        assert_eq!(b.away_ms, 0);
    }

    fn sim_cfg() -> GazeDetect {
        GazeDetect {
            sim: Some(GhostSim { name: "Ghost".into(), speed: 4.0, half_angle: 35.0, delay_ms: 2_000, stun_ms: 1_000, catch_aura: Some(30), clear_auras: vec![40] }),
            ..cfg()
        }
    }

    #[test]
    fn clear_aura_ends_only_the_hit_ghost_at_the_exact_time() {
        let cfg = sim_cfg();
        let mut log = GazeLog::default();
        for ghost in ["G1", "G2"] {
            log.on_enemy_cast(&cfg, ghost, 10, 0.0, 0.0);
            log.on_aura(&cfg, ghost, 10, "A", "Alice", true, 0);
        }
        stand(&mut log, "A", (40.0, 0.0), 0.0, 0, 10_000);
        log.on_aura(&cfg, "Boss", 40, "G1", "Ghost", true, 5_055);
        log.on_aura(&cfg, "G1", 10, "A", "Alice", false, 5_056);
        let paths = paths(&cfg, &log, &[]);
        assert_eq!(paths[0].pts.last().unwrap().0, 5_055);
        assert_eq!(paths[1].pts.last().unwrap().0, 10_000);
        assert_eq!(paths[0].pts[0], (0, 0.0, 0.0));
    }

    #[test]
    fn stale_samples_do_not_anchor_a_catch() {
        let trail = [(0, 40.0, 0.0, 0.0)];
        assert!(recent_state_at(&trail, MAX_GAP_MS).is_some());
        assert!(recent_state_at(&trail, MAX_GAP_MS + 1).is_none());
        let cfg = sim_cfg();
        let mut log = GazeLog::default();
        log.on_enemy_cast(&cfg, "G1", 10, 0.0, 0.0);
        log.on_aura(&cfg, "G1", 10, "A", "Alice", true, 0);
        log.on_player_pos("A", 40.0, 0.0, 0.0, 0);
        log.on_aura(&cfg, "G1", 10, "A", "Alice", false, 6_000);
        let inferred = paths(&cfg, &log, &[])[0].moved();
        log.on_aura(&cfg, "Boss", 30, "A", "Alice", true, 6_000);
        assert_eq!(paths(&cfg, &log, &[])[0].moved(), inferred);
        assert!(paths(&cfg, &log, &[])[0].estimated_from.is_none());
    }

    #[test]
    fn catch_anchor_uses_the_catch_event_before_fixation_ends() {
        let cfg = sim_cfg();
        let mut log = GazeLog::default();
        log.on_enemy_cast(&cfg, "G1", 10, 0.0, 0.0);
        log.on_aura(&cfg, "G1", 10, "A", "Alice", true, 0);
        stand(&mut log, "A", (40.0, 0.0), 0.0, 0, 5_000);
        log.on_player_pos("A", 60.0, 0.0, std::f32::consts::PI, 5_300);
        log.on_aura(&cfg, "Boss", 30, "A", "Alice", true, 5_000);
        log.on_aura(&cfg, "G1", 10, "A", "Alice", false, 5_300);
        let path = &paths(&cfg, &log, &[])[0];
        assert_eq!(at(&path.pts, 5_000), (40.0, 0.0));
        assert_eq!(path.pts.last().unwrap().0, 5_300);
    }

    #[test]
    fn catch_anchor_cannot_move_a_watched_ghost() {
        let cfg = sim_cfg();
        let mut log = GazeLog::default();
        log.on_enemy_cast(&cfg, "G1", 10, 0.0, 0.0);
        log.on_aura(&cfg, "G1", 10, "A", "Alice", true, 0);
        stand(&mut log, "A", (40.0, 0.0), std::f32::consts::PI, 0, 5_000);
        log.on_aura(&cfg, "Boss", 30, "A", "Alice", true, 5_000);
        log.on_aura(&cfg, "G1", 10, "A", "Alice", false, 5_000);
        let result = paths(&cfg, &log, &[]);
        assert!(result[0].pts.iter().all(|point| point.1 == 0.0 && point.2 == 0.0));
    }

    #[test]
    fn corrected_path_stops_when_owner_turns_back() {
        let cfg = sim_cfg();
        let mut log = GazeLog::default();
        log.on_enemy_cast(&cfg, "G1", 10, 0.0, 0.0);
        log.on_aura(&cfg, "G1", 10, "A", "Alice", true, 0);
        stand(&mut log, "A", (100.0, 0.0), 0.0, 0, 6_000);
        stand(&mut log, "A", (100.0, 0.0), std::f32::consts::PI, 6_250, 10_000);
        log.on_aura(&cfg, "Boss", 30, "A", "Alice", true, 10_000);
        log.on_aura(&cfg, "G1", 10, "A", "Alice", false, 10_000);
        let result = paths(&cfg, &log, &[]);
        let path = &result[0];
        assert!(path.estimated_from.is_some());
        assert!(at(&path.pts, 5_000).0 > 0.0);
        assert_eq!(at(&path.pts, 7_000), at(&path.pts, 10_000));
    }

    #[test]
    fn unknown_heading_does_not_provide_gaze_coverage() {
        let mut log = GazeLog::default();
        log.on_player_pos("Player", 1.0, 2.0, f32::NAN, 1_000);
        assert!(!log.trails.contains_key("Player"));
        assert_eq!(log.last_t, 1_000);
    }

    #[test]
    fn fantasma_anda_so_com_o_alvo_de_costas() {
        let c = sim_cfg();
        let mut log = GazeLog::default();
        log.on_enemy_cast(&c, "G1", 10, 0.0, 0.0);
        log.on_aura(&c, "G1", 10, "A", "Alice-R", true, 0);
        // A em (40,0): olha para o fantasma (oeste) até 6s, depois vira de costas (leste)
        stand(&mut log, "A", (40.0, 0.0), std::f32::consts::PI, 0, 6_000);
        stand(&mut log, "A", (40.0, 0.0), 0.0, 6_250, 11_000);
        let p = &paths(&c, &log, &[])[0];
        let pos = |t: i64| at(&p.pts, t);
        assert_eq!(pos(6_000), (0.0, 0.0));
        // de costas a partir de 6,25s, parado mais 1s: anda ~4 jd/s de 7,3s em diante
        let x = pos(11_000).0;
        assert!((12.0..16.0).contains(&x), "{x}");
        assert!(p.estimated_from.is_none());
    }

    #[test]
    fn colisao_ajusta_a_velocidade_para_os_dois_se_encontrarem() {
        let c = sim_cfg();
        let mut log = GazeLog::default();
        // dois fantasmas a 30 jd um do outro, cada alvo de costas para o seu
        log.on_enemy_cast(&c, "G1", 10, 0.0, 0.0);
        log.on_aura(&c, "G1", 10, "A", "Alice-R", true, 0);
        log.on_enemy_cast(&c, "G2", 10, 30.0, 0.0);
        log.on_aura(&c, "G2", 10, "B", "Bob-R", true, 0);
        stand(&mut log, "A", (60.0, 0.0), 0.0, 0, 8_000);
        stand(&mut log, "B", (-30.0, 0.0), std::f32::consts::PI, 0, 8_000);
        log.on_aura(&c, "Boss", 20, "A", "Alice-R", true, 8_000);
        log.on_aura(&c, "Boss", 20, "B", "Bob-R", true, 8_000);
        log.on_aura(&c, "G1", 10, "A", "Alice-R", false, 8_000);
        log.on_aura(&c, "G2", 10, "B", "Bob-R", false, 8_000);
        let ps = paths(&c, &log, &[8_000]);
        let (a, b) = (at(&ps[0].pts, 8_000), at(&ps[1].pts, 8_000));
        assert!((a.0 - b.0).hypot(a.1 - b.1) <= ANCHOR_OK_YD + 0.5, "{a:?} {b:?}");
        assert!(ps[0].moved() > 10.0 && ps[1].moved() > 10.0);
    }

    /// A de costas para o fantasma dele até 6s (ele anda ~16 jd) e olhando depois; o de B parado em
    /// (20, y2), com B olhando para ele o tempo todo. Colisão em 10s.
    fn walked_before_the_window(y2: f32) -> (GazeDetect, GazeLog) {
        let c = sim_cfg();
        let mut log = GazeLog::default();
        log.on_enemy_cast(&c, "G1", 10, 0.0, 0.0);
        log.on_aura(&c, "G1", 10, "A", "Alice-R", true, 0);
        log.on_enemy_cast(&c, "G2", 10, 20.0, y2);
        log.on_aura(&c, "G2", 10, "B", "Bob-R", true, 0);
        stand(&mut log, "A", (60.0, 0.0), 0.0, 0, 6_000);
        stand(&mut log, "A", (60.0, 0.0), std::f32::consts::PI, 6_250, 10_000);
        stand(&mut log, "B", (20.0, y2 - 40.0), std::f32::consts::FRAC_PI_2, 0, 10_000);
        log.on_aura(&c, "Boss", 20, "A", "Alice-R", true, 10_000);
        log.on_aura(&c, "Boss", 20, "B", "Bob-R", true, 10_000);
        (c, log)
    }

    #[test]
    fn fantasma_que_andou_antes_dos_5s_e_culpado_pela_simulacao() {
        let (c, log) = walked_before_the_window(0.0);
        let v = judge(&c, &log, 10_000);
        let a = v.iter().find(|x| x.guid == "A").unwrap();
        let b = v.iter().find(|x| x.guid == "B").unwrap();
        // nos 5s finais A olhava (a regra de costas não pega), mas o fantasma dele andou
        assert!(a.away_ms < a.window_ms / 2, "{a:?}");
        assert_eq!((a.culprit, a.inferred), (Some(true), true));
        assert!(a.walked_yd.unwrap() >= 10.0, "{a:?}");
        assert_eq!((b.culprit, b.inferred), (Some(false), false));
        assert_eq!(b.walked_yd, Some(0.0));
    }

    #[test]
    fn os_dois_andaram_culpa_so_quem_andou_por_ultimo() {
        let c = sim_cfg();
        let mut log = GazeLog::default();
        // G1 anda para o leste até A virar (5s); G2 anda para o oeste até a colisão (10s)
        log.on_enemy_cast(&c, "G1", 10, 0.0, 0.0);
        log.on_aura(&c, "G1", 10, "A", "Alice-R", true, 0);
        log.on_enemy_cast(&c, "G2", 10, 40.0, 0.0);
        log.on_aura(&c, "G2", 10, "B", "Bob-R", true, 0);
        stand(&mut log, "A", (60.0, 0.0), 0.0, 0, 5_000);
        stand(&mut log, "A", (60.0, 0.0), std::f32::consts::PI, 5_250, 10_000);
        stand(&mut log, "B", (-30.0, 0.0), std::f32::consts::PI, 0, 10_000);
        log.on_aura(&c, "Boss", 20, "A", "Alice-R", true, 10_000);
        log.on_aura(&c, "Boss", 20, "B", "Bob-R", true, 10_000);
        let v = judge(&c, &log, 10_000);
        let a = v.iter().find(|x| x.guid == "A").unwrap();
        let b = v.iter().find(|x| x.guid == "B").unwrap();
        assert!(a.walked_yd.unwrap() >= 5.0, "{a:?}");
        assert_eq!((a.culprit, a.walked_earlier), (Some(false), true), "{a:?}");
        assert!(a.stopped_ms.unwrap() >= 3_000, "{a:?}");
        assert_eq!(b.culprit, Some(true), "{b:?}");
    }

    #[test]
    fn simulacao_que_nao_bate_com_a_colisao_nao_culpa() {
        // o fantasma de B estava a 30 jd do caminho do de A: a simulação não explica a colisão
        let (c, log) = walked_before_the_window(30.0);
        let v = judge(&c, &log, 10_000);
        assert!(v.iter().all(|x| x.culprit != Some(true) && !x.inferred), "{v:?}");
    }

    #[test]
    fn sem_amostras_nao_julga() {
        let c = cfg();
        let mut log = GazeLog::default();
        log.on_enemy_cast(&c, "G1", 10, 0.0, 0.0);
        log.on_aura(&c, "G1", 10, "A", "Alice-R", true, 0);
        log.on_aura(&c, "Boss", 20, "A", "Alice-R", true, 8_000);
        assert_eq!(judge(&c, &log, 8_000)[0].culprit, None);
    }
}
