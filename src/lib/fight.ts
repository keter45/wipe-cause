// Replay completo de um pull: as contas do quadro do raid, da linha do tempo e do painel do player
// focado, em cima de `Pull.fight` (vida, debuffs e eventos de cada player).

import type { FightData, MechanicResult, Pull } from '../types';
import { npcOf, posAt, type ReplayData } from './replay';

/** Tipos de evento de `FightData.events` (segundo campo). */
export const EV = { damage: 0, heal: 1, cast: 2, interrupt: 3, dispel: 4, resurrect: 5 } as const;
export type FightEventKind = (typeof EV)[keyof typeof EV];
/** Sem fonte/alvo no evento. */
const NO_UNIT = 65535;

/** Aura ativa num player. */
export interface ActiveAura {
  spellId: number;
  name: string;
  from: number;
  to: number;
  /** stacks no momento consultado */
  stacks: number;
  /** debuff de inimigo (false = defensivo) */
  debuff: boolean;
  /** mecânica da regra do boss a que o debuff pertence (debuff crucial) */
  mechanic?: MechanicResult;
}

/** Evento de um player, pronto para a lista. */
export interface FightEventView {
  t: number;
  kind: FightEventKind;
  spellId: number;
  name: string;
  amount: number;
  /** fonte (dano, cura, ressurreição) ou alvo (cast, dispel) */
  other: string | null;
  /** spell cortado (interrupt) ou aura tirada (dispel) */
  extra?: { spellId: number; name: string };
  mechanic?: MechanicResult;
}

/** Ponto de interesse na linha do tempo. */
export interface FightMarker {
  t: number;
  kind: 'death' | 'failure' | 'cast';
  /** player envolvido (morte, falha de alguém) */
  guid?: string;
  label: string;
  spellId: number | null;
  severity?: MechanicResult['severity'];
  mechanicKey?: string;
}

export interface FightView {
  data: FightData;
  /** guid -> índice em `data.players` */
  index: Map<string, number>;
  /** mortes e ressurreições de cada player, em ordem: [t, morto] */
  lives: Map<string, [number, boolean][]>;
  mechanics: Map<string, MechanicResult>;
  markers: FightMarker[];
  /** auras e eventos de cada player (consultados a cada quadro do replay) */
  aurasBy: FightData['auras'][];
  eventsBy: FightData['events'][];
  /** "player:spell" -> mudanças de stack [t, stacks] */
  stacksBy: Map<string, [number, number][]>;
}

export function fightView(pull: Pull): FightView | null {
  const data = pull.fight;
  if (!data) return null;
  const index = new Map(data.players.map((g, i) => [g, i] as const));
  const lives = new Map<string, [number, boolean][]>();
  const push = (guid: string, t: number, dead: boolean) => {
    const l = lives.get(guid) ?? [];
    l.push([t, dead]);
    lives.set(guid, l);
  };
  for (const d of pull.deaths) push(d.guid, d.t, true);
  for (const e of data.events) if (e[1] === EV.resurrect) push(data.players[e[2]], e[0], false);
  for (const l of lives.values()) l.sort((a, b) => a[0] - b[0]);
  const mechanics = new Map(pull.mechanics.map((m) => [m.key, m] as const));
  const aurasBy: FightData['auras'][] = data.players.map(() => []);
  for (const a of data.auras) aurasBy[a[0]]?.push(a);
  const eventsBy: FightData['events'][] = data.players.map(() => []);
  for (const e of data.events) eventsBy[e[2]]?.push(e);
  const stacksBy = new Map<string, [number, number][]>();
  for (const [p, spell, t, n] of data.stacks ?? []) {
    const k = `${p}:${spell}`;
    const l = stacksBy.get(k) ?? [];
    l.push([t, n]);
    stacksBy.set(k, l);
  }
  return { data, index, lives, mechanics, markers: fightMarkers(pull), aurasBy, eventsBy, stacksBy };
}

/** Valor da série [t, v] em `t` (o último até ali), ou null antes do primeiro. Busca binária: séries longas. */
export function seriesAt(pts: [number, number][] | undefined, t: number): number | null {
  if (!pts || pts.length === 0 || t < pts[0][0]) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return pts[lo][1];
}

