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

export async function analyzeLog(path: string, onProgress: (fraction: number) => void): Promise<LogReport> {
  const unlisten = await listen<{ read: number; total: number }>('analyze-progress', (e) => {
    if (e.payload.total > 0) onProgress(e.payload.read / e.payload.total);
  });
  try {
    return await invoke<LogReport>('analyze_log', { path });
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
}

export const wcrVideos = (dir: string | null) => invoke<WcrScan>('wcr_videos', { dir });

export async function videoSrc(path: string): Promise<string> {
  if (!inTauri) return `/__video?path=${encodeURIComponent(path)}`; // dev no navegador (vite.config.ts)
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return convertFileSrc(path);
}

export async function pickFolder(title: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === 'string' ? picked : null;
}

const WCR_DIR_KEY = 'wipe-cause:wcr-dir';
/** Pasta de vídeos escolhida no app (vazio = usar a do Warcraft Recorder). */
export function savedWcrDir(): string {
  try {
    return localStorage.getItem(WCR_DIR_KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveWcrDir(dir: string) {
  try {
    localStorage.setItem(WCR_DIR_KEY, dir);
  } catch {
    /* sem storage */
  }
}
