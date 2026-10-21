import { describe, expect, it, vi } from 'vitest';
import * as fx from './test-fixtures';
import type { Setup } from '../types';

const saved = new Map<string, unknown>();
vi.mock('./api', () => ({
  simcCancel: vi.fn(),
  simcSavedGet: vi.fn(async (k: string) => saved.get(k) ?? null),
}));

const { raidCandidates, loadPotentials, simulateRaid } = await import('./botRaid');
const { botKey } = await import('./botSim');

const setup = { stats: {}, itemLevel: 330, items: [], talents: [] } as unknown as Setup;

describe('raidCandidates', () => {
  it('DPS e tanks com setup, DPS primeiro; healer e quem não tem setup ficam de fora', () => {
    const pull = fx.pull(0, 0, 100_000, {
      players: [
        fx.player('Tank', { name: 'Tank-R', role: 'tank', setup }),
        fx.player('Heal', { name: 'Heal-R', role: 'healer', setup }),
        fx.player('Zed', { name: 'Zed-R', role: 'dps', setup }),
        fx.player('Ana', { name: 'Ana-R', role: 'dps', setup }),
        fx.player('NoSetup', { name: 'NoSetup-R', role: 'dps' }),
      ],
    });
    expect(raidCandidates([pull], pull)).toEqual(['Ana-R', 'Zed-R', 'Tank-R']);
  });
});

describe('loadPotentials', () => {
  it('o % de quem tem simulação salva da noite (o pull simulado vem da simulação)', async () => {
    const me = fx.player('Ana', { name: 'Ana-R', setup, damageDone: 95_000, aliveMs: 100_000 });
    const pull = fx.pull(0, 5_000, 100_000, { players: [me] });
    saved.set(botKey(pull, 'Ana-R'), { version: 2, pullStartMs: 5_000, windowMs: 100_000, dps: { mean: 1000, min: 900, max: 1100 } });
    const list = await loadPotentials([pull], pull, ['Ana-R', 'Zed-R']);
    expect(list.map((x) => [x.name, x.pct])).toEqual([['Ana-R', 0.95]]);
  });
});

describe('simulateRaid', () => {
  it('quem falha não para a fila; parar interrompe o resto', async () => {
    const pull = fx.pull(0, 0, 100_000, { players: [] });
    // sem setup no log: cada um falha sem pull para simular
    const r = await simulateRaid([pull], pull, ['A', 'B'], () => {}, () => false);
    expect(r.done).toEqual([]);
    expect(r.failed.map((f) => f.name)).toEqual(['A', 'B']);
    const stopped = await simulateRaid([pull], pull, ['A', 'B'], () => {}, () => true);
    expect(stopped).toEqual({ done: [], failed: [] });
  });
});
