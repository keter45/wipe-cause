import { describe, expect, it } from 'vitest';
import { pull } from './test-fixtures';
import { triggerText, wipeCallText } from './wipeCall';

describe('call de wipe', () => {
  it('explica o corte e o que levou a ele', () => {
    // pull 1 de 15/10: o tank morreu aos 3:46 e o grupo parou de jogar aos 3:55
    const p = pull(0, 0, 256_600, {
      cutoffT: 235_100,
      wipeCall: { t: 235_100, confidence: 'certain', stopped: 7, trigger: { kind: 'tank', t: 226_600, name: 'Reidane-Azralon-US', spell: 'Gravebound', deaths: 1, noRez: true } },
    });
    const c = wipeCallText(p)!;
    expect(c.possible).toBe(false);
    expect(c.short).toMatch(/3:55/);
    expect(c.detail).toMatch(/7/);
    expect(c.detail).toMatch(/Reidane/);
    expect(c.detail).toMatch(/Gravebound/);
  });

  it('possível call e gatilho desconhecido', () => {
    const p = pull(0, 0, 200_000, { cutoffT: 150_000, wipeCall: { t: 150_000, confidence: 'possible', stopped: 3 } });
    expect(wipeCallText(p)!.possible).toBe(true);
    expect(triggerText(undefined).length).toBeGreaterThan(0);
  });

  it('sem call: nada', () => {
    expect(wipeCallText(pull(0, 0, 60_000))).toBeNull();
  });
});

describe('título da try com call de wipe', () => {
  it('cita a call e o que levou a ela, não a primeira morte', async () => {
    const { analyzePull } = await import('./verdict');
    const p = pull(0, 0, 256_600, {
      cutoffT: 235_100,
      trigger: { key: 'noxious_ground', name: 'Noxious Ground', t: 98_300, deaths: 1 },
      wipeCall: { t: 235_100, confidence: 'certain', stopped: 7, trigger: { kind: 'tank', t: 226_600, name: 'Reidane-Azralon-US', spell: 'Gravebound', deaths: 1, noRez: true } },
    });
    const h = analyzePull(p).headline;
    expect(h).toMatch(/3:55/);
    expect(h).toMatch(/Reidane/);
    expect(h).not.toMatch(/Noxious Ground/);
  });
});
