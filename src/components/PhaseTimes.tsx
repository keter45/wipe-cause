import type { MechanicResult, Pull } from '../types';
import { mmss } from '../lib/format';
import { useSeek } from '../lib/wcr';
import { failedPhase, phaseLabel, phaseMechanics, phaseSec, phaseTone, phasesOfNight } from '../lib/phases';
import { SpellName } from './SpellIcon';
import { PlayAt } from './VideoPanel';
import { tr } from '../i18n';

const ordinal = (i: number) => `${i + 1}ª`;
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
        <span className="muted small">
          tempo da fase · bom até {secs(m.targetMs)}, lenta acima de {secs(m.maxMs)}
        </span>
      </header>
      <ol className="phase-rows">
        {windows.map((w, i) => {
          const s = phaseSec(w);
          const tone = phaseTone(w, m);
          return (
            <li key={w.start} className="phase-row">
              <span className="phase-n">{ordinal(i)}</span>
              <span className="muted small tabular">{mmss(w.start)}</span>
              <div className="phase-track" role="img" aria-label={`${ordinal(i)} vez: ${phaseLabel(w)}`}>
                {s != null && <div className={`phase-bar ${tone}`} style={{ width: at(s) }} />}
                {m.targetMs != null && <span className="phase-mark target" style={{ left: at(m.targetMs / 1000) }} title={`tempo bom: ${secs(m.targetMs)}`} />}
                {m.maxMs != null && <span className="phase-mark max" style={{ left: at(m.maxMs / 1000) }} title={`lenta acima de ${secs(m.maxMs)}`} />}
              </div>
              <strong className={`phase-time tabular ${tone}`}>{phaseLabel(w)}</strong>
              <span className="small phase-note">
                {failedPhase(w) ? (
                  <span className="bad">{w.wiped ? 'wipe na fase' : `${w.deaths} mortes na fase`}</span>
                ) : w.deaths ? (
                  <span className="warn">
                    {w.deaths} morte{w.deaths > 1 ? 's' : ''}
                  </span>
                ) : tone === 'good' ? (
                  <span className="good">no tempo</span>
                ) : tone === 'bad' ? (
                  <span className="bad">lenta</span>
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
              tempo de cada vez, pull a pull · bom até {secs(n.targetMs)}, lenta acima de {secs(n.maxMs)}
              {n.avg != null && ` · média da noite ${n.avg.toFixed(1).replace('.', ',').replace(/,0$/, '')}s`}
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
                  <th className="num">Média</th>
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
                          <td key={i} className={`num phase-cell ${phaseTone(w, n)}`} title={w.deaths ? `${w.deaths} morte(s) na fase` : undefined}>
                            {phaseLabel(w)}
                            {(w.deaths ?? 0) > 0 && <span className="small"> †{w.deaths}</span>}
                            {best && <span className="phase-best" aria-label="melhor da noite"> ★</span>}
                          </td>
                        );
                      })}
                      <td className="num">{avg != null ? `${avg.toFixed(1).replace('.', ',').replace(/,0$/, '')}s` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Verde no tempo bom, amarelo entre o bom e o máximo, vermelho lenta · ★ melhor da noite em cada vez · † mortes dentro da fase (3 ou mais = a
            mecânica deu errado, fica fora da média).
          </p>
        </section>
      ))}
    </>
  );
}
