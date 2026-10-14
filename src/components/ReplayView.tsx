import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Crosshair, Maximize2, Minimize2, Pause, Play, RotateCcw } from 'lucide-react';
import type { ReplayRef } from '../types';
import { classColor, num, shortName } from '../lib/format';
import { movedUntil, posAt, valueAt, type ReplayData, type ReplayHit, type ReplayUnit } from '../lib/replay';
import { useMessages } from '../i18n';
import { replayMsg, type ReplayMoment } from './ReplayView.i18n';
import { SpellIcon, SpellName, SvgSpellIcon } from './SpellIcon';
import { Hint } from './ui/Hint';

export type { ReplayHit } from '../lib/replay';

type Classes = Map<string, string | null>;

interface Props {
  data: ReplayData;
  replay: ReplayRef;
  classes: Classes;
  /** o que acontece no momento (texto do relógio) */
  moment: ReplayMoment;
  /** true: começa do início tocando (aberto por um botão); false: parado no momento */
  autoplay?: boolean;
  /** vida do primeiro acompanhado ao longo do replay: [t, %] */
  hp?: [number, number][];
  /** quem morre no momento (vira um ✕) */
  dies?: string;
  /** golpes tomados pelo primeiro acompanhado (morte) */
  hits?: ReplayHit[];
}

/** Mapa (viewBox): mais largo que alto, para ocupar a largura sem ficar alto demais. */
const W = 720;
const H = 440;
const PAD = 14;
/** Menor área mostrada (jardas), para quem ficou parado não virar um ponto só. */
const MIN_SPAN = 40;
/** Boss entra na área se estiver até isto (jardas) de quem o replay acompanha. */
const ENEMY_NEAR_YD = 30;
/** Abaixo disso (jardas) o par já está encostado: sem a linha da distância. */
const SHOW_GAP_YD = 3;
/** Quanto tempo o anel de um acerto fica na tela (ms). */
const MARK_MS = 700;
const SPEEDS = [0.5, 1, 2] as const;
/** Barra de vida de quem o replay acompanha (px). */
const HPBAR_W = 44;
const HPBAR_H = 5;
/** Passo da animação (ms). */
const FRAME_MS = 33;
/** Trecho do caminho desenhado atrás de quem o replay acompanha (ms). */
const TRAIL_MS = 15_000;
/** Raio da marca de um acerto no chão (jardas): o log não diz o tamanho da poça/gota. */
const GROUND_YD = 1.2;
/** ... e no máximo isto na tela (px), para o zoom não virar borrão. */
const GROUND_MAX_PX = 7;
/** Grade do chão (jardas) e régua de escala. */
const GRID_YD = 10;
/** Folga em volta da arena (jardas). */
const ARENA_PAD_YD = 6;
/** Vista aberta: deixa de fora esta parte das posições em cada ponta (quem ficou longe de todo mundo). */
const WIDE_TRIM = 0.05;
/** Nome do boss: este tanto abaixo do losango (px). */
const BOSS_LABEL_DY = 22;
/** Trecho recente do caminho, desenhado mais forte (ms). */
const TRAIL_RECENT_MS = 3_000;
/** Golpe recém-tomado aparece no mapa por isto (ms). */
const HIT_SHOW_MS = 900;
/** Cast instantâneo (ou o fim de um com tempo) fica na tela por isto (ms). */
const CAST_SHOW_MS = 1_200;
/** Cast com tempo que não terminou no log: mostra por isto (ms). */
const CAST_OPEN_MS = 2_000;
/** Seta da direção do boss no fim do cast (jardas, no máximo em px). */
const FACING_YD = 12;
const FACING_MAX_PX = 70;
/** Últimos casts listados embaixo do mapa. */
const CASTS_MAX = 3;
/** Lista de golpes: os últimos N até o instante. */
const FEED_MAX = 5;
/** Fantasma: contorno (px, centrado no ponto) e quanto ele precisa andar num quarto de segundo para contar como andando (jardas). */
const GHOST_PATH = 'M -6 7 L -6 -1 A 6 6 0 0 1 6 -1 L 6 7 L 4 5 L 2 7 L 0 5 L -2 7 L -4 5 Z';
const GHOST_MOVING_YD = 0.3;
/** Fantasma a até isto (jardas) do fantasma de quem o replay acompanha, no momento, também fica em destaque. */
const GHOST_TOUCH_YD = 4;
/** Cores das mecânicas no chão (vermelho fica para bosses e acertos). */
const GROUND_COLORS = ['#e8904a', '#6ea8fe', '#4cc38a', '#d9c05a', '#c084fc', '#f472b6', '#2dd4bf'];

