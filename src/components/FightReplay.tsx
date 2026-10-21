import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, CircleUserRound, X, ZoomOut } from 'lucide-react';
import type { Pull, ReplayRef } from '../types';
import { classColor, mmss, num, shortName } from '../lib/format';
import { decodeReplay } from '../lib/replay';
import { aurasAt, bossHpAt, crucialAt, crucialSpells, deadAt, EV, eventsBetween, fightView, hpAt, mechanicLanes, meterAt, METERS, type FightEventView, type FightMarker, type FightView, type MeterKind } from '../lib/fight';
import { canLoadFull, fightOverlays, headBadge, loadFullPull } from '../lib/fullReplay';
import { nextCast, UPCOMING_MS } from '../lib/replayTimers';
import { useMessages } from '../i18n';
import * as prefs from '../lib/replayPrefs';
import { fightMsg } from './FightReplay.i18n';
import { MapFilter, ReplayView, usePlayback } from './ReplayView';
import { ClipPullContext } from './ClipButton';
import { SpellIcon, SpellName } from './SpellIcon';

/** Janela do painel do player focado: o que aconteceu com ele até o instante (ms). */
const FEED_WINDOW_MS = 15_000;
/** Clicar num marcador vai para um pouco antes dele (ms), para ver o que levou até ali. */
const MARKER_LEAD_MS = 3_000;
/** Marcas do eixo da linha do tempo (ms). */
/** Marcas do eixo: o menor passo que deixa até ~10 rótulos na janela. */
const AXIS_STEPS_MS = [5_000, 10_000, 15_000, 30_000, 60_000, 120_000];
const AXIS_MAX_TICKS = 10;
/** Zoom da linha do tempo: o menor trecho (ms) e quanto cada passo da roda aproxima. */
const ZOOM_MIN_MS = 15_000;
const ZOOM_STEP = 1.25;
/** Arrastar só começa depois disso (px): menos é clique. */
const PAN_SLOP_PX = 4;

type Filter = 'all' | 'damage' | 'heal' | 'cast' | 'other';

const ROLE_RANK: Record<string, number> = { tank: 0, healer: 1, dps: 2 };

/**
 * Replay completo do pull: o mapa da luta inteira, o quadro do raid, a linha do tempo com os
 * pontos de interesse e o que aconteceu com o player selecionado. Relê o pull no log do PC.
 */
export function FightReplay({ pull }: { pull: Pull }) {
  const t = useMessages(fightMsg);
  const canLoad = canLoadFull(pull);
  const [full, setFull] = useState<Pull | null>(pull.fight ? pull : null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!canLoad) return;
    let stale = false;
    setError(null);
    loadFullPull(pull)
      .then((p) => !stale && setFull(p))
      .catch((e) => !stale && setError(String(e)));
    return () => {
      stale = true;
    };
  }, [pull, tries]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canLoad) return <p className="muted pad">{t.noLog}</p>;
  if (error)
    return (
      <p className="pad">
        <span className="bad">{t.error(error)}</span>{' '}
        <button className="btn sm" onClick={() => setTries(tries + 1)}>
          {t.retry}
        </button>
      </p>
    );
  if (!full?.fight) return <p className="muted pad">{t.loading}</p>;
  return <FightReplayInner pull={full} />;
}

