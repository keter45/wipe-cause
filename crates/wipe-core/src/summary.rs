//! Resumo de uma análise para o histórico (título, boss principal, melhor tentativa). Fica no
//! núcleo para o app e o site salvarem do mesmo jeito.

use crate::i18n::pick;
use crate::LogReport;
use std::collections::HashMap;

/// O app é para raid: log só de masmorra (M+) não entra no histórico.
pub fn has_raid(report: &LogReport) -> bool {
    report.pulls.iter().any(|p| !p.dungeon)
}

/// "24/09 · The Twin Fangs Mythic +1": data do 1º pull + boss de raid com mais pulls (masmorras
/// só entram no título se o log não tiver raid).
pub fn title_of(report: &LogReport) -> String {
    let Some(first) = report.pulls.first() else { return pick("Log sem pulls", "Log without pulls") };
    let date = first.start_local.split(' ').next().unwrap_or("");
    let mut parts = date.split('/');
    let (m, d) = (parts.next().unwrap_or("?"), parts.next().unwrap_or("?"));
    let raid: Vec<_> = report.pulls.iter().filter(|p| !p.dungeon).collect();
    let pulls = if raid.is_empty() { report.pulls.iter().collect() } else { raid };
    let mut count: HashMap<String, usize> = HashMap::new();
    for p in pulls {
        *count.entry(format!("{} {}", p.encounter_name, p.difficulty_name)).or_default() += 1;
    }
    let mut ranked: Vec<(String, usize)> = count.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let others = ranked.len().saturating_sub(1);
    let main = &ranked[0].0;
    format!("{d:0>2}/{m:0>2} · {main}{}", if others > 0 { format!(" +{others}") } else { String::new() })
}

/// Encontro do título: o boss de raid com mais pulls (masmorra só se não houver raid).
pub fn main_encounter(report: &LogReport) -> Option<u32> {
    let raid: Vec<_> = report.pulls.iter().filter(|p| !p.dungeon).collect();
    let pulls = if raid.is_empty() { report.pulls.iter().collect() } else { raid };
    let mut count: HashMap<u32, usize> = HashMap::new();
    for p in pulls {
        *count.entry(p.encounter_id).or_default() += 1;
    }
    count.into_iter().max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0))).map(|(id, _)| id)
}

/// Menor HP de boss entre os wipes (0-100), no corte de mortes quando houve corte.
pub fn best_hp(report: &LogReport) -> Option<f32> {
    report
        .pulls
        .iter()
        .filter(|p| !p.success)
        .filter_map(|p| {
            p.bosses
                .iter()
                .filter_map(|b| if p.cutoff_t.is_some() { b.hp_pct_at_cutoff.or(b.hp_pct) } else { b.hp_pct })
                .reduce(f32::min)
        })
        .reduce(f32::min)
}
