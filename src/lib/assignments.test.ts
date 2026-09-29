import { describe, expect, it } from 'vitest';
import type { CastOutcome, MechanicResult } from '../types';
import { checkAssignments, parseAssignments } from './assignments';
import { player, pull } from './test-fixtures';

const cast = (t: number, src: string, by: string | null): CastOutcome => ({
  t, sourceGuid: src, source: `Add ${src}`, interruptedBy: by ? `${by}-Realm` : null, interruptedByGuid: by,
});

const wail = (casts: CastOutcome[]): MechanicResult => ({
  key: 'wail', name: 'Wail of Terror', spellId: 1286399, kind: 'interrupt', severity: 'major', tip: '', evaluated: true,
  failures: casts.filter((c) => !c.interruptedBy).length, summary: '', players: [], events: [], casts,
});

const p = pull(0, 0, 60_000, {
  players: ['Fulano', 'Ciclano', 'Beltrano', 'Eternål', 'Zé'].map((n) => player(n)),
  mechanics: [wail([])],
});

describe('parseAssignments', () => {
  it('lê nota do MRT com cores, spell e nomes com acento', () => {
    const note = [
      'intstart',
      '{spell:1286399} ||cffc41e3aFulano||r ||cff0070ddCiclano||r {rt1}',
      '||cffffffffEternål||r Beltrano',
      'intend',
    ].join('\n');
    expect(parseAssignments(note, p).get('wail')).toEqual([['Fulano', 'Ciclano'], ['Eternål', 'Beltrano']]);
  });

  it('aceita a escala escrita à mão e ignora quem não está no raid', () => {
    expect(parseAssignments('Wail of Terror: fulano, Ninguém, zé', p).get('wail')).toEqual([['Fulano', 'Zé']]);
  });
});

describe('checkAssignments', () => {
  it('com um grupo, a vez gira por cast mesmo com um add novo a cada cast', () => {
    const m = wail([cast(1, 'A', 'Fulano'), cast(2, 'B', null), cast(3, 'C', 'Fulano')]);
    const r = checkAssignments(m, [['Fulano', 'Ciclano']]);
    expect(r.casts.map((c) => c.assigned)).toEqual(['Fulano', 'Ciclano', 'Fulano']);
    expect(r.kickers[0]).toMatchObject({ name: 'Ciclano', missed: 1 });
  });

  it('confere a vez de cada um por add', () => {
    // add A: Fulano, Ciclano, Fulano... ; add B: Eternål, Beltrano...
    const m = wail([cast(1, 'A', 'Fulano'), cast(2, 'B', 'Eternål'), cast(3, 'A', null), cast(4, 'B', 'Fulano'), cast(5, 'A', 'Fulano')]);
    const r = checkAssignments(m, [['Fulano', 'Ciclano'], ['Eternål', 'Beltrano']]);
    expect(r.casts.map((c) => [c.assigned, c.by])).toEqual([
      ['Fulano', 'Fulano'],
      ['Eternål', 'Eternål'],
      ['Ciclano', null],
      ['Beltrano', 'Fulano'],
      ['Fulano', 'Fulano'],
    ]);
    const by = Object.fromEntries(r.kickers.map((k) => [k.name, k]));
    expect(by.Ciclano).toMatchObject({ turns: 1, kept: 0, missed: 1 });
    expect(by.Beltrano).toMatchObject({ turns: 1, kept: 0, missed: 0 });
    expect(by.Fulano).toMatchObject({ turns: 2, kept: 2, covered: 1 });
    expect(r.kickers[0].name).toBe('Ciclano');
  });
});
