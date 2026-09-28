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
// Warcraft Logs (via backend Tauri) e links externos

export interface WclSettings {
  clientId: string;
  hasSecret: boolean;
}

export interface WclFight {
  id: number;
  encounterId: number;
  startMs: number;
  endMs: number;
  kill: boolean;
  fightPercentage: number | null;
  difficulty: number | null;
}

export interface WclReport {
  code: string;
  title: string;
  fights: WclFight[];
}

export const wclGetSettings = () => invoke<WclSettings>('wcl_get_settings');
export const wclSaveSettings = (clientId: string, clientSecret: string) =>
  invoke<void>('wcl_save_settings', { clientId, clientSecret });
export const wclReport = (report: string) => invoke<WclReport>('wcl_report', { report });

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
