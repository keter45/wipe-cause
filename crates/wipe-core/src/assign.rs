//! Atribuição por posição: alvos que nascem em lugares fixos da sala e grupos de players que
//! precisam ir cada um no seu, por uma prioridade combinada (a Gloombomb do Coiled Altar: os 2
//! rangeds e os 2 melees com a bomba vão cada par num add, pelo canto em que ele nasceu).
//!
//! O que o log mostra (Coiled Altar Mythic, 7 noites de 14 a 26/10/2026, 215 levas, 432 adds):
//! - os alvos nascem num SPELL_SUMMON; o primeiro lugar deles é o do primeiro evento com posição
//!   (o cast do Spirit Shield em si mesmo, 30 ms depois), sempre num dos lugares da regra;
//! - a aura dos portadores entra em todos no mesmo instante e explode quando sai; não há dano no
//!   alvo: no mesmo ms ele perde 1 stack da aura dele (REMOVED_DOSE) por portador no alcance;
//! - as stacks iniciais da aura do alvo vêm como vários APPLIED seguidos;
//! - o alvo anda até a explosão (~12 jd no Coiled Altar): a distância usa onde ele estava na hora.
//!
//! Quando os grupos trocam de alvo, os dois perdem as stacks do mesmo jeito: estar longe do alvo
//! designado só é erro quando a aura dele fica. Cada grupo cujo alvo ficou com a aura é uma falha,
//! e o culpado é quem do grupo estava vivo e fora do alcance na explosão.

use crate::i18n::Text;
use crate::orbs::pos_at;
use crate::report::AssignSummary;
use serde::Deserialize;
use std::collections::HashMap;

/// Aplicações da aura dos portadores a menos disso uma da outra são a mesma leva.
const WAVE_GAP_MS: i64 = 1_000;
/// Alvos invocados a menos disso um do outro são da mesma leva.
const SAME_SUMMON_MS: i64 = 500;
/// Alvo a mais disso de todos os lugares da regra: a leva não é julgada.
const SPOT_YD: f32 = 5.0;
/// A aura do alvo é conferida tanto depois da última explosão do grupo.
const SHIELD_CHECK_MS: i64 = 300;
/// Portador que morreu até tanto depois de perder a aura morreu com ela (a aura sai na morte).
const DEATH_SLACK_MS: i64 = 50;
/// A posição do portador na explosão: o dano da própria bomba chega até tanto depois.
const PLAYER_POS_AFTER_MS: i64 = 30;

#[derive(Debug, Clone, Deserialize)]
pub struct AssignDetect {
    /// aura dos portadores; a explosão é quando ela sai
    pub carrier_aura: u32,
    /// os alvos: unidades desse npc que nascem por SPELL_SUMMON
    pub target_npc: u32,
    /// aura no alvo; ainda nele depois da explosão = falha
    pub target_aura: u32,
    /// jardas do portador ao alvo na explosão
    pub reach: f32,
    /// lugares fixos onde os alvos nascem (coordenadas do log)
    pub spots: Vec<Spot>,
    /// em ordem: o primeiro escolhe antes
    pub groups: Vec<Group>,
    /// como os textos chamam o alvo (padrão: alvo / target)
    #[serde(default = "default_target_name")]
    pub target_name: Text,
}

fn default_target_name() -> Text {
    Text::new("alvo", "target")
}

#[derive(Debug, Clone, Deserialize)]
pub struct Spot {
    pub key: String,
    pub at: (f32, f32),
    pub name: Text,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Group {
    /// `melee` ou `ranged` (o `range` da spec, em `data/defensives.json`)
    pub range: String,
    pub name: Text,
    /// keys dos lugares, do preferido ao último
    pub priority: Vec<String>,
}

struct Target {
    guid: String,
    summoned: i64,
    trail: Vec<(i64, f32, f32)>,
    /// (t, stacks da aura do alvo) a cada mudança
    stacks: Vec<(i64, u32)>,
    died: Option<i64>,
}

struct Carry {
    guid: String,
    name: String,
    from: i64,
    to: Option<i64>,
}

/// Tudo do pull que o julgamento precisa (alimentado pelo streaming).
#[derive(Default)]
pub struct AssignLog {
    targets: Vec<Target>,
    carries: Vec<Carry>,
    /// mortes de cada player (todas: quem levou battle rez pode morrer de novo com a aura)
    deaths: HashMap<String, Vec<i64>>,
    trails: HashMap<String, Vec<(i64, f32, f32)>>,
}

impl AssignLog {
    pub fn on_summon(&mut self, cfg: &AssignDetect, npc: Option<u32>, guid: &str, t: i64) {
        if npc == Some(cfg.target_npc) && !self.targets.iter().any(|x| x.guid == guid) {
            self.targets.push(Target { guid: guid.to_string(), summoned: t, trail: Vec::new(), stacks: Vec::new(), died: None });
        }
    }

