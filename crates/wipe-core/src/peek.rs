//! Leitura rápida de um log: só os encontros (ENCOUNTER_START/END), para listar a pasta de
//! logs sem analisar tudo. Ignora o resto das linhas sem separar campos.

use crate::analysis::MIN_PULL_MS;
use crate::data::difficulty_name;
use crate::timestamp::parse_timestamp;
use crate::tokenizer::{split_fields, split_timestamp};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EncounterPeek {
    pub encounter_id: u32,
    pub name: String,
    pub difficulty_id: u32,
    pub difficulty_name: String,
    /// masmorra (M+, delve…): a lista de logs mostra à parte
    #[serde(default)]
    pub dungeon: bool,
    /// pulls que a análise vai mostrar (kills + wipes de 30s ou mais)
    pub pulls: u32,
    pub kills: u32,
    /// início (epoch ms) de cada pull contado, para casar com os pulls do Warcraft Logs
    #[serde(default)]
    pub starts: Vec<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogPeek {
    /// epoch ms (UTC) do primeiro e do último encontro
    pub first_ms: Option<i64>,
    pub last_ms: Option<i64>,
    pub encounters: Vec<EncounterPeek>,
}

pub fn peek_file(path: &Path) -> io::Result<LogPeek> {
    peek_reader(BufReader::with_capacity(1 << 20, File::open(path)?))
}

pub fn peek_reader<R: BufRead>(mut reader: R) -> io::Result<LogPeek> {
    let year = crate::current_year();
    let mut out = LogPeek::default();
    let mut buf = Vec::with_capacity(4096);
    let mut last_start: Option<i64> = None;
    loop {
        buf.clear();
        if reader.read_until(b'\n', &mut buf)? == 0 {
            break;
        }
        // o evento vem logo depois do timestamp (~30 bytes): checa antes de decodificar a linha
        let head = &buf[..buf.len().min(64)];
        if !head.windows(10).any(|w| w == b"ENCOUNTER_") {
            continue;
        }
        let line = String::from_utf8_lossy(&buf);
        let Some((ts, rest)) = split_timestamp(&line) else { continue };
        let mut f = Vec::new();
        split_fields(rest, &mut f);
        // ENCOUNTER_END,id,"nome",difficulty,groupSize,success,fightTime(ms)
        if f[0] != "ENCOUNTER_END" || f.len() < 7 {
            if f[0] == "ENCOUNTER_START" {
                if let Some(t) = parse_timestamp(ts, year) {
                    out.first_ms.get_or_insert(t);
                    out.last_ms = Some(t);
                    last_start = Some(t);
                }
            }
            continue;
        }
        let (Ok(id), Ok(diff)) = (f[1].parse::<u32>(), f[3].parse::<u32>()) else { continue };
        let success = f[5] == "1";
        let fight_ms: i64 = f[6].parse().unwrap_or(0);
        if !success && fight_ms < MIN_PULL_MS {
            continue;
        }
        let name = f[2].trim_matches('"').to_string();
        let e = match out.encounters.iter_mut().find(|e| e.encounter_id == id && e.difficulty_id == diff) {
            Some(e) => e,
            None => {
                out.encounters.push(EncounterPeek {
                    encounter_id: id,
                    name,
                    difficulty_id: diff,
                    difficulty_name: difficulty_name(diff).to_string(),
                    dungeon: crate::data::is_dungeon(diff, f[4].parse().unwrap_or(0)),
                    pulls: 0,
                    kills: 0,
                    starts: Vec::new(),
                });
                out.encounters.last_mut().unwrap()
            }
        };
        e.pulls += 1;
        e.kills += success as u32;
        e.starts.extend(last_start.take());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_pulls_per_boss_and_skips_short_wipes() {
        let log = "\
9/28/2026 20:41:29.000-3  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1
9/28/2026 21:00:00.000-3  ENCOUNTER_START,3421,\"The Twin Fangs\",16,20,3004
9/28/2026 21:00:10.000-3  SPELL_DAMAGE,Player-1,\"A\",0x511,0x0,Creature-0,\"B\",0x10a48,0x0,1,\"Melee\",0x1
9/28/2026 21:03:00.000-3  ENCOUNTER_END,3421,\"The Twin Fangs\",16,20,0,180000
9/28/2026 21:05:00.000-3  ENCOUNTER_START,3421,\"The Twin Fangs\",16,20,3004
9/28/2026 21:05:10.000-3  ENCOUNTER_END,3421,\"The Twin Fangs\",16,20,0,10000
9/28/2026 21:10:00.000-3  ENCOUNTER_START,3421,\"The Twin Fangs\",16,20,3004
9/28/2026 21:17:00.000-3  ENCOUNTER_END,3421,\"The Twin Fangs\",16,20,1,420000
9/28/2026 22:00:00.000-3  ENCOUNTER_START,3429,\"The Coiled Altar\",16,20,3004
9/28/2026 22:01:00.000-3  ENCOUNTER_END,3429,\"The Coiled Altar\",16,20,0,60000
";
        let p = peek_reader(log.as_bytes()).unwrap();
        assert_eq!(p.encounters.len(), 2);
        let tf = &p.encounters[0];
        assert_eq!((tf.name.as_str(), tf.pulls, tf.kills, tf.difficulty_name.as_str()), ("The Twin Fangs", 2, 1, "Mythic"));
        assert_eq!(p.encounters[1].pulls, 1);
        assert_eq!(tf.starts.len(), 2, "o wipe curto não entra");
        assert_eq!(tf.starts[1] - tf.starts[0], 10 * 60_000);
        // 21:00 no fuso -3 = 00:00 UTC do dia seguinte
        assert!(p.first_ms.unwrap() < p.last_ms.unwrap());
    }
}
