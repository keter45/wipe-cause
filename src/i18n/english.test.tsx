// O lado inglês de cada dicionário não pode ter português (frase copiada e esquecida). Cada texto é
// montado de verdade: frases com parâmetros são chamadas com valores de exemplo e o JSX vira HTML.

import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Messages } from './index';

const ACCENT = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/;
// palavras portuguesas que não são palavras inglesas
const WORDS = /\b(não|você|voce|com|para|pelo|pela|quem|cada|ainda|aqui|até|dos|das|nas|uma|mortes?|nenhum|nenhuma|mais|menos|depois|antes|isso|esta|este|sua|seu|que|por|mas|ou|em|na|ao|os|da)\b/i;
/** Dados que ficam iguais nas duas línguas (exemplos de nome de player, caminhos). */
const ALLOWED = [/Eternål/g, /https?:\/\/\S+/g, /warcraftlogs\.com\S*/g, /World of Warcraft\\_retail_\\Logs/g];

const modules = import.meta.glob<Record<string, unknown>>('../**/*.i18n.{ts,tsx}', { eager: true });

const SAMPLES: unknown[] = [3, 'X', (s: string) => s, true];

/** Monta o texto: chama a frase com exemplos (o primeiro tipo que funcionar) e renderiza o JSX. */
function render(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(render);
  if (isValidElement(v)) return [renderToStaticMarkup(v)];
  if (typeof v === 'function') {
    const out: string[] = [];
    for (const s of SAMPLES)
      try {
        out.push(...render(v(...Array.from({ length: Math.max(1, v.length) }, () => s))));
      } catch {
        /* parâmetro de outro tipo: tenta o próximo */
      }
    // frases com parâmetros booleanos: as duas formas
    try {
      out.push(...render(v(...Array.from({ length: Math.max(1, v.length) }, () => false))));
    } catch {
      /* ok */
    }
    return out;
  }
  if (v && typeof v === 'object') return Object.values(v).flatMap(render);
  return [];
}

const isMessages = (v: unknown): v is Messages<unknown> => !!v && typeof v === 'object' && 'pt' in v && 'en' in v;

describe('dicionários', () => {
  it('o inglês não tem português', () => {
    const offenders: string[] = [];
    let count = 0;
    for (const [file, mod] of Object.entries(modules))
      for (const [name, m] of Object.entries(mod)) {
        if (!isMessages(m)) continue;
        count++;
        for (const text of render(m.en)) {
          const clean = ALLOWED.reduce((s, re) => s.replace(re, ''), text.replace(/<[^>]+>/g, ' '));
          if (ACCENT.test(clean) || WORDS.test(clean)) offenders.push(`${file} ${name}: ${clean.slice(0, 120)}`);
        }
      }
    expect(count).toBeGreaterThan(40);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
