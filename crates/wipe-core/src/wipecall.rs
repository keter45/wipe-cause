//! Call de wipe: a partir de um desastre (tank morto sem battle rez, uma mecânica que matou metade,
//! várias mortes seguidas), o grupo decide que não vale continuar e o resto morre de propósito:
//! para de jogar, fica no chão, sai da plataforma. O que acontece depois não é erro de ninguém.
//!
//! O sinal mais firme é quem morreu parado: sem castar nada há alguns segundos. Numa call, o último
//! cast desses players cai quase no mesmo instante (todos param juntos); num desastre de verdade
//! (Gloombomb parado em cima de todo mundo, uma explosão), quem morre estava jogando. Calibrado
//! nas tries de 14 e 15/10 do Coiled Altar: numa call, 5 a 12 players param numa janela de ~10s;
//! nos wipes de mecânica (Eternal Nightfall, Venom Rupture), no máximo 1.

use crate::report::{WipeCall, WipeCallTrigger};

/// Parado há pelo menos isso ao morrer = desistiu (ninguém fica tanto tempo sem castar lutando).
const GIVE_UP_MS: i64 = 6_000;
/// Os últimos casts de quem desistiu caem dentro disso: pararam juntos.
const STOP_WINDOW_MS: i64 = 12_000;
/// Quantos pararam juntos: call certa / possível (raid de 20: 5 / 3).
const CERTAIN_SHARE: f32 = 0.25;
const CERTAIN_MIN: usize = 4;
const POSSIBLE_SHARE: f32 = 0.15;
const POSSIBLE_MIN: usize = 3;
/// O gatilho é procurado até isso antes da call.
const TRIGGER_BACK_MS: i64 = 30_000;
/// Mass wipe de uma mecânica: tantas mortes dentro disso (o mesmo do app).
const MASS_MIN: usize = 6;
const MASS_WINDOW_MS: i64 = 1_500;
/// "Várias mortes seguidas": tantas nos últimos MANY_BACK_MS antes da call.
const MANY_MIN: usize = 3;
const MANY_BACK_MS: i64 = 20_000;

/// Uma morte do pull, com o que a detecção precisa.
pub struct DeathInfo<'a> {
    pub t: i64,
    pub guid: &'a str,
    pub name: &'a str,
    pub tank: bool,
    /// ms sem castar nada ao morrer (None = nunca castou)
    pub idle_ms: Option<i64>,
    /// o que matou (nome, spell)
    pub killer: Option<(&'a str, u32)>,
    /// morreu de queda/ambiente (sair da plataforma)
    pub environment: bool,
}

/// A call manda no corte? Certa: sempre (no lugar do "ignorar após N mortes", que é só um número:
/// tem try que segue lutando depois de N mortes e tem try chamada com uma). Possível: só se vier
/// antes do corte por mortes.
pub fn applies(call: &WipeCall, cutoff_t: Option<i64>) -> bool {
    cutoff_t != Some(call.t) && (call.confidence == "certain" || cutoff_t.is_none_or(|cut| call.t < cut))
}

/// A call da primeira leitura, com o gatilho da releitura (cortada nela) quando ela achou um: com o
/// corte por mortes, a primeira leitura para de registrar as falhas de mecânica cedo demais.
pub fn reread(call: WipeCall, again: Option<WipeCall>) -> WipeCall {
    let trigger = again.and_then(|c| c.trigger).or(call.trigger.clone());
    WipeCall { trigger, ..call }
}

/// Falha grave do raid (interrupt, soak, enrage, colisão...): quando e o que foi.
pub struct Failure<'a> {
    pub t: i64,
    pub name: &'a str,
    pub spell_id: Option<u32>,
}

/// Call de wipe do pull (`deaths` em ordem de tempo; `rezzes`: (t, guid) de cada ressurreição;
/// `failures`: falhas graves do raid, candidatas a gatilho).
pub fn detect(deaths: &[DeathInfo], raid: usize, rezzes: &[(i64, &str)], failures: &[Failure]) -> Option<WipeCall> {
    let certain = CERTAIN_MIN.max((raid as f32 * CERTAIN_SHARE).ceil() as usize);
    let possible = POSSIBLE_MIN.max((raid as f32 * POSSIBLE_SHARE).ceil() as usize);
    // quando cada um que desistiu parou de jogar (queda da plataforma: na hora)
    let mut stops: Vec<i64> = deaths
        .iter()
        .filter_map(|d| match d.idle_ms {
            Some(idle) if idle >= GIVE_UP_MS => Some(d.t - idle),
            _ if d.environment => Some(d.t),
            _ => None,
        })
        .collect();
    stops.sort_unstable();
    let window = |i: usize| stops[i..].iter().take_while(|&&s| s - stops[i] <= STOP_WINDOW_MS).count();
    // a primeira janela com gente bastante para ter certeza; senão, a primeira possível
    let pick = |min: usize| (0..stops.len()).find(|&i| window(i) >= min);
    let (start, confidence) = match pick(certain) {
        Some(i) => (i, "certain"),
        None => (pick(possible)?, "possible"),
    };
    let n = window(start);
    // a call: quando o grosso parou (o primeiro quartil; um ou outro para um pouco antes)
    let mut t = stops[start + n / 4];
    let trigger = trigger(deaths, rezzes, failures, t);
    // a call nunca vem antes do desastre que a provocou: quem morreu nele conta
    if let Some(m) = trigger.as_ref().filter(|m| m.kind == "mass") {
        t = t.max(m.t + MASS_WINDOW_MS);
    }
    Some(WipeCall { t, confidence: confidence.into(), stopped: n as u32, trigger })
}

