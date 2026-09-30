import { describe, expect, it } from 'vitest';
import { classOf, namesRegex, playerClasses } from './players';
import { player, pull } from './test-fixtures';

describe('nomes coloridos', () => {
  const pc = playerClasses([pull(0, 0, 60_000, { players: [player('A', { name: 'Darq-Azralon-US', class: 'Paladin' }), player('B', { name: 'Maravalhas-Azralon-US', class: 'Priest' })] })]);

  it('acha a classe por guid, nome completo ou curto', () => {
    expect(classOf(pc, 'A')).toBe('Paladin');
    expect(classOf(pc, 'Darq-Azralon-US')).toBe('Paladin');
    expect(classOf(pc, 'Maravalhas')).toBe('Priest');
    expect(classOf(pc, 'Ninguém')).toBeNull();
  });

  it('acha os nomes dentro de um texto só como palavra inteira', () => {
    const re = namesRegex(pc)!;
    const found = [...'Darq estava perto do machado · Maravalhas soakou · Darquinho não conta'.matchAll(re)].map((m) => m[0]);
    expect(found).toEqual(['Darq', 'Maravalhas']);
  });
});
