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
    return await invoke<LogReport>('analyze_log', { path, deathCutoff });
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

const WCL_LINK_KEY = 'wipe-cause:wcl-report:';
/** Link do report do WCL lembrado por arquivo de log. */
export function savedWclLink(logFile: string): string {
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
  player: string | null;
}

export interface WcrScan {
  dir: string | null;
  source: 'settings' | 'recorder' | 'none';
  videos: WcrVideo[];
  warning: string | null;
}

export const wcrVideos = () => invoke<WcrScan>('wcr_videos');
/** Pasta cadastrada pelo usuário (null = detecção automática). Fica no settings.json do app. */
export const wcrGetDir = () => invoke<string | null>('wcr_get_dir');
export const wcrSetDir = (dir: string | null) => invoke<void>('wcr_set_dir', { dir });
/** Pasta configurada no próprio Warcraft Recorder, se instalado. */
export const wcrDetectDir = () => invoke<string | null>('wcr_detect_dir');

export async function videoSrc(path: string): Promise<string> {
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
// Histórico de análises (salvas pelo backend a cada análise)

export interface HistoryEntry {
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

export const historyList = () => (inTauri ? invoke<HistoryEntry[]>('history_list') : Promise.resolve(demoHistory()));
export const historyLoad = (id: string) => invoke<LogReport>('history_load', { id });
export const historySetPinned = (id: string, pinned: boolean) => (inTauri ? invoke<void>('history_set_pinned', { id, pinned }) : Promise.resolve());
export const historyDelete = (id: string) => (inTauri ? invoke<void>('history_delete', { id }) : Promise.resolve());
export const historyDeleteUnpinned = () => (inTauri ? invoke<number>('history_delete_unpinned') : Promise.resolve(0));

/** O relatório aberto é esta entrada do histórico? (mesmo arquivo de log) */
const normPath = (p: string) => p.replaceAll('\\', '/').toLowerCase();
export const sameLog = (a: string, b: string) => normPath(a) === normPath(b);
