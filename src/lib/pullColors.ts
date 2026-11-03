import type { Pull } from '../types';
import { reachedPhase } from './phases';

/**
 * Cor de um pull pela proximidade do kill: kill = verde; wipe de boss de várias fases = cor da fase
 * em que acabou; wipe de uma fase só = azul da série. Usada no gráfico "Progresso por pull" e na
 * barra lateral. As variáveis (--viz-*, --accent, --info, --phase-3) ficam em :root.
 */
export function pullColor(p: Pick<Pull, 'success' | 'phaseMarks' | 'phaseCount'> & Partial<Pick<Pull, 'cutoffT'>>): string {
  if (p.success) return 'var(--viz-good)';
  const phase = reachedPhase(p);
  const idx = phase ? Math.min(phase.index, 3) : (p.phaseCount ?? 0) >= 2 ? 0 : -1;
  if (idx === 0) return 'var(--accent)';
  if (idx === 1 || idx === 2) return 'var(--info)';
  if (idx === 3) return 'var(--phase-3)';
  return 'var(--viz-series)';
}
