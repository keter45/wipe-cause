import { useMemo } from 'react';
import type { Sample } from '../../lib/performance';
import { mmss, num } from '../../lib/format';
import { advantageWindows, castDiff, relevantSpells, takenMoreThan, timelineOf, type AdvantageWindow } from '../../lib/solo';
import { useSeek } from '../../lib/wcr';
import { PlayAt } from '../VideoPanel';
import { SpellIcon, SpellName } from '../SpellIcon';
import { OutputChart } from '../SoloCharts';
import { messagesOf, useMessages } from '../../i18n';
import { soloPullMsg } from '../SoloPullView.i18n';

// Comparação com uma referência (top do Warcraft Logs, alguém da raid ou você em outro pull): o
// dano ao longo do pull, os trechos em que a referência abriu vantagem e o dano tomado a mais.

/** Momento do pull: o horário sempre, e o ▶ quando o pull tem vídeo. */
function At({ t, seek }: { t: number; seek: ((t: number) => void) | null }) {
  return (
    <span className="solo-at small tabular">
      {mmss(t)}
      <PlayAt t={t} seek={seek} />
    </span>
  );
}

// ---- vantagem da referência

/** `casts`: mostrar os casts dos trechos (só faz sentido com a mesma spec). */
export function Advantage({ me, ref_, refLabel, unit, casts }: { me: Sample; ref_: Sample; refLabel: string; unit: string; casts: boolean }) {
  const [mine, ref] = [timelineOf(me.player), timelineOf(ref_.player)];
  const windows = useMemo(() => advantageWindows(me, ref_), [me, ref_]);
  const relevant = useMemo(() => relevantSpells(me.player, ref_.player), [me, ref_]);
  const t = messagesOf(soloPullMsg);
  if (!mine.length) return <p className="muted small">{t.oldAnalysis}</p>;
  if (!ref.length) return <p className="muted small">{t.refNoTimeline}</p>;
  return (
    <>
      <OutputChart mine={mine} ref={ref} windows={windows} unit={unit} refLabel={refLabel} />
      <p className="muted small">{t.alignedHint}</p>
      {windows.length === 0 ? (
        <p className="muted small">{t.neverAhead}</p>
      ) : (
        <div className="solo-windows">
          {windows.map((w, i) => (
            <WindowCard key={w.startMs} n={i + 1} w={w} unit={unit} relevant={relevant} casts={casts} />
          ))}
        </div>
      )}
    </>
  );
}

const LANE_MS = 15_000;
const ICON_GAP_PCT = 4.5;

function WindowCard({ n, w, unit, relevant, casts }: { n: number; w: AdvantageWindow; unit: string; relevant: Set<string>; casts: boolean }) {
  const seek = useSeek();
  const t = useMessages(soloPullMsg);
  const diff = casts ? castDiff(w, relevant) : [];
  const sec = (w.endMs - w.startMs) / 1000;
  return (
    <div className="solo-window">
      <div className="solo-window-head">
        <span className="out-band-n small">{n}</span>
        <strong>
          {mmss(w.startMs)}–{mmss(w.endMs)}
        </strong>
        <span className="muted small">{t.windowLine(num(w.ref / sec), num(w.mine / sec), unit)}</span>
        <At t={w.startMs} seek={seek} />
      </div>
      {w.deadAt != null && <p className="small bad">{t.youDied(mmss(w.deadAt))}</p>}
      {diff.length > 0 && (
        <p className="small">
          {t.refUsedMore}{' '}
          {diff.map((d, i) => (
            <span key={d.name} className="solo-diff">
              {i > 0 && ', '}
              <SpellName spellId={d.spellId} name={d.name} size={14} />{' '}
              <span className="muted">{t.timesVsYou(d.ref, d.mine)}</span>
            </span>
          ))}
        </p>
      )}
      {casts && (
        <>
          <Lane label={t.you} casts={w.myCasts} />
          <Lane label={t.reference} casts={w.refCasts} />
        </>
      )}
    </div>
  );
}

function Lane({ label, casts }: { label: string; casts: AdvantageWindow['myCasts'] }) {
  const rows: number[] = [];
  const placed = casts.map((c) => {
    const pos = (c.t / LANE_MS) * 100;
    let row = rows.findIndex((last) => pos - last >= ICON_GAP_PCT);
    if (row < 0) row = rows.push(pos) - 1;
    else rows[row] = pos;
    return { c, pos, row };
  });
  return (
    <div className="burst-lane">
      <span className="muted small burst-who">{label}</span>
      {casts.length ? (
        <ol className="burst-track" style={{ height: Math.max(1, rows.length) * 26 + 4 }} aria-label={`${label}: ${casts.map((c) => c.name).join(', ')}`}>
          {placed.map(({ c, pos, row }, i) => (
            <li key={i} style={{ left: `${pos}%`, top: row * 26 + 2 }} title={`${c.name} · +${(c.t / 1000).toFixed(1)}s`}>
              <SpellIcon spellId={c.spellId} size={22} />
            </li>
          ))}
        </ol>
      ) : (
        <span className="small warn">{messagesOf(soloPullMsg).noCasts}</span>
      )}
    </div>
  );
}

/** Habilidades do boss que pegaram mais em você que na referência (por minuto vivo). */
export function TakenMore({ me, ref_ }: { me: Sample; ref_: Sample }) {
  const t = useMessages(soloPullMsg);
  const taken = takenMoreThan(me, ref_);
  if (!taken.length) return null;
  return (
    <section className="perf-section">
      <h4>{t.takenMore}</h4>
      <div className="table-scroll">
        <table className="perf-table">
          <thead>
            <tr>
              <th>{t.ability}</th>
              <th className="num">{t.you}</th>
              <th className="num">{t.refShort}</th>
              <th className="num">{t.shareOfTaken}</th>
            </tr>
          </thead>
          <tbody>
            {taken.slice(0, 6).map((row) => (
              <tr key={row.name}>
                <td>
                  <SpellName spellId={row.spellId} name={row.name} size={16} />
                </td>
                <td className="num">{num(row.minePerMin)}</td>
                <td className="num muted">{num(row.refPerMin)}</td>
                <td className="num">{(row.share * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t.avoidableHint}</p>
    </section>
  );
}
