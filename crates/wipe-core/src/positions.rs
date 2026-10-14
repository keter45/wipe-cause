//! Onde os players pisaram em cada boss de um log (células de 1 jarda, só dentro dos pulls), para
//! alinhar a imagem da arena com as coordenadas do log e achar o chão andável (`wipe-cli positions`).

use crate::analysis::advanced_at;
use crate::tokenizer::{split_fields, split_timestamp};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::Path;

/// Posições de um boss: (x, y) em jardas inteiras -> quantas vezes alguém esteve ali.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occupancy {
    pub name: String,
    /// uiMapID mais visto (a mesma sala)
    pub map: i64,
    pub pulls: u32,
    /// [x, y, vezes]
    pub cells: Vec<(i32, i32, u32)>,
}

/// Por boss: o resultado, as células (x, y) -> vezes e os uiMapIDs -> vezes.
type Acc = (Occupancy, HashMap<(i32, i32), u32>, HashMap<i64, u32>);

pub fn occupancy_file(path: &Path) -> io::Result<BTreeMap<u32, Occupancy>> {
    let mut r = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut buf = String::new();
    let mut acc: BTreeMap<u32, Acc> = BTreeMap::new();
    let mut current: Option<u32> = None;
    loop {
        buf.clear();
        if r.read_line(&mut buf)? == 0 {
            break;
        }
        let Some((_, rest)) = split_timestamp(&buf) else { continue };
        let mut f: Vec<&str> = Vec::new();
        let ev = rest.split(',').next().unwrap_or("");
        match ev {
            "ENCOUNTER_START" => {
                split_fields(rest, &mut f);
                let id: u32 = f.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
                let e = acc.entry(id).or_default();
                e.0.name = f.get(2).unwrap_or(&"").to_string();
                e.0.pulls += 1;
                current = Some(id);
            }
            "ENCOUNTER_END" => current = None,
            _ => {
                let Some(id) = current else { continue };
                if !ev.starts_with("SPELL_") && !ev.starts_with("SWING_") && !ev.starts_with("RANGE_") {
                    continue;
                }
                split_fields(rest, &mut f);
                let at = if ev.starts_with("SWING_") { 9 } else { 12 };
                let Some(a) = advanced_at(&f, at) else { continue };
                if !a.info_guid.starts_with("Player-") {
                    continue;
                }
                let e = acc.get_mut(&id).expect("encontro aberto");
                *e.1.entry((a.x.floor() as i32, a.y.floor() as i32)).or_default() += 1;
                if let Some(m) = f.get(at + a.len - 3).and_then(|v| v.parse::<i64>().ok()) {
                    *e.2.entry(m).or_default() += 1;
                }
            }
        }
    }
    Ok(acc
        .into_iter()
        .map(|(id, (mut o, cells, maps))| {
            o.map = maps.into_iter().max_by_key(|m| m.1).map_or(0, |m| m.0);
            o.cells = cells.into_iter().map(|((x, y), n)| (x, y, n)).collect();
            o.cells.sort_unstable();
            (id, o)
        })
        .collect())
}

