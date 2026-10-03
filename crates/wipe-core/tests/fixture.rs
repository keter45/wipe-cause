//! Testa a análise ponta a ponta no log sintético (ver tests/fixtures/gen-fixture.mjs).

use std::path::PathBuf;
use wipe_core::{analyze_file, AnalyzeOptions, LogReport, RecapKind};

fn report_with(death_cutoff: u32) -> LogReport {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/twin-fangs.txt");
    analyze_file(&path, &AnalyzeOptions { death_cutoff, ..Default::default() }, |_, _| {}).expect("fixture deve ser lida")
}

fn report() -> LogReport {
    report_with(0)
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
    let spit = spells.iter().find(|s| s.spell_id == 1293295).unwrap();
    assert_eq!(spit.hits_on_players, 3);
    assert_eq!(spit.sources, vec!["Spawn of Vexhul".to_string()]);
}

#[test]
fn boss_rules_are_applied() {
    let r = report();
    let p1 = &r.pulls[0];
    assert!(p1.rules_file.as_deref().unwrap().ends_with("the-twin-fangs.yaml"));

    // Vile Flood: priest pegou 2 hits do feixe (dano evitável)
    let vf = p1.mechanics.iter().find(|m| m.key == "vile_flood").unwrap();
    assert_eq!(vf.failures, 2);
    assert_eq!(vf.spell_id, Some(1294605), "ícone da mecânica = spell de dano");
    assert_eq!(vf.players[0].name, "Curandeira-Azralon");
    assert_eq!(vf.players[0].message, "Curandeira foi atingido pelo feixe do Vile Flood (2x)");
    // a morte fica ligada à mecânica
    assert_eq!(p1.deaths[0].killing_blow_mechanic.as_deref(), Some("Vile Flood"));

    // Corrosive Spit: o 1º hit de cada rajada é o alvo; só o 3º (1s depois do 2º) é erro
    let p2 = &r.pulls[1];
    let spit = p2.mechanics.iter().find(|m| m.key == "corrosive_spit").unwrap();
    assert_eq!(spit.failures, 1);

    // mecânicas sem falha vêm depois das com falha
    let first_clean = p1.mechanics.iter().position(|m| m.failures == 0).unwrap();
    assert!(p1.mechanics[..first_clean].iter().all(|m| m.failures > 0));
    assert!(r.rule_errors.is_empty());
}

#[test]
fn short_pulls_are_ignored() {
    let r = report();
    assert_eq!(r.ignored_short_pulls, 1);
    assert_eq!(r.pulls.len(), 3);
    assert_eq!(r.pulls.iter().map(|p| p.pull_number).collect::<Vec<_>>(), vec![1, 2, 3]);
    assert_eq!(r.pulls.iter().map(|p| p.id).collect::<Vec<_>>(), vec![0, 1, 2]);
    // o pull curto (o 3º do log) some da lista, mas conta na numeração do Warcraft Logs
    assert_eq!(r.pulls.iter().map(|p| p.pull_number_all).collect::<Vec<_>>(), vec![1, 2, 4]);
}

#[test]
fn classifies_spike_and_slow_deaths() {
    let r = report();
    // priest: 85% -> 0 em 4s, com o maior HP dos 3s finais em 85%
    let priest = &r.pulls[0].deaths[0];
    assert_eq!(priest.death_kind, "spike");
    assert!(priest.stats.max_hp_pct_last_3s.unwrap() >= 60.0);

    // warrior: 14s abaixo de 50% sem nenhuma cura
    let warrior = r.pulls[1].deaths.iter().find(|d| d.name == "Tankão-Gallywix").unwrap();
    assert_eq!(warrior.death_kind, "slow");
    assert_eq!(warrior.stats.below_half_ms, Some(14_010));
    assert_eq!(warrior.stats.healing_received_10s, 0);
    assert!(warrior.stats.underhealed);
    assert!(warrior.caused_by.is_none(), "Toxic Fumes é inevitável: não é falha de mecânica");
}

