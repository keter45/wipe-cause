// Histórico do site (o `history.rs` do app): uma entrada por log ou report, no IndexedDB.

import type { HistoryEntry } from '../lib/api';
import type { LogReport } from '../types';
import { messagesOf } from '../i18n';
import { webMsg } from './web.i18n';
import { openedFile } from './files';
import { idbDel, idbGet, idbSet } from './store';

/** O que o núcleo devolve junto com cada análise (`wipe_core::summary`). */
export interface Summary {
  raid: boolean;
  title: string;
  encounterId: number | null;
  bestHp: number | null;
  bestPhase?: string | null;
}

const INDEX = 'history:index';
const reportKey = (id: string) => `history:report:${id}`;
const compactKey = (id: string) => `history:compact:${id}`;

const loadIndex = async () => (await idbGet<HistoryEntry[]>(INDEX)) ?? [];
const saveIndex = (index: HistoryEntry[]) => idbSet(INDEX, index);

/** Id estável por log (FNV-1a do caminho, como no app). */
export function entryId(logPath: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(logPath.toLowerCase())) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

async function remove(index: HistoryEntry[], id: string) {
  await idbDel(reportKey(id));
  await idbDel(compactKey(id));
  return index.filter((e) => e.id !== id);
}

/** Salva (ou atualiza) a análise. `size` = tamanho do JSON. Log só de masmorra não entra. */
export async function saveAnalysis(report: LogReport, summary: Summary, logPath: string, size: number) {
  const id = entryId(logPath);
  let index = await loadIndex();
  if (!summary.raid) {
    if (index.some((e) => e.id === id)) await saveIndex(await remove(index, id));
    return;
  }
  await idbSet(reportKey(id), report);
  await idbDel(compactKey(id));
  const pinned = index.find((e) => e.id === id)?.pinned ?? false;
  index = index.filter((e) => e.id !== id);
  index.push({
    id,
    savedAt: Date.now(),
    title: summary.title,
    encounterId: summary.encounterId,
    raidStartMs: report.pulls[0]?.startMs ?? null,
    logPath,
    pulls: report.pulls.length,
    kills: report.pulls.filter((p) => p.success).length,
    bestHp: summary.bestHp,
    bestPhase: summary.bestPhase ?? null,
    deathCutoff: report.deathCutoff,
    pinned,
    size,
    logExists: true,
  });
  await saveIndex(index);
}

/** Fixadas primeiro, depois as mais recentes pela data da raid. */
export async function historyList(): Promise<HistoryEntry[]> {
  const index = await loadIndex();
  return index
    // o log local só dá para reler enquanto o arquivo está aberto nesta página
    .map((e) => ({ ...e, logExists: e.logPath.startsWith('wcl:') || openedFile(e.logPath) != null }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.raidStartMs ?? b.savedAt) - (a.raidStartMs ?? a.savedAt));
}

export async function historyLoad(id: string): Promise<LogReport> {
  const r = await idbGet<LogReport>(reportKey(id));
  if (!r) throw messagesOf(webMsg).notInHistory;
  return r;
}

export async function historySetPinned(id: string, pinned: boolean) {
  await saveIndex((await loadIndex()).map((e) => (e.id === id ? { ...e, pinned } : e)));
}

export async function historyDelete(id: string) {
  await saveIndex(await remove(await loadIndex(), id));
}

export async function historyDeleteUnpinned(): Promise<number> {
  let index = await loadIndex();
  const ids = index.filter((e) => !e.pinned).map((e) => e.id);
  for (const id of ids) index = await remove(index, id);
  await saveIndex(index);
  return ids.length;
}

/** Versão enxuta para a Evolução (sem recap, eventos, posições): o mesmo corte do app. */
export function compact(report: LogReport): LogReport {
  const strip = (o: object | undefined, keys: string[]) => {
    for (const k of keys) delete (o as Record<string, unknown> | undefined)?.[k];
  };
  const r = structuredClone(report);
  for (const p of r.pulls) {
    strip(p, ['raidSeries', 'enemyHits']);
    for (const d of p.deaths ?? []) strip(d, ['recap', 'debuffs', 'mechanicDamage', 'positions']);
    for (const m of p.mechanics ?? []) strip(m, ['events', 'snapshots']);
    for (const pl of p.players ?? []) strip(pl, ['takenByAbility', 'interruptLog', 'casts', 'damageBySpell', 'healingBySpell', 'setup', 'cdHeals']);
  }
  return r;
}

export async function historyTrends() {
  const index = (await loadIndex()).sort((a, b) => (a.raidStartMs ?? a.savedAt) - (b.raidStartMs ?? b.savedAt));
  const out: { id: string; title: string; raidStartMs: number | null; report: LogReport }[] = [];
  for (const e of index) {
    let report = await idbGet<LogReport>(compactKey(e.id));
    if (!report) {
      const full = await idbGet<LogReport>(reportKey(e.id));
      if (!full) continue;
      report = compact(full);
      await idbSet(compactKey(e.id), report);
    }
    out.push({ id: e.id, title: e.title, raidStartMs: e.raidStartMs, report });
  }
  return out;
}
