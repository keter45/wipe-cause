//! Replay completo de um pull: o que o replay de um momento não guarda. Só é capturado quando o
//! app relê um pull sozinho (`analyze_pull_full`), porque cobre a luta inteira e é grande.
//!
//! - vida de cada player ao longo do pull (quadro do raid);
//! - debuffs que os inimigos põem nos players e os defensivos de cada um, com início e fim;
//! - eventos de cada player: dano e cura recebidos, casts, interrupts, dispels e ressurreições.
//!
//! Tudo vai em tabelas (players, fontes, spells) e listas de tuplas, para o JSON não pesar.

use crate::report::{FightAura, FightBoss, FightData, FightEvent, FightZone};
use crate::data::{ZoneAt, ZoneDef};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Vida nova só entra se mudou ao menos isto (pontos de %) ou depois deste tempo.
const HP_MIN_DELTA: f32 = 1.0;
const HP_MAX_GAP_MS: i64 = 2_000;
/// Cura recebida abaixo disto (% da vida máxima) fica de fora (HoT pequeno enche a lista).
const HEAL_MIN_PCT: i64 = 2;
/// Vida dos bosses (por mil): nova amostra se mudou ao menos isto, ou depois de HP_MAX_GAP_MS.
const BOSS_HP_MIN_DELTA: u16 = 2;
/// Bosses no replay: inimigos com pelo menos esta parte da maior vida, no máximo MAX_BOSSES.
const BOSS_MIN_HP_SHARE: f64 = 0.3;
const MAX_BOSSES: usize = 6;

/// Tipos de evento (segundo campo de `FightEvent`).
pub const EV_DAMAGE: u8 = 0;
pub const EV_HEAL: u8 = 1;
pub const EV_CAST: u8 = 2;
pub const EV_INTERRUPT: u8 = 3;
pub const EV_DISPEL: u8 = 4;
pub const EV_RESURRECT: u8 = 5;

/// Sem fonte/alvo no evento.
pub const NO_UNIT: u16 = u16::MAX;

/// Vida de um inimigo: (nome, vida máxima, [(t, por mil)]).
type EnemyHp = (String, i64, Vec<(i64, u16)>);

#[derive(Default)]
pub struct FightCapture {
    players: Vec<String>,
    pidx: HashMap<String, u16>,
    sources: Vec<String>,
    sidx: HashMap<String, u16>,
    spells: BTreeMap<u32, String>,
    hp: Vec<Vec<(i64, u8)>>,
    auras: Vec<FightAura>,
    /// aura aberta de cada (player, spell): índice em `auras`
    open: HashMap<(u16, u32), usize>,
    /// stacks atuais de cada aura aberta e as mudanças: (player, spell, t, stacks)
    cur_stacks: HashMap<(u16, u32), u32>,
    stacks: Vec<(u16, u32, i64, u32)>,
    events: Vec<FightEvent>,
    /// buffs que entram (defensivos pessoais e externos)
    defensives: HashSet<u32>,
    /// vida de cada inimigo: guid -> (nome, vida máxima, [(t, por mil)])
    enemies: HashMap<String, EnemyHp>,
    /// somas por segundo: (segundo, player, alvo) -> dano feito; (segundo, player) -> cura feita / recebida
    done: HashMap<(u32, u16, u16), i64>,
    healed: HashMap<(u32, u16), i64>,
    heal_in: HashMap<(u32, u16), i64>,
    /// defensivos em área: specs por spell, as áreas, totens à espera da posição e buffs que dão o centro
    zone_defs: HashMap<u32, ZoneDef>,
    zones: Vec<FightZone>,
    zone_units: HashMap<String, usize>,
    /// buff -> (área, até quando conta, posições de quem ganhou)
    zone_buffs: HashMap<u32, ZoneBuff>,
}

/// Buff que marca o centro de uma área: (área, até quando conta, posições de quem ganhou).
type ZoneBuff = (usize, i64, Vec<(f32, f32)>);

