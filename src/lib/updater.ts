// Atualização automática (plugin updater do Tauri): o app lê o latest.json da última release
// no GitHub, baixa o instalador novo, confere a assinatura e reinstala sozinho.

import { useCallback, useEffect, useState } from 'react';
import { inTauri } from './api';

type Update = Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater').check>>;

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'downloading'; version: string; fraction: number | null }
  | { kind: 'error'; message: string };

/** Procura de novo a cada 6h com o app aberto (a raid pode durar a noite toda). */
const RECHECK_MS = 6 * 3_600_000;

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  const [update, setUpdate] = useState<Update>(null);
  const [version, setVersion] = useState<string | null>(null);

  const checkNow = useCallback(async (manual = false) => {
    if (!inTauri) return;
    setState((s) => (manual || s.kind === 'idle' ? { kind: 'checking' } : s));
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const u = await check();
      setUpdate(u);
      setState(u ? { kind: 'available', version: u.version, notes: u.body ?? '' } : { kind: 'none' });
    } catch (e) {
      // sem internet ou GitHub fora: só avisa se o usuário pediu
      setState(manual ? { kind: 'error', message: String(e) } : { kind: 'none' });
    }
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    import('@tauri-apps/api/app').then(({ getVersion }) => getVersion().then(setVersion)).catch(() => {});
    // em dev (npm run tauri dev) não procura sozinho: a versão local é sempre "velha"
    if (import.meta.env.DEV) return;
    checkNow();
    const id = window.setInterval(() => checkNow(), RECHECK_MS);
    return () => window.clearInterval(id);
  }, [checkNow]);

  const install = useCallback(async () => {
    if (!update) return;
    let total = 0;
    let done = 0;
    setState({ kind: 'downloading', version: update.version, fraction: null });
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        if (ev.event === 'Progress') {
          done += ev.data.chunkLength;
          setState({ kind: 'downloading', version: update.version, fraction: total ? done / total : null });
        }
      });
      // no Windows o instalador fecha o app; nos outros sistemas reinicia aqui
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      setState({ kind: 'error', message: String(e) });
    }
  }, [update]);

  const dismiss = useCallback(() => setState({ kind: 'none' }), []);

  return { state, version, checkNow, install, dismiss };
}