    pub fn on_enemy_pos(&mut self, guid: &str, x: f32, y: f32, t: i64) {
        if let Some(tg) = self.targets.iter_mut().find(|x| x.guid == guid) {
            tg.trail.push((t, x, y));
        }
    }

    pub fn on_player_pos(&mut self, guid: &str, x: f32, y: f32, t: i64) {
        let tr = self.trails.entry(guid.to_string()).or_default();
        if tr.last().is_none_or(|&(lt, lx, ly)| lt != t || lx != x || ly != y) {
            tr.push((t, x, y));
        }
    }

    /// `event`: o tipo da linha (SPELL_AURA_APPLIED, *_DOSE, REMOVED); `stacks` como o analysis lê.
    #[allow(clippy::too_many_arguments)]
    pub fn on_aura(&mut self, cfg: &AssignDetect, event: &str, spell_id: u32, guid: &str, name: &str, stacks: u32, t: i64) {
        if spell_id == cfg.carrier_aura {
            match event {
                "SPELL_AURA_APPLIED" => self.carries.push(Carry { guid: guid.to_string(), name: name.to_string(), from: t, to: None }),
                "SPELL_AURA_REMOVED" => {
                    if let Some(c) = self.carries.iter_mut().rev().find(|c| c.guid == guid && c.to.is_none()) {
                        c.to = Some(t);
                    }
                }
                _ => {}
            }
        }
        if spell_id == cfg.target_aura {
            let Some(tg) = self.targets.iter_mut().find(|x| x.guid == guid) else { return };
            let now = tg.stacks.last().map_or(0, |s| s.1);
            let n = match event {
                // as stacks iniciais vêm como vários APPLIED seguidos
                "SPELL_AURA_APPLIED" => now + 1,
                "SPELL_AURA_REMOVED" => 0,
                _ => stacks,
            };
            tg.stacks.push((t, n));
        }
    }

