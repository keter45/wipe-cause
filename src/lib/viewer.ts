// Link de visualização: a interface do app aberta no navegador de outra pessoa, servida pelo app de
// quem compartilhou (src-tauri/src/share.rs). Os comandos de leitura vão para `/api/invoke` com a
// chave do link; o resto responde como no site (vazio) ou avisa que o link é só para ver.

import { messagesOf } from '../i18n';
import { viewerMsg } from './viewer.i18n';

const KEY = 'wipe-cause:viewer-key';

/** A chave do link (`?k=`). Fica guardada na aba, para recarregar a página sem perder. */
export function viewerKey(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('k');
  try {
    if (fromUrl) sessionStorage.setItem(KEY, fromUrl);
    return fromUrl ?? sessionStorage.getItem(KEY) ?? '';
  } catch {
    return fromUrl ?? '';
  }
}

/** Respostas locais: o que depende do PC de quem compartilhou aparece como "não configurado". */
const local: Record<string, () => unknown> = {
  set_locale: () => undefined,
  rules_dir: () => null,
  logs_list: () => ({ dir: null, source: 'none', files: [], warning: null }),
  logs_get_dir: () => null,
  logs_detect_dir: () => null,
  wcr_videos: () => ({ dir: null, source: 'none', videos: [], warning: null }),
  wcr_get_dir: () => null,
  wcr_detect_dir: () => null,
  wcr_cloud_get_config: () => ({ configured: false, user: null, guild: null }),
  // integrações de quem compartilhou: o visitante não as usa (e a tela já trata null como não configurada)
  wcl_get_config: () => null,
  discord_get_config: () => null,
  ai_get_config: () => null,
  wcr_cloud_videos: () => [],
  startup_get: () => false,
  simc_status: () => ({ available: false, installed: null, latest: null, update: false, error: null }),
  simc_cancel: () => undefined,
  share_status: () => ({ active: false, url: null, localUrl: null, error: null }),
};

export async function viewerInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const answer = local[cmd];
  if (answer) return answer() as T;
  const r = await fetch('/api/invoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wipe-key': viewerKey() },
    body: JSON.stringify({ cmd, args }),
  });
  // como no app: o erro chega à UI como texto
  if (r.status === 403) throw messagesOf(viewerMsg).badKey;
  if (!r.ok) throw String(await r.json().catch(() => r.statusText));
  return (await r.json()) as T;
}
