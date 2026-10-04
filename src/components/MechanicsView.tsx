import { useState } from 'react';
import { SlidersHorizontal, Star } from 'lucide-react';
import { RuleTuning, kindLabel } from './RuleTuning';
import { Colored, PlayerName } from './Names';
import type { MechanicResult, Pull } from '../types';
import { mmss, num } from '../lib/format';
import { useSeek } from '../lib/wcr';
import { PlayAt } from './VideoPanel';
import { SpellName } from './SpellIcon';
import { PositionMap, type Mark } from './PositionMap';
import { PullPhaseTimes } from './PhaseTimes';
import { tr, useMessages } from '../i18n';
import { mechMsg } from './MechanicsView.i18n';

/** `onRulesChanged`: os ajustes foram salvos; reanalisar o log aberto. */
export function MechanicsView({ pull, onRulesChanged }: { pull: Pull; onRulesChanged?: () => void }) {
  const t = useMessages(mechMsg);
  const [tuning, setTuning] = useState(false);
  if (tuning) return <RuleTuning pull={pull} onSaved={() => onRulesChanged?.()} onClose={() => setTuning(false)} />;
  const tuneButton = (
    <button className="btn sm" onClick={() => setTuning(true)}>
      <SlidersHorizontal size={14} strokeWidth={1.5} aria-hidden /> {t.tune}
    </button>
  );
  if (!pull.rulesFile) {
    return (
      <div className="pad">
        <p className="muted">{t.noRules(pull.encounterName)}</p>
        {tuneButton}
      </div>
    );
  }
  // fases cronometradas têm o próprio quadro (o tempo importa mesmo sem falha)
  const listed = pull.mechanics.filter((m) => m.kind !== 'phase_duration');
  const failed = listed.filter((m) => m.failures > 0);
  const classes = new Map(pull.players.map((x) => [x.guid, x.class] as const));
  const clean = listed.filter((m) => m.failures === 0 && m.evaluated);
  const notEvaluated = pull.mechanics.filter((m) => !m.evaluated);

  return (
    <div className="mechanics">
      <div className="mechanics-bar">
        {pull.mechanics.some((m) => m.tuned?.length || m.focus || m.custom) && <span className="muted small">{t.yourAdjustments}</span>}
        <span className="topbar-spacer" />
        {tuneButton}
      </div>
      {pull.cutoffT != null && (
        <p className="muted small">{t.cutoff(mmss(pull.cutoffT))}</p>
      )}
      <PullPhaseTimes pull={pull} />
      {failed.length === 0 && <p className="muted pad">{t.noFailures}</p>}
      {failed.map((m) => (
        <MechanicCard key={m.key} m={m} classes={classes} />
      ))}
      {clean.length > 0 && (
        <p className="muted small">{t.clean(clean.map((m) => m.name).join(', '))}</p>
      )}
      {notEvaluated.length > 0 && (
        <p className="muted small">{t.notEvaluated(notEvaluated.map((m) => m.name).join(', '))}</p>
      )}
      <p className="muted small">{t.rulesFile(pull.rulesFile)}</p>
    </div>
  );
}

