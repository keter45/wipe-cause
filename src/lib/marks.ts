// Erros marcados à mão pelo raid leader: o que o log não prova (posição, bait errado, escala
// errada). Entram no veredito, na nota do player e no contexto da IA como qualquer erro.
// Ficam no navegador do app, por boss + início do pull (como as anotações).

import { useEffect, useState } from 'react';
import type { Pull } from '../types';
import { noteKey } from './notes';

export interface ManualMark {
  id: string;
  guid: string;
  name: string;
  /** o que a pessoa errou, em texto livre (ou o nome de uma mecânica) */
  what: string;
  severity: 'major' | 'minor';
  /** momento do pull (ms), se veio de uma morte */
  t?: number;
  spellId?: number | null;
}

type PullRef = Pick<Pull, 'encounterId' | 'startMs'>;

const KEY = 'wipe-cause:marks:';
const listeners = new Set<() => void>();

export function getMarks(p: PullRef): ManualMark[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY + noteKey(p));
    return raw ? (JSON.parse(raw) as ManualMark[]) : [];
  } catch {
    return [];
  }
}

function save(p: PullRef, marks: ManualMark[]) {
  try {
    if (marks.length) localStorage.setItem(KEY + noteKey(p), JSON.stringify(marks));
    else localStorage.removeItem(KEY + noteKey(p));
  } catch {
    /* sem storage: vale só nesta sessão */
  }
  listeners.forEach((f) => f());
}

export function addMark(p: PullRef, m: Omit<ManualMark, 'id'>) {
  save(p, [...getMarks(p), { ...m, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }]);
}

export function removeMark(p: PullRef, id: string) {
  save(
    p,
    getMarks(p).filter((m) => m.id !== id),
  );
}

/** Marcas do pull, sincronizadas entre as telas (re-renderiza quando mudam). */
export function useMarks(p: PullRef): ManualMark[] {
  const [marks, setMarks] = useState(() => getMarks(p));
  const key = noteKey(p);
  useEffect(() => {
    const sync = () => setMarks(getMarks(p));
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return marks;
}
