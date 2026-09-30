import { describe, expect, it } from 'vitest';
import { historyQuery, metricFor, parseColor, rankingEntries, serverSlug, splitName } from './wclParses';
import type { PlayerStats } from '../types';

const player = (name: string, role: PlayerStats['role']) => ({ name, role, guid: name }) as PlayerStats;

describe('wclParses', () => {
  it('ranking do papel: healer em HPS, dps e tank em DPS', () => {
    expect(metricFor('healer')).toBe('hps');
    expect(metricFor('dps')).toBe('dps');
    expect(metricFor('tank')).toBe('dps');
  });

  it('separa nome, reino e região', () => {
    expect(splitName('Markíno-Azralon-US')).toEqual({ name: 'Markíno', server: 'Azralon', region: 'US' });
    expect(splitName('Foo-Area-52-US')).toEqual({ name: 'Foo', server: 'Area-52', region: 'US' });
    expect(serverSlug("Quel'Thalas")).toBe('quelthalas');
    expect(serverSlug('Burning Legion')).toBe('burning-legion');
  });

  it('pega cada papel do seu ranking', () => {
    const json = {
      data: [
        {
          roles: {
            tanks: { characters: [{ name: 'Tank', server: { name: 'Azralon' }, rankPercent: 40 }] },
            healers: { characters: [{ name: 'Heal', server: { name: 'Azralon' }, rankPercent: 90 }] },
            dps: { characters: [{ name: 'Mage', server: { name: 'Azralon' }, rankPercent: 70 }] },
          },
        },
      ],
    };
    expect([...rankingEntries(json, 'dps').keys()].sort()).toEqual(['mage|azralon', 'tank|azralon']);
    expect([...rankingEntries(json, 'hps').keys()]).toEqual(['heal|azralon']);
    expect(rankingEntries(null, 'dps').size).toBe(0);
  });

  it('histórico pede a métrica do papel de cada player', () => {
    const q = historyQuery([player('Heal-Azralon-US', 'healer'), player('Mage-Azralon-US', 'dps')], 3470, 5);
    expect(q).toContain('p0: character(name: "Heal", serverSlug: "azralon", serverRegion: "us")');
    expect(q).toContain('encounterID: 3470, difficulty: 5, metric: hps');
    expect(q).toContain('p1: character(name: "Mage"');
    expect(q).toMatch(/p1:.*metric: dps/);
  });

  it('cores do site', () => {
    expect(parseColor(100)).toBe('#e5cc80');
    expect(parseColor(96)).toBe('#ff8000');
    expect(parseColor(10)).toBe('#9d9d9d');
  });
});
