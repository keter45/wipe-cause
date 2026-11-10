import { describe, expect, it } from 'vitest';
import { applySharedPrefs, collectSharedPrefs, MemoryStorage } from './sharedPrefs';

describe('escolhas compartilhadas no link de visualização', () => {
  it('manda só note de cura, métricas, cards, parses e afins (não notas nem configurações)', () => {
    const s = new MemoryStorage();
    s.setItem('wipe-cause:heal-note:3492:16', '[{"text":"pull 1 aura"}]');
    s.setItem('wipe-cause:boss-metrics:3492', '["caustic"]');
    s.setItem('wipe-cause:summary.villains', '0');
    s.setItem('wipe-cause:note:3492:1', 'motivo do wipe');
    s.setItem('wipe-cause:locale', 'en');
    expect(Object.keys(collectSharedPrefs(s)).sort()).toEqual(['wipe-cause:boss-metrics:3492', 'wipe-cause:heal-note:3492:16', 'wipe-cause:summary.villains']);
  });

  it('aplica as novas, apaga as que sumiram e mantém o resto do visitante', () => {
    const s = new MemoryStorage();
    s.setItem('wipe-cause:summary.villains', '0');
    s.setItem('wipe-cause:boss-metrics:1', '["a"]');
    s.setItem('wipe-cause:mode', 'solo');
    expect(applySharedPrefs(s, { 'wipe-cause:summary.villains': '1', 'wipe-cause:locale': 'en' })).toBe(true);
    expect(s.getItem('wipe-cause:summary.villains')).toBe('1');
    expect(s.getItem('wipe-cause:boss-metrics:1')).toBeNull();
    expect(s.getItem('wipe-cause:mode')).toBe('solo');
    // chave fora da lista não entra, mesmo que venha do servidor
    expect(s.getItem('wipe-cause:locale')).toBeNull();
    expect(applySharedPrefs(s, { 'wipe-cause:summary.villains': '1' })).toBe(false);
  });
});