function FightReplayInner({ pull }: { pull: Pull }) {
  const data = useMemo(() => decodeReplay(pull), [pull]);
  const view = useMemo(() => fightView(pull)!, [pull]);
  const classes = useMemo(() => new Map(pull.players.map((p) => [p.guid, p.class] as const)), [pull]);
  const duration = pull.durationMs;
  const pb = usePlayback(0, duration, 0, false);
  const [selected, setSelected] = useState<string | null>(null);
  const replay = useMemo<ReplayRef>(() => ({ t: 0, from: 0, to: duration, focus: selected ? [selected] : [] }), [duration, selected]);
  // mortes, áreas, machados e defensivos em área (os mesmos do clipe)
  const { isDead, holders, unitHp, auraStacks, vacated, vanished, zones, cc, gateways } = useMemo(() => fightOverlays(pull, view, data), [pull, view, data]);
  // debuffs na cabeça: o usuário escolhe quais (os cruciais do pull, todos ligados no começo)
  const heads = useMemo(() => crucialSpells(view), [view]);
  const [hidden, setHidden] = useState<Set<number>>(() => prefs.hiddenHead(pull.encounterId));
  const setHeads = (next: Set<number>) => {
    prefs.setHiddenHead(pull.encounterId, next);
    setHidden(next);
  };
  const badge = useMemo(() => headBadge(view, hidden), [view, hidden]);
  const hp = selected != null && view.index.has(selected) ? view.data.hp[view.index.get(selected)!] : undefined;
  // janela da linha do tempo (e do slider): o pull inteiro, ou o trecho com zoom
  const [win, setWin] = useState<[number, number]>([0, duration]);
  useEffect(() => setWin([0, duration]), [duration]);
  // tocando, a janela acompanha o instante (vira a página quando ele sai dela)
  useEffect(() => {
    const [a, b] = win;
    if (!pb.playing || (pb.now >= a && pb.now <= b)) return;
    const w = b - a;
    const from = Math.min(Math.max(0, pb.now - w * 0.1), duration - w);
    setWin([from, from + w]);
  }, [pb.now, pb.playing, win, duration]);
  const seek = (tt: number, guid?: string) => {
    pb.setPlaying(false);
    pb.setNow(tt);
    // fora do trecho com zoom: a janela vai até lá
    if (tt < win[0] || tt > win[1]) {
      const w = win[1] - win[0];
      const from = Math.min(Math.max(0, tt - w / 2), duration - w);
      setWin([from, from + w]);
    }
    if (guid) setSelected(guid);
  };
  const toggle = (g: string) => setSelected((s) => (s === g ? null : g));

  // medidor aberto (como no Warcraft Logs: categorias no canto; clicar na vida de um boss abre o dano nele)
  const [meter, setMeter] = useState<MeterChoice | null>(null);
  const t = useMessages(fightMsg);
  // clipe da luta inteira: com o pull relido (as posições do pull todo)
  const clipCtx = useMemo(() => ({ pull, title: `Pull ${pull.pullNumber} · ${pull.encounterName}` }), [pull]);

  return (
    <div className="fight">
      <p className="small muted fight-beta">{t.beta}</p>
      <ClipPullContext.Provider value={clipCtx}>
      <ReplayView
        data={data}
        replay={replay}
        classes={classes}
        moment="failure"
        full
        autoplay={false}
        playback={pb}
        onSelect={setSelected}
        isDead={isDead}
        badge={badge}
        hp={hp}
        overlay={
          <>
            <BossBars pull={pull} view={view} now={pb.now} onPick={(name) => setMeter({ kind: 'done', target: name })} />
            <Meters view={view} pull={pull} now={pb.now} meter={meter} setMeter={setMeter} classes={classes} onSelect={setSelected} />
            <RaidFrames pull={pull} view={view} now={pb.now} selected={selected} onSelect={toggle} classes={classes} />
          </>
        }
        holders={holders}
        unitHp={unitHp}
        auraStacks={auraStacks}
        vacated={vacated}
        vanished={vanished}
        zones={zones}
        cc={cc}
        gateways={gateways}
        legendExtra={heads.length > 0 && <HeadLegend heads={heads} hidden={hidden} onChange={setHeads} />}
        range={win}
        belowMap={<FightTimeline pull={pull} view={view} now={pb.now} duration={duration} win={win} onWin={setWin} selected={selected} classes={classes} onSeek={seek} />}
      />
      </ClipPullContext.Provider>
      <FocusPanel pull={pull} view={view} now={pb.now} selected={selected} classes={classes} onClear={() => setSelected(null)} onSeek={seek} />
    </div>
  );
}

/** Debuffs cruciais do pull: quais aparecem na cabeça dos players. */
function HeadLegend({ heads, hidden, onChange }: { heads: { spellId: number; name: string }[]; hidden: Set<number>; onChange: (hidden: Set<number>) => void }) {
  const t = useMessages(fightMsg);
  return (
    <MapFilter
      icon={<CircleUserRound size={14} strokeWidth={1.75} aria-hidden />}
      label={t.onHead}
      items={heads.map((h) => ({ key: String(h.spellId), spellId: h.spellId, name: h.name }))}
      hidden={new Set([...hidden].map(String))}
      onChange={(next) => onChange(new Set([...next].map(Number)))}
    />
  );
}

