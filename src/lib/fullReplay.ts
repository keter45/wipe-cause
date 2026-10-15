// O replay completo de um pull (o pull relido sozinho no log) e o que a aba Replay desenha por cima
// das posições: mortes, áreas em volta de quem tem um debuff, machados desmentidos ou sumidos,
// defensivos em área e o debuff crucial na cabeça. A aba Replay e o clipe usam os mesmos.

import type { Pull } from '../types';
import type { ZoneView } from '../components/ReplayView';
import { hasBackend, loadFight } from './api';
import { auraHolders, crucialAt, deadAt, idleAxegrinders, vacatedAreas, vacatedSince, vanishedAreas, type FightView } from './fight';
import type { ReplayData } from './replay';

/** Pulls já relidos nesta sessão (trocar de aba ou gerar outro clipe não relê o log). */
const cache = new Map<string, Promise<Pull>>();
const CACHE_MAX = 8;

const keyOf = (pull: Pull) => `${pull.logFile ?? ''}:${pull.logOffset ?? ''}:${pull.startMs}`;

/** Dá para reler o pull no log (app, site, ou o desenvolvimento com `?fight=`). */
export function canLoadFull(pull: Pull): boolean {
  if (pull.fight) return true;
  const devFight = import.meta.env.DEV && !hasBackend && new URLSearchParams(window.location.search).has('fight');
  return devFight || (hasBackend && !!pull.logFile && pull.logOffset != null);
}

/** O pull relido, se já estiver na memória. */
export async function cachedFull(pull: Pull): Promise<Pull | null> {
  const p = cache.get(keyOf(pull));
  return p ? p.catch(() => null) : null;
}

/**
 * O pull relido sozinho no log (posições do pull inteiro, vida, debuffs e eventos de cada player).
 * As marcas de chão vêm da análise do log inteiro (relendo só o pull, as que já estavam no chão
 * ficam de fora), e o tempo de cast de cada spell também (medido no log inteiro).
 */
export function loadFullPull(pull: Pull): Promise<Pull> {
  if (pull.fight) return Promise.resolve(pull);
  const key = keyOf(pull);
  let p = cache.get(key);
  if (!p) {
    p = loadFight(pull).then((f) => ({ ...f, ...(pull.markers?.length ? { markers: pull.markers } : {}), ...(pull.castMs ? { castMs: { ...f.castMs, ...pull.castMs } } : {}) }));
    // falhou: na próxima tenta de novo
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    // no ao vivo cada wipe relê o pull para o clipe: guarda só os últimos
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return p;
}

/** O que a aba Replay passa ao mapa, além das posições. */
export interface FightOverlays {
  isDead: (guid: string, t: number) => boolean;
  holders: (aura: number, t: number) => string[];
  vacated: (guid: string, t: number) => number | null;
  vanished: (guid: string, t: number) => boolean;
  zones: ZoneView[];
}

export function fightOverlays(pull: Pull, view: FightView, data: ReplayData): FightOverlays {
  // machados que alguém atravessou sem levar dano (já não estavam onde o replay estimava) e os que sumiram
  const vacatedMap = vacatedAreas(view, data);
  const idleMap = idleAxegrinders(view, data);
  const vanishedMap = vanishedAreas(view, data);
  const names = new Map(pull.players.map((p) => [p.guid, p.name] as const));
  return {
    isDead: (g, t) => deadAt(view, g, t),
    // centros das áreas em volta de players: quem tem a aura no instante (e está vivo)
    holders: (aura, t) => auraHolders(view, aura, t).filter((g) => !deadAt(view, g, t)),
    vacated: (g, t) => {
      const since = [vacatedSince(vacatedMap.get(g), t), vacatedSince(idleMap.get(g), t)].filter((value): value is number => value != null);
      return since.length ? Math.min(...since) : null;
    },
    vanished: (g, t) => vacatedSince(vanishedMap.get(g), t) != null,
    // defensivos de raid em área (AMZ, Darkness, Spirit Link...), no mapa com o norte para cima
    zones: (view.data.zones ?? []).map((z) => {
      const caster = view.data.players[z.caster];
      return { ...z, x: -z.y, y: z.x, caster, casterName: names.get(caster) ?? caster, name: view.data.spells[z.spellId] ?? String(z.spellId) };
    }),
  };
}

/** Debuff crucial na cabeça do player (os escondidos pelo usuário ficam de fora). */
export function headBadge(view: FightView, hidden: Set<number>) {
  return (g: string, t: number) => {
    const a = crucialAt(view, g, t, (id) => !hidden.has(id));
    return a ? { spellId: a.spellId, name: a.mechanic?.name ?? a.name, stacks: a.stacks } : null;
  };
}
