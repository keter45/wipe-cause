import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, CircleDot, Crosshair, Maximize2, Minimize2, Pause, Play, Radius, RotateCcw, Tag, MapPin } from 'lucide-react';
import type { ReplayRef } from '../types';
import { classColor, mmss, num, shortName } from '../lib/format';
import { coneDirection, movedUntil, npcOf, posAt, valueAt, type ReplayBounds, type ReplayData, type ReplayHit, type ReplayUnit } from '../lib/replay';
import { tr } from '../i18n';
import { useMessages } from '../i18n';
import * as prefs from '../lib/replayPrefs';
import { replayMsg, type ReplayMoment } from './ReplayView.i18n';
import { SpellIcon, SpellName, SvgSpellIcon } from './SpellIcon';
import { Hint } from './ui/Hint';
import { Popover } from './Popover';
import { castMsOf, fetchTooltip } from '../lib/wowhead';
import { ClipButton, ClipPullContext } from './ClipButton';
import { clipSpan } from '../lib/clipSpan';
import { blastPhase, groundContours } from '../lib/replayHazards';

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
  /** replay completo: tempo controlado de fora (linha do tempo, quadro do raid) */
  playback?: Playback;
  /** clicar num player no mapa seleciona ele */
  onSelect?: (guid: string) => void;
  /** replay da luta inteira: relógio em mm:ss, velocidades maiores, sem os painéis de baixo */
  full?: boolean;
  /** o player está morto neste instante (fica apagado, com um ✕) */
  isDead?: (guid: string, t: number) => boolean;
  /** debuff crucial no player neste instante (ícone em cima da bolinha) */
  badge?: (guid: string, t: number) => { spellId: number; name: string; stacks?: number } | null;
  /** unidade de área (machado) desmentida em `t`: desde quando (alguém passou ali sem levar dano), ou null */
  vacated?: (guid: string, t: number) => number | null;
  /** unidade de área que já sumiu em `t` (ex.: machado sem acertar ninguém na P2) */
  vanished?: (guid: string, t: number) => boolean;
  /** defensivos de raid em área (replay completo): o círculo onde valem, na cor de quem usou */
  zones?: ZoneView[];
  /** janela do slider (a mesma da linha do tempo com zoom); sem ela, o replay inteiro */
  range?: [number, number];
  /** painéis por cima do mapa (replay completo: bosses, medidores, quadro do raid) */
  overlay?: ReactNode;
  /** entre o mapa e os controles (replay completo: a linha do tempo) */
  belowMap?: ReactNode;
  /** logo depois da legenda do chão (replay completo: os debuffs na cabeça) */
  legendExtra?: ReactNode;
  /** replay completo: quem tem esta aura neste instante (centros das áreas em volta de players) */
  holders?: (auraId: number, t: number) => string[];
  /** como o mapa abre (o clipe desenha o que o usuário deixou na tela): enquadramento, câmera, os outros */
  initial?: Partial<MapView>;
  /** trecho que o enquadramento cobre (no clipe, o trecho escolhido); sem ele, o replay inteiro */
  frame?: [number, number];
  /** Clipe automático: câmera fixa na origem da falha, sem expandir para a raid ou a arena. */
  bounds?: ReplayBounds;
}

/** Câmera do usuário por cima do enquadramento automático: deslocamento (jardas) e zoom. */
export interface Cam {
  x: number;
  y: number;
  zoom: number;
}

/** O mapa como está na tela: o enquadramento (a raid toda ou focado), a câmera e se os outros aparecem. */
export interface MapView {
  wide: boolean;
  cam: Cam;
  others: boolean;
}

/** Tempo do replay: o instante, tocando ou parado, e a velocidade. */
export interface Playback {
  now: number;
  setNow: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: number;
  setSpeed: (s: number) => void;
  /** o instante mais recente (o intervalo da animação atualiza antes do React) */
  nowRef: { current: number };
}

/** Passo da animação (ms). */
const FRAME_MS = 33;

/** Controle de tempo de um replay de `from` a `to`, começando em `start`. */
export function usePlayback(from: number, to: number, start: number, autoplay: boolean): Playback {
  const [now, setNowState] = useState(start);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState<number>(1);
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const ts = performance.now();
      const next = Math.min(to, nowRef.current + (ts - last) * speed);
      last = ts;
      nowRef.current = next;
      setNowState(next);
      if (next >= to) setPlaying(false);
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [playing, speed, to]);
  const setNow = (t: number) => {
    const v = Math.min(to, Math.max(from, t));
    nowRef.current = v;
    setNowState(v);
  };
  return { now, setNow, playing, setPlaying, speed, setSpeed, nowRef };
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
/** Luta inteira: dá para correr mais. */
const FULL_SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;
/** Clique (sem arrastar) seleciona o player mais perto até esta distância (px do mapa). */
const PICK_PX = 14;
/** Centralizar no selecionado aproxima ao menos até este zoom. */
const FOCUS_ZOOM = 2.5;
/** Arrastar menos que isto (px do mapa) ainda conta como clique. */
const CLICK_SLOP_PX = 4;
/** Barra de vida de quem o replay acompanha (px). */
const HPBAR_W = 44;
const HPBAR_H = 5;
/** Trecho do caminho desenhado atrás de quem o replay acompanha (ms). */
const TRAIL_MS = 15_000;
/** Raio da marca de um acerto no chão (jardas): o log não diz o tamanho da poça/gota. */
const GROUND_YD = 1.2;
/** ... e no máximo isto na tela (px), para o zoom não virar borrão. */
const GROUND_MAX_PX = 7;
/** Grade do chão (jardas) e régua de escala. */
const GRID_YD = 10;
/** Folga em volta do chão da arena conhecida, na luta inteira (jardas). */
const MAP_PAD_YD = 4;
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
/** Orbs: roxo (o que explode) e verde, e o tamanho do orb no chão (jardas). */
const ORB_COLORS = ['#b46cf5', '#4cc38a'];
const ORB_YD = 1.6;
/** Anel em volta de quem carrega um orb (jardas). */
const CARRY_YD = 2.6;
/** Cores das mecânicas no chão (vermelho fica para bosses e acertos). */
const GROUND_COLORS = ['#e8904a', '#6ea8fe', '#4cc38a', '#d9c05a', '#c084fc', '#f472b6', '#2dd4bf'];
/** Cor de cada área (na ordem da regra). */
const AREA_COLORS = ['#f472b6', '#2dd4bf', '#d9c05a', '#6ea8fe', '#e8904a', '#c084fc'];
const areaColor = (i: number) => AREA_COLORS[i % AREA_COLORS.length];
/** Tempo para o machado desmentido sumir até ficar só o contorno apagado. */
const VACATED_FADE_MS = 600;
/** Linha sem arena conhecida: vai até esta distância do lançador (jardas). */
const LINE_FALLBACK_YD = 60;

