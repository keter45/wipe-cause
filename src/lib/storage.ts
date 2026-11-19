// localStorage do app num lugar só: as chaves (todas com o prefixo `wipe-cause:`) e o acesso
// protegido (sem storage, em janela privada ou cheio, cada leitura cai no padrão e a escrita vale só
// nesta sessão). Booleano é sempre "1"/"0".

const P = 'wipe-cause:';

/** Todas as chaves do app. As que terminam em ":" são prefixos (+ boss, arquivo, pull...). */
export const KEYS = {
  // vão junto no link de visualização (sharedPrefs.ts)
  healNote: `${P}heal-note`,
  assignments: `${P}assignments:`,
  bossMetrics: `${P}boss-metrics:`,
  /** cards recolhíveis do resumo (`summary.<card>`) e da Evolução (`trends.<card>`) */
  collapse: P,
  parses: `${P}parses:`,
  replayPrefs: `${P}replay-prefs`,
  burstCds: `${P}burst-cds:`,
  // só neste computador
  notes: `${P}note:`,
  marks: `${P}marks:`,
  locale: `${P}locale`,
  mode: `${P}mode`,
  soloChar: `${P}solo-char`,
  autoLive: `${P}auto-live`,
  deathCutoff: `${P}death-cutoff`,
  logsFilter: `${P}logs-filter`,
  lastFile: `${P}last-file`,
  wclLink: `${P}wcl-report:`,
  wclAuto: `${P}wcl-report-auto:`,
  wcrDirOld: `${P}wcr-dir`,
  wclGuild: `${P}wcl-guild`,
  sim: `${P}sim:`,
  sidebarOpen: `${P}sidebar-open`,
  onboarded: `${P}onboarded`,
  perfPlayer: `${P}perf-player`,
  dungeonsOpen: `${P}dungeons-open`,
  demoTuning: `${P}demo-tuning:`,
  wowhead: `${P}wowhead:`,
  viewerKey: `${P}viewer-key`,
} as const;

/** Prefixos que vão para o link de visualização (as escolhas de tela de quem compartilha). */
export const SHARED_KEYS = [KEYS.healNote, KEYS.assignments, KEYS.bossMetrics, `${P}summary.`, `${P}trends.`, KEYS.parses, KEYS.replayPrefs, KEYS.burstCds];

const hasStorage = () => typeof localStorage !== 'undefined';

export const ls = {
  /** O texto salvo; null se não há (ou sem storage). */
  get(key: string): string | null {
    try {
      return hasStorage() ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  /** Salva; null ou "" apaga. */
  set(key: string, value: string | null) {
    try {
      if (!hasStorage()) return;
      if (value == null || value === '') localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  },
  remove(key: string) {
    ls.set(key, null);
  },
  /** JSON salvo; null se não há ou não deu para ler (valor antigo, quebrado). */
  getJson<T>(key: string): T | null {
    const raw = ls.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  /** Salva como JSON; null apaga. */
  setJson(key: string, value: unknown) {
    ls.set(key, value == null ? null : JSON.stringify(value));
  },
  /** "1"/"0"; `fallback` quando não há valor. */
  getBool(key: string, fallback: boolean): boolean {
    const v = ls.get(key);
    return v == null ? fallback : v !== '0';
  },
  setBool(key: string, on: boolean) {
    ls.set(key, on ? '1' : '0');
  },
};