/// Área no meio de quem ganhou o buff primeiro (at = buffed).
fn place(z: &mut FightZone, pts: &[(f32, f32)]) {
    if !pts.is_empty() {
        let n = pts.len() as f32;
        z.x = pts.iter().map(|p| p.0).sum::<f32>() / n;
        z.y = pts.iter().map(|p| p.1).sum::<f32>() / n;
    }
}

/// Quem ganha o buff até isto depois do cast marca o centro da área (at = buffed).
const ZONE_BUFF_WINDOW_MS: i64 = 1_000;

impl FightCapture {
    pub fn new(defensives: HashSet<u32>) -> Self {
        FightCapture { defensives, ..Default::default() }
    }

    /// Defensivos em área que entram no replay (spell -> onde fica, raio, duração).
    pub fn with_zones(mut self, defs: HashMap<u32, ZoneDef>) -> Self {
        self.zone_defs = defs;
        self
    }

    /// Cast de um player: se é defensivo em área, abre a área. `pos`: onde ele estava.
    pub fn zone_cast(&mut self, t: i64, guid: &str, spell: u32, name: &str, pos: Option<(f32, f32)>) {
        let Some(def) = self.zone_defs.get(&spell).cloned() else { return };
        let caster = self.player(guid);
        self.spell(spell, name);
        let i = self.zones.len();
        let (x, y) = match def.at {
            ZoneAt::Caster => pos.unwrap_or((f32::NAN, f32::NAN)),
            _ => (f32::NAN, f32::NAN),
        };
        self.zones.push(FightZone { t, end: t + (def.duration * 1000.0) as i64, spell_id: spell, caster, x, y, radius: def.radius });
        if let (ZoneAt::Buffed, Some(b)) = (def.at, def.buff) {
            self.zone_buffs.insert(b, (i, t + ZONE_BUFF_WINDOW_MS, Vec::new()));
        }
    }

    /// Unidade invocada por um player (o totem): a área fica onde ela aparecer.
    pub fn zone_summon(&mut self, spell: u32, unit: &str) {
        if self.zone_defs.get(&spell).is_some_and(|d| d.at == ZoneAt::Summon) {
            if let Some(i) = self.zones.iter().rposition(|z| z.spell_id == spell && z.x.is_nan()) {
                self.zone_units.insert(unit.to_string(), i);
            }
        }
    }

    /// Posição de uma unidade no log: o totem de uma área à espera dela.
    pub fn zone_unit_pos(&mut self, unit: &str, x: f32, y: f32) {
        if let Some(i) = self.zone_units.remove(unit) {
            self.zones[i].x = x;
            self.zones[i].y = y;
        }
    }

    /// Buff num player (onde ele estava): os primeiros a ganhar marcam o centro (at = buffed).
    pub fn zone_buff(&mut self, t: i64, buff: u32, pos: Option<(f32, f32)>) {
        let Some((_, until, pts)) = self.zone_buffs.get_mut(&buff) else { return };
        if t <= *until {
            if let Some(p) = pos {
                pts.push(p);
            }
            return;
        }
        if let Some((i, _, pts)) = self.zone_buffs.remove(&buff) {
            place(&mut self.zones[i], &pts);
        }
    }

    fn player(&mut self, guid: &str) -> u16 {
        if let Some(&i) = self.pidx.get(guid) {
            return i;
        }
        let i = self.players.len() as u16;
        self.players.push(guid.to_string());
        self.hp.push(Vec::new());
        self.pidx.insert(guid.to_string(), i);
        i
    }

    fn source(&mut self, name: &str) -> u16 {
        if name.is_empty() || name == "nil" {
            return NO_UNIT;
        }
        if let Some(&i) = self.sidx.get(name) {
            return i;
        }
        let i = self.sources.len() as u16;
        self.sources.push(name.to_string());
        self.sidx.insert(name.to_string(), i);
        i
    }

