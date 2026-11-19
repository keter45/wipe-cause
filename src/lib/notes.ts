// Anotação do pull (o motivo do wipe na visão de quem estava lá, ou qualquer lembrete).
// Fica no navegador do app, pela chave boss + início do pull (a mesma em qualquer reanálise
// do log, inclusive no modo ao vivo).

import { useEffect, useState } from 'react';
import type { Pull } from '../types';
import { KEYS, ls } from './storage';

const listeners = new Set<() => void>();

export const noteKey = (p: Pick<Pull, 'encounterId' | 'startMs'>) => `${p.encounterId}:${p.startMs}`;

export function getNote(p: Pick<Pull, 'encounterId' | 'startMs'>): string {
  return ls.get(KEYS.notes + noteKey(p)) ?? '';
}

export function setNote(p: Pick<Pull, 'encounterId' | 'startMs'>, text: string) {
  ls.set(KEYS.notes + noteKey(p), text.trim() ? text : null);
  listeners.forEach((f) => f());
}

/** Nota do pull, sincronizada entre o aviso ao vivo, a lista e a tela do pull. */
export function useNote(p: Pick<Pull, 'encounterId' | 'startMs'> | null): [string, (text: string) => void] {
  const [text, setText] = useState(() => (p ? getNote(p) : ''));
  const key = p ? noteKey(p) : '';
  useEffect(() => {
    if (!p) return;
    const sync = () => setText(getNote(p));
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [text, (t: string) => p && setNote(p, t)];
}
