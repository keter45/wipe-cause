import { describe, it, expect } from 'vitest';
import { slug, draftRule, idRoles } from './bossDraft.mjs';

const journal = {
  encounterId: 9001,
  journalId: 500,
  name: "Kith'ix",
  instance: { id: 70, name: "The Unbinding of Kith'ix" },
  sections: [
    { id: 1, parentId: 0, title: "Stage One: Darkness' Domain", spellId: 0, flags: [], difficultyMask: -1, body: '' },
    { id: 2, parentId: 0, title: 'Intermission: Suffocating Darkness', spellId: 0, flags: [], difficultyMask: -1, body: '' },
    { id: 3, parentId: 0, title: 'Stage Two: Last Light', spellId: 0, flags: [], difficultyMask: -1, body: '' },
    { id: 10, parentId: 1, title: 'Shadow Bolt', spellId: 111, flags: ['interruptible'], difficultyMask: -1, body: '' },
    { id: 11, parentId: 1, title: 'Dark Devastation', spellId: 222, flags: ['tank'], difficultyMask: -1, body: '' },
    { id: 12, parentId: 1, title: 'Dark Devastation', spellId: 222, flags: ['tank', 'heroic'], difficultyMask: -1, body: '' },
    { id: 13, parentId: 1, title: 'Extinguish', spellId: 333, flags: ['deadly', 'important'], difficultyMask: -1, body: '' },
    { id: 14, parentId: 1, title: 'Incubation', spellId: 444, flags: ['damage', 'heroic'], difficultyMask: 0, body: '' },
    { id: 15, parentId: 1, title: 'Incubation', spellId: 444, flags: ['damage', 'mythic'], difficultyMask: 0, body: '' },
    { id: 16, parentId: 1, title: 'Devastated', spellId: 555, flags: ['important'], difficultyMask: -1, body: '' },
    { id: 17, parentId: 1, title: 'Fire Pool', spellId: 666, flags: [], difficultyMask: -1, body: '' },
  ],
  spells: {
    333: { name: 'Extinguish', description: 'Burns $1304508s1 all.', radiusYd: [8], durationMs: 6000, castMs: 2500, areaTriggerShape: 'sphere' },
    666: { name: 'Fire Pool', radiusYd: [300], durationMs: 604800000, castMs: null, areaTriggerShape: null },
  },
};
const bigwigs = {
  file: 'X/Kithix.lua',
  npcs: [267861, 267862],
  auras: [{ spellId: 555, name: 'Devastated', tank: true }],
  options: [],
  logs: [{ event: 'SPELL_CAST_SUCCESS', handler: 'Ext', ids: [333] }],
};

describe('slug', () => {
  it('kebab-case ASCII', () => {
    expect(slug("Kith'ix")).toBe('kithix');
    expect(slug("The Unbinding of Kith'ix")).toBe('the-unbinding-of-kithix');
    expect(slug('Naïve  Boss — 2')).toBe('naive-boss-2');
  });
});

describe('draftRule', () => {
  const yaml = draftRule(
    { journal, bigwigs, ids: { spells: [{ spellId: 666, castStart: 0, castSuccess: 0, auraOnPlayers: 0, damageHits: 12 }], units: [{ npc_id: 900, name: 'Add' }] } },
    { date: '2026-11-20' },
  );
  const has = (s) => expect(yaml).toContain(s);
  const blk = (k) => yaml.split('\n  - key: ').find((b) => b.startsWith(k));

  it('cabeçalho e units', () => {
    has('# RASCUNHO do `npm run boss:new`');
    has('raid: the-unbinding-of-kithix');
    has('boss: kithix');
    has('encounter_id: 9001');
    has('{ key: kithix, name: "Kith\'ix", npc_id: 267861, boss: true }');
    has('npc_id: 267862');
    has('{ key: add, name: "Add", npc_id: 900 }');
  });
  it('fases só com key/name (a primeira abre no pull)', () => {
    has('{ key: p1, name: "Stage One: Darkness\' Domain", start: pull }');
    has('{ key: intermission, name: "Intermission: Suffocating Darkness" }');
    has('{ key: p2, name: "Stage Two: Last Light" }');
  });
  it('uma mecânica por spell, sem duplicar', () => {
    expect(yaml.match(/key: dark_devastation/g)).toHaveLength(1);
    expect(yaml.match(/key: incubation/g)).toHaveLength(1);
  });
  it('interrupt, tank, severidade, dificuldade', () => {
    expect(blk('shadow_bolt')).toMatch(/type: interrupt/);
    expect(blk('shadow_bolt')).toMatch(/needs_id: true/); // interrupt sem cast confirmado
    expect(blk('dark_devastation')).toMatch(/roles: \[tank\]/);
    expect(blk('dark_devastation')).not.toMatch(/difficulty:/); // uma aparição sem heroico: todas
    expect(blk('extinguish')).toMatch(/severity: wipe/);
    expect(blk('devastated')).toMatch(/severity: major/);
    expect(blk('devastated')).toMatch(/roles: \[tank\]/); // aura (tank) do BigWigs
    expect(blk('incubation')).toMatch(/difficulty: \[heroic, mythic\]/);
    expect(blk('fire_pool')).toMatch(/severity: minor/);
  });
  it('ids por papel e needs_id', () => {
    expect(blk('extinguish')).toMatch(/detect: \{ cast_id: 333 \}/);
    expect(blk('extinguish')).not.toMatch(/needs_id/);
    expect(blk('devastated')).toMatch(/detect: \{ aura_id: 555 \}/);
    expect(blk('fire_pool')).toMatch(/detect: \{ damage_ids: \[666\] \}/);
    expect(blk('dark_devastation')).toMatch(/needs_id: true/);
  });
  it('dica do jogo em cima da mecânica, sem alcance/duração de 1 semana', () => {
    has('# jogo: raio 8 jd, dura 6 s, cast 2,5 s, areatrigger esfera (dica; o log manda)');
    expect(yaml).not.toMatch(/raio 300/);
    expect(yaml).not.toMatch(/dura 604800/);
  });
  it('tip e message a revisar nas duas línguas', () => {
    has('tip: { pt: "A revisar", en: "To review" }');
    has('message: { pt: "A revisar", en: "To review" }');
  });
  it('sem nada: só o essencial', () => {
    const y = draftRule({ journal: { ...journal, sections: [] }, bigwigs: null }, { date: '2026-11-20' });
    expect(y).toContain('npc_id: null, boss: true');
    expect(y).toContain('mechanics:');
  });
});

describe('idRoles', () => {
  it('lê mapa e lista, camelCase e snake_case', () => {
    expect(idRoles({ spells: [{ spellId: 1, castStart: 1, castSuccess: 1, auraOnPlayers: 0, damageHits: 3 }] }).get(1)).toEqual({ cast: true, aura: false, damage: true });
    expect(idRoles({ spells: [{ spellId: 2, auraOnPlayers: 4 }] }).get(2)).toEqual({ cast: false, aura: true, damage: false });
    expect(idRoles(null).size).toBe(0);
  });
});
