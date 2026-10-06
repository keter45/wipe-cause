// Guarda da internacionalização no Rust (núcleo e app): texto em português só dentro de `pick()`,
// `tx!` ou `Text`, que levam as duas línguas. Uma string com acento ou palavra típica do português
// fora disso falha aqui. Pares montados à mão (pt e en lado a lado) e dados que precisam ficar em
// português levam `i18n-ignore` na linha. Testes e o `wipe-cli` (ferramenta de desenvolvimento)
// ficam de fora.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const DIRS = ['crates/wipe-core/src', 'src-tauri/src'];
const SKIP = /[\\/]bin[\\/]/;

const ACCENT = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/;
const WORDS =
  /\b(não|nao|você|com|para|pelo|pela|sem|quem|cada|ainda|aqui|até|dos|das|uma|morte|mortes|nenhum|nenhuma|mais|depois|isso|esta|este|sua|seu|que|por|mas|ou|em|na|no|ao|os|da|do|de|erro|falha|arquivo|pasta|chave|abrir|ler|salvar|precisa)\b/i;
/** Linhas que já levam as duas línguas (ou não chegam ao usuário). */
const BILINGUAL = /pick\(|tx!\(|Text::(new|same)|expect\(|panic!|unreachable!|debug_assert/;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return e.name.endsWith('.rs') && !SKIP.test(p) ? [p] : [];
  });
}

export function portugueseRustLines(file: string): string[] {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const testsAt = lines.findIndex((l) => /#\[cfg\(test\)\]/.test(l));
  const out: string[] = [];
  lines.forEach((raw, i) => {
    if (testsAt >= 0 && i > testsAt) return;
    if (raw.includes('i18n-ignore')) return;
    const code = raw.replace(/\/\/.*$/, '');
    if (BILINGUAL.test(code)) return;
    // argumentos de um pick( ou tx!( quebrado em várias linhas
    const prev = lines.slice(Math.max(0, i - 3), i).map((l) => l.trim());
    if (prev.some((l) => /(pick|tx!)\($/.test(l))) return;
    for (const m of code.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const s = m[1];
      if (s.length >= 3 && (ACCENT.test(s) || WORDS.test(s))) out.push(`${i + 1}: ${raw.trim().slice(0, 120)}`);
    }
  });
  return out;
}

describe('internacionalização (Rust)', () => {
  it('nenhum texto em português fora de pick/tx!/Text', () => {
    const offenders = DIRS.flatMap((d) => files(path.join(REPO, d))).flatMap((f) =>
      portugueseRustLines(f).map((x) => `${path.relative(REPO, f).replace(/\\/g, '/')}:${x}`),
    );
    expect(offenders, offenders.slice(0, 40).join('\n')).toEqual([]);
  });
});
