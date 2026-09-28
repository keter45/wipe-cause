//! Quebra uma linha do combat log em timestamp + campos.
//!
//! Formato: `M/D/YYYY HH:MM:SS.ffff-Z  EVENTO,campo,campo,...`
//! Campos podem vir entre aspas (nomes com vírgula) e o COMBATANT_INFO tem
//! listas aninhadas com `[...]` e `(...)` — vírgulas dentro delas não separam campos.

/// Separa timestamp e resto da linha. O separador é dois espaços (ou tab em alguns clientes).
pub fn split_timestamp(line: &str) -> Option<(&str, &str)> {
    let line = line.trim_end_matches(['\r', '\n']);
    if let Some(i) = line.find("  ") {
        return Some((&line[..i], &line[i + 2..]));
    }
    line.find('\t').map(|i| (&line[..i], &line[i + 1..]))
}

/// Divide os campos de uma linha (sem o timestamp) respeitando aspas e colchetes/parênteses.
pub fn split_fields<'a>(s: &'a str, out: &mut Vec<&'a str>) {
    out.clear();
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut in_quotes = false;
    let mut start = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'"' => in_quotes = !in_quotes,
            b'[' | b'(' if !in_quotes => depth += 1,
            b']' | b')' if !in_quotes => depth -= 1,
            b',' if !in_quotes && depth == 0 => {
                out.push(unquote(&s[start..i]));
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(unquote(&s[start..]));
}

fn unquote(f: &str) -> &str {
    f.strip_prefix('"')
        .and_then(|x| x.strip_suffix('"'))
        .unwrap_or(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_quoted_and_nested() {
        let (ts, rest) =
            split_timestamp("9/28/2026 21:03:11.1234-3  SPELL_DAMAGE,Player-1-A,\"Foo, Bar\",0x511\r\n").unwrap();
        assert_eq!(ts, "9/28/2026 21:03:11.1234-3");
        let mut f = Vec::new();
        split_fields(rest, &mut f);
        assert_eq!(f, vec!["SPELL_DAMAGE", "Player-1-A", "Foo, Bar", "0x511"]);

        split_fields("COMBATANT_INFO,Player-1-A,1,[(1,2,3),(4,5)],(0,0),[x]", &mut f);
        assert_eq!(f, vec!["COMBATANT_INFO", "Player-1-A", "1", "[(1,2,3),(4,5)]", "(0,0)", "[x]"]);
    }
}