interface MeterChoice {
  kind: MeterKind;
  /** dano feito só neste inimigo (clique na vida dele) */
  target?: string;
}

/** Quadro do raid (canto do mapa): vida, morto e debuff crucial de cada player; clicar seleciona. */
function RaidFrames({ pull, view, now, selected, onSelect, classes }: { pull: Pull; view: FightView; now: number; selected: string | null; onSelect: (g: string) => void; classes: Map<string, string | null> }) {
  const t = useMessages(fightMsg);
  const order = useMemo(() => [...pull.players].sort((a, b) => (ROLE_RANK[a.role ?? 'dps'] ?? 2) - (ROLE_RANK[b.role ?? 'dps'] ?? 2) || a.name.localeCompare(b.name)), [pull]);
  // recolhido: só um botão no canto (o mapa fica livre); o player selecionado continua no painel de baixo
  const [collapsed, setCollapsed] = useState(prefs.framesCollapsed);
  const toggle = () => {
    prefs.setFramesCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };
  const dead = order.filter((p) => deadAt(view, p.guid, now)).length;
  if (collapsed) {
    return (
      <button className="raid-frames-open fight-overlay btn sm ghost" onClick={toggle} aria-expanded={false} title={t.framesShow}>
        <ChevronUp size={14} strokeWidth={1.75} aria-hidden />
        {t.framesTitle}
        <span className="num muted">{t.framesAlive(order.length - dead, order.length)}</span>
      </button>
    );
  }
  return (
    <div className="raid-frames fight-overlay" role="group" aria-label={t.framesAria}>
      <button className="raid-frames-close btn sm ghost" onClick={toggle} aria-expanded title={t.framesHide} aria-label={t.framesHide}>
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
      </button>
      {order.map((p) => {
        const dead = deadAt(view, p.guid, now);
        const hp = dead ? 0 : (hpAt(view, p.guid, now) ?? 100);
        const crucial = dead ? null : crucialAt(view, p.guid, now);
        const color = classColor(classes.get(p.guid));
        return (
          <button key={p.guid} className={`raid-frame ${selected === p.guid ? 'selected' : ''} ${dead ? 'dead' : ''}`} onClick={() => onSelect(p.guid)} aria-pressed={selected === p.guid} title={`${shortName(p.name)} · ${dead ? t.dead : t.hp(hp)}`}>
            <span className="raid-frame-fill" style={{ width: `${hp}%`, background: color }} aria-hidden />
            <span className="raid-frame-name" style={{ color }}>
              {shortName(p.name)}
            </span>
            {crucial && (
              <span className="raid-frame-side">
                <span className="stacked-icon">
                  <SpellIcon spellId={crucial.spellId} size={14} title={crucial.mechanic?.name ?? crucial.name} />
                  {crucial.stacks > 1 && <span className="icon-stacks">{crucial.stacks}</span>}
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Vida dos bosses (canto do mapa), com o cast em andamento; clicar abre o dano que cada player deu nele. */
function BossBars({ pull, view, now, onPick }: { pull: Pull; view: FightView; now: number; onPick: (name: string) => void }) {
  const t = useMessages(fightMsg);
  // só os bosses do pull (a captura pega todo inimigo com vida de boss, inclusive os imunes)
  const known = new Set(pull.bosses.map((b) => b.guid));
  const bosses = (view.data.bosses ?? []).filter((b) => known.size === 0 || known.has(b.guid));
  if (bosses.length === 0) return null;
  return (
    <div className="fight-bosses fight-overlay">
      {bosses.map((b) => {
        const hp = bossHpAt(b, now);
        if (hp == null) return null;
        const cast = (pull.casts ?? []).find((c) => c.guid === b.guid && c.end != null && now >= c.t && now <= c.end && !c.interrupted);
        // o que vem depois (é replay: o próximo cast já está no log)
        const next = cast ? null : nextCast(pull.casts ?? [], b.guid, now, UPCOMING_MS);
        return (
          <div key={b.guid} className="fight-boss">
            <button className="fight-boss-bar" onClick={() => onPick(b.name)} title={t.bossTitle(b.name)}>
              <span className="fight-boss-fill" style={{ width: `${hp}%` }} aria-hidden />
              <span className="fight-boss-name">{b.name}</span>
              <span className="fight-boss-hp num">
                {num((b.maxHp * hp) / 100)} · {hp.toFixed(1)}%
              </span>
            </button>
            {cast && cast.end != null && (
              <div className="fight-boss-cast">
                <span className="fight-boss-cast-fill" style={{ width: `${((now - cast.t) / Math.max(1, cast.end - cast.t)) * 100}%` }} aria-hidden />
                <SpellName spellId={cast.spellId} name={cast.name} size={14} />
                <span className="num">{((cast.end - now) / 1000).toFixed(1)}s</span>
              </div>
            )}
            {next && (
              <div className="fight-boss-cast next" title={t.nextCastTitle(next.name)}>
                <SpellName spellId={next.spellId} name={next.name} size={14} />
                <span className="num">{t.nextIn(next.t - now)}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Medidores (canto do mapa): categorias; clique entra, botão direito (ou a seta) volta. */
function Meters({
  view,
  pull,
  now,
  meter,
  setMeter,
  classes,
  onSelect,
}: {
  view: FightView;
  pull: Pull;
  now: number;
  meter: MeterChoice | null;
  setMeter: (m: MeterChoice | null) => void;
  classes: Map<string, string | null>;
  onSelect: (guid: string) => void;
}) {
  const t = useMessages(fightMsg);
  const names = useMemo(() => new Map(pull.players.map((p) => [p.guid, shortName(p.name)] as const)), [pull]);
  const [collapsed, setCollapsed] = useState(prefs.metersCollapsed);
  const collapse = () => {
    prefs.setMetersCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };
  const back = (ev: React.MouseEvent) => {
    ev.preventDefault();
    setMeter(null);
  };
  // cabeçalho sempre visível: voltar (dentro de uma categoria), título e recolher/expandir
  const head = (
    <div className="fight-meters-head small">
      {meter && (
        <button className="link small" onClick={back} aria-label={t.back}>
          ‹
        </button>
      )}
      <span>{!meter ? t.categories : meter.target ? t.doneTo(meter.target) : t.meters[meter.kind]}</span>
      <button className="btn sm ghost fight-meters-collapse" onClick={collapse} aria-expanded={!collapsed} aria-label={collapsed ? t.expand : t.collapse} title={collapsed ? t.expand : t.collapse}>
        {collapsed ? <ChevronUp size={14} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={14} strokeWidth={1.75} aria-hidden />}
      </button>
    </div>
  );
  if (!meter || collapsed) {
    return (
      <div className={collapsed ? 'fight-meters fight-overlay collapsed' : 'fight-meters fight-overlay'} onContextMenu={meter ? back : (ev) => ev.preventDefault()}>
        {head}
        {!collapsed && (
          <ul className="plain">
            {METERS.map((k) => (
              <li key={k}>
                <button className="fight-meter-cat small" onClick={() => setMeter({ kind: k })}>
                  {t.meters[k]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const rows = meterAt(view, meter.kind, now, meter.target);
  const top = rows[0]?.amount ?? 1;
  const total = rows.reduce((s, r) => s + r.amount, 0) || 1;
  const secs = Math.max(1, now / 1000);
  return (
    <div className="fight-meters fight-overlay" onContextMenu={back} title={t.metersBack}>
      {head}
      {rows.length === 0 ? (
        <p className="muted small">{t.noRows}</p>
      ) : (
        <ul className="plain fight-meter-rows">
          {rows.map((r) => {
            const player = meter.kind !== 'takenBy';
            return (
              <li key={r.key}>
                <button className="fight-meter-row small" onClick={() => player && onSelect(r.key)} disabled={!player} title={`${player ? (names.get(r.key) ?? r.name) : r.name} · ${num(r.amount)}`}>
                  <span className="fight-meter-fill" style={{ width: `${(r.amount / top) * 100}%`, ...(player ? { background: classColor(classes.get(r.key)) } : {}) }} aria-hidden />
                  {player ? (
                    <span className="fight-meter-name" style={{ color: classColor(classes.get(r.key)) }}>
                      {names.get(r.key) ?? r.name}
                    </span>
                  ) : (
                    <span className="fight-meter-name">
                      <SpellName spellId={r.spellId} name={r.name} size={14} />
                    </span>
                  )}
                  <span className="fight-meter-num num">
                    {num(r.amount)} <span className="muted">({num(r.amount / secs)}, {Math.round((r.amount / total) * 100)}%)</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Linha do tempo do pull: fases, mortes, falhas graves (as menores só do selecionado) e frontais. */
function FightTimeline({
  pull,
  view,
  now,
  duration,
  win,
  onWin,
  selected,
  classes,
  onSeek,
}: {
  pull: Pull;
  view: FightView;
  now: number;
  duration: number;
  /** trecho mostrado (zoom) e como mudar */
  win: [number, number];
  onWin: (w: [number, number]) => void;
  selected: string | null;
  classes: Map<string, string | null>;
  onSeek: (t: number, guid?: string) => void;
}) {
  const t = useMessages(fightMsg);
  const [w0, w1] = win;
  const span = Math.max(1, w1 - w0);
  const pct = (tt: number) => `${Math.min(100, Math.max(0, ((tt - w0) / span) * 100))}%`;
  const inWin = (tt: number) => tt >= w0 && tt <= w1;
  const zoomed = w0 > 0 || w1 < duration;
  // roda do mouse: zoom em volta do cursor; Shift (ou roda de lado): anda para os lados. Listener nativo
  // para poder impedir a rolagem da página.
  const rootRef = useRef<HTMLDivElement>(null);
  const winRef = useRef(win);
  winRef.current = win;
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const track = el.querySelector('.fight-lane .fight-track') as HTMLElement | null;
      if (!track) return;
      e.preventDefault();
      const r = track.getBoundingClientRect();
      const [a, b] = winRef.current;
      const w = b - a;
      const pan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (pan) {
        const d = ((e.shiftKey ? e.deltaY : e.deltaX) / Math.max(1, r.width)) * w;
        const from = Math.min(Math.max(0, a + d), duration - w);
        onWin([from, from + w]);
        return;
      }
      const at = a + Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))) * w;
      const nw = Math.min(duration, Math.max(ZOOM_MIN_MS, e.deltaY < 0 ? w / ZOOM_STEP : w * ZOOM_STEP));
      const from = Math.min(Math.max(0, at - ((at - a) / w) * nw), duration - nw);
      onWin([from, from + nw]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [duration, onWin]);
  // segurar e arrastar (em qualquer faixa, com zoom): anda para os lados. Um clique sem arrastar
  // continua indo para o instante (ou para o marcador clicado).
  const dragged = useRef(false);
  const [panning, setPanning] = useState(false);
  const startPan = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!zoomed || ev.button !== 0) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const start = ev.clientX;
    const [a, b] = win;
    let moved = false;
    const move = (e: PointerEvent) => {
      if (!moved && Math.abs(e.clientX - start) < PAN_SLOP_PX) return;
      if (!moved) setPanning(true);
      moved = true;
      const d = ((start - e.clientX) / Math.max(1, r.width)) * (b - a);
      const from = Math.min(Math.max(0, a + d), duration - (b - a));
      onWin([from, from + (b - a)]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPanning(false);
      // o clique que vem logo depois do arrasto não conta
      dragged.current = moved;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const swallowClick = (e: React.MouseEvent) => {
    if (!dragged.current) return;
    dragged.current = false;
    e.stopPropagation();
    e.preventDefault();
  };
  const names = useMemo(() => new Map(pull.players.map((p) => [p.guid, shortName(p.name)] as const)), [pull]);
  const shown = (m: FightMarker) => m.kind !== 'failure' || m.severity === 'wipe' || m.severity === 'major' || (selected != null && m.guid === selected);
  const markers = view.markers.filter(shown);
  // uma faixa por mecânica (ou só a faixa das falhas, como antes)
  const lanes = useMemo(() => mechanicLanes(pull), [pull]);
  const [byMechanic, setByMechanic] = useState(prefs.mechanicLanes);
  const failed = lanes.reduce((n, l) => n + l.failures, 0);
  const lane = (kind: FightMarker['kind']) => markers.filter((m) => m.kind === kind && inWin(m.t));
  const phases = pull.phaseMarks ?? [];
  // a faixa fica mesmo sem nada no trecho com zoom (senão as faixas pulam)
  const has = new Set<string>([...markers.map((m) => m.kind), ...(phases.length ? ['phase'] : [])]);
  // clicar no trilho (fora de um marcador) vai para aquele instante
  const seekFromTrack = (ev: React.MouseEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    onSeek(w0 + ((ev.clientX - r.left) / Math.max(1, r.width)) * span);
  };
  const axis: number[] = [];
  const step = AXIS_STEPS_MS.find((s) => span / s <= AXIS_MAX_TICKS) ?? AXIS_STEPS_MS[AXIS_STEPS_MS.length - 1];
  for (let x = Math.ceil(w0 / step) * step || step; x < w1; x += step) if (x > w0) axis.push(x);
  const dim = (m: FightMarker) => selected != null && m.kind !== 'cast' && m.guid !== selected;
  const markerButton = (m: FightMarker, i: number) => {
    const who = m.guid ? (names.get(m.guid) ?? null) : null;
    const label = m.kind === 'death' ? t.diedTo(m.label) : m.label;
    return (
      <button
        key={`${m.kind}-${m.t}-${i}`}
        className={`fight-marker ${m.kind} ${m.severity ?? ''} ${dim(m) ? 'dim' : ''} ${m.guid && m.guid === selected ? 'mine' : ''}`}
        style={{ left: pct(m.t), ...(m.kind === 'death' && m.guid ? { color: classColor(classes.get(m.guid)) } : {}) }}
        title={t.markerTitle(mmss(m.t), label, who)}
        aria-label={t.markerTitle(mmss(m.t), label, who)}
        onClick={(ev) => {
          ev.stopPropagation();
          onSeek(Math.max(0, m.t - MARKER_LEAD_MS), m.guid);
        }}
      >
        {m.kind === 'death' ? '✕' : m.kind === 'failure' && m.spellId ? <SpellIcon spellId={m.spellId} size={14} hover={false} /> : null}
      </button>
    );
  };
  const rows: [string, React.ReactNode, string][] = [
    [
      t.lanes.phases,
      phases.filter((p, i) => p.t <= w1 && (phases[i + 1]?.t ?? duration) >= w0).map((p) => [p, phases.indexOf(p)] as const).map(([p, i]) => (
        <span key={p.key} className={`fight-phase ${i % 2 ? 'alt' : ''}`} style={{ left: pct(p.t), width: `calc(${pct(phases[i + 1]?.t ?? duration)} - ${pct(p.t)})` }} title={`${mmss(p.t)} · ${p.name}`}>
          {p.name}
        </span>
      )),
      'phase',
    ],
    [t.lanes.deaths, lane('death').map(markerButton), 'death'],
    // com as faixas por mecânica, as falhas e os frontais aparecem nelas
    ...(byMechanic ? [] : ([[t.lanes.failures, lane('failure').map(markerButton), 'failure'], [t.lanes.casts, lane('cast').map(markerButton), 'cast']] as [string, React.ReactNode, string][])),
  ];
  const toggleLanes = () => {
    prefs.setMechanicLanes(!byMechanic);
    setByMechanic(!byMechanic);
  };
  // gráfico dos orbs no chão: degraus no trecho mostrado (0 a 1000 na largura, 0 a 100 na altura)
  const seriesPath = (pts: [number, number][]) => {
    const max = Math.max(1, ...pts.map((p) => p[1]));
    const x = (tt: number) => Math.min(1000, Math.max(0, ((tt - w0) / span) * 1000));
    const y = (n: number) => 100 - (n / max) * 88;
    let d = 'M0,100';
    let last = 0;
    for (const [tt, n] of pts) {
      if (tt > w1) break;
      d += `L${x(tt).toFixed(1)},${y(last).toFixed(1)}L${x(tt).toFixed(1)},${y(n).toFixed(1)}`;
      last = n;
    }
    return `${d}L1000,${y(last).toFixed(1)}L1000,100Z`;
  };
  return (
    <div className={`fight-timeline ${zoomed ? 'pannable' : ''} ${panning ? 'panning' : ''}`} aria-label={t.timelineAria} role="group" ref={rootRef} onClickCapture={swallowClick}>
      <div className="fight-axis">
        {zoomed ? (
          <button className="btn sm ghost fight-zoom-reset" onClick={() => onWin([0, duration])} title={t.zoomReset} aria-label={t.zoomReset}>
            <ZoomOut size={13} strokeWidth={1.75} aria-hidden />
            <span className="num">{`${mmss(w0)}–${mmss(w1)}`}</span>
          </button>
        ) : (
          <span className="small muted fight-zoom-hint" title={t.zoomHint}>
            {t.zoomShort}
          </span>
        )}
        <div className="fight-track" aria-hidden onPointerDown={startPan}>
          {axis.map((x) => (
            <span key={x} className="fight-tick" style={{ left: pct(x) }}>
              {mmss(x)}
            </span>
          ))}
        </div>
      </div>
      {rows
        .filter(([, , kind]) => has.has(kind))
        .map(([label, items]) => (
          <div key={label} className="fight-lane">
            <span className="small muted">{label}</span>
            <div className="fight-track" onClick={seekFromTrack} onPointerDown={startPan}>
              {items}
              <span className="fight-now" style={{ left: pct(now) }} aria-hidden />
            </div>
          </div>
        ))}
      {lanes.length > 0 && (
        <div className="fight-lane fight-lanes-head">
          <button className="btn sm ghost fight-lanes-toggle" aria-expanded={byMechanic} onClick={toggleLanes} title={`${byMechanic ? t.lanesHide : t.lanesShow} · ${t.lanesKey}`}>
            {byMechanic ? <ChevronDown size={12} strokeWidth={1.75} aria-hidden /> : <ChevronRight size={12} strokeWidth={1.75} aria-hidden />}
            {t.lanes.mechanics}
            {!byMechanic && failed > 0 && <span className="num fight-lane-fails">{failed}</span>}
          </button>
          <span />
        </div>
      )}
      {/* as faixas rolam sozinhas: a linha do tempo não empurra o mapa para fora da tela */}
      {byMechanic && (
      <div className="fight-lanes">
      {lanes.map((l) => {
          const name = l.key === 'orbs' ? t.lanes.orbs : l.name;
          return (
            <div key={l.key} className="fight-lane mech">
              <span className="small muted fight-lane-label" title={name}>
                {l.spellId ? <SpellIcon spellId={l.spellId} size={12} hover={false} /> : null}
                <span className="fight-lane-name">{name}</span>
                {l.failures > 0 && <span className="num fight-lane-fails">{l.failures}</span>}
              </span>
              <div className="fight-track" onClick={seekFromTrack} onPointerDown={startPan}>
                {l.series && (
                  <svg className="fight-series" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
                    <path d={seriesPath(l.series)} />
                  </svg>
                )}
                {l.marks
                  .filter((m) => inWin(m.t))
                  .map((m, i) => {
                    const who = m.guid ? (names.get(m.guid) ?? null) : (m.label ?? null);
                    const label = t.markerTitle(mmss(m.t), m.ok ? name : `${name} · ${t.laneFailed}`, who);
                    return (
                      <button
                        key={`${m.t}-${i}`}
                        className={`fight-mark ${m.ok ? 'ok' : 'bad'} ${l.severity} ${selected != null && m.guid && m.guid !== selected ? 'dim' : ''} ${m.guid && m.guid === selected ? 'mine' : ''}`}
                        style={{ left: pct(m.t) }}
                        title={label}
                        aria-label={label}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSeek(Math.max(0, m.t - MARKER_LEAD_MS), m.guid);
                        }}
                      />
                    );
                  })}
                <span className="fight-now" style={{ left: pct(now) }} aria-hidden />
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

/** O player selecionado: vida, debuffs ativos, o que aconteceu com ele até o instante e os erros dele. */
function FocusPanel({
  pull,
  view,
  now,
  selected,
  classes,
  onClear,
  onSeek,
}: {
  pull: Pull;
  view: FightView;
  now: number;
  selected: string | null;
  classes: Map<string, string | null>;
  onClear: () => void;
  onSeek: (t: number, guid?: string) => void;
}) {
  const t = useMessages(fightMsg);
  const [filter, setFilter] = useState<Filter>('all');
  // defensivos: spells que aparecem como buff defensivo em alguém (o cast deles ganha destaque)
  const defensives = useMemo(() => new Set(view.data.auras.filter((a) => a[5] === 0).map((a) => a[1])), [view]);
  if (!selected) return <p className="muted small fight-focus-empty">{t.focusEmpty}</p>;
  const player = pull.players.find((p) => p.guid === selected);
  if (!player) return null;
  const color = classColor(classes.get(selected));
  const dead = deadAt(view, selected, now);
  const hp = dead ? 0 : (hpAt(view, selected, now) ?? 100);
  const auras = aurasAt(view, selected, now);
  const kindOf = (e: FightEventView): Filter => (e.kind === EV.damage ? 'damage' : e.kind === EV.heal ? 'heal' : e.kind === EV.cast ? 'cast' : 'other');
  const events = eventsBetween(view, selected, now - FEED_WINDOW_MS, now).filter((e) => filter === 'all' || kindOf(e) === filter);
  const marks = view.markers.filter((m) => m.guid === selected);
  return (
    <div className="fight-focus">
      <div className="fight-focus-side">
        <div className="fight-focus-head">
          <strong style={{ color }}>{shortName(player.name)}</strong>
          <span className="muted small">{dead ? t.dead : t.hp(hp)}</span>
          <button className="btn sm ghost" onClick={onClear} aria-label={t.clear} title={t.clear}>
            <X size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="fight-hpbar" aria-hidden>
          <span style={{ width: `${hp}%`, background: color }} />
        </div>
        <span className="muted small">{t.aurasTitle}</span>
        {auras.length === 0 ? (
          <p className="muted small">{t.noAuras}</p>
        ) : (
          <ul className="plain small fight-auras">
            {auras.map((a) => (
              <li key={`${a.spellId}-${a.from}`} className={a.mechanic ? 'crucial' : a.debuff ? '' : 'buff'}>
                <SpellName spellId={a.spellId} name={a.name} size={16} />
                {a.stacks > 1 && <span className="chip">{t.stacks(a.stacks)}</span>}
                {a.mechanic && <span className="chip bad">{a.mechanic.name}</span>}
                <span className="muted num">{t.remaining(a.to - now)}</span>
              </li>
            ))}
          </ul>
        )}
        <span className="muted small">{t.marksTitle}</span>
        {marks.length === 0 ? (
          <p className="muted small">{t.noMarks}</p>
        ) : (
          <ul className="plain small fight-marks">
            {marks.map((m, i) => (
              <li key={`${m.kind}-${m.t}-${i}`}>
                <button className="link small num" onClick={() => onSeek(Math.max(0, m.t - MARKER_LEAD_MS))}>
                  {mmss(m.t)}
                </button>
                {m.kind === 'death' ? <span className="bad">{t.diedTo(m.label)}</span> : <SpellName spellId={m.spellId} name={m.label} size={16} />}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="fight-feed">
        <div className="fight-feed-head">
          <span className="muted small">{t.eventsTitle(FEED_WINDOW_MS / 1000)}</span>
          <span className="fight-filters" role="group">
            {(Object.keys(t.filters) as Filter[]).map((f) => (
              <button key={f} className={`btn sm ghost ${filter === f ? 'pressed' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t.filters[f]}
              </button>
            ))}
          </span>
        </div>
        {events.length === 0 ? (
          <p className="muted small">{t.noEvents}</p>
        ) : (
          <ul className="plain small fight-events">
            {events.map((e, i) => (
              <EventRow key={`${e.t}-${i}`} e={e} now={now} defensive={e.kind === EV.cast && defensives.has(e.spellId)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EventRow({ e, now, defensive }: { e: FightEventView; now: number; defensive: boolean }) {
  const t = useMessages(fightMsg);
  const rel = Math.round((e.t - now) / 100) * 100;
  return (
    <li className={`fight-event k${e.kind} ${e.mechanic ? 'mech' : ''}`}>
      <span className="muted num">{mmss(e.t)} · {t.relTime(rel)}</span>
      <SpellName spellId={e.spellId} name={e.name} size={16} />
      {e.kind === EV.damage && <span className="num bad">-{num(e.amount)}</span>}
      {e.kind === EV.heal && <span className="num good">+{num(e.amount)}</span>}
      {e.kind === EV.interrupt && e.extra && <span>{t.interrupted(e.extra.name)}</span>}
      {e.kind === EV.dispel && e.extra && <span>{t.dispelled(e.extra.name, e.other)}</span>}
      {e.kind === EV.resurrect && <span>{t.resurrected(e.other)}</span>}
      {(e.kind === EV.damage || e.kind === EV.heal) && e.other && <span className="muted">{t.from(e.other)}</span>}
      {e.kind === EV.cast && e.other && <span className="muted">{t.on(e.other)}</span>}
      {e.mechanic && <span className="chip bad">{e.mechanic.name}</span>}
      {defensive && <span className="chip">{t.defensive}</span>}
    </li>
  );
}
