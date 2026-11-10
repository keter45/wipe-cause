// Link de visualização: a interface do app aberta no navegador de outra pessoa, com os dados do app
// de quem compartilhou (src-tauri/src/share.rs). Os comandos de leitura vão para `/api/invoke` com a
// chave do link; o resto responde como no site (vazio) ou avisa que o link é só para ver.
//
// Pelo link fixo (`?v=<id>`, no site do projeto), o endereço do túnel e a chave vêm de um Gist
// secreto que o app de quem compartilhou atualiza a cada vez que liga o link.

import { messagesOf } from '../i18n';
import { viewerMsg } from './viewer.i18n';
import { viewerGist } from './backend';

/** O app de quem compartilhou não responde (desligado, sem internet, link desligado). */
export class ViewerOffline extends Error {
  // a tela mostra o erro como texto (String(e)): sem o "Error: " na frente
  toString() {
    return this.message;
  }
}

interface Target {
  base: string;
  key: string;
}

/** Endereço e chave do link fixo: lidos do Gist, de novo no máximo a cada 60 s (limite da API do GitHub). */
let target: Promise<Target> | null = null;
let targetAt = 0;
async function readGist(id: string): Promise<Target> {
  const r = await fetch(`https://api.github.com/gists/${encodeURIComponent(id)}`, { headers: { accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new ViewerOffline(messagesOf(viewerMsg).linkGone);
  const gist = (await r.json()) as { files?: Record<string, { content?: string }> };
  const file = gist.files?.['wipe-cause-link.json']?.content;
  const link = file ? (JSON.parse(file) as { url?: string | null; key?: string }) : null;
  if (!link?.url || !link.key) throw new ViewerOffline(messagesOf(viewerMsg).offline);
  return { base: link.url.replace(/\/$/, ''), key: link.key };
}
function resolveTarget(): Promise<Target> {
  if (!viewerGist) return Promise.resolve({ base: '', key: viewerKey() });
  // desenvolvimento do site (npm run dev:web): `?v=dev&tunnel=<endereço>&k=<chave>` pula o Gist
  const devTunnel = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('tunnel') : null;
  if (devTunnel) return Promise.resolve({ base: devTunnel.replace(/\/$/, ''), key: viewerKey() });
  if (!target || Date.now() - targetAt > 60_000) {
    targetAt = Date.now();
    const p = readGist(viewerGist);
    // falhou: a próxima tentativa (depois dos 60 s) lê de novo
    target = p;
    p.catch(() => {});
  }
  return target;
}
/** O túnel não respondeu: o endereço pode ter mudado; o próximo pedido relê o Gist. */
function forgetTarget() {
  if (viewerGist && Date.now() - targetAt > 15_000) targetAt = 0;
}

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
  share_status: () => ({ active: false, url: null, localUrl: null, fixedUrl: null, error: null }),
  share_github_get: () => ({ connected: false, user: null }),
};

export async function viewerInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const answer = local[cmd];
  if (answer) return answer() as T;
  const { base, key } = await resolveTarget();
  let r: Response;
  try {
    r = await fetch(`${base}/api/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wipe-key': key },
      body: JSON.stringify({ cmd, args }),
    });
  } catch {
    forgetTarget();
    throw new ViewerOffline(messagesOf(viewerMsg).offline);
  }
  // túnel sem o app atrás (o Cloudflare responde 502/530)
  if (r.status === 502 || r.status === 530) {
    forgetTarget();
    throw new ViewerOffline(messagesOf(viewerMsg).offline);
  }
  // como no app: o erro chega à UI como texto
  if (r.status === 403) {
    forgetTarget();
    throw messagesOf(viewerMsg).badKey;
  }
  if (!r.ok) throw String(await r.json().catch(() => r.statusText));
  return (await r.json()) as T;
}
