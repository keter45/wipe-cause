import { describe, expect, it } from 'vitest';
import type { BossCast, UnitAuraView } from '../types';
import { countdown, nextCast, orbClearCountdown, unitAuraAt } from './replayTimers';

describe('contagens do replay', () => {
  it('conta do começo ao disparo do aviso', () => {
    expect(countdown(1000, 5000, 3000)).toEqual({ leftMs: 2000, left: 0.5 });
    expect(countdown(1000, 5000, 500)).toBeNull();
    expect(countdown(1000, 5000, 5000)).toBeNull();
  });

  it('o orb que sobrou conta até o cast que explode o chão, desde a explosão anterior', () => {
    const orbs = { clears: [10_000, 50_000] };
    // caiu antes da explosão anterior e ficou: conta desde ela
    expect(orbClearCountdown(orbs, 5_000, 50_000, 30_000)).toEqual({ leftMs: 20_000, left: 0.5 });
    // caiu depois: conta desde que caiu
    expect(orbClearCountdown(orbs, 30_000, 50_000, 40_000)).toEqual({ leftMs: 10_000, left: 0.5 });
    // saiu do chão de outro jeito (pego, quebrado): sem contagem
    expect(orbClearCountdown(orbs, 30_000, 45_000, 40_000)).toBeNull();
    // replay antigo, sem as explosões
    expect(orbClearCountdown({}, 30_000, 50_000, 40_000)).toBeNull();
  });

  it('acha o próximo cast (ou só o próximo frontal) dentro do horizonte', () => {
    const casts = [
      { t: 1000, guid: 'B', spellId: 1, name: 'Bolt' },
      { t: 6000, guid: 'B', spellId: 2, name: 'Sever', cone: { halfAngle: 40, range: 40 } },
      { t: 7000, guid: 'A', spellId: 3, name: 'Wail' },
    ] as BossCast[];
    expect(nextCast(casts, 'B', 2000, 5000)?.name).toBe('Sever');
    expect(nextCast(casts, 'B', 0, 5000, true)).toBeNull();
    expect(nextCast(casts, 'B', 0, 5000)?.name).toBe('Bolt');
    expect(nextCast(casts, 'A', 2000, 4000)).toBeNull();
  });

  it('stacks e absorvido de um escudo num instante', () => {
    const a: UnitAuraView = { key: 'k', name: 'Shield', spellId: 9, guid: 'X', from: 1000, to: 9000, stacks: [[1000, 1], [1000, 2], [5000, 1]], absorbed: [[2000, 100], [3000, 250]] };
    expect(unitAuraAt(a, 1500)).toEqual({ stacks: 2, absorbed: 0 });
    expect(unitAuraAt(a, 6000)).toEqual({ stacks: 1, absorbed: 250 });
    expect(unitAuraAt(a, 9000)).toBeNull();
  });
});

describe('setor do frontal', () => {
  it('vai do boss até o raio, com a borda em arco', async () => {
    const { sector } = await import('../components/replayLayers');
    // apontando para cima, meio ângulo de 45°: os dois cantos a 45° de cada lado, no raio
    const d = sector(100, 100, Math.PI / 2, Math.PI / 4, 50);
    const [, x1, y1, x2, y2] = /^M100\.0,100\.0L([\d.]+),([\d.]+)A50\.0,50\.0 0 0 1 ([\d.]+),([\d.]+)Z$/.exec(d)!.map(Number);
    expect(Math.hypot(x1 - 100, y1 - 100)).toBeCloseTo(50, 0);
    expect(Math.hypot(x2 - 100, y2 - 100)).toBeCloseTo(50, 0);
    // y da tela cresce para baixo: os dois cantos ficam acima do boss
    expect(y1).toBeLessThan(100);
    expect(y2).toBeLessThan(100);
  });
});
