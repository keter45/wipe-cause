//! Orbs que os players carregam e largam no chão, e que explodem quando um orb "volátil" (o roxo
//! do Coiled Altar) chega perto de outro: quem levou qual orb até onde.
//!
//! O log não diz onde está cada orb, mas dá para reconstruir:
//! - carregar = aura no player (o orb anda com ele);
//! - quando a aura acaba (ou o player morre), o orb cai onde ele está: o log mostra uma unidade
//!   nova do orb, com posição, no mesmo instante (o primeiro cast dela);
//! - pegar do chão = aura nova num player em cima de um orb parado;
//! - o frontal do boss (`breaker`) quebra os orbs parados no cone (posição e direção do boss no cast).
//!   Com `count_aura`, o raid ganha uma stack por orb quebrado: o salto de stacks diz quantos, e os
//!   mais alinhados com o cone (pela direção do log ou pelo alvo do boss) são os quebrados.
//!
//! - `cleared_by`: casts do boss que explodem os orbs voláteis que sobraram no chão.
//!   Os outros continuam ali até serem pegos, quebrados ou a fase acabar (`cleared_on_zero`).
//!
//! Dois orbs carregados por players diferentes não explodem: só conta um orb no chão com outro
//! chegando nele (carregado, ou largado em cima).

use crate::i18n::Text;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

/// Pegar do chão: o orb parado mais perto do player até esta distância.
const PICKUP_MAX_YD: f32 = 10.0;
/// O orb largado aparece até isto depois da aura sair do portador.
const DROP_AFTER_MS: i64 = 150;
/// ... e até esta distância da última posição dele.
const DROP_MAX_YD: f32 = 5.0;
/// Posições mais distantes que isso não são interpoladas (usa a última conhecida).
const MAX_GAP_MS: i64 = 3_000;
/// As stacks do `count_aura` entram até isto depois do frontal.
const COUNT_WINDOW_MS: i64 = 500;
/// Contando pelas stacks, o orb quebrado ainda tem que estar mais ou menos na frente do boss.
const COUNT_MAX_ANGLE: f32 = 90.0;
/// A explosão do que sobrou no chão sai junto com o cast (às vezes um pouco antes no log).
const CLEAR_SLACK_MS: i64 = 200;

