//! COMBATANT_INFO -> talentos, itens e status do player.
//!
//! `COMBATANT_INFO,guid,faction,str,agi,sta,int,…stats…,armor,specID,[talentos],(pvp),[itens],[auras],…`
//! A quantidade de stats muda entre patches, então tudo é lido a partir da spec (o campo antes
//! da lista de talentos): os secundários ficam logo antes dela, na mesma ordem desde o 10.x.

use crate::report::{GearItem, Setup, SetupStats};
use crate::tokenizer::split_fields;

const SLOT_SHIRT: u8 = 3;
const SLOT_MAIN_HAND: u8 = 15;
const SLOT_OFF_HAND: u8 = 16;
const SLOT_TABARD: u8 = 17;

/// Itens de uma lista `[(…),(…)]` ou `(…)`, sem os delimitadores.
fn inner(s: &str) -> Vec<&str> {
    let s = s.trim();
    let s = s
        .strip_prefix(['[', '('])
        .and_then(|x| x.strip_suffix([']', ')']))
        .unwrap_or("");
    if s.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    split_fields(s, &mut out);
    out
}

fn n(s: Option<&&str>) -> u32 {
    s.and_then(|v| v.trim().parse().ok()).unwrap_or(0)
}

/// Spec e setup. `None` se a linha não tem a lista de talentos (formato desconhecido).
pub fn parse_combatant_info(f: &[&str]) -> Option<(Option<u32>, Setup)> {
    let talents_at = f.iter().position(|v| v.starts_with('['))?;
    let spec_at = talents_at.checked_sub(1)?;
    let spec = f[spec_at].parse::<u32>().ok();
    // do fim para o começo: armor, versDT, versHD, versDD, mastery, avoidance, hasteS, hasteR,
    // hasteM, leech, speed, critS, critR, critM
    let back = |k: usize| n(spec_at.checked_sub(k).and_then(|i| f.get(i)));
    let stats = SetupStats {
        strength: n(f.get(3)),
        agility: n(f.get(4)),
        stamina: n(f.get(5)),
        intellect: n(f.get(6)),
        crit: back(12),
        haste: back(7),
        mastery: back(5),
        versatility: back(4),
        leech: back(10),
        avoidance: back(6),
        speed: back(11),
    };

    let talents = inner(f[talents_at])
        .into_iter()
        .filter_map(|t| {
            let v = inner(t);
            let node = v.first()?.parse().ok()?;
            Some([node, n(v.get(1)), n(v.get(2))])
        })
        .collect();

    // depois dos talentos vem (pvp) e então [itens]
    let items: Vec<GearItem> = f
        .get(talents_at + 1..)
        .and_then(|rest| rest.iter().find(|v| v.starts_with('[')))
        .map(|list| {
            inner(list)
                .into_iter()
                .enumerate()
                .filter_map(|(slot, it)| {
                    let v = inner(it);
                    let item_id = n(v.first());
                    (item_id != 0).then(|| {
                        let enchant = inner(v.get(2).unwrap_or(&"()"))
                            .first()
                            .and_then(|e| e.parse().ok())
                            .filter(|&e| e != 0);
                        // gemas: pares (id, ilvl)
                        let gems = inner(v.get(4).unwrap_or(&"()"))
                            .iter()
                            .step_by(2)
                            .filter_map(|g| g.parse().ok())
                            .filter(|&g| g != 0)
                            .collect();
                        GearItem {
                            slot: slot as u8,
                            item_id,
                            ilvl: n(v.get(1)),
                            enchant,
                            gems,
                        }
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Some((
        spec,
        Setup {
            stats,
            item_level: item_level(&items),
            items,
            talents,
        },
    ))
}

/// Média como o jogo mostra: 16 espaços; arma de duas mãos (sem mão secundária) conta duas vezes.
pub(crate) fn item_level(items: &[GearItem]) -> f32 {
    let counted: Vec<&GearItem> = items
        .iter()
        .filter(|i| i.slot != SLOT_SHIRT && i.slot != SLOT_TABARD && i.ilvl > 0)
        .collect();
    if counted.is_empty() {
        return 0.0;
    }
    let mut total: u32 = counted.iter().map(|i| i.ilvl).sum();
    let two_hander = !counted.iter().any(|i| i.slot == SLOT_OFF_HAND);
    if two_hander {
        total += counted
            .iter()
            .find(|i| i.slot == SLOT_MAIN_HAND)
            .map_or(0, |i| i.ilvl);
    }
    total as f32 / 16.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_stats_talents_and_gear() {
        let line = "COMBATANT_INFO,Player-1-0A,0,375,2390,42099,526,0,0,0,0,1624,1624,1624,64,166,335,335,335,56,1077,336,336,336,1590,254,\
[(94958,117555,1),(102384,126447,2)],(0,0,0,0),\
[(271492,321,(8017,0,0),(6652,13696),()),(268265,334,(),(6652,12854),(240967,295,240914,295)),(0,0,(),(),()),(0,0,(),(),()),\
(271495,334,(7987,0,0),(13334),()),(1,300,(),(),()),(1,300,(),(),()),(1,300,(),(),()),(1,300,(),(),()),(1,300,(),(),()),\
(1,300,(),(),()),(1,300,(),(),()),(1,300,(),(),()),(1,300,(),(),()),(1,300,(),(),()),(268207,334,(8689,8052,0),(6652),()),\
(0,0,(),(),()),(0,0,(),(),())],[Player-1-0A,1303171,1],8,0,0,0";
        let mut f = Vec::new();
        split_fields(line, &mut f);
        let (spec, s) = parse_combatant_info(&f).expect("setup");
        assert_eq!(spec, Some(254));
        assert_eq!(
            (
                s.stats.agility,
                s.stats.crit,
                s.stats.haste,
                s.stats.mastery,
                s.stats.versatility
            ),
            (2390, 1624, 335, 1077, 336)
        );
        assert_eq!(
            (s.stats.leech, s.stats.speed, s.stats.avoidance),
            (166, 64, 56)
        );
        assert_eq!(s.talents, vec![[94958, 117555, 1], [102384, 126447, 2]]);
        assert_eq!(s.items.len(), 14, "slots vazios ficam de fora");
        assert_eq!(s.items[0].enchant, Some(8017));
        assert_eq!(s.items[1].gems, vec![240967, 240914]);
        // 321+334+334+10*300+334*2 (duas mãos) = 4657 / 16
        assert!(
            (s.item_level - 4657.0 / 16.0).abs() < 0.01,
            "{}",
            s.item_level
        );
    }
}
