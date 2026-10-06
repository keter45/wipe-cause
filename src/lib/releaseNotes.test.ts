import { describe, expect, it } from 'vitest';
import { notesIn, splitNotes } from './releaseNotes';

const NOTES = '## Português\n- Interface em inglês\n\n## English\n- English interface\n';

describe('notas de versão', () => {
  it('mostra só a seção do idioma', () => {
    expect(notesIn(NOTES, 'pt')).toBe('- Interface em inglês');
    expect(notesIn(NOTES, 'en')).toBe('- English interface');
  });
  it('a ordem das seções não importa', () => {
    expect(splitNotes('## English\nB\n## Português\nA')).toEqual({ pt: 'A', en: 'B' });
  });
  it('notas sem seções aparecem inteiras', () => {
    expect(notesIn('- só uma língua', 'en')).toBe('- só uma língua');
  });
});
