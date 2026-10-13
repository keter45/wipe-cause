//! Replays: posições de players e bosses ao longo do pull, guardadas só nos trechos que algum
//! replay usa (antes de cada morte e de cada falha de mecânica que depende de movimentação).
//!
//! Durante o streaming, `Trails` anota as posições do advanced logging (com um mínimo de
//! intervalo, para não pesar). No fim do pull, cada morte e cada falha vira um `ReplayRef`
//! (momento, janela, quem acompanhar, stacks, acertos) e `Trails::build` amostra as posições nos
//! trechos pedidos, num passo fixo, para o `Pull.tracks`.

use crate::orbs::pos_at;
use crate::report::{Arena, PullTracks, ReplayRef, StackLine, TrackSeg, UnitTrack};
use std::collections::HashMap;

/// Segundos antes do momento que o replay mostra, e depois (falha de mecânica / morte).
pub const BEFORE_MS: i64 = 15_000;
pub const AFTER_MS: i64 = 2_000;
pub const DEATH_AFTER_MS: i64 = 1_000;
/// Passo das posições guardadas no relatório.
pub const STEP_MS: i64 = 250;
/// Na gravação: posição nova só depois disso (ou se andou mais que MIN_MOVE_YD).
const MIN_GAP_MS: i64 = 100;
const MIN_MOVE_YD: f32 = 1.5;
/// Inimigos no replay: os de HP de boss (este tanto do maior HP) e no máximo estes.
const ENEMY_MIN_HP_SHARE: f64 = 0.3;
const MAX_ENEMIES: usize = 6;
/// Chão da arena: lado de cada célula (jardas) e quantas posições bastam para contar.
const ARENA_CELL_YD: f32 = 4.0;
const ARENA_MIN_HITS: u32 = 2;

struct Unit {
    name: String,
    enemy: bool,
    max_hp: i64,
    pts: Vec<(i64, f32, f32)>,
    died: Option<i64>,
}

/// Posições de cada unidade ao longo do pull (ms desde o início).
#[derive(Default)]
pub struct Trails {
    units: HashMap<String, Unit>,
}

impl Trails {
    #[allow(clippy::too_many_arguments)]
    pub fn on_pos(&mut self, guid: &str, name: &str, enemy: bool, max_hp: i64, x: f32, y: f32, t: i64) {
        let u = self.units.entry(guid.to_string()).or_insert_with(|| Unit { name: name.to_string(), enemy, max_hp, pts: Vec::new(), died: None });
        if u.name.is_empty() && !name.is_empty() {
            u.name = name.to_string();
        }
        u.max_hp = u.max_hp.max(max_hp);
        let keep = u.pts.last().is_none_or(|&(lt, lx, ly)| t - lt >= MIN_GAP_MS || (x - lx).hypot(y - ly) > MIN_MOVE_YD);
        if keep {
            u.pts.push((t, x, y));
        }
    }

    /// Inimigo morto: some do replay a partir daqui.
    pub fn on_enemy_died(&mut self, guid: &str, t: i64) {
        if let Some(u) = self.units.get_mut(guid) {
            u.died.get_or_insert(t);
        }
    }

    /// Nome do player para o replay (o advanced logging não traz o nome).
    pub fn set_name(&mut self, guid: &str, name: &str) {
        if let Some(u) = self.units.get_mut(guid) {
            if u.name.is_empty() {
                u.name = name.to_string();
            }
        }
    }

    /// Chão da arena: as células em que algum player esteve no pull (pelo menos ARENA_MIN_HITS
    /// posições, para um teleporte ou uma posição errada não abrir chão no vazio).
    pub fn arena(&self) -> Option<Arena> {
        let mut count: HashMap<(i32, i32), u32> = HashMap::new();
        for u in self.units.values().filter(|u| !u.enemy) {
            for &(_, x, y) in &u.pts {
                *count.entry(((x / ARENA_CELL_YD).floor() as i32, (y / ARENA_CELL_YD).floor() as i32)).or_default() += 1;
            }
        }
        let mut cells: Vec<(i32, i32)> = count.into_iter().filter(|&(_, n)| n >= ARENA_MIN_HITS).map(|(c, _)| c).collect();
        cells.sort_unstable();
        (!cells.is_empty()).then_some(Arena { cell_yd: ARENA_CELL_YD, cells })
    }

