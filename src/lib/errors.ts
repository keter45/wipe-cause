// Erros que escapam do fluxo normal (promessas sem catch, erros fora do React): em vez de
// sumirem no console ou quebrarem a tela, viram um aviso no canto.

export interface AppError {
  id: number;
  /** onde aconteceu, para a mensagem ("Aba Desempenho", "Erro inesperado") */
  where: string;
  message: string;
  detail: string;
  t: number;
}

const listeners = new Set<(errors: AppError[]) => void>();
let errors: AppError[] = [];
let next = 1;
/** Mesmo erro repetido em sequência (ex.: um loop) vira um aviso só. */
const DEDUP_MS = 3_000;
const MAX_SHOWN = 3;

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

const errorDetail = (e: unknown) => (e instanceof Error ? (e.stack ?? e.message) : errorMessage(e));

export function reportError(e: unknown, where = 'Erro inesperado') {
  const message = errorMessage(e);
  const now = Date.now();
  if (errors.some((x) => x.message === message && now - x.t < DEDUP_MS)) return;
  errors = [...errors, { id: next++, where, message, detail: errorDetail(e), t: now }].slice(-MAX_SHOWN);
  console.error(`[${where}]`, e);
  listeners.forEach((f) => f(errors));
}

export function dismissError(id: number) {
  errors = errors.filter((x) => x.id !== id);
  listeners.forEach((f) => f(errors));
}

export function onErrors(f: (errors: AppError[]) => void): () => void {
  listeners.add(f);
  f(errors);
  return () => listeners.delete(f);
}

/** Pega o que ninguém tratou: promessas rejeitadas e erros soltos. Chamar uma vez, no início. */
export function installGlobalErrorHandlers() {
  window.addEventListener('unhandledrejection', (ev) => {
    ev.preventDefault();
    reportError(ev.reason);
  });
  window.addEventListener('error', (ev) => {
    // erro de carregamento de recurso (imagem do Wowhead etc.) não é erro do app
    if (!(ev.error instanceof Error) && !ev.message) return;
    reportError(ev.error ?? ev.message);
  });
}
