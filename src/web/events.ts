// Eventos do "backend" do site (o que no app chega pelo `emit` do Tauri): progresso da análise.

import type { EventCallback, UnlistenFn } from '@tauri-apps/api/event';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subs = new Map<string, Set<EventCallback<any>>>();

export function webListen<T>(event: string, cb: EventCallback<T>): Promise<UnlistenFn> {
  let set = subs.get(event);
  if (!set) subs.set(event, (set = new Set()));
  set.add(cb);
  return Promise.resolve(() => set.delete(cb));
}

export function emit(event: string, payload: unknown) {
  for (const cb of subs.get(event) ?? []) cb({ event, id: 0, payload });
}