/// Distâncias (jardas) de quem levou o dano `damage` até o centro da área no instante do golpe: o
/// portador mais perto da aura `aura` (sem contar a própria vítima) ou a unidade mais perto com o npc
/// `npc`. Para medir o raio de uma área (`wipe-cli radius`). Posições com mais de 1,5 s ficam de fora.
/// `soak`: sem aura nem npc, o centro é o meio de quem foi atingido no mesmo impacto (até 600 ms e 12 jd
/// juntos); devolve também quantos entraram em cada soak.
pub fn radius_probe(path: &Path, damage: u32, aura: Option<u32>, npc: Option<u32>, soak: bool) -> io::Result<(Vec<f32>, Vec<u32>)> {
    let mut soak_hits: Vec<(i64, f32, f32, String)> = Vec::new();
    const MAX_AGE_MS: i64 = 1_500;
    const RECENT_MS: i64 = 1_000;
    let mut r = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut buf = String::new();
    let mut pos: HashMap<String, (f32, f32, i64)> = HashMap::new();
    // portadores da aura: guid -> quando saiu (None = ainda com ela); quem acabou de perder conta (o
    // splash costuma sair quando a aura acaba)
    let mut holders: HashMap<String, Option<i64>> = HashMap::new();
    let mut out = Vec::new();
    let mut inside = false;
    loop {
        buf.clear();
        if r.read_line(&mut buf)? == 0 {
            break;
        }
        let Some((ts, rest)) = split_timestamp(&buf) else { continue };
        let ev = rest.split(',').next().unwrap_or("");
        match ev {
            "ENCOUNTER_START" => {
                inside = true;
                pos.clear();
                holders.clear();
                continue;
            }
            "ENCOUNTER_END" => {
                inside = false;
                continue;
            }
            _ if !inside => continue,
            _ => {}
        }
        if !ev.starts_with("SPELL_") && !ev.starts_with("SWING_") && !ev.starts_with("RANGE_") {
            continue;
        }
        let Some(t) = crate::timestamp::parse_timestamp(ts, 2026) else { continue };
        let mut f: Vec<&str> = Vec::new();
        split_fields(rest, &mut f);
        let at = if ev.starts_with("SWING_") { 9 } else { 12 };
        if let Some(a) = advanced_at(&f, at) {
            pos.insert(a.info_guid.to_string(), (a.x, a.y, t));
        }
        let spell: u32 = f.get(9).and_then(|v| v.parse().ok()).unwrap_or(0);
        if Some(spell) == aura && f[5].starts_with("Player-") {
            match ev {
                "SPELL_AURA_APPLIED" => {
                    holders.insert(f[5].to_string(), None);
                    // soak que marca quem entrou com a aura: a aplicação é o acerto
                    if soak {
                        if let Some(&(x, y, _)) = pos.get(f[5]).filter(|p| t - p.2 <= MAX_AGE_MS) {
                            soak_hits.push((t, x, y, f[5].to_string()));
                        }
                    }
                }
                "SPELL_AURA_REMOVED" => {
                    holders.insert(f[5].to_string(), Some(t));
                }
                _ => {}
            }
        }
        if spell != damage || !matches!(ev, "SPELL_DAMAGE" | "SPELL_PERIODIC_DAMAGE" | "SPELL_MISSED" | "SPELL_ABSORBED") || !f[5].starts_with("Player-") {
            continue;
        }
        let Some(&(vx, vy, _)) = pos.get(f[5]).filter(|p| t - p.2 <= MAX_AGE_MS) else { continue };
        if soak {
            if aura.is_none() {
                soak_hits.push((t, vx, vy, f[5].to_string()));
            }
            continue;
        }
        let centers: Vec<(f32, f32)> = match (aura, npc) {
            (Some(_), _) => holders
                .iter()
                .filter(|(g, out)| g.as_str() != f[5] && out.is_none_or(|o| t - o <= RECENT_MS))
                .filter_map(|(g, _)| pos.get(g))
                .filter(|p| t - p.2 <= MAX_AGE_MS)
                .map(|p| (p.0, p.1))
                .collect(),
            (None, Some(n)) => pos
                .iter()
                .filter(|(g, p)| crate::analysis::npc_id(g) == Some(n) && t - p.2 <= MAX_AGE_MS)
                .map(|(_, p)| (p.0, p.1))
                .collect(),
            _ => Vec::new(),
        };
        if let Some(d) = centers.iter().map(|c| (c.0 - vx).hypot(c.1 - vy)).min_by(f32::total_cmp) {
            out.push(d);
        }
    }
    let mut sizes = Vec::new();
    let mut k = 0;
    while k < soak_hits.len() {
        let t0 = soak_hits[k].0;
        let end = soak_hits[k..].iter().position(|h| h.0 - t0 > 600).map_or(soak_hits.len(), |p| k + p);
        let mut groups: Vec<Vec<(f32, f32)>> = Vec::new();
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for (_, x, y, g) in &soak_hits[k..end] {
            if !seen.insert(g.as_str()) {
                continue;
            }
            let (x, y) = (*x, *y);
            let c = |g: &Vec<(f32, f32)>| (g.iter().map(|p| p.0).sum::<f32>() / g.len() as f32, g.iter().map(|p| p.1).sum::<f32>() / g.len() as f32);
            match groups.iter_mut().find(|g| {
                let (cx, cy) = c(g);
                (cx - x).hypot(cy - y) <= 12.0
            }) {
                Some(g) => g.push((x, y)),
                None => groups.push(vec![(x, y)]),
            }
        }
        for g in groups {
            let n = g.len() as f32;
            let (cx, cy) = (g.iter().map(|p| p.0).sum::<f32>() / n, g.iter().map(|p| p.1).sum::<f32>() / n);
            out.extend(g.iter().map(|p| (p.0 - cx).hypot(p.1 - cy)));
            sizes.push(g.len() as u32);
        }
        k = end;
    }
    Ok((out, sizes))
}
