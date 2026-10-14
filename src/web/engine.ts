// Lado da página do worker do núcleo: chamadas com resposta (Promise) e progresso.

import { getLocale, messagesOf } from '../i18n';
import { webMsg } from './web.i18n';

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; progress?: (done: number, total: number) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function start(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; progress?: [number, number]; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    if (e.data.progress) return p.progress?.(...e.data.progress);
    pending.delete(e.data.id);
    if (e.data.error != null) p.reject(e.data.error);
    else p.resolve(e.data.result);
  };
  w.onerror = (e) => {
    // o worker não subiu (WASM não carregou): falha tudo que estava esperando e recria na próxima
    const msg = messagesOf(webMsg).engineFailed(e.message || 'worker');
    for (const p of pending.values()) p.reject(msg);
    pending.clear();
    worker = null;
  };
  w.postMessage({ id: 0, method: 'setEnglish', args: [getLocale() === 'en'] });
  return w;
}

export function call<T>(method: string, args: unknown[], progress?: (done: number, total: number) => void): Promise<T> {
  worker ??= start();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
    worker!.postMessage({ id, method, args });
  });
}

/** Idioma das mensagens do núcleo (só se o worker já existe; senão ele nasce no idioma atual). */
export function setEngineEnglish(en: boolean) {
  worker?.postMessage({ id: 0, method: 'setEnglish', args: [en] });
}
