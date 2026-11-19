// Números e listas que existem dos dois lados (TS do app/site e Rust do núcleo/app) e precisam
// ficar iguais. Mudou um lado e esqueceu o outro: falha aqui.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(REPO, f), 'utf8');

/** Valor de uma constante (`const NOME = ...;` no TS, `const NOME: T = ...;` no Rust), sem espaços nem `_`. */
function constant(file: string, name: string): string {
  const m = read(file).match(new RegExp(String.raw`const ${name}(?::[^=]+)?\s*=\s*([^;]+);`));
  if (!m) throw new Error(`${name} não está em ${file}`);
  return m[1].replace(/new Set\(|\)$/g, '').replace(/[\s_]/g, '').replace(/as(i64|u32|usize)/g, '');
}

/** Avalia uma expressão numérica simples ("10*60000"). */
const num = (expr: string) => expr.split('*').reduce((a, x) => a * Number(x), 1);

const PAIRS: { name: string; ts: string; rs: string; tsName?: string; rsName?: string; list?: boolean }[] = [
  { name: 'MIN_PULL_MS', ts: 'src/lib/samePull.ts', rs: 'crates/wipe-core/src/analysis.rs' },
  { name: 'PHASE_FAIL_DEATHS', ts: 'src/lib/phases.ts', rs: 'crates/wipe-core/src/rules.rs' },
  { name: 'DUNGEON_DIFFICULTIES', ts: 'src/lib/content.ts', rs: 'crates/wipe-core/src/data.rs', list: true },
  { name: 'WEBHOOK_PREFIXES', ts: 'src/web/integrations.ts', rs: 'src-tauri/src/discord.rs', list: true },
  { name: 'ALLOWED_MIME', ts: 'src/web/integrations.ts', rs: 'src-tauri/src/discord.rs', list: true },
  { name: 'KEEP_REPORTS', ts: 'src/web/wcl.ts', rs: 'src-tauri/src/wcl_source.rs' },
  { name: 'SETTLED_AFTER_MS', ts: 'src/web/wcl.ts', rs: 'src-tauri/src/wcl_source.rs' },
  { name: 'REPORT_IDLE_MS', ts: 'src/web/wcl.ts', rs: 'src-tauri/src/wcl_source.rs' },
];

describe('o TS e o Rust têm os mesmos valores', () => {
  for (const p of PAIRS) {
    it(p.name, () => {
      const ts = constant(p.ts, p.tsName ?? p.name);
      const rs = constant(p.rs, p.rsName ?? p.name);
      if (p.list) expect(ts.replace(/'/g, '"')).toBe(rs.replace(/'/g, '"'));
      else expect(num(ts)).toBe(num(rs));
    });
  }

  it('consultas do Warcraft Logs (site e app)', () => {
    const query = (file: string, name: string) => read(file).match(new RegExp(String.raw`${name}[^=]*=\s*(?:r#)?["${'`'}]([\s\S]*?)["${'`'}]#?;`))?.[1].replace(/\s+/g, ' ').trim();
    for (const q of ['REPORT_QUERY', 'EVENTS_QUERY']) {
      const ts = query('src/web/wcl.ts', q);
      const rs = query('src-tauri/src/wcl_source.rs', q);
      expect(ts, q).toBeTruthy();
      expect(ts).toBe(rs);
    }
  });
});

describe('as faixas de parse do CSS são as de PARSE_BANDS', () => {
  it('.score-pill.q-*', async () => {
    const { PARSE_BANDS } = await import('./parseBands');
    const css = read('src/styles.css');
    for (const b of PARSE_BANDS) expect(css, b.tier).toContain(`.score-pill.q-${b.tier} { --q: ${b.color}; }`);
  });
});

describe('o histórico compacto corta os mesmos campos no app e no site', () => {
  it('compact() em history.rs e src/web/history.ts', () => {
    const lists = (file: string) => {
      const body = read(file).split(/(?:pub fn|export function) compact\(/)[1] ?? '';
      return [...body.matchAll(/strip\(\w+, &?\[([^\]]+)\]\)/g)].map((m) => m[1].replace(/["'\s]/g, ''));
    };
    const rs = lists('src-tauri/src/history.rs');
    const ts = lists('src/web/history.ts');
    expect(rs.length).toBe(4);
    expect(ts).toEqual(rs);
  });
});
