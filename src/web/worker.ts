// Web Worker com o núcleo em WASM: a análise (1+ GB de log, minutos de CPU) roda aqui para a
// página não travar. O log é lido aos pedaços direto do `File` (FileReaderSync só existe em
// worker), então nada dele é copiado inteiro para a memória.

import init, { analyzeFile, checkTuning, fightReplay, rulesBase, setEnglish, WclSession } from 'wipe-wasm/wipe_wasm.js';
import wasmUrl from 'wipe-wasm/wipe_wasm_bg.wasm?url';

declare const FileReaderSync: { new (): { readAsArrayBuffer(b: Blob): ArrayBuffer } };

const ready = init({ module_or_path: wasmUrl });
const sessions = new Map<number, WclSession>();
let nextSession = 1;

const reader = (file: Blob) => {
  const fr = new FileReaderSync();
  return (pos: number, len: number) => new Uint8Array(fr.readAsArrayBuffer(file.slice(pos, pos + len)));
};

function session(id: number): WclSession {
  const s = sessions.get(id);
  if (!s) throw new Error('session not found');
  return s;
}

type Progress = (done: number, total: number) => void;

/* eslint-disable @typescript-eslint/no-explicit-any */
const handlers: Record<string, (args: any[], progress: Progress) => unknown> = {
  setEnglish: ([en]) => setEnglish(en),
  analyzeFile: ([file, cutoff, tunings], progress) => analyzeFile(file.name, file.size, reader(file), progress, cutoff, tunings),
  fightReplay: ([file, offset, tunings]) => fightReplay(file.name, file.size, reader(file), offset, tunings),
  rulesBase: ([encounterId]) => rulesBase(encounterId),
  checkTuning: ([tuning]) => checkTuning(tuning),
  wclNew: ([cutoff, tz, tunings]) => {
    const id = nextSession++;
    sessions.set(id, new WclSession(cutoff, tz, tunings));
    return id;
  },
  wclAddReport: ([id, report]) => session(id).addReport(report),
  wclFights: ([id]) => session(id).fights(),
  wclBeginFight: ([id, report, fight]) => session(id).beginFight(report, fight),
  /** Resposta crua da API (texto): lê aqui, fora da página. Devolve a próxima página e os eventos enxutos. */
  wclPushResponse: ([id, text]) => {
    const json = JSON.parse(text);
    const errors: string[] = (json.errors ?? []).map((e: any) => e.message).filter(Boolean);
    if (errors.length) return { errors };
    const events = json.data?.reportData?.report?.events ?? {};
    const slim = session(id).pushPage(JSON.stringify(events.data ?? []));
    return { next: events.nextPageTimestamp ?? null, slim };
  },
  wclPushSlim: ([id, events]) => session(id).pushSlim(events),
  wclBeginReplay: ([id, report, fight]) => session(id).beginReplay(report, fight),
  wclReplay: ([id]) => {
    const s = session(id);
    sessions.delete(id);
    try {
      return s.replay();
    } finally {
      s.free();
    }
  },
  wclFinish: ([id, file]) => {
    const s = session(id);
    sessions.delete(id);
    try {
      return s.finish(file);
    } finally {
      s.free();
    }
  },
  wclDrop: ([id]) => {
    sessions.get(id)?.free();
    sessions.delete(id);
  },
};

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (e: MessageEvent<{ id: number; method: string; args: any[] }>) => {
  const { id, method, args } = e.data;
  try {
    await ready;
    const result = handlers[method](args, (done, total) => post({ id, progress: [done, total] }));
    post({ id, result });
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
