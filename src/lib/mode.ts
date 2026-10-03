// Modo do app: "guilda" (por que a raid wipou) ou "solo" (como você, sozinho, pode melhorar).
// Fica salvo neste PC; o personagem escolhido no solo também.

import { useSyncExternalStore } from 'react';
import type { PlayerStats, Pull } from '../types';

export type AppMode = 'guild' | 'solo';

const MODE_KEY = 'wipe-cause:mode';
const CHAR_KEY = 'wipe-cause:solo-char';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* sem storage: vale só nesta sessão */
  }
};

let mode: AppMode = read(MODE_KEY) === 'solo' ? 'solo' : 'guild';
let char: string | null = read(CHAR_KEY);
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const emit = () => listeners.forEach((f) => f());

export function setMode(m: AppMode) {
  mode = m;
  write(MODE_KEY, m);
  emit();
}
export const useMode = () => useSyncExternalStore(subscribe, () => mode);

/** Personagem escolhido no modo solo ("Nome-Reino"); null = quem gravou o log. */
export function setSoloCharacter(name: string | null) {
  char = name;
  write(CHAR_KEY, name);
  emit();
}
export const useSoloCharacter = () => useSyncExternalStore(subscribe, () => char);

/**
 * Você neste pull: o personagem escolhido (se estava no pull), senão quem gravou o log.
 * No Warcraft Logs não há "quem gravou": sem escolha, fica sem ninguém (a tela pede para escolher).
 */
export function meIn(pull: Pull, chosen: string | null): PlayerStats | null {
  if (chosen) {
    const p = pull.players.find((x) => x.name === chosen);
    if (p) return p;
  }
  return pull.players.find((x) => x.guid === pull.ownerGuid) ?? null;
}
