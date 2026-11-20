// A forma que o replay desenha bate com o log? Para cada mecânica com forma, nos instantes em que a forma
// está no mapa: quantos acertos do dano da mecânica caíram dentro dela (TPR) e quantos players que não
// tomaram estavam dentro (FPR). Youden = TPR − FPR. Lê o pull completo do `wipe-cli fight` (tracks, fight,
// soaks, blasts, pools, waves, areas, casts) e a regra do boss (`wipe-cli rules`). Usado pelo replay:check.
//
// Fora: as marcas de chão (saem dos próprios acertos) e o soak/explosão sem lançador, cujo centro é o meio
// de quem tomou (o TPR seria sempre alto): esses ficam com `derived: true`.

/** Players que não tomaram contam como "perto" até tantas jardas além da borda da forma. */
export const NEAR_YD = 15;
/** Janela do golpe depois do instante da forma (soak, explosão, cone). */
const HIT_AFTER_MS = 1500;
const HIT_BEFORE_MS = 300;
/** Dois acertos no mesmo pulso de uma área: até isto de distância no tempo. */
const PULSE_MS = 60;
/** Onda: folga na frente (jd) e de lado. */
const WAVE_FRONT_YD = 3;
const WAVE_SIDE_YD = 1;

/** Os ids de dano de uma mecânica (o que prova que alguém tomou). */
export function damageIdsOf(m) {
  const d = m?.detect ?? {};
  // os `fail_ids` ficam de fora: costumam ser a explosão no raid inteiro quando a mecânica falha
  const ids = [...(d.damage_ids ?? []), ...(m?.blast?.event_ids ?? [])];
  return new Set(ids.filter((x) => typeof x === 'number'));
}

/** Posição de uma unidade em `t` pelos trechos do replay (décimos de jarda), ou null fora deles. */
export function posAt(track, t, step) {
  for (const s of track?.segs ?? []) {
    const n = s.xy.length / 2;
    const i = (t - s.t0) / step;
    if (i < 0 || i > n - 1) continue;
    const a = Math.floor(i);
    const b = Math.min(a + 1, n - 1);
    const f = i - a;
    return [(s.xy[2 * a] + (s.xy[2 * b] - s.xy[2 * a]) * f) / 10, (s.xy[2 * a + 1] + (s.xy[2 * b + 1] - s.xy[2 * a + 1]) * f) / 10];
  }
  return null;
}

