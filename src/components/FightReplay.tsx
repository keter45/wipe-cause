import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, CircleUserRound, X } from 'lucide-react';
import type { Pull, ReplayRef } from '../types';
import { classColor, mmss, num, shortName } from '../lib/format';
import { decodeReplay } from '../lib/replay';
import { auraHolders, aurasAt, bossHpAt, crucialAt, crucialSpells, deadAt, EV, eventsBetween, fightView, hpAt, meterAt, METERS, vacatedAreas, vacatedSince, vanishedAreas, type FightEventView, type FightMarker, type FightView, type MeterKind } from '../lib/fight';
import { inTauri, loadFight } from '../lib/api';
import { useMessages } from '../i18n';
import * as prefs from '../lib/replayPrefs';
import { fightMsg } from './FightReplay.i18n';
import { MapFilter, ReplayView, usePlayback, type ZoneView } from './ReplayView';
import { SpellIcon, SpellName } from './SpellIcon';

/** Pulls já relidos nesta sessão (trocar de aba não relê o log). */
const cache = new Map<string, Pull>();

/** Janela do painel do player focado: o que aconteceu com ele até o instante (ms). */
const FEED_WINDOW_MS = 15_000;
/** Clicar num marcador vai para um pouco antes dele (ms), para ver o que levou até ali. */
const MARKER_LEAD_MS = 3_000;
/** Marcas do eixo da linha do tempo (ms). */
const AXIS_STEP_MS = 30_000;

type Filter = 'all' | 'damage' | 'heal' | 'cast' | 'other';

const ROLE_RANK: Record<string, number> = { tank: 0, healer: 1, dps: 2 };

/**
 * Replay completo do pull: o mapa da luta inteira, o quadro do raid, a linha do tempo com os
 * pontos de interesse e o que aconteceu com o player selecionado. Relê o pull no log do PC.
 */
