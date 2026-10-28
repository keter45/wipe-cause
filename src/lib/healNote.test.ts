import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhaseMark, Pull } from '../types';
import { defaultFromPull, editNote, exportNote, mapPhases, MAX_VERSIONS, newVersion, noteFor, noteVersions, parseNote, setFromPull } from './healNote';
import { player, pull } from './test-fixtures';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

// a note de exemplo da guilda, com nomes fictícios
const NOTE = [
  'EncounterID:3429;Name:Coiled Altar 2 - Guilda;Difficulty:Mythic',
  'time:2;ph:1;tag:Healpriest;spellid:64843;',
  'time:47;ph:1;tag:everyone;text:Personals;',
  'time:47;ph:1;tag:Warrior;spellid:97462;',
  'time:15;ph:2.5;tag:Druida;spellid:29166;glowunit:Healpriest;',
  'time:14;ph:3;tag:Evoker;spellid:370537;',
  '',
  'intstart',
  'Kicker Kicker Kicker Kicker',
  'intend',
].join('\n');

describe('parseNote / exportNote', () => {
  it('lê cabeçalho, linhas, glowunit e o bloco de interrupts', () => {
    const n = parseNote(NOTE);
    expect(n.header).toEqual({ encounterId: 3429, name: 'Coiled Altar 2 - Guilda', difficulty: 'Mythic' });
    expect(n.isNsrt).toBe(true);
    expect(n.lines[1]).toMatchObject({ time: 2, ph: '1', tag: 'Healpriest', spellId: 64843 });
    expect(n.lines[2]).toMatchObject({ tag: 'everyone', text: 'Personals' });
    expect(n.lines[4]).toMatchObject({ ph: '2.5', glowunit: 'Healpriest' });
    expect(n.lines[8].ph).toBeUndefined();
    expect(n.intBlock).toBe('Kicker Kicker Kicker Kicker');
  });

  it('intstart em maiúsculas e sem intend vai até o fim; texto livre não é NSRT', () => {
    expect(parseNote('INTSTART\nFulano Ciclano').intBlock).toBe('Fulano Ciclano');
    const free = parseNote('Wail of Terror: Fulano, Ciclano');
    expect(free.isNsrt).toBe(false);
    expect(free.intBlock).toBeNull();
  });

  it('ida e volta sem mudanças devolve o texto igual', () => {
    expect(exportNote(parseNote(NOTE))).toBe(NOTE);
  });

  it('mover troca só o time da linha', () => {
    const out = exportNote(parseNote(NOTE), [{ kind: 'move', line: 3, time: 52.4 }]).split('\n');
    expect(out[3]).toBe('time:52;ph:1;tag:Warrior;spellid:97462;');
    expect(out.filter((_, i) => i !== 3)).toEqual(NOTE.split('\n').filter((_, i) => i !== 3));
  });

  it('adicionar entra depois da última linha da fase com time menor ou igual', () => {
    const add = (time: number, ph: string) => exportNote(parseNote(NOTE), [{ kind: 'add', time, ph, tag: 'Druida', spellId: 740 }]).split('\n');
    expect(add(30, '1')[2]).toBe('time:30;ph:1;tag:Druida;spellid:740;'); // no meio do P1
    expect(add(1, '1')[1]).toBe('time:1;ph:1;tag:Druida;spellid:740;'); // antes da primeira linha da fase
    expect(add(5, '2')[4]).toBe('time:5;ph:2;tag:Druida;spellid:740;'); // fase sem linhas: depois da última de ph menor
    expect(add(90, '3')[6]).toBe('time:90;ph:3;tag:Druida;spellid:740;'); // depois da última linha
  });
});

describe('mapPhases', () => {
  const m = (key: string, t: number): PhaseMark => ({ key, name: key, t });

  it('p1/p2/intermission/p3 viram 1, 2, 2.5 e 3', () => {
    const r = mapPhases([m('p1', 0), m('p2', 168_000), m('intermission', 365_000), m('p3', 402_000)]);
    expect([...r.keys()]).toEqual(['1', '2', '2.5', '3']);
    expect(r.get('2.5')?.t).toBe(365_000);
  });

  it('sem phases, ph:1 é o pull inteiro; fase repetida conta a primeira vez', () => {
    expect(mapPhases([]).get('1')).toEqual({ key: 'p1', name: '', t: 0 });
    expect(mapPhases([m('p1', 0), m('p2', 100), m('p1', 200)]).get('1')?.t).toBe(0);
  });

  it('duas fases sem p<n> seguidas ficam sem par', () => {
    const r = mapPhases([m('p1', 0), m('int_a', 100), m('int_b', 200), m('p2', 300)]);
    expect(r.has('1.5')).toBe(false);
    expect(r.get('2')?.t).toBe(300);
  });
});

