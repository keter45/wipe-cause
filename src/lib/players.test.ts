import { describe, expect, it } from 'vitest';
import { classOf, namesRegex, playerClasses, richRegex } from './players';
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

  it('acha as habilidades do log no texto, a maior primeiro, e nunca um nome de personagem', () => {
    const spells = playerClasses([
      pull(0, 0, 60_000, {
        players: [
          player('A', {
            name: 'Darq-Azralon-US',
            class: 'Paladin',
            casts: [
              { spellId: 20473, name: 'Holy Shock', times: [1000] },
              { spellId: 375576, name: 'Divine Toll', times: [2000] },
              { spellId: 1, name: 'Melee', times: [3000] },
              { spellId: 9, name: 'Darq', times: [3000] },
            ],
          }),
        ],
      }),
    ]);
    expect(spells.spells.get('Holy Shock')).toBe(20473);
    expect(spells.spells.has('Melee')).toBe(false);
    expect(spells.spells.has('Darq')).toBe(false);
    const found = [...'Darq: Divine Toll e Holy Shock, Holy Shockwave não'.matchAll(richRegex(spells)!)].map((m) => m[0]);
    expect(found).toEqual(['Darq', 'Divine Toll', 'Holy Shock']);
  });
});
