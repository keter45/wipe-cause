import { describe, expect, it } from 'vitest';
import { cleanTuning, exportTuning, parseTuningFile, type RuleMechanic } from './rules';

const base: RuleMechanic[] = [{ key: 'poca', name: 'Poça', type: 'avoidable_damage', severity: 'minor', tolerance: 0 }];

describe('ajustes das regras', () => {
  it('guarda só o que difere do padrão', () => {
    const t = cleanTuning(
      { encounter_id: 1, mechanics: { poca: { severity: 'minor', tolerance: 2, enabled: true, focus: false }, outra: {} }, custom: [] },
      base,
    );
    expect(t.mechanics).toEqual({ poca: { tolerance: 2 } });
  });

  it('exporta e importa, recusando arquivo de outro boss', () => {
    const t = { encounter_id: 3420, name: 'Sszorak', mechanics: { tempest: { severity: 'wipe' as const } }, custom: [] };
    const file = exportTuning(t, 'Sszorak');
    expect(parseTuningFile(file, 3420)).toEqual(t);
    expect(() => parseTuningFile(file, 3421)).toThrow('outro boss (Sszorak)');
    expect(() => parseTuningFile('{"x":1}', 3420)).toThrow('não é de ajustes');
    expect(() => parseTuningFile('não é json', 3420)).toThrow('JSON');
  });
});