export const hpAt = (v: FightView, guid: string, t: number) => {
  const i = v.index.get(guid);
  return i == null ? null : seriesAt(v.data.hp[i], t);
};

/** O player está morto em `t` (morreu e ainda não foi ressuscitado)? */
export function deadAt(v: FightView, guid: string, t: number): boolean {
  let dead = false;
  for (const [lt, d] of v.lives.get(guid) ?? []) {
    if (lt > t) break;
    dead = d;
  }
  return dead;
}

/** Stacks da aura `a` em `t`: a última mudança desde que ela entrou (replay antigo, sem as mudanças: o maior número). */
function stacksAt(v: FightView, a: FightData['auras'][number], t: number): number {
  if (!v.data.stacks) return a[4];
  const pts = v.stacksBy.get(`${a[0]}:${a[1]}`);
  if (!pts || pts[0][0] > t) return 1;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  // a mudança tem que ser desta aura (depois que ela entrou), não de uma anterior do mesmo spell
  return pts[lo][0] >= a[2] ? pts[lo][1] : 1;
}

const auraView = (v: FightView, a: FightData['auras'][number], t: number): ActiveAura => {
  const key = v.data.ruleSpells[a[1]];
  return {
    spellId: a[1],
    name: v.data.spells[a[1]] ?? String(a[1]),
    from: a[2],
    to: a[3],
    stacks: stacksAt(v, a, t),
    debuff: a[5] === 1,
    mechanic: a[5] === 1 && key ? v.mechanics.get(key) : undefined,
  };
};

/** Auras ativas no player em `t`: debuffs cruciais (da regra) primeiro, depois os outros e os defensivos. */
export function aurasAt(v: FightView, guid: string, t: number): ActiveAura[] {
  const i = v.index.get(guid);
  if (i == null) return [];
  const out = v.aurasBy[i].filter((a) => a[2] <= t && a[3] > t).map((a) => auraView(v, a, t));
  const rank = (a: ActiveAura) => (a.mechanic ? 0 : a.debuff ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.from - a.from);
}

/** Debuff crucial (da regra do boss) no player em `t`, para o ícone no mapa e no quadro do raid. `allow`: só estes spells. */
export function crucialAt(v: FightView, guid: string, t: number, allow?: (spellId: number) => boolean): ActiveAura | null {
  const i = v.index.get(guid);
  if (i == null) return null;
  for (const a of v.aurasBy[i]) {
    if (a[2] > t) break;
    if (a[3] > t && a[5] === 1 && v.data.ruleSpells[a[1]] && (!allow || allow(a[1]))) return auraView(v, a, t);
  }
  return null;
}

/** Players com a aura `spellId` ativa em `t` (centros das áreas em volta de quem carrega algo). */
export function auraHolders(v: FightView, spellId: number, t: number): string[] {
  return auraSpans(v, spellId, t).map((h) => h.guid);
}

/** Players com a aura `spellId` ativa em `t`, com quando ela entrou e quando sai (a contagem no mapa). */
export function auraSpans(v: FightView, spellId: number, t: number): { guid: string; from: number; to: number }[] {
  const out: { guid: string; from: number; to: number }[] = [];
  for (const a of v.data.auras) {
    if (a[2] > t) break;
    if (a[1] === spellId && a[3] > t) out.push({ guid: v.data.players[a[0]], from: a[2], to: a[3] });
  }
  return out;
}

/** Debuffs cruciais que aparecem no pull (para escolher quais mostrar na cabeça), na ordem em que aparecem. */
export function crucialSpells(v: FightView): { spellId: number; name: string; mechanic?: MechanicResult }[] {
  const seen = new Map<number, { spellId: number; name: string; mechanic?: MechanicResult }>();
  for (const a of v.data.auras) {
    const key = v.data.ruleSpells[a[1]];
    if (a[5] !== 1 || !key || seen.has(a[1])) continue;
    seen.set(a[1], { spellId: a[1], name: v.data.spells[a[1]] ?? String(a[1]), mechanic: v.mechanics.get(key) });
  }
  return [...seen.values()];
}

