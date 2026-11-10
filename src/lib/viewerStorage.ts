// Link de visualização: antes de qualquer outro módulo ler o localStorage, troca-o por um em memória.
// Importado primeiro no main.tsx. Fora do link não faz nada.

import { inViewer } from './backend';
import { MemoryStorage } from './sharedPrefs';

if (inViewer && typeof window !== 'undefined') {
  const memory = new MemoryStorage();
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => memory });
  } catch {
    // navegador que não deixa trocar: segue com o localStorage normal
  }
}
