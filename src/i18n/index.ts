// Idiomas do app: português (Brasil) e inglês. Todo texto da interface vive em dicionários
// `defineMessages(pt, en)`: o inglês é tipado contra o português, então faltar uma chave (ou mudar
// os parâmetros de uma frase) não compila. Nomes de habilidades, bosses e mecânicas ficam em
// inglês nos dois idiomas, como vêm do jogo.
//
// O que o núcleo (Rust) grava na análise vem com as duas línguas ({ pt, en }); `tr()` escolhe.

import { useSyncExternalStore } from 'react';

export type Locale = 'pt' | 'en';

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português (Brasil)' },
];

/**
 * O mesmo formato do dicionário português: as mesmas chaves, frases com os mesmos parâmetros e o
 * mesmo retorno (texto, ou JSX para frases com <code>, <em>, links).
 */
export type Shape<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : T[K] extends string ? string : T[K] extends readonly string[] ? readonly string[] : Shape<T[K]>;
};

export interface Messages<T> {
  pt: T;
  en: Shape<T>;
}

/** Um dicionário nas duas línguas (o inglês precisa ter tudo o que o português tem). */
export const defineMessages = <T,>(pt: T, en: Shape<T>): Messages<T> => ({ pt, en });

// ---------------------------------------------------------------- idioma atual

const KEY = 'wipe-cause:locale';

function initial(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'pt' || saved === 'en') return saved;
  } catch {
    /* sem storage */
  }
  return systemLocale();
}

/** Idioma do sistema: português se o computador estiver em português; senão inglês (o padrão). */
export function systemLocale(): Locale {
  const nav = typeof navigator !== 'undefined' ? (navigator.languages?.[0] ?? navigator.language ?? '') : '';
  return nav.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

/** Escolha em Configurações: um idioma fixo, ou seguir o sistema. */
export type LocaleChoice = Locale | 'system';

function initialChoice(): LocaleChoice {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'pt' || saved === 'en') return saved;
  } catch {
    /* sem storage */
  }
  return 'system';
}

let locale: Locale = initial();
let choice: LocaleChoice = initialChoice();
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export const getLocale = () => locale;

/** `'system'` volta a seguir o idioma do computador. */
export function setLocale(l: LocaleChoice) {
  if (l === choice) return;
  choice = l;
  locale = l === 'system' ? systemLocale() : l;
  try {
    if (l === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, l);
  } catch {
    /* vale só nesta sessão */
  }
  listeners.forEach((f) => f());
}

export const useLocale = () => useSyncExternalStore(subscribe, getLocale, getLocale);
const getChoice = () => choice;
export const useLocaleChoice = () => useSyncExternalStore(subscribe, getChoice, getChoice);

/** Dicionário no idioma atual (componente: re-renderiza quando o idioma muda). */
export function useMessages<T>(m: Messages<T>): T {
  return (useLocale() === 'en' ? m.en : m.pt) as T;
}

/** Dicionário no idioma atual, fora de componente (textos montados em lib/). */
export function messagesOf<T>(m: Messages<T>): T {
  return (locale === 'en' ? m.en : m.pt) as T;
}

/** Locale do Intl (números, datas). */
export const intlLocale = () => (locale === 'en' ? 'en-US' : 'pt-BR');

// ---------------------------------------------------------------- textos que vêm do núcleo

/** Texto gravado pelo núcleo nas duas línguas; análises antigas (e regras do usuário) têm só uma string. */
export type Loc = string | { pt: string; en: string };

export function tr(x: Loc | null | undefined): string {
  if (x == null) return '';
  return typeof x === 'string' ? x : (x[locale] ?? x.pt);
}
