import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { MechanicResult, PairFault, PairTrack } from '../types';
import { classColor, mmss, shortName } from '../lib/format';
import { useSeek } from '../lib/wcr';
import { useMessages } from '../i18n';
import { PlayerName } from './Names';
import { PlayAt } from './VideoPanel';
import { pairingMsg } from './PairingFaults.i18n';

type Classes = Map<string, string | null>;

/** Debuff de parear (Helical Toxins): cada encontro com soma errada, quem andou até quem e o replay. */
export function PairingFaults({ m, classes }: { m: MechanicResult; classes: Classes }) {
  const t = useMessages(pairingMsg);
  const faults = m.pairings ?? [];
  const [open, setOpen] = useState<number | null>(null);
  if (faults.length === 0) return null;
  return (
    <div className="pairings">
      <span className="muted small">{t.title}</span>
      <ul className="plain pairing-list">
        {faults.map((f, i) => (
          <li key={f.t} className={f.counted ? '' : 'harmless'}>
            <PairLine f={f} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
            {open === i && <PairReplayView f={f} classes={classes} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PairLine({ f, open, onToggle }: { f: PairFault; open: boolean; onToggle: () => void }) {
  const t = useMessages(pairingMsg);
  const seek = useSeek();
  const culprit = f.members.find((x) => x.guid === f.culprit);
  const others = f.members.filter((x) => x.guid !== f.culprit);
  const tag = f.over ? (f.broke === false ? `${t.over(f.target)} · ${t.overAlready}` : t.over(f.target)) : f.broke ? t.broke : f.broke === false ? t.harmless : t.unknownStacks;
  return (
    <div className="pairing-line">
      <div className="pairing-main">
        <span className="muted num">{mmss(f.t)}</span>
        <span className="pairing-sum">
          {f.members.map((x, i) => (
            <Fragment key={x.guid}>
              {i > 0 && ' + '}
              <PlayerName name={x.name} guid={x.guid} /> <span className="stack-pill">{x.before ?? '?'}</span>
            </Fragment>
          ))}{' '}
          = <span className={`stack-pill ${f.counted ? 'bad' : ''}`}>{f.sum}</span>
        </span>
        <span className={`chip ${f.counted ? 'bad' : ''}`}>{tag}</span>
      </div>
      <div className="pairing-why small" title={t.walkedTitle}>
        {culprit ? (
          <>
            <PlayerName name={culprit.name} guid={culprit.guid} /> {t.wentTo}{' '}
            {others.map((x, i) => (
              <Fragment key={x.guid}>
                {i > 0 && ' + '}
                <PlayerName name={x.name} guid={x.guid} />
              </Fragment>
            ))}{' '}
            <span className="muted">{t.approachPct(Math.round(culprit.share * 100))}</span>
          </>
        ) : (
          <span className="muted">{t.bothMoved}</span>
        )}
      </div>
      {f.members.some((x) => x.better) && (
        <div className="pairing-why small muted">
          {f.members
            .filter((x) => x.better)
            .map((x, i) => (
              <span key={x.guid}>
                {i > 0 && ' · '}
                <PlayerName name={x.name} guid={x.guid} /> {t.needed(x.better!.stacks)} <PlayerName name={x.better!.name} guid={x.better!.guid} /> {t.nearest(x.better!.distYd.toFixed(0))}
              </span>
            ))}
        </div>
      )}
      <div className="pairing-actions">
        {f.replay && (
          <button className="link small" onClick={onToggle} aria-expanded={open}>
            {t.replay(open)}
          </button>
        )}
        <PlayAt t={f.t} seek={seek} />
      </div>
    </div>
  );
}

const SIZE = 360;
const PAD = 14;
/** Menor área mostrada (jardas), para quem ficou parado não virar um ponto só. */
const MIN_SPAN = 40;
/** Abaixo disso (jardas) o par já está encostado: sem a linha da distância. */
const SHOW_GAP_YD = 3;
const SPEEDS = [0.5, 1, 2] as const;
/** Passo da animação (ms). */
const FRAME_MS = 33;
/** Trecho do caminho desenhado atrás de cada um (ms). */
const TRAIL_MS = 15_000;

/** Posição em `t`, em linha reta entre as amostras (fora delas, a mais perto). */
function posAt(tr: PairTrack, t: number): [number, number] | null {
  const p = tr.pts;
  if (p.length === 0) return null;
  if (t <= p[0][0]) return [p[0][1], p[0][2]];
  if (t >= p[p.length - 1][0]) return [p[p.length - 1][1], p[p.length - 1][2]];
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const [t0, x0, y0] = p[lo];
  const [t1, x1, y1] = p[hi];
  const k = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
}

/** Stacks em `t`: null = ainda sem o debuff; -1 = desconhecido; 0 = limpou. */
function stacksAt(tr: PairTrack, t: number): number | null {
  let v: number | null = null;
  for (const [st, n] of tr.stacks) {
    if (st > t) break;
    v = n;
  }
  return v;
}

function PairReplayView({ f, classes }: { f: PairFault; classes: Classes }) {
  const t = useMessages(pairingMsg);
  const r = f.replay!;
  const [now, setNow] = useState(r.from);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const [others, setOthers] = useState(true);
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

  // área: todo mundo que aparece no replay e os bosses
  const view = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const tr of r.tracks.filter((x) => x.focus)) {
      for (const [, x, y] of tr.pts) {
        xs.push(x);
        ys.push(y);
      }
    }
    if (xs.length === 0) return null;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const reach = Math.max(MIN_SPAN / 2, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2) * 1.08;
    const scale = (SIZE / 2 - PAD) / reach;
    const sx = (x: number) => SIZE / 2 + (x - cx) * scale;
    const sy = (y: number) => SIZE / 2 - (y - cy) * scale;
    // nome de boss só onde não cobre outro já escrito
    const placed: [number, number][] = [];
    const enemyLabels = r.enemies.map((e) => {
      const p: [number, number] = [sx(e.x), sy(e.y)];
      const label = !placed.some((q) => Math.abs(q[0] - p[0]) < 90 && Math.abs(q[1] - p[1]) < 14);
      if (label) placed.push(p);
      return { e, label };
    });
    return { sx, sy, enemyLabels };
  }, [r]);

  const focus = r.tracks.filter((tr) => tr.focus);
  if (focus.length === 0 || !view) return <p className="muted small">{t.noPositions}</p>;
  const { sx, sy, enemyLabels } = view;
  const color = (guid: string) => classColor(classes.get(guid));
  const label = (n: number | null) => (n == null ? '' : n === 0 ? '✓' : n < 0 ? '?' : String(n));
  const fp = focus.map((tr) => posAt(tr, now));
  const gap = fp.length === 2 && fp[0] && fp[1] ? Math.hypot(fp[0][0] - fp[1][0], fp[0][1] - fp[1][1]) : null;
  const touched = now >= f.t;
  const restart = () => {
    setNow(r.from);
    setPlaying(true);
  };

  return (
    <div className="pair-replay">
      <svg className="posmap pair-replay-map" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={t.aria(shortName(focus[0].name), shortName(focus[1]?.name ?? ''))}>
        {enemyLabels.map(({ e, label: show }) => (
          <g key={e.guid}>
            <rect x={sx(e.x) - 6} y={sy(e.y) - 6} width={12} height={12} transform={`rotate(45 ${sx(e.x)} ${sy(e.y)})`} className="posmap-enemy">
              <title>{e.name}</title>
            </rect>
            {show && (
              <text x={sx(e.x)} y={sy(e.y) - 11} className="posmap-label" textAnchor="middle">
                {e.name}
              </text>
            )}
          </g>
        ))}
        {others &&
          r.tracks
            .filter((tr) => !tr.focus)
            .map((tr) => {
              const p = posAt(tr, now);
              const n = stacksAt(tr, now);
              if (!p) return null;
              return (
                <g key={tr.guid} opacity={n == null || n === 0 ? 0.3 : 0.6}>
                  <circle cx={sx(p[0])} cy={sy(p[1])} r={6} fill={color(tr.guid)} className="posmap-player">
                    <title>{shortName(tr.name)}</title>
                  </circle>
                  <text x={sx(p[0])} y={sy(p[1]) + 3} className="pair-dot-num" textAnchor="middle">
                    {label(n)}
                  </text>
                </g>
              );
            })}
        {focus.map((tr) => {
          const path = tr.pts.filter(([pt]) => pt <= now && pt >= now - TRAIL_MS);
          const p = posAt(tr, now);
          const d = [...path.map(([, x, y]) => [sx(x), sy(y)]), ...(p ? [[sx(p[0]), sy(p[1])]] : [])];
          return d.length > 1 ? <polyline key={`trail-${tr.guid}`} points={d.map((q) => q.join(',')).join(' ')} fill="none" stroke={color(tr.guid)} strokeWidth={2} strokeOpacity={0.55} strokeLinejoin="round" /> : null;
        })}
        {gap != null && gap >= SHOW_GAP_YD && fp[0] && fp[1] && (
          <g>
            <line x1={sx(fp[0][0])} y1={sy(fp[0][1])} x2={sx(fp[1][0])} y2={sy(fp[1][1])} className="pair-gap" />
            <text x={(sx(fp[0][0]) + sx(fp[1][0])) / 2 + 8} y={(sy(fp[0][1]) + sy(fp[1][1])) / 2} className="posmap-label">
              {t.distance(gap.toFixed(0))}
            </text>
          </g>
        )}
        {focus.map((tr, i) => {
          const p = posAt(tr, now);
          if (!p) return null;
          const n = stacksAt(tr, now);
          // nomes para fora do par: o de cima em cima, o de baixo embaixo
          const other = fp[1 - i];
          const below = other ? sy(p[1]) >= sy(other[1]) : true;
          return (
            <g key={tr.guid}>
              {touched && <circle cx={sx(p[0])} cy={sy(p[1])} r={13} className="posmap-mark" style={{ stroke: f.counted ? 'var(--major)' : 'var(--muted)' }} />}
              <circle cx={sx(p[0])} cy={sy(p[1])} r={9} fill={color(tr.guid)} className="posmap-player" />
              <text x={sx(p[0])} y={sy(p[1]) + 4} className="pair-dot-num strong" textAnchor="middle">
                {label(n)}
              </text>
              <text x={sx(p[0])} y={below ? sy(p[1]) + 25 : sy(p[1]) - 17} className="posmap-label strong" textAnchor="middle" style={{ fill: color(tr.guid) }}>
                {shortName(tr.name)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="pair-replay-controls">
        <button className="btn sm" onClick={() => (now >= r.to ? restart() : setPlaying(!playing))} aria-label={playing ? t.pause : t.play}>
          {playing ? <Pause size={14} strokeWidth={1.75} aria-hidden /> : <Play size={14} strokeWidth={1.75} aria-hidden />}
        </button>
        <button className="btn sm ghost" onClick={restart} aria-label={t.restart} title={t.restart}>
          <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
        </button>
        <input
          type="range"
          min={r.from}
          max={r.to}
          step={50}
          value={now}
          aria-label={t.slider}
          aria-valuetext={t.toContact(Math.round((now - f.t) / 100) * 100)}
          onChange={(e) => {
            setPlaying(false);
            setNow(Number(e.target.value));
          }}
        />
        <span className={`small num pair-clock ${touched ? 'bad' : 'muted'}`}>{t.toContact(Math.round((now - f.t) / 100) * 100)}</span>
        <span className="pair-speeds" role="group" aria-label={t.speed}>
          {SPEEDS.map((s) => (
            <button key={s} className={`btn sm ghost ${speed === s ? 'pressed' : ''}`} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </span>
      </div>
      <label className="small muted pair-others">
        <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} /> {t.showOthers}
      </label>
      <p className="muted small">{t.legend}</p>
    </div>
  );
}