    fn spell(&mut self, id: u32, name: &str) {
        if id != 0 && !name.is_empty() && name != "nil" {
            self.spells.entry(id).or_insert_with(|| name.to_string());
        }
    }

    /// Vida do player (% da máxima) em `t`.
    pub fn hp(&mut self, guid: &str, pct: f32, t: i64) {
        let p = self.player(guid) as usize;
        let h = &mut self.hp[p];
        let v = pct.round().clamp(0.0, 100.0) as u8;
        if h.last().is_none_or(|&(lt, lv)| (v as f32 - lv as f32).abs() >= HP_MIN_DELTA && t != lt || t - lt >= HP_MAX_GAP_MS) {
            h.push((t, v));
        }
    }

    /// Vida de um inimigo (para as barras dos bosses).
    pub fn enemy_hp(&mut self, guid: &str, name: &str, hp: i64, max_hp: i64, t: i64) {
        if max_hp <= 0 {
            return;
        }
        let e = self.enemies.entry(guid.to_string()).or_insert_with(|| (name.to_string(), max_hp, Vec::new()));
        e.1 = e.1.max(max_hp);
        let v = ((hp.max(0) as f64 / max_hp as f64) * 1000.0).round().min(1000.0) as u16;
        if e.2.last().is_none_or(|&(lt, lv)| v.abs_diff(lv) >= BOSS_HP_MIN_DELTA && t != lt || t - lt >= HP_MAX_GAP_MS) {
            e.2.push((t, v));
        }
    }

    /// Dano de um player (ou pet dele) num inimigo, somado por segundo e alvo.
    pub fn damage_done(&mut self, t: i64, guid: &str, target: &str, amount: i64) {
        if amount <= 0 {
            return;
        }
        let (p, s) = (self.player(guid), self.source(target));
        *self.done.entry(((t.max(0) / 1000) as u32, p, s)).or_default() += amount;
    }

    /// Cura feita por um player (escudos absorvendo contam, como no Warcraft Logs), somada por segundo.
    pub fn healing_done(&mut self, t: i64, guid: &str, amount: i64) {
        if amount > 0 {
            let p = self.player(guid);
            *self.healed.entry(((t.max(0) / 1000) as u32, p)).or_default() += amount;
        }
    }

    /// Cura recebida por um player (toda, não só a que entra na lista de eventos), somada por segundo.
    pub fn healing_taken(&mut self, t: i64, guid: &str, amount: i64) {
        if amount > 0 {
            let p = self.player(guid);
            *self.heal_in.entry(((t.max(0) / 1000) as u32, p)).or_default() += amount;
        }
    }

    /// Player morreu: vida zero na hora.
    pub fn died(&mut self, guid: &str, t: i64) {
        let p = self.player(guid) as usize;
        self.hp[p].push((t, 0));
    }

    /// Evento de um player. `other`: fonte (dano, cura, ressurreição) ou alvo (cast, dispel), pelo nome.
    #[allow(clippy::too_many_arguments)]
    pub fn event(&mut self, t: i64, kind: u8, guid: &str, spell: u32, spell_name: &str, amount: i64, other: &str) {
        let p = self.player(guid);
        let o = self.source(other);
        self.spell(spell, spell_name);
        self.events.push(FightEvent(t, kind, p, spell, amount, o));
    }

    /// Cura recebida: só as que pesam (acima de HEAL_MIN_PCT da vida máxima, quando ela é conhecida).
    #[allow(clippy::too_many_arguments)]
    pub fn heal(&mut self, t: i64, guid: &str, spell: u32, spell_name: &str, amount: i64, max_hp: Option<i64>, healer: &str) {
        if max_hp.is_some_and(|m| m > 0 && amount * 100 < m * HEAL_MIN_PCT) {
            return;
        }
        self.event(t, EV_HEAL, guid, spell, spell_name, amount, healer);
    }

