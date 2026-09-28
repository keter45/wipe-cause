//! Testa a análise ponta a ponta no log sintético (ver tests/fixtures/gen-fixture.mjs).

use std::path::PathBuf;
use wipe_core::{analyze_file, LogReport, RecapKind};

fn report() -> LogReport {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/twin-fangs.txt");
    analyze_file(&path, |_, _| {}).expect("fixture deve ser lida")
}

#[test]
fn header_and_pull_segmentation() {
    let r = report();
    assert_eq!(r.log_version, Some(22));
    assert!(r.advanced_logging);
    assert_eq!(r.pulls.len(), 3, "trash fora de encontro não vira pull");

    let numbers: Vec<u32> = r.pulls.iter().map(|p| p.pull_number).collect();
    assert_eq!(numbers, vec![1, 2, 3]);
    assert_eq!(r.pulls.iter().map(|p| p.success).collect::<Vec<_>>(), vec![false, false, true]);
    assert_eq!(r.pulls[0].encounter_name, "The Twin Fangs");
    assert_eq!(r.pulls[0].difficulty_name, "Heroic");
    assert_eq!(r.pulls[0].duration_ms, 150_000);
    assert!(!r.pulls[0].incomplete);
}

#[test]
fn boss_hp_at_wipe() {
    let r = report();
    let p1 = &r.pulls[0];
    let vex = p1.bosses.iter().find(|b| b.name == "Vexhul").expect("Vexhul é boss");
    assert_eq!(vex.npc_id, Some(257361));
    assert!((vex.hp_pct.unwrap() - 79.0).abs() < 0.01, "{:?}", vex.hp_pct);
    let ith = p1.bosses.iter().find(|b| b.name == "Ithraz").expect("Ithraz é boss");
    assert!((ith.hp_pct.unwrap() - 93.0).abs() < 0.01);
    assert!(p1.bosses.iter().all(|b| b.name != "Spawn of Vexhul"), "add não é boss");

    assert!(r.pulls[2].bosses.iter().all(|b| b.hp_pct == Some(0.0)));
}

#[test]
fn player_stats_include_pets_and_specs() {
    let r = report();
    let p1 = &r.pulls[0];
    let mage = p1.players.iter().find(|p| p.name == "Magozin-Azralon").unwrap();
    assert_eq!(mage.class.as_deref(), Some("Mage"));
    assert_eq!(mage.damage_done, 140 * 150_000 + 140 * 50_000, "dano do pet vai pro dono");
    assert!(p1.players.iter().all(|p| !p.name.starts_with("Pet")));

    let warrior = p1.players.iter().find(|p| p.name == "Tankão-Gallywix").unwrap();
    assert_eq!(warrior.role.as_deref(), Some("tank"));
    assert_eq!(warrior.damage_taken, 140 * 80_000, "swing conta uma vez (sem o _LANDED)");
    assert_eq!(warrior.defensives_used.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(), vec!["Shield Wall"]);

    let priest = p1.players.iter().find(|p| p.name == "Curandeira-Azralon").unwrap();
    assert_eq!(priest.healing_done, 140 * 80_000, "overheal descontado");
}

#[test]
fn death_recap_and_available_defensives() {
    let r = report();

    // pull 1: priest morre pro Vile Flood; Desperate Prayer (usado no pull 2) estava disponível
    let d = &r.pulls[0].deaths;
    assert_eq!(d.len(), 1);
    let priest = &d[0];
    assert_eq!(priest.name, "Curandeira-Azralon");
    assert_eq!(priest.t, 90_010);
    let kb = priest.killing_blow.as_ref().unwrap();
    assert_eq!(kb.spell_name, "Vile Flood");
    assert_eq!(kb.overkill, 150_000);
    assert_eq!(kb.hp_pct, Some(0.0));
    assert!(priest.recap.iter().any(|e| e.spell_name == "Toxic Fumes"));
    assert!(priest.recap.iter().all(|e| priest.t - e.t <= 15_000));
    let avail: Vec<&str> = priest.defensives_available.iter().map(|a| a.name.as_str()).collect();
    assert_eq!(avail, vec!["Desperate Prayer"]);
    assert!(!priest.used_health_potion);

    // pull 2: mage morre pro Corrosive Spit, tomou poção, Ice Block disponível
    let mage = &r.pulls[1].deaths[0];
    assert_eq!(mage.name, "Magozin-Azralon");
    assert!(mage.used_health_potion);
    assert!(!mage.used_healthstone);
    assert!(!mage.healthstone_known);
    assert_eq!(mage.defensives_available.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), vec!["Ice Block"]);
    assert!(mage.recap.iter().any(|e| e.kind == RecapKind::Heal && e.amount == 200_000));

    let warrior = r.pulls[1].players.iter().find(|p| p.name == "Tankão-Gallywix").unwrap();
    assert_eq!(warrior.healthstones, 1);
}

#[test]
fn enemy_spells_are_collected() {
    let r = report();
    let spells = &r.pulls[1].enemy_spells;
    let spit = spells.iter().find(|s| s.spell_id == 1291478).unwrap();
    assert_eq!(spit.hits_on_players, 3);
    assert_eq!(spit.sources, vec!["Spawn of Vexhul".to_string()]);
}