/// O que levou à call: a mecânica que matou muita gente junto, o tank que morreu ou uma falha
/// grave do raid (o mais recente); sem nenhum, várias mortes seguidas.
fn trigger(deaths: &[DeathInfo], rezzes: &[(i64, &str)], failures: &[Failure], call: i64) -> Option<WipeCallTrigger> {
    let recent: Vec<&DeathInfo> = deaths.iter().filter(|d| d.t <= call + MASS_WINDOW_MS && call - d.t <= TRIGGER_BACK_MS).collect();
    let mut mass: Option<WipeCallTrigger> = None;
    for (i, d) in recent.iter().enumerate() {
        let group: Vec<&&DeathInfo> = recent[i..].iter().take_while(|x| x.t - d.t <= MASS_WINDOW_MS).collect();
        if group.len() >= MASS_MIN && mass.as_ref().is_none_or(|m| d.t > m.t + MASS_WINDOW_MS) {
            // o que mais matou no grupo
            let mut by: Vec<((&str, u32), u32)> = Vec::new();
            for k in group.iter().filter_map(|x| x.killer) {
                match by.iter_mut().find(|(b, _)| *b == k) {
                    Some(e) => e.1 += 1,
                    None => by.push((k, 1)),
                }
            }
            // empate: o que matou primeiro
            let top = by.iter().fold(None::<&((&str, u32), u32)>, |b, e| if b.is_none_or(|b| e.1 > b.1) { Some(e) } else { b }).map(|e| e.0);
            mass = Some(WipeCallTrigger {
                kind: "mass".into(),
                t: d.t,
                name: None,
                spell: top.map(|k| k.0.to_string()),
                spell_id: top.map(|k| k.1),
                deaths: group.len() as u32,
                no_rez: false,
            });
        }
    }
    // tank morto (mesmo se voltou: perder o tank costuma ser o que faz a raid desistir)
    let tank = recent.iter().filter(|d| d.tank && d.t <= call).max_by_key(|d| d.t).map(|d| WipeCallTrigger {
        kind: "tank".into(),
        t: d.t,
        name: Some(d.name.to_string()),
        spell: d.killer.map(|k| k.0.to_string()),
        spell_id: d.killer.map(|k| k.1),
        deaths: 1,
        no_rez: !rezzes.iter().any(|&(rt, g)| g == d.guid && rt > d.t && rt <= call),
    });
    // só antes da call: depois dela ninguém mais corta nem soaka (é consequência, não causa)
    let mechanic = failures.iter().filter(|f| f.t <= call && call - f.t <= TRIGGER_BACK_MS).max_by_key(|f| f.t).map(|f| WipeCallTrigger {
        kind: "mechanic".into(),
        t: f.t,
        name: None,
        spell: Some(f.name.to_string()),
        spell_id: f.spell_id,
        deaths: 0,
        no_rez: false,
    });
    // o mais recente; empate (no mesmo segundo) entre a morte em massa e o que a causou: a morte em massa
    let best = [mass, tank, mechanic].into_iter().flatten().max_by_key(|x| (x.t / 1_000, x.kind == "mass"));
    best.or_else(|| {
        let many: Vec<&&DeathInfo> = recent.iter().filter(|d| d.t <= call && call - d.t <= MANY_BACK_MS).collect();
        (many.len() >= MANY_MIN).then(|| WipeCallTrigger { kind: "deaths".into(), t: many[0].t, name: None, spell: None, spell_id: None, deaths: many.len() as u32, no_rez: false })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(t: i64, name: &'static str, idle: i64) -> DeathInfo<'static> {
        DeathInfo { t, guid: name, name, tank: false, idle_ms: Some(idle), killer: Some(("Dreadful Presence", 1)), environment: false }
    }

    #[test]
    fn many_players_stopping_together_is_a_certain_call() {
        // pull 20 de 15/10: o tank morre aos 5:27.9 e dez players param entre 5:15 e 5:19
        let mut deaths = vec![DeathInfo { tank: true, killer: Some(("Gravebound", 2)), ..d(327_900, "Tank", 1_000) }];
        for (i, stop) in [317_900, 315_400, 318_400, 318_600, 318_200, 318_600, 318_500, 318_200, 317_000, 319_300].into_iter().enumerate() {
            let t = 325_000 + i as i64 * 1_300;
            deaths.push(d(t, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"][i], t - stop));
        }
        deaths.sort_by_key(|x| x.t);
        let call = detect(&deaths, 20, &[], &[]).expect("call");
        assert_eq!((call.confidence.as_str(), call.stopped), ("certain", 10));
        assert!((317_000..=318_400).contains(&call.t), "{}", call.t);
    }

    #[test]
    fn one_mechanic_killing_everyone_at_once_is_not_a_call() {
        // pull 3 de 15/10: Eternal Nightfall mata 13 no mesmo instante, todos jogando
        let deaths: Vec<DeathInfo> = (0..13).map(|i| DeathInfo { killer: Some(("Eternal Nightfall", 3)), ..d(251_100, "X", 300 + i * 200) }).collect();
        assert!(detect(&deaths, 20, &[], &[]).is_none());
    }

    #[test]
    fn few_stopping_together_is_only_possible() {
        let deaths = vec![d(247_700, "A", 9_300), d(255_400, "B", 7_900), d(255_400, "C", 15_400)];
        assert_eq!(detect(&deaths, 20, &[], &[]).unwrap().confidence, "possible");
    }

    #[test]
    fn trigger_is_the_tank_that_did_not_come_back() {
        let mut deaths = vec![DeathInfo { tank: true, killer: Some(("Gravebound", 2)), ..d(226_600, "Reidane", 500) }];
        deaths.extend((0..6).map(|i| d(240_000 + i * 1_000, ["A", "B", "C", "D", "E", "F"][i as usize], 7_000 + i * 1_000)));
        let call = detect(&deaths, 20, &[], &[]).unwrap();
        let tr = call.trigger.expect("trigger");
        assert_eq!((tr.kind.as_str(), tr.name.as_deref()), ("tank", Some("Reidane")));
        assert!(tr.no_rez);
        // com battle rez antes da call, o tank ainda é o gatilho, mas voltou
        let tr = detect(&deaths, 20, &[(230_000, "Reidane")], &[]).unwrap().trigger.unwrap();
        assert_eq!((tr.kind.as_str(), tr.no_rez), ("tank", false));
    }

    #[test]
    fn mass_death_before_the_call_is_the_trigger() {
        // pull 13 de 15/10: Venom Rupture mata 7 aos 2:42.7 e o resto desiste
        let mut deaths: Vec<DeathInfo> = (0..7).map(|i| DeathInfo { killer: Some(("Venom Rupture", 4)), ..d(162_700 + i * 20, "M", 400) }).collect();
        deaths.extend((0..6).map(|i| d(176_400 + i * 1_200, ["A", "B", "C", "D", "E", "F"][i as usize], 8_000 + i * 900)));
        let tr = detect(&deaths, 20, &[], &[]).unwrap().trigger.unwrap();
        assert_eq!((tr.kind.as_str(), tr.spell.as_deref(), tr.deaths), ("mass", Some("Venom Rupture"), 7));
    }

    #[test]
    fn the_call_never_comes_before_the_mass_death_that_caused_it() {
        // pull 4 de 15/10: alguns param aos 2:12.4, um instante antes de o Guillotine matar 11 (2:13.2)
        let mut deaths: Vec<DeathInfo> = (0..11).map(|i| DeathInfo { killer: Some(("Execution", 5)), ..d(133_200 + i * 30, "M", 300) }).collect();
        for (i, stop) in [132_400, 132_500, 135_300, 138_100].into_iter().enumerate() {
            let t = 142_600 + i as i64 * 4_000;
            deaths.push(d(t, ["A", "B", "C", "D"][i], t - stop));
        }
        let call = detect(&deaths, 20, &[], &[]).unwrap();
        assert!(call.t > 133_200, "{}", call.t);
    }

    #[test]
    fn a_raid_failure_before_the_call_is_the_trigger() {
        // pull 5 de 15/10: três Wail of Terror passam (medo no raid) e o grupo desiste
        let deaths: Vec<DeathInfo> = (0..6).map(|i| d(395_000 + i * 2_000, ["A", "B", "C", "D", "E", "F"][i as usize], 4_000 + i * 2_000)).collect();
        let fails = [Failure { t: 364_900, name: "Wail of Terror", spell_id: Some(9) }, Failure { t: 378_900, name: "Wail of Terror", spell_id: Some(9) }];
        let tr = detect(&deaths, 20, &[], &fails).unwrap().trigger.unwrap();
        assert_eq!((tr.kind.as_str(), tr.spell.as_deref(), tr.t), ("mechanic", Some("Wail of Terror"), 378_900));
    }
}