    pub fn on_unit_died(&mut self, guid: &str, t: i64) {
        if let Some(tg) = self.targets.iter_mut().find(|x| x.guid == guid) {
            tg.died.get_or_insert(t);
        } else {
            self.deaths.entry(guid.to_string()).or_default().push(t);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Skip {
    /// nenhum alvo nasceu antes da leva
    NoTargets,
    /// alvo longe de todos os lugares da regra: onde ele apareceu
    OffSpot(f32, f32),
    /// portador sem spec conhecida ou de um `range` que nenhum grupo tem
    NoGroup,
    /// grupos com números diferentes de portadores: (nome do grupo, quantos) de cada um
    Uneven(Vec<(usize, usize)>),
    /// a prioridade de um grupo não tem lugar livre com alvo
    NoSpot(usize),
}

impl Skip {
    pub fn key(&self) -> &'static str {
        match self {
            Skip::NoTargets => "no_targets",
            Skip::OffSpot(..) => "off_spot",
            Skip::NoGroup => "no_group",
            Skip::Uneven(_) => "uneven",
            Skip::NoSpot(_) => "no_spot",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Ok,
    /// fora do alcance do alvo do grupo (jardas)
    Late(f32),
    /// no alcance de outro alvo da leva (o lugar dele) e longe do do grupo (jardas)
    WrongTarget(usize, f32),
    /// morreu com a aura, antes da explosão
    Dead,
    /// sem posição na explosão (ou a aura não saiu até o fim do pull)
    Unknown,
}

#[derive(Debug, Clone)]
pub struct CarrierJudge {
    pub guid: String,
    pub name: String,
    pub outcome: Outcome,
}

#[derive(Debug, Clone)]
pub struct GroupJudge {
    pub group: usize,
    pub spot: usize,
    pub boom: i64,
    pub shield_left: bool,
    pub carriers: Vec<CarrierJudge>,
}

#[derive(Debug, Clone)]
pub enum WaveOutcome {
    Skipped(Skip),
    /// lugar de cada alvo da leva e o julgamento de cada grupo
    Judged { spots: Vec<usize>, groups: Vec<GroupJudge> },
}

#[derive(Debug, Clone)]
pub struct Wave {
    pub t: i64,
    pub outcome: WaveOutcome,
}

fn dist(a: (f32, f32), b: (f32, f32)) -> f32 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

/// `ranges`: guid -> `melee` / `ranged` da spec de cada player.
pub fn judge(cfg: &AssignDetect, log: &AssignLog, ranges: &HashMap<String, String>) -> Vec<Wave> {
    let mut carries: Vec<&Carry> = log.carries.iter().collect();
    carries.sort_by_key(|c| c.from);
    let mut waves: Vec<Vec<&Carry>> = Vec::new();
    for c in carries {
        match waves.last_mut() {
            Some(w) if c.from - w[0].from < WAVE_GAP_MS => w.push(c),
            _ => waves.push(vec![c]),
        }
    }
    waves.iter().map(|w| Wave { t: w[0].from, outcome: judge_wave(cfg, log, ranges, w) }).collect()
}

fn judge_wave(cfg: &AssignDetect, log: &AssignLog, ranges: &HashMap<String, String>, wave: &[&Carry]) -> WaveOutcome {
    let t = wave[0].from;
    // 2. os alvos do último summon antes da leva, vivos nela
    let Some(last) = log.targets.iter().filter(|x| x.summoned <= t).map(|x| x.summoned).max() else {
        return WaveOutcome::Skipped(Skip::NoTargets);
    };
    let batch: Vec<&Target> =
        log.targets.iter().filter(|x| x.summoned <= t && last - x.summoned <= SAME_SUMMON_MS && x.died.is_none_or(|d| d > t)).collect();
    if batch.is_empty() {
        return WaveOutcome::Skipped(Skip::NoTargets);
    }
    // 3. o lugar de cada alvo: o da regra perto do primeiro lugar dele
    let mut spots = Vec::new();
    for tg in &batch {
        let Some(&(_, x, y)) = tg.trail.first() else { return WaveOutcome::Skipped(Skip::NoTargets) };
        let near = cfg.spots.iter().enumerate().map(|(i, s)| (i, dist(s.at, (x, y)))).min_by(|a, b| a.1.total_cmp(&b.1));
        match near {
            Some((i, d)) if d <= SPOT_YD => spots.push(i),
            _ => return WaveOutcome::Skipped(Skip::OffSpot(x, y)),
        }
    }
    // 4. cada portador no grupo do `range` da spec dele, e os grupos do mesmo tamanho
    let mut members: Vec<Vec<&Carry>> = vec![Vec::new(); cfg.groups.len()];
    for c in wave {
        let Some(g) = ranges.get(&c.guid).and_then(|r| cfg.groups.iter().position(|g| &g.range == r)) else {
            return WaveOutcome::Skipped(Skip::NoGroup);
        };
        members[g].push(c);
    }
    if members.iter().any(|m| m.len() != members[0].len()) {
        return WaveOutcome::Skipped(Skip::Uneven(members.iter().enumerate().map(|(g, m)| (g, m.len())).collect()));
    }
    // 5. na ordem da regra, cada grupo pega o primeiro lugar da prioridade com alvo livre
    let mut taken = vec![false; batch.len()];
    let mut picks = Vec::new();
    for (g, group) in cfg.groups.iter().enumerate() {
        let pick = group.priority.iter().find_map(|k| {
            let si = cfg.spots.iter().position(|s| &s.key == k)?;
            let ti = (0..batch.len()).find(|&i| !taken[i] && spots[i] == si)?;
            Some((si, ti))
        });
        let Some((si, ti)) = pick else { return WaveOutcome::Skipped(Skip::NoSpot(g)) };
        taken[ti] = true;
        picks.push((g, si, ti));
    }
    let groups = picks
        .into_iter()
        .filter_map(|(g, si, ti)| {
            let tg = batch[ti];
            // 6. a explosão: quando a aura sai de cada um (a última do grupo)
            let boom = members[g].iter().filter_map(|c| c.to).max()?;
            // 7. a aura do alvo ficou?
            let check = boom + SHIELD_CHECK_MS;
            let alive = tg.died.is_none_or(|d| d > check);
            let stacks = tg.stacks.iter().take_while(|s| s.0 <= check).last().map_or(0, |s| s.1);
            let shield_left = alive && stacks > 0;
            // 8. onde cada portador estava na explosão
            let carriers = members[g]
                .iter()
                .map(|c| {
                    let outcome = match c.to {
                        _ if log.deaths.get(&c.guid).is_some_and(|ds| ds.iter().any(|&d| d >= c.from && c.to.is_none_or(|to| d <= to + DEATH_SLACK_MS))) => Outcome::Dead,
                        None => Outcome::Unknown,
                        Some(to) => match (log.trails.get(&c.guid).and_then(|tr| pos_at(tr, to + PLAYER_POS_AFTER_MS)), pos_at(&tg.trail, to)) {
                            (Some(p), Some(a)) => {
                                let d = dist(p, a);
                                if d <= cfg.reach {
                                    Outcome::Ok
                                } else {
                                    // no alcance de outro alvo da leva?
                                    let other = (0..batch.len()).filter(|&i| i != ti).find(|&i| pos_at(&batch[i].trail, to).is_some_and(|o| dist(p, o) <= cfg.reach));
                                    match other {
                                        Some(i) => Outcome::WrongTarget(spots[i], d),
                                        None => Outcome::Late(d),
                                    }
                                }
                            }
                            _ => Outcome::Unknown,
                        },
                    };
                    CarrierJudge { guid: c.guid.clone(), name: c.name.clone(), outcome }
                })
                .collect();
            Some(GroupJudge { group: g, spot: si, boom, shield_left, carriers })
        })
        .collect();
    WaveOutcome::Judged { spots, groups }
}

/// O resumo do pull para o relatório (o `replay:check` lê).
pub fn summary(waves: &[Wave]) -> AssignSummary {
    let mut s = AssignSummary { waves: waves.len() as u32, ..Default::default() };
    for w in waves {
        match &w.outcome {
            WaveOutcome::Skipped(skip) => {
                match s.skipped.iter_mut().find(|x| x.0 == skip.key()) {
                    Some(x) => x.1 += 1,
                    None => s.skipped.push((skip.key().to_string(), 1)),
                }
                if let Skip::OffSpot(x, y) = skip {
                    s.off_spot.push((*x, *y));
                }
            }
            WaveOutcome::Judged { groups, .. } => {
                s.judged += 1;
                for g in groups.iter().filter(|g| g.shield_left) {
                    s.shields_left += 1;
                    if g.carriers.iter().any(|c| matches!(c.outcome, Outcome::Late(_) | Outcome::WrongTarget(..))) {
                        s.blamed += 1;
                    } else if g.carriers.iter().any(|c| c.outcome == Outcome::Dead) {
                        s.dead_carriers += 1;
                    } else {
                        s.unexplained += 1;
                    }
                }
            }
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    const TL: (f32, f32) = (1176.3, 20.9);
    const TR: (f32, f32) = (1176.7, -21.0);
    const BL: (f32, f32) = (1137.9, 20.8);
    const BR: (f32, f32) = (1137.3, -21.0);

    /// A regra do Coiled Altar.
    fn cfg() -> AssignDetect {
        let spot = |key: &str, at| Spot { key: key.into(), at, name: Text::same(key) };
        let group = |range: &str, p: &[&str]| Group { range: range.into(), name: Text::same(range), priority: p.iter().map(|s| s.to_string()).collect() };
        AssignDetect {
            carrier_aura: 1,
            target_npc: 9,
            target_aura: 2,
            reach: 16.5,
            spots: vec![spot("tl", TL), spot("tr", TR), spot("bl", BL), spot("br", BR)],
            groups: vec![group("ranged", &["tl", "tr", "bl"]), group("melee", &["br", "bl", "tr"])],
            target_name: default_target_name(),
        }
    }

    fn ranges() -> HashMap<String, String> {
        [("R1", "ranged"), ("R2", "ranged"), ("M1", "melee"), ("M2", "melee")].iter().map(|(g, r)| (g.to_string(), r.to_string())).collect()
    }

    /// Um pull com dois alvos em `a` e `b` (nascem em 0, 2 stacks), bombas de 2.500 a 7.500 nos 4
    /// portadores, cada um parado no ponto dado; `drops`: quantas stacks cada alvo perde na explosão.
    fn pull(c: &AssignDetect, a: (f32, f32), b: (f32, f32), at: &[(&str, (f32, f32))], drops: [u32; 2]) -> AssignLog {
        let mut log = AssignLog::default();
        for (i, p) in [a, b].iter().enumerate() {
            let g = format!("T{i}");
            log.on_summon(c, Some(9), &g, 0);
            log.on_enemy_pos(&g, p.0, p.1, 30);
            log.on_aura(c, "SPELL_AURA_APPLIED", 2, &g, "Add", 1, 30);
            log.on_aura(c, "SPELL_AURA_APPLIED", 2, &g, "Add", 1, 30);
        }
        for (g, p) in at {
            log.on_aura(c, "SPELL_AURA_APPLIED", 1, g, g, 1, 2_500);
            log.on_player_pos(g, p.0, p.1, 7_490);
        }
        for (g, _) in at {
            log.on_aura(c, "SPELL_AURA_REMOVED", 1, g, g, 0, 7_500);
        }
        for (i, n) in drops.iter().enumerate() {
            let g = format!("T{i}");
            for k in 0..*n {
                let left = 1 - k;
                let ev = if left == 0 { "SPELL_AURA_REMOVED" } else { "SPELL_AURA_REMOVED_DOSE" };
                log.on_aura(c, ev, 2, &g, "Add", left, 7_500);
            }
        }
        log
    }

    fn only(waves: &[Wave]) -> &[GroupJudge] {
        assert_eq!(waves.len(), 1);
        match &waves[0].outcome {
            WaveOutcome::Judged { groups, .. } => groups,
            o => panic!("leva não julgada: {o:?}"),
        }
    }

    #[test]
    fn as_seis_combinacoes_de_cantos_nao_se_chocam() {
        let c = cfg();
        // (alvos, canto dos rangeds, canto dos melees) pela prioridade da guilda
        let cases = [(TL, TR, 0, 1), (TL, BL, 0, 2), (TL, BR, 0, 3), (TR, BL, 1, 2), (TR, BR, 1, 3), (BL, BR, 2, 3)];
        for (a, b, ranged, melee) in cases {
            for (x, y) in [(a, b), (b, a)] {
                let log = pull(&c, x, y, &[("R1", x), ("R2", x), ("M1", y), ("M2", y)], [2, 2]);
                let g = only(&judge(&c, &log, &ranges())).to_vec();
                assert_eq!((g[0].spot, g[1].spot), (ranged, melee), "{x:?} {y:?}");
            }
        }
    }

    #[test]
    fn culpa_o_ranged_que_nao_chegou() {
        let c = cfg();
        // alvos em cima direita e baixo esquerda: rangeds em TR, melees em BL; R2 parado no meio
        let mid = (1157.0, 0.0);
        let log = pull(&c, TR, BL, &[("R1", TR), ("R2", mid), ("M1", BL), ("M2", BL)], [1, 2]);
        let waves = judge(&c, &log, &ranges());
        let g = only(&waves);
        assert!(g[0].shield_left && !g[1].shield_left);
        let r2 = g[0].carriers.iter().find(|x| x.guid == "R2").unwrap();
        match r2.outcome {
            Outcome::Late(d) => assert!((d - 29.0).abs() < 1.0, "{d}"),
            ref o => panic!("{o:?}"),
        }
        let s = summary(&waves);
        assert_eq!((s.judged, s.shields_left, s.blamed, s.unexplained), (1, 1, 1, 0));
    }

    #[test]
    fn troca_entre_pares_que_tirou_os_dois_escudos_nao_e_falha() {
        let c = cfg();
        let log = pull(&c, TR, BL, &[("R1", BL), ("R2", BL), ("M1", TR), ("M2", TR)], [2, 2]);
        let waves = judge(&c, &log, &ranges());
        assert!(only(&waves).iter().all(|g| !g.shield_left));
        assert_eq!(summary(&waves).shields_left, 0);
    }

    #[test]
    fn portador_no_outro_add_e_add_errado() {
        let c = cfg();
        let log = pull(&c, TR, BL, &[("R1", TR), ("R2", BL), ("M1", BL), ("M2", BL)], [1, 2]);
        let g = only(&judge(&c, &log, &ranges())).to_vec();
        let r2 = g[0].carriers.iter().find(|x| x.guid == "R2").unwrap();
        assert!(matches!(r2.outcome, Outcome::WrongTarget(2, _)), "{:?}", r2.outcome);
    }

    #[test]
    fn portador_morto_antes_da_explosao_nao_e_culpado() {
        let c = cfg();
        let mut log = pull(&c, TR, BL, &[("R1", TR), ("R2", TR), ("M1", BL), ("M2", BL)], [2, 1]);
        // M2 morre em 4.500 e perde a aura junto
        log.on_unit_died("M2", 4_500);
        log.carries.iter_mut().find(|x| x.guid == "M2").unwrap().to = Some(4_500);
        let waves = judge(&c, &log, &ranges());
        let g = only(&waves);
        assert!(g[1].shield_left);
        assert_eq!(g[1].carriers.iter().find(|x| x.guid == "M2").unwrap().outcome, Outcome::Dead);
        let s = summary(&waves);
        assert_eq!((s.blamed, s.dead_carriers, s.unexplained), (0, 1, 0));
    }

    #[test]
    fn morte_antes_da_bomba_nao_esconde_a_morte_com_ela() {
        let c = cfg();
        let mut log = pull(&c, TR, BL, &[("R1", TR), ("R2", TR), ("M1", BL), ("M2", BL)], [2, 1]);
        // M2 morreu antes, levou battle rez e morreu de novo com a bomba
        log.on_unit_died("M2", -60_000);
        log.on_unit_died("M2", 4_500);
        log.carries.iter_mut().find(|x| x.guid == "M2").unwrap().to = Some(4_500);
        let g = only(&judge(&c, &log, &ranges())).to_vec();
        assert_eq!(g[1].carriers.iter().find(|x| x.guid == "M2").unwrap().outcome, Outcome::Dead);
    }

    #[test]
    fn leva_fora_do_padrao_nao_e_julgada() {
        let c = cfg();
        let mut r = ranges();
        r.insert("M2".into(), "ranged".into());
        let log = pull(&c, TR, BL, &[("R1", TR), ("R2", TR), ("M1", BL), ("M2", BL)], [2, 1]);
        let waves = judge(&c, &log, &r);
        assert!(matches!(&waves[0].outcome, WaveOutcome::Skipped(Skip::Uneven(_))));
        assert_eq!(summary(&waves).skipped, vec![("uneven".to_string(), 1)]);
    }

    #[test]
    fn alvo_longe_dos_lugares_pula_a_leva_e_guarda_onde() {
        let c = cfg();
        let log = pull(&c, TR, (1160.0, 0.0), &[("R1", TR), ("R2", TR), ("M1", BL), ("M2", BL)], [2, 2]);
        let s = summary(&judge(&c, &log, &ranges()));
        assert_eq!((s.judged, s.off_spot.clone()), (0, vec![(1160.0, 0.0)]));
    }

    #[test]
    fn add_antigo_vivo_nao_entra_na_leva_nova() {
        let c = cfg();
        let mut log = pull(&c, TR, BL, &[("R1", TR), ("R2", TR), ("M1", BL), ("M2", BL)], [2, 2]);
        // um add de uma leva anterior, ainda vivo, em cima esquerda (o primeiro da prioridade dos rangeds)
        log.targets.insert(0, Target { guid: "OLD".into(), summoned: -30_000, trail: vec![(-29_970, TL.0, TL.1)], stacks: vec![(-29_970, 1)], died: None });
        let g = only(&judge(&c, &log, &ranges())).to_vec();
        assert_eq!((g[0].spot, g[1].spot), (1, 2));
    }
}
