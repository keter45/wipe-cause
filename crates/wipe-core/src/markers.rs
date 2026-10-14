//! Marcas de chão (world markers) que o grupo coloca: o log diz quando cada uma é posta e tirada
//! (`WORLD_MARKER_PLACED,instância,marca,x,y` / `WORLD_MARKER_REMOVED,marca`), e elas ficam de um
//! pull para o outro, então o leitor acompanha o log inteiro.

use crate::report::WorldMarker;
use std::collections::BTreeMap;

/** As marcas no chão agora: marca (0-7) -> (instância, x, y). */
#[derive(Debug, Clone, Default)]
pub struct WorldMarkers {
    placed: BTreeMap<u8, (u32, f32, f32)>,
}

impl WorldMarkers {
    /// Atualiza com uma linha `WORLD_MARKER_*` (campos já separados). Devolve se era uma.
    pub fn apply(&mut self, f: &[&str]) -> bool {
        match f.first().copied() {
            Some("WORLD_MARKER_PLACED") => {
                let (Some(inst), Some(m), Some(x), Some(y)) = (f.get(1).and_then(|v| v.parse().ok()), f.get(2).and_then(|v| v.parse().ok()), f.get(3).and_then(|v| v.parse().ok()), f.get(4).and_then(|v| v.parse().ok())) else {
                    return true;
                };
                self.placed.insert(m, (inst, x, y));
                true
            }
            Some("WORLD_MARKER_REMOVED") => {
                if let Some(m) = f.get(1).and_then(|v| v.parse::<u8>().ok()) {
                    self.placed.remove(&m);
                }
                true
            }
            _ => false,
        }
    }

    /// As marcas desta instância (o pull começa com elas no chão).
    pub fn snapshot(&self, instance: u32) -> Vec<WorldMarker> {
        self.placed.iter().filter(|(_, p)| p.0 == instance).map(|(&marker, &(_, x, y))| WorldMarker { marker, x, y, from: 0, to: None }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coloca_tira_e_filtra_pela_instancia() {
        let mut w = WorldMarkers::default();
        assert!(w.apply(&["WORLD_MARKER_PLACED", "3004", "2", "10.5", "-3.0"]));
        w.apply(&["WORLD_MARKER_PLACED", "3004", "5", "1", "2"]);
        w.apply(&["WORLD_MARKER_PLACED", "3095", "0", "7", "7"]);
        w.apply(&["WORLD_MARKER_REMOVED", "5"]);
        assert!(!w.apply(&["SPELL_DAMAGE", "x"]));
        let s = w.snapshot(3004);
        assert_eq!(s.len(), 1);
        assert_eq!((s[0].marker, s[0].x, s[0].y, s[0].from, s[0].to), (2, 10.5, -3.0, 0, None));
        assert_eq!(w.snapshot(3095).len(), 1);
    }
}
