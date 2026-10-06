// Guarda da internacionalização: texto em português só nos dicionários (`src/i18n/` e os
// `*.i18n.ts`). Uma linha de código (fora de comentário) com acento ou palavra típica do português
// falha aqui, para nenhum texto novo entrar numa língua só. Dado que precisa ficar em português
// (nome de item no log em pt-BR, regex de busca) leva `i18n-ignore` na mesma linha.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

const ACCENT = /[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÇ]/;
// palavras que não existem (ou quase não aparecem) em inglês nem em identificadores
const WORDS = /\b(não|nao|você|voce|sem|com|para|pelo|pela|quem|cada|ainda|aqui|até|ate|dos|das|nos|nas|uma|um|mortes?|nenhum|nenhuma|mais|menos|depois|antes|isso|esta|este|essa|esse|sua|seu|ou|e|de|do|da|em|no|na|ao|os|as|que|por|mas|já|só)\b/;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'i18n' ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.(test|i18n)\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Tira comentários (// e /* *\/) sem mexer em strings e templates. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' = 'code';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') state = 'line';
      else if (c === '/' && n === '*') state = 'block';
      else {
        if (c === "'") state = 'sq';
        else if (c === '"') state = 'dq';
        else if (c === '`') state = 'tpl';
        out += c;
      }
      if (state === 'line' || state === 'block') i++;
    } else if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
    } else if (state === 'block') {
      if (c === '*' && n === '/') {
        state = 'code';
        i++;
      } else if (c === '\n') out += c;
    } else {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i++;
      } else if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
      else if (c === '\n' && state !== 'tpl') state = 'code'; // aspas soltas em texto de JSX (Ula'tek)
    }
    i++;
  }
  return out;
}

/** Trechos que parecem texto: strings, templates e texto de JSX (o resto é código). */
function textOf(line: string): string {
  // string de uma palavra só sem acento ('na', 'ok', 'e') é chave de código, não frase
  const strings = [...line.matchAll(/'([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`[^`]*`/g)].map((m) => m[0]).filter((s) => /\s/.test(s.trim().slice(1, -1)) || ACCENT.test(s));
  // `=>` e `->` não abrem texto de JSX (arrow function, tipo genérico)
  const jsx = [...line.matchAll(/(?<![=-])>([^<>{}]*)</g)].map((m) => m[1]);
  // linha solta de texto (JSX quebrado em várias linhas); chave de objeto e identificador sozinho são código
  const lone =
    /^\s*[^<>{}=;()[\]]*[A-Za-zÀ-ú][^<>{}=;()[\]]*$/.test(line) &&
    !/^\s*(import|export|const|let|return|if|else|case|type|interface|function)\b/.test(line) &&
    !/^\s*[\w$]+\??:\s/.test(line) &&
    !/^\s*[\w$.]+,?\s*$/.test(line)
      ? [line]
      : [];
  return [...strings, ...jsx, ...lone]
    .join(' ')
    .replace(/\b[A-Za-z_]\w*(\.\w+)+/g, ' ') // acesso a propriedade (e.nativeEvent.offsetX) é código
    .replace(/\$\{[^}]*\}/g, ' ') // interpolações de template são código
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[a-z]+[A-Z]\w*\b/g, ' '); // camelCase: identificador, não texto
}

export function portugueseLines(file: string): { line: number; text: string }[] {
  const raw = fs.readFileSync(file, 'utf8').split('\n');
  const code = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
  const out: { line: number; text: string }[] = [];
  code.forEach((l, i) => {
    if (raw[i]?.includes('i18n-ignore')) return;
    const t = textOf(l);
    if (ACCENT.test(t) || WORDS.test(t.toLowerCase())) out.push({ line: i + 1, text: l.trim().slice(0, 120) });
  });
  return out;
}

/** Arquivos ainda não migrados para os dicionários (a lista só pode diminuir). */
export const PENDING = new Set<string>([



  'components/PlayersTable.tsx',
  'components/PullList.tsx',
  'components/PhaseTimes.tsx',
  'components/settings/DiscordForm.tsx',
  'components/LiveControls.tsx',
  'components/settings/WcrCloudForm.tsx',
  'components/VideoPanel.tsx',
  'components/CutoffStepper.tsx',
  'components/EnemySpellsTable.tsx',
  'components/PullMarks.tsx',

  'components/WclOpen.tsx',
  'components/settings/FolderForm.tsx',
  'components/InterruptsView.tsx',
  'components/PositionMap.tsx',
  'components/LiveToast.tsx',
  'components/settings/StartupForm.tsx',
  'components/SoloCharts.tsx',
  'components/UpdateBanner.tsx',
]);

describe('internacionalização', () => {
  it('nenhum texto em português fora dos dicionários', () => {
    const offenders = files(ROOT)
      .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
      .filter((f) => !PENDING.has(f))
      .flatMap((f) => portugueseLines(path.join(ROOT, f)).map((x) => `${f}:${x.line}  ${x.text}`));
    expect(offenders, offenders.slice(0, 40).join('\n')).toEqual([]);
  });
});
