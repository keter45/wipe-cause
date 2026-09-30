// Classe de cada personagem do log aberto, para colorir qualquer nome citado na interface
// (tabela, frase do veredito, resposta da IA…) sem cada tela precisar receber a classe.

import { createContext, useContext } from 'react';
import type { Pull } from '../types';
import { shortName } from './format';

export interface PlayerClasses {
  /** guid, nome completo ("Fulano-Azralon-US") e nome curto ("Fulano") -> classe */
  byKey: Map<string, string>;
  /** nomes curtos, do maior para o menor (para achar nomes dentro de um texto) */
  names: string[];
}

export const EMPTY_CLASSES: PlayerClasses = { byKey: new Map(), names: [] };

export function playerClasses(pulls: Pull[]): PlayerClasses {
  const byKey = new Map<string, string>();
  for (const p of pulls)
    for (const x of p.players) {
      if (!x.class) continue;
      byKey.set(x.guid, x.class);
      byKey.set(x.name, x.class);
      byKey.set(shortName(x.name), x.class);
    }
  const names = [...new Set([...byKey.keys()].filter((k) => !k.startsWith('Player-') && !k.includes('-')))].sort((a, b) => b.length - a.length);
  return { byKey, names };
}

export const PlayerClassesContext = createContext<PlayerClasses>(EMPTY_CLASSES);

export const usePlayerClasses = () => useContext(PlayerClassesContext);

/** Classe de um personagem por guid ou nome (completo ou curto). */
export function classOf(pc: PlayerClasses, key: string | null | undefined): string | null {
  if (!key) return null;
  return pc.byKey.get(key) ?? pc.byKey.get(shortName(key)) ?? null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex que acha os nomes de personagem do log dentro de um texto (palavra inteira). */
export function namesRegex(pc: PlayerClasses): RegExp | null {
  if (!pc.names.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(${pc.names.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
}
