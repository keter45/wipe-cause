// Fases cronometradas (regras `phase_duration`): intermissões em que o boss fica imune até o raid
// resolver a mecânica. Quanto mais rápido, melhor.

import type { MechanicResult, PhaseWindow, Pull } from '../types';

/** Mortes numa fase que mostram que a mecânica deu errado (o mesmo limite do núcleo). */
export const PHASE_FAIL_DEATHS = 3;

export type PhaseTone = 'good' | 'mid' | 'bad' | 'none';

export const phaseMechanics = (p: Pull): MechanicResult[] => p.mechanics.filter((m) => m.kind === 'phase_duration' && (m.phases?.length ?? 0) > 0);

export const phaseMs = (w: PhaseWindow): number | null => (w.end != null ? w.end - w.start : null);

/** A aura sai no tick do servidor (segundo cheio + ms): compara e mostra em segundos arredondados. */
export const phaseSec = (w: PhaseWindow): number | null => {
  const ms = phaseMs(w);
  return ms == null ? null : Math.round(ms / 1000);
};

export const failedPhase = (w: PhaseWindow) => !!w.wiped || (w.deaths ?? 0) >= PHASE_FAIL_DEATHS;

/** Verde no tempo bom, amarelo até o máximo, vermelho acima (ou com o raid morrendo na fase). */
export function phaseTone(w: PhaseWindow, m: Pick<MechanicResult, 'targetMs' | 'maxMs'>): PhaseTone {
  if (failedPhase(w)) return 'bad';
  const s = phaseSec(w);
  if (s == null) return 'none';
  if (m.targetMs != null && s * 1000 <= m.targetMs) return 'good';
  if (m.maxMs != null && s * 1000 > m.maxMs) return 'bad';
  return m.targetMs != null || m.maxMs != null ? 'mid' : 'none';
}

/** "18s", "wipe", "?" */
export function phaseLabel(w: PhaseWindow): string {
  const s = phaseSec(w);
  if (s != null) return `${s}s`;
  return w.wiped ? 'wipe' : '?';
}

export interface PhaseNight {
  key: string;
  name: string;
  spellId: number | null;
  targetMs?: number;
  maxMs?: number;
  /** pulls com a fase, em ordem; `windows[i]` = a i-ésima vez no pull */
  pulls: { pull: Pull; windows: PhaseWindow[] }[];
  /** quantas vezes a fase aparece no pull mais longo */
  slots: number;
  /** melhor tempo (s) de cada vez (1ª, 2ª...), só das fases limpas */
  best: (number | null)[];
  /** média (s) de todas as fases limpas da noite */
  avg: number | null;
}

/** As fases cronometradas de um boss na noite: cada pull, o melhor de cada vez e a média. */
export function phasesOfNight(pulls: Pull[]): PhaseNight[] {
  const byKey = new Map<string, PhaseNight>();
  for (const pull of pulls) {
    for (const m of phaseMechanics(pull)) {
      const cur =
        byKey.get(m.key) ??
        byKey.set(m.key, { key: m.key, name: m.name, spellId: m.spellId, targetMs: m.targetMs, maxMs: m.maxMs, pulls: [], slots: 0, best: [], avg: null }).get(m.key)!;
      cur.pulls.push({ pull, windows: m.phases! });
      cur.slots = Math.max(cur.slots, m.phases!.length);
    }
  }
  for (const n of byKey.values()) {
    const clean = (i: number) => n.pulls.map((p) => p.windows[i]).filter((w): w is PhaseWindow => !!w && !failedPhase(w) && phaseSec(w) != null);
    n.best = Array.from({ length: n.slots }, (_, i) => {
      const xs = clean(i).map((w) => phaseSec(w)!);
      return xs.length ? Math.min(...xs) : null;
    });
    const all = n.pulls.flatMap((p) => p.windows).filter((w) => !failedPhase(w) && phaseSec(w) != null).map((w) => phaseSec(w)!);
    n.avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
  }
  return [...byKey.values()];
}
