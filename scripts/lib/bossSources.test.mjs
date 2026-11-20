import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { CsvParser, parseCsv, streamCsv, loadDb2, journal, parseBigWigsLua, flagNames } from './bossSources.mjs';

const CSV = 'ID,Name_lang,Body\r\n1,"Fire, ball","linha 1\nlinha ""2"""\r\n2,Simples,\r\n3,"",fim';

describe('CSV em fluxo', () => {
  it('lê aspas, vírgula, "" e quebra de linha dentro de campo', () => {
    const rows = parseCsv(CSV);
    expect(rows).toEqual([
      { ID: '1', Name_lang: 'Fire, ball', Body: 'linha 1\nlinha "2"' },
      { ID: '2', Name_lang: 'Simples', Body: '' },
      { ID: '3', Name_lang: '', Body: 'fim' },
    ]);
  });
  it('dá o mesmo resultado em pedaços de 1 caractere (aspas e \r\n cortados)', async () => {
    const out = [];
    await streamCsv(Readable.from([...CSV]), (r) => out.push(r));
    expect(out).toEqual(parseCsv(CSV));
  });
  it('última linha sem quebra e BOM', () => {
    expect(parseCsv('﻿A,B\n1,2')).toEqual([{ A: '1', B: '2' }]);
    const p = new CsvParser();
    expect(p.push('a,b')).toEqual([]);
    expect(p.end()).toEqual([['a', 'b']]);
  });
});

describe('loadDb2 e journal (cache sintético, sem rede)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db2-'));
  const w = (t, s) => fs.writeFileSync(path.join(dir, `${t}.csv`), s);
  w('JournalEncounter', 'Name_lang,ID,JournalInstanceID,DungeonEncounterID\nBoss X,500,70,9001\nOutro,501,70,9002\n');
  w('JournalInstance', 'ID,Name_lang\n70,"Raide, Teste"\n');
  w(
    'JournalEncounterSection',
    [
      'ID,Title_lang,BodyText_lang,JournalEncounterID,OrderIndex,ParentSectionID,Type,SpellID,IconFlags,DifficultyMask',
      '1,Stage One,,500,1,0,0,0,0,-1',
      '2,Section 2,,500,2,1,2,111,80,-1', // flags 4 (deadly) + 6 (interruptible)
      '3,Fogo,,500,3,1,2,222,1,-1',
      '4,Ignorada,,501,1,0,2,333,0,-1',
    ].join('\n'),
  );
  w('SpellName', 'ID,Name_lang\n111,Shadow Bolt\n222,Fire Pool\n333,Nada\n');
  w('Spell', 'ID,NameSubtext_lang,Description_lang,AuraDescription_lang\n222,,"Chão ""queima""",\n');
  w(
    'SpellEffect',
    'ID,Effect,EffectMiscValue_0,EffectRadiusIndex_0,EffectRadiusIndex_1,SpellID\n1,179,55,0,0,222\n2,2,0,9,10,222\n3,2,0,0,0,111\n4,2,0,9,0,999\n',
  );
  w('SpellMisc', 'ID,DifficultyID,CastingTimeIndex,DurationIndex,SpellID\n1,0,4,6,222\n2,0,0,0,111\n');
  w('SpellRadius', 'ID,Radius\n9,8\n10,12\n');
  w('SpellDuration', 'ID,Duration\n6,6000\n');
  w('SpellCastTimes', 'ID,Base\n4,2500\n');
  w('AreaTriggerCreateProperties', 'ID,ShapeType\n55,0\n56,7\n');

  it('filtra por linha', async () => {
    const rows = await loadDb2('SpellName', { cacheDir: dir, filter: (r) => r.ID === '222' });
    expect(rows).toEqual([{ ID: '222', Name_lang: 'Fire Pool' }]);
  });
  it('monta o journal', async () => {
    const j = await journal(9001, { cacheDir: dir });
    expect(j).toMatchObject({ encounterId: 9001, journalId: 500, name: 'Boss X', instance: { id: 70, name: 'Raide, Teste' } });
    expect(j.sections.map((s) => s.title)).toEqual(['Stage One', 'Shadow Bolt', 'Fogo']); // "Section 2" → nome do spell
    expect(j.sections[1]).toMatchObject({ spellId: 111, parentId: 1, flags: ['deadly', 'interruptible'] });
    expect(j.spells[222]).toEqual({
      name: 'Fire Pool',
      description: 'Chão "queima"',
      radiusYd: [8, 12],
      durationMs: 6000,
      castMs: 2500,
      areaTriggerShape: 'sphere',
    });
    expect(j.spells[111].radiusYd).toEqual([]);
    expect(j.spells[333]).toBeUndefined();
  });
  it('encontro desconhecido → null; extraSpellIds entram em spells', async () => {
    expect(await journal(1, { cacheDir: dir })).toBeNull();
    const j = await journal(9001, { cacheDir: dir, extraSpellIds: [999] });
    expect(j.spells[999].radiusYd).toEqual([8]);
  });
  it('bits de IconFlags', () => {
    expect(flagNames(0b10000001)).toEqual(['tank', 'magic']);
    expect(flagNames(1 << 13)).toEqual(['bleed']);
  });
});

const LUA = `
local mod, CL = BigWigs:NewBoss("Kith'ix", 3095, 2896)
mod:RegisterEnableMob(267861) -- Kith'ix
mod:RegisterEnableMob(267862, 267863)
mod:SetEncounterID(3513)
mod:SetAuraData({
	{1304045, soundOnApplied = "warning"}, -- Unspeakable Horrors
	{1304948, soundOnApplied = "alarm"}, -- Devastated (tank)
	-- Adds
	{1302319, soundOnAppliedDose = "none", header = CL.adds}, -- Digestive Juice (Bomber Beetle)
})
function mod:GetOptions()
	return {
		"stages",
		-- Stage One
		1301511, -- Voidswarm
		{1304045, "ME_ONLY_EMPHASIZE"}, -- Unspeakable Horrors
		{1304930, "CASTBAR"}, -- Dark Devastation
	}, {
		[1301511] = -36392, -- Stage 1
	}
end
function mod:OnBossEnable()
	self:Log("SPELL_CAST_START", "DarkDevastation", 1304930, 1304931)
	self:Log("SPELL_DAMAGE", "Pool", 1306000)
end
`;

describe('parseBigWigsLua', () => {
  const r = parseBigWigsLua(LUA);
  it('npcs', () => expect(r.npcs).toEqual([267861, 267862, 267863]));
  it('auras com (tank) e nome do comentário', () => {
    expect(r.auras).toEqual([
      { spellId: 1304045, name: 'Unspeakable Horrors', tank: false },
      { spellId: 1304948, name: 'Devastated', tank: true },
      { spellId: 1302319, name: 'Digestive Juice', tank: false },
    ]);
  });
  it('opções (sem as chaves [id] =)', () => expect(r.options).toEqual([1301511, 1304045, 1304930]));
  it('self:Log', () => {
    expect(r.logs).toEqual([
      { event: 'SPELL_CAST_START', handler: 'DarkDevastation', ids: [1304930, 1304931] },
      { event: 'SPELL_DAMAGE', handler: 'Pool', ids: [1306000] },
    ]);
  });
});
