// Warcraft Logs no site: login com a conta (OAuth 2 + PKCE numa janela), consultas GraphQL e a
// análise de reports — o que o app faz em wcl.rs, wcl_auth.rs e wcl_source.rs. A API aceita
// chamadas do navegador (CORS), então nada passa por servidor nosso.

import type { WclConfig, WclUser } from '../lib/wclApi';
import type { LogReport } from '../types';
import { messagesOf } from '../i18n';
import { webMsg } from './web.i18n';
import { call } from './engine';
import { idbDelPrefix, idbGet, idbSet, lsGet, lsSet } from './store';
import type { Summary } from './history';

const m = () => messagesOf(webMsg);

/** Client público do Wipe Cause (o mesmo do app; o id não é segredo, o PKCE dispensa o secret). */
const CLIENT_ID = '01a0f443-ee6e-716a-8671-bd4e73b7df36';
const AUTHORIZE_URL = 'https://www.warcraftlogs.com/oauth/authorize';
const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const USER_API = 'https://www.warcraftlogs.com/api/v2/user';
const CLIENT_API = 'https://www.warcraftlogs.com/api/v2/client';

interface Session {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

/** Página que recebe a volta do login (public/oauth.html). */
const redirectUri = () => new URL(`${import.meta.env.BASE_URL}oauth.html`, window.location.origin).toString();

// ---------------------------------------------------------------- login com a conta

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function postToken(form: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams(form) });
  } catch (e) {
    throw m().wclOffline(String(e));
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = [json.error, json.hint || json.error_description].filter(Boolean).join(': ') || String(res.status);
    throw m().loginRejected(detail);
  }
  return json;
}

function saveSession(json: Record<string, unknown>, oldRefresh: string | null = null): Session {
  if (typeof json.access_token !== 'string') throw m().noToken;
  const s: Session = {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : oldRefresh,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
  };
  lsSet('wcl-session', s);
  return s;
}

/** Token do usuário logado, renovado quando está para vencer. */
async function userToken(): Promise<string | null> {
  const s = lsGet<Session>('wcl-session');
  if (!s) return null;
  if (s.expiresAt - Date.now() > 60_000) return s.accessToken;
  if (!s.refreshToken) return null;
  try {
    const json = await postToken({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: s.refreshToken });
    return saveSession(json, s.refreshToken).accessToken;
  } catch {
    return null;
  }
}

const PROFILE_QUERY = 'query { userData { currentUser { id name guilds { id name server { slug name region { slug } } } } } }';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchProfile(token: string): Promise<WclUser> {
  const data = await postGraphql(USER_API, token, PROFILE_QUERY, {});
  const u = data.userData.currentUser;
  return {
    id: u.id,
    name: u.name,
    guilds: (u.guilds ?? []).map((g: any) => ({ id: g.id, name: g.name, serverSlug: g.server?.slug ?? '', serverName: g.server?.name ?? '', region: (g.server?.region?.slug ?? '').toUpperCase() })),
  };
}

/** Tempo para terminar o login na janela do Warcraft Logs. */
const LOGIN_TIMEOUT_MS = 5 * 60_000;

/**
 * Espera a página de volta do login (public/oauth.html) mandar a resposta. Vai por
 * BroadcastChannel e não por `window.opener`: as páginas do Warcraft Logs isolam a janela
 * (Cross-Origin-Opener-Policy), então quem abriu não a enxerga mais.
 */
function waitCallback(): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel('wipe-cause-oauth');
    const timer = window.setTimeout(() => {
      channel.close();
      reject(m().loginTimeout);
    }, LOGIN_TIMEOUT_MS);
    channel.onmessage = (e: MessageEvent<{ query?: string }>) => {
      window.clearTimeout(timer);
      channel.close();
      resolve(new URLSearchParams(e.data?.query ?? ''));
    };
  });
}

