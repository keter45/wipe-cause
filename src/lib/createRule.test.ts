import { describe, expect, it } from 'vitest';
import { buildRule } from '../components/CreateRule';

describe('criar regra', () => {
  it('monta a regra no formato do YAML para cada tipo', () => {
    expect(buildRule('avoidable_damage', 123, 'Poça Ácida', 'minor', 'sair', { tolerance: 1 })).toEqual({
      key: 'poca_acida_123',
      name: 'Poça Ácida',
      type: 'avoidable_damage',
      severity: 'minor',
      detect: { damage_ids: [123] },
      tip: 'sair',
      message: '{player} tomou Poça Ácida ({count}x)',
      tolerance: 1,
    });
    expect(buildRule('interrupt', 9, 'Bolt', 'major', 'cortar', {}).detect).toEqual({ cast_id: 9 });
    expect(buildRule('failure_event', 9, 'Boom', 'wipe', 'x', {}).detect).toEqual({ fail_ids: [9] });
    expect(buildRule('stack_limit', 9, 'Veneno', 'major', 'x', { warn: 5, lethal: 8 })).toMatchObject({ detect: { aura_id: 9 }, warn_stacks: 5, lethal_stacks: 8 });
    expect(buildRule('dispel', 9, 'Maldição', 'minor', 'x', { maxDelay: 3 })).toMatchObject({ detect: { aura_id: 9 }, max_delay: 3 });
  });
});
