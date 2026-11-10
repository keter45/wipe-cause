import { describe, expect, it } from 'vitest';
import type { Pull } from '../types';
import { findingMoment } from './PullView';

const pull = (mechanics: unknown[]) => ({ mechanics }) as unknown as Pull;

describe('momento do achado (botão Replay em "O que mais pesou")', () => {
  it('primeira falha de quem foi culpado, sem quem fez a parte', () => {
    const p = pull([{ spellId: 7, failures: 2, players: [{ credit: true, firstT: 1000 }, { credit: false, firstT: 116000 }, { credit: false, firstT: 90000 }], events: [{ t: 500 }] }]);
    expect(findingMoment({ severity: 'major', title: '', spellId: 7 }, p, [])).toBe(90000);
  });

  it('sem culpados: primeira falha registrada; sem falhas: primeira morte decisiva pela habilidade', () => {
    expect(findingMoment({ severity: 'major', title: '', spellId: 7 }, pull([{ spellId: 7, failures: 1, players: [], events: [{ t: 3000 }, { t: 2000 }] }]), [])).toBe(2000);
    const deaths = [{ t: 50000, killingBlow: { spellId: 9 } }, { t: 40000, killingBlow: { spellId: 9 } }] as unknown as Pull['deaths'];
    expect(findingMoment({ severity: 'wipe', title: '', spellId: 9 }, pull([]), deaths)).toBe(40000);
  });

  it('achado sem habilidade não tem momento', () => {
    expect(findingMoment({ severity: 'info', title: '' }, pull([]), [])).toBeNull();
  });
});
