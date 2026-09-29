// Modo ao vivo na UI: liga/desliga o acompanhamento do log e avisa quais pulls são novos.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogReport, Pull } from '../types';
import { inTauri, liveStart, liveStatus, liveStop, onLiveReport, onLiveStatus, type LiveStatus } from './api';

const OFF: LiveStatus = { active: false, state: 'stopped', file: null, encounter: null, analyzed: 0, message: null };

/** Mesmo pull em duas análises do mesmo log (o id muda se a numeração mudar). */
const pullKey = (p: Pull) => `${p.encounterId}:${p.startMs}`;

/**
 * `onReport(r, novos)`: cada reanálise do log; `novos` = pulls que não existiam na anterior
 * (vazio na primeira, que só mostra o que já tinha acontecido).
 */
export function useLive(onReport: (r: LogReport, newPulls: Pull[]) => void) {
  const [status, setStatus] = useState<LiveStatus>(OFF);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const handler = useRef(onReport);
  handler.current = onReport;

  useEffect(() => {
    if (!inTauri) return;
    liveStatus().then(setStatus).catch(() => {});
    const offStatus = onLiveStatus(setStatus);
    const offReport = onLiveReport((r) => {
      const known = seen.current;
      const fresh = known ? r.pulls.filter((p) => !known.has(pullKey(p))) : [];
      seen.current = new Set(r.pulls.map(pullKey));
      handler.current(r, fresh);
    });
    return () => {
      offStatus.then((f) => f());
      offReport.then((f) => f());
    };
  }, []);

  const start = useCallback(async (deathCutoff: number) => {
    setError(null);
    seen.current = null;
    try {
      setStatus(await liveStart(null, deathCutoff));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const stop = useCallback(async () => {
    await liveStop();
    setStatus(OFF);
  }, []);

  return { status, error, start, stop };
}
