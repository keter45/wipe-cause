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

/// Vida do boss no fim do wipe (no corte, se houve) e a fase em que ele acabou ("P2"; None na
/// primeira): como `lowestBossHp` e `reachedPhase` do app. Boss de várias fases: a vida dos bosses
/// da fase; análise sem ela, o menor entre os bosses ainda vivos (o da P1 já morreu).
fn wipe_progress(p: &crate::report::Pull) -> Option<(f32, Option<String>, usize)> {
    let marks: Vec<&crate::report::PhaseMark> = p.phase_marks.iter().filter(|m| p.cutoff_t.is_none_or(|c| m.t <= c)).collect();
    let phase = (marks.len() >= 2).then(|| {
        let key = &marks[marks.len() - 1].key;
        match key.strip_prefix('p').filter(|n| n.chars().all(|c| c.is_ascii_digit()) && !n.is_empty()) {
            Some(n) => format!("P{n}"),
            None => {
                let mut c = key.chars();
                c.next().map(|f| format!("{}{}.", f.to_uppercase(), c.take(2).collect::<String>())).unwrap_or_default()
            }
        }
    });
    let hps: Vec<f32> = p.bosses.iter().filter_map(|b| if p.cutoff_t.is_some() { b.hp_pct_at_cutoff.or(b.hp_pct) } else { b.hp_pct }).collect();
    let by_phase = if p.cutoff_t.is_some() { p.phase_hp_pct_at_cutoff.or(p.phase_hp_pct) } else { p.phase_hp_pct };
    let alive = || hps.iter().copied().filter(|&h| h > 0.1).reduce(f32::min);
    // passou da primeira fase sem a vida dela (análise antiga) e sem boss vivo na lista: desconhecida
    let hp = match (by_phase, &phase) {
        (Some(h), _) => h,
        (None, Some(_)) => alive()?,
        (None, None) => hps.iter().copied().reduce(f32::min)?,
    };
    Some((hp, phase, marks.len().max(1) - 1))
}

/// O wipe que mais avançou (fase, depois vida): (vida 0-100, fase em que acabou).
pub fn best_wipe(report: &LogReport) -> Option<(f32, Option<String>)> {
    report
        .pulls
        .iter()
        .filter(|p| !p.success)
        .filter_map(wipe_progress)
        .max_by(|a, b| a.2.cmp(&b.2).then(b.0.total_cmp(&a.0)))
        .map(|(hp, phase, _)| (hp, phase))
}

/// Vida do boss no wipe que mais avançou (0-100), no corte de mortes quando houve corte.
pub fn best_hp(report: &LogReport) -> Option<f32> {
    best_wipe(report).map(|b| b.0)
}

/// Fase em que acabou o wipe que mais avançou ("P2"), quando passou da primeira.
pub fn best_phase(report: &LogReport) -> Option<String> {
    best_wipe(report).and_then(|b| b.1)
}