/** Triângulo do frontal na tela: do boss (bx, by) na direção `a` (radianos do mundo, y para cima), meio ângulo `h`, com a base a `len` px. */
function triangle(bx: number, by: number, a: number, h: number, len: number): string {
  const side = len / Math.cos(h);
  const pt = (ang: number) => `${(bx + Math.cos(ang) * side).toFixed(1)},${(by - Math.sin(ang) * side).toFixed(1)}`;
  return `${bx.toFixed(1)},${by.toFixed(1)} ${pt(a - h)} ${pt(a + h)}`;
}

/** Câmera do usuário por cima do enquadramento automático: deslocamento (jardas) e zoom. */
const NO_CAM = { x: 0, y: 0, zoom: 1 };
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 10;
/** Quanto a roda do mouse aproxima por unidade de deltaY. */
const WHEEL_ZOOM = 0.0015;

const inWindow = (u: ReplayUnit, r: ReplayRef) => u.pts.filter(([t]) => t >= r.from && t <= r.to);

/** Replay das posições em volta de um momento (morte, acerto, falha, encontro). */
export function ReplayView({ data, replay: r, classes, moment, autoplay = true, hp, dies, hits }: Props) {
  const t = useMessages(replayMsg);
  const [now, setNow] = useState(autoplay ? r.from : r.t);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState<number>(1);
  const [others, setOthers] = useState(true);
  // enquadramento: a arena inteira (morte, falha coletiva) ou perto de quem o replay acompanha
  const [wide, setWide] = useState(moment === 'death' || moment === 'failure');
  const floorId = useId().replace(/:/g, '');
  // arrastar move o mapa, a roda dá zoom; duplo clique (ou trocar o enquadramento) volta
  const [cam, setCam] = useState(NO_CAM);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const ts = performance.now();
      const next = Math.min(r.to, nowRef.current + (ts - last) * speed);
      last = ts;
      nowRef.current = next;
      setNow(next);
      if (next >= r.to) setPlaying(false);
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [playing, speed, r.to]);

  const view = useMemo(() => {
    const units = [...data.units.values()];
    const players = units.filter((u) => u.kind === 'player' && inWindow(u, r).length > 0);
    const focus = r.focus.map((g) => data.units.get(g)).filter((u): u is ReplayUnit => !!u && inWindow(u, r).length > 0);
    const enemies = units.filter((u) => u.kind === 'enemy' && inWindow(u, r).length > 0);
    // fantasmas (caminho simulado) que aparecem no replay, os que mais andaram primeiro
    const ghosts = units.filter((u) => u.kind === 'ghost' && inWindow(u, r).length > 0).sort((a, b) => movedUntil(b, r.to) - movedUntil(a, r.to));
    // área: o caminho de quem o replay acompanha (ou de todo mundo, numa falha coletiva) e os bosses perto
    const core = focus.length ? focus : players;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const u of core) {
      for (const [, x, y] of inWindow(u, r)) {
        xs.push(x);
        ys.push(y);
      }
    }
    // em destaque: os fantasmas de quem o replay acompanha e os que encostaram neles no momento
    const mine = ghosts.filter((g) => g.owner && focus.some((u) => u.guid === g.owner));
    const keyGhosts = new Set(mine.map((g) => g.guid));
    for (const g of ghosts) {
      const p = posAt(g, r.t);
      const touching = (m: ReplayUnit) => {
        const q = posAt(m, r.t);
        return !!p && !!q && Math.hypot(p[0] - q[0], p[1] - q[1]) <= GHOST_TOUCH_YD;
      };
      if (mine.some(touching)) keyGhosts.add(g.guid);
    }
    // e entram na área
    for (const g of ghosts.filter((g) => keyGhosts.has(g.guid))) {
      for (const [, x, y] of inWindow(g, r)) {
        xs.push(x);
        ys.push(y);
      }
    }
    if (xs.length === 0) return null;
    const box = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const e of enemies) {
      const p = posAt(e, r.t);
      if (!p) continue;
      const dx = Math.max(box[0] - p[0], 0, p[0] - box[1]);
      const dy = Math.max(box[2] - p[1], 0, p[1] - box[3]);
      if (Math.hypot(dx, dy) <= ENEMY_NEAR_YD) {
        xs.push(p[0]);
        ys.push(p[1]);
      }
    }
    const arena = data.arena;
    const useArena = wide && !!arena && arena.cells.length > 0;
    let cx: number, cy: number, reachX: number, reachY: number;
    if (useArena) {
      // vista aberta: onde a raid (e os bosses e fantasmas) esteve durante o replay, não a sala toda do pull
      // (sem os poucos que ficaram longe de todo mundo; quem o replay acompanha, os bosses e os fantasmas em destaque sempre entram)
      const rx: number[] = [];
      const ry: number[] = [];
      for (const u of players) {
        for (const [, x, y] of inWindow(u, r)) {
          rx.push(x);
          ry.push(y);
        }
      }
      const cut = (v: number[]) => {
        const s = [...v].sort((a, b) => a - b);
        return [s[Math.floor((s.length - 1) * WIDE_TRIM)], s[Math.ceil((s.length - 1) * (1 - WIDE_TRIM))]];
      };
      const [px0, px1] = cut(rx);
      const [py0, py1] = cut(ry);
      const ax = [px0, px1];
      const ay = [py0, py1];
      for (const u of [...focus, ...ghosts.filter((g) => keyGhosts.has(g.guid))]) {
        for (const [, x, y] of inWindow(u, r)) {
          ax.push(x);
          ay.push(y);
        }
      }
      for (const e of enemies) {
        const p = posAt(e, r.t);
        if (p) {
          ax.push(p[0]);
          ay.push(p[1]);
        }
      }
      const [x0, x1, y0, y1] = [Math.min(...ax), Math.max(...ax), Math.min(...ay), Math.max(...ay)];
      cx = (x0 + x1) / 2;
      cy = (y0 + y1) / 2;
      reachX = Math.max(MIN_SPAN / 2, (x1 - x0) / 2 + ARENA_PAD_YD);
      reachY = Math.max(MIN_SPAN / 2, (y1 - y0) / 2 + ARENA_PAD_YD);
    } else {
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      reachX = Math.max(MIN_SPAN / 2, (Math.max(...xs) - Math.min(...xs)) / 2) * 1.1;
      reachY = Math.max(MIN_SPAN / 2, (Math.max(...ys) - Math.min(...ys)) / 2) * 1.1;
    }
    // a mesma escala nos dois eixos: o lado que mais precisa manda
    const scale = Math.min((W / 2 - PAD) / reachX, (H / 2 - PAD) / reachY) * cam.zoom;
    cx += cam.x;
    cy += cam.y;
    const sx = (x: number) => W / 2 + (x - cx) * scale;
    const sy = (y: number) => H / 2 - (y - cy) * scale;
    const stacks = new Map((r.stacks ?? []).map((s) => [s.guid, s.pts] as const));
    // marcas no chão que podem aparecer no replay, e as mecânicas delas (legenda)
    const ground = data.ground.filter((g) => g.t <= r.to && g.t + (data.groundKinds[g.kind]?.lingerMs ?? 0) >= r.from);
    const groundKinds = [...new Set(ground.map((g) => g.kind))].sort((a, b) => a - b);
    const casts = data.casts.filter((c) => (c.end ?? c.t) + CAST_SHOW_MS >= r.from && c.t <= r.to);
    const casters = enemies.filter((e) => casts.some((c) => c.guid === e.guid));
    // grade de GRID_YD presa ao mundo (a mesma em todos os replays)
    const wx0 = cx - (W / 2) / scale;
    const wx1 = cx + (W / 2) / scale;
    const wy0 = cy - (H / 2) / scale;
    const wy1 = cy + (H / 2) / scale;
    const gridX: number[] = [];
    const gridY: number[] = [];
    for (let g = Math.ceil(wx0 / GRID_YD) * GRID_YD; g <= wx1; g += GRID_YD) gridX.push(sx(g));
    for (let g = Math.ceil(wy0 / GRID_YD) * GRID_YD; g <= wy1; g += GRID_YD) gridY.push(sy(g));
    // nomes de boss só onde não cobrem outro (na posição do momento)
    // (a área de quem o replay acompanha fica livre: ali vão o nome, a vida e os golpes)
    const placed: [number, number][] = focus
      .map((u) => posAt(u, r.t))
      .filter((q): q is [number, number] => !!q)
      .map((q) => [sx(q[0]), sy(q[1])]);
    const enemyLabel = new Map<string, boolean>();
    for (const e of enemies) {
      const pe = posAt(e, r.t);
      if (!pe) continue;
      const q: [number, number] = [sx(pe[0]), sy(pe[1]) + BOSS_LABEL_DY]; // onde o nome fica
      const ok = !placed.some((o) => Math.abs(o[0] - q[0]) < 80 && Math.abs(o[1] - q[1]) < 28);
      if (ok) placed.push(q);
      enemyLabel.set(e.guid, ok);
    }
    return { cx, cy, players, focus, enemies, ghosts, keyGhosts, sx, sy, scale, stacks, ground, groundKinds, gridX, gridY, enemyLabel, floor: arena && arena.cells.length ? arena : null, casts, casters };
  }, [data, r, wide, cam]);
  const viewRef = useRef(view);
  viewRef.current = view;

  // ponto da tela em coordenadas do mapa (viewBox)
  const toMap = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const q = pt.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  };

  // roda: zoom em volta do ponto sob o cursor (listener próprio: o do React é passivo e não segura a rolagem da página)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (ev: WheelEvent) => {
      const v = viewRef.current;
      const m = toMap(ev.clientX, ev.clientY);
      if (!v || !m) return;
      ev.preventDefault();
      setCam((c) => {
        const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.zoom * Math.exp(-ev.deltaY * WHEEL_ZOOM)));
        const s2 = (v.scale / c.zoom) * zoom;
        const wx = v.cx + (m.x - W / 2) / v.scale;
        const wy = v.cy - (m.y - H / 2) / v.scale;
        return { zoom, x: c.x + (wx - (m.x - W / 2) / s2 - v.cx), y: c.y + (wy + (m.y - H / 2) / s2 - v.cy) };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [view === null]);

  if (!view || view.players.length === 0) return <p className="muted small">{t.noPositions}</p>;
  const { players, focus, enemies, ghosts, keyGhosts, sx, sy, scale, stacks, ground, groundKinds, gridX, gridY, enemyLabel, floor, casts, casters } = view;
  // cast de cada boss no instante: o que está castando, ou o que acabou de terminar
  const castEnd = (c: (typeof casts)[number]) => c.end ?? (c.facing == null ? c.t + CAST_OPEN_MS : c.t);
  const castNow = (guid: string) => [...casts].reverse().find((c) => c.guid === guid && now >= c.t && now <= castEnd(c) + CAST_SHOW_MS);
  const recentCasts = casts.filter((c) => c.t <= now).slice(-CASTS_MAX).reverse();
  const bossName = (guid: string) => data.units.get(guid)?.name ?? '';
  const span = Math.max(1, r.to - r.from);
  const pctOf = (tt: number) => Math.min(100, Math.max(0, ((tt - r.from) / span) * 100));
  const dot = wide ? 4.5 : 6;
  const focusDot = wide ? 7.5 : 9;
  const scaleBarPx = GRID_YD * scale;
  const groundColor = (kind: number) => GROUND_COLORS[groundKinds.indexOf(kind) % GROUND_COLORS.length];
  const shownHits = (hits ?? []).filter((h) => h.t >= r.from && h.t <= now);
  const feed = shownHits.filter((h) => h.big || h.cause).slice(-FEED_MAX).reverse();
  const focusSet = new Set(focus.map((u) => u.guid));
  const color = (guid: string) => classColor(classes.get(guid));
  const stackLabel = (n: number | null) => (n == null ? '' : n === 0 ? '✓' : n < 0 ? '?' : String(n));
  const fp = focus.map((u) => posAt(u, now));
  const after = now >= r.t;
  const clockMs = Math.round((now - r.t) / 100) * 100;
  const momentName = t.moment[moment];
  const clock = moment === 'touch' || moment === 'hit' ? t.clockMasc(clockMs, momentName) : t.clock(clockMs, momentName);
  const restart = () => {
    setNow(r.from);
    setPlaying(true);
  };
  // um acompanhado: distância até o boss mais perto
  const near =
    fp.length === 1 && fp[0]
      ? enemies
          .map((e) => ({ e, p: posAt(e, now) }))
          .filter((x): x is { e: ReplayUnit; p: [number, number] } => !!x.p)
          .map((x) => ({ ...x, d: Math.hypot(x.p[0] - fp[0]![0], x.p[1] - fp[0]![1]) }))
          .sort((a, b) => a.d - b.d)[0]
      : undefined;
  const gap = fp.length === 2 && fp[0] && fp[1] ? Math.hypot(fp[0][0] - fp[1][0], fp[0][1] - fp[1][1]) : null;
  // fantasmas: os dos outros somem com "Mostrar os outros" desligado; os em destaque por cima
  const shownGhosts = ghosts.filter((g) => others || !focus.length || keyGhosts.has(g.guid));
  const ghostLayer = [...shownGhosts].sort((a, b) => Number(keyGhosts.has(a.guid)) - Number(keyGhosts.has(b.guid)));
  const ghostMoving = (g: ReplayUnit) => {
    const a = posAt(g, now);
    const b = posAt(g, now - 250);
    return !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) >= GHOST_MOVING_YD;
  };
  const ghostOwner = (g: ReplayUnit) => shortName(data.units.get(g.owner ?? '')?.name ?? '');
  const hpNow = hp ? valueAt(hp, now) : null;

  return (
    <div className="replay">
      <svg
        ref={svgRef}
        className={`posmap replay-map ${dragging ? 'dragging' : ''}`}
        onPointerDown={(ev) => {
          dragFrom.current = toMap(ev.clientX, ev.clientY);
          setDragging(true);
          ev.currentTarget.setPointerCapture(ev.pointerId);
        }}
        onPointerMove={(ev) => {
          const from = dragFrom.current;
          const m = from && toMap(ev.clientX, ev.clientY);
          if (!from || !m) return;
          dragFrom.current = m;
          setCam((c) => ({ ...c, x: c.x - (m.x - from.x) / scale, y: c.y + (m.y - from.y) / scale }));
        }}
        onPointerUp={() => {
          dragFrom.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          dragFrom.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => setCam(NO_CAM)}
        viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.aria(focus.length ? focus.map((u) => shortName(u.name)).join(', ') : t.everyone)}>
        <rect width={W} height={H} className="replay-void" />
        <defs>
          <marker id={`${floorId}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="replay-facing-head" />
          </marker>
        </defs>
        {floor && (
          <>
            <defs>
              {/* borra as células e corta o alfa: um chão contínuo com a borda limpa */}
              <filter id={floorId} x="-10%" y="-10%" width="120%" height="120%">
                <feGaussianBlur stdDeviation={Math.max(1.5, floor.cellYd * scale * 0.75)} />
                <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" />
              </filter>
            </defs>
            <g filter={`url(#${floorId})`} className="replay-floor">
              {floor.cells.map(([c, l]) => (
                <rect key={`${c},${l}`} x={sx(c * floor.cellYd) - 0.5} y={sy((l + 1) * floor.cellYd) - 0.5} width={floor.cellYd * scale + 1} height={floor.cellYd * scale + 1} />
              ))}
            </g>
          </>
        )}
        <g className="replay-grid">
          {gridX.map((x) => (
            <line key={`x${x}`} x1={x} y1={0} x2={x} y2={H} />
          ))}
          {gridY.map((y) => (
            <line key={`y${y}`} x1={0} y1={y} x2={W} y2={y} />
          ))}
        </g>
        {ground.map((g, i) => {
          const linger = data.groundKinds[g.kind]?.lingerMs ?? 0;
          const age = now - g.t;
          if (age < 0 || age > linger) return null;
          const c = groundColor(g.kind);
          const rad = Math.min(GROUND_MAX_PX, Math.max(2.5, GROUND_YD * scale));
          return (
            <g key={i} opacity={0.85 - 0.55 * (age / Math.max(linger, 1))}>
              <circle cx={sx(g.x)} cy={sy(g.y)} r={rad} fill={c} fillOpacity={0.55} />
              {age < 300 && <circle cx={sx(g.x)} cy={sy(g.y)} r={rad + 3} fill="none" stroke={c} strokeWidth={1.25} />}
            </g>
          );
        })}
        {enemies.map((e) => {
          const p = posAt(e, now);
          if (!p) return null;
          return (
            <g key={e.guid}>
              <rect x={sx(p[0]) - 7} y={sy(p[1]) - 7} width={14} height={14} rx={2} transform={`rotate(45 ${sx(p[0])} ${sy(p[1])})`} className="posmap-enemy replay-boss">
                <title>{e.name}</title>
              </rect>
              {enemyLabel.get(e.guid) && (
                <text x={sx(p[0])} y={sy(p[1]) + BOSS_LABEL_DY} className="posmap-label replay-boss-label" textAnchor="middle">
                  {e.name}
                </text>
              )}
              {(() => {
                const c = castNow(e.guid);
                if (!c) return null;
                const end = castEnd(c);
                const done = now >= end;
                const k = end > c.t ? Math.min(1, (now - c.t) / (end - c.t)) : 1;
                const [bx, by] = [sx(p[0]), sy(p[1])];
                const len = Math.min(FACING_MAX_PX, FACING_YD * scale);
                return (
                  <g opacity={done ? 1 - Math.min(1, (now - end) / CAST_SHOW_MS) * 0.6 : 1}>
                    {(() => {
                      // frontal: aponta para o alvo do boss durante o cast e fica travado na direção do fim
                      if (!c.cone || c.interrupted) return null;
                      const at = done ? end : now;
                      const tu = c.target ? data.units.get(c.target) : undefined;
                      const tp = tu ? posAt(tu, at) : null;
                      const bp = posAt(e, at) ?? p;
                      const dir = tp ? Math.atan2(tp[1] - bp[1], tp[0] - bp[0]) : done ? c.facing : undefined;
                      if (dir == null) return null;
                      return (
                        <polygon points={triangle(bx, by, dir, (c.cone.halfAngle * Math.PI) / 180, c.cone.range * scale)} className={`replay-cone ${done ? '' : 'casting'}`}>
                          <title>{c.name}</title>
                        </polygon>
                      );
                    })()}
                    {done && !c.cone && c.facing != null && !c.interrupted && (
                      <line x1={bx} y1={by} x2={bx + Math.cos(c.facing) * len} y2={by - Math.sin(c.facing) * len} className="replay-facing" markerEnd={`url(#${floorId}-arrow)`} />
                    )}
                    {/* ícone e barra ao lado do boss: o centro fica livre para a seta */}
                    <SvgSpellIcon spellId={c.spellId} x={bx + 11} y={by - 25} size={18} title={c.name} />
                    <rect x={bx + 11} y={by - 4} width={30} height={4} rx={2} className="replay-castbar-bg" />
                    <rect x={bx + 11} y={by - 4} width={30 * k} height={4} rx={2} className={`replay-castbar ${c.interrupted ? 'cut' : ''}`} />
                  </g>
                );
              })()}
            </g>
          );
        })}
        {near && fp[0] && (
          <g>
            <line x1={sx(fp[0][0])} y1={sy(fp[0][1])} x2={sx(near.p[0])} y2={sy(near.p[1])} className="replay-gap" />
            <text x={(sx(fp[0][0]) + sx(near.p[0])) / 2 - 8} y={(sy(fp[0][1]) + sy(near.p[1])) / 2} className="posmap-label" textAnchor="end">
              {t.distance(near.d.toFixed(0))}
              {!enemyLabel.get(near.e.guid) && ` · ${near.e.name}`}
            </text>
          </g>
        )}
        {ghostLayer.map((g) => {
          const p = posAt(g, now);
          if (!p) return null;
          const c = color(g.owner ?? '');
          const owner = g.owner ? data.units.get(g.owner) : undefined;
          const op = owner ? posAt(owner, now) : null;
          const est = g.estimatedFrom ?? Infinity;
          const xy = (x: number, y: number) => `${sx(x)},${sy(y)}`;
          const here = xy(p[0], p[1]);
          const sure = [...g.pts.filter(([pt]) => pt <= Math.min(now, est)).map(([, x, y]) => xy(x, y)), ...(now <= est ? [here] : [])];
          const guess = now > est ? [...g.pts.filter(([pt]) => pt >= est && pt <= now).map(([, x, y]) => xy(x, y)), here] : [];
          return (
            <g key={g.guid} className="replay-ghost" opacity={focus.length > 0 && !keyGhosts.has(g.guid) ? 0.45 : 1}>
              {op && <line x1={sx(p[0])} y1={sy(p[1])} x2={sx(op[0])} y2={sy(op[1])} stroke={c} className="replay-ghost-tether" />}
              {sure.length > 1 && <polyline points={sure.join(' ')} stroke={c} className="replay-ghost-trail" />}
              {guess.length > 1 && <polyline points={guess.join(' ')} stroke={c} className="replay-ghost-trail guess" />}
              <path d={GHOST_PATH} transform={`translate(${sx(p[0])} ${sy(p[1])})`} fill={c} stroke={c} className={`replay-ghost-body ${ghostMoving(g) ? 'moving' : ''}`}>
                <title>{t.ghostTitle(g.name, ghostOwner(g))}</title>
              </path>
            </g>
          );
        })}
        {players
          .filter((u) => !focusSet.has(u.guid) && (others || !focus.length))
          .map((u) => {
            const p = posAt(u, now);
            if (!p) return null;
            const line = stacks.get(u.guid);
            const n = line ? valueAt(line, now) : null;
            const dim = focus.length > 0 || (line && (n == null || n === 0));
            return (
              <g key={u.guid} opacity={dim ? (line && (n == null || n === 0) ? 0.3 : 0.55) : 1}>
                <circle cx={sx(p[0])} cy={sy(p[1])} r={dot} fill={color(u.guid)} className="posmap-player">
                  <title>{shortName(u.name)}</title>
                </circle>
                <text x={sx(p[0])} y={sy(p[1]) + 3} className="replay-dot-num" textAnchor="middle">
                  {stackLabel(n)}
                </text>
              </g>
            );
          })}
        {focus.map((u) => {
          const p = posAt(u, now);
          const tail = p ? [[sx(p[0]), sy(p[1])]] : [];
          const line = (from: number) => [...u.pts.filter(([pt]) => pt <= now && pt >= from).map(([, x, y]) => [sx(x), sy(y)]), ...tail];
          const old = line(Math.max(r.from, now - TRAIL_MS));
          const recent = line(Math.max(r.from, now - TRAIL_RECENT_MS));
          const pts = (d: number[][]) => d.map((q) => q.join(',')).join(' ');
          return (
            <g key={`trail-${u.guid}`} fill="none" stroke={color(u.guid)} strokeLinejoin="round" strokeLinecap="round">
              {old.length > 1 && <polyline points={pts(old)} strokeWidth={1.5} strokeOpacity={0.3} />}
              {recent.length > 1 && <polyline points={pts(recent)} strokeWidth={2.5} strokeOpacity={0.85} />}
            </g>
          );
        })}
        {gap != null && gap >= SHOW_GAP_YD && fp[0] && fp[1] && (
          <g>
            <line x1={sx(fp[0][0])} y1={sy(fp[0][1])} x2={sx(fp[1][0])} y2={sy(fp[1][1])} className="replay-gap" />
            <text x={(sx(fp[0][0]) + sx(fp[1][0])) / 2 + 8} y={(sy(fp[0][1]) + sy(fp[1][1])) / 2} className="posmap-label">
              {t.distance(gap.toFixed(0))}
            </text>
          </g>
        )}
        {focus.map((u, i) => {
          const p = fp[i];
          if (!p) return null;
          const line = stacks.get(u.guid);
          const n = line ? valueAt(line, now) : null;
          const hit = (r.marks ?? []).some((m) => m.guid === u.guid && now >= m.t && now - m.t <= MARK_MS);
          const dead = dies === u.guid && after;
          // nomes para fora do par: o de cima em cima, o de baixo embaixo
          const other = fp[1 - i];
          const below = other ? sy(p[1]) >= sy(other[1]) : true;
          const nameY = below ? sy(p[1]) + 25 : sy(p[1]) - 17;
          return (
            <g key={u.guid}>
              {hit && <circle cx={sx(p[0])} cy={sy(p[1])} r={focusDot + 5} className="replay-hit" />}
              {after && moment === 'touch' && <circle cx={sx(p[0])} cy={sy(p[1])} r={focusDot + 4} className="posmap-mark culprit" />}
              <circle cx={sx(p[0])} cy={sy(p[1])} r={focusDot} fill={color(u.guid)} className="posmap-player replay-focus" opacity={dead ? 0.5 : 1} />
              {dead ? (
                <text x={sx(p[0])} y={sy(p[1]) + 5} className="replay-dead" textAnchor="middle">
                  ✕
                </text>
              ) : (
                <text x={sx(p[0])} y={sy(p[1]) + 4} className="replay-dot-num strong" textAnchor="middle">
                  {stackLabel(n)}
                </text>
              )}
              <text x={sx(p[0])} y={nameY} className="posmap-label strong" textAnchor="middle" style={{ fill: color(u.guid) }}>
                {shortName(u.name)}
              </text>
              {i === 0 &&
                shownHits
                  .filter((h) => (h.big || h.cause) && now - h.t <= HIT_SHOW_MS)
                  .slice(-3)
                  .map((h, k, arr) => (
                    <text key={`${h.t}-${k}`} x={sx(p[0]) + 14} y={sy(p[1]) - 10 - (arr.length - 1 - k) * 13} className={`replay-dmg ${h.cause ? 'cause' : ''}`}>
                      -{num(h.amount)}
                    </text>
                  ))}
              {i === 0 && hpNow != null && !dead && (
                // barra de vida embaixo do nome (em cima, quando o nome vai para cima)
                <g className="replay-hpbar" role="img" aria-label={t.hp(Math.round(hpNow))}>
                  <title>{t.hp(Math.round(hpNow))}</title>
                  <rect x={sx(p[0]) - HPBAR_W / 2} y={nameY + (below ? 5 : -15)} width={HPBAR_W} height={HPBAR_H} rx={HPBAR_H / 2} className="replay-hpbar-bg" />
                  <rect
                    x={sx(p[0]) - HPBAR_W / 2}
                    y={nameY + (below ? 5 : -15)}
                    width={Math.max(0, Math.min(1, hpNow / 100)) * HPBAR_W}
                    height={HPBAR_H}
                    rx={HPBAR_H / 2}
                    className={`replay-hpbar-fill ${hpNow >= 60 ? 'good' : hpNow >= 30 ? 'mid' : 'low'}`}
                  />
                </g>
              )}
            </g>
          );
        })}
        <g className="replay-scale" transform={`translate(${PAD} ${H - PAD})`}>
          <line x1={0} y1={0} x2={scaleBarPx} y2={0} />
          <line x1={0} y1={-4} x2={0} y2={4} />
          <line x1={scaleBarPx} y1={-4} x2={scaleBarPx} y2={4} />
          <text x={scaleBarPx + 6} y={4} className="posmap-label">
            {t.distance(String(GRID_YD))}
          </text>
        </g>
      </svg>
      <div className="replay-controls">
        <button className="btn sm" onClick={() => (now >= r.to ? restart() : setPlaying(!playing))} aria-label={playing ? t.pause : t.play} title={playing ? t.pause : t.play}>
          {playing ? <Pause size={14} strokeWidth={1.75} aria-hidden /> : <Play size={14} strokeWidth={1.75} aria-hidden />}
        </button>
        <button className="btn sm ghost" onClick={restart} aria-label={t.restart} title={t.restart}>
          <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          className="btn sm ghost"
          onClick={() => {
            setPlaying(false);
            setNow(r.t);
          }}
          aria-label={t.toMoment}
          title={t.toMoment}
        >
          <Crosshair size={14} strokeWidth={1.75} aria-hidden />
        </button>
        <input
          type="range"
          min={r.from}
          max={r.to}
          step={50}
          value={now}
          aria-label={t.slider}
          aria-valuetext={clock}
          onChange={(e) => {
            setPlaying(false);
            setNow(Number(e.target.value));
          }}
        />
        <span className={`small num replay-clock ${after ? 'bad' : 'muted'}`}>{clock}</span>
        {view.floor && (
          <button className={`btn sm ghost ${wide ? 'pressed' : ''}`} aria-pressed={wide} onClick={() => {
              setWide(!wide);
              setCam(NO_CAM);
            }} title={wide ? t.zoomFocus : t.zoomArena} aria-label={wide ? t.zoomFocus : t.zoomArena}>
            {wide ? <Minimize2 size={14} strokeWidth={1.75} aria-hidden /> : <Maximize2 size={14} strokeWidth={1.75} aria-hidden />}
          </button>
        )}
        <span className="replay-speeds" role="group" aria-label={t.speed}>
          {SPEEDS.map((s) => (
            <button key={s} className={`btn sm ghost ${speed === s ? 'pressed' : ''}`} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </span>
        {focus.length > 0 && (
          <label className="small muted replay-others">
            <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} /> {t.showOthers}
          </label>
        )}
        <Hint label={t.howToRead}>
          <ul className="plain hint-list">
            {t.legend.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Hint>
      </div>
      <div className="replay-panels">
        {groundKinds.length > 0 && (
          <p className="small replay-legend">
            <span className="muted">{t.onGround}</span>
            {groundKinds.map((k) => (
              <span key={k} className="replay-legend-item">
                <span className="replay-swatch" style={{ background: groundColor(k) }} aria-hidden />
                <SpellName spellId={data.groundKinds[k].spellId} name={data.groundKinds[k].name} size={16} />
              </span>
            ))}
          </p>
        )}
        {casters.length > 0 && (
          <div className="replay-casts">
            <span className="muted small">{t.castsTitle}</span>
            {casters.map((e) => (
              <div key={e.guid} className="replay-cast-row">
                <span className="small muted replay-cast-boss">{e.name}</span>
                <div className="replay-cast-track">
                  <span className="replay-cast-moment" style={{ left: `${pctOf(r.t)}%` }} aria-hidden />
                  {casts
                    .filter((c) => c.guid === e.guid)
                    .map((c, i) => (
                      <span
                        key={`${c.t}-${i}`}
                        className={`replay-cast-mark ${c.t <= now ? 'past' : ''}`}
                        style={{ left: `${pctOf(c.t)}%`, width: `max(16px, ${pctOf(castEnd(c)) - pctOf(c.t)}%)` }}
                      >
                        <SpellIcon spellId={c.spellId} size={16} title={t.castTitle(c.name, e.name, t.relTime(c.t - r.t))} />
                      </span>
                    ))}
                  <span className="replay-cast-now" style={{ left: `${pctOf(now)}%` }} aria-hidden />
                </div>
              </div>
            ))}
            {recentCasts.length > 0 && (
              <ul className="plain small replay-cast-list">
                {recentCasts.map((c, i) => (
                  <li key={`${c.t}-${i}`}>
                    <span className="muted num">{t.relTime(c.t - r.t)}</span>
                    <span className="muted">{bossName(c.guid)}</span>
                    <SpellName spellId={c.spellId} name={c.name} size={16} />
                    {c.interrupted && <span className="chip">{t.interrupted}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {shownGhosts.length > 0 && (
          <div className="replay-ghosts">
            <span className="muted small">
              {t.ghostsTitle}
              <Hint label={t.ghostsHow}>{t.ghostsHint}</Hint>
            </span>
            <ul className="plain small">
              {shownGhosts.map((g) => {
                const alive = !!posAt(g, now);
                const state = now < g.pts[0][0] ? t.ghostNotYet : !alive ? t.ghostGone : ghostMoving(g) ? t.ghostWalking : t.ghostStill;
                return (
                  <li key={g.guid} className={alive ? '' : 'muted'}>
                    <span className="replay-ghost-swatch" style={{ background: color(g.owner ?? '') }} aria-hidden />
                    <span style={{ color: color(g.owner ?? '') }}>{ghostOwner(g)}</span>
                    <span className="num">{t.ghostMoved(Math.round(movedUntil(g, now)), Math.round(movedUntil(g, Infinity)))}</span>
                    <span className="muted">{state}</span>
                    {g.estimatedFrom != null && now >= g.estimatedFrom && alive && <span className="chip">{t.ghostEstimated}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {hits && (
          <div className="replay-feed">
            <span className="muted small">{t.hitsTitle}</span>
            {feed.length === 0 ? (
              <span className="muted small">{t.noHits}</span>
            ) : (
              <ul className="plain small">
                {feed.map((h, i) => (
                  <li key={`${h.t}-${i}`} className={h.cause ? 'cause' : ''}>
                    <span className="muted num">{t.relTime(h.t - r.t)}</span>
                    <SpellName spellId={h.spellId} name={h.name} size={16} />
                    <span className="num">-{num(h.amount)}</span>
                    {h.cause && <span className="chip bad">{t.cause}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
