import { describe, expect, it } from 'vitest';
import type { MechanicResult } from '../types';
import { pullContext } from './aiContext';
import { death, player, pull } from './test-fixtures';

const orb: MechanicResult = {
  key: 'orb', name: 'Orb roxo', spellId: null, kind: 'failure_event', severity: 'wipe', tip: 'Não levar orb perto do roxo.', evaluated: true,
  failures: 1, summary: '1 detonação', players: [{ guid: 'A', name: 'A-Realm', count: 1, amount: 0, firstT: 7_000, credit: false, message: '' }],
  events: [{ t: 7_000, player: null, detail: 'Orb roxo (falha)' }],
};

describe('pullContext', () => {
  const p = pull(1, 0, 36_000, {
    cutoffT: 11_000,
    trigger: { key: 'orb', name: 'Orb roxo', t: 7_000, deaths: 2 },
    players: [player('A'), player('B', { role: 'healer', hps: 50_000 })],
    mechanics: [orb],
    deaths: [death('A', 11_000), death('B', 20_000, { ignored: true })],
  });
  const ctx = pullContext(p, [pull(0, -100_000, 40_000), p], new Map());

  it('traz resultado, mecânicas com dica, mortes e jogadores', () => {
    expect(ctx).toContain('# Boss (Mythic) — pull 2 de 2 deste boss na noite');
    expect(ctx).toContain('Orb roxo [falha do raid (explosão/timer), causa wipe] — FALHOU 1×. 1 detonação. Dica: Não levar orb perto do roxo.');
    expect(ctx).toContain('Envolvidos: A (1×, 1ª vez 0:07)');
    expect(ctx).toContain('0:07 GATILHO do wipe: Orb roxo');
    expect(ctx).toMatch(/- 0:11 A \(DPS, Mage\)/);
    expect(ctx).toContain('Mortes depois do corte (cascata, não contam): B 0:20');
    expect(ctx).toContain('- pull 2 (ESTE): wipe');
  });

  it('cabe folgado no contexto dos modelos gratuitos', () => {
    expect(ctx.length).toBeLessThan(8_000);
  });
});