/**
 * Fim da linha que sai de `from` na direção de `to`: onde ela sai do chão da arena (a borda mais longe
 * que o raio cruza; o buraco do meio não para a linha), ou a distância padrão sem arena.
 */
function lineEnd(from: [number, number], to: [number, number], floor?: [number, number][]): [number, number] {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const len = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / len, dy / len];
  let best = floor?.length ? 0 : LINE_FALLBACK_YD;
  for (let i = 0; floor && i < floor.length; i++) {
    const [ax, ay] = floor[i];
    const [bx, by] = floor[(i + 1) % floor.length];
    const [ex, ey] = [bx - ax, by - ay];
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - from[0]) * ey - (ay - from[1]) * ex) / den;
    const u = ((ax - from[0]) * uy - (ay - from[1]) * ux) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
  }
  if (best < len) best = len;
  return [from[0] + ux * best, from[1] + uy * best];
}

/** Clipe na luta inteira: o trecho em volta do instante (ms). */
const CLIP_FULL_BEFORE_MS = 6_000;
const CLIP_FULL_AFTER_MS = 4_000;

/** Quem cortou o cast do add fica escrito ao lado dele por isto (ms). */
const KICK_SHOW_MS = 2_000;

/** O soak fica no mapa até isto depois de cair (ms). */
const SOAK_AFTER_MS = 1500;
/** O defensivo em área aparece e some aos poucos (ms). */
const ZONE_FADE_MS = 400;

/** Defensivo em área no mapa. */
export interface ZoneView {
  t: number;
  end: number;
  spellId: number;
  name: string;
  caster: string;
  casterName: string;
  x: number;
  y: number;
  radius: number;
}

/** Triângulo do frontal na tela: do boss (bx, by) na direção `a` (radianos do mundo, y para cima), meio ângulo `h`, com a base a `len` px. */
function triangle(bx: number, by: number, a: number, h: number, len: number): string {
  const side = len / Math.cos(h);
  const pt = (ang: number) => `${(bx + Math.cos(ang) * side).toFixed(1)},${(by - Math.sin(ang) * side).toFixed(1)}`;
  return `${bx.toFixed(1)},${by.toFixed(1)} ${pt(a - h)} ${pt(a + h)}`;
}

/** Setas: quanto voltar/avançar (ms); com Shift, o passo maior. */
const KEY_STEP_MS = 1_000;
const KEY_STEP_BIG_MS = 5_000;
const NO_CAM: Cam = { x: 0, y: 0, zoom: 1 };
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 10;
/** Quanto a roda do mouse aproxima por unidade de deltaY. */
const WHEEL_ZOOM = 0.0015;

const inWindow = (u: ReplayUnit, r: ReplayRef) => u.pts.filter(([t]) => t >= r.from && t <= r.to);

/** Item de um filtro do mapa (mecânica no chão, debuff na cabeça). */
export interface MapFilterItem {
  key: string;
  spellId?: number;
  name: string;
  /** cor da marca no mapa (chão) */
  color?: string;
}

/**
 * Filtro compacto do que aparece no mapa: um botão com quantos estão ligados ("No chão · 8 de 9");
 * clicar abre a lista para ligar e desligar cada um, com atalhos para todos e nenhum.
 */