    /// Posições nos trechos de todos os replays, num passo fixo.
    pub fn build(&self, replays: &[&ReplayRef]) -> Option<PullTracks> {
        let windows = merge(replays.iter().map(|r| (r.from, r.to)).collect());
        if windows.is_empty() {
            return None;
        }
        let top = self.units.values().filter(|u| u.enemy).map(|u| u.max_hp).max().unwrap_or(0);
        let mut enemies: Vec<(&String, &Unit)> =
            self.units.iter().filter(|(_, u)| u.enemy && top > 0 && u.max_hp as f64 >= top as f64 * ENEMY_MIN_HP_SHARE).collect();
        enemies.sort_by_key(|(_, u)| std::cmp::Reverse(u.max_hp));
        let mut chosen: Vec<(&String, &Unit)> = self.units.iter().filter(|(_, u)| !u.enemy).collect();
        chosen.extend(enemies.into_iter().take(MAX_ENEMIES));
        let mut units: Vec<UnitTrack> = chosen
            .into_iter()
            .filter_map(|(guid, u)| {
                let segs: Vec<TrackSeg> = windows.iter().flat_map(|&(a, b)| sample(u, a, b)).collect();
                (!segs.is_empty()).then(|| UnitTrack { guid: guid.clone(), name: u.name.clone(), kind: if u.enemy { "enemy" } else { "player" }.into(), segs })
            })
            .collect();
        if units.iter().all(|u| u.kind == "enemy") {
            return None;
        }
        units.sort_by(|a, b| a.guid.cmp(&b.guid));
        Some(PullTracks { step_ms: STEP_MS, units })
    }
}

/// Trechos de `[a, b]` em que a unidade tem posição (antes da primeira e depois de morrer, nada).
fn sample(u: &Unit, a: i64, b: i64) -> Vec<TrackSeg> {
    let Some(&(first, ..)) = u.pts.first() else { return Vec::new() };
    let end = u.died.map_or(b, |d| d.min(b));
    let start = a + ((first - a).max(0) + STEP_MS - 1) / STEP_MS * STEP_MS;
    if start > end {
        return Vec::new();
    }
    let mut xy = Vec::new();
    let mut t = start;
    while t <= end {
        let Some((x, y)) = pos_at(&u.pts, t) else { break };
        xy.push((x * 10.0).round() as i32);
        xy.push((y * 10.0).round() as i32);
        t += STEP_MS;
    }
    if xy.is_empty() {
        return Vec::new();
    }
    vec![TrackSeg { t0: start, xy }]
}

/// Janelas sobrepostas (ou coladas) viram uma, alinhadas no passo.
fn merge(mut w: Vec<(i64, i64)>) -> Vec<(i64, i64)> {
    for x in &mut w {
        x.0 = (x.0.max(0) / STEP_MS) * STEP_MS;
    }
    w.sort();
    let mut out: Vec<(i64, i64)> = Vec::new();
    for (a, b) in w {
        match out.last_mut() {
            Some(last) if a <= last.1 + STEP_MS => last.1 = last.1.max(b),
            _ => out.push((a, b)),
        }
    }
    out
}

/// Replay de um momento: `BEFORE_MS` antes e `after` depois.
pub fn around(t: i64, after: i64, focus: Vec<String>) -> ReplayRef {
    ReplayRef { t, from: (t - BEFORE_MS).max(0), to: t + after, focus, stacks: Vec::new(), marks: Vec::new() }
}

