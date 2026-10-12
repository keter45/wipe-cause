// Momento dos cooldowns de healer preso à mecânica do boss: um cooldown grande quase sempre cobre um
// golpe grande, e o tempo de luta escorrega de uma raid para outra (dano maior, fase empurrada antes).
// Cada uso vira "k-ésimo cast do boss + Δs"; o momento da referência é a mecânica em que a maioria dos
// logs usa o cooldown, e o seu uso é procurado em volta da mesma mecânica do seu pull.
// Só funções puras: o app usa para comparar e os testes rodam direto.

/** Cooldown usado até isso antes do cast do boss (preparar antes do dano) ainda conta para ele... */
export const ANCHOR_BEFORE_MS = 15_000;
/** ...e até isso depois (o dano cai depois do cast). */
export const ANCHOR_AFTER_MS = 30_000;
/** O seu uso conta como "nesse momento" até isso de distância do momento da referência. */
export const MATCH_MS = 12_000;
/** Dois momentos a menos disso um do outro são o mesmo (mecânicas coladas). */
const SAME_MOMENT_MS = 20_000;

/** Casts do boss que servem de marco, por spell: tempos (ms do pull) em ordem. */
export type Anchors = Record<string, number[]>;

export interface AnchoredSide {
  anchors: Anchors;
  /** usos do cooldown (ms do pull) */
  uses: number[];
}

export interface AnchoredMoment {
  /** spell do boss e qual cast dele (1 = primeiro) */
  anchor: number;
  k: number;
  /** mediana da referência: tempo do uso menos o tempo do cast */
  dt: number;
  /** fração dos logs de referência (que chegaram nessa mecânica) que usaram o cooldown nela */
  support: number;
  /** a mesma mecânica no seu pull (ms); null = a luta não chegou nela */
  at: number | null;
  /** o seu uso em volta dela, relativo ao cast; null = não usou */
  you: number | null;
}

/** Marco mais perto de um uso, dentro da janela (antes ou depois do cast). */
export function nearestAnchor(t: number, anchors: Anchors): { anchor: number; k: number; dt: number } | null {
  let best: { anchor: number; k: number; dt: number } | null = null;
  for (const [id, times] of Object.entries(anchors))
    times.forEach((at, i) => {
      const dt = t - at;
      if (dt < -ANCHOR_BEFORE_MS || dt > ANCHOR_AFTER_MS) return;
      if (!best || Math.abs(dt) < Math.abs(best.dt)) best = { anchor: +id, k: i + 1, dt };
    });
  return best;
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/**
 * Mecânicas em que pelo menos `minShare` dos logs de referência usam o cooldown, e o que você fez em
 * cada uma. `minRefs`: logs que chegaram na mecânica, no mínimo, para valer.
 */
export function anchoredMoments(refs: AnchoredSide[], ours: AnchoredSide, minShare: number, minRefs: number): AnchoredMoment[] {
  // cada log vota uma vez por mecânica, com o primeiro uso em volta dela
  const votes = new Map<string, { anchor: number; k: number; dts: Map<number, number> }>();
  refs.forEach((r, ri) => {
    for (const u of r.uses) {
      const a = nearestAnchor(u, r.anchors);
      if (!a) continue;
      const key = `${a.anchor}:${a.k}`;
      const v = votes.get(key) ?? votes.set(key, { anchor: a.anchor, k: a.k, dts: new Map() }).get(key)!;
      if (!v.dts.has(ri)) v.dts.set(ri, a.dt);
    }
  });
  const cands: (AnchoredMoment & { refAt: number })[] = [];
  for (const v of votes.values()) {
    const reached = refs.filter((r) => (r.anchors[v.anchor]?.length ?? 0) >= v.k);
    if (reached.length < minRefs) continue;
    const support = v.dts.size / reached.length;
    if (support < minShare) continue;
    const dt = median([...v.dts.values()]);
    const at = ours.anchors[v.anchor]?.[v.k - 1] ?? null;
    const refAt = median(reached.map((r) => r.anchors[v.anchor][v.k - 1])) + dt;
    cands.push({ anchor: v.anchor, k: v.k, dt, support, at, you: null, refAt });
  }
  // mecânicas coladas viram um momento só: fica a de mais apoio
  cands.sort((a, b) => b.support - a.support || Math.abs(a.dt) - Math.abs(b.dt));
  const kept: typeof cands = [];
  for (const c of cands) {
    const when = (m: typeof c) => (m.at != null ? m.at + m.dt : m.refAt);
    if (!kept.some((m) => Math.abs(when(m) - when(c)) < SAME_MOMENT_MS)) kept.push(c);
  }
  for (const m of kept) {
    if (m.at == null) continue;
    const expected = m.at + m.dt;
    const mine = ours.uses.filter((u) => Math.abs(u - expected) <= MATCH_MS).sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected))[0];
    m.you = mine != null ? mine - m.at : null;
  }
  return kept.sort((a, b) => (a.at ?? a.refAt) - (b.at ?? b.refAt)).map(({ refAt: _, ...m }) => m);
}
