// Armazenamento do site: IndexedDB para o que é grande (análises, eventos do Warcraft Logs,
// cache da API) e localStorage para configurações pequenas. Fica tudo no navegador de quem usa.

const DB = 'wipe-cause';
const STORE = 'kv';

let opened: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opened = null;
      reject(req.error);
    };
  });
  return opened;
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const idbGet = <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbSet = (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key)).then(() => {});
export const idbDel = (key: string) => tx('readwrite', (s) => s.delete(key)).then(() => {});
/** Chaves que começam com `prefix`. */
export const idbKeys = (prefix: string) => tx('readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`))).then((k) => k.map(String));
/** Apaga tudo que começa com `prefix`. */
export const idbDelPrefix = (prefix: string) => tx('readwrite', (s) => s.delete(IDBKeyRange.bound(prefix, `${prefix}￿`))).then(() => {});

const LS = 'wipe-cause:web:';

export function lsGet<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(LS + key);
    return v == null ? null : (JSON.parse(v) as T);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(LS + key);
    else localStorage.setItem(LS + key, JSON.stringify(value));
  } catch {
    /* sem storage: vale só nesta sessão */
  }
}
