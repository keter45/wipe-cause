//! Textos nas duas línguas do app (português do Brasil e inglês).
//!
//! O que fica gravado na análise (dicas e mensagens das regras, resumos, leitura da rotação) sai
//! com as duas línguas (`Text`), porque a análise vai para o histórico e o idioma pode mudar
//! depois. Mensagens de erro na hora (comandos do app) usam o idioma atual (`pick`).
//!
//! Nas regras e rotações (YAML), o texto é `{ pt: ..., en: ... }`; uma string sozinha é aceita
//! para o que o usuário escreve (ajustes, regras dele) e vale para as duas línguas. As embutidas
//! têm que ter as duas: o teste `embedded_texts_are_bilingual` falha se faltar.

use serde::{Deserialize, Deserializer, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Text {
    pub pt: String,
    pub en: String,
}

impl Text {
    pub fn new(pt: impl Into<String>, en: impl Into<String>) -> Self {
        Text { pt: pt.into(), en: en.into() }
    }

    /// O mesmo texto nas duas línguas (escrito pelo usuário, nome do jogo).
    pub fn same(s: impl Into<String>) -> Self {
        let s = s.into();
        Text { pt: s.clone(), en: s }
    }

    pub fn is_empty(&self) -> bool {
        self.pt.is_empty() && self.en.is_empty()
    }

    /// Aplica a mesma transformação nas duas línguas (ex.: trocar `{player}`).
    pub fn map(&self, f: impl Fn(&str) -> String) -> Text {
        Text { pt: f(&self.pt), en: f(&self.en) }
    }

    /// O texto no idioma atual do app.
    pub fn current(&self) -> &str {
        if is_english() { &self.en } else { &self.pt }
    }
}

impl<'de> Deserialize<'de> for Text {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            One(String),
            Both { pt: String, en: String },
        }
        Ok(match Raw::deserialize(d)? {
            Raw::One(s) => Text::same(s),
            Raw::Both { pt, en } => Text { pt, en },
        })
    }
}

/// `tx!("{n} mortes", "{n} deaths")`: o mesmo `format!` nas duas línguas.
#[macro_export]
macro_rules! tx {
    ($pt:expr, $en:expr $(,)?) => {
        $crate::i18n::Text::new(format!($pt), format!($en))
    };
}

// ---------------------------------------------------------------- idioma atual (mensagens na hora)

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn set_english(en: bool) {
    ENGLISH.store(en, Ordering::Relaxed);
}

pub fn is_english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// Escolhe a frase do idioma atual (erros e avisos que não ficam gravados).
pub fn pick(pt: impl Into<String>, en: impl Into<String>) -> String {
    if is_english() { en.into() } else { pt.into() }
}

/// Campos de texto que não têm as duas línguas (`{ pt, en }` não vazios) num YAML embutido.
#[cfg(test)]
pub(crate) fn not_bilingual(doc: &yaml_serde::Value, file: &str) -> Vec<String> {
    use yaml_serde::Value;
    fn check(v: &Value, at: &str, out: &mut Vec<String>) {
        let ok = |k: &str| v.get(k).and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty());
        if !(ok("pt") && ok("en")) {
            out.push(at.to_string());
        }
    }
    let seq = |v: Option<&Value>| v.and_then(Value::as_sequence).cloned().unwrap_or_default();
    let mut out = Vec::new();
    // regras de boss: dica, mensagem e mensagem por jogador (também nos overrides)
    for (i, m) in seq(doc.get("mechanics")).iter().enumerate() {
        let key = m.get("key").and_then(Value::as_str).unwrap_or("?");
        let mut fields = vec![(m.clone(), format!("{file}: mechanics[{i}] {key}"))];
        if let Some(ovs) = m.get("overrides").and_then(Value::as_mapping) {
            fields.extend(ovs.iter().map(|(d, ov)| (ov.clone(), format!("{file}: {key}.overrides.{}", d.as_str().unwrap_or("?")))));
        }
        for (v, at) in fields {
            for f in ["tip", "message", "blame_message"] {
                if let Some(t) = v.get(f) {
                    check(t, &format!("{at}.{f}"), &mut out);
                }
            }
        }
    }
    // rotações: pontos principais, títulos e dicas das checagens, notas da prioridade
    for (i, k) in seq(doc.get("key_points")).iter().enumerate() {
        check(k, &format!("{file}: key_points[{i}]"), &mut out);
    }
    for (i, c) in seq(doc.get("checks")).iter().enumerate() {
        for f in ["title", "tip"] {
            if let Some(t) = c.get(f) {
                check(t, &format!("{file}: checks[{i}].{f}"), &mut out);
            }
        }
    }
    if let Some(trees) = doc.get("priority").and_then(Value::as_mapping) {
        for (tree, p) in trees {
            for list in ["st", "aoe"] {
                for (i, item) in seq(p.get(list)).iter().enumerate() {
                    if let Some(n) = item.get("note") {
                        check(n, &format!("{file}: priority.{}.{list}[{i}].note", tree.as_str().unwrap_or("?")), &mut out);
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regras e rotações embutidas nas duas línguas: o app é sempre pt-BR + inglês.
    #[test]
    fn embedded_texts_are_bilingual() {
        let mut missing = Vec::new();
        for (file, src) in crate::rules::embedded_sources().iter().chain(crate::rotation::EMBEDDED_ROTATIONS) {
            let doc: yaml_serde::Value = yaml_serde::from_str(src).unwrap();
            missing.extend(not_bilingual(&doc, file));
        }
        assert!(missing.is_empty(), "{} textos sem pt e en:\n{}", missing.len(), missing.iter().take(40).cloned().collect::<Vec<_>>().join("\n"));
    }

    #[test]
    fn text_reads_string_or_both() {
        let one: Text = yaml_serde::from_str("\"sair da poça\"").unwrap();
        assert_eq!(one, Text::same("sair da poça"));
        let both: Text = yaml_serde::from_str("{ pt: sair, en: move }").unwrap();
        assert_eq!(both, Text::new("sair", "move"));
        let n = 3;
        assert_eq!(tx!("{n} mortes", "{n} deaths"), Text::new("3 mortes", "3 deaths"));
    }
}