const npcOf = (guid) => {
  const p = guid.split('-');
  return p[0] === 'Creature' || p[0] === 'Vehicle' ? Number(p[5]) : null;
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Contas de uma mecânica: acertos dentro / total, quem não tomou dentro / perto. */
function tally() {
  return { hits: 0, inside: 0, nonHit: 0, nonHitInside: 0 };
}

/**
 * Mede as formas de um pull. Devolve um mapa chave da mecânica -> { shape, derived, hits, inside, nonHit,
 * nonHitInside } (somáveis entre pulls com `mergeFits`).
 */
export function shapeFit(pull, rule) {
  const fight = pull.fight;
  const tracks = pull.tracks;
  if (!fight || !tracks) return {};
  const step = tracks.step_ms ?? tracks.stepMs;
  const byGuid = new Map(tracks.units.map((u) => [u.guid, u]));
  const players = fight.players;
  const mechs = new Map((rule?.mechanics ?? []).map((m) => [m.key, m]));

  // vivo em t: a última vida conhecida antes de t não é 0
  const alive = (pi, t) => {
    let hp = 100;
    for (const [ht, v] of fight.hp[pi] ?? []) {
      if (ht > t) break;
      hp = v;
    }
    return hp > 0;
  };
  const ppos = (pi, t) => posAt(byGuid.get(players[pi]), t, step);
  // acertos por spell: [t, player]
  const hitsBy = new Map();
  for (const [t, kind, pi, spell] of fight.events) {
    if (kind !== 0) continue;
    if (!hitsBy.has(spell)) hitsBy.set(spell, []);
    hitsBy.get(spell).push([t, pi]);
  }
  const hitsOf = (ids, from, to) => [...ids].flatMap((id) => (hitsBy.get(id) ?? []).filter(([t]) => t >= from && t <= to));

  const out = {};
  const acc = (key, shape, derived = false) => (out[key] ??= { shape, derived, ...tally() });

  /** Forma de um instante: quem tomou na janela × quem estava perto e não tomou. */
  function instant(key, shape, derived, ids, at, inside, near) {
    const hits = hitsOf(ids, at - HIT_BEFORE_MS, at + HIT_AFTER_MS);
    if (!hits.length && derived) return;
    const a = acc(key, shape, derived);
    const hitP = new Set();
    for (const [t, pi] of hits) {
      if (hitP.has(pi)) continue;
      const p = ppos(pi, t);
      if (!p) continue;
      hitP.add(pi);
      a.hits++;
      if (inside(p, t)) a.inside++;
    }
    for (let pi = 0; pi < players.length; pi++) {
      if (hitP.has(pi) || !alive(pi, at)) continue;
      const p = ppos(pi, at);
      if (!p || !near(p)) continue;
      a.nonHit++;
      if (inside(p, at)) a.nonHitInside++;
    }
  }

  // vários círculos da mesma mecânica no mesmo instante (um por soaker): o acerto vale se cair em qualquer um
  const groups = new Map();
  for (const [shape, list] of [['soak', pull.soaks ?? []], ['explosão', pull.blasts ?? []]])
    for (const v of list) {
      const g = [...groups.values()].find((x) => x.shape === shape && x.key === v.key && Math.abs(x.at - v.at) <= 500);
      if (g) g.list.push(v);
      else groups.set(groups.size, { shape, key: v.key, at: v.at, list: [v] });
    }
  for (const { shape, key, at, list } of groups.values()) {
    const ids = damageIdsOf(mechs.get(key));
    if (!ids.size) ids.add(list[0].spellId);
    // soak sem lançador e explosão: o centro é o meio de quem tomou
    const derived = shape === 'soak' ? list.some((v) => !v.caster) : true;
    const inside = (p) => list.some((v) => dist(p, [v.x, v.y]) <= v.radius);
    const near = (p) => list.some((v) => dist(p, [v.x, v.y]) <= v.radius + NEAR_YD);
    instant(key, shape, derived, ids, at, inside, near);
  }

  for (const c of pull.casts ?? []) {
    if (!c.cone || c.interrupted) continue;
    const key = [...mechs.values()].find((m) => m.cone?.cast_id === c.spellId)?.key;
    if (!key) continue;
    const ids = damageIdsOf(mechs.get(key));
    if (!ids.size) continue;
    const at = c.end ?? c.t;
    const origin = posAt(byGuid.get(c.guid), at, step);
    if (!origin) continue;
    const tp = c.target ? posAt(byGuid.get(c.target), at, step) : null;
    const dir = tp ? Math.atan2(tp[1] - origin[1], tp[0] - origin[0]) : c.facing;
    if (dir == null) continue;
    const half = (c.cone.halfAngle * Math.PI) / 180;
    const inside = (p) => dist(p, origin) <= c.cone.range && Math.abs(wrap(Math.atan2(p[1] - origin[1], p[0] - origin[0]) - dir)) <= half;
    instant(key, 'cone', false, ids, at, inside, (p) => dist(p, origin) <= c.cone.range + NEAR_YD);
  }

  // poças: amostras de 1 s enquanto a poça está no chão (depois de crescer)
  for (const v of pull.pools ?? []) {
    const ids = damageIdsOf(mechs.get(v.key));
    if (!ids.size) ids.add(v.spellId);
    const a = acc(v.key, 'poça');
    const inside = (p) => v.circles.some(([x, y, r]) => dist(p, [x, y]) <= r);
    const near = (p) => v.circles.some(([x, y, r]) => dist(p, [x, y]) <= r + NEAR_YD);
    for (let t = v.on + (v.growMs ?? 0); t + 1000 <= v.to; t += 1000) {
      const hitP = new Set(hitsOf(ids, t, t + 1000).map(([, pi]) => pi));
      for (let pi = 0; pi < players.length; pi++) {
        if (!alive(pi, t)) continue;
        const p = ppos(pi, t);
        if (!p) continue;
        if (hitP.has(pi)) {
          a.hits++;
          if (inside(p)) a.inside++;
        } else if (near(p)) {
          a.nonHit++;
          if (inside(p)) a.nonHitInside++;
        }
      }
    }
  }

  // áreas: por pulso, em volta de quem tem a aura (sem contar o próprio portador) ou da unidade
  for (const v of pull.areas ?? []) {
    const ids = damageIdsOf(mechs.get(v.key));
    if (v.spellId) ids.add(v.spellId);
    if (!ids.size) continue;
    const a = acc(v.key, v.npc ? 'área na unidade' : 'área no portador');
    const holders = v.aura ? fight.auras.filter((x) => x[1] === v.aura) : [];
    const units = v.npc ? tracks.units.filter((u) => npcOf(u.guid) === v.npc) : [];
    const centers = (t, self) => [
      ...holders.filter(([pi, , from, to]) => pi !== self && t >= from && t <= to).map(([pi]) => ppos(pi, t)),
      ...units.map((u) => posAt(u, t, step)),
    ].filter(Boolean);
    const hits = hitsOf(ids, -Infinity, Infinity).sort((x, y) => x[0] - y[0]);
    let i = 0;
    while (i < hits.length) {
      const t0 = hits[i][0];
      let j = i;
      while (j < hits.length && hits[j][0] - t0 <= PULSE_MS) j++;
      const hitP = new Set(hits.slice(i, j).map(([, pi]) => pi));
      for (let pi = 0; pi < players.length; pi++) {
        // o portador toma o próprio DoT: ele é o centro, não conta
        if (!alive(pi, t0) || holders.some(([h, , from, to]) => h === pi && t0 >= from && t0 <= to)) continue;
        const p = ppos(pi, t0);
        const cs = p ? centers(t0, pi) : [];
        if (!cs.length) continue;
        const d = Math.min(...cs.map((c) => dist(p, c)));
        if (hitP.has(pi)) {
          a.hits++;
          if (d <= v.radius) a.inside++;
        } else if (d <= v.radius + NEAR_YD) {
          a.nonHit++;
          if (d <= v.radius) a.nonHitInside++;
        }
      }
      i = j;
    }
  }

  // ondas: cada acerto vale uma vez por mecânica e está dentro se a frente de alguma onda dela passava por
  // ali naquele instante (vários marcados soltam ondas juntos). Quem a frente cruzou e não tomou perto
  // dessa hora conta como "dentro sem tomar".
  const waveGroups = new Map();
  for (const v of pull.waves ?? []) {
    if (!waveGroups.has(v.key)) waveGroups.set(v.key, []);
    waveGroups.get(v.key).push(v);
  }
  for (const [key, ws] of waveGroups) {
    const ids = damageIdsOf(mechs.get(key));
    if (!ids.size) ids.add(ws[0].spellId);
    const a = acc(key, ws[0].inferred ? 'onda (inferida)' : 'onda');
    const geo = ws.map((v) => {
      const front = (t) => v.start + (v.speed * (t - v.at)) / 1000;
      const end = v.at + v.durationMs;
      const tol = v.speed * 0.3 + WAVE_FRONT_YD;
      const local = (p, ang) => {
        const dx = p[0] - v.x;
        const dy = p[1] - v.y;
        return [dx * Math.cos(ang) + dy * Math.sin(ang), Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang))];
      };
      const onFront = (p, t) => t >= v.at - 200 && t <= end + 500 && v.angles.some((ang) => {
        const [along, side] = local(p, ang);
        return side <= v.width / 2 + WAVE_SIDE_YD && Math.abs(along - front(t)) <= tol;
      });
      return { v, front, end, tol, local, onFront };
    });
    const seen = new Set();
    const hitTimes = new Map();
    for (const g of geo)
      for (const [t, pi] of hitsOf(ids, g.v.at, g.end + 500)) {
        const k = `${t}:${pi}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!hitTimes.has(pi)) hitTimes.set(pi, []);
        hitTimes.get(pi).push(t);
        const p = ppos(pi, t);
        if (!p) continue;
        a.hits++;
        if (geo.some((x) => x.onFront(p, t))) a.inside++;
      }
    const hitNear = (pi, t) => (hitTimes.get(pi) ?? []).some((h) => Math.abs(h - t) <= 700);
    for (const { v, front, end, tol, local } of geo)
      for (let pi = 0; pi < players.length; pi++) {
        let crossedAt = null;
        let near = false;
        for (let t = v.at; t <= end && crossedAt == null; t += 250) {
          if (!alive(pi, t)) continue;
          const p = ppos(pi, t);
          if (!p) continue;
          for (const ang of v.angles) {
            const [along, side] = local(p, ang);
            if (along < 0 || along > front(end)) continue;
            if (side <= v.width / 2 + NEAR_YD) near = true;
            if (side <= v.width / 2 + WAVE_SIDE_YD && Math.abs(along - front(t)) <= tol) crossedAt = t;
          }
        }
        if (!near || (crossedAt != null ? hitNear(pi, crossedAt) : (hitTimes.get(pi) ?? []).some((h) => h >= v.at && h <= end + 500))) continue;
        a.nonHit++;
        if (crossedAt != null) a.nonHitInside++;
      }
  }
  return out;
}

/** Soma as contas de vários pulls. */
export function mergeFits(fits) {
  const out = {};
  for (const f of fits)
    for (const [k, v] of Object.entries(f)) {
      const o = (out[k] ??= { shape: v.shape, derived: v.derived, ...tally() });
      for (const n of ['hits', 'inside', 'nonHit', 'nonHitInside']) o[n] += v[n];
    }
  for (const v of Object.values(out)) {
    v.tpr = v.hits ? v.inside / v.hits : null;
    v.fpr = v.nonHit ? v.nonHitInside / v.nonHit : null;
    v.youden = v.tpr != null && v.fpr != null ? v.tpr - v.fpr : null;
  }
  return out;
}

/** Status de uma forma medida: REVISAR (lugar ou tamanho errado), ATENÇÃO, OK, ou null (pouco dado). */
export const FIT_MIN_HITS = 20;
export function fitStatus(v) {
  if (v.hits < FIT_MIN_HITS) return null;
  if (!v.derived && v.tpr < 0.6) return 'REVISAR';
  if (v.fpr != null && v.nonHit >= FIT_MIN_HITS && v.fpr > 0.5) return 'REVISAR';
  if (!v.derived && v.tpr < 0.8) return 'ATENÇÃO';
  return 'OK';
}