function MechanicCard({ m, classes }: { m: MechanicResult; classes: Map<string, string | null> }) {
  const t = useMessages(mechMsg);
  const [showEvents, setShowEvents] = useState(false);
  const [snapIdx, setSnapIdx] = useState<number | null>(null);
  const snaps = m.snapshots ?? [];
  const seek = useSeek();
  const blamed = m.players.filter((p) => !p.credit);
  const credits = m.players.filter((p) => p.credit);

  return (
    <section className={`mechanic finding ${m.severity === 'none' ? 'info' : m.severity}`}>
      <header className="mechanic-head">
        <span className="badge">{t.severity[m.severity] ?? m.severity}</span>
        {m.focus && (
          <span className="focus-mark" title={t.focus}>
            <Star size={14} strokeWidth={1.75} fill="currentColor" aria-label={t.focusMark} />
          </span>
        )}
        <strong>
          <SpellName spellId={m.spellId} name={m.name} size={20} />
        </strong>
        <span className="muted small">{kindLabel(m.kind)}</span>
        {m.custom ? (
          <span className="chip mech">{t.yourRule}</span>
        ) : m.tuned?.length ? (
          <span className="chip mech" title={t.adjustedTitle(m.tuned.join(', '))}>
            {t.adjusted}
          </span>
        ) : null}
        <span className="mechanic-count">{m.failures}×</span>
      </header>
      {tr(m.summary) && (
        <p className="mechanic-summary">
          <Colored text={tr(m.summary)} />
        </p>
      )}
      {tr(m.tip) && <p className="muted small">{t.howToAvoid(tr(m.tip))}</p>}

      {blamed.length > 0 && (
        <table className="mechanic-players">
          <tbody>
            {blamed.map((p) => (
              <tr key={p.guid}>
                <td>
                  <PlayerName name={p.name} guid={p.guid} />
                </td>
                <td className="num">{m.kind === 'stack_limit' ? t.stacks(p.count) : `${p.count}×`}</td>
                <td className="num muted">{p.amount ? num(p.amount) : ''}</td>
                <td className="muted">
                  {p.firstT != null && (
                    <>
                      {t.firstTime(mmss(p.firstT))} <PlayAt t={p.firstT} seek={seek} />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {m.dispels && m.dispels.length > 0 && (
        <p className="small dispel-line">
          <span className="muted">{t.dispels}</span>
          {m.dispels.map((d, i) => (
            <span key={i} className={d.delayMs == null ? 'bad' : ''}>
              {i > 0 && ' · '}
              <PlayerName name={d.target} /> {d.delayMs == null ? t.noDispel : `${(d.delayMs / 1000).toFixed(1)}s`}
              {d.dispelledBy && (
                <span className="muted">
                  {' '}
                  (<PlayerName name={d.dispelledBy} />)
                </span>
              )}
            </span>
          ))}
        </p>
      )}
      {credits.length > 0 && (
        <p className="small">
          <span className="muted">{m.kind === 'interrupt' ? t.interrupted : m.kind === 'dispel' ? t.dispelled : t.helped}</span>
          {credits.map((p, i) => (
            <span key={p.guid}>
              {i > 0 && ', '}
              <PlayerName name={p.name} guid={p.guid} /> ({p.count})
            </span>
          ))}
        </p>
      )}
      {snaps.length > 0 && (
        <div className="mechanic-snaps">
          <span className="muted small">{t.positionsAt}</span>
          {snaps.map((sn, i) => (
            <button key={sn.t} className={`link small ${snapIdx === i ? 'active' : ''}`} onClick={() => setSnapIdx(snapIdx === i ? null : i)} aria-expanded={snapIdx === i}>
              {mmss(sn.t)}
            </button>
          ))}
        </div>
      )}
      {snapIdx != null && snaps[snapIdx] && (
        <div className="death-pos">
          <PositionMap snap={snaps[snapIdx]} classes={classes} marks={culpritMarks(m)} size={240} />
          <div className="death-pos-facts">
            <p className="small">
              {m.kind === 'failure_event' && blamed.length > 0 ? t.culpritRing : t.whereAtFailure} <PlayAt t={snaps[snapIdx].t} seek={seek} label={t.watchVideo} />
            </p>
            <p className="muted small">{t.mapHint}</p>
          </div>
        </div>
      )}
      {m.events.length > 0 && (
        <>
          <button className="link small" onClick={() => setShowEvents(!showEvents)}>
            {t.timeline(showEvents, m.events.length)}
          </button>
          {showEvents && (
            <ul className="plain small timeline">
              {m.events.map((e, i) => (
                <li key={i}>
                  <span className="muted">{mmss(e.t)}</span> {e.player ? (
                    <>
                      <PlayerName name={e.player} /> —{' '}
                    </>
                  ) : (
                    ''
                  )}
                  {tr(e.detail)} <PlayAt t={e.t} seek={seek} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Em failure_event os listados são os culpados (portadores): destaca no mapa. */
function culpritMarks(m: MechanicResult): Map<string, Mark> {
  if (m.kind !== 'failure_event') return new Map();
  return new Map(m.players.filter((p) => !p.credit).map((p) => [p.guid, 'culprit' as Mark]));
}
