import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Footprints, SlidersHorizontal, Star } from 'lucide-react';
import { RuleTuning, kindLabel } from './RuleTuning';
import { Colored, PlayerName } from './Names';
import type { MechanicResult, Pull } from '../types';
import { mmss, num } from '../lib/format';
import { useSeek } from '../lib/wcr';
import { PlayAt } from './VideoPanel';
import { SpellName } from './SpellIcon';
import { PositionMap, type Mark } from './PositionMap';
import { PullPhaseTimes } from './PhaseTimes';
import { PairingFaults } from './PairingFaults';
import { ReplayView } from './ReplayView';
import { replayMsg } from './ReplayView.i18n';
import { decodeReplay, type ReplayData } from '../lib/replay';
import { tr, useMessages } from '../i18n';
import { mechMsg } from './MechanicsView.i18n';
import { Hint } from './ui/Hint';
import { Clamp } from './ui/Clamp';
import { mechanicMistakes } from '../lib/blame';

/** `onRulesChanged`: os ajustes foram salvos; reanalisar o log aberto. */
export function MechanicsView({ pull, onRulesChanged }: { pull: Pull; onRulesChanged?: () => void }) {
  const t = useMessages(mechMsg);
  const [tuning, setTuning] = useState(false);
  const data = useMemo(() => decodeReplay(pull), [pull]);
  // cards abertos (todos fechados por padrão; volta a fechar ao trocar de pull)
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  useEffect(() => setOpenKeys(new Set()), [pull]);
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
  const allOpen = failed.length > 0 && failed.every((m) => openKeys.has(m.key));
  const toggle = (key: string) =>
    setOpenKeys((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="mechanics">
      <div className="mechanics-bar">
        {pull.mechanics.some((m) => m.tuned?.length || m.focus || m.custom) && <span className="muted small">{t.yourAdjustments}</span>}
        <span className="topbar-spacer" />
        {failed.length > 1 && (
          <button className="btn sm ghost" onClick={() => setOpenKeys(allOpen ? new Set() : new Set(failed.map((m) => m.key)))} aria-pressed={allOpen}>
            {allOpen ? <ChevronsDownUp size={14} strokeWidth={1.5} aria-hidden /> : <ChevronsUpDown size={14} strokeWidth={1.5} aria-hidden />} {t.expandAll(allOpen)}
          </button>
        )}
        {tuneButton}
      </div>
      {pull.cutoffT != null && (
        <p className="muted small">{t.cutoff(mmss(pull.cutoffT))}</p>
      )}
      <PullPhaseTimes pull={pull} />
      {failed.length === 0 && <p className="muted pad">{t.noFailures}</p>}
      {failed.map((m) => (
        <MechanicCard key={m.key} m={m} classes={classes} data={data} expanded={openKeys.has(m.key)} onToggle={() => toggle(m.key)} />
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

/** Mecânicas em que o replay acompanha cada culpado (as outras têm um replay por falha). */
const PER_PLAYER = new Set(['avoidable_damage', 'positioning', 'tank_range', 'exclusive_auras', 'stack_limit']);

function MechanicCard({ m, classes, data, expanded, onToggle }: { m: MechanicResult; classes: Map<string, string | null>; data: ReplayData; expanded: boolean; onToggle: () => void }) {
  const t = useMessages(mechMsg);
  const rt = useMessages(replayMsg);
  // replay aberto: guid do culpado (por player) ou índice da falha
  const [open, setOpen] = useState<string | number | null>(null);
  const replays = data.units.size ? (m.replays ?? []) : [];
  const perPlayer = PER_PLAYER.has(m.kind);
  const playerReplay = (guid: string) => (perPlayer ? replays.find((r) => r.focus.length === 1 && r.focus[0] === guid) : undefined);
  const openReplay = typeof open === 'string' ? playerReplay(open) : typeof open === 'number' ? replays[open] : undefined;
  const moment = perPlayer ? 'hit' : 'failure';
  const [showEvents, setShowEvents] = useState(false);
  const [snapIdx, setSnapIdx] = useState<number | null>(null);
  const snaps = m.snapshots ?? [];
  const seek = useSeek();
  const blamed = m.players.filter((p) => !p.credit);
  const credits = m.players.filter((p) => p.credit);

  return (
    <section className={`mechanic finding ${m.severity === 'none' ? 'info' : m.severity} ${expanded ? 'open' : 'closed'}`}>
      {/* fechado: só o nome e quantas vezes; aberto: severidade, tipo e o resto do card */}
      <button className="mechanic-head mechanic-toggle" onClick={onToggle} aria-expanded={expanded}>
        <ChevronRight size={16} strokeWidth={1.75} className="mechanic-chevron" aria-hidden />
        <strong>
          <SpellName spellId={m.spellId} name={m.name} size={20} />
        </strong>
        {expanded && <span className="badge">{t.severity[m.severity] ?? m.severity}</span>}
        {m.focus && (
          <span className="focus-mark" title={t.focus}>
            <Star size={14} strokeWidth={1.75} fill="currentColor" aria-label={t.focusMark} />
          </span>
        )}
        {expanded && <span className="muted small">{kindLabel(m.kind)}</span>}
        {!expanded ? null : m.custom ? (
          <span className="chip mech">{t.yourRule}</span>
        ) : m.tuned?.length ? (
          <span className="chip mech" title={t.adjustedTitle(m.tuned.join(', '))}>
            {t.adjusted}
          </span>
        ) : null}
        <span className="mechanic-count">{mechanicMistakes(m)}×</span>
      </button>
      {expanded && (
        <div className="mechanic-body">
          {tr(m.summary) && (
            <p className="mechanic-summary">
              <Colored text={tr(m.summary)} />
            </p>
          )}
          {tr(m.tip) && (
            <p className="muted small">
              <Clamp>{t.howToAvoid(tr(m.tip))}</Clamp>
            </p>
          )}

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
                    <td>
                      {playerReplay(p.guid) && (
                        <button className={`link small replay-link ${open === p.guid ? 'active' : ''}`} onClick={() => setOpen(open === p.guid ? null : p.guid)} aria-expanded={open === p.guid}>
                          <Footprints size={13} strokeWidth={1.75} aria-hidden /> {rt.open(open === p.guid)}
                        </button>
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
          {openReplay && typeof open === 'string' && <ReplayView key={open} data={data} replay={openReplay} classes={classes} moment={moment} />}
          <PairingFaults m={m} classes={classes} data={data} />
          {!perPlayer && replays.length > 0 && (
            <div className="mechanic-snaps">
              <span className="muted small">{rt.replaysTitle}</span>
              {replays.map((r, i) => (
                <button key={r.t} className={`link small replay-link ${open === i ? 'active' : ''}`} onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  <Footprints size={13} strokeWidth={1.75} aria-hidden /> {mmss(r.t)}
                </button>
              ))}
            </div>
          )}
          {openReplay && typeof open === 'number' && <ReplayView key={open} data={data} replay={openReplay} classes={classes} moment={moment} />}
          {replays.length === 0 && !m.pairings?.length && snaps.length > 0 && (
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
                  {m.kind === 'failure_event' && blamed.length > 0 ? t.culpritRing : t.whereAtFailure} <Hint>{t.mapHint}</Hint> <PlayAt t={snaps[snapIdx].t} seek={seek} label={t.watchVideo} />
                </p>
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
        </div>
      )}
    </section>
  );
}

/** Em failure_event os listados são os culpados (portadores): destaca no mapa. */
function culpritMarks(m: MechanicResult): Map<string, Mark> {
  if (m.kind !== 'failure_event') return new Map();
  return new Map(m.players.filter((p) => !p.credit).map((p) => [p.guid, 'culprit' as Mark]));
}
