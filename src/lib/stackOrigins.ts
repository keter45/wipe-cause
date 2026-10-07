// De onde vieram os stacks de um debuff acumulativo (regras `stack_limit` com `sources`), somado na
// noite de um boss: o total do raid por fonte e cada player, com os evitáveis separados.

import type { Pull, StackOrigin } from '../types';

export interface OriginSource {
  key: string;
  name: string;
  spellId: number | null;
  count: number;
}

export interface PlayerOrigins {
  guid: string;
  name: string;
  class: string | null;
  /** pulls em que o player estava */
  pulls: number;
  /** stacks evitáveis por fonte (key -> quantos) */
  avoidable: Record<string, number>;
  avoidableTotal: number;
  unavoidableTotal: number;
  removedTotal: number;
  /** mais stacks que chegou a ter num pull */
  maxStacks: number;
}

export interface StackOriginsNight {
  key: string;
  name: string;
  spellId: number | null;
  /** fontes evitáveis, as que mais deram stack primeiro (colunas da tabela) */
  avoidable: OriginSource[];
  unavoidable: OriginSource[];
  removed: OriginSource[];
  unknown: number;
  /** quem pegou algum stack, quem mais pegou evitável primeiro */
  players: PlayerOrigins[];
}

const total = (xs: { count: number }[]) => xs.reduce((n, x) => n + x.count, 0);

export function stackOriginsOfNight(pulls: Pull[]): StackOriginsNight[] {
  const byKey = new Map<string, StackOriginsNight & { srcs: Map<string, OriginSource>[]; byPlayer: Map<string, PlayerOrigins> }>();
  for (const pull of pulls) {
    const spellOf = new Map(pull.mechanics.map((m) => [m.key, m.spellId]));
    for (const m of pull.mechanics) {
      if (!m.stackOrigins?.length) continue;
      let n = byKey.get(m.key);
      if (!n) {
        n = { key: m.key, name: m.name, spellId: m.spellId, avoidable: [], unavoidable: [], removed: [], unknown: 0, players: [], srcs: [new Map(), new Map(), new Map()], byPlayer: new Map() };
        byKey.set(m.key, n);
      }
      const add = (i: number, xs: StackOrigin[]) => {
        for (const x of xs) {
          const cur = n.srcs[i].get(x.key) ?? n.srcs[i].set(x.key, { key: x.key, name: x.name, spellId: spellOf.get(x.key) ?? null, count: 0 }).get(x.key)!;
          cur.count += x.count;
        }
      };
      for (const o of m.stackOrigins) {
        add(0, o.avoidable);
        add(1, o.unavoidable);
        add(2, o.removed);
        n.unknown += o.unknown;
        const p =
          n.byPlayer.get(o.guid) ??
          n.byPlayer
            .set(o.guid, { guid: o.guid, name: o.name, class: null, pulls: 0, avoidable: {}, avoidableTotal: 0, unavoidableTotal: 0, removedTotal: 0, maxStacks: 0 })
            .get(o.guid)!;
        for (const a of o.avoidable) p.avoidable[a.key] = (p.avoidable[a.key] ?? 0) + a.count;
        p.avoidableTotal += total(o.avoidable);
        p.unavoidableTotal += total(o.unavoidable);
        p.removedTotal += total(o.removed);
        p.maxStacks = Math.max(p.maxStacks, o.maxStacks);
      }
    }
    // pulls jogados e classe: de quem estava no pull
    for (const n of byKey.values()) {
      for (const ps of pull.players) {
        const p = n.byPlayer.get(ps.guid);
        if (p) p.class ??= ps.class;
      }
    }
  }
  for (const n of byKey.values()) {
    for (const p of n.byPlayer.values()) p.pulls = pulls.filter((pl) => pl.mechanics.some((m) => m.key === n.key) && pl.players.some((x) => x.guid === p.guid)).length;
  }
  const sorted = (m: Map<string, OriginSource>) => [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return [...byKey.values()].map(({ srcs, byPlayer, ...n }) => ({
    ...n,
    avoidable: sorted(srcs[0]),
    unavoidable: sorted(srcs[1]),
    removed: sorted(srcs[2]),
    players: [...byPlayer.values()].sort((a, b) => b.avoidableTotal - a.avoidableTotal || b.maxStacks - a.maxStacks || a.name.localeCompare(b.name)),
  }));
}

export const sourcesTotal = total;
