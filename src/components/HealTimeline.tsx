import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { Anchors } from '../lib/cdAnchors';
import { mmss } from '../lib/format';
import { mapPhases } from '../lib/healNote';
import { stackLanes, type CdUse, type Gap, type NoteMark } from '../lib/healTimeline';
import { GAP_SHARE, STRONG_HIT_SHARE, trailingShare, type Hit } from '../lib/raidHits';
import { ZOOM_MIN_MS, useTimeWindow } from '../lib/useTimeWindow';
import type { PlayerStats, Pull } from '../types';
import { useMessages } from '../i18n';
import { healNoteMsg } from './HealNotePanel.i18n';
import { PlayerName } from './Names';
import { SpellIcon, SpellName } from './SpellIcon';

interface Props {
  pull: Pull;
  uses: CdUse[];
  marks: NoteMark[];
  gaps: Gap[];
  hits: Hit[];
  low: { start: number; end: number }[];
  bossCasts: Anchors;
  onReplay?: (ms: number) => void;
  focusAt?: number;
}

interface BossEntry {
  key: string;
  spellId: number;
  t: number;
  hit: boolean;
  size?: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const useKey = (u: CdUse) => `u:${u.player.guid}:${u.at}:${u.cd.id}`;
const markKey = (m: NoteMark) => `m:${m.guid}:${m.at}:${m.lineIndex}`;

/** Linha do tempo dos CDs de cura de um pull: dano da raide, golpes, buracos e uma faixa por player. */
export function HealTimeline({ pull, uses, marks, gaps, hits, low, bossCasts, onReplay, focusAt }: Props) {
  const t = useMessages(healNoteMsg);
  const duration = Math.max(1, pull.durationMs);
  const [win, setWin] = useState<[number, number]>([0, duration]);
  const [tip, setTip] = useState<{ id: string; left: number; content: ReactNode } | null>(null);
  const hasLife = !!pull.raidSeries?.low;

  useEffect(() => {
    setWin([0, duration]);
  }, [pull.id, duration]);

  useEffect(() => {
    if (focusAt == null) return;
    setWin(([a, b]) => {
      const w = Math.max(1, b - a);
      const nw = w >= duration ? Math.min(duration, Math.max(ZOOM_MIN_MS, 60_000)) : w;
      const from = Math.min(Math.max(0, focusAt - nw / 2), Math.max(0, duration - nw));
      return [from, from + nw];
    });
  }, [focusAt, pull.id, duration]);

  const { rootRef, startPan, panning, zoomed, swallowClick } = useTimeWindow({
    duration,
    win,
    onWin: setWin,
    measure: () => rootRef.current?.querySelector('.heal-tl-track') ?? null,
  });

  const [w0, w1] = win;
  const span = Math.max(1, w1 - w0);
  const xPct = (tt: number) => ((tt - w0) / span) * 100;
  const left = (tt: number) => `${xPct(tt)}%`;
  const width = (from: number, to: number) => `${((to - from) / span) * 100}%`;
  const visible = (from: number, to: number) => to >= w0 && from <= w1;

  const enemyNames = useMemo(() => new Map(pull.enemySpells.map((e) => [e.spellId, e.name] as const)), [pull]);
  const nameOf = (id: number) => enemyNames.get(id) ?? `#${id}`;
  const laneByUse = useMemo(() => stackLanes(uses), [uses]);

  const bossEntries = useMemo(() => {
    const casts: BossEntry[] = Object.entries(bossCasts).flatMap(([id, times]) =>
      times.map((tt, i) => ({ key: `c:${id}:${tt}:${i}`, spellId: Number(id), t: tt, hit: false })),
    );
    const strong: BossEntry[] = hits.flatMap((h, i) =>
      h.spellId == null ? [] : [{ key: `h:${h.spellId}:${h.start}:${i}`, spellId: h.spellId, t: h.start, hit: true, size: h.size }],
    );
    return [...casts, ...strong].sort((a, b) => a.t - b.t);
  }, [bossCasts, hits]);

  const order = useMemo(() => {
    const list = [
      ...uses.map((u) => ({ key: useKey(u), t: u.at })),
      ...marks.map((m) => ({ key: markKey(m), t: m.at })),
      ...bossEntries.map((e) => ({ key: e.key, t: e.t })),
    ];
    list.sort((a, b) => a.t - b.t);
    return new Map(list.map((e, i) => [e.key, i + 1] as const));
  }, [uses, marks, bossEntries]);

  const phases = useMemo(() => {
    const phOf = new Map<unknown, string>();
    for (const [ph, mark] of mapPhases(pull.phaseMarks)) phOf.set(mark, ph);
    return [...(pull.phaseMarks ?? [])]
      .sort((a, b) => a.t - b.t)
      .map((m) => ({ t: m.t, label: `P${phOf.get(m) ?? (m.key.match(/^p(\d+)$/i)?.[1] ?? m.key)}` }));
  }, [pull]);

  const curve = useMemo(() => {
    if (!hasLife) return { line: '', area: '', clipped: [] as number[] };
    const n = pull.raidSeries?.unavoidableK.length ?? 0;
    const from = Math.max(0, Math.floor(w0 / 1000));
    const to = Math.min(n - 1, Math.ceil(w1 / 1000));
    const points: { x: number; v: number }[] = [];
    for (let i = from; i <= to; i++) {
      const tt = i * 1000;
      const x = Math.min(1000, Math.max(0, ((tt - w0) / span) * 1000));
      points.push({ x, v: trailingShare(pull, i) });
    }
    if (!points.length) return { line: '', area: '', clipped: [] };
    const y = (v: number) => 100 - (Math.min(1.2, Math.max(0, v)) / 1.2) * 100;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const area = `${line}L${points[points.length - 1].x.toFixed(1)},100L${points[0].x.toFixed(1)},100Z`;
    const clipped: number[] = [];
    for (let i = 0; i < points.length; i++) if (points[i].v > 1.2 && !(i > 0 && points[i - 1].v > 1.2)) clipped.push(points[i].x);
    return { line, area, clipped };
  }, [hasLife, pull, w0, w1, span]);

  const playerMap = useMemo(() => new Map(pull.players.map((p) => [p.guid, p] as const)), [pull]);
  const usesByPlayer = new Map<string, CdUse[]>();
  for (const u of uses) (usesByPlayer.get(u.player.guid) ?? usesByPlayer.set(u.player.guid, []).get(u.player.guid)!).push(u);
  const marksByPlayer = new Map<string, NoteMark[]>();
  for (const m of marks) (marksByPlayer.get(m.guid) ?? marksByPlayer.set(m.guid, []).get(m.guid)!).push(m);
  const guids = new Set([...usesByPlayer.keys(), ...marksByPlayer.keys()]);
  const firstAt = (guid: string) =>
    Math.min(
      ...(usesByPlayer.get(guid) ?? []).map((u) => u.at),
      ...(marksByPlayer.get(guid) ?? []).map((m) => m.at),
    );
  const players = [...guids]
    .map((guid) => playerMap.get(guid))
    .filter((p): p is PlayerStats => !!p)
    .sort((a, b) => (a.role === 'healer' ? 0 : 1) - (b.role === 'healer' ? 0 : 1) || firstAt(a.guid) - firstAt(b.guid));

  const showTip = (id: string, at: number, content: ReactNode) => setTip({ id, left: xPct(at), content });
  const tipIn = (id: string) =>
    tip?.id === id ? (
      <div className="heal-tl-tip" style={{ left: `${Math.max(0, Math.min(100, tip.left))}%`, bottom: '100%' }}>
        {tip.content}
      </div>
    ) : null;

  const gapCols = (numbered: boolean) =>
    gaps.map((g, i) => {
      if (!visible(g.start, g.end)) return null;
      const from = Math.max(g.start, w0);
      const to = Math.min(g.end, w1);
      return (
        <span
          key={`g-${g.start}`}
          className="heal-tl-gap hoverable"
          style={{ left: left(from), width: width(from, to) }}
          onMouseEnter={() =>
            showTip(
              'gap',
              (from + to) / 2,
              <>
                <span className="bad">{t.tlGapTip(i + 1, pct(g.peak))}</span>
                {g.free.length > 0 && (
                  <>
                    <span className="muted">{t.tlFree}</span>
                    {g.free.map(({ player, cd }) => (
                      <span key={`${player.guid}:${cd.id}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <SpellName spellId={cd.id} name={cd.name} size={14} />
                        <PlayerName name={player.name} guid={player.guid} cls={player.class} />
                      </span>
                    ))}
                  </>
                )}
              </>,
            )
          }
        >
          {numbered && <span className="heal-tl-gap-n">{i + 1}</span>}
        </span>
      );
    });

  const seek = (ev: React.MouseEvent, at: number) => {
    ev.stopPropagation();
    onReplay?.(at);
  };

  const useLabel = (u: CdUse) => {
    const who = `${u.player.name} · ${mmss(u.at)}`;
    const oh = u.overheal;
    return `${u.cd.name} · ${who}${oh ? ` · ${t.tlUseTip(pct(oh.share), oh.ref ? t.refBand(pct(oh.ref.p25), pct(oh.ref.p75)) : '')}` : ''}${u.noDamage ? ` · ${t.noDamage}` : ''}${u.cycle ? ` · ${t.tlCycleLikely}` : ''}`;
  };

  return (
    <div className={`heal-tl ${zoomed ? 'pannable' : ''} ${panning ? 'panning' : ''}`} role="img" aria-label={t.tlAria(uses.length, gaps.length)} ref={rootRef} onClickCapture={swallowClick} onMouseLeave={() => setTip(null)}>
      <p className="small muted heal-tl-legend">
        {hasLife && (
          <span>
            <span className="heal-tl-swatch heal-tl-swatch-curve" aria-hidden />
            {t.tlLegend.dmg}
          </span>
        )}
        {hasLife && (
          <span>
            <span className="heal-tl-swatch heal-tl-swatch-low" aria-hidden />
            {t.tlLegend.low}
          </span>
        )}
        <span>
          <span className="heal-tl-swatch heal-tl-swatch-hit" aria-hidden />
          {t.tlLegend.hit}
        </span>
        <span>
          <span className="heal-tl-swatch heal-tl-swatch-useful" aria-hidden />
          {t.tlLegend.useful}
        </span>
        <span>
          <span className="heal-tl-swatch heal-tl-swatch-over" aria-hidden />
          {t.tlLegend.over}
        </span>
        <span>
          <span className="heal-tl-swatch heal-tl-swatch-mitig" aria-hidden />
          {t.tlLegend.mitig}
        </span>
        <span>
          <span className="heal-tl-swatch heal-tl-swatch-noheal" aria-hidden />
          {t.tlLegend.noheal}
        </span>
        {hasLife && (
          <span>
            <span className="heal-tl-swatch heal-tl-swatch-gap" aria-hidden />
            {t.tlLegend.gap}
          </span>
        )}
      </p>

      <div className="heal-tl-row">
        <span className="small muted heal-tl-label">{t.tlLegend.hit}</span>
        <div className="heal-tl-track" onPointerDown={startPan}>
          {gapCols(true)}
          <div className="heal-tl-boss">
            {bossEntries
              .filter((e) => e.t >= w0 && e.t <= w1)
              .map((e) => {
                const label = `${nameOf(e.spellId)}${e.hit ? ` · ${t.tlLegend.hit}` : ''}`;
                return (
                  <button
                    key={e.key}
                    type="button"
                    tabIndex={order.get(e.key)}
                    title={label}
                    aria-label={label}
                    onClick={(ev) => seek(ev, e.t)}
                    onMouseEnter={() => showTip('boss', e.t, <>{e.hit && <span className="bad">{t.tlLegend.hit}</span>}<SpellName spellId={e.spellId} name={nameOf(e.spellId)} size={14} /><span className="muted">{mmss(e.t)}</span></>)}
                    onFocus={() => showTip('boss', e.t, <SpellName spellId={e.spellId} name={nameOf(e.spellId)} size={14} />)}
                    onBlur={() => setTip(null)}
                    style={{
                      position: 'absolute',
                      left: left(e.t),
                      top: 1,
                      transform: 'translateX(-50%)',
                      padding: 0,
                      border: e.hit ? '1px solid var(--wipe)' : 0,
                      borderRadius: 3,
                      background: 'transparent',
                      lineHeight: 0,
                      cursor: onReplay ? 'pointer' : 'default',
                    }}
                  >
                    <SpellIcon spellId={e.spellId} size={e.hit ? 18 : 16} title={nameOf(e.spellId)} hover={false} />
                  </button>
                );
              })}
            {tipIn('boss')}
          </div>
          {tipIn('gap')}
        </div>
      </div>

      {hasLife && (
        <div className="heal-tl-row">
          <span className="small muted heal-tl-label">{t.tlLegend.dmg}</span>
          <div className="heal-tl-track" onPointerDown={startPan}>
            {gapCols(false)}
            <div className="heal-tl-curve">
              <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
                {curve.area && <path d={curve.area} fill="var(--accent)" opacity="0.28" />}
                <path d={curve.line} fill="none" stroke="var(--accent)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                <line x1="0" x2="1000" y1={100 - (GAP_SHARE / 1.2) * 100} y2={100 - (GAP_SHARE / 1.2) * 100} stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity="0.7" />
                <line x1="0" x2="1000" y1={100 - (STRONG_HIT_SHARE / 1.2) * 100} y2={100 - (STRONG_HIT_SHARE / 1.2) * 100} stroke="var(--muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.7" />
              </svg>
              {phases.filter((p) => p.t >= w0 && p.t <= w1).map((p) => (
                <span key={`${p.t}-${p.label}`} style={{ position: 'absolute', top: 0, bottom: 0, left: left(p.t), borderLeft: '1px solid var(--border)', fontSize: 10, color: 'var(--muted)', paddingLeft: 2, pointerEvents: 'none' }}>
                  {p.label}
                </span>
              ))}
              {curve.clipped.map((x) => (
                <span key={`c-${x}`} style={{ position: 'absolute', top: 0, left: `${(x / 1000) * 100}%`, transform: 'translateX(-50%)', color: 'var(--accent)', fontSize: 9, pointerEvents: 'none' }}>
                  ▲
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasLife && (
        <div className="heal-tl-row">
          <span className="small muted heal-tl-label">{t.tlLegend.low}</span>
          <div className="heal-tl-track" onPointerDown={startPan}>
            <div className="heal-tl-low">
              {gapCols(false)}
              {low.filter((e) => visible(e.start, e.end)).map((e) => {
                const from = Math.max(e.start, w0);
                const to = Math.min(e.end, w1);
                return <span key={`${e.start}-${e.end}`} style={{ position: 'absolute', top: 0, bottom: 0, left: left(from), width: width(from, to), background: 'var(--wipe)', opacity: 0.45, borderRadius: 2 }} />;
              })}
            </div>
          </div>
        </div>
      )}

      {players.map((p) => {
        const mine = [...(usesByPlayer.get(p.guid) ?? [])].sort((a, b) => a.at - b.at);
        const myMarks = [...(marksByPlayer.get(p.guid) ?? [])].sort((a, b) => a.at - b.at);
        const laneCount = Math.max(1, ...mine.map((u) => (laneByUse.get(u) ?? 0) + 1));
        const id = `p-${p.guid}`;
        return (
          <div className="heal-tl-row" key={p.guid}>
            <span className="heal-tl-label small">
              <PlayerName name={p.name} guid={p.guid} cls={p.class} />
            </span>
            <div className="heal-tl-track" onPointerDown={startPan}>
              <div className="heal-tl-lane">
                {gapCols(false)}
                {Array.from({ length: laneCount }, (_, lane) => (
                  <div className="heal-tl-sub" key={lane}>
                    {lane === 0 &&
                      myMarks.map((m) => {
                        const matched = mine.find((u) => u.line?.lineIndex === m.lineIndex);
                        const label = `${t.state[m.state]}${matched ? ` · ${matched.cd.name}` : ''} · ${mmss(m.at)}`;
                        return (
                          <button
                            key={markKey(m)}
                            type="button"
                            className={`heal-tl-mark ${m.state}`}
                            style={{ left: left(m.at), border: 0, padding: 0 }}
                            tabIndex={order.get(markKey(m))}
                            title={label}
                            aria-label={label}
                            onClick={(ev) => seek(ev, m.useAt ?? m.at)}
                            onMouseEnter={() => showTip(id, m.at, <>{matched && <SpellName spellId={matched.cd.id} name={matched.cd.name} size={14} />}<PlayerName name={p.name} guid={p.guid} cls={p.class} /><span className="muted">{t.state[m.state]}{m.cycle ? ` · ${t.tlCycleLikely}` : ''}</span><span className="muted">{mmss(m.at)}</span></>)}
                            onFocus={() => showTip(id, m.at, <PlayerName name={p.name} guid={p.guid} cls={p.class} />)}
                            onBlur={() => setTip(null)}
                          />
                        );
                      })}
                    {lane === 0 &&
                      myMarks.flatMap((m) => {
                        if (m.useAt == null || m.useAt === m.at) return [];
                        const a = Math.min(m.at, m.useAt);
                        const b = Math.max(m.at, m.useAt);
                        return <span key={`l-${m.lineIndex}-${m.at}`} className="heal-tl-link" style={{ left: left(a), width: width(a, b) }} />;
                      })}
                    {mine
                      .filter((u) => (laneByUse.get(u) ?? 0) === lane)
                      .map((u) => {
                        const key = useKey(u);
                        const alert = !u.cycle && (u.noDamage || !!u.overheal?.high || u.stacked);
                        const tone = u.cycle
                          ? 'cycle'
                          : u.cd.kind === 'heal'
                            ? u.cd.heal_ids?.length
                              ? 'heal-tl-bar-useful'
                              : 'noheal'
                            : 'mitig';
                        const start = Math.max(u.at, w0);
                        const end = Math.min(u.end, w1);
                        if (end < w0 || u.at > w1) return null;
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`heal-tl-bar ${tone}`}
                            style={{ left: left(start), width: width(start, Math.max(end, start)), border: 0, padding: 0 }}
                            tabIndex={order.get(key)}
                            title={useLabel(u)}
                            aria-label={useLabel(u)}
                            onClick={(ev) => seek(ev, u.at)}
                            onMouseEnter={() => showTip(id, u.at, <><SpellName spellId={u.cd.id} name={u.cd.name} size={14} /><PlayerName name={p.name} guid={p.guid} cls={p.class} />{u.overheal && <span className={u.overheal.high ? 'bad' : ''}>{t.tlUseTip(pct(u.overheal.share), u.overheal.ref ? t.refBand(pct(u.overheal.ref.p25), pct(u.overheal.ref.p75)) : '')}</span>}{u.noDamage && <span className="bad">{t.noDamage}</span>}{u.cycle && <span className="muted">{t.tlCycleLikely}</span>}{u.stacked && <span className="bad">{t.stacked}</span>}<span className="muted">{mmss(u.at)}–{mmss(u.end)}</span></>)}
                            onFocus={() => showTip(id, u.at, <><SpellName spellId={u.cd.id} name={u.cd.name} size={14} /><PlayerName name={p.name} guid={p.guid} cls={p.class} /></>)}
                            onBlur={() => setTip(null)}
                          >
                            {!u.cycle && u.cd.kind === 'heal' && !!u.cd.heal_ids?.length && u.overheal && (
                              <span className="heal-tl-bar-over" style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${u.overheal.share * 100}%`, borderRadius: 3 }} />
                            )}
                            <span style={{ position: 'absolute', left: 1, top: '50%', transform: 'translateY(-50%)', lineHeight: 0 }}>
                              <SpellIcon spellId={u.cd.id} size={14} title={u.cd.name} hover={false} />
                            </span>
                            {alert && <TriangleAlert className="heal-tl-alert" size={11} strokeWidth={2} style={{ left: '50%' }} aria-hidden />}
                          </button>
                        );
                      })}
                  </div>
                ))}
                {tipIn(id)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
