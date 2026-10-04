import { describe, expect, it } from 'vitest';
import type { MechanicResult } from '../types';
import { bossPayload, pullPayload } from './discord';
import { summarizeNight } from './night';
import { death, pull } from './test-fixtures';

const detonation: MechanicResult = {
  key: 'purple', name: 'Virulent Mutation (detonação)', spellId: null, kind: 'failure_event', severity: 'wipe', tip: '', evaluated: true,
  failures: 1, summary: '1 detonação de orb roxo',
  players: [{ guid: 'A', name: 'Rainface-Realm', count: 1, amount: 0, firstT: 0, credit: false, message: '' }],
  events: [],
};

describe('pullPayload', () => {
  const p = pull(0, 0, 36_000, {
    startLocal: '28/09/2026 22:48:18',
    trigger: { key: 'purple', name: 'Virulent Mutation (detonação)', t: 11_700, deaths: 4 },
    mechanics: [detonation],
    deaths: [death('A', 11_800, { defensivesAvailable: [{ spellId: 1, name: 'Ice Block', kind: 'personal' }] })],
  });

  it('título com HP, gatilho na descrição e culpados nos campos', () => {
    const e = pullPayload(p, 'xFLWV9Yay2HZwrQk').embeds[0];
    expect(e.title).toBe('Wipe 1 · Boss Mythic — 50.0%');
    expect(e.description).toContain('gatilho: Virulent Mutation (detonação)');
    expect(e.url).toContain('/reports/xFLWV9Yay2HZwrQk?boss=1&difficulty=5&wipes=1');
    const mech = e.fields.find((f) => f.name === 'Erros de mecânica')!;
    expect(mech.value).toBe('**Virulent Mutation (detonação)** — 1 detonação de orb roxo: Rainface');
    expect(e.fields.find((f) => f.name === 'Morreram sem defensivo')!.value).toBe('A');
    expect(e.footer!.text).toBe('22:48 · 0:36 · 1 morte');
  });

  it('respeita o limite de 1024 caracteres por campo', () => {
    const many = Array.from({ length: 80 }, (_, i) => death(`Player${i}`, 1000 + i));
    const e = pullPayload(pull(0, 0, 60_000, { deaths: many, cutoffT: 999_999 })).embeds[0];
    for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
    expect(e.fields.find((f) => f.name === 'Mortes decisivas')!.value).toMatch(/\+\d+ mais$/);
  });
});

describe('bossPayload', () => {
  it('resume o boss com as maiores causas', () => {
    const s = summarizeNight([
      pull(0, 0, 60_000, { trigger: { key: 'purple', name: 'Orb roxo', t: 1, deaths: 3 } }),
      pull(1, 120_000, 60_000, { success: true }),
    ]);
    const e = bossPayload('Boss · Mythic', s).embeds[0];
    expect(e.title).toBe('Resumo · Boss · Mythic');
    expect(e.description).toBe('2 pulls · 1 wipes · 1 kills · Kill');
    expect(e.fields[0].value).toContain('**Orb roxo** — gatilho em 1 de 1 wipes');
  });
});