/// Stacks de cada player dentro da janela, a partir do histórico (t, stacks) de cada um.
pub fn stack_lines(hist: &HashMap<String, Vec<(i64, u32)>>, from: i64, to: i64) -> Vec<StackLine> {
    let mut out: Vec<StackLine> = hist
        .iter()
        .filter_map(|(guid, h)| {
            let mut pts: Vec<(i64, i32)> = Vec::new();
            if let Some(&(_, n)) = h.iter().rev().find(|(t, _)| *t <= from) {
                pts.push((from, n as i32));
            }
            pts.extend(h.iter().filter(|(t, _)| *t > from && *t <= to).map(|&(t, n)| (t, n as i32)));
            pts.iter().any(|p| p.1 != 0).then(|| StackLine { guid: guid.clone(), pts })
        })
        .collect();
    out.sort_by(|a, b| a.guid.cmp(&b.guid));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guarda_so_os_trechos_dos_replays() {
        let mut tr = Trails::default();
        for t in (0..=60_000).step_by(100) {
            tr.on_pos("P1", "Alice", false, 100, t as f32 / 1000.0, 0.0, t);
            tr.on_pos("B1", "Boss", true, 10_000, 0.0, 0.0, t);
        }
        tr.on_pos("A1", "Add", true, 100, 5.0, 5.0, 0); // HP pequeno: fica de fora
        let r1 = around(20_000, AFTER_MS, vec!["P1".into()]);
        let r2 = around(30_000, AFTER_MS, vec![]);
        let out = tr.build(&[&r1, &r2]).unwrap();
        assert_eq!(out.units.iter().map(|u| u.guid.as_str()).collect::<Vec<_>>(), ["B1", "P1"]);
        let p = out.units.iter().find(|u| u.guid == "P1").unwrap();
        // 5s..22s e 15s..32s viram um trecho só: 5s..32s
        assert_eq!(p.segs.len(), 1);
        assert_eq!(p.segs[0].t0, 5_000);
        assert_eq!(p.segs[0].xy.len() as i64, ((32_000 - 5_000) / STEP_MS + 1) * 2);
        assert_eq!(&p.segs[0].xy[..2], &[50, 0]);
    }

    #[test]
    fn inimigo_morto_sai_do_replay() {
        let mut tr = Trails::default();
        for t in (0..=20_000).step_by(500) {
            tr.on_pos("P1", "Alice", false, 100, 0.0, 0.0, t);
            tr.on_pos("B1", "Boss", true, 10_000, 1.0, 1.0, t);
        }
        tr.on_enemy_died("B1", 10_000);
        let out = tr.build(&[&around(15_000, AFTER_MS, vec![])]).unwrap();
        let b = out.units.iter().find(|u| u.guid == "B1").unwrap();
        assert_eq!(b.segs[0].t0 + (b.segs[0].xy.len() as i64 / 2 - 1) * STEP_MS, 10_000);
    }

    #[test]
    fn chao_da_arena_onde_alguem_pisou() {
        let mut tr = Trails::default();
        for t in (0..=2_000).step_by(100) {
            tr.on_pos("P1", "Alice", false, 100, 1.0, 1.0, t); // parado na célula (0, 0)
            tr.on_pos("B1", "Boss", true, 10_000, 50.0, 50.0, t); // inimigo não abre chão
        }
        tr.on_pos("P1", "Alice", false, 100, -9.0, 5.0, 3_000); // uma posição só: não conta
        let a = tr.arena().unwrap();
        assert_eq!(a.cells, vec![(0, 0)]);
    }

    #[test]
    fn stacks_na_janela() {
        let mut h = HashMap::new();
        h.insert("A".to_string(), vec![(1_000, 1), (5_000, 3), (9_000, 0)]);
        h.insert("B".to_string(), vec![(1_000, 1), (2_000, 0)]);
        let l = stack_lines(&h, 4_000, 10_000);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].pts, vec![(4_000, 1), (5_000, 3), (9_000, 0)]);
    }
}