#[derive(Debug, Clone, Deserialize)]
pub struct OrbKind {
    /// npc id da unidade do orb no chão
    pub npc_id: u32,
    /// aura de quem carrega
    pub carry_aura: u32,
    /// explode quando outro orb chega perto (sem isso, só explode chegando perto de um volátil)
    #[serde(default)]
    pub volatile: bool,
    /// como o orb é chamado nas mensagens (ex.: roxo / purple)
    pub name: Text,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Breaker {
    pub cast_id: u32,
    /// outros frontais que também quebram (ex.: o da outra fase)
    #[serde(default)]
    pub cast_ids: Vec<u32>,
    /// debuff que o raid ganha por orb quebrado: o salto de stacks no frontal diz quantos quebraram
    #[serde(default)]
    pub count_aura: Option<u32>,
    /// meio ângulo do cone (graus) e alcance (jardas)
    pub half_angle: f32,
    pub range: f32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OrbDetect {
    pub kinds: Vec<OrbKind>,
    /// distância (jardas) em que dois orbs se tocam
    #[serde(default = "default_contact")]
    pub contact_yd: f32,
    /// raios antigos, de antes de um hotfix: pull que começou antes de `until` usa o `contact_yd` dele
    #[serde(default)]
    pub before: Vec<OldContact>,
    /// só conta o encontro até este tempo antes da explosão (ms)
    #[serde(default = "default_window")]
    pub window_ms: i64,
    pub breaker: Option<Breaker>,
    /// casts do boss que explodem os orbs voláteis que sobraram no chão
    #[serde(default)]
    pub cleared_by: Vec<u32>,
    /// npc ids de bosses que, ao chegar a 0 de vida, explodem os orbs que sobraram (ex.: o fim da P1)
    #[serde(default)]
    pub cleared_on_zero: Vec<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OldContact {
    /// UTC: `2026-10-13` ou `2026-10-13T15:00`
    #[serde(deserialize_with = "utc")]
    pub until: i64,
    pub contact_yd: f32,
}

fn utc<'de, D: serde::Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    let s = String::deserialize(d)?;
    crate::timestamp::parse_utc(&s).ok_or_else(|| serde::de::Error::custom(format!("invalid date: {s} (use YYYY-MM-DD or YYYY-MM-DDTHH:MM, UTC)")))
}

impl OrbDetect {
    /// Distância de contato num pull que começou em `start_ms` (None = sem data: a atual).
    pub fn contact_at(&self, start_ms: Option<i64>) -> f32 {
        let Some(t) = start_ms else { return self.contact_yd };
        self.before.iter().filter(|o| t < o.until).min_by_key(|o| o.until).map_or(self.contact_yd, |o| o.contact_yd)
    }
}

fn default_contact() -> f32 {
    9.0
}
fn default_window() -> i64 {
    500
}

/// Tudo do pull que a reconstrução precisa (alimentado pelo streaming).
#[derive(Default)]
pub struct OrbLog {
    /// posições de cada player (t, x, y), em ordem
    trails: HashMap<String, Vec<(i64, f32, f32)>>,
    names: HashMap<String, String>,
    /// primeira aparição de cada unidade de orb: (t, tipo, x, y)
    seen: HashSet<String>,
    sightings: Vec<(i64, usize, f32, f32)>,
    /// (guid, tipo, começo, fim)
    carries: Vec<(String, usize, i64, Option<i64>)>,
    /// frontais: (t, x, y, direção em radianos, alvo do boss)
    breaks: Vec<(i64, f32, f32, f32, Option<String>)>,
    /// stacks do `count_aura` nos players: (t, guid, stacks antes, stacks depois)
    counts: Vec<(i64, String, u32, u32)>,
    /// casts que explodem os orbs do chão (e o boss chegando a 0)
    clears: Vec<i64>,
    /// só os casts (`cleared_by`): o que tem hora marcada, para a contagem no replay
    cast_clears: Vec<i64>,
    count_now: HashMap<String, u32>,
    /// quando o pull começou (epoch ms, UTC): escolhe o raio de antes ou depois de um hotfix
    pub start_ms: Option<i64>,
}

impl OrbLog {
    pub fn on_player_pos(&mut self, guid: &str, x: f32, y: f32, t: i64) {
        let tr = self.trails.entry(guid.to_string()).or_default();
        if tr.last().is_none_or(|&(lt, lx, ly)| lt != t || lx != x || ly != y) {
            tr.push((t, x, y));
        }
    }

    /// Cast de uma unidade inimiga com a posição dela.
    #[allow(clippy::too_many_arguments)]
    pub fn on_enemy_cast(&mut self, cfg: &OrbDetect, npc_id: Option<u32>, guid: &str, spell_id: u32, x: f32, y: f32, facing: f32, t: i64) {
        if let Some(kind) = npc_id.and_then(|id| cfg.kinds.iter().position(|k| k.npc_id == id)) {
            if self.seen.insert(guid.to_string()) {
                self.sightings.push((t, kind, x, y));
            }
        }
        if cfg.breaker.as_ref().is_some_and(|b| b.cast_id == spell_id || b.cast_ids.contains(&spell_id)) {
            self.breaks.push((t, x, y, facing, None));
        }
    }

    /// Cast de inimigo sem precisar de posição: os que limpam o chão (`cleared_by`).
    pub fn on_cast(&mut self, cfg: &OrbDetect, spell_id: u32, t: i64) {
        if cfg.cleared_by.contains(&spell_id) {
            self.clears.push(t);
            self.cast_clears.push(t);
        }
    }

    /// Vida de um inimigo chegou a 0: os de  explodem o que sobrou no chão.
    pub fn on_enemy_zero(&mut self, cfg: &OrbDetect, npc_id: u32, t: i64) {
        if cfg.cleared_on_zero.contains(&npc_id) {
            self.clears.push(t);
        }
    }

    /// Alvo do boss no frontal que acabou de entrar (`on_enemy_cast`): outra direção para o cone.
    pub fn break_target(&mut self, t: i64, target: &str) {
        if let Some(b) = self.breaks.last_mut().filter(|b| b.0 == t) {
            b.4 = Some(target.to_string());
        }
    }

    /// Aura aplicada (stacks > 0) ou removida num player.
    pub fn on_aura(&mut self, cfg: &OrbDetect, spell_id: u32, guid: &str, name: &str, stacks: u32, t: i64) {
        if cfg.breaker.as_ref().and_then(|b| b.count_aura) == Some(spell_id) {
            let before = if stacks == 0 { self.count_now.remove(guid) } else { self.count_now.insert(guid.to_string(), stacks) }.unwrap_or(0);
            self.counts.push((t, guid.to_string(), before, stacks));
            return;
        }
        let Some(kind) = cfg.kinds.iter().position(|k| k.carry_aura == spell_id) else { return };
        self.names.entry(guid.to_string()).or_insert_with(|| name.to_string());
        let open = self.carries.iter_mut().rev().find(|c| c.0 == guid && c.1 == kind && c.3.is_none());
        match (stacks > 0, open) {
            (true, None) => self.carries.push((guid.to_string(), kind, t, None)),
            (false, Some(c)) => c.3 = Some(t),
            _ => {}
        }
    }

    /// Posição registrada mais perto de `t` (para achar o orb que o player pegou ou largou).
    fn nearest(&self, guid: &str, t: i64) -> Option<(f32, f32)> {
        let tr = self.trails.get(guid)?;
        let i = tr.partition_point(|p| p.0 <= t);
        [i.checked_sub(1).map(|j| tr[j]), tr.get(i).copied()]
            .into_iter()
            .flatten()
            .filter(|p| (p.0 - t).abs() <= MAX_GAP_MS)
            .min_by_key(|p| (p.0 - t).abs())
            .map(|p| (p.1, p.2))
    }

    /// Onde o player estava em `t`, em linha reta entre as posições registradas (teleporte também:
    /// para o orb, Blink com outro orb no caminho conta como passar por ele).
    fn pos(&self, guid: &str, t: i64) -> Option<(f32, f32)> {
        pos_at(self.trails.get(guid)?, t)
    }

    /// Menor distância entre (x, y) e o caminho do player de `t0` a `t1` (trechos retos entre as
    /// posições), e quando foi.
    fn closest(&self, guid: &str, t0: i64, t1: i64, x: f32, y: f32) -> Option<(f32, i64)> {
        let tr = self.trails.get(guid)?;
        let mut pts: Vec<(i64, f32, f32)> = Vec::new();
        pts.extend(self.pos(guid, t0).map(|p| (t0, p.0, p.1)));
        pts.extend(tr.iter().copied().filter(|p| p.0 > t0 && p.0 < t1));
        pts.extend(self.pos(guid, t1).map(|p| (t1, p.0, p.1)));
        if let [p] = pts[..] {
            return Some(((p.1 - x).hypot(p.2 - y), p.0));
        }
        let mut best: Option<(f32, i64)> = None;
        for w in pts.windows(2) {
            let (a, b) = (w[0], w[1]);
            let (dx, dy) = (b.1 - a.1, b.2 - a.2);
            let len2 = dx * dx + dy * dy;
            let k = if len2 > 0.0 { (((x - a.1) * dx + (y - a.2) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
            let d = (a.1 + dx * k - x).hypot(a.2 + dy * k - y);
            if best.is_none_or(|(bd, _)| d < bd) {
                best = Some((d, a.0 + ((b.0 - a.0) as f32 * k) as i64));
            }
        }
        best
    }

    pub fn name(&self, guid: &str) -> &str {
        self.names.get(guid).map_or("", String::as_str)
    }
}

/// Onde a unidade estava em `t`, em linha reta entre as posições registradas `(t, x, y)` (em ordem).
pub(crate) fn pos_at(tr: &[(i64, f32, f32)], t: i64) -> Option<(f32, f32)> {
    let i = tr.partition_point(|p| p.0 <= t);
    match (i.checked_sub(1).map(|j| tr[j]), tr.get(i)) {
        (Some(lo), Some(hi)) if hi.0 - lo.0 <= MAX_GAP_MS => {
            let k = (t - lo.0) as f32 / (hi.0 - lo.0) as f32;
            Some((lo.1 + (hi.1 - lo.1) * k, lo.2 + (hi.2 - lo.2) * k))
        }
        (Some(lo), _) => Some((lo.1, lo.2)),
        (None, Some(hi)) => Some((hi.1, hi.2)),
        (None, None) => None,
    }
}

/// Orb parado no chão.
struct Ground {
    kind: usize,
    x: f32,
    y: f32,
    from: i64,
    to: Option<i64>,
    /// quem largou (None = o boss criou)
    dropper: Option<String>,
}

/// Quem levou um orb até outro no chão logo antes da explosão.
#[derive(Debug, Clone, PartialEq)]
pub struct Collision {
    pub guid: String,
    /// tipo do orb que chegou (carregado ou largado) e do que estava no chão
    pub moved: usize,
    pub ground: usize,
    /// true = largou o orb em cima do outro; false = passou carregando
    pub dropped: bool,
    pub dist_yd: f32,
    pub t: i64,
}

fn alive(g: &Ground, t: i64) -> bool {
    g.from <= t && g.to.is_none_or(|e| e > t)
}

/// Quantos orbs o frontal em `t` quebrou: o maior salto de stacks do `count_aura` num player logo
/// depois (None = a regra não tem `count_aura`).
fn broken_count(b: &Breaker, log: &OrbLog, t: i64) -> Option<usize> {
    b.count_aura?;
    let mut per: HashMap<&str, (u32, u32)> = HashMap::new();
    for (_, g, before, after) in log.counts.iter().filter(|c| c.0 >= t && c.0 <= t + COUNT_WINDOW_MS) {
        let e = per.entry(g.as_str()).or_insert((*before, *after));
        e.1 = *after;
    }
    Some(per.values().map(|&(a, b)| b.saturating_sub(a) as usize).max().unwrap_or(0))
}

/// Os orbs no chão até `until`, com quem largou cada um.
fn ground_orbs(cfg: &OrbDetect, log: &OrbLog, until: i64) -> Vec<Ground> {
    enum Ev<'a> {
        Seen(usize, f32, f32),
        Pick(&'a str, usize),
        Break(usize),
        Clear(bool),
    }
    let mut evs: Vec<(i64, Ev)> = Vec::new();
    evs.extend(log.sightings.iter().map(|&(t, k, x, y)| (t, Ev::Seen(k, x, y))));
    evs.extend(log.carries.iter().map(|c| (c.2, Ev::Pick(c.0.as_str(), c.1))));
    evs.extend(log.breaks.iter().enumerate().map(|(i, b)| (b.0, Ev::Break(i))));
    evs.extend(log.clears.iter().map(|&t| (t, Ev::Clear(log.cast_clears.contains(&t)))));
    evs.retain(|e| e.0 <= until);
    evs.sort_by_key(|e| e.0);

    let mut out: Vec<Ground> = Vec::new();
    for (t, ev) in evs {
        match ev {
            Ev::Seen(kind, x, y) => {
                // quem largou: portador do mesmo tipo cuja aura acabou agora, ali
                let dropper = log
                    .carries
                    .iter()
                    .filter(|c| c.1 == kind && c.3.is_some_and(|e| e <= t && t - e <= DROP_AFTER_MS))
                    .filter_map(|c| log.nearest(&c.0, c.3.unwrap()).map(|p| (c, (p.0 - x).hypot(p.1 - y))))
                    .filter(|(_, d)| *d <= DROP_MAX_YD)
                    .min_by(|a, b| a.1.total_cmp(&b.1))
                    .map(|(c, _)| c.0.clone());
                out.push(Ground { kind, x, y, from: t, to: None, dropper });
            }
            Ev::Pick(guid, kind) => {
                let Some(p) = log.nearest(guid, t) else { continue };
                let near = out
                    .iter_mut()
                    .filter(|g| g.kind == kind && alive(g, t))
                    .map(|g| {
                        let d = (g.x - p.0).hypot(g.y - p.1);
                        (g, d)
                    })
                    .filter(|(_, d)| *d <= PICKUP_MAX_YD)
                    .min_by(|a, b| a.1.total_cmp(&b.1));
                if let Some((g, _)) = near {
                    g.to = Some(t);
                }
            }
            // o boss explodiu o que sobrou no chão
            Ev::Clear(volatile_only) => {
                for g in out.iter_mut().filter(|g| alive(g, t) && (!volatile_only || cfg.kinds[g.kind].volatile)) {
                    g.to = Some(t);
                }
            }
            Ev::Break(i) => {
                let Some(b) = &cfg.breaker else { continue };
                let (_, bx, by, facing, target) = &log.breaks[i];
                // direções do cone: a do log no fim do cast e a do alvo do boss (às vezes o log erra a direção)
                let mut dirs: Vec<f32> = facing.is_finite().then_some(*facing).into_iter().collect();
                if let Some(p) = target.as_deref().and_then(|g| log.pos(g, t)) {
                    if (p.0 - bx).hypot(p.1 - by) > 0.5 {
                        dirs.push((p.1 - by).atan2(p.0 - bx));
                    }
                }
                let angle = |g: &Ground| {
                    let a = (g.y - by).atan2(g.x - bx);
                    dirs.iter().map(|d| (a - d).sin().atan2((a - d).cos()).abs().to_degrees()).fold(f32::MAX, f32::min)
                };
                // (orb, ângulo, quão perto da borda do cone: no ângulo ou no alcance, 1 = na borda)
                let mut hit: Vec<(usize, f32, f32)> = out
                    .iter()
                    .enumerate()
                    .filter(|(_, g)| alive(g, t) && (g.x - bx).hypot(g.y - by) <= b.range)
                    .map(|(j, g)| {
                        let a = angle(g);
                        (j, a, (a / b.half_angle).max((g.x - bx).hypot(g.y - by) / b.range))
                    })
                    .collect();
                let front = hit.iter().filter(|h| h.1 <= COUNT_MAX_ANGLE).count();
                match broken_count(b, log, t) {
                    // quantos quebraram vem das stacks: os mais alinhados com o cone (salto maior que os
                    // orbs na frente do boss, ex.: logo depois de uma detonação, não serve: vale o cone)
                    Some(n) if n <= front => {
                        hit.retain(|h| h.1 <= COUNT_MAX_ANGLE);
                        hit.sort_by(|a, b| a.2.total_cmp(&b.2));
                        hit.truncate(n);
                    }
                    _ => hit.retain(|h| h.1 <= b.half_angle),
                }
                for (j, ..) in hit {
                    out[j].to = Some(t);
                }
            }
        }
    }
    out
}

/// Orbs do pull inteiro para o replay completo: os que ficaram no chão (de quando caíram até
/// serem pegos ou quebrados) e quem carregou cada um.
pub fn tracks(cfg: &OrbDetect, log: &OrbLog, end: i64) -> crate::report::OrbTracks {
    let ground = ground_orbs(cfg, log, end)
        .into_iter()
        .map(|g| (g.from, g.to.unwrap_or(end), (g.x * 10.0).round() as i32, (g.y * 10.0).round() as i32, g.kind as u8))
        .collect();
    let carries = log.carries.iter().map(|c| (c.0.clone(), c.2, c.3.unwrap_or(end), c.1 as u8)).collect();
    crate::report::OrbTracks {
        kinds: cfg.kinds.iter().map(|k| crate::report::OrbKindView { name: k.name.clone(), volatile: k.volatile }).collect(),
        contact_yd: cfg.contact_at(log.start_ms),
        ground,
        carries,
        clears: {
            let mut c = log.cast_clears.clone();
            c.sort_unstable();
            c.dedup();
            c
        },
    }
}

/// A explosão em `boom` veio de um cast que limpa o chão (`cleared_by`)? Devolve quantos orbs de cada
/// tipo tinham sobrado ali (o frontal não limpou).
pub fn leftovers(cfg: &OrbDetect, log: &OrbLog, boom: i64) -> Option<Vec<usize>> {
    // o primeiro gatilho da janela é o que explodiu o chão (um segundo logo depois já acha o chão vazio)
    let clear = *log.clears.iter().filter(|&&c| c <= boom + CLEAR_SLACK_MS && boom - c <= cfg.window_ms).min()?;
    let mut n = vec![0; cfg.kinds.len()];
    let volatile_only = log.cast_clears.contains(&clear);
    for g in ground_orbs(cfg, log, clear - 1).iter().filter(|g| alive(g, clear - 1) && (!volatile_only || cfg.kinds[g.kind].volatile)) {
        n[g.kind] += 1;
    }
    Some(n)
}

/// Quem levou um orb até outro no chão nos instantes antes da explosão em `boom` (None = ninguém
/// chegou perto: não dá para culpar, ex.: sobrou roxo no tempo e o boss explodiu).
pub fn collision(cfg: &OrbDetect, log: &OrbLog, boom: i64) -> Option<Collision> {
    // O dano pode chegar antes do primeiro cast do orb que acabou de cair. Essa
    // mesma tolerância já liga a unidade nova à remoção da aura do portador.
    let until = boom + DROP_AFTER_MS;
    let ground = ground_orbs(cfg, log, until);
    let from = boom - cfg.window_ms;
    let volatile = |k: usize| cfg.kinds[k].volatile;
    let contact = cfg.contact_at(log.start_ms);
    let mut best: Option<Collision> = None;
    let mut keep = |c: Collision| {
        if c.dist_yd <= contact && best.as_ref().is_none_or(|b| c.dist_yd < b.dist_yd) {
            best = Some(c);
        }
    };
    // carregado passando por um orb parado
    for c in log.carries.iter().filter(|c| c.2 <= boom && c.3.is_none_or(|e| e >= from)) {
        for g in ground.iter().filter(|g| volatile(g.kind) || volatile(c.1)) {
            // o trecho em que ele carregava e o orb estava no chão
            let t0 = from.max(c.2).max(g.from);
            let t1 = boom.min(c.3.unwrap_or(boom)).min(g.to.map_or(boom, |e| e - 1));
            if t0 > t1 {
                continue;
            }
            if let Some((d, t)) = log.closest(&c.0, t0, t1, g.x, g.y) {
                keep(Collision { guid: c.0.clone(), moved: c.1, ground: g.kind, dropped: false, dist_yd: d, t });
            }
        }
    }
    // largado em cima de um orb parado
    for fresh in ground.iter().filter(|g| g.from >= from && g.from <= until) {
        let Some(who) = &fresh.dropper else { continue };
        for g in ground.iter().filter(|g| !std::ptr::eq(*g, fresh) && alive(g, fresh.from) && g.from < fresh.from && (volatile(g.kind) || volatile(fresh.kind))) {
            keep(Collision { guid: who.clone(), moved: fresh.kind, ground: g.kind, dropped: true, dist_yd: (g.x - fresh.x).hypot(g.y - fresh.y), t: fresh.from });
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> OrbDetect {
        OrbDetect {
            kinds: vec![
                OrbKind { npc_id: 1, carry_aura: 10, volatile: true, name: Text::new("roxo", "purple") },
                OrbKind { npc_id: 2, carry_aura: 20, volatile: false, name: Text::new("verde", "green") },
            ],
            contact_yd: 9.0,
            before: Vec::new(),
            window_ms: 500,
            breaker: Some(Breaker { cast_id: 99, cast_ids: Vec::new(), count_aura: None, half_angle: 40.0, range: 40.0 }),
            cleared_by: vec![55],
            cleared_on_zero: Vec::new(),
        }
    }

    /// Player andando em linha reta de `a` até `b` entre `t0` e `t1`.
    fn walk(log: &mut OrbLog, guid: &str, a: (f32, f32), b: (f32, f32), t0: i64, t1: i64) {
        let mut t = t0;
        while t <= t1 {
            let k = (t - t0) as f32 / (t1 - t0) as f32;
            log.on_player_pos(guid, a.0 + (b.0 - a.0) * k, a.1 + (b.1 - a.1) * k, t);
            t += 200;
        }
    }

    #[test]
    fn roxo_carregado_passando_pelo_verde_no_chao() {
        let c = cfg();
        let mut log = OrbLog::default();
        log.on_enemy_cast(&c, Some(2), "G1", 5, 0.0, 0.0, 0.0, 100); // verde no chão em (0,0)
        log.on_enemy_cast(&c, Some(1), "P1", 5, 30.0, 30.0, 0.0, 100);
        walk(&mut log, "A", (30.0, 30.0), (3.0, 3.0), 1000, 4000);
        log.on_aura(&c, 10, "A", "Alice", 1, 1000); // pegou o roxo em (30,30)
        let hit = collision(&c, &log, 4000).unwrap();
        assert_eq!((hit.guid.as_str(), hit.moved, hit.ground, hit.dropped), ("A", 0, 1, false));
        assert!(hit.dist_yd < 5.0);
    }

    #[test]
    fn raio_de_antes_do_hotfix_vale_para_pull_antigo() {
        let mut c = cfg();
        c.contact_yd = 7.0;
        let until = crate::timestamp::parse_utc("2026-10-13T15:00").unwrap();
        c.before = vec![OldContact { until, contact_yd: 9.0 }];
        let mut log = OrbLog::default();
        log.on_enemy_cast(&c, Some(1), "P1", 5, 0.0, 0.0, 0.0, 100); // roxo no chão em (0,0)
        walk(&mut log, "A", (30.0, 0.0), (8.0, 0.0), 1000, 4000); // passa a 8yd com o verde
        log.on_aura(&c, 20, "A", "Alice", 1, 1000);
        log.start_ms = Some(until - 3_600_000);
        assert!(collision(&c, &log, 4000).is_some_and(|h| h.dist_yd <= 8.5));
        log.start_ms = Some(until);
        assert_eq!(collision(&c, &log, 4000), None);
        log.start_ms = None;
        assert_eq!(c.contact_at(None), 7.0);
    }

    #[test]
    fn dois_carregados_nao_contam() {
        let c = cfg();
        let mut log = OrbLog::default();
        walk(&mut log, "A", (0.0, 0.0), (0.0, 0.0), 0, 4000);
        walk(&mut log, "B", (1.0, 0.0), (1.0, 0.0), 0, 4000);
        log.on_aura(&c, 10, "A", "Alice", 1, 1000);
        log.on_aura(&c, 20, "B", "Bob", 1, 1000);
        assert_eq!(collision(&c, &log, 4000), None);
    }

    #[test]
    fn verde_largado_em_cima_do_roxo() {
        let c = cfg();
        let mut log = OrbLog::default();
        log.on_enemy_cast(&c, Some(1), "P1", 5, 0.0, 0.0, 0.0, 100);
        walk(&mut log, "B", (20.0, 0.0), (4.0, 0.0), 1000, 3800);
        log.on_aura(&c, 20, "B", "Bob", 1, 1000);
        log.on_aura(&c, 20, "B", "Bob", 0, 3800);
        log.on_enemy_cast(&c, Some(2), "G9", 5, 4.0, 0.0, 0.0, 3820); // o verde dele cai ali
        let hit = collision(&c, &log, 3850).unwrap();
        assert_eq!(hit.guid, "B");
        assert!(hit.dist_yd <= 4.5);
    }

    #[test]
    fn dropped_orb_can_be_logged_just_after_its_explosion() {
        let c = cfg();
        let mut log = OrbLog::default();
        log.on_enemy_cast(&c, Some(2), "G1", 5, 0.0, 0.0, 0.0, 100);
        // O portador estava longe antes da queda: não há colisão no caminho
        // interpolado antes do dano, apenas no orb novo que o log registra depois.
        log.on_player_pos("A", 30.0, 0.0, 1_000);
        log.on_player_pos("A", 4.0, 0.0, 4_002);
        log.on_aura(&c, 10, "A", "Alice", 1, 1_000);
        log.on_aura(&c, 10, "A", "Alice", 0, 4_002);
        log.on_enemy_cast(&c, Some(1), "P1", 5, 4.0, 0.0, 0.0, 4_002);
        let hit = collision(&c, &log, 4_000).unwrap();
        assert_eq!((hit.guid.as_str(), hit.dropped, hit.t), ("A", true, 4_002));
        // Uma queda fora da tolerância não explica uma explosão anterior.
        assert!(collision(&c, &log, 3_800).is_none());
    }

    #[test]
    fn orb_quebrado_no_frontal_some_do_chao() {
        let c = cfg();
        let mut log = OrbLog::default();
        log.on_enemy_cast(&c, Some(2), "G1", 5, 10.0, 0.0, 0.0, 100);
        log.on_enemy_cast(&c, None, "BOSS", 99, 0.0, 0.0, 0.0, 500); // frontal para +x
        walk(&mut log, "A", (10.0, 20.0), (10.0, 1.0), 1000, 4000);
        log.on_aura(&c, 10, "A", "Alice", 1, 1000);
        assert_eq!(collision(&c, &log, 4000), None);
    }

    #[test]
    fn stacks_do_raid_dizem_quantos_quebraram_e_o_alvo_corrige_a_direcao() {
        let mut c = cfg();
        c.breaker.as_mut().unwrap().count_aura = Some(77);
        let mut log = OrbLog::default();
        // dois orbs na frente do alvo (+x), um atrás; o log diz que o boss olhava para +y
        log.on_enemy_cast(&c, Some(2), "G1", 5, 10.0, 0.0, 0.0, 100);
        log.on_enemy_cast(&c, Some(1), "P1", 5, 15.0, 2.0, 0.0, 100);
        log.on_enemy_cast(&c, Some(2), "G2", 5, -10.0, 0.0, 0.0, 100);
        walk(&mut log, "T", (5.0, 0.0), (5.0, 0.0), 0, 1000);
        log.on_enemy_cast(&c, None, "BOSS", 99, 0.0, 0.0, std::f32::consts::FRAC_PI_2, 500);
        log.break_target(500, "T");
        // o raid ganha 2 stacks: 2 orbs quebrados
        log.on_aura(&c, 77, "X", "Xis", 1, 500);
        log.on_aura(&c, 77, "X", "Xis", 2, 500);
        let alive: Vec<usize> = ground_orbs(&c, &log, 2000).iter().filter(|g| g.to.is_none()).map(|g| g.kind).collect();
        assert_eq!(alive, vec![1]); // só o verde de trás sobrou (tipo 1 = verde)
        // Orbs novos: só os voláteis explodem; o verde de trás continua no chão.
        log.on_cast(&c, 55, 3000);
        assert_eq!(ground_orbs(&c, &log, 4000).iter().filter(|g| g.to.is_none()).map(|g| g.kind).collect::<Vec<_>>(), vec![1]);
        assert_eq!(leftovers(&c, &log, 3010), Some(vec![0, 0]));
        assert_eq!(leftovers(&c, &log, 900), None);
        // sem stacks no frontal: nada quebra, mesmo no cone
        let mut log2 = OrbLog::default();
        log2.on_enemy_cast(&c, Some(2), "G1", 5, 10.0, 0.0, 0.0, 100);
        log2.on_enemy_cast(&c, None, "BOSS", 99, 0.0, 0.0, 0.0, 500);
        assert!(ground_orbs(&c, &log2, 2000).iter().all(|g| g.to.is_none()));
    }

    #[test]
    fn new_wave_preserves_nonvolatile_orbs_for_collision_and_phase_end_clears_all() {
        let mut c = cfg();
        c.cleared_on_zero = vec![3];
        let mut log = OrbLog::default();
        log.on_enemy_cast(&c, Some(2), "G1", 5, 0.0, 0.0, 0.0, 100);
        log.on_enemy_cast(&c, Some(1), "P1", 5, 30.0, 0.0, 0.0, 100);
        log.on_cast(&c, 55, 1_000);
        assert_eq!(leftovers(&c, &log, 1_010), Some(vec![1, 0]));
        walk(&mut log, "A", (30.0, 30.0), (3.0, 3.0), 2_000, 4_000);
        log.on_aura(&c, 10, "A", "Alice", 1, 2_000);
        assert_eq!(collision(&c, &log, 4_000).unwrap().guid, "A");
        log.on_enemy_zero(&c, 3, 4_100);
        assert!(ground_orbs(&c, &log, 4_200).iter().all(|g| g.to.is_some()));
        assert_eq!(leftovers(&c, &log, 4_110), Some(vec![0, 1]));
    }

    #[test]
    fn pegar_tira_o_orb_do_chao() {
        let c = cfg();
        let mut log = OrbLog::default();
        log.on_enemy_cast(&c, Some(2), "G1", 5, 0.0, 0.0, 0.0, 100);
        walk(&mut log, "B", (0.0, 0.0), (0.0, 0.0), 0, 4000);
        log.on_aura(&c, 20, "B", "Bob", 1, 900); // pegou o verde
        walk(&mut log, "A", (20.0, 0.0), (1.0, 0.0), 1000, 4000);
        log.on_aura(&c, 10, "A", "Alice", 1, 1000);
        assert_eq!(collision(&c, &log, 4000), None);
    }

    #[test]
    fn teleporte_por_cima_do_orb_conta_como_passar() {
        let c = cfg();
        let mut log = OrbLog::default();
        log.on_enemy_cast(&c, Some(2), "G1", 5, 0.0, 0.0, 0.0, 100);
        // parado a 20 jardas, Blink de 40 jardas com o verde no caminho, parado do outro lado
        walk(&mut log, "A", (20.0, 0.0), (20.0, 0.0), 1000, 3600);
        walk(&mut log, "A", (-20.0, 0.0), (-20.0, 0.0), 3650, 4200);
        log.on_aura(&c, 10, "A", "Alice", 1, 1000);
        let hit = collision(&c, &log, 3800).unwrap();
        assert_eq!(hit.guid, "A");
        assert!(hit.dist_yd < 0.5);
    }

    #[test]
    fn longe_ou_cedo_demais_nao_culpa() {
        let c = cfg();
        let mut log = OrbLog::default();
        log.on_enemy_cast(&c, Some(2), "G1", 5, 0.0, 0.0, 0.0, 100);
        // passou perto 2s antes e foi embora
        walk(&mut log, "A", (2.0, 0.0), (40.0, 0.0), 1000, 4000);
        log.on_aura(&c, 10, "A", "Alice", 1, 1000);
        assert_eq!(collision(&c, &log, 4000), None);
    }
}
