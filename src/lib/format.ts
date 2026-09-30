import type { Pull } from '../types';
import { raidOnly } from './content';

export function mmss(ms: number): string {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${neg ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Segundos relativos com uma casa, ex.: "-3.2s" */
export function relSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
export function num(n: number): string {
  return compact.format(n);
}

export function pct(n: number | null | undefined, digits = 1): string {
  return n == null ? '—' : `${n.toFixed(digits)}%`;
}

/** "Fulano-Azralon" -> "Fulano" */
export function shortName(name: string): string {
  return name.split('-')[0];
}

export const CLASS_COLORS: Record<string, string> = {
  DeathKnight: '#C41E3A',
  DemonHunter: '#A330C9',
  Druid: '#FF7C0A',
  Evoker: '#33937F',
  Hunter: '#AAD372',
  Mage: '#3FC7EB',
  Monk: '#00FF98',
  Paladin: '#F48CBA',
  Priest: '#FFFFFF',
  Rogue: '#FFF468',
  Shaman: '#0070DD',
  Warlock: '#8788EE',
  Warrior: '#C69B6D',
};

export function classColor(cls: string | null | undefined): string {
  return (cls && CLASS_COLORS[cls]) || 'var(--text)';
}

export const ROLE_LABEL: Record<string, string> = { tank: 'Tank', healer: 'Healer', dps: 'DPS' };

/** "24/09 · The Twin Fangs Mythic": data do 1º pull + boss com mais pulls. */
export function logTitle(all: Pull[]): string {
  if (!all.length) return 'Log sem pulls';
  const [date] = all[0].startLocal.split(' ');
  const [m, d] = date.split('/');
  const raid = raidOnly(all);
  const pulls = raid.length ? raid : all;
  const count = new Map<string, number>();
  for (const p of pulls) {
    const k = `${p.encounterName} ${p.difficultyName}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const others = count.size - 1;
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')} · ${main}${others > 0 ? ` +${others}` : ''}`;
}