#[test]
fn death_snapshot_has_debuffs_with_stacks() {
    let r = report();
    let mage = r.pulls[1].deaths.iter().find(|d| d.name == "Magozin-Azralon").unwrap();
    let venom = mage.debuffs.iter().find(|d| d.spell_id == 1290336).expect("Eternal Venom na morte");
    assert_eq!(venom.stacks, 3);
    assert_eq!(venom.mechanic.as_deref(), Some("Eternal Venom"));
    assert!(venom.tip.is_some());
    assert!(mage.recap.iter().any(|e| e.kind == RecapKind::Debuff && e.spell_name == "Eternal Venom (3)"));
}

#[test]
fn tracks_interrupts_per_player() {
    let r = report();
    let p2 = &r.pulls[1];
    let mage = p2.players.iter().find(|p| p.name == "Magozin-Azralon").unwrap();
    assert_eq!((mage.interrupts, mage.interrupt_attempts), (1, 1));
    assert_eq!(mage.interrupt_log[0].target_spell.as_deref(), Some("Visceral Burst"));
    assert_eq!(mage.interrupt_log[0].spell_id, 2139, "Counterspell");
    assert!(mage.can_interrupt);
    let priest = p2.players.iter().find(|p| p.name == "Curandeira-Azralon").unwrap();
    assert!(!priest.can_interrupt, "disc priest não tem interrupt");
    let warrior = p2.players.iter().find(|p| p.name == "Tankão-Gallywix").unwrap();
    assert!(warrior.can_interrupt && warrior.interrupts == 0, "prot warrior podia (Pummel) e não cortou");

    let burst = p2.enemy_spells.iter().find(|e| e.spell_id == 1308385).unwrap();
    assert_eq!((burst.casts, burst.interrupted), (1, 1));
    assert_eq!(burst.name, "Visceral Burst");
    assert!(burst.sources.contains(&"Broodling of Ithraz".to_string()));
    assert!(burst.interruptible);
}

#[test]
fn deaths_are_linked_to_failed_mechanics() {
    let r = report();
    let priest = &r.pulls[0].deaths[0];
    let cause = priest.caused_by.as_ref().expect("Vile Flood causou a morte");
    assert_eq!(cause.key, "vile_flood");
    assert!(cause.pct > 80.0, "{}", cause.pct);
    let trigger = r.pulls[0].trigger.as_ref().unwrap();
    assert_eq!((trigger.key.as_str(), trigger.deaths), ("vile_flood", 1));
}

#[test]
fn death_cutoff_freezes_every_stat() {
    let full = report();
    let cut = report_with(1); // ignora tudo depois da 1ª morte de cada pull
    assert_eq!(cut.death_cutoff, 1);

    // pull 1: priest morre aos 1:30 — dano do mage (e do pet) só até ali
    let p1 = &cut.pulls[0];
    assert_eq!(p1.cutoff_t, Some(90_010));
    assert_eq!(p1.analyzed_ms, 90_010);
    assert_eq!(p1.duration_ms, 150_000, "a duração real do pull continua");
    let mage = p1.players.iter().find(|p| p.name == "Magozin-Azralon").unwrap();
    // fireball aos 1..90s; a mordida do pet dos 90,2s já é depois do corte (90,01s)
    assert_eq!(mage.damage_done, 90 * 150_000 + 89 * 50_000);
    assert!((mage.dps - mage.damage_done as f64 / 90.01).abs() < 1.0, "DPS sobre o tempo até o corte");
    let vex = p1.bosses.iter().find(|b| b.name == "Vexhul").unwrap();
    assert!((vex.hp_pct_at_cutoff.unwrap() - 86.5).abs() < 0.01);
    assert!((vex.hp_pct.unwrap() - 79.0).abs() < 0.01, "HP no fim do pull continua");

    // pull 2: mage morre aos 0:45; a morte do warrior (0:58) fica registrada mas ignorada
    let p2 = &cut.pulls[1];
    let wdeath = p2.deaths.iter().find(|d| d.name == "Tankão-Gallywix").unwrap();
    assert!(wdeath.ignored);
    assert!(!wdeath.recap.is_empty(), "recap das mortes ignoradas continua disponível");
    let warrior = p2.players.iter().find(|p| p.name == "Tankão-Gallywix").unwrap();
    assert_eq!(warrior.deaths, 0);
    assert_eq!(warrior.damage_taken, 8 * 100_000, "só os ticks de Toxic Fumes até 0:45");
    assert_eq!(warrior.healthstones, 1, "healthstone aos 0:20 conta");
    let fumes_full = full.pulls[1].enemy_spells.iter().find(|e| e.spell_id == 1294976).unwrap();
    let fumes_cut = p2.enemy_spells.iter().find(|e| e.spell_id == 1294976).unwrap();
    assert_eq!((fumes_full.hits_on_players, fumes_cut.hits_on_players), (15, 8));

    // sem corte, nada muda
    assert!(full.pulls.iter().all(|p| p.cutoff_t.is_none() && p.analyzed_ms == p.duration_ms));
    assert!(full.pulls.iter().flat_map(|p| &p.deaths).all(|d| !d.ignored));
}