export function FightReplay({ pull }: { pull: Pull }) {
  const t = useMessages(fightMsg);
  const key = `${pull.logFile ?? ''}:${pull.logOffset ?? ''}:${pull.startMs}`;
  const devFight = import.meta.env.DEV && !inTauri && new URLSearchParams(window.location.search).has('fight');
  const canLoad = devFight || (inTauri && !!pull.logFile && pull.logOffset != null);
  const [full, setFull] = useState<Pull | null>(() => cache.get(key) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!canLoad || full) return;
    let stale = false;
    setError(null);
    loadFight(pull)
      .then((p) => {
        cache.set(key, p);
        if (!stale) setFull(p);
      })
      .catch((e) => !stale && setError(String(e)));
    return () => {
      stale = true;
    };
  }, [key, tries]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const isDead = useCallback((g: string, tt: number) => deadAt(view, g, tt), [view]);
  // centros das áreas em volta de players: quem tem a aura no instante (e está vivo)
  const holders = useCallback((aura: number, tt: number) => auraHolders(view, aura, tt).filter((g) => !deadAt(view, g, tt)), [view]);
  // machados que alguém atravessou sem levar dano: já não estavam onde o replay estimava
  const vacatedMap = useMemo(() => vacatedAreas(view, data), [view, data]);
  const vacated = useCallback((g: string, tt: number) => vacatedSince(vacatedMap.get(g), tt), [vacatedMap]);
  // e os que sumiram (regra `vanish`: sem acertar ninguém por perto)
  const vanishedMap = useMemo(() => vanishedAreas(view, data), [view, data]);
  const vanished = useCallback((g: string, tt: number) => vacatedSince(vanishedMap.get(g), tt) != null, [vanishedMap]);
  // defensivos de raid em área (AMZ, Darkness, Spirit Link...)
  const zones = useMemo<ZoneView[]>(() => {
    const names = new Map(pull.players.map((p) => [p.guid, p.name] as const));
    return (view.data.zones ?? []).map((z) => {
      const caster = view.data.players[z.caster];
      // no mapa com o norte para cima, como o resto do replay
      return { ...z, x: -z.y, y: z.x, caster, casterName: names.get(caster) ?? caster, name: view.data.spells[z.spellId] ?? String(z.spellId) };
    });
  }, [view, pull]);
  // debuffs na cabeça: o usuário escolhe quais (os cruciais do pull, todos ligados no começo)
  const heads = useMemo(() => crucialSpells(view), [view]);
  const [hidden, setHidden] = useState<Set<number>>(() => prefs.hiddenHead(pull.encounterId));
  const setHeads = (next: Set<number>) => {
    prefs.setHiddenHead(pull.encounterId, next);
    setHidden(next);
  };
  const badge = useCallback(
    (g: string, tt: number) => {
      const a = crucialAt(view, g, tt, (id) => !hidden.has(id));
      return a ? { spellId: a.spellId, name: a.mechanic?.name ?? a.name, stacks: a.stacks } : null;
    },
    [view, hidden],
  );
  const hp = selected != null && view.index.has(selected) ? view.data.hp[view.index.get(selected)!] : undefined;
  const seek = (tt: number, guid?: string) => {
    pb.setPlaying(false);
    pb.setNow(tt);
    if (guid) setSelected(guid);
  };
  const toggle = (g: string) => setSelected((s) => (s === g ? null : g));

  // medidor aberto (como no Warcraft Logs: categorias no canto; clicar na vida de um boss abre o dano nele)
  const [meter, setMeter] = useState<MeterChoice | null>(null);
  const t = useMessages(fightMsg);

  return (
    <div className="fight">
      <p className="small muted fight-beta">{t.beta}</p>
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
        vacated={vacated}
        vanished={vanished}
        zones={zones}
        legendExtra={heads.length > 0 && <HeadLegend heads={heads} hidden={hidden} onChange={setHeads} />}
        belowMap={<FightTimeline pull={pull} view={view} now={pb.now} duration={duration} selected={selected} classes={classes} onSeek={seek} />}
      />
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
  return (
    <div className="raid-frames fight-overlay" role="group" aria-label={t.framesAria}>
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
  selected,
  classes,
  onSeek,
}: {
  pull: Pull;
  view: FightView;
  now: number;
  duration: number;
  selected: string | null;
  classes: Map<string, string | null>;
  onSeek: (t: number, guid?: string) => void;
}) {
  const t = useMessages(fightMsg);
  const pct = (tt: number) => `${Math.min(100, Math.max(0, (tt / Math.max(1, duration)) * 100))}%`;
  const names = useMemo(() => new Map(pull.players.map((p) => [p.guid, shortName(p.name)] as const)), [pull]);
  const shown = (m: FightMarker) => m.kind !== 'failure' || m.severity === 'wipe' || m.severity === 'major' || (selected != null && m.guid === selected);
  const markers = view.markers.filter(shown);
  const lane = (kind: FightMarker['kind']) => markers.filter((m) => m.kind === kind);
  const phases = pull.phaseMarks ?? [];
  // clicar no trilho (fora de um marcador) vai para aquele instante
  const seekFromTrack = (ev: React.MouseEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    onSeek(((ev.clientX - r.left) / Math.max(1, r.width)) * duration);
  };
  const axis: number[] = [];
  for (let x = AXIS_STEP_MS; x < duration; x += AXIS_STEP_MS) axis.push(x);
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
  const rows: [string, React.ReactNode][] = [
    [
      t.lanes.phases,
      phases.map((p, i) => (
        <span key={p.key} className={`fight-phase ${i % 2 ? 'alt' : ''}`} style={{ left: pct(p.t), width: `calc(${pct(phases[i + 1]?.t ?? duration)} - ${pct(p.t)})` }} title={`${mmss(p.t)} · ${p.name}`}>
          {p.name}
        </span>
      )),
    ],
    [t.lanes.deaths, lane('death').map(markerButton)],
    [t.lanes.failures, lane('failure').map(markerButton)],
    [t.lanes.casts, lane('cast').map(markerButton)],
  ];
  return (
    <div className="fight-timeline" aria-label={t.timelineAria} role="group">
      <div className="fight-axis" aria-hidden>
        <span />
        <div className="fight-track">
          {axis.map((x) => (
            <span key={x} className="fight-tick" style={{ left: pct(x) }}>
              {mmss(x)}
            </span>
          ))}
        </div>
      </div>
      {rows
        .filter(([, items]) => Array.isArray(items) && items.length > 0)
        .map(([label, items]) => (
          <div key={label} className="fight-lane">
            <span className="small muted">{label}</span>
            <div className="fight-track" onClick={seekFromTrack}>
              {items}
              <span className="fight-now" style={{ left: pct(now) }} aria-hidden />
            </div>
          </div>
        ))}
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
      <span className="muted num">{t.relTime(rel)}</span>
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
