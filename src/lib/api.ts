import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { LogReport } from '../types';

/** Rodando dentro do app Tauri (e não no navegador durante o desenvolvimento da UI). */
export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function pickLogFile(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    title: 'Abrir combat log',
    filters: [{ name: 'Combat log', extensions: ['txt'] }],
  });
  return typeof picked === 'string' ? picked : null;
}

export async function analyzeLog(path: string, deathCutoff: number, onProgress: (fraction: number) => void): Promise<LogReport> {
  const unlisten = await listen<{ read: number; total: number }>('analyze-progress', (e) => {
    if (e.payload.total > 0) onProgress(e.payload.read / e.payload.total);
  });
  try {
    // o Warcraft Logs guarda os horários em UTC: mostra no fuso de quem vê
    const tzHours = -new Date().getTimezoneOffset() / 60;
    return await invoke<LogReport>('analyze_log', { path, deathCutoff, tzHours });
  } finally {
    unlisten();
  }
}

/** Fora do Tauri: carrega um relatório gerado por `wipe-cli analyze --json`. */
export async function readReportFile(file: File): Promise<LogReport> {
  return JSON.parse(await file.text()) as LogReport;
}

const LAST_FILE_KEY = 'wipe-cause:last-file';
export function lastFile(): string | null {
  try {
    return localStorage.getItem(LAST_FILE_KEY);
  } catch {
    return null;
  }
}
export function rememberFile(path: string) {
  try {
    localStorage.setItem(LAST_FILE_KEY, path);
  } catch {
    /* sem storage: ok */
  }
}

// ---------------------------------------------------------------------------
// Links externos e link do report do Warcraft Logs