/** Eventos do player entre `from` e `to`, do mais recente para o mais antigo. */
export function eventsBetween(v: FightView, guid: string, from: number, to: number): FightEventView[] {
  const i = v.index.get(guid);
  if (i == null) return [];
  const { data } = v;
  const list = v.eventsBy[i];
  // primeiro evento em `from` ou depois (lista em ordem de tempo)
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] < from) lo = mid + 1;
    else hi = mid;
  }
  const out: FightEventView[] = [];
  for (let k = lo; k < list.length; k++) {
    const e = list[k];
    if (e[0] > to) break;
    const kind = e[1] as FightEventKind;
    const key = data.ruleSpells[e[3]];
    const extraId = kind === EV.interrupt || kind === EV.dispel ? e[4] : 0;
    out.push({
      t: e[0],
      kind,
      spellId: e[3],
      name: data.spells[e[3]] ?? String(e[3]),
      amount: extraId ? 0 : e[4],
      other: e[5] === NO_UNIT ? null : (data.sources[e[5]] ?? null),
      extra: extraId ? { spellId: extraId, name: data.spells[extraId] ?? String(extraId) } : undefined,
      mechanic: kind === EV.damage && key ? v.mechanics.get(key) : undefined,
    });
  }
  return out.reverse();
}

/**
 * Pontos de interesse do pull: mortes, falhas de mecânica (as graves de todo mundo; as menores
 * aparecem só para o player focado, pela chave) e frontais do boss.
 */