export async function wclLogin(): Promise<WclUser> {
  const verifier = random(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = random(16);
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'view-user-profile view-private-reports',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();
  const answer = waitCallback();
  if (!window.open(url, 'wipe-cause-wcl-login', 'popup,width=520,height=760')) throw m().popupBlocked;
  const q = await answer;
  if (q.get('state') !== state) throw m().loginBadState;
  const err = q.get('error');
  if (err) throw err === 'access_denied' ? m().loginCancelled : m().loginRejected(err);
  const code = q.get('code');
  if (!code) throw m().noToken;
  const session = saveSession(await postToken({ grant_type: 'authorization_code', client_id: CLIENT_ID, code_verifier: verifier, redirect_uri: redirectUri(), code }));
  const user = await fetchProfile(session.accessToken);
  lsSet('wcl-profile', user);
  return user;
}

export function wclLogout() {
  lsSet('wcl-session', null);
  lsSet('wcl-profile', null);
}

// ---------------------------------------------------------------- client próprio (opcional)

interface Client {
  id: string;
  secret: string;
}
let clientToken: { token: string; until: number } | null = null;

async function clientCredentialsToken(c: Client): Promise<string> {
  if (clientToken && Date.now() < clientToken.until) return clientToken.token;
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', headers: { Authorization: `Basic ${btoa(`${c.id}:${c.secret}`)}` }, body: new URLSearchParams({ grant_type: 'client_credentials' }) });
  } catch (e) {
    throw m().wclOffline(String(e));
  }
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  const json = await res.json();
  if (typeof json.access_token !== 'string') throw m().noToken;
  clientToken = { token: json.access_token, until: Date.now() + Math.max(60, Number(json.expires_in ?? 3600) - 300) * 1000 };
  return json.access_token;
}

export async function wclSetConfig(clientId: string, clientSecret: string) {
  const c = { id: clientId.trim(), secret: clientSecret.trim() };
  clientToken = null;
  if (!c.id && !c.secret) return lsSet('wcl-client', null);
  if (!c.id || !c.secret) throw m().fillClient;
  await clientCredentialsToken(c);
  lsSet('wcl-client', c);
}

export function wclGetConfig(): WclConfig {
  const user = lsGet<Session>('wcl-session') ? lsGet<WclUser>('wcl-profile') : null;
  const client = lsGet<Client>('wcl-client');
  return { configured: user != null || client != null, user, loginAvailable: true, clientId: client?.id ?? null };
}

// ---------------------------------------------------------------- consultas

function httpError(code: number, body: string): string {
  if (code === 400 || code === 401 || code === 403) return m().badClient;
  if (code === 429) return m().pointLimit;
  return m().wclStatus(code, body.slice(0, 300));
}

const UNAUTHORIZED = 'wcl-unauthorized';

/** POST GraphQL; devolve o texto da resposta (os eventos vão crus para o worker ler). */
async function post(url: string, token: string, query: string, variables: unknown): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  } catch (e) {
    throw m().wclOffline(String(e));
  }
  if (res.status === 401) throw UNAUTHORIZED;
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  return res.text();
}

function dataOf(text: string): any {
  const json = JSON.parse(text);
  const errors: string[] = (json.errors ?? []).map((e: any) => e.message).filter(Boolean);
  if (errors.length) throw m().wclQuery(errors.join('; '));
  return json.data;
}

const postGraphql = async (url: string, token: string, query: string, variables: unknown) => dataOf(await post(url, token, query, variables));

/** Com o login do usuário (vê os reports das guildas dele); sem login, com o client cadastrado. */
async function apiText(query: string, variables: unknown): Promise<string> {
  const token = await userToken();
  if (token) {
    try {
      return await post(USER_API, token, query, variables);
    } catch (e) {
      if (e !== UNAUTHORIZED) throw e;
      wclLogout();
      throw m().loginExpired;
    }
  }
  const client = lsGet<Client>('wcl-client');
  if (!client) throw m().signIn;
  try {
    return await post(CLIENT_API, await clientCredentialsToken(client), query, variables);
  } catch (e) {
    if (e !== UNAUTHORIZED) throw e;
    clientToken = null;
    throw m().loginExpired;
  }
}

export const apiQuery = async (query: string, variables: unknown) => dataOf(await apiText(query, variables));

/** `cacheKey`: guarda a resposta (só para dados que não mudam). */
export async function wclQuery(query: string, variables: unknown, cacheKey: string | null) {
  const key = cacheKey ? `wcl-cache:${cacheKey}` : null;
  if (key) {
    const hit = await idbGet(key);
    if (hit !== undefined) return hit;
  }
  const data = await apiQuery(query, variables);
  if (key) await idbSet(key, data).catch(() => {});
  return data;
}

// ---------------------------------------------------------------- análise de reports

