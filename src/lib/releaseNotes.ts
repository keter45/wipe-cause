// Notas de versão nas duas línguas: o arquivo da release tem uma seção `## Português` e uma
// `## English` (o GitHub mostra as duas); o app mostra só a do idioma escolhido.

import type { Locale } from '../i18n';

export const NOTES_HEADINGS: Record<Locale, string> = { pt: '## Português', en: '## English' }; // i18n-ignore: marcador do arquivo

/** As seções de cada língua; null quando o texto não está dividido (notas antigas). */
export function splitNotes(notes: string): Record<Locale, string> | null {
  const lines = notes.split(/\r?\n/);
  const at = (l: Locale) => lines.findIndex((x) => x.trim() === NOTES_HEADINGS[l]);
  const pt = at('pt');
  const en = at('en');
  if (pt < 0 || en < 0) return null;
  const section = (from: number, to: number) => lines.slice(from + 1, to > from ? to : undefined).join('\n').trim();
  return { pt: section(pt, en), en: section(en, pt) };
}

/** As notas no idioma pedido (ou o texto inteiro, se não estiver dividido). */
export const notesIn = (notes: string, locale: Locale) => splitNotes(notes)?.[locale] ?? notes;