#[test]
fn deaths_carry_positions_until_the_cutoff() {
    let r = report_with(1);
    let p = r.pulls.iter().find(|p| p.deaths.len() >= 2).expect("pull com 2+ mortes");
    let first = &p.deaths[0];
    let snap = first.positions.as_ref().expect("morte antes do corte tem foto das posições");
    assert_eq!(snap.t, first.t);
    let me = snap.units.iter().find(|u| u.guid == first.guid).expect("quem morreu está na foto");
    assert_eq!(me.kind, "player");
    assert!(me.age_ms <= 5_000);
    assert!(snap.units.iter().any(|u| u.kind == "enemy"), "boss na foto");
    // depois do corte a morte não guarda posições
    assert!(p.deaths[1..].iter().all(|d| d.ignored && d.positions.is_none()));
}

#[test]
fn performance_data_casts_setup_and_alive_time() {
    let r = report();
    let p1 = &r.pulls[0];
    let priest = p1.players.iter().find(|p| p.name == "Curandeira-Azralon").unwrap();
    assert_eq!(priest.alive_ms, 90_010, "tempo vivo acaba na morte");
    let warrior = p1.players.iter().find(|p| p.name == "Tankão-Gallywix").unwrap();
    assert_eq!(warrior.alive_ms, p1.analyzed_ms);
    let wall = warrior.casts.iter().find(|c| c.name == "Shield Wall").expect("cast do defensivo registrado");
    assert_eq!(wall.times.len(), 1);
    assert!(warrior.damage_by_spell.iter().all(|s| s.amount > 0));

    let setup = warrior.setup.as_ref().expect("COMBATANT_INFO vira setup");
    assert_eq!(setup.talents, vec![[1, 2, 1], [3, 4, 1]]);
    assert_eq!(setup.items.len(), 1);
    assert_eq!(setup.items[0].ilvl, 639);

    let mage = p1.players.iter().find(|p| p.name == "Magozin-Azralon").unwrap();
    assert!(mage.damage_by_spell.iter().any(|s| s.pet), "dano do pet aparece separado");
}

#[test]
fn log_owner_and_damage_timeline() {
    let r = report();
    let p1 = &r.pulls[0];
    let mage = p1.players.iter().find(|p| p.name == "Magozin-Azralon").unwrap();
    // o mago grava o log (flag 0x511): o modo solo abre nele
    assert_eq!(p1.owner_guid.as_deref(), Some(mage.guid.as_str()));
    // dano em janelas de 5s até o fim do tempo analisado, somando o pet
    assert_eq!(mage.damage_timeline.len() as i64, (p1.analyzed_ms + 4_999) / 5_000);
    assert_eq!(mage.damage_timeline.iter().sum::<i64>(), mage.damage_done);
    let priest = p1.players.iter().find(|p| p.name == "Curandeira-Azralon").unwrap();
    assert_eq!(priest.healing_timeline.iter().sum::<i64>(), priest.healing_done);
}