const REPORT_QUERY = `query R($code: String!) {
  reportData { report(code: $code) {
    code title startTime endTime
    guild { name server { slug region { slug } } }
    fights { id encounterID name difficulty kill startTime endTime size }
    masterData(translate: false) {
      actors { id gameID name server type subType petOwner }
      abilities { gameID name type }
    }
  } }
}`;

const EVENTS_QUERY = `query E($code: String!, $fight: Int!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], startTime: $start, endTime: $end, includeResources: true, limit: 10000) { data nextPageTimestamp }
  } }
}`;

/** Reports com eventos guardados (os mais recentes). */
const KEEP_REPORTS = 6;
/** Fight com eventos do report depois dele (ou report parado há um tempo) não muda mais. */
const SETTLED_AFTER_MS = 30_000;
const REPORT_IDLE_MS = 10 * 60_000;

const eventsKey = (code: string, fight: number) => `wcl-events:${code}:${fight}`;

/** Marca os reports como usados agora e apaga os eventos dos mais antigos. */
async function pruneEvents(codes: string[]) {
  const used = lsGet<Record<string, number>>('wcl-events-used') ?? {};
  for (const c of codes) used[c] = Date.now();
  const old = Object.keys(used)
    .sort((a, b) => used[b] - used[a])
    .slice(KEEP_REPORTS);
  for (const c of old) {
    delete used[c];
    await idbDelPrefix(`wcl-events:${c}:`).catch(() => {});
  }
  lsSet('wcl-events-used', used);
}

interface Fight {
  report: number;
  id: number;
  startTime: number;
  endTime: number;
}

/** Junta páginas de eventos enxutos (cada uma um array JSON) num array só. */
const joinPages = (pages: string[]) => `[${pages.map((p) => p.slice(1, -1)).filter(Boolean).join(',')}]`;

/**
 * Analisa a noite dos reports: baixa os eventos de cada fight de boss e passa para o núcleo
 * no worker, página a página. Fights já baixados (e que não mudam mais) saem do IndexedDB.
 */
export async function analyzeReports(codes: string[], deathCutoff: number, tzHours: number, tunings: string, progress: (done: number, total: number) => void): Promise<{ report: LogReport; summary: Summary; size: number }> {
  const sid = await call<number>('wclNew', [deathCutoff, tzHours, tunings]);
  try {
    const spans: [number, number][] = [];
    for (const code of codes) {
      const data = await apiQuery(REPORT_QUERY, { code });
      const report = data?.reportData?.report;
      if (!report) throw m().reportNotFound(code);
      await call('wclAddReport', [sid, JSON.stringify(report)]);
      spans.push([report.startTime ?? 0, report.endTime ?? 0]);
    }
    const fights = JSON.parse(await call<string>('wclFights', [sid])) as Fight[];
    const total = Math.max(fights.length * 100, 1);
    for (const [i, f] of fights.entries()) {
      const done = i * 100;
      progress(done, total);
      const code = codes[f.report];
      const key = eventsKey(code, f.id);
      await call('wclBeginFight', [sid, f.report, f.id]);
      const cached = await idbGet<string>(key).catch(() => undefined);
      if (cached) {
        await call('wclPushSlim', [sid, cached]);
        continue;
      }
      const pages: string[] = [];
      let from: number | null = f.startTime;
      while (from != null) {
        const text = await apiText(EVENTS_QUERY, { code, fight: f.id, start: from, end: f.endTime });
        const r = await call<{ errors?: string[]; next?: number | null; slim?: string }>('wclPushResponse', [sid, text]);
        if (r.errors?.length) throw m().wclQuery(r.errors.join('; '));
        from = r.next ?? null;
        pages.push(r.slim ?? '[]');
        progress(done + Math.min(pages.length * 8, 95), total);
      }
      const [start, end] = spans[f.report];
      const settled = end - f.endTime > SETTLED_AFTER_MS || Date.now() - (start + end) > REPORT_IDLE_MS;
      if (settled) await idbSet(key, joinPages(pages)).catch(() => {});
    }
    await pruneEvents(codes);
    progress(total, total);
    const text = await call<string>('wclFinish', [sid, `wcl:${codes.join(',')}`]);
    return { ...(JSON.parse(text) as { report: LogReport; summary: Summary }), size: text.length };
  } catch (e) {
    await call('wclDrop', [sid]).catch(() => {});
    throw e;
  }
}
