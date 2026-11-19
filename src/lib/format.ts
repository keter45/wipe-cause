import type { Pull } from '../types';
import { raidOnly } from './content';
import { getLocale, intlLocale, messagesOf } from '../i18n';
import { formatMsg } from './format.i18n';

export function mmss(ms: number): string {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${neg ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Segundos relativos com uma casa, ex.: "-3.2s" */
/** Duração longa: "2h 13min" ou "45min" (serve para as duas línguas). */
export function longDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min` : `${min}min`;
}

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

/** Porcentagem de um valor já em 0-100: "42.0%" ("—" sem valor). Para fração (0-1), `fraction`. */
export function pct(n: number | null | undefined, digits = 1): string {
  return n == null ? '—' : `${n.toFixed(digits)}%`;
}

/** Fração (0-1) em porcentagem inteira: 0.423 -> 42. */
export const percentOf = (x: number) => Math.round(x * 100);

/** Fração (0-1) em texto: 0.423 -> "42%". */
export const fraction = (x: number) => `${percentOf(x)}%`;

/** Número no idioma do app com até `max` casas (e no mínimo `min`): 1234.5 -> "1.234,5". */
export const decimals = (n: number, max = 1, min = 0) => n.toLocaleString(intlLocale(), { minimumFractionDigits: min, maximumFractionDigits: max });

/** Segundos curtos: "3.2s" abaixo de 10s, "42s" acima. */
export const shortSecs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

/** Segundos inteiros: "42s". */
export const wholeSecs = (ms: number) => `${Math.round(ms / 1000)}s`;

/** Data curta no idioma do app: "28/09" (em inglês, "09/28"). */
export const shortDate = (ms: number) => new Date(ms).toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit' });

/** Data e hora curtas no idioma do app. */
export const shortDateTime = (iso: string | number) => new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' });

/** Nome (de player ou habilidade) para comparar: sem diferença de maiúsculas nem de acento composto. */
export const normName = (s: string) => s.normalize('NFC').toLocaleLowerCase('en');

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

/** "9/28/2026 22:48:18.335-3" (formato do log) -> "28/09" (em inglês, "09/28"). O mesmo de `title_of` no núcleo. */
export function dayMonth(p: Pick<Pull, 'startLocal'>): string {
  const [m = '?', d = '?'] = (p.startLocal.split(' ')[0] ?? '').split('/');
  const md = [m.padStart(2, '0'), d.padStart(2, '0')];
  return (getLocale() === 'en' ? md : md.reverse()).join('/');
}

/** Hora local do início do pull: "22:48". */
export const clockOf = (p: Pick<Pull, 'startLocal'>) => p.startLocal.split(' ')[1]?.slice(0, 5) ?? '';

/** Hora local de um instante (epoch ms) no fuso do log: "23:31". */
export const clockAt = (ms: number, tzOffsetHours: number | null | undefined) => new Date(ms + (tzOffsetHours ?? 0) * 3_600_000).toISOString().slice(11, 16);

/**
 * O mais frequente (o boss do título): raid antes de masmorra; empate pelo menor `key`, como
 * `title_of`/`main_encounter` no núcleo (crates/wipe-core/src/summary.rs).
 */
function mostPulled<K extends string | number>(all: Pull[], key: (p: Pull) => K): { main: K; distinct: number } | null {
  const raid = raidOnly(all);
  const count = new Map<K, number>();
  for (const p of raid.length ? raid : all) count.set(key(p), (count.get(key(p)) ?? 0) + 1);
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return ranked.length ? { main: ranked[0][0], distinct: ranked.length } : null;
}

/** Encontro do título (boss de raid com mais pulls), para o ícone. */
export const mainEncounterId = (all: Pull[]): number | null => mostPulled(all, (p) => p.encounterId)?.main ?? null;

/** "24/09 · The Twin Fangs Mythic": data do 1º pull + boss com mais pulls. */
export function logTitle(all: Pull[]): string {
  const top = mostPulled(all, (p) => `${p.encounterName} ${p.difficultyName}`);
  if (!top) return messagesOf(formatMsg).noPulls;
  return `${dayMonth(all[0])} · ${top.main}${top.distinct > 1 ? ` +${top.distinct - 1}` : ''}`;
}

/** Momentos em ordem, um por segundo (vários no mesmo segundo viram um ▶ só). */
export const uniqueSeconds = (times: number[]) => {
  const seen = new Set<number>();
  return [...times].sort((a, b) => a - b).filter((t) => !seen.has(Math.floor(t / 1000)) && !!seen.add(Math.floor(t / 1000)));
};