    /// Nome de um spell que aparece só como dado (o cast cortado de um interrupt, a aura dispelada).
    pub fn name_spell(&mut self, id: u32, name: &str) {
        self.spell(id, name);
    }

    /// Aura num player: `debuff` vindo de inimigo, ou um defensivo. `stacks` = 0 na remoção.
    #[allow(clippy::too_many_arguments)]
    pub fn aura(&mut self, t: i64, guid: &str, spell: u32, name: &str, debuff: bool, enemy_source: bool, stacks: u32) {
        if debuff && !enemy_source || !debuff && !self.defensives.contains(&spell) {
            return;
        }
        let p = self.player(guid);
        self.spell(spell, name);
        let key = (p, spell);
        if stacks == 0 {
            if let Some(i) = self.open.remove(&key) {
                self.auras[i].3 = t;
            }
            self.cur_stacks.remove(&key);
            return;
        }
        match self.open.get(&key) {
            Some(&i) => self.auras[i].4 = self.auras[i].4.max(stacks),
            None => {
                self.open.insert(key, self.auras.len());
                self.auras.push(FightAura(p, spell, t, -1, stacks, debuff as u8));
            }
        }
        // a contagem em cada momento (o número no ícone); 1 stack é o padrão e não precisa de entrada
        let before = self.cur_stacks.insert(key, stacks).unwrap_or(1);
        if before != stacks {
            self.stacks.push((p, spell, t, stacks));
        }
    }