export function fightMarkers(pull: Pull): FightMarker[] {
  const byName = new Map(pull.players.map((p) => [p.name, p.guid] as const));
  const out: FightMarker[] = [];
  for (const d of pull.deaths) {
    out.push({ t: d.t, kind: 'death', guid: d.guid, label: d.killingBlowMechanic ?? d.killingBlow?.spellName ?? '', spellId: d.killingBlow?.spellId ?? null });
  }
  for (const m of pull.mechanics) {
    if (m.failures === 0 || m.kind === 'phase_duration') continue;
    for (const e of m.events) {
      // falha coletiva sem culpado: o evento "(falha)"; com culpado: um por player
      const guid = e.player ? byName.get(e.player) : undefined;
      if (e.player && !guid) continue;
      out.push({ t: e.t, kind: 'failure', guid, label: m.name, spellId: m.spellId, severity: m.severity, mechanicKey: m.key });
    }
  }
  for (const c of pull.casts ?? []) {
    if (c.cone && !c.interrupted) out.push({ t: c.end ?? c.t, kind: 'cast', label: c.name, spellId: c.spellId });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Marca de uma faixa de mecânica: deu errado (cheia) ou aconteceu e tudo bem (vazada). */
export interface LaneMark {
  t: number;
  ok: boolean;
  guid?: string;
  /** quem errou ou o detalhe (ex.: "3/5") */
  label?: string;
}

/** Uma faixa da linha do tempo por mecânica do boss, com o que aconteceu nela. */
export interface MechanicLane {
  key: string;
  name: string;
  spellId: number | null;
  severity: MechanicResult['severity'];
  failures: number;
  marks: LaneMark[];
  /** quantos estavam no chão ao longo do pull (orbs): [t, n] a cada mudança */
  series?: [number, number][];
}

/** Falha da regra até isto (ms) do soak é dele. */
const SOAK_FAIL_MS = 3_000;
/** Ordem das faixas: as que mais pesam em cima. */
const SEVERITY_RANK: Record<string, number> = { wipe: 0, major: 1, minor: 2, none: 3 };

/**
 * Faixas da linha do tempo por mecânica: cada vez que a mecânica aconteceu (soak, frontal, cast para
 * cortar) vazada ou cheia, as falhas cheias, e os orbs no chão como um gráfico. Só as mecânicas que
 * aparecem no pull.
 */
export function mechanicLanes(pull: Pull): MechanicLane[] {
  const byName = new Map(pull.players.map((p) => [p.name, p.guid] as const));
  const lanes: MechanicLane[] = [];
  for (const m of pull.mechanics) {
    if (m.kind === 'phase_duration' || m.kind === 'hp_balance') continue;
    const marks: LaneMark[] = [];
    // o que aconteceu, deu certo ou não: soaks, casts para cortar, frontais
    // soak: errado quando a regra deu falha nele (quem soakou imune não conta nos atingidos, então o
    // número sozinho não basta)
    for (const k of (pull.soaks ?? []).filter((k) => k.key === m.key)) {
      const failed = m.failures > 0 && m.events.some((e) => Math.abs(e.t - k.at) <= SOAK_FAIL_MS);
      marks.push({ t: k.at, ok: !failed, label: k.needs != null ? `${k.hit}/${k.needs}` : String(k.hit) });
    }
    for (const c of m.casts ?? []) marks.push({ t: c.t, ok: c.interruptedBy != null, guid: c.interruptedByGuid ?? undefined, label: c.interruptedBy ?? undefined });
    if (m.spellId != null) for (const c of pull.casts ?? []) if (c.cone && c.spellId === m.spellId && !c.interrupted) marks.push({ t: c.end ?? c.t, ok: true });
    // as falhas de cada um (as que já não vieram de um soak ou cast acima); dentro da tolerância não conta
    if (m.failures > 0 && !m.casts && !(pull.soaks ?? []).some((k) => k.key === m.key)) {
      for (const e of m.events) {
        const guid = e.player ? byName.get(e.player) : undefined;
        if (e.player && !guid) continue;
        marks.push({ t: e.t, ok: false, guid, label: e.player ?? undefined });
      }
    }
    if (!marks.length) continue;
    marks.sort((a, b) => a.t - b.t);
    lanes.push({ key: m.key, name: m.name, spellId: m.spellId, severity: m.severity, failures: marks.filter((k) => !k.ok).length, marks });
  }
  lanes.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.failures - a.failures);
  // orbs no chão: a contagem ao longo do pull, em cima de tudo
  const orbs = pull.orbs;
  if (orbs?.ground.length) {
    const deltas: [number, number][] = orbs.ground.flatMap(([from, to]) => [[from, 1], [to, -1]] as [number, number][]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const series: [number, number][] = [];
    let n = 0;
    for (const [t, d] of deltas) {
      n += d;
      if (series.length && series[series.length - 1][0] === t) series[series.length - 1][1] = n;
      else series.push([t, n]);
    }
    lanes.unshift({ key: 'orbs', name: '', spellId: null, severity: 'none', failures: 0, marks: [], series });
  }
  return lanes;
}

/** Medidores do replay (como os do Warcraft Logs), acumulados do começo do pull até o instante. */
export type MeterKind = 'done' | 'taken' | 'takenBy' | 'healed' | 'healIn';
export const METERS: MeterKind[] = ['done', 'taken', 'takenBy', 'healed', 'healIn'];

export interface MeterRow {
  /** guid do player, ou id do spell em "dano tomado por habilidade" */
  key: string;
  name: string;
  spellId?: number;
  amount: number;
}

/**
 * Linhas de um medidor em `t`, da maior para a menor. Somas por segundo entram até o segundo do
 * instante; eventos (dano tomado) até o próprio instante. `target`: só o dano feito num inimigo.
 */
export function meterAt(v: FightView, kind: MeterKind, t: number, target?: string): MeterRow[] {
  const { data } = v;
  const sum = new Map<string, number>();
  const add = (k: string, n: number) => sum.set(k, (sum.get(k) ?? 0) + n);
  const sec = t / 1000;
  if (kind === 'done') {
    const ti = target == null ? -1 : data.sources.indexOf(target);
    if (target != null && ti < 0) return [];
    for (const [s, p, tg, n] of data.done ?? []) {
      if (s > sec) break;
      if (ti < 0 || tg === ti) add(data.players[p], n);
    }
  } else if (kind === 'healed' || kind === 'healIn') {
    for (const [s, p, n] of (kind === 'healed' ? data.healed : data.healIn) ?? []) {
      if (s > sec) break;
      add(data.players[p], n);
    }
  } else {
    for (const e of data.events) {
      if (e[0] > t) break;
      if (e[1] !== EV.damage) continue;
      add(kind === 'taken' ? data.players[e[2]] : String(e[3]), e[4]);
    }
  }
  return [...sum.entries()]
    .map(([key, amount]) => (kind === 'takenBy' ? { key, name: data.spells[key] ?? key, spellId: Number(key), amount } : { key, name: key, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Vida de um boss (%) em `t`, ou null antes da primeira amostra. */
export function bossHpAt(boss: FightData['bosses'][number], t: number): number | null {
  const v = seriesAt(boss.hp, t);
  return v == null ? null : v / 10;
}

/** Passo da checagem das áreas e quanto vale a posição logo depois de o log mostrar a unidade. */
const VACANT_STEP_MS = 250;
const SEEN_FRESH_MS = 1000;
/** "Passou por dentro": até esta fração do raio (a borda fica de fora). */
const VACANT_INSIDE = 0.75;
/** Janela em volta do instante em que um golpe da área ainda conta como "levou dano ali". */
const HIT_BEFORE_MS = 750;
const HIT_AFTER_MS = 1000;

/** Algum valor da lista (em ordem) entre `from` e `to`? */
function anyBetween(ts: number[], from: number, to: number): boolean {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  return lo < ts.length && ts[lo] <= to;
}

/**
 * Unidades das áreas (ex.: os machados) com a posição desmentida. O log só mostra onde o machado está
 * de vez em quando; entre uma vez e outra o replay estima. Se alguém vivo passa por dentro do raio sem
 * levar o dano da área, o machado já não estava ali: desse instante até o log mostrá-lo de novo, ele
 * aparece apagado (era onde ele estava). Devolve guid -> trechos [de, até].
 */
export function vacatedAreas(v: FightView, data: ReplayData): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  const players = [...data.units.values()].filter((u) => u.kind === 'player');
  for (const a of data.areas) {
    if (a.npc == null) continue;
    const spells = new Set(
      Object.entries(v.data.ruleSpells)
        .filter(([, k]) => k === a.key)
        .map(([id]) => Number(id)),
    );
    // quando cada player levou o dano da área
    const hits = new Map<string, number[]>();
    for (const [g, i] of v.index) hits.set(g, (v.eventsBy[i] ?? []).filter((e) => e[1] === EV.damage && spells.has(e[3])).map((e) => e[0]));
    const inside = a.radius * VACANT_INSIDE;
    for (const u of data.units.values()) {
      if (u.kind !== 'enemy' || npcOf(u.guid) !== a.npc || !u.seen?.length || u.pts.length === 0) continue;
      const seen = u.seen;
      const end = u.pts[u.pts.length - 1][0];
      const spans: [number, number][] = [];
      let next = 0; // próximo momento em que o log mostra a unidade
      let gone: number | null = null;
      for (let t = u.pts[0][0]; t <= end; t += VACANT_STEP_MS) {
        while (next < seen.length && seen[next] <= t) {
          // o log mostrou a unidade: a posição volta a valer
          if (gone != null) spans.push([gone, seen[next]]);
          gone = null;
          next++;
        }
        if (gone != null || (next > 0 && t - seen[next - 1] < SEEN_FRESH_MS)) continue;
        const q = posAt(u, t);
        if (!q) continue;
        for (const p of players) {
          const pp = posAt(p, t);
          if (!pp || Math.hypot(pp[0] - q[0], pp[1] - q[1]) > inside || deadAt(v, p.guid, t)) continue;
          if (!anyBetween(hits.get(p.guid) ?? [], t - HIT_BEFORE_MS, t + HIT_AFTER_MS)) {
            gone = t;
            break;
          }
        }
      }
      if (gone != null) spans.push([gone, end + VACANT_STEP_MS]);
      if (spans.length) out.set(u.guid, spans);
    }
  }
  return out;
}

/** Golpe "perto" da unidade: até o raio mais isto (posições do log). */
const NEAR_HIT_SLACK_YD = 2;

/**
 * Unidades das áreas que já sumiram (regra com `vanish`, ex.: os machados na P2): a partir de
 * `vanishFrom`, a unidade some depois de `vanishIdleMs` sem acertar ninguém perto dela (o DoT que
 * segue o player, longe dela, não conta) e volta se acertar de novo. Devolve guid -> trechos [de, até].
 */
export function vanishedAreas(v: FightView, data: ReplayData): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  for (const a of data.areas) {
    if (a.npc == null || a.vanishIdleMs == null) continue;
    const idle = a.vanishIdleMs;
    const from = a.vanishFrom ?? 0;
    const spells = new Set(
      Object.entries(v.data.ruleSpells)
        .filter(([, k]) => k === a.key)
        .map(([id]) => Number(id)),
    );
    // golpes da área: [t, player]
    const hits: [number, string][] = [];
    for (const [g, i] of v.index) for (const e of v.eventsBy[i] ?? []) if (e[1] === EV.damage && spells.has(e[3])) hits.push([e[0], g]);
    hits.sort((x, y) => x[0] - y[0]);
    for (const u of data.units.values()) {
      if (u.kind !== 'enemy' || npcOf(u.guid) !== a.npc || u.pts.length === 0) continue;
      // golpes em alguém perto da unidade
      const near = hits
        .filter(([t, g]) => {
          const q = posAt(u, t);
          const p = data.units.get(g);
          const pp = p && posAt(p, t);
          return q && pp && Math.hypot(pp[0] - q[0], pp[1] - q[1]) <= a.radius + NEAR_HIT_SLACK_YD;
        })
        .map(([t]) => t);
      const end = u.pts[u.pts.length - 1][0] + VACANT_STEP_MS;
      // idle 0: some de vez quando a fase começa (os machados na P2: só o DoT, nada no chão)
      if (idle <= 0) {
        if (from < end) out.set(u.guid, [[Math.max(from, u.pts[0][0]), end]]);
        continue;
      }
      const spans: [number, number][] = [];
      let last = u.pts[0][0];
      for (const t of [...near, end]) {
        // some `idle` depois do último golpe (nunca antes de `from`) e volta no próximo
        const goneAt = Math.max(from, last + idle);
        if (goneAt < t) spans.push([goneAt, t]);
        last = Math.max(last, t);
      }
      if (spans.length) out.set(u.guid, spans);
    }
  }
  return out;
}

export function idleAxegrinders(v: FightView, data: ReplayData): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  for (const area of data.areas) {
    if (area.npc !== 260474) continue;
    const spells = new Set(Object.entries(v.data.ruleSpells).filter(([, key]) => key === area.key).map(([id]) => Number(id)));
    const hits = v.data.events.filter((event) => event[1] === EV.damage && spells.has(event[3]));
    for (const unit of data.units.values()) {
      if (unit.kind !== 'enemy' || npcOf(unit.guid) !== area.npc || !unit.pts.length) continue;
      const start = unit.pts[0][0];
      const end = Math.min(unit.pts[unit.pts.length - 1][0] + VACANT_STEP_MS, area.vanishFrom ?? Infinity);
      const contacts = hits.filter((event) => {
        if (event[0] < start || event[0] >= end) return false;
        const origin = posAt(unit, event[0]);
        const player = data.units.get(v.data.players[event[2]]);
        const point = player && posAt(player, event[0]);
        return origin && point && Math.hypot(point[0] - origin[0], point[1] - origin[1]) <= area.radius + NEAR_HIT_SLACK_YD;
      }).map((event) => event[0]).sort((left, right) => left - right);
      const spans: [number, number][] = [];
      let last = start;
      for (const contact of [...contacts, end]) {
        const fadedAt = last + 5000;
        if (fadedAt < contact) spans.push([fadedAt, contact]);
        last = contact;
      }
      if (spans.length) out.set(unit.guid, spans);
    }
  }
  return out;
}

/** Desde quando a unidade está apagada em `t` (ver `vacatedAreas`), ou null. */
export function vacatedSince(spans: [number, number][] | undefined, t: number): number | null {
  for (const [a, b] of spans ?? []) if (t >= a && t < b) return a;
  return null;
}
