import { describe, expect, it } from 'vitest';
import { parseWclCode, savedWclLink, sourceName, wclSourceCode } from './api';

describe('análise a partir do Warcraft Logs', () => {
  it('lê o código do link ou do próprio código', () => {
    expect(parseWclCode('https://www.warcraftlogs.com/reports/vbCJ2N7yGVYczdr3#fight=17&type=damage-done')).toBe('vbCJ2N7yGVYczdr3');
    expect(parseWclCode('  vbCJ2N7yGVYczdr3 ')).toBe('vbCJ2N7yGVYczdr3');
    expect(parseWclCode('abc')).toBeNull();
    expect(parseWclCode('')).toBeNull();
  });

  it('identifica a fonte e já sabe o link do report', () => {
    expect(wclSourceCode('wcl:vbCJ2N7yGVYczdr3')).toBe('vbCJ2N7yGVYczdr3');
    expect(wclSourceCode('C:/Logs/WoWCombatLog.txt')).toBeNull();
    expect(sourceName('wcl:vbCJ2N7yGVYczdr3')).toBe('Warcraft Logs · vbCJ2N7yGVYczdr3');
    expect(sourceName('C:\\Logs\\WoWCombatLog-092926.txt')).toBe('WoWCombatLog-092926.txt');
    expect(sourceName('D:/Logs/WoWCombatLog-092926.txt')).toBe('WoWCombatLog-092926.txt');
    expect(savedWclLink('wcl:vbCJ2N7yGVYczdr3')).toBe('https://www.warcraftlogs.com/reports/vbCJ2N7yGVYczdr3');
  });
});
