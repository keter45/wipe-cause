// Para onde vai cada chamada ao backend. A v0.52.0 saiu com o app mandando tudo para o link de
// visualização (uma linha a mais no `invoke`): o histórico e as configurações pareciam apagados.

import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ tauri: [] as string[], viewer: [] as string[] }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async (cmd: string) => (calls.tauri.push(cmd), 'tauri') }));
vi.mock('./viewer', () => ({ viewerInvoke: async (cmd: string) => (calls.viewer.push(cmd), 'viewer') }));

const g = globalThis as unknown as { window?: unknown };

afterEach(() => {
  vi.resetModules();
  calls.tauri.length = 0;
  calls.viewer.length = 0;
  delete g.window;
});

describe('invoke', () => {
  it('no app (Tauri), vai para o backend do app, não para o link de visualização', async () => {
    g.window = { __TAURI_INTERNALS__: {}, location: { search: '' } };
    const b = await import('./backend');
    expect(b.inDesktop).toBe(true);
    expect(b.inViewer).toBe(false);
    await expect(b.invoke('history_list')).resolves.toBe('tauri');
    expect(calls.tauri).toEqual(['history_list']);
    expect(calls.viewer).toEqual([]);
  });
});