/** Abre no navegador padrão (no app) ou numa aba nova (no navegador). */
export async function openExternal(url: string) {
  if (inTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** "Caminho" de uma análise feita a partir do Warcraft Logs (no lugar do arquivo de log). */
export const WCL_SOURCE = 'wcl:';
/** Código do report quando a análise veio do Warcraft Logs. */
export const wclSourceCodes = (file: string): string[] => (file.startsWith(WCL_SOURCE) ? file.slice(WCL_SOURCE.length).split(',').filter(Boolean) : []);
/** Report principal (o mais completo) quando a análise veio do Warcraft Logs. */
export const wclSourceCode = (file: string): string | null => wclSourceCodes(file)[0] ?? null;
/** Nome curto da fonte: o arquivo de log ou o(s) report(s) do Warcraft Logs. */
export function sourceName(file: string): string {
  const codes = wclSourceCodes(file);
  if (codes.length) return `Warcraft Logs · ${codes[0]}${codes.length > 1 ? ` +${codes.length - 1}` : ''}`;
  return file.split(/[\\/]/).pop() ?? file;
}
/** Código do report a partir do link colado (ou do próprio código). */
export function parseWclCode(input: string): string | null {
  const s = input.trim();
  const after = s.includes('/reports/') ? s.split('/reports/')[1] : s;
  const code = after.match(/^[A-Za-z0-9]+/)?.[0] ?? '';
  return code.length >= 8 ? code : null;
}

const WCL_LINK_KEY = 'wipe-cause:wcl-report:';
/** Link do report do WCL lembrado por arquivo de log (análise do WCL: o próprio report). */
export function savedWclLink(logFile: string): string {
  const code = wclSourceCode(logFile);
  if (code) return `https://www.warcraftlogs.com/reports/${code}`;
  try {
    return localStorage.getItem(WCL_LINK_KEY + logFile) ?? '';
  } catch {
    return '';
  }
}
export function saveWclLink(logFile: string, link: string) {
  try {
    localStorage.setItem(WCL_LINK_KEY + logFile, link);
  } catch {
    /* sem storage */
  }
}

// ---------------------------------------------------------------------------
// Warcraft Recorder (vídeos locais)

export interface WcrVideo {
  videoPath: string;
  encounterId: number;
  difficultyId: number | null;
  startMs: number;
  durationS: number;
  result: boolean;
  bossPercent: number | null;
  /** dono do POV */
  player: string | null;
  /** veio da nuvem do Recorder (`videoPath` é um link assinado) */
  cloud?: boolean;
}

export interface WcrScan {
  dir: string | null;
  source: 'settings' | 'recorder' | 'none';
  videos: WcrVideo[];
  warning: string | null;
}

export const wcrVideos = () => invoke<WcrScan>('wcr_videos');

/** Nuvem do Warcraft Recorder: conta (usuário + guilda; a senha fica no cofre) e os vídeos da guilda. */
export interface WcrCloudConfig {
  configured: boolean;
  user: string | null;
  guild: string | null;
}
export const wcrCloudGetConfig = () => (inTauri ? invoke<WcrCloudConfig>('wcr_cloud_get_config') : Promise.resolve<WcrCloudConfig>({ configured: false, user: null, guild: null }));
/** Devolve as guildas da conta (para escolher quando a guilda veio vazia). Usuário vazio desconecta. */
export const wcrCloudSetConfig = (user: string, pass: string, guild: string) => invoke<string[]>('wcr_cloud_set_config', { user, pass, guild });
export const wcrCloudVideos = () => (inTauri ? invoke<WcrVideo[]>('wcr_cloud_videos') : Promise.resolve<WcrVideo[]>([]));
/** Pasta cadastrada pelo usuário (null = detecção automática). Fica no settings.json do app. */
export const wcrGetDir = () => invoke<string | null>('wcr_get_dir');
export const wcrSetDir = (dir: string | null) => invoke<void>('wcr_set_dir', { dir });
/** Pasta configurada no próprio Warcraft Recorder, se instalado. */
export const wcrDetectDir = () => invoke<string | null>('wcr_detect_dir');

export async function videoSrc(path: string): Promise<string> {
  if (/^https:\/\//.test(path)) return path; // nuvem do Warcraft Recorder: link assinado
  if (!inTauri) return `/__video?path=${encodeURIComponent(path)}`; // dev no navegador (vite.config.ts)
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return convertFileSrc(path);
}

export async function pickFolder(title: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === 'string' ? picked : null;
}

/** Versões anteriores guardavam a pasta no localStorage: passa para o settings.json uma vez. */
export async function migrateWcrDir() {
  const KEY = 'wipe-cause:wcr-dir';
  try {
    const old = localStorage.getItem(KEY);
    if (old && !(await wcrGetDir())) await wcrSetDir(old);
    localStorage.removeItem(KEY);
  } catch {
    /* sem storage */
  }
}

// ---------------------------------------------------------------------------
// Pasta de logs do WoW (lista de combat logs para escolher)

export interface EncounterPeek {
  encounterId: number;
  name: string;
  difficultyId: number;
  difficultyName: string;
  /** masmorra (M+, delve…); índice antigo não tem */
  dungeon?: boolean;
  pulls: number;
  kills: number;
  /** início (epoch ms) de cada pull contado */
  starts?: number[];
}

export interface LogPeek {
  firstMs: number | null;
  lastMs: number | null;
  encounters: EncounterPeek[];
}

export interface LogFile {
  path: string;
  name: string;
  size: number;
  modifiedMs: number;
  /** subpasta (ex.: warcraftlogsarchive) */
  folder: string | null;
  /** encontros do log; null = ainda não lidos (pedir com logsPeek) */
  peek: LogPeek | null;
}

export interface LogsScan {
  dir: string | null;
  source: 'settings' | 'detected' | 'none';
  files: LogFile[];
  warning: string | null;
}

/** Dev no navegador: `?demoLogs=1` mostra uma pasta de exemplo (só visual). */
const demoLogs = (): LogsScan | null => {
  if (!import.meta.env.DEV || !new URLSearchParams(window.location.search).has('demoLogs')) return null;
  const enc = (name: string, pulls: number, kills: number, d = 'Mythic', id = 16): EncounterPeek => ({ encounterId: 0, name, difficultyId: id, difficultyName: d, pulls, kills });
  const h = 3_600_000;
  const now = Date.now();
  return {
    dir: 'A:\\World of Warcraft\\_retail_\\Logs',
    source: 'detected',
    warning: null,
    files: [
      { path: 'demo-28', name: 'WoWCombatLog-092826_204129.txt', size: 818e6, modifiedMs: now - 5 * 60_000, folder: null, peek: { firstMs: now - 2.5 * h, lastMs: now - 0.1 * h, encounters: [enc('The Twin Fangs', 12, 1), enc('The Coiled Altar', 11, 0)] } },
      { path: 'demo-27', name: 'WoWCombatLog-092726_145511.txt', size: 7.7e6, modifiedMs: now - 30 * h, folder: null, peek: { firstMs: null, lastMs: null, encounters: [] } },
      { path: 'demo-26', name: 'WoWCombatLog-092626_130731.txt', size: 221e6, modifiedMs: now - 52 * h, folder: null, peek: null },
      { path: 'demo-24', name: 'Archive-WoWCombatLog-092426_204015.txt', size: 1364e6, modifiedMs: now - 4 * 24 * h, folder: 'warcraftlogsarchive', peek: { firstMs: now - 4 * 24 * h, lastMs: now - 4 * 24 * h + 3 * h, encounters: [enc('The Twin Fangs', 28, 0)] } },
      { path: 'demo-22', name: 'Archive-WoWCombatLog-092226_180441.txt', size: 1338e6, modifiedMs: now - 6 * 24 * h, folder: 'warcraftlogsarchive', peek: { firstMs: now - 6 * 24 * h, lastMs: now - 6 * 24 * h + 4 * h, encounters: [enc('Nymrissa Wavecaller', 1, 1, 'Heroic', 15), enc('Sszorak', 1, 1, 'Heroic', 15), enc('The Coiled Altar', 1, 1, 'Heroic', 15), enc('Entombed Sentinels', 5, 1), enc('Vashnik the Malignant', 1, 1)] } },
    ],
  };
};

export const logsList = () => {
  const demo = demoLogs();
  if (demo) return Promise.resolve(demo);
  return inTauri ? invoke<LogsScan>('logs_list') : Promise.resolve<LogsScan>({ dir: null, source: 'none', files: [], warning: null });
};
export const logsPeek = (path: string) => invoke<LogPeek>('logs_peek', { path });
/** Pasta cadastrada (null = detecção automática). Fica no settings.json do app. */
export const logsGetDir = () => invoke<string | null>('logs_get_dir');
export const logsSetDir = (dir: string | null) => invoke<void>('logs_set_dir', { dir });
export const logsDetectDir = () => invoke<string | null>('logs_detect_dir');

// ---------------------------------------------------------------------------
// Modo ao vivo: o backend acompanha o log e reanalisa ao fim de cada pull

export interface LiveStatus {
  active: boolean;
  state: 'watching' | 'in_combat' | 'analyzing' | 'error' | 'stopped';
  file: string | null;
  encounter: string | null;
  analyzed: number;
  message: string | null;
}

/** `path` null = WoWCombatLog mais recente da pasta de logs. */
export const liveStart = (path: string | null, deathCutoff: number) => invoke<LiveStatus>('live_start', { path, deathCutoff });
export const liveStop = () => invoke<void>('live_stop');
export const liveStatus = () => invoke<LiveStatus>('live_status');
export const onLiveStatus = (cb: (s: LiveStatus) => void) => listen<LiveStatus>('live-status', (e) => cb(e.payload));
export const onLiveReport = (cb: (r: LogReport) => void) => listen<LogReport>('live-report', (e) => cb(e.payload));

// ---------------------------------------------------------------------------
// Discord (webhook do canal da raid)

export interface DiscordConfig {
  webhook: string | null;
  onWipe: boolean;
  onKill: boolean;
  /** resumo da noite no fim da raid (ao vivo) */
  onNight?: boolean;
}

export const discordGetConfig = () => invoke<DiscordConfig>('discord_get_config');
export const discordSetConfig = (config: DiscordConfig) => invoke<void>('discord_set_config', { config });
/** `webhook` = testar outro destino antes de salvar; sem ele usa o salvo. */
export const discordPost = (payload: unknown, webhook?: string) => invoke<void>('discord_post', { payload, webhook: webhook ?? null });

// ---------------------------------------------------------------------------
// Histórico de análises (salvas pelo backend a cada análise)

export interface HistoryEntry {
  /** encontro do título (ícone do boss); entradas antigas não têm */
  encounterId?: number | null;
  id: string;
  savedAt: number;
  title: string;
  raidStartMs: number | null;
  logPath: string;
  pulls: number;
  kills: number;
  bestHp: number | null;
  deathCutoff: number;
  pinned: boolean;
  size: number;
  logExists: boolean;
}

/** Dev no navegador: `?demoHistory=1` mostra um histórico de exemplo (só visual). */
const demoHistory = (): HistoryEntry[] =>
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoHistory')
    ? [
        { id: 'a', savedAt: Date.now(), title: '24/09 · The Twin Fangs Mythic', raidStartMs: 1790294668000, logPath: 'demo-24', pulls: 27, kills: 0, bestHp: 5.8, deathCutoff: 4, pinned: true, size: 3_100_000, logExists: true },
        { id: 'b', savedAt: Date.now() - 3 * 864e5, title: '21/09 · The Twin Fangs Mythic +5', raidStartMs: 1790035631000, logPath: 'demo-21', pulls: 31, kills: 6, bestHp: 14.5, deathCutoff: 4, pinned: false, size: 3_900_000, logExists: true },
        { id: 'c', savedAt: Date.now() - 8 * 864e5, title: '17/09 · Sszorak Mythic +2', raidStartMs: 1789690000000, logPath: 'demo-17', pulls: 19, kills: 2, bestHp: 0, deathCutoff: 0, pinned: false, size: 2_400_000, logExists: false },
      ]
    : [];

/** Análises salvas, enxutas (sem recap/eventos), da mais antiga para a mais nova — para a Evolução. */
export async function historyTrends(): Promise<{ id: string; title: string; raidStartMs: number | null; report: LogReport }[]> {
  if (import.meta.env.DEV && !inTauri && new URLSearchParams(window.location.search).has('demoTrends')) {
    // dev no navegador: relatórios gerados com wipe-cli em samples/trends/n1..n3.json
    const { logTitle } = await import('./format');
    const reports = await Promise.all([1, 2, 3].map((i) => fetch(`/samples/trends/n${i}.json`).then((r) => r.json() as Promise<LogReport>)));
    return reports.map((r, i) => ({ id: `n${i}`, title: logTitle(r.pulls), raidStartMs: r.pulls[0]?.startMs ?? null, report: r }));
  }
  return inTauri ? invoke('history_trends') : [];
}

export const historyList = () => (inTauri ? invoke<HistoryEntry[]>('history_list') : Promise.resolve(demoHistory()));
export const historyLoad = (id: string) => invoke<LogReport>('history_load', { id });
export const historySetPinned = (id: string, pinned: boolean) => (inTauri ? invoke<void>('history_set_pinned', { id, pinned }) : Promise.resolve());
export const historyDelete = (id: string) => (inTauri ? invoke<void>('history_delete', { id }) : Promise.resolve());
export const historyDeleteUnpinned = () => (inTauri ? invoke<number>('history_delete_unpinned') : Promise.resolve(0));

/** O relatório aberto é esta entrada do histórico? (mesmo arquivo de log) */
const normPath = (p: string) => p.replaceAll('\\', '/').toLowerCase();
export const sameLog = (a: string, b: string) => normPath(a) === normPath(b);

/** Pasta onde o usuário pode pôr regras de boss (*.yaml) que substituem as embutidas. */
/** "Abrir o Wipe Cause quando o WoW abrir" (inicia com o Windows, na bandeja). */
export const startupGet = () => (inTauri ? invoke<boolean>('startup_get') : Promise.resolve(false));
export const startupSet = (enabled: boolean) => invoke<void>('startup_set', { enabled });
export const rulesDir = () => (inTauri ? invoke<string | null>('rules_dir') : Promise.resolve(null));

/** Mostra o arquivo ou pasta no Explorador de Arquivos (permitido pelo opener:default). */
export async function revealInExplorer(path: string) {
  if (!inTauri) return;
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}
