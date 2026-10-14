// Discord (webhook do canal) e IA (chat compatível com OpenAI) no site: o que o app faz em
// discord.rs e ai.rs, com fetch direto do navegador. Configurações e chaves ficam no
// localStorage deste navegador (no app ficam no cofre do sistema).

import type { DiscordConfig } from '../lib/api';
import type { AiConfig, ChatMessage } from '../lib/ai';
import { messagesOf } from '../i18n';
import { webMsg } from './web.i18n';
import { lsGet, lsSet } from './store';

const m = () => messagesOf(webMsg);

// ---------------------------------------------------------------- Discord

const WEBHOOK_PREFIXES = ['https://discord.com/api/webhooks/', 'https://discordapp.com/api/webhooks/', 'https://ptb.discord.com/api/webhooks/', 'https://canary.discord.com/api/webhooks/'];
const validWebhook = (url: string) => WEBHOOK_PREFIXES.some((p) => url.startsWith(p));
const ALLOWED_MIME = ['image/png', 'image/webp'];

export function discordGetConfig(): DiscordConfig {
  return { webhook: null, onWipe: true, onKill: true, onNight: true, auto: true, clip: true, ...lsGet<DiscordConfig>('discord') };
}

export function discordSetConfig(config: DiscordConfig) {
  const webhook = config.webhook?.trim() || null;
  if (webhook && !validWebhook(webhook)) throw m().badWebhook;
  lsSet('discord', { ...config, webhook });
}

function webhookOf(webhook: string | null | undefined): string {
  const url = webhook ?? discordGetConfig().webhook;
  if (!url) throw m().noWebhook;
  if (!validWebhook(url)) throw m().badWebhook;
  return url;
}

async function send(url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', ...init });
  } catch (e) {
    throw m().discordOffline(String(e));
  }
  if (res.ok) return;
  if (res.status === 404) throw m().webhookGone;
  if (res.status === 429) throw m().discordRate;
  if (res.status === 413) throw m().discordTooBig;
  throw m().discordRejected(res.status, (await res.text().catch(() => '')).slice(0, 300));
}

export const discordPost = (payload: unknown, webhook?: string | null) =>
  send(webhookOf(webhook), { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Mensagem com anexos (cartão do wipe, clipe WebP). */
export function discordPostFiles(payload: unknown, files: { name: string; mime: string; dataB64: string }[], webhook?: string | null) {
  const url = webhookOf(webhook);
  if (!files.every((f) => ALLOWED_MIME.includes(f.mime))) throw 'file type not allowed';
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  files.forEach((f, i) => form.append(`files[${i}]`, new Blob([fromB64(f.dataB64)], { type: f.mime }), f.name.replace(/[^A-Za-z0-9._-]/g, '')));
  return send(url, { body: form });
}

// ---------------------------------------------------------------- IA

interface SavedAi {
  provider: string;
  baseUrl: string;
  model: string;
}

const validBaseUrl = (url: string) => {
  const u = url.trim().toLowerCase();
  return u.startsWith('https://') || ['http://localhost', 'http://127.0.0.1', 'http://[::1]'].some((p) => u.startsWith(p));
};
const endpoint = (base: string, path: string) => `${base.trim().replace(/\/+$/, '')}/${path}`;
const keyOf = (provider: string) => lsGet<string>(`ai-key-${provider}`);

export function aiGetConfig(): AiConfig | null {
  const s = lsGet<SavedAi>('ai');
  return s ? { ...s, hasKey: keyOf(s.provider) != null } : null;
}

export function aiSetConfig(config: AiConfig, apiKey: string | null) {
  if (!validBaseUrl(config.baseUrl)) throw m().aiUrl;
  if (apiKey != null) lsSet(`ai-key-${config.provider}`, apiKey.trim() || null);
  lsSet('ai', { provider: config.provider, baseUrl: config.baseUrl.trim(), model: config.model.trim() });
}

function aiError(code: number, body: string): string {
  if (code === 401 || code === 403) return m().aiKey;
  if (code === 404) return m().aiNotFound;
  if (code === 429) return m().aiLimit;
  return m().aiStatus(code, body.slice(0, 400));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function aiFetch(url: string, key: string | null, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw m().aiOffline(String(e));
  }
  if (!res.ok) throw aiError(res.status, await res.text().catch(() => ''));
  return res.json();
}

export async function aiListModels(provider: string, baseUrl: string, apiKey: string | null): Promise<string[]> {
  if (!validBaseUrl(baseUrl)) throw m().aiUrl;
  const json = await aiFetch(endpoint(baseUrl, 'models'), apiKey?.trim() || keyOf(provider));
  return ((json.data ?? []) as any[])
    .map((x) => String(x.id ?? '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
}

export async function aiChat(messages: ChatMessage[]): Promise<string> {
  const cfg = aiGetConfig();
  if (!cfg) throw m().aiSetup;
  if (!validBaseUrl(cfg.baseUrl)) throw m().aiUrl;
  const json = await aiFetch(endpoint(cfg.baseUrl, 'chat/completions'), keyOf(cfg.provider), { model: cfg.model, messages, temperature: 0.3 });
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw m().aiEmpty(JSON.stringify(json).slice(0, 300));
  return text;
}
