// O que quem compartilha ajustou na tela vai junto para o link de visualização: a note de CDs de
// cura, as métricas do grupo escolhidas por boss, os cards abertos ou recolhidos, os parses do
// WCL (entram na nota de cada player), as camadas do replay e os CDs escolhidos no desempenho.
//
// No app, essas escolhas ficam no localStorage. O app manda as chaves abaixo para o servidor do link
// (`share_prefs_set`); o visitante recebe com `share_prefs_get` e usa numa cópia em memória: nada vai
// para o localStorage do navegador dele, que no site é o mesmo da versão web (a note dele não pode
// ser trocada pela de quem compartilhou).

/** Prefixos das chaves (`wipe-cause:…`) que vão para o link. Notas, marcas e configurações ficam de fora. */
export const SHARED_PREFIXES = [
  'wipe-cause:heal-note',
  'wipe-cause:assignments:',
  'wipe-cause:boss-metrics:',
  'wipe-cause:summary.',
  'wipe-cause:trends.',
  'wipe-cause:parses:',
  'wipe-cause:replay-prefs',
  'wipe-cause:burst-cds:',
];

export const isShared = (key: string) => SHARED_PREFIXES.some((p) => key.startsWith(p));

/** As escolhas de quem compartilha, para mandar ao link. */
export function collectSharedPrefs(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && isShared(key)) {
      const v = storage.getItem(key);
      if (v != null) out[key] = v;
    }
  }
  return out;
}

/** Um `Storage` só em memória (some ao fechar a aba). */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

/**
 * Troca as escolhas de quem compartilha pelas novas (as que ele apagou somem). Devolve se algo
 * mudou. O que o visitante mexer fora dessas chaves fica como está.
 */
export function applySharedPrefs(storage: Storage, prefs: Record<string, string>): boolean {
  let changed = false;
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key && isShared(key) && !(key in prefs)) {
      storage.removeItem(key);
      changed = true;
    }
  }
  for (const [k, v] of Object.entries(prefs)) {
    if (!isShared(k) || storage.getItem(k) === v) continue;
    storage.setItem(k, v);
    changed = true;
  }
  return changed;
}
