// Os comandos do backend do app (`invoke` do Tauri), implementados no navegador. Mesmos nomes,
// argumentos e respostas: a UI não muda. O que depende do PC (pasta de logs, ao vivo, bandeja,
// Warcraft Recorder) responde vazio ou avisa que é só do app.

import type { LogReport, Pull } from '../types';
import type { ChatMessage, AiConfig } from '../lib/ai';
import type { DiscordConfig } from '../lib/api';
import type { Tuning } from '../lib/rules';
import { messagesOf } from '../i18n';
import { webMsg } from './web.i18n';
import { call, setEngineEnglish } from './engine';
import { emit } from './events';
import { openedFile } from './files';
import { historyDelete, historyDeleteUnpinned, historyList, historyLoad, historySetPinned, historyTrends, saveAnalysis, type Summary } from './history';
import { aiChat, aiGetConfig, aiListModels, aiSetConfig, discordGetConfig, discordPost, discordPostFiles, discordSetConfig } from './integrations';
import { analyzeReports, replayFight, wclGetConfig, wclLogin, wclLogout, wclQuery, wclSetConfig } from './wcl';
import { idbDel, idbGet, idbKeys, idbSet } from './store';

const m = () => messagesOf(webMsg);

// ---------------------------------------------------------------- ajustes das regras

const tuningKey = (encounterId: number) => `rule-tuning:${encounterId}`;

/** Todos os ajustes do usuário, em JSON, para o núcleo aplicar por cima das regras. */
async function tunings(): Promise<string> {
  const keys = await idbKeys('rule-tuning:');
  return JSON.stringify(await Promise.all(keys.map((k) => idbGet<Tuning>(k))));
}

async function rulesGet(encounterId: number, name: string) {
  const base = JSON.parse(await call<string>('rulesBase', [encounterId])) as { name: string | null; file: string | null; mechanics: unknown[]; tunable: string[] };
  return { encounterId, name: base.name ?? name, file: base.file, mechanics: base.mechanics, tuning: (await idbGet<Tuning>(tuningKey(encounterId))) ?? null, tunable: base.tunable };
}

async function rulesSaveTuning(tuning: Tuning) {
  const empty = Object.values(tuning.mechanics).every((x) => Object.keys(x).length === 0) && tuning.custom.length === 0;
  if (empty) return idbDel(tuningKey(tuning.encounter_id));
  await call('checkTuning', [JSON.stringify(tuning)]);
  await idbSet(tuningKey(tuning.encounter_id), tuning);
}

// ---------------------------------------------------------------- análise

const WCL_PREFIX = 'wcl:';

function fileOrReopen(path: string): File {
  const file = openedFile(path);
  if (!file) throw m().reopenFile(path);
  return file;
}

async function analyzeLog(path: string, deathCutoff: number, tzHours: number): Promise<LogReport> {
  const progress = (read: number, total: number) => emit('analyze-progress', { read, total });
  let out: { report: LogReport; summary: Summary; size: number };
  if (path.startsWith(WCL_PREFIX)) {
    const codes = path.slice(WCL_PREFIX.length).split(',').filter(Boolean);
    out = await analyzeReports(codes, deathCutoff, tzHours, await tunings(), progress);
  } else {
    const text = await call<string>('analyzeFile', [fileOrReopen(path), deathCutoff, await tunings()], progress);
    out = { ...(JSON.parse(text) as { report: LogReport; summary: Summary }), size: text.length };
  }
  // se o histórico falhar (navegador sem espaço), a análise continua valendo
  await saveAnalysis(out.report, out.summary, path, out.size).catch((e) => console.warn('history', e));
  return out.report;
}

async function fightReplay(path: string, offset: number, tzHours: number): Promise<Pull> {
  // pull do Warcraft Logs: o "offset" é o id do fight
  if (path.startsWith(WCL_PREFIX)) return replayFight(path.slice(WCL_PREFIX.length), offset, tzHours, await tunings());
  return JSON.parse(await call<string>('fightReplay', [fileOrReopen(path), offset, await tunings()]));
}

