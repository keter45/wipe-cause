// Ponte com o "backend": no app é o Rust do Tauri; no site (build com VITE_TARGET=web) são os
// módulos de src/web — o mesmo núcleo compilado para WASM, rodando num Worker, e o resto
// (histórico, Warcraft Logs, Discord, IA) direto do navegador. A UI chama `invoke`/`listen`
// sem saber qual dos dois está do outro lado.
//
// A condição fica escrita por extenso em cada `if` para o Vite cortar o código do site no
// build do app (e o do app não pesar no site).

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';

/** Build do site (GitHub Pages). */
export const inWeb = import.meta.env.VITE_TARGET === 'web';
/** Dentro do app (Tauri). */
export const inDesktop = !inWeb && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/**
 * Link de visualização: a interface do app num navegador, com os dados do app de quem compartilhou
 * (src-tauri/src/share.rs). Dois jeitos de chegar:
 * - servida pelo próprio app (link do túnel): fora do Tauri o build do app só roda assim; no
 *   `npm run dev` é a UI de exemplo, a não ser com `?viewer=1`;
 * - pelo site (link fixo, `?v=<id do Gist>`): o Gist diz o endereço atual do túnel.
 */
export const viewerGist = inWeb && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('v') : null;
export const inViewer =
  !!viewerGist ||
  (!inWeb && !inDesktop && typeof window !== 'undefined' && (!import.meta.env.DEV || new URLSearchParams(window.location.search).has('viewer')));

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // antes do site: no link fixo os dados vêm do PC de quem compartilhou, não do WASM
  if (inViewer) return import('./viewer').then((m) => m.viewerInvoke<T>(cmd, args ?? {}));
  if (import.meta.env.VITE_TARGET === 'web') return import('../web/commands').then((m) => m.webInvoke<T>(cmd, args ?? {}));
  return tauriInvoke<T>(cmd, args);
}

export function listen<T>(event: string, cb: EventCallback<T>): Promise<UnlistenFn> {
  // o link de visualização não recebe eventos: as análises novas chegam relendo o histórico
  if (inViewer) return Promise.resolve(() => {});
  if (import.meta.env.VITE_TARGET === 'web') return import('../web/events').then((m) => m.webListen(event, cb));
  return tauriListen<T>(event, cb);
}
