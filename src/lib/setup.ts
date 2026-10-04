// Estado do setup do app (o que já foi configurado) e navegação até a página de Configurações.
// Cada integração é lida do backend; a página e os atalhos espalhados pela UI usam o mesmo
// contexto, então salvar numa tela atualiza os indicadores das outras.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { discordGetConfig, inTauri, logsDetectDir, logsGetDir, wcrDetectDir, wcrGetDir, startupGet, wcrCloudGetConfig, type DiscordConfig, type WcrCloudConfig } from './api';
import { aiGetConfig, type AiConfig } from './ai';
import { wclGetConfig, type WclConfig } from './wclApi';

export type SettingsSection = 'logs' | 'game' | 'analysis' | 'startup' | 'wcl' | 'videos' | 'discord' | 'ai' | 'about';

export interface SetupStatus {
  /** pasta Logs do WoW em uso (cadastrada ou detectada) */
  logsDir: string | null;
  logsSource: 'settings' | 'detected' | 'none';
  /** pasta de vídeos do Warcraft Recorder em uso */
  wcrDir: string | null;
  discord: DiscordConfig | null;
  ai: AiConfig | null;
  wcl: WclConfig | null;
  /** abrir o app quando o WoW abrir */
  openWithWow: boolean;
  /** nuvem do Warcraft Recorder (POVs da guilda) */
  wcrCloud: WcrCloudConfig | null;
}

/** Navegador (dev): um setup de exemplo, com a pasta de logs e a IA prontas. */
const DEMO: SetupStatus = {
  logsDir: 'A:\\World of Warcraft\\_retail_\\Logs',
  logsSource: 'detected',
  wcrDir: null,
  discord: { webhook: null, onWipe: true, onKill: true },
  // ?demoAiSetup=1 mostra a aba da IA sem provedor
  ai: typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demoAiSetup') ? null : { provider: 'demo', baseUrl: '', model: 'demo', hasKey: true },
  wcl: { configured: false, clientId: null },
  openWithWow: false,
  wcrCloud: null,
};

async function loadStatus(): Promise<SetupStatus> {
  if (!inTauri) return DEMO;
  const safe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [logsSaved, logsDetected, wcrSaved, wcrDetected, discord, ai, wcl, openWithWow, wcrCloud] = await Promise.all([
    safe(logsGetDir(), null),
    safe(logsDetectDir(), null),
    safe(wcrGetDir(), null),
    safe(wcrDetectDir(), null),
    safe(discordGetConfig(), null),
    safe(aiGetConfig(), null),
    safe(wclGetConfig(), null),
    safe(startupGet(), false),
    safe(wcrCloudGetConfig(), null),
  ]);
  return {
    logsDir: logsSaved ?? logsDetected,
    logsSource: logsSaved ? 'settings' : logsDetected ? 'detected' : 'none',
    wcrDir: wcrSaved ?? wcrDetected,
    discord,
    ai,
    wcl,
    openWithWow,
    wcrCloud,
  };
}

export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const reload = useCallback(() => loadStatus().then(setStatus), []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { status, reload };
}

/** O que falta para o app funcionar (sem isso não há logs para analisar). */
export const missingRequired = (s: SetupStatus | null) => s != null && !s.logsDir;

/** Integrações opcionais prontas (para o resumo "2 de 4"). */
export function optionalDone(s: SetupStatus | null): { done: number; total: number } {
  if (!s) return { done: 0, total: 4 };
  const flags = [!!s.wcl?.configured, !!s.wcrDir, !!s.discord?.webhook, !!s.ai];
  return { done: flags.filter(Boolean).length, total: flags.length };
}

interface SetupContextValue {
  status: SetupStatus | null;
  reload: () => Promise<void>;
  /** abre a página de Configurações, rolando até a seção */
  openSettings: (section?: SettingsSection) => void;
}

export const SetupContext = createContext<SetupContextValue>({
  status: null,
  reload: async () => {},
  openSettings: () => {},
});

export const useSetup = () => useContext(SetupContext);