describe('versões da note', () => {
  beforeEach(() => store.clear());
  const boss = { encounterId: 1, difficultyId: 16 };
  // noite de 26/10 (startMs em UTC, tzOffsetHours 0)
  const at = Date.UTC(2026, 9, 26, 21);
  const roster = (...names: string[]) => names.map((n) => player(n));
  const night = (n: number, people = roster('Healpriest', 'Warrior')): Pull[] =>
    Array.from({ length: n }, (_, i) => pull(i, at + i * 600_000, 300_000, { players: people }));
  const note = 'time:2;ph:1;tag:Healpriest;spellid:64843;\ntime:47;ph:1;tag:Warrior;spellid:97462;';

  it('migra a chave atual para a primeira versão, sem noite', () => {
    store.set('wipe-cause:assignments:1:16', 'Fulano Ciclano');
    expect(noteVersions(boss)).toEqual([{ text: 'Fulano Ciclano', savedAt: 0, night: null, fromPull: 0, fromPullManual: false }]);
  });

  it('CUJ 1: colar depois da noite cria a versão da noite a partir do primeiro pull com todos os nomes', () => {
    const pulls = [pull(0, at, 1, { players: roster('Healpriest') }), ...night(4).slice(1)];
    const v = editNote(boss, note, pulls, false, at + 10 ** 7);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ night: '2026-10-26', fromPull: 2, fromPullManual: false });
    expect(store.get('wipe-cause:assignments:1:16')).toBe(note);
    // apagar e colar de novo recalcula o N
    editNote(boss, `${note}\ntime:3;ph:1;tag:Ninguém;spellid:1;`, night(4), false, at + 10 ** 7 + 1);
    expect(noteVersions(boss)[0].fromPull).toBe(1);
  });

  it('CUJ 4 ao vivo: nova versão copia a mais nova e a anterior fica com o texto original', () => {
    const live = night(2);
    editNote(boss, note, live, true, at + 1); // antes do pull 3
    expect(noteVersions(boss)[0].fromPull).toBe(3);
    const more = night(6);
    newVersion(boss, more, true, at + 2); // antes do pull 7
    editNote(boss, `${note}\ntime:90;ph:1;tag:Healpriest;spellid:740;`, more, true, at + 3);
    const [v1, v2] = noteVersions(boss);
    expect(v1.text).toBe(note);
    expect(v2).toMatchObject({ fromPull: 7 });
    expect(v2.text).toContain('spellid:740');
    expect(noteFor(more[3], more, noteVersions(boss))?.savedAt).toBe(v1.savedAt);
    expect(noteFor(pull(6, at + 7 * 600_000, 1), more, noteVersions(boss))?.savedAt).toBe(v2.savedAt);
  });

  it('N trocado à mão não é recalculado; editar a versão da noite não muda savedAt', () => {
    const pulls = night(4);
    const [v] = editNote(boss, note, pulls, false, at + 5);
    setFromPull(boss, v.savedAt, 3);
    editNote(boss, `${note}\n`, pulls, false, at + 99);
    expect(noteVersions(boss)[0]).toMatchObject({ fromPull: 3, fromPullManual: true, savedAt: v.savedAt });
  });

  it('a versão da semana passada julga os pulls antes da primeira versão da noite; sem versão, fica fora', () => {
    const week = night(3).map((p) => ({ ...p, startMs: p.startMs - 7 * 86_400_000 }));
    expect(noteFor(night(1)[0], night(4), [])).toBeNull();
    editNote(boss, 'antiga', week, false, at - 6 * 86_400_000);
    const pulls = night(4);
    const versions = editNote(boss, note, pulls, true, at + 1_800_000); // ao vivo, depois do pull 3 → vale a partir do 5
    expect(noteFor(pulls[1], pulls, versions)?.text).toBe('antiga');
  });

  it('texto vazio numa versão de outra noite não cria nem apaga nada', () => {
    store.set('wipe-cause:assignments:1:16', 'antiga');
    expect(editNote(boss, '  ', night(2), false, at)).toHaveLength(1);
    expect(store.get('wipe-cause:assignments:1:16')).toBe('antiga');
  });

  it('a chave atual fica com o texto da mais nova; guarda até MAX_VERSIONS', () => {
    const pulls = night(2);
    editNote(boss, 'v0', pulls, false, at);
    for (let i = 1; i <= MAX_VERSIONS + 2; i++) newVersion(boss, pulls, false, at + i);
    editNote(boss, 'última', pulls, false, at + 100);
    expect(noteVersions(boss)).toHaveLength(MAX_VERSIONS);
    expect(store.get('wipe-cause:assignments:1:16')).toBe('última');
  });

  it('N padrão sem os nomes completos em nenhum pull é o primeiro pull', () => {
    expect(defaultFromPull(note, night(3, roster('Outro')), false, false)).toBe(1);
  });
});