    /// Fecha o que ficou aberto no fim do pull. `rule_spells`: spells das regras do boss (spell -> mecânica);
    /// `add_npcs`: adds que importam (`units` com `replay: true`), com a vida guardada mesmo sem vida de boss.
    pub fn finish(mut self, end: i64, rule_spells: BTreeMap<u32, String>, add_npcs: &HashSet<u32>) -> FightData {
        for (_, (i, _, pts)) in self.zone_buffs.drain() {
            place(&mut self.zones[i], &pts);
        }
        // sem posição (sem advanced logging, totem que não apareceu): fica de fora
        self.zones.retain(|z| z.x.is_finite() && z.y.is_finite());
        for z in &mut self.zones {
            z.end = z.end.min(end);
        }
        for (_, i) in self.open.drain() {
            self.auras[i].3 = end;
        }
        self.auras.sort_by_key(|a| (a.2, a.0));
        self.events.sort_by_key(|e| e.0);
        self.stacks.sort_by_key(|s| s.2);
        let top = self.enemies.values().map(|e| e.1).max().unwrap_or(0);
        let (mut bosses, mut adds): (Vec<FightBoss>, Vec<FightBoss>) = self
            .enemies
            .into_iter()
            .filter(|(guid, e)| top > 0 && e.1 as f64 >= top as f64 * BOSS_MIN_HP_SHARE || crate::analysis::npc_id(guid).is_some_and(|n| add_npcs.contains(&n)))
            .map(|(guid, (name, max_hp, hp))| FightBoss { guid, name, max_hp, hp })
            .partition(|b| top > 0 && b.max_hp as f64 >= top as f64 * BOSS_MIN_HP_SHARE);
        bosses.sort_by(|a, b| b.max_hp.cmp(&a.max_hp).then(a.name.cmp(&b.name)));
        bosses.truncate(MAX_BOSSES);
        adds.sort_by_key(|a| a.hp.first().map_or(0, |h| h.0));
        let mut done: Vec<(u32, u16, u16, i64)> = self.done.into_iter().map(|((s, p, t), v)| (s, p, t, v)).collect();
        done.sort_unstable();
        let sums = |m: HashMap<(u32, u16), i64>| {
            let mut v: Vec<(u32, u16, i64)> = m.into_iter().map(|((s, p), a)| (s, p, a)).collect();
            v.sort_unstable();
            v
        };
        FightData {
            players: self.players,
            sources: self.sources,
            spells: self.spells,
            rule_spells,
            hp: self.hp,
            auras: self.auras,
            stacks: self.stacks,
            events: self.events,
            bosses,
            done,
            healed: sums(self.healed),
            heal_in: sums(self.heal_in),
            zones: self.zones,
            adds,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guarda_vida_debuffs_e_eventos_em_tabelas() {
        let mut c = FightCapture::new([100].into_iter().collect());
        c.hp("P1", 100.0, 0);
        c.hp("P1", 99.6, 100); // mudou menos de 1 ponto: fica de fora
        c.hp("P1", 80.0, 200);
        c.event(300, EV_DAMAGE, "P1", 5, "Bite", 1000, "Boss");
        c.event(400, EV_DAMAGE, "P1", 5, "Bite", 900, "Boss");
        c.heal(500, "P1", 6, "Tiny Hot", 10, Some(100_000), "Healer"); // 0,01%: fora
        c.aura(300, "P1", 7, "Venom", true, true, 1);
        c.aura(350, "P1", 7, "Venom", true, true, 3);
        c.aura(900, "P1", 7, "Venom", true, true, 0);
        c.aura(300, "P1", 8, "Own Debuff", true, false, 1); // debuff de player: fora
        c.aura(300, "P1", 100, "Shield Wall", false, false, 1);
        c.died("P1", 1000);
        let f = c.finish(2000, BTreeMap::new(), &HashSet::new());
        assert_eq!(f.players, vec!["P1"]);
        assert_eq!(f.hp[0], vec![(0, 100), (200, 80), (1000, 0)]);
        assert_eq!(f.sources, vec!["Boss"]);
        assert_eq!(f.events.len(), 2);
        assert_eq!(f.events[0], FightEvent(300, EV_DAMAGE, 0, 5, 1000, 0));
        assert_eq!(f.auras, vec![FightAura(0, 7, 300, 900, 3, 1), FightAura(0, 100, 300, 2000, 1, 0)]);
        assert_eq!(f.stacks, vec![(0, 7, 350, 3)]);
        assert_eq!(f.spells.get(&7).map(String::as_str), Some("Venom"));
    }

    #[test]
    fn areas_de_defensivo_no_caster_no_totem_e_no_meio_dos_buffados() {
        let zone = |at, buff| ZoneDef { radius: 10.0, duration: 8.0, at, buff };
        let defs = [(1, zone(ZoneAt::Caster, None)), (2, zone(ZoneAt::Summon, None)), (3, zone(ZoneAt::Buffed, Some(30)))].into_iter().collect();
        let mut c = FightCapture::new(HashSet::new()).with_zones(defs);
        c.zone_cast(1000, "DK", 1, "AMZ", Some((5.0, 5.0)));
        c.zone_cast(2000, "SH", 2, "Totem", Some((0.0, 0.0)));
        c.zone_summon(2, "Totem-1");
        c.zone_unit_pos("Totem-1", 3.0, 4.0);
        c.zone_cast(3000, "PR", 3, "Barrier", Some((0.0, 0.0)));
        c.zone_buff(3100, 30, Some((10.0, 0.0)));
        c.zone_buff(3200, 30, Some((20.0, 0.0)));
        c.zone_buff(9000, 30, Some((90.0, 0.0))); // tarde demais: não conta
        c.zone_cast(4000, "DH", 4, "Nada", Some((0.0, 0.0))); // não é área
        let f = c.finish(5000, BTreeMap::new(), &HashSet::new());
        let at: Vec<(u32, f32, f32, i64)> = f.zones.iter().map(|z| (z.spell_id, z.x, z.y, z.end)).collect();
        assert_eq!(at, vec![(1, 5.0, 5.0, 5000), (2, 3.0, 4.0, 5000), (3, 15.0, 0.0, 5000)]);
    }
}
