// Câmera dos clipes automáticos: a origem da falha e os envolvidos, sem abrir para a arena toda.
import { posAt, type ReplayBounds, type ReplayData, type ReplayUnit } from './replay';
import type { ClipMoment } from './replayClip';
import type { FightData } from '../types';

type Point = [number, number];
const EVENT_MS = 2_000;
const PAD_YD = 6;
const MIN_SPAN_YD = 28;

const near = (t: number, m: ClipMoment) => Math.min(Math.abs(t - m.t), Math.abs(t - m.replay.t)) <= EVENT_MS;
const at = (u: ReplayUnit, t: number): Point[] => {
  const p = posAt(u, t);
  return p ? [p] : [];
};

/** Uma câmera por momento; não muda de tamanho enquanto o clipe toca. Sem posições, usa o mapa normal. */
export function clipBounds(data: ReplayData, m: ClipMoment, span: [number, number], fight?: FightData): ReplayBounds | undefined {
  const units = [...data.units.values()];
  const focus = m.replay.focus.map(g => data.units.get(g)).filter((u): u is ReplayUnit => !!u);
  let points: Point[] = [];
  const path = (u: ReplayUnit, from = span[0], to = span[1]): Point[] => [
    ...at(u, from), ...u.pts.filter(([t]) => t >= from && t <= to).map(([, x, y]): Point => [x, y]), ...at(u, to),
  ];

  // Fantasmas que se encostaram: a colisão é entre eles; seus donos podem estar longe.
  const hitOwners = new Set(fight?.events
    .filter(([t, kind, , spell]) => kind === 0 && m.mechanicKey != null && fight.ruleSpells[spell] === m.mechanicKey && Math.min(Math.abs(t - m.t), Math.abs(t - m.replay.t)) <= 250)
    .map(([, , player]) => fight.players[player]));
  const ghosts = units.filter(u => u.kind === 'ghost' && (hitOwners.size ? u.owner != null && hitOwners.has(u.owner) : near(u.pts.at(-1)?.[0] ?? -Infinity, m)));
  const pairs = ghosts.flatMap((a, i) => ghosts.slice(i + 1).flatMap(b => {
    const pa = posAt(a, m.replay.t), pb = posAt(b, m.replay.t);
    if (!pa || !pb) return [];
    const distance = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    return distance <= 4 && (!focus.length || focus.some(u => u.guid === a.owner || u.guid === b.owner)) ? [{ a, b, distance }] : [];
  })).sort((a, b) => a.distance - b.distance);
  if (pairs[0]) points = [pairs[0].a, pairs[0].b].flatMap(u => path(u, Math.max(span[0], m.replay.t - 3_000), m.replay.t));

  // Uma falha individual acompanha a aproximação do player, sem puxar bosses ou players distantes.
  if (!points.length && focus.length) points = focus.flatMap(u => path(u));

  // Falhas coletivas: o centro do soak/explosão ou os orbs que detonaram, em vez das vítimas da raid inteira.
  if (!points.length && m.mechanicKey) {
    const hazards = [...data.soaks, ...(data.blasts ?? [])].filter(h => h.key === m.mechanicKey && near(h.at, m));
    for (const h of hazards) {
      const radius = Math.min(12, h.radius);
      points.push([h.x - radius, h.y - radius], [h.x + radius, h.y + radius]);
    }
  }
  if (!points.length && m.mechanicKey && data.orbs) {
    points = data.orbs.ground.filter(([, to, , , kind]) => near(to, m) && data.orbs!.kinds[kind]?.volatile)
      .map(([, , x, y]): Point => [x / 10, y / 10]);
  }
  if (!points.length) {
    points = data.ground.filter(g => near(g.t, m) && (data.groundKinds[g.kind]?.key === m.mechanicKey || (m.spellId != null && data.groundKinds[g.kind]?.spellId === m.spellId)))
      .map(g => [g.x, g.y]);
  }
  // Sem origem registrada, enquadra as posições no instante do erro, não todos os caminhos da janela.
  if (!points.length) points = units.filter(u => u.kind === 'player').flatMap(u => at(u, m.t));
  points = points.filter(p => p.every(Number.isFinite));
  if (!points.length) return undefined;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = Math.max(MIN_SPAN_YD / 2, (x1 - x0) / 2 + PAD_YD);
  const ry = Math.max(MIN_SPAN_YD / 2, (y1 - y0) / 2 + PAD_YD);
  return [cx - rx, cx + rx, cy - ry, cy + ry];
}
