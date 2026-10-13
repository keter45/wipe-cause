//! Debuff que os players "somam" encostando um no outro: Helical Toxins, da intermissão da
//! Entombed Sentinels. Cada um recebe 1 a 3 stacks e precisa encostar em quem completa exatamente
//! 4; aí o debuff sai dos dois. Com outra soma os dois ficam com a soma (3 + 3 = 6 nos dois), e
//! acima de 4 ninguém mais consegue limpar o debuff deles.
//!
//! O que o log mostra:
//! - SPELL_AURA_APPLIED sem o número de stacks (o inicial fica escondido);
//! - soma 4: a aura sai dos dois no mesmo instante;
//! - outra soma: SPELL_AURA_APPLIED_DOSE nos dois, com a soma;
//! - o tick do debuff tem dano base (sem mitigação) proporcional aos stacks: é dele que sai o
//!   stack inicial de cada um (o valor por stack muda com a dificuldade, então é medido no pull).
//!
//! Com os stacks reconstruídos, cada encontro com soma errada vira um `PairFault`: se passou da
//! soma, se deixou a rodada sem solução, quem andou até quem nos segundos antes e um replay das
//! posições de quem tinha o debuff.

use crate::orbs::pos_at;
use crate::report::{PairFault, PairHint, PairMember, StackLine};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

/// Eventos de um mesmo encontro chegam com até isso de diferença.
const SAME_MS: i64 = 30;
/// Aplicação mais distante que isso da primeira da rodada abre uma rodada nova.
const ROUND_GAP_MS: i64 = 3_000;
/// Quem andou até quem: caminho dos dois nesses ms antes do encontro, em passos.
const APPROACH_MS: i64 = 5_000;
const APPROACH_STEP_MS: i64 = 100;
/// Culpado = quem fez pelo menos essa parte da aproximação, se ela teve pelo menos MIN_APPROACH_YD.
const CULPRIT_SHARE: f32 = 0.65;
const MIN_APPROACH_YD: f32 = 3.0;
/// Replay: começa no máximo isso antes da rodada (de onde cada um saiu); só os primeiros encontros.
const REPLAY_BEFORE_ROUND_MS: i64 = 2_000;
const MAX_REPLAYS: usize = 10;
/// Tick que não bate com um número inteiro de stacks (± isso) não conta.
const TICK_FIT: f64 = 0.15;

#[derive(Debug, Clone, Deserialize)]
pub struct PairDetect {
    /// aura com os stacks
    pub aura_id: u32,
    /// tick de dano do debuff (dano base proporcional aos stacks)
    pub tick_id: u32,
    /// soma que limpa
    #[serde(default = "default_target")]
    pub target: u32,
    /// maior stack inicial
    #[serde(default = "default_max_initial")]
    pub max_initial: u32,
}

fn default_target() -> u32 {
    4
}
fn default_max_initial() -> u32 {
    3
}

/// Tudo do pull que a reconstrução precisa (alimentado pelo streaming).
#[derive(Default)]
pub struct PairLog {
    trails: HashMap<String, Vec<(i64, f32, f32)>>,
    names: HashMap<String, String>,
    /// (t, guid, None = aplicada | Some(0) = removida | Some(n) = soma nova)
    auras: Vec<(i64, String, Option<u32>)>,
    holding: HashSet<String>,
    /// (t, guid, dano base)
    ticks: Vec<(i64, String, i64)>,
}

impl PairLog {
    pub fn on_player_pos(&mut self, guid: &str, x: f32, y: f32, t: i64) {
        let tr = self.trails.entry(guid.to_string()).or_default();
        if tr.last().is_none_or(|&(lt, lx, ly)| lt != t || lx != x || ly != y) {
            tr.push((t, x, y));
        }
    }

    /// Aura num player: `stacks` = 0 na remoção (a aplicação chega com 1, sem o número real).
    pub fn on_aura(&mut self, cfg: &PairDetect, spell_id: u32, guid: &str, name: &str, stacks: u32, t: i64) {
        if spell_id != cfg.aura_id {
            return;
        }
        self.names.entry(guid.to_string()).or_insert_with(|| name.to_string());
        let ev = if stacks == 0 {
            self.holding.remove(guid);
            Some(0)
        } else if self.holding.insert(guid.to_string()) {
            None
        } else {
            Some(stacks)
        };
        self.auras.push((t, guid.to_string(), ev));
    }

