import { describe, expect, it, vi } from 'vitest';
import { dismissError, errorMessage, onErrors, reportError, type AppError } from './errors';

describe('erros sem tratamento', () => {
  it('mensagem de qualquer coisa que foi lançada', () => {
    expect(errorMessage(new Error('falhou'))).toBe('falhou');
    expect(errorMessage('texto')).toBe('texto');
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
  });

  it('avisa, junta repetidos e guarda no máximo 3', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let seen: AppError[] = [];
    const off = onErrors((e) => (seen = e));
    reportError(new Error('A'), 'Aba X');
    reportError(new Error('A'), 'Aba X'); // repetido em sequência: um aviso só
    expect(seen.map((e) => [e.where, e.message])).toEqual([['Aba X', 'A']]);
    ['B', 'C', 'D'].forEach((m) => reportError(new Error(m)));
    expect(seen.map((e) => e.message)).toEqual(['B', 'C', 'D']);
    dismissError(seen[0].id);
    expect(seen.map((e) => e.message)).toEqual(['C', 'D']);
    off();
  });
});
