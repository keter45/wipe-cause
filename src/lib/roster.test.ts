import { describe, expect, it } from 'vitest';
import { coreRoster, isGuildGroup, nightKind } from './roster';

// núcleo: A–E jogam toda noite; no pug aparecem X1, X2... (cada um uma vez) e o personagem alternativo Z
const core = ['A', 'B', 'C', 'D', 'E'];
const nights = [core, core, core, [...core, 'F'], ['Z', 'X1', 'X2', 'X3', 'X4']];

describe('guilda x pug', () => {
  const roster = coreRoster(nights);

  it('núcleo: quem esteve em 3+ noites', () => {
    expect([...roster.core].sort()).toEqual(core);
    expect(roster.known).toBe(true);
  });

  it('a maioria do núcleo é guilda; quase ninguém do núcleo é pug', () => {
    expect(isGuildGroup([...core, 'F', 'G'], roster)).toBe(true); // 5 de 7
    expect(isGuildGroup(['Z', 'X1', 'X2', 'A'], roster)).toBe(false); // 1 de 4
  });

  it('com poucas noites não dá para saber', () => {
    expect(isGuildGroup(core, coreRoster([core, core]))).toBeNull();
    expect(isGuildGroup([], roster)).toBeNull();
  });

  it('a noite: guilda, pug ou as duas', () => {
    expect(nightKind([true, true])).toBe('guild');
    expect(nightKind([false])).toBe('pug');
    expect(nightKind([true, false, null])).toBe('mixed');
    expect(nightKind([null])).toBeNull();
  });
});
