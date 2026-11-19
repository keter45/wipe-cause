import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMessages } from '../../i18n';
import { uiMsg } from './ui.i18n';

export type SortDir = 1 | -1;

/**
 * Ordenação de uma tabela: clicar na coluna ordena por ela; clicar de novo inverte. `firstDir`
 * diz por onde cada coluna começa (nome de A a Z; nota, pior primeiro; números, do maior).
 */
export function useSort<K extends string>(initial: K, firstDir: (key: K) => SortDir) {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: initial, dir: firstDir(initial) });
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: firstDir(key) }));
  /** Compara dois valores na direção escolhida (texto por ordem alfabética). */
  const compare = (a: number | string, b: number | string) => (typeof a === 'string' ? a.localeCompare(b as string) : a - (b as number)) * sort.dir;
  return { key: sort.key, dir: sort.dir, toggle, compare };
}

/** Cabeçalho de coluna ordenável (com `aria-sort` e a seta da direção). As tabelas de jogadores usam este. */
export function SortTh<K extends string>({ k, sort, children, title, className }: { k: K; sort: { key: K; dir: SortDir; toggle: (key: K) => void }; children: ReactNode; title?: string; className?: string }) {
  const t = useMessages(uiMsg);
  const on = sort.key === k;
  return (
    <th className={className} title={title} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className={`sort-btn ${on ? 'on' : ''}`} onClick={() => sort.toggle(k)} aria-label={typeof children === 'string' ? t.sortBy(children) : undefined}>
        {children}
        {on ? sort.dir === 1 ? <ArrowUp size={12} strokeWidth={2} aria-hidden /> : <ArrowDown size={12} strokeWidth={2} aria-hidden /> : <ArrowDown size={12} strokeWidth={2} className="sort-hint" aria-hidden />}
      </button>
    </th>
  );
}
