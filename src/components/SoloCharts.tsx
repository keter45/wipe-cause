import { useRef, useState } from 'react';
import { mmss, num } from '../lib/format';
import { BUCKET_MS } from '../lib/solo';

/**
 * Dano (ou cura) por segundo ao longo do pull, você × referência, em janelas de 5s. Os trechos em
 * que a referência abriu vantagem ficam destacados e numerados; passar o mouse mostra os valores.
 */
export function OutputChart({
  mine,
  ref,
  windows,
  unit,
  refLabel,
}: {
  mine: number[];
  ref: number[] | null;
  windows: { startMs: number; endMs: number }[];
  unit: string;
  refLabel: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(mine.length, ref?.length ?? 0);
  if (n < 2) return null;
  const perSec = (v: number) => v / (BUCKET_MS / 1000);
  const max = Math.max(1, ...mine.map(perSec), ...(ref ?? []).map(perSec)) * 1.08;
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => 100 - (perSec(v) / max) * 100;
  const line = (v: number[]) => v.map((d, i) => `${x(i)},${y(d)}`).join(' ');
  const minutes = Array.from({ length: Math.floor(((n - 1) * BUCKET_MS) / 60_000) }, (_, i) => (i + 1) * 60_000);
  const at = (ms: number) => `${Math.min(100, (ms / ((n - 1) * BUCKET_MS)) * 100)}%`;

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };

  return (
    <figure className="out-chart">
      <figcaption className="out-legend small">
        <span>
          <span className="out-key mine" aria-hidden /> Você
        </span>
        {ref && (
          <span>
            <span className="out-key ref" aria-hidden /> {refLabel}
          </span>
        )}
        <span className="muted">{unit} a cada 5s</span>
      </figcaption>
      <div className="out-plot">
        <div className="out-yaxis small muted" aria-hidden>
          <span>{num(max)}</span>
          <span>{num(max / 2)}</span>
          <span>0</span>
        </div>
        <div
          ref={box}
          className="out-area"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${unit} ao longo do pull: você e ${refLabel}. Trechos destacados: ${windows.map((w) => `${mmss(w.startMs)} a ${mmss(w.endMs)}`).join(', ')}.`}
        >
          {windows.map((w, i) => (
            <div key={i} className="out-band" style={{ left: at(w.startMs), width: `calc(${at(w.endMs)} - ${at(w.startMs)})` }}>
              <span className="out-band-n small">{i + 1}</span>
            </div>
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <line x1="0" x2="100" y1="50" y2="50" className="out-grid" vectorEffect="non-scaling-stroke" />
            {ref && <polyline points={line(ref)} className="out-line ref" vectorEffect="non-scaling-stroke" />}
            <polyline points={line(mine)} className="out-line mine" vectorEffect="non-scaling-stroke" />
          </svg>
          {hover != null && (
            <>
              <div className="out-cross" style={{ left: `${x(hover)}%` }} aria-hidden />
              <div className={`out-tip small ${x(hover) > 70 ? 'left' : ''}`} style={{ left: `${x(hover)}%` }}>
                <strong>
                  {mmss(hover * BUCKET_MS)}–{mmss((hover + 1) * BUCKET_MS)}
                </strong>
                <span>
                  <span className="out-key mine" aria-hidden /> Você: {num(perSec(mine[hover] ?? 0))}
                </span>
                {ref && (
                  <span>
                    <span className="out-key ref" aria-hidden /> {refLabel}: {num(perSec(ref[hover] ?? 0))}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="out-xaxis small muted" aria-hidden>
        <span style={{ left: 0 }}>0:00</span>
        {minutes.map((m) => (
          <span key={m} style={{ left: at(m) }}>
            {mmss(m)}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Linha pequena de uma série (pull a pull, noite a noite); o maior valor fica marcado. */
export function Sparkline({ values, labels, width = 120, height = 28 }: { values: number[]; labels: string[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values) || 1;
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 6) + 3, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const best = values.indexOf(max);
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={labels.map((l, i) => `${l}: ${num(values[i])}`).join('; ')}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} />
      {pts.map(([px, py], i) => (
        <circle key={i} cx={px} cy={py} r={i === best ? 4 : 2.5} className={i === best ? 'best' : ''}>
          <title>
            {labels[i]}: {num(values[i])}
          </title>
        </circle>
      ))}
    </svg>
  );
}