    /// Tick do debuff (dano ou absorvido): `base` = dano antes da mitigação.
    pub fn on_tick(&mut self, cfg: &PairDetect, spell_id: u32, guid: &str, base: i64, t: i64) {
        if spell_id == cfg.tick_id && base > 0 {
            self.ticks.push((t, guid.to_string(), base));
        }
    }

    pub fn name(&self, guid: &str) -> &str {
        self.names.get(guid).map_or("", String::as_str)
    }

    fn pos(&self, guid: &str, t: i64) -> Option<(f32, f32)> {
        pos_at(self.trails.get(guid)?, t)
    }
}

/// Um player com o debuff numa rodada.
struct Span {
    guid: String,
    round: usize,
    start: i64,
    end: Option<i64>,
    /// stacks iniciais (None = ainda não descoberto)
    v0: Option<u32>,
}

/// Encontro: soma errada (dose nos dois) ou limpeza (a aura sai dos dois juntos).
struct Merge {
    t: i64,
    round: usize,
    /// índices em `spans`
    members: Vec<usize>,
    sum: u32,
    clear: bool,
}

/// Valor de um stack por tick, pelo que melhor explica os ticks: os de antes de qualquer encontro
/// (1 a `max_initial` stacks) e os de depois de uma soma conhecida.
fn stack_value(samples: &[(f64, Option<u32>)], max_initial: u32) -> Option<f64> {
    let ks = |k: Option<u32>| -> Vec<u32> { k.map_or_else(|| (1..=max_initial).collect(), |k| vec![k]) };
    let err = |b: f64| -> f64 {
        samples
            .iter()
            .map(|&(v, k)| ks(k).into_iter().map(|k| (v / (k as f64 * b) - 1.0).abs()).fold(f64::MAX, f64::min).min(0.5))
            .sum()
    };
    let mut best: Option<(f64, f64)> = None;
    for &(v, k) in samples {
        for k in ks(k) {
            let b = v / k as f64;
            let e = err(b);
            if best.is_none_or(|(_, be)| e < be - 1e-9) {
                best = Some((b, e));
            }
        }
    }
    best.map(|(b, _)| b)
}

/// Stacks que um tick mostra (None = não bate com um número inteiro).
fn stacks_of(v: f64, b: f64) -> Option<u32> {
    let k = (v / b).round();
    (k >= 1.0 && (v / (k * b) - 1.0).abs() <= TICK_FIT).then_some(k as u32)
}

/// A rodada ainda tem solução? Cada um precisa terminar num grupo que some exatamente `target`,
/// e encontros com soma menor dão a soma aos dois (1 + 1 vira 2 e 2). `vals` = stacks de quem
/// ainda tem o debuff.
fn solvable(vals: &[u32], target: u32) -> bool {
    if vals.iter().any(|&v| v == 0 || v >= target) {
        return false;
    }
    let mut counts = vec![0u8; target as usize];
    for &v in vals {
        counts[v as usize] = counts[v as usize].saturating_add(1);
    }
    let mut memo = HashMap::new();
    solve(&mut counts, target as usize, &mut memo)
}

fn solve(c: &mut Vec<u8>, target: usize, memo: &mut HashMap<Vec<u8>, bool>) -> bool {
    if c.iter().all(|&n| n == 0) {
        return true;
    }
    if let Some(&r) = memo.get(c.as_slice()) {
        return r;
    }
    let mut ok = false;
    'outer: for x in 1..target {
        for y in x..target {
            if c[x] == 0 || c[y] == 0 || (x == y && c[x] < 2) || x + y > target {
                continue;
            }
            c[x] -= 1;
            c[y] -= 1;
            let s = x + y;
            if s < target {
                c[s] += 2;
            }
            ok = solve(c, target, memo);
            if s < target {
                c[s] -= 2;
            }
            c[x] += 1;
            c[y] += 1;
            if ok {
                break 'outer;
            }
        }
    }
    memo.insert(c.clone(), ok);
    ok
}

