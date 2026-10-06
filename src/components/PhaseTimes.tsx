import type { MechanicResult, Pull } from '../types';
import { mmss } from '../lib/format';
import { useSeek } from '../lib/wcr';
import { failedPhase, phaseLabel, phaseMechanics, phaseSec, phaseTone, phasesOfNight } from '../lib/phases';
import { SpellName } from './SpellIcon';
import { PlayAt } from './VideoPanel';
import { intlLocale, messagesOf, tr, useMessages } from '../i18n';
import { phaseMsg } from './PhaseTimes.i18n';

const ordinal = (i: number) => messagesOf(phaseMsg).ordinal(i + 1);
const oneDecimal = (n: number) => n.toLocaleString(intlLocale(), { maximumFractionDigits: 1 });
const secs = (ms: number | undefined) => (ms != null ? `${Math.round(ms / 1000)}s` : '—');

/** Pull: cada vez que a fase aconteceu, com a duração numa barra contra o tempo bom e o máximo. */
export function PullPhaseTimes({ pull }: { pull: Pull }) {
  const ms = phaseMechanics(pull);
  if (!ms.length) return null;
  return (
    <>
      {ms.map((m) => (
        <PhaseCard key={m.key} m={m} />
      ))}
    </>
  );
}

function PhaseCard({ m }: { m: MechanicResult }) {
  const seek = useSeek();
  const t = useMessages(phaseMsg);
  const windows = m.phases ?? [];
  const longest = Math.max(...windows.map((w) => phaseSec(w) ?? 0), 0);
  // escala: um pouco além do máximo (ou da mais longa) para as marcas caberem
  const scale = Math.max(longest, (m.maxMs ?? 0) / 1000, (m.targetMs ?? 0) / 1000) * 1.15 || 1;
  const at = (s: number) => `${Math.min(100, (s / scale) * 100)}%`;
  return (
    <section className="phase-card">
      <header className="phase-head">
        <strong>
          <SpellName spellId={m.spellId} name={m.name} size={20} />
        </strong>
        <span className="muted small">{t.pullHead(secs(m.targetMs), secs(m.maxMs))}</span>
      </header>
      <ol className="phase-rows">
        {windows.map((w, i) => {
          const s = phaseSec(w);
          const tone = phaseTone(w, m);
          return (
            <li key={w.start} className="phase-row">
              <span className="phase-n">{ordinal(i)}</span>
              <span className="muted small tabular">{mmss(w.start)}</span>
              <div className="phase-track" role="img" aria-label={t.rowAria(ordinal(i), phaseLabel(w))}>
                {s != null && <div className={`phase-bar ${tone}`} style={{ width: at(s) }} />}
                {m.targetMs != null && <span className="phase-mark target" style={{ left: at(m.targetMs / 1000) }} title={t.goodTime(secs(m.targetMs))} />}
                {m.maxMs != null && <span className="phase-mark max" style={{ left: at(m.maxMs / 1000) }} title={t.slowAbove(secs(m.maxMs))} />}
              </div>
              <strong className={`phase-time tabular ${tone}`}>{phaseLabel(w)}</strong>
              <span className="small phase-note">
                {failedPhase(w) ? (
                  <span className="bad">{w.wiped ? t.wipeInPhase : t.deathsInPhase(w.deaths ?? 0)}</span>
                ) : w.deaths ? (
                  <span className="warn">{t.deaths(w.deaths)}</span>
                ) : tone === 'good' ? (
                  <span className="good">{t.onTime}</span>
                ) : tone === 'bad' ? (
                  <span className="bad">{t.slow}</span>
                ) : null}
              </span>
              <PlayAt t={w.start} seek={seek} />
            </li>
          );
        })}
      </ol>
      {tr(m.tip) && <p className="muted small">{tr(m.tip)}</p>}
    </section>
  );
}

/** Boss na noite: a fase pull a pull (1ª, 2ª, 3ª vez), o melhor de cada vez e a média. */
export function NightPhaseTimes({ pulls, onSelectPull }: { pulls: Pull[]; onSelectPull?: (id: number) => void }) {
  const t = useMessages(phaseMsg);
  const phases = phasesOfNight(pulls);
  if (!phases.length) return null;
  return (
    <>
      {phases.map((n) => (
        <section key={n.key} className="panel phase-night">
          <header className="phase-head">
            <strong>
              <SpellName spellId={n.spellId} name={n.name} size={20} />
            </strong>
            <span className="muted small">
              {t.nightHead(secs(n.targetMs), secs(n.maxMs))}
              {n.avg != null && t.nightAvg(oneDecimal(n.avg))}
            </span>
          </header>
          <div className="table-scroll">
            <table className="perf-table phase-table">
              <thead>
                <tr>
                  <th>Pull</th>
                  {Array.from({ length: n.slots }, (_, i) => (
                    <th key={i} className="num">
                      {ordinal(i)}
                    </th>
                  ))}
                  <th className="num">{t.avg}</th>
                </tr>
              </thead>
              <tbody>
                {n.pulls.map(({ pull, windows }) => {
                  const clean = windows.filter((w) => !failedPhase(w) && phaseSec(w) != null).map((w) => phaseSec(w)!);
                  const avg = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
                  return (
                    <tr
                      key={pull.id}
                      className={onSelectPull ? 'clickable' : ''}
                      onClick={() => onSelectPull?.(pull.id)}
                      tabIndex={onSelectPull ? 0 : undefined}
                      onKeyDown={(e) => e.key === 'Enter' && onSelectPull?.(pull.id)}
                    >
                      <td>
                        {pull.pullNumber} <span className={`small ${pull.success ? 'good' : 'muted'}`}>{pull.success ? 'kill' : 'wipe'}</span>
                      </td>
                      {Array.from({ length: n.slots }, (_, i) => {
                        const w = windows[i];
                        if (!w) return <td key={i} className="num muted">—</td>;
                        const best = n.best[i] != null && phaseSec(w) === n.best[i] && !failedPhase(w);
                        return (
                          <td key={i} className={`num phase-cell ${phaseTone(w, n)}`} title={w.deaths ? t.cellDeaths(w.deaths) : undefined}>
                            {phaseLabel(w)}
                            {(w.deaths ?? 0) > 0 && <span className="small"> †{w.deaths}</span>}
                            {best && <span className="phase-best" aria-label={t.bestOfNight}> ★</span>}
                          </td>
                        );
                      })}
                      <td className="num">{avg != null ? `${oneDecimal(avg)}s` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t.legend}</p>
        </section>
      ))}
    </>
  );
}