export function MapFilter({ label, icon, items, hidden, onChange }: { label: string; icon?: ReactNode; items: MapFilterItem[]; hidden: Set<string>; onChange: (hidden: Set<string>) => void }) {
  const t = useMessages(replayMsg);
  const [open, setOpen] = useState(false);
  const on = items.filter((i) => !hidden.has(i.key)).length;
  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (!next.delete(key)) next.add(key);
    onChange(next);
  };
  return (
    <span className="map-filter">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        trigger={
          <button className={`btn sm ghost map-filter-btn ${open ? 'pressed' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
            {icon}
            {label} <span className="muted num">{t.countOf(on, items.length)}</span>
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
          </button>
        }
      >
        <div className="map-filter-head small">
          <span className="muted">{label}</span>
          <button className="link small" onClick={() => onChange(new Set())}>
            {t.all}
          </button>
          <button className="link small" onClick={() => onChange(new Set(items.map((i) => i.key)))}>
            {t.none}
          </button>
        </div>
        <ul className="plain map-filter-list">
          {items.map((i) => {
            const off = hidden.has(i.key);
            return (
              <li key={i.key}>
                <button className={`replay-legend-item replay-legend-toggle ${off ? 'off' : ''}`} aria-pressed={!off} onClick={() => toggle(i.key)} title={off ? t.showOnMap : t.hideOnMap}>
                  {i.color && <span className="replay-swatch" style={{ background: i.color }} aria-hidden />}
                  {i.spellId != null ? <SpellName spellId={i.spellId} name={i.name} size={16} /> : <span>{i.name}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </span>
  );
}

/** Velocidade num menu: o botão mostra a atual; clicar abre as opções. */
function SpeedMenu({ speeds, speed, onChange }: { speeds: readonly number[]; speed: number; onChange: (s: number) => void }) {
  const t = useMessages(replayMsg);
  const [open, setOpen] = useState(false);
  return (
    <span className="speed-menu">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t.speed}
        trigger={
          <button className={`btn sm ghost ${open ? 'pressed' : ''}`} aria-expanded={open} aria-label={t.speedNow(t.speedLabel(speed))} title={t.speed} onClick={() => setOpen(!open)}>
            <span className="num">{t.speedLabel(speed)}</span>
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
          </button>
        }
      >
        <ul className="plain speed-menu-list" role="menu" aria-label={t.speed}>
          {speeds.map((s) => (
            <li key={s}>
              <button
                role="menuitemradio"
                aria-checked={speed === s}
                className={`btn sm ghost ${speed === s ? 'pressed' : ''}`}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
              >
                <span className="num">{t.speedLabel(s)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </span>
  );
}

/** Marcas de chão (world markers), na ordem do /wm: cor e forma de cada uma. */
const WORLD_MARKERS: { color: string; shape: 'square' | 'triangle' | 'diamond' | 'cross' | 'star' | 'circle' | 'moon' | 'skull' }[] = [
  { color: '#3d8bff', shape: 'square' },
  { color: '#43c043', shape: 'triangle' },
  { color: '#b45cff', shape: 'diamond' },
  { color: '#ff4040', shape: 'cross' },
  { color: '#ffd23f', shape: 'star' },
  { color: '#ff9b30', shape: 'circle' },
  { color: '#c8d2dc', shape: 'moon' },
  { color: '#f4f4f4', shape: 'skull' },
];

/** Uma marca de chão no mapa: a forma do jogo na cor dela, com contorno escuro. */
function WorldMarkerIcon({ marker, x, y, title }: { marker: number; x: number; y: number; title: string }) {
  const m = WORLD_MARKERS[marker];
  if (!m) return null;
  const r = 7;
  const star = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    return `${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`;
  }).join(' ');
  const shape = {
    square: <rect x={x - r * 0.8} y={y - r * 0.8} width={r * 1.6} height={r * 1.6} />,
    triangle: <polygon points={`${x},${y - r} ${x + r},${y + r * 0.8} ${x - r},${y + r * 0.8}`} />,
    diamond: <polygon points={`${x},${y - r} ${x + r * 0.8},${y} ${x},${y + r} ${x - r * 0.8},${y}`} />,
    cross: <path d={`M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`} className="replay-wm-cross" style={{ stroke: m.color }} />,
    star: <polygon points={star} />,
    circle: <circle cx={x} cy={y} r={r * 0.85} />,
    moon: <path d={`M${x + r * 0.3},${y - r} A${r},${r} 0 1 0 ${x + r * 0.3},${y + r} A${r * 0.75},${r * 0.75} 0 1 1 ${x + r * 0.3},${y - r}Z`} />,
    skull: (
      <g>
        <circle cx={x} cy={y - 1} r={r * 0.85} />
        <rect x={x - r * 0.45} y={y + r * 0.35} width={r * 0.9} height={r * 0.55} />
        <circle cx={x - r * 0.32} cy={y - 1.5} r={1.6} className="replay-wm-eye" />
        <circle cx={x + r * 0.32} cy={y - 1.5} r={1.6} className="replay-wm-eye" />
      </g>
    ),
  }[m.shape];
  return (
    <g className="replay-wm" style={{ fill: m.color }}>
      <title>{title}</title>
      {shape}
    </g>
  );
}

/** Replay das posições em volta de um momento (morte, acerto, falha, encontro). */
export function ReplayView({ data, replay: r, classes, moment, autoplay = true, hp, dies, hits, playback, onSelect, full = false, isDead, badge, overlay, belowMap, legendExtra, holders, vacated, vanished, zones = [], range, initial, frame, bounds }: Props) {
  const clipCtx = useContext(ClipPullContext);
  const t = useMessages(replayMsg);
  // tempo: o de fora (replay completo) ou o próprio
  const own = usePlayback(r.from, r.to, autoplay ? r.from : r.t, !playback && autoplay);
  const { now, setNow, playing, setPlaying, speed, setSpeed, nowRef } = playback ?? own;
  const [others, setOthers] = useState(initial?.others ?? true);
  // marcas de chão escondidas pela legenda (clique liga e desliga)
  // áreas das habilidades e orbs (replay completo) e nomes embaixo das bolinhas: também ligam e desligam
  const [hiddenAreas, setHiddenAreas] = useState<Set<string>>(prefs.hiddenAreas);
  const [names, setNames] = useState(prefs.showNames);
  const [markersOn, setMarkersOn] = useState(prefs.showMarkers);
  const [wowheadCast, setWowheadCast] = useState<Record<number, number>>({});
  // spells cortados sem tempo de cast medido no log: busca no Wowhead
  useEffect(() => {
    const missing = [...new Set(data.casts.filter((c) => c.interrupted && data.castMs?.[c.spellId] == null).map((c) => c.spellId))];
    let alive = true;
    for (const id of missing) {
      void fetchTooltip(id).then((t) => {
        const ms = castMsOf(t);
        if (alive && ms) setWowheadCast((w) => ({ ...w, [id]: ms }));
      });
    }
    return () => {
      alive = false;
    };
  }, [data]);
  // (vale para todos os replays e fica salvo entre sessões)
  const [hiddenGround, setHiddenGround] = useState<Set<string>>(prefs.hiddenGround);
  // enquadramento: a arena inteira (morte, falha coletiva, luta inteira) ou perto de quem o replay acompanha
  // (na luta inteira: o chão da arena, ou focado em quem está selecionado no trecho do clipe)
  const [wide, setWide] = useState(initial?.wide ?? (full || moment === 'death' || moment === 'failure'));
  const floorId = useId().replace(/:/g, '');
  // arrastar move o mapa, a roda dá zoom; duplo clique (ou trocar o enquadramento) volta
  const [cam, setCam] = useState<Cam>(initial?.cam ?? NO_CAM);
  // trecho do clipe escolhido pelo usuário (null = o padrão, em volta do instante)
  const [clipRange, setClipRange] = useState<[number, number] | null>(null);
  // o que o enquadramento cobre: o trecho do clipe (no clipe e, na luta inteira focada, na tela) ou o replay
  const frameWin = frame ?? (full && !wide ? clipRange : null);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  // onde o arrasto começou (pouco movimento = clique, que seleciona um player)
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  // teclado: o replay em foco (abre focado e ganha foco ao clicar no mapa)
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const view = useMemo(() => {
    const fr: ReplayRef = frameWin ? { ...r, from: frameWin[0], to: frameWin[1] } : r;
    const units = [...data.units.values()];
    const players = units.filter((u) => u.kind === 'player' && inWindow(u, r).length > 0);
    const focus = r.focus.map((g) => data.units.get(g)).filter((u): u is ReplayUnit => !!u && inWindow(u, r).length > 0);
    // unidades que são áreas (ex.: os machados) não viram losango de boss: aparecem como área
    const areaNpcs = new Set(data.areas.map((a) => a.npc).filter((n): n is number => n != null));
    const isAreaUnit = (u: ReplayUnit) => areaNpcs.size > 0 && areaNpcs.has(npcOf(u.guid) ?? -1);
    // unidade da área que continua desenhada como sempre (o boss com o círculo em volta)
    const keepNpcs = new Set(data.areas.filter((a) => a.keepUnit && a.npc != null).map((a) => a.npc!));
    const enemies = units.filter((u) => u.kind === 'enemy' && (!isAreaUnit(u) || keepNpcs.has(npcOf(u.guid) ?? -1)) && inWindow(u, r).length > 0);
    const areaUnits = units.filter((u) => u.kind === 'enemy' && isAreaUnit(u) && inWindow(u, r).length > 0);
    // fantasmas (caminho simulado) que aparecem no replay, os que mais andaram primeiro
    const ghosts = units.filter((u) => u.kind === 'ghost' && inWindow(u, r).length > 0).sort((a, b) => movedUntil(b, r.to) - movedUntil(a, r.to));
    // área: o caminho de quem o replay acompanha (ou de todo mundo, numa falha coletiva) e os bosses perto
    const core = focus.length ? focus : players;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const u of core) {
      for (const [, x, y] of inWindow(u, fr)) {
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
      for (const [, x, y] of inWindow(g, fr)) {
        xs.push(x);
        ys.push(y);
      }
    }
    // o trecho sem ninguém andando (fora do replay): enquadra pelo replay inteiro
    if (xs.length === 0 && fr !== r) {
      for (const u of core) {
        for (const [, x, y] of inWindow(u, r)) {
          xs.push(x);
          ys.push(y);
        }
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
    // luta inteira com a arena conhecida: a arena toda (o chão da imagem); focada, quem está selecionado
    const fl = full && wide ? data.map?.floor : undefined;
    if (fl && fl.length) {
      const [x0, x1] = [Math.min(...fl.map((q) => q[0])), Math.max(...fl.map((q) => q[0]))];
      const [y0, y1] = [Math.min(...fl.map((q) => q[1])), Math.max(...fl.map((q) => q[1]))];
      cx = (x0 + x1) / 2;
      cy = (y0 + y1) / 2;
      reachX = (x1 - x0) / 2 + MAP_PAD_YD;
      reachY = (y1 - y0) / 2 + MAP_PAD_YD;
    } else if (useArena) {
      // vista aberta: onde a raid (e os bosses e fantasmas) esteve durante o replay, não a sala toda do pull
      // (sem os poucos que ficaram longe de todo mundo; quem o replay acompanha, os bosses e os fantasmas em destaque sempre entram)
      const rx: number[] = [];
      const ry: number[] = [];
      for (const u of players) {
        for (const [, x, y] of inWindow(u, fr)) {
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
        for (const [, x, y] of inWindow(u, fr)) {
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
    if (wide && !full) for (const blast of data.blasts ?? []) {
      if (blast.from > fr.to || blast.at + 1000 < fr.from) continue;
      reachX = Math.max(reachX, Math.abs(blast.x - cx) + blast.radius + 2);
      reachY = Math.max(reachY, Math.abs(blast.y - cy) + blast.radius + 2);
    }
    if (bounds) {
      cx = (bounds[0] + bounds[1]) / 2;
      cy = (bounds[2] + bounds[3]) / 2;
      reachX = Math.max(1, (bounds[1] - bounds[0]) / 2);
      reachY = Math.max(1, (bounds[3] - bounds[2]) / 2);
    }
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
      // quem aparece depois (adds) entra pelo primeiro ponto
      const pe = posAt(e, Math.max(r.t, e.pts[0]?.[0] ?? r.t));
      if (!pe) continue;
      const q: [number, number] = [sx(pe[0]), sy(pe[1]) + BOSS_LABEL_DY]; // onde o nome fica
      const ok = !placed.some((o) => Math.abs(o[0] - q[0]) < 80 && Math.abs(o[1] - q[1]) < 28);
      if (ok) placed.push(q);
      enemyLabel.set(e.guid, ok);
    }
    return { cx, cy, players, focus, enemies, areaUnits, ghosts, keyGhosts, sx, sy, scale, stacks, ground, groundKinds, gridX, gridY, enemyLabel, floor: arena && arena.cells.length ? arena : null, map: data.map, casts, casters };
  }, [data, r, wide, cam, full, frameWin?.[0], frameWin?.[1], bounds]);
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

  const contours = useMemo(() => groundContours(data, now), [data, now]);
  if (!view || view.players.length === 0) return <p className="muted small">{t.noPositions}</p>;
  const { players, focus, enemies, areaUnits, ghosts, keyGhosts, sx, sy, scale, stacks, ground, groundKinds, gridX, gridY, enemyLabel, floor, map, casts, casters } = view;
  // cast de cada boss no instante: o que está castando, ou o que acabou de terminar
  // tempo de cast do spell: medido nos casts que terminam no log; sem nenhum (todo cast cortado), o do
  // tooltip do Wowhead ("10 sec cast")
  // com Curse of Tongues (e parecidos) no lançador, o cast demora mais
  const castDur = (c: (typeof casts)[number]) => {
    const base = data.castMs?.[c.spellId] ?? wowheadCast[c.spellId];
    return base == null ? undefined : base * (1 + (c.slowPct ?? 0) / 100);
  };
  const castEnd = (c: (typeof casts)[number]) => c.end ?? (c.facing == null ? c.t + (castDur(c) ?? CAST_OPEN_MS) : c.t);
  // o cast com tempo vale mais que um instantâneo no mesmo momento (o add solta um instantâneo ao ser
  // cortado, e a barra cortada sumia atrás dele)
  const castNow = (guid: string) => {
    const live = [...casts].reverse().filter((c) => c.guid === guid && now >= c.t && now <= castEnd(c) + CAST_SHOW_MS);
    return live.find((c) => castEnd(c) > c.t) ?? live[0];
  };
  // o add nasce castando, mas o log só dá a posição quando alguém bate nele: até lá, fica na primeira
  // posição conhecida desde o primeiro cast
  const firstCast = new Map<string, number>();
  for (const c of data.casts) if (!firstCast.has(c.guid)) firstCast.set(c.guid, c.t);
  const enemyPos = (u: ReplayUnit, t: number) => {
    const p = posAt(u, t);
    if (p || !u.pts.length) return p;
    const born = firstCast.get(u.guid);
    return born != null && t >= born && t < u.pts[0][0] ? ([u.pts[0][1], u.pts[0][2]] as [number, number]) : null;
  };
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
  const clock = full ? mmss(now) : moment === 'touch' || moment === 'hit' ? t.clockMasc(clockMs, momentName) : t.clock(clockMs, momentName);
  const deadNow = (guid: string) => !!isDead?.(guid, now);
  const onKey = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ev.target as HTMLElement;
    const range = el instanceof HTMLInputElement && el.type === 'range';
    // espaço num botão ou caixa de seleção é o clique dele
    if (ev.key === ' ' && !range && (el.tagName === 'BUTTON' || el.tagName === 'INPUT')) return;
    if (ev.key === ' ') {
      ev.preventDefault();
      if (now >= r.to) restart();
      else setPlaying(!playing);
    } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      const step = (ev.shiftKey ? KEY_STEP_BIG_MS : KEY_STEP_MS) * (full ? 5 : 1) * (ev.key === 'ArrowLeft' ? -1 : 1);
      const next = Math.min(r.to, Math.max(r.from, nowRef.current + step));
      nowRef.current = next;
      setNow(next);
    }
  };
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
  /** Trecho padrão do clipe: em volta do instante (luta inteira) ou o replay do momento. */
  const defaultClipRange = (): [number, number] =>
    full ? [Math.max(r.from, now - CLIP_FULL_BEFORE_MS), Math.min(r.to, now + CLIP_FULL_AFTER_MS)] : clipSpan(r, r.t);
  /** A raid toda ou focado (na luta inteira, focado enquadra o trecho do clipe). */
  const toggleWide = () => {
    if (full && wide && !clipRange) setClipRange(defaultClipRange());
    setWide(!wide);
    setCam(NO_CAM);
  };
  // luta inteira: centraliza (e aproxima) a câmera em quem está selecionado, no instante
  const centerOnFocus = () => {
    const p = fp[0];
    if (!p) return;
    setCam((c) => ({ zoom: Math.max(c.zoom, FOCUS_ZOOM), x: c.x + p[0] - view.cx, y: c.y + p[1] - view.cy }));
  };

  return (
    <div className="replay" ref={rootRef} tabIndex={-1} onKeyDown={onKey} aria-keyshortcuts="Space ArrowLeft ArrowRight">
      <div className="replay-stage">
      <svg
        ref={svgRef}
        className={`posmap replay-map ${dragging ? 'dragging' : ''}`}
        onPointerDown={(ev) => {
          dragFrom.current = toMap(ev.clientX, ev.clientY);
          dragStart.current = dragFrom.current;
          setDragging(true);
          // sem captura (ponteiro que o navegador já soltou) o arrasto só para ao sair do mapa
          try {
            ev.currentTarget.setPointerCapture(ev.pointerId);
          } catch {
            /* segue sem captura */
          }
          rootRef.current?.focus({ preventScroll: true });
        }}
        onPointerMove={(ev) => {
          const from = dragFrom.current;
          const m = from && toMap(ev.clientX, ev.clientY);
          if (!from || !m) return;
          dragFrom.current = m;
          setCam((c) => ({ ...c, x: c.x - (m.x - from.x) / scale, y: c.y + (m.y - from.y) / scale }));
        }}
        onPointerUp={(ev) => {
          // clique sem arrastar: seleciona o player mais perto do ponteiro
          const start = dragStart.current;
          const m = toMap(ev.clientX, ev.clientY);
          if (onSelect && start && m && Math.hypot(m.x - start.x, m.y - start.y) < CLICK_SLOP_PX) {
            let best: { guid: string; d: number } | null = null;
            for (const u of players) {
              const p = posAt(u, now);
              if (!p) continue;
              const d = Math.hypot(sx(p[0]) - m.x, sy(p[1]) - m.y);
              if (d <= PICK_PX && (!best || d < best.d)) best = { guid: u.guid, d };
            }
            if (best) onSelect(best.guid);
          }
          dragFrom.current = null;
          dragStart.current = null;
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
          {map && <clipPath id={floorId + '-pools'}><path d={[map.floor, ...map.holes].map((poly) => 'M' + poly.map(([x, y]) => sx(x) + ',' + sy(y)).join('L') + 'Z').join(' ')} clipRule="evenodd" /></clipPath>}
          <marker id={`${floorId}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="replay-facing-head" />
          </marker>
        </defs>
        {map && (
          <g className="replay-map">
            {/* fundo da arena (raidplan.io) alinhado com o log; fora do chão andável, escurecido */}
            {map.image && <image href={map.image} x={sx(map.x0)} y={sy(map.y0)} width={map.w * scale} height={map.h * scale} preserveAspectRatio="none" className="replay-map-image" />}
            <path d={`M-9999,-9999H9999V9999H-9999Z ${[map.floor, ...map.holes].map((poly) => `M${poly.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join("L")}Z`).join(" ")}`} fillRule="evenodd" className="replay-map-out" />
            <path d={[map.floor, ...map.holes].map((poly) => `M${poly.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join("L")}Z`).join(" ")} className="replay-map-edge" />
          </g>
        )}
        {floor && !map && (
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
        {contours.map((contour) => {
          const kind = data.groundKinds[contour.kind];
          if (hiddenGround.has(kind.key)) return null;
          const size = contour.cellYd;
          const fill = contour.cells.map(([x, y]) => 'M' + sx(x * size) + ',' + sy(y * size) + 'h' + size * scale + 'v' + -size * scale + 'h' + -size * scale + 'Z').join(' ');
          const outline = contour.edges.map(([x, y, nextX, nextY]) => 'M' + sx(x * size) + ',' + sy(y * size) + 'L' + sx(nextX * size) + ',' + sy(nextY * size)).join(' ');
          return <g key={kind.key} className="replay-pool" style={{ color: groundColor(contour.kind) }} clipPath={map ? 'url(#' + floorId + '-pools)' : undefined}>
            <title>{t.estimatedArea(kind.name)}</title>
            <path d={fill} className="replay-pool-fill" />
            <path d={outline} className="replay-pool-outline" />
          </g>;
        })}
        {(data.blasts ?? []).map((blast, index) => {
          const phase = blastPhase(blast, now);
          if (!phase || hiddenAreas.has('blast:' + blast.key)) return null;
          return <g key={blast.key + ':' + index} className={'replay-blast ' + phase} data-phase={phase}>
            <title>{t.blast(blast.name, blast.radius, Math.max(0, blast.at - now), phase === 'impact', blast.timingEstimated)}</title>
            <circle cx={sx(blast.x)} cy={sy(blast.y)} r={blast.radius * scale} />
            <SvgSpellIcon spellId={blast.spellId} x={sx(blast.x) - 7} y={sy(blast.y) - 7} size={14} title={t.blast(blast.name, blast.radius, Math.max(0, blast.at - now), phase === 'impact', blast.timingEstimated)} />
          </g>;
        })}
        {ground.map((g, i) => {
          if (data.groundKinds[g.kind]?.contourCellYd) return null;
          if (hiddenGround.has(data.groundKinds[g.kind]?.key)) return null;
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
        {data.areas.map((a, ai) => {
          if (hiddenAreas.has(a.key)) return null;
          const c = areaColor(ai);
          const rad = a.radius * scale;
          const centers: [string, [number, number]][] = [];
          if (a.npc != null) {
            for (const u of areaUnits) if (npcOf(u.guid) === a.npc && !vanished?.(u.guid, now)) { const q = posAt(u, now); if (q) centers.push([u.guid, q]); }
          } else if (a.aura != null && holders) {
            for (const g of holders(a.aura, now)) { const u = data.units.get(g); const q = u && posAt(u, now); if (q) centers.push([g, q]); }
          }
          return centers.map(([g, q]) => {
            // machado desmentido: alguém passou ali sem levar dano; fica o contorno apagado de onde ele estava
            const since = a.npc != null ? (vacated?.(g, now) ?? null) : null;
            const fade = since == null ? 0 : Math.min(1, (now - since) / VACATED_FADE_MS);
            return (
              <g key={`area-${a.key}-${g}`} className={`replay-area ${since != null ? 'vacated' : ''}`} opacity={1 - 0.7 * fade}>
                <circle cx={sx(q[0])} cy={sy(q[1])} r={rad} fill={c} fillOpacity={0.12 * (1 - fade)} stroke={c} strokeOpacity={0.7} strokeDasharray={a.npc != null && since == null ? undefined : '4 3'}>
                  <title>{since != null ? t.vacated(a.name) : a.name}</title>
                </circle>
                {a.npc != null && !a.keepUnit && a.spellId != null && <SvgSpellIcon spellId={a.spellId} x={sx(q[0]) - 6} y={sy(q[1]) - 6} size={12} title={since != null ? t.vacated(a.name) : a.name} />}
              </g>
            );
          });
        })}
        {/* marcas de chão do grupo (world markers) */}
        {markersOn &&
          data.markers.map((m, i) =>
            now >= m.from && (m.to == null || now < m.to) ? <WorldMarkerIcon key={`wm-${i}`} marker={m.marker} x={sx(m.x)} y={sy(m.y)} title={t.marker(m.marker)} /> : null,
          )}
        {/* soaks: o círculo onde cai, com quantos estão dentro (antes) ou entraram (depois) */}
        {data.soaks.map((k, i) => {
          if (now < k.from || now > k.at + SOAK_AFTER_MS || hiddenAreas.has(`soak:${k.key}`)) return null;
          const done = now >= k.at;
          const inside = done
            ? k.hit
            : players.filter((u) => {
                if (deadNow(u.guid)) return false;
                const q = posAt(u, now);
                return !!q && Math.hypot(q[0] - k.x, q[1] - k.y) <= k.radius;
              }).length;
          const short = k.needs != null && inside < k.needs;
          const label = t.soak(k.name, inside, k.needs ?? null, done);
          return (
            <g key={`soak-${i}`} className={`replay-soak ${done ? 'done' : ''} ${short ? 'short' : ''}`} opacity={done ? 1 - ((now - k.at) / SOAK_AFTER_MS) * 0.6 : 1}>
              <circle cx={sx(k.x)} cy={sy(k.y)} r={k.radius * scale}>
                <title>{label}</title>
              </circle>
              <SvgSpellIcon spellId={k.spellId} x={sx(k.x) - 7} y={sy(k.y) - k.radius * scale - 16} size={14} title={label} />
              <text x={sx(k.x)} y={sy(k.y) + 4} textAnchor="middle" className="replay-soak-count">
                {k.needs != null ? `${inside}/${k.needs}` : inside}
              </text>
            </g>
          );
        })}
        {/* defensivos de raid em área (AMZ, Darkness, Spirit Link...): na cor de quem usou */}
        {zones.map((z, i) => {
          if (now < z.t || now >= z.end || hiddenAreas.has(`def:${z.spellId}`)) return null;
          const c = color(z.caster);
          const k = Math.min(1, (now - z.t) / ZONE_FADE_MS, (z.end - now) / ZONE_FADE_MS);
          const label = t.zone(z.name, shortName(z.casterName), Math.ceil((z.end - now) / 1000));
          return (
            <g key={`zone-${i}`} className="replay-zone" opacity={0.35 + 0.65 * k}>
              <circle cx={sx(z.x)} cy={sy(z.y)} r={z.radius * scale} fill={c} fillOpacity={0.1} stroke={c} strokeOpacity={0.8} strokeWidth={1.5}>
                <title>{label}</title>
              </circle>
              {/* o ícone na borda de cima: o centro costuma estar cheio de gente */}
              <SvgSpellIcon spellId={z.spellId} x={sx(z.x) - 8} y={sy(z.y) - z.radius * scale - 8} size={16} title={label} />
            </g>
          );
        })}
        {data.orbs &&
          data.orbs.ground.map(([from, to, ox, oy, k], i) => {
            if (now < from || now >= to || hiddenAreas.has(`orb:${k}`)) return null;
            const kind = data.orbs!.kinds[k];
            const c = ORB_COLORS[k] ?? ORB_COLORS[1];
            const [x, y] = [sx(ox / 10), sy(oy / 10)];
            return (
              <g key={`orb-${i}`} className="replay-orb">
                {kind?.volatile && <circle cx={x} cy={y} r={(data.orbs!.contactYd - 1) * scale} fill={c} fillOpacity={0.07} stroke={c} strokeOpacity={0.55} strokeDasharray="3 3" />}
                <circle cx={x} cy={y} r={Math.max(3.5, ORB_YD * scale)} fill={c} stroke="var(--bg)" strokeWidth={1}>
                  <title>{t.orb(tr(kind?.name ?? { pt: '', en: '' }))}</title>
                </circle>
              </g>
            );
          })}
        {enemies.map((e) => {
          const p = enemyPos(e, now);
          if (!p) return null;
          // quem cortou o último cast dele (por 2 s, mesmo que ele já tenha começado outro)
          const kick = [...casts].reverse().find((c) => c.guid === e.guid && c.interrupted && c.interruptedBy && c.end != null && now >= c.end && now - c.end <= KICK_SHOW_MS);
          return (
            <g key={e.guid}>
              {kick && (
                <text x={sx(p[0]) + 11} y={sy(p[1]) + 9} className="posmap-label replay-kick" style={{ fill: color(kick.interruptedBy!) }}>
                  {t.kickedBy(shortName(data.units.get(kick.interruptedBy!)?.name ?? '?'))}
                </text>
              )}
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
                // a barra anda no ritmo do cast: cortado, para no ponto em que foi cortado (ex.: 50%)
                const full = Math.max(castDur(c) ?? 0, end - c.t);
                const k = full > 0 ? Math.min(1, (Math.min(now, end) - c.t) / full) : 1;
                const [bx, by] = [sx(p[0]), sy(p[1])];
                const len = Math.min(FACING_MAX_PX, FACING_YD * scale);
                return (
                  <g opacity={done ? 1 - Math.min(1, (now - end) / CAST_SHOW_MS) * 0.6 : 1}>
                    {(() => {
                      // frontal: aponta para o alvo do boss durante o cast e fica travado na direção do fim
                      if (!c.cone || (done && c.interrupted)) return null;
                      const at = done ? end : now;
                      const tu = c.target ? data.units.get(c.target) : undefined;
                      const tp = tu ? posAt(tu, at) : null;
                      const bp = posAt(e, at) ?? p;
                      const dir = coneDirection(c.facing, done, bp, tp);
                      if (dir == null) return null;
                      return (
                        <polygon points={triangle(sx(bp[0]), sy(bp[1]), dir, (c.cone.halfAngle * Math.PI) / 180, c.cone.range * scale)} data-phase={done ? 'impact' : 'warning'} className={`replay-cone ${done ? 'impact' : 'casting'}`}>
                          <title>{c.name}</title>
                        </polygon>
                      );
                    })()}
                    {(() => {
                      // linha do lançador até o alvo (o cuspe do add até quem ele marcou)
                      if (!c.line || c.interrupted) return null;
                      const at = done ? end : now;
                      const tu = c.target ? data.units.get(c.target) : undefined;
                      const tp = tu ? posAt(tu, at) : null;
                      const bp = posAt(e, at) ?? p;
                      if (!tp) return null;
                      // o alvo só dá a direção: a linha vai até a borda da sala
                      const far = lineEnd(bp, tp, data.map?.floor);
                      const [x1, y1, x2, y2] = [sx(bp[0]), sy(bp[1]), sx(far[0]), sy(far[1])];
                      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
                      const hw = Math.max(2, (c.line.width * scale) / 2);
                      const [nx, ny] = [(-(y2 - y1) / len) * hw, ((x2 - x1) / len) * hw];
                      return (
                        <polygon points={`${x1 + nx},${y1 + ny} ${x2 + nx},${y2 + ny} ${x2 - nx},${y2 - ny} ${x1 - nx},${y1 - ny}`} className={`replay-line ${done ? '' : 'casting'}`}>
                          <title>{c.name}</title>
                        </polygon>
                      );
                    })()}
                    {done && !c.cone && c.facing != null && !c.interrupted && (
                      <line x1={bx} y1={by} x2={bx + Math.cos(c.facing) * len} y2={by - Math.sin(c.facing) * len} className="replay-facing" markerEnd={`url(#${floorId}-arrow)`} />
                    )}
                    {/* ícone e barra ao lado do boss: o centro fica livre para a seta */}
                    <SvgSpellIcon spellId={c.spellId} x={bx + 11} y={by - 25} size={18} title={c.slowPct ? t.castSlowed(c.name, c.slowPct) : c.name} />
                    <rect x={bx + 11} y={by - 4} width={30} height={4} rx={2} className="replay-castbar-bg" />
                    <rect x={bx + 11} y={by - 4} width={30 * k} height={4} rx={2} className={`replay-castbar ${c.interrupted && done ? 'cut' : ''}`} />
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
        {data.orbs &&
          data.orbs.carries.map(([g, from, to, k], i) => {
            if (now < from || now >= to || hiddenAreas.has(`orb:${k}`)) return null;
            const u = data.units.get(g);
            const q = u && posAt(u, now);
            if (!q) return null;
            const c = ORB_COLORS[k] ?? ORB_COLORS[1];
            return <circle key={`carry-${i}`} cx={sx(q[0])} cy={sy(q[1])} r={Math.max(9, CARRY_YD * scale)} fill="none" stroke={c} strokeWidth={2.5} className="replay-carry" />;
          })}
        {players
          .filter((u) => !focusSet.has(u.guid) && (others || !focus.length))
          .map((u) => {
            const p = posAt(u, now);
            if (!p) return null;
            const line = stacks.get(u.guid);
            const n = line ? valueAt(line, now) : null;
            const dim = focus.length > 0 || (line && (n == null || n === 0));
            const dead = deadNow(u.guid);
            const b = !dead && badge?.(u.guid, now);
            return (
              <g key={u.guid} opacity={dead ? 0.3 : dim ? (line && (n == null || n === 0) ? 0.3 : 0.55) : 1} className={onSelect ? 'replay-pickable' : undefined}>
                <circle cx={sx(p[0])} cy={sy(p[1])} r={dot} fill={color(u.guid)} className="posmap-player">
                  <title>{shortName(u.name)}</title>
                </circle>
                {dead ? (
                  <text x={sx(p[0])} y={sy(p[1]) + 4} className="replay-dead small" textAnchor="middle">
                    ✕
                  </text>
                ) : (
                  <text x={sx(p[0])} y={sy(p[1]) + 3} className="replay-dot-num" textAnchor="middle">
                    {stackLabel(n)}
                  </text>
                )}
                {b && <SvgSpellIcon spellId={b.spellId} x={sx(p[0]) + dot - 2} y={sy(p[1]) - dot - 12} size={12} title={b.name} stacks={b.stacks} />}
                {/* visão geral (ninguém em foco): o nome embaixo de cada um */}
                {!focus.length && names && (
                  <text x={sx(p[0])} y={sy(p[1]) + dot + 10} className="posmap-label replay-name" textAnchor="middle" style={{ fill: color(u.guid) }}>
                    {shortName(u.name)}
                  </text>
                )}
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
          const dead = (dies === u.guid && after) || deadNow(u.guid);
          const b = !dead && badge?.(u.guid, now);
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
              {b && <SvgSpellIcon spellId={b.spellId} x={sx(p[0]) + focusDot - 2} y={sy(p[1]) - focusDot - 16} size={16} title={b.name} stacks={b.stacks} />}
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
        <g className="replay-scale" transform={`translate(${PAD} ${full ? PAD + 6 : H - PAD})`}>
          <line x1={0} y1={0} x2={scaleBarPx} y2={0} />
          <line x1={0} y1={-4} x2={0} y2={4} />
          <line x1={scaleBarPx} y1={-4} x2={scaleBarPx} y2={4} />
          <text x={scaleBarPx + 6} y={4} className="posmap-label">
            {t.distance(String(GRID_YD))}
          </text>
        </g>
      </svg>
      {overlay}
      </div>
      {/* linha do tempo e controles na mesma grade: o trilho da linha do tempo tem a largura do slider */}
      <div className={belowMap ? 'replay-dock' : undefined}>
      {belowMap}
      <div className="replay-controls">
        <span className="replay-left">
        <button className="btn sm" onClick={() => (now >= r.to ? restart() : setPlaying(!playing))} aria-label={playing ? t.pause : t.play} title={playing ? t.pause : t.play}>
          {playing ? <Pause size={14} strokeWidth={1.75} aria-hidden /> : <Play size={14} strokeWidth={1.75} aria-hidden />}
        </button>
        <button className="btn sm ghost" onClick={restart} aria-label={t.restart} title={t.restart}>
          <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
        </button>
        {full ? (
          focus.length > 0 && (
            <button className="btn sm ghost" onClick={centerOnFocus} aria-label={t.centerFocus} title={t.centerFocus}>
              <Crosshair size={14} strokeWidth={1.75} aria-hidden />
            </button>
          )
        ) : (
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
        )}
        </span>
        <input
          type="range"
          min={range?.[0] ?? r.from}
          max={range?.[1] ?? r.to}
          className={range && (now < range[0] || now > range[1]) ? 'outside' : undefined}
          step={50}
          value={now}
          aria-label={t.slider}
          aria-valuetext={full ? clock : `${mmss(now)} · ${clock}`}
          onChange={(e) => {
            setPlaying(false);
            setNow(Number(e.target.value));
          }}
        />
        <span className="replay-right">
        {clipCtx && (
          <ClipButton
            pull={clipCtx.pull}
            title={clipCtx.title}
            moment={([from]) => {
              const death = dies ? clipCtx.pull.deaths.find((d) => d.guid === dies && d.replay?.t === r.t) : undefined;
              const label = death ? t.clipDied(shortName(death.name)) : full ? t.clipAt(mmss(from)) : t.clipMoment;
              return { replay: { ...r, from: r.from, to: r.to }, t: full ? from : r.t, label, death };
            }}
            bounds={[r.from, r.to]}
            range={clipRange ?? defaultClipRange()}
            custom={clipRange != null}
            onRange={setClipRange}
            now={() => nowRef.current}
            view={{ wide, cam, others }}
            canFrame={!!view.floor || full}
            onWide={toggleWide}
            onZoom={(zoom) => setCam((c) => ({ ...c, zoom }))}
            clipView={() => ({ view: { wide, cam, others }, full, frame: frameWin ?? [r.from, r.to] })}
          />
        )}
        {/* tempo de luta sempre; no trecho de uma morte/falha, também quanto falta para ela */}
        {!full && <span className="small num muted replay-fight-time" title={t.fightTime}>{mmss(now)}</span>}
        <span className={`small num replay-clock ${after && !full ? 'bad' : 'muted'}`}>{clock}</span>
        {(view.floor || full) && (
          <button className={`btn sm ghost ${wide ? 'pressed' : ''}`} aria-pressed={wide} onClick={toggleWide} title={wide ? t.zoomFocus : t.zoomArena} aria-label={wide ? t.zoomFocus : t.zoomArena}>
            {wide ? <Minimize2 size={14} strokeWidth={1.75} aria-hidden /> : <Maximize2 size={14} strokeWidth={1.75} aria-hidden />}
          </button>
        )}
        <SpeedMenu speeds={full ? FULL_SPEEDS : SPEEDS} speed={speed} onChange={setSpeed} />
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
        </span>
      </div>
      </div>
      <div className="replay-panels">
        {(groundKinds.length > 0 || legendExtra || full) && (
          <div className="replay-filters">
            {groundKinds.length > 0 && (
              <MapFilter
                icon={<CircleDot size={14} strokeWidth={1.75} aria-hidden />}
                label={t.onGround}
                items={groundKinds.map((k) => ({ key: data.groundKinds[k].key, spellId: data.groundKinds[k].spellId, name: data.groundKinds[k].name, color: groundColor(k) }))}
                hidden={hiddenGround}
                onChange={(next) => {
                  prefs.setHiddenGround(next);
                  setHiddenGround(next);
                }}
              />
            )}
            {legendExtra}
            {(data.areas.length > 0 || data.orbs || zones.length > 0 || data.soaks.length > 0 || (data.blasts?.length ?? 0) > 0) && (
              <MapFilter
                icon={<Radius size={14} strokeWidth={1.75} aria-hidden />}
                label={t.areas}
                items={[
                  ...[...new Map((data.blasts ?? []).map((blast) => [blast.key, blast] as const)).values()].map((blast) => ({ key: 'blast:' + blast.key, spellId: blast.spellId, name: blast.name })),
                  ...data.areas.map((a, ai) => ({ key: a.key, spellId: a.spellId ?? undefined, name: a.name, color: areaColor(ai) })),
                  ...(data.orbs?.kinds ?? []).map((k, i) => ({ key: `orb:${i}`, name: t.orb(tr(k.name)), color: ORB_COLORS[i] ?? ORB_COLORS[1] })),
                  // soaks, um por mecânica
                  ...[...new Map(data.soaks.map((k) => [k.key, k] as const)).values()].map((k) => ({ key: `soak:${k.key}`, spellId: k.spellId, name: k.name })),
                  // defensivos de raid em área, um por spell
                  ...[...new Map(zones.map((z) => [z.spellId, z] as const)).values()].map((z) => ({ key: `def:${z.spellId}`, spellId: z.spellId, name: z.name })),
                ]}
                hidden={hiddenAreas}
                onChange={(next) => {
                  prefs.setHiddenAreas(next);
                  setHiddenAreas(next);
                }}
              />
            )}
            {full && (
              <button
                className={`btn sm ghost ${names ? 'pressed' : ''}`}
                aria-pressed={names}
                onClick={() => {
                  prefs.setShowNames(!names);
                  setNames(!names);
                }}
                title={names ? t.hideNames : t.showNames}
              >
                <Tag size={14} strokeWidth={1.75} aria-hidden /> {t.names}
              </button>
            )}
            {data.markers.length > 0 && (
              <button
                className={`btn sm ghost ${markersOn ? 'pressed' : ''}`}
                aria-pressed={markersOn}
                onClick={() => {
                  prefs.setShowMarkers(!markersOn);
                  setMarkersOn(!markersOn);
                }}
                title={markersOn ? t.hideMarkers : t.showMarkers}
              >
                <MapPin size={14} strokeWidth={1.75} aria-hidden /> {t.markers}
              </button>
            )}
          </div>
        )}
        {casters.length > 0 && !full && (
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
                        <SpellIcon spellId={c.spellId} size={16} title={t.castTitle(c.name, e.name, `${mmss(c.t)} · ${t.relTime(c.t - r.t)}`)} />
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
                    <span className="muted num">{mmss(c.t)} · {t.relTime(c.t - r.t)}</span>
                    <span className="muted">{bossName(c.guid)}</span>
                    <SpellName spellId={c.spellId} name={c.name} size={16} />
                    {c.interrupted && <span className="chip">{t.interrupted}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {shownGhosts.length > 0 && !full && (
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
        {hits && !full && (
          <div className="replay-feed">
            <span className="muted small">{t.hitsTitle}</span>
            {feed.length === 0 ? (
              <span className="muted small">{t.noHits}</span>
            ) : (
              <ul className="plain small">
                {feed.map((h, i) => (
                  <li key={`${h.t}-${i}`} className={h.cause ? 'cause' : ''}>
                    <span className="muted num">{mmss(h.t)} · {t.relTime(h.t - r.t)}</span>
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