/// Encontros com soma errada do pull, em ordem.
pub fn faults(cfg: &PairDetect, log: &PairLog) -> Vec<PairFault> {
    // ---- rodadas e quem teve o debuff em cada uma
    let mut spans: Vec<Span> = Vec::new();
    let mut open: HashMap<&str, usize> = HashMap::new();
    let mut rounds: Vec<i64> = Vec::new();
    let mut doses: Vec<(i64, usize, u32)> = Vec::new();
    let mut removals: Vec<(i64, usize)> = Vec::new();
    for (t, guid, ev) in &log.auras {
        match ev {
            None => {
                if rounds.last().is_none_or(|&r| t - r > ROUND_GAP_MS) {
                    rounds.push(*t);
                }
                open.insert(guid.as_str(), spans.len());
                spans.push(Span { guid: guid.clone(), round: rounds.len() - 1, start: *t, end: None, v0: None });
            }
            Some(0) => {
                if let Some(i) = open.remove(guid.as_str()) {
                    spans[i].end = Some(*t);
                    removals.push((*t, i));
                }
            }
            Some(n) => {
                if let Some(&i) = open.get(guid.as_str()) {
                    doses.push((*t, i, *n));
                }
            }
        }
    }
    if spans.is_empty() {
        return Vec::new();
    }

    // ---- encontros: doses com a mesma soma no mesmo instante; remoções de exatamente dois juntos
    let mut merges: Vec<Merge> = Vec::new();
    let mut i = 0;
    while i < doses.len() {
        let (t0, _, n) = doses[i];
        let mut members = vec![doses[i].1];
        let mut j = i + 1;
        while j < doses.len() && doses[j].0 - t0 <= SAME_MS && doses[j].2 == n {
            members.push(doses[j].1);
            j += 1;
        }
        merges.push(Merge { t: t0, round: spans[members[0]].round, members, sum: n, clear: false });
        i = j;
    }
    let mut i = 0;
    while i < removals.len() {
        let t0 = removals[i].0;
        let mut j = i + 1;
        while j < removals.len() && removals[j].0 - t0 <= SAME_MS {
            j += 1;
        }
        if j - i == 2 {
            let members = vec![removals[i].1, removals[i + 1].1];
            merges.push(Merge { t: t0, round: spans[members[0]].round, members, sum: cfg.target, clear: true });
        }
        i = j;
    }
    merges.sort_by_key(|m| m.t);
    // primeiro encontro de cada um (até ali ele está com o stack inicial)
    let mut first_merge: Vec<Option<i64>> = vec![None; spans.len()];
    for m in &merges {
        for &s in &m.members {
            first_merge[s].get_or_insert(m.t);
        }
    }
    // soma conhecida de cada um a partir de cada dose
    let mut known_after: Vec<Vec<(i64, u32)>> = vec![Vec::new(); spans.len()];
    for m in merges.iter().filter(|m| !m.clear) {
        for &s in &m.members {
            known_after[s].push((m.t, m.sum));
        }
    }

    // ---- valor de um stack (pelos ticks) e stacks iniciais
    let by_guid: HashMap<&str, Vec<usize>> = spans.iter().enumerate().fold(HashMap::new(), |mut acc, (i, s)| {
        acc.entry(s.guid.as_str()).or_default().push(i);
        acc
    });
    let span_of = |guid: &str, t: i64| -> Option<usize> {
        by_guid.get(guid)?.iter().copied().find(|&i| spans[i].start < t && spans[i].end.is_none_or(|e| t <= e + SAME_MS))
    };
    // (span, t, base, stacks conhecidos)
    let mut readings: Vec<(usize, f64, Option<u32>)> = Vec::new();
    for (t, guid, base) in &log.ticks {
        let Some(s) = span_of(guid, *t) else { continue };
        let known = known_after[s].iter().rev().find(|(mt, _)| *mt <= *t).map(|&(_, n)| n);
        let before_any = first_merge[s].is_none_or(|f| *t < f);
        if known.is_some() || before_any {
            readings.push((s, *base as f64, known));
        }
    }
    let samples: Vec<(f64, Option<u32>)> = readings.iter().map(|&(_, v, k)| (v, k)).collect();
    if let Some(b) = stack_value(&samples, cfg.max_initial) {
        let mut votes: HashMap<usize, Vec<u32>> = HashMap::new();
        for &(s, v, k) in &readings {
            if k.is_none() {
                if let Some(k) = stacks_of(v, b).filter(|&k| k <= cfg.max_initial) {
                    votes.entry(s).or_default().push(k);
                }
            }
        }
        for (s, mut ks) in votes {
            ks.sort_unstable();
            spans[s].v0 = Some(ks[ks.len() / 2]);
        }
    }
    // o que falta sai das somas: quem encostou em alguém conhecido tinha a diferença
    let prior = |spans: &[Span], s: usize, t: i64| -> Option<u32> {
        match known_after[s].iter().rev().find(|(mt, _)| *mt < t) {
            Some(&(_, n)) => Some(n),
            None => spans[s].v0,
        }
    };
    loop {
        let mut changed = false;
        for m in &merges {
            let priors: Vec<Option<u32>> = m.members.iter().map(|&s| prior(&spans, s, m.t)).collect();
            let unknown: Vec<usize> = m.members.iter().zip(&priors).filter(|(_, p)| p.is_none()).map(|(&s, _)| s).collect();
            let known_sum: u32 = priors.iter().flatten().sum();
            if unknown.len() == 1 && m.sum > known_sum {
                let v = m.sum - known_sum;
                if (1..=cfg.max_initial).contains(&v) {
                    spans[unknown[0]].v0 = Some(v);
                    changed = true;
                }
            } else if unknown.len() == m.members.len() && m.members.len() == 2 && !m.clear {
                // 1 + 1 e 3 + 3 só têm um jeito de acontecer
                let half = m.sum / 2;
                if m.sum % 2 == 0 && (half == 1 || half == cfg.max_initial) {
                    unknown.iter().for_each(|&s| spans[s].v0 = Some(half));
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }

    // ---- rodada a rodada, em ordem: estado antes e depois de cada encontro
    let mut out: Vec<PairFault> = Vec::new();
    for (round, &round_start) in rounds.iter().enumerate() {
        let members_of_round: Vec<usize> = (0..spans.len()).filter(|&s| spans[s].round == round).collect();
        // dupla que limpou junto sem ninguém saber quanto cada um tinha: se resolveram entre si
        let paired_unknown: HashSet<usize> = merges
            .iter()
            .filter(|m| m.round == round && m.clear && m.members.iter().all(|&s| first_merge[s] == Some(m.t) && spans[s].v0.is_none()))
            .flat_map(|m| m.members.iter().copied())
            .collect();
        let mut state: HashMap<usize, Option<u32>> = members_of_round.iter().map(|&s| (s, spans[s].v0)).collect();
        let lone_removals: Vec<(i64, usize)> = removals
            .iter()
            .copied()
            .filter(|&(t, s)| spans[s].round == round && !merges.iter().any(|m| m.clear && m.t == t && m.members.contains(&s)))
            .collect();
        let check = |state: &HashMap<usize, Option<u32>>| -> Option<bool> {
            let mut vals = Vec::new();
            for (s, v) in state {
                if paired_unknown.contains(s) {
                    continue;
                }
                vals.push((*v)?);
            }
            Some(solvable(&vals, cfg.target))
        };
        let mut lone = lone_removals.iter().peekable();
        for m in merges.iter().filter(|m| m.round == round) {
            while let Some(&&(t, s)) = lone.peek() {
                if t >= m.t {
                    break;
                }
                state.remove(&s);
                lone.next();
            }
            let before = check(&state);
            let priors: Vec<Option<u32>> = m.members.iter().map(|&s| state.get(&s).copied().flatten()).collect();
            // parceiro certo mais perto de cada um, com o estado de antes do encontro
            let hints: Vec<Option<PairHint>> = m
                .members
                .iter()
                .zip(&priors)
                .map(|(&s, p)| {
                    let need = cfg.target.checked_sub((*p)?).filter(|&n| n > 0)?;
                    let here = log.pos(&spans[s].guid, m.t)?;
                    state
                        .iter()
                        .filter(|(o, v)| !m.members.contains(o) && **v == Some(need))
                        .filter_map(|(&o, _)| {
                            let p = log.pos(&spans[o].guid, m.t)?;
                            Some((o, (p.0 - here.0).hypot(p.1 - here.1)))
                        })
                        .min_by(|a, b| a.1.total_cmp(&b.1))
                        .map(|(o, d)| PairHint { guid: spans[o].guid.clone(), name: log.name(&spans[o].guid).to_string(), stacks: need, dist_yd: round1(d) })
                })
                .collect();
            for &s in &m.members {
                if m.clear {
                    state.remove(&s);
                } else {
                    state.insert(s, Some(m.sum));
                }
            }
            if m.clear {
                continue;
            }
            let after = check(&state);
            let broke = match (before, after) {
                (Some(b), Some(a)) => Some(b && !a),
                _ => None,
            };
            let over = m.sum > cfg.target;
            let guids: Vec<&str> = m.members.iter().map(|&s| spans[s].guid.as_str()).collect();
            let (moves, culprit) = approach(log, &guids, m.t, round_start);
            let members = m
                .members
                .iter()
                .enumerate()
                .map(|(k, &s)| PairMember {
                    guid: spans[s].guid.clone(),
                    name: log.name(&spans[s].guid).to_string(),
                    before: priors[k],
                    approach_yd: round1(moves[k].0),
                    share: (moves[k].1 * 100.0).round() / 100.0,
                    better: hints[k].clone(),
                })
                .collect();
            out.push(PairFault {
                t: m.t,
                round_start,
                members,
                sum: m.sum,
                target: cfg.target,
                over,
                broke,
                counted: over || broke == Some(true),
                culprit: culprit.map(|k| guids[k].to_string()),
                replay: None,
            });
        }
    }
    out.sort_by_key(|f| f.t);

    // ---- replay dos primeiros encontros (os que contam primeiro)
    let mut order: Vec<usize> = (0..out.len()).collect();
    order.sort_by_key(|&i| (!out[i].counted, out[i].t));
    for i in order.into_iter().take(MAX_REPLAYS) {
        let f = &out[i];
        let round = spans.iter().find(|s| s.guid == f.members[0].guid && s.start <= f.t && s.end.is_none_or(|e| e + SAME_MS >= f.t)).map(|s| s.round);
        let Some(round) = round else { continue };
        let mut r = crate::replay::around(f.t, crate::replay::AFTER_MS, f.members.iter().map(|m| m.guid.clone()).collect());
        r.from = r.from.max(f.round_start - REPLAY_BEFORE_ROUND_MS);
        // stacks de todo mundo da rodada (o inicial, cada soma e a limpeza)
        r.stacks = spans
            .iter()
            .enumerate()
            .filter(|(_, sp)| sp.round == round)
            .map(|(s, sp)| {
                let mut pts = vec![(sp.start, sp.v0.map_or(-1, |v| v as i32))];
                pts.extend(known_after[s].iter().map(|&(t, n)| (t, n as i32)));
                pts.extend(sp.end.map(|e| (e, 0)));
                StackLine { guid: sp.guid.clone(), pts }
            })
            .collect();
        out[i].replay = Some(r);
    }
    out
}

fn round1(v: f32) -> f32 {
    (v * 10.0).round() / 10.0
}

/// Quanto cada um andou na direção dos outros nos segundos antes do encontro (jardas, parte do
/// total) e quem fez a maior parte, se foi clara.
fn approach(log: &PairLog, guids: &[&str], t: i64, round_start: i64) -> (Vec<(f32, f32)>, Option<usize>) {
    let n = guids.len();
    let mut closing = vec![0f32; n];
    if n >= 2 {
        let from = (t - APPROACH_MS).max(round_start);
        let mut prev: Option<Vec<Option<(f32, f32)>>> = None;
        let mut step = from;
        while step <= t {
            let now: Vec<Option<(f32, f32)>> = guids.iter().map(|g| log.pos(g, step)).collect();
            if let Some(prev) = &prev {
                for i in 0..n {
                    let (Some(a0), Some(a1)) = (prev[i], now[i]) else { continue };
                    // centro dos outros (no passo anterior)
                    let others: Vec<(f32, f32)> = (0..n).filter(|&j| j != i).filter_map(|j| prev[j]).collect();
                    if others.is_empty() {
                        continue;
                    }
                    let cx = others.iter().map(|p| p.0).sum::<f32>() / others.len() as f32;
                    let cy = others.iter().map(|p| p.1).sum::<f32>() / others.len() as f32;
                    let (dx, dy) = (cx - a0.0, cy - a0.1);
                    let d = dx.hypot(dy);
                    if d < 1e-3 {
                        continue;
                    }
                    closing[i] += ((a1.0 - a0.0) * dx + (a1.1 - a0.1) * dy) / d;
                }
            }
            prev = Some(now);
            step += APPROACH_STEP_MS;
        }
    }
    let total: f32 = closing.iter().map(|c| c.max(0.0)).sum();
    let shares: Vec<f32> = closing.iter().map(|c| if total > 0.0 { c.max(0.0) / total } else { 0.0 }).collect();
    let culprit = (total >= MIN_APPROACH_YD)
        .then(|| shares.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).filter(|(_, s)| **s >= CULPRIT_SHARE).map(|(i, _)| i))
        .flatten();
    (closing.into_iter().map(|c| c.max(0.0)).zip(shares).collect(), culprit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> PairDetect {
        PairDetect { aura_id: 10, tick_id: 11, target: 4, max_initial: 3 }
    }

    /// Player parado em `p` ou andando de `a` até `b` entre `t0` e `t1`.
    fn walk(log: &mut PairLog, guid: &str, a: (f32, f32), b: (f32, f32), t0: i64, t1: i64) {
        let mut t = t0;
        while t <= t1 {
            let k = if t1 > t0 { (t - t0) as f32 / (t1 - t0) as f32 } else { 0.0 };
            log.on_player_pos(guid, a.0 + (b.0 - a.0) * k, a.1 + (b.1 - a.1) * k, t);
            t += 200;
        }
    }

    /// Rodada com quatro players: A e B com 3, C e D com 1 (valor de um stack: 1000).
    fn round(log: &mut PairLog, c: &PairDetect) {
        for (g, n) in [("A", "Alice"), ("B", "Bob"), ("C", "Carol"), ("D", "Dan")] {
            log.on_aura(c, 10, g, n, 1, 0);
        }
        for (g, v) in [("A", 3000), ("B", 3150), ("C", 1000), ("D", 950)] {
            log.on_tick(c, 11, g, v, 2_000);
        }
    }

    #[test]
    fn tres_com_tres_vira_seis_e_culpa_quem_andou() {
        let c = cfg();
        let mut log = PairLog::default();
        round(&mut log, &c);
        walk(&mut log, "A", (0.0, 0.0), (19.0, 0.0), 0, 5_000); // Alice anda até Bob
        walk(&mut log, "B", (20.0, 0.0), (20.0, 0.0), 0, 6_000);
        walk(&mut log, "C", (0.0, 10.0), (0.0, 10.0), 0, 6_000);
        walk(&mut log, "D", (20.0, 10.0), (20.0, 10.0), 0, 6_000);
        log.on_aura(&c, 10, "A", "Alice", 6, 5_000);
        log.on_aura(&c, 10, "B", "Bob", 6, 5_000);
        let f = faults(&c, &log);
        assert_eq!(f.len(), 1);
        let x = &f[0];
        assert_eq!((x.sum, x.over, x.counted), (6, true, true));
        assert_eq!(x.members.iter().map(|m| m.before).collect::<Vec<_>>(), [Some(3), Some(3)]);
        assert_eq!(x.culprit.as_deref(), Some("A"));
        assert!(x.members[0].share > 0.9);
        // Alice precisava de alguém com 1: Carol estava a 10 jardas do ponto de saída, Dan a 10 do encontro
        let hint = x.members[0].better.as_ref().unwrap();
        assert_eq!((hint.guid.as_str(), hint.stacks), ("D", 1));
        let replay = x.replay.as_ref().unwrap();
        assert_eq!(replay.stacks.len(), 4);
        assert_eq!(replay.focus, ["A", "B"]);
    }

    #[test]
    fn um_mais_um_que_deixa_os_tres_sem_par_conta_como_falha() {
        let c = cfg();
        let mut log = PairLog::default();
        round(&mut log, &c);
        for g in ["A", "B", "C", "D"] {
            walk(&mut log, g, (0.0, 0.0), (0.0, 0.0), 0, 6_000);
        }
        // Carol e Dan (1 + 1) se encostam: sobram dois 3 sem ninguém com 1
        log.on_aura(&c, 10, "C", "Carol", 2, 3_000);
        log.on_aura(&c, 10, "D", "Dan", 2, 3_000);
        let f = faults(&c, &log);
        assert_eq!(f.len(), 1);
        assert_eq!((f[0].sum, f[0].over, f[0].broke, f[0].counted), (2, false, Some(true), true));
        // já juntos: ninguém andou, sem culpado pelo caminho
        assert_eq!(f[0].culprit, None);
    }

    #[test]
    fn soma_menor_que_ainda_tem_solucao_nao_conta() {
        let c = cfg();
        let mut log = PairLog::default();
        // quatro com 1: 1 + 1 vira 2 e 2, que ainda fecham entre si
        for (g, n) in [("A", "Alice"), ("B", "Bob"), ("C", "Carol"), ("D", "Dan")] {
            log.on_aura(&c, 10, g, n, 1, 0);
            log.on_tick(&c, 11, g, 1000, 2_000);
        }
        log.on_aura(&c, 10, "A", "Alice", 2, 3_000);
        log.on_aura(&c, 10, "B", "Bob", 2, 3_000);
        let f = faults(&c, &log);
        assert_eq!((f[0].broke, f[0].counted), (Some(false), false));
    }

    #[test]
    fn stack_inicial_sai_da_conta_quando_o_tick_nao_veio() {
        let c = cfg();
        let mut log = PairLog::default();
        // valor do stack medido em outros dois; Alice e Bob se encostam antes do primeiro tick
        for (g, n) in [("A", "Alice"), ("B", "Bob"), ("C", "Carol"), ("D", "Dan")] {
            log.on_aura(&c, 10, g, n, 1, 0);
        }
        log.on_tick(&c, 11, "C", 2000, 2_000);
        log.on_tick(&c, 11, "D", 1000, 2_000);
        log.on_aura(&c, 10, "A", "Alice", 5, 1_000);
        log.on_aura(&c, 10, "B", "Bob", 5, 1_000);
        // depois Alice (5) encosta em Carol (2): 7
        log.on_aura(&c, 10, "A", "Alice", 7, 3_000);
        log.on_aura(&c, 10, "C", "Carol", 7, 3_000);
        let f = faults(&c, &log);
        assert_eq!(f.len(), 2);
        assert_eq!(f[1].members.iter().map(|m| m.before).collect::<Vec<_>>(), [Some(5), Some(2)]);
        // 5 = 2 + 3, mas não dá para saber quem tinha qual
        assert_eq!(f[0].members.iter().map(|m| m.before).collect::<Vec<_>>(), [None, None]);
        assert!(f.iter().all(|x| x.counted));
    }

    #[test]
    fn solucao_da_rodada() {
        assert!(solvable(&[3, 1, 2, 2], 4));
        assert!(solvable(&[1, 1, 1, 1], 4));
        assert!(solvable(&[1, 1, 1, 2], 4)); // 1+2 vira 3 e 3, que fecham com os 1
        assert!(!solvable(&[3, 1, 1, 1, 2], 4));
        assert!(!solvable(&[3, 3, 2, 2], 4));
        assert!(!solvable(&[1, 2], 4));
        assert!(!solvable(&[6, 1, 3], 4));
        assert!(solvable(&[], 4));
    }

    #[test]
    fn valor_do_stack_pela_mistura_de_ticks() {
        let s: Vec<(f64, Option<u32>)> = [15867.0, 16668.0, 31735.0, 47603.0, 50004.0, 15001.0].iter().map(|&v| (v, None)).collect();
        let b = stack_value(&s, 3).unwrap();
        assert!((b - 15867.0).abs() / 15867.0 < 0.06, "{b}");
        assert_eq!(stacks_of(95208.0, b), Some(6));
        assert_eq!(stacks_of(491909.0, b), Some(31));
    }
}
