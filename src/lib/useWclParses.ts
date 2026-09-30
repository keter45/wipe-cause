import { useEffect, useState } from 'react';
import type { Pull } from '../types';
import { inTauri } from './api';
import { useSetup } from './setup';
import { fetchHistory, fetchKillParses, type PlayerParse } from './wclParses';

export type ParseState =
  | { kind: 'off'; reason: string }
  | { kind: 'loading' }
  | { kind: 'ready'; parses: Map<string, PlayerParse>; source: 'kill' | 'history' }
  | { kind: 'error'; message: string };

/**
 * Parses do Warcraft Logs do pull: no kill, o parse de cada player (precisa do link do report);
 * num wipe, o histórico do player no boss (não há parse de wipe).
 */
export function useWclParses(pull: Pull, wclCode: string | undefined): ParseState {
  const configured = !!useSetup().status?.wcl?.configured;
  const [state, setState] = useState<ParseState>({ kind: 'loading' });
  useEffect(() => {
    if (!inTauri) return setState({ kind: 'off', reason: 'O parse do Warcraft Logs aparece no app instalado.' });
    if (!configured) return setState({ kind: 'off', reason: 'Conecte o Warcraft Logs em Configurações para ver os parses.' });
    if (pull.success && !wclCode) return setState({ kind: 'off', reason: 'Cole o link do report da noite (Warcraft Logs, no topo) para ver os parses deste kill.' });
    let alive = true;
    setState({ kind: 'loading' });
    (pull.success ? fetchKillParses(wclCode!, pull) : fetchHistory(pull))
      .then((parses) => alive && setState({ kind: 'ready', parses, source: pull.success ? 'kill' : 'history' }))
      .catch((e) => alive && setState({ kind: 'error', message: String(e) }));
    return () => {
      alive = false;
    };
  }, [pull, wclCode, configured]);
  return state;
}
