// Escolhas do usuário no replay que valem de uma sessão para outra: marcas de chão escondidas,
// debuffs tirados da cabeça dos players (por boss) e medidores recolhidos. Ficam no navegador do
// app; sem storage (modo privado, erro), valem só enquanto o app está aberto.

const KEY = 'wipe-cause:replay-prefs';

interface Prefs {
  /** chaves das mecânicas cujas marcas de chão estão escondidas */
  hiddenGround: string[];
  /** encounter id -> spells dos debuffs fora da cabeça */
  hiddenHead: Record<string, number[]>;
  metersCollapsed: boolean;
  /** áreas escondidas (chave da mecânica, ou orb:<tipo>) */
  hiddenAreas: string[];
  /** nomes embaixo das bolinhas na visão geral */
  showNames: boolean;
  /** marcas de chão do grupo no mapa */
  showMarkers: boolean;
}

let cache: Prefs | null = null;

function load(): Prefs {
  if (cache) return cache;
  let saved: Partial<Prefs> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
  } catch {
    /* sem storage */
  }
  cache = { hiddenGround: saved.hiddenGround ?? [], hiddenHead: saved.hiddenHead ?? {}, metersCollapsed: saved.metersCollapsed ?? false, hiddenAreas: saved.hiddenAreas ?? [], showNames: saved.showNames ?? true, showMarkers: saved.showMarkers ?? true };
  return cache;
}

function save(p: Prefs) {
  cache = p;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sem storage: fica só na memória */
  }
}

export const hiddenGround = () => new Set(load().hiddenGround);
export const setHiddenGround = (keys: Set<string>) => save({ ...load(), hiddenGround: [...keys] });

export const hiddenHead = (encounterId: number) => new Set(load().hiddenHead[encounterId] ?? []);
export const setHiddenHead = (encounterId: number, ids: Set<number>) => save({ ...load(), hiddenHead: { ...load().hiddenHead, [encounterId]: [...ids] } });

export const hiddenAreas = () => new Set(load().hiddenAreas);
export const setHiddenAreas = (keys: Set<string>) => save({ ...load(), hiddenAreas: [...keys] });

export const showNames = () => load().showNames;
export const setShowNames = (v: boolean) => save({ ...load(), showNames: v });

export const showMarkers = () => load().showMarkers;
export const setShowMarkers = (v: boolean) => save({ ...load(), showMarkers: v });

export const metersCollapsed = () => load().metersCollapsed;
export const setMetersCollapsed = (v: boolean) => save({ ...load(), metersCollapsed: v });
