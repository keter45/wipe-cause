import type { Pull } from '../types';
import { raidOnly } from './content';
import { intlLocale, messagesOf } from '../i18n';
import { formatMsg } from './format.i18n';

export function mmss(ms: number): string {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${neg ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Segundos relativos com uma casa, ex.: "-3.2s" */
export function relSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

const compact = new Map<string, Intl.NumberFormat>();
/** 252,5 mil (pt) / 252.5K (en) */
export function num(n: number): string {
  const l = intlLocale();
  let f = compact.get(l);
  if (!f) compact.set(l, (f = new Intl.NumberFormat(l, { notation: 'compact', maximumFractionDigits: 1 })));
  return f.format(n);
}

/** Origem de dano para exibir: o núcleo grava marcadores para o ambiente e para dano sem origem (análises antigas, o texto em português). */
export function damageSource(source: string): string {
  const t = messagesOf(formatMsg);
  if (source === '@environment' || source === 'Ambiente') return t.environment; // i18n-ignore: valor de análises antigas
  if (source === '@none' || source === '(sem origem)') return t.noSource; // i18n-ignore: valor de análises antigas
  return source;
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

/** Encontro do título (boss de raid com mais pulls), para o ícone. */
export function mainEncounterId(all: Pull[]): number | null {
  const raid = raidOnly(all);
  const pulls = raid.length ? raid : all;
  const count = new Map<number, number>();
  for (const p of pulls) count.set(p.encounterId, (count.get(p.encounterId) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** "24/09 · The Twin Fangs Mythic": data do 1º pull + boss com mais pulls. */
export function logTitle(all: Pull[]): string {
  if (!all.length) return messagesOf(formatMsg).noPulls;
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


/** Momentos em ordem, um por segundo (vários no mesmo segundo viram um ▶ só). */
export const uniqueSeconds = (times: number[]) => {
  const seen = new Set<number>();
  return [...times].sort((a, b) => a - b).filter((t) => !seen.has(Math.floor(t / 1000)) && !!seen.add(Math.floor(t / 1000)));
};