// ---------------------------------------------------------------- despacho

/* eslint-disable @typescript-eslint/no-explicit-any */
type Args = Record<string, any>;

const appOnly = () => Promise.reject(m().appOnly);

const commands: Record<string, (a: Args) => unknown> = {
  analyze_log: (a) => analyzeLog(a.path, a.deathCutoff ?? 0, a.tzHours ?? 0),
  fight_replay: (a) => fightReplay(a.path, a.offset, a.tzHours ?? 0),
  set_locale: (a) => setEngineEnglish(a.locale === 'en'),
  rules_dir: () => null,
  rules_get: (a) => rulesGet(a.encounterId, a.name),
  rules_save_tuning: (a) => rulesSaveTuning(a.tuning),
  rules_reset_tuning: (a) => idbDel(tuningKey(a.encounterId)),

  history_list: () => historyList(),
  history_load: (a) => historyLoad(a.id),
  history_set_pinned: (a) => historySetPinned(a.id, a.pinned),
  history_delete: (a) => historyDelete(a.id),
  history_delete_unpinned: () => historyDeleteUnpinned(),
  history_trends: () => historyTrends(),

  wcl_get_config: () => wclGetConfig(),
  wcl_set_config: (a) => wclSetConfig(a.clientId, a.clientSecret),
  wcl_login: () => wclLogin(),
  wcl_logout: () => wclLogout(),
  wcl_query: (a) => wclQuery(a.query, a.variables, a.cacheKey ?? null),

  discord_get_config: () => discordGetConfig(),
  discord_set_config: (a) => discordSetConfig(a.config as DiscordConfig),
  discord_post: (a) => discordPost(a.payload, a.webhook),
  discord_post_image: (a) => discordPostFiles(a.payload, [{ name: a.fileName, mime: 'image/png', dataB64: a.dataB64 }], a.webhook),
  discord_post_files: (a) => discordPostFiles(a.payload, a.files, a.webhook),

  ai_get_config: () => aiGetConfig(),
  ai_set_config: (a) => aiSetConfig(a.config as AiConfig, a.apiKey ?? null),
  ai_list_models: (a) => aiListModels(a.provider, a.baseUrl, a.apiKey ?? null),
  ai_chat: (a) => aiChat(a.messages as ChatMessage[]),

  // só no app: dependem de arquivos e programas do PC
  logs_list: () => ({ dir: null, source: 'none', files: [], warning: null }),
  logs_get_dir: () => null,
  logs_detect_dir: () => null,
  logs_set_dir: appOnly,
  logs_peek: appOnly,
  live_status: () => ({ active: false, state: 'stopped', file: null, encounter: null, analyzed: 0, message: null }),
  live_start: appOnly,
  live_stop: () => undefined,
  startup_get: () => false,
  startup_set: appOnly,
  wcr_videos: () => ({ dir: null, source: 'none', videos: [], warning: null }),
  wcr_get_dir: () => null,
  wcr_set_dir: appOnly,
  wcr_detect_dir: () => null,
  wcr_cloud_get_config: () => ({ configured: false, user: null, guild: null }),
  wcr_cloud_set_config: appOnly,
  wcr_cloud_videos: () => [],
  fetch_image: appOnly,
  simc_status: () => ({ available: false, installed: null, latest: null, update: false, error: null }),
  simc_install: appOnly,
  simc_run: appOnly,
  simc_cancel: () => undefined,
  simc_saved_get: () => null,
  simc_saved_put: appOnly,
  save_file: appOnly,
};

export async function webInvoke<T>(cmd: string, args: Args): Promise<T> {
  const run = commands[cmd];
  if (!run) throw `unknown command: ${cmd}`;
  try {
    return (await run(args)) as T;
  } catch (e) {
    // como no app: o erro chega à UI como texto
    throw e instanceof Error ? e.message : String(e);
  }
}
