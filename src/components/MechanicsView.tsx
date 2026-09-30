import { useState } from 'react';
import { SlidersHorizontal, Star } from 'lucide-react';
import { RuleTuning, KIND_LABEL } from './RuleTuning';
import { Colored, PlayerName } from './Names';
import type { MechanicResult, Pull } from '../types';
import { mmss, num } from '../lib/format';
import { useSeek } from '../lib/wcr';
import { PlayAt } from './VideoPanel';
import { SpellName } from './SpellIcon';
import { PositionMap, type Mark } from './PositionMap';

const SEVERITY_LABEL: Record<string, string> = { wipe: 'Causa', major: 'Grave', minor: 'Atenção', none: 'Info' };

/** `onRulesChanged`: os ajustes foram salvos; reanalisar o log aberto. */
export function MechanicsView({ pull, onRulesChanged }: { pull: Pull; onRulesChanged?: () => void }) {
  const [tuning, setTuning] = useState(false);
  if (tuning) return <RuleTuning pull={pull} onSaved={() => onRulesChanged?.()} onClose={() => setTuning(false)} />;
  const tuneButton = (
    <button className="btn sm" onClick={() => setTuning(true)}>
      <SlidersHorizontal size={14} strokeWidth={1.5} aria-hidden /> Ajustar regras deste boss
    </button>
  );
  if (!pull.rulesFile) {
    return (
      <div className="pad">
        <p className="muted">
          Ainda não há regras para <strong>{pull.encounterName}</strong>. Gere com a skill <code>boss-rules</code> a partir de um guia e dos
          spell IDs da aba “Habilidades do boss”.
        </p>
        {tuneButton}
      </div>
    );
  }
  const failed = pull.mechanics.filter((m) => m.failures > 0);
  const classes = new Map(pull.players.map((x) => [x.guid, x.class] as const));
  const clean = pull.mechanics.filter((m) => m.failures === 0 && m.evaluated);
  const notEvaluated = pull.mechanics.filter((m) => !m.evaluated);

  return (
    <div className="mechanics">
      <div className="mechanics-bar">
        {pull.mechanics.some((m) => m.tuned?.length || m.focus || m.custom) && <span className="muted small">Regras com ajustes seus.</span>}
        <span className="topbar-spacer" />
        {tuneButton}
      </div>
      {pull.cutoffT != null && (
        <p className="muted small">Contando só até a morte que fechou o corte ({mmss(pull.cutoffT)}); o que veio depois é ignorado.</p>
      )}
      {failed.length === 0 && <p className="muted pad">Nenhuma falha de mecânica detectada neste pull.</p>}
      {failed.map((m) => (
        <MechanicCard key={m.key} m={m} classes={classes} />
      ))}
      {clean.length > 0 && (
        <p className="muted small">
          Sem falhas: {clean.map((m) => m.name).join(', ')}
        </p>
      )}
      {notEvaluated.length > 0 && (
        <p className="muted small">
          Ainda não avaliadas automaticamente: {notEvaluated.map((m) => m.name).join(', ')}
        </p>
      )}
      <p className="muted small">Regras: {pull.rulesFile}</p>
    </div>
  );
}

function MechanicCard({ m, classes }: { m: MechanicResult; classes: Map<string, string | null> }) {
  const [showEvents, setShowEvents] = useState(false);
  const [snapIdx, setSnapIdx] = useState<number | null>(null);
  const snaps = m.snapshots ?? [];
  const seek = useSeek();
  const blamed = m.players.filter((p) => !p.credit);
  const credits = m.players.filter((p) => p.credit);

  return (
    <section className={`mechanic finding ${m.severity === 'none' ? 'info' : m.severity}`}>
      <header className="mechanic-head">
        <span className="badge">{SEVERITY_LABEL[m.severity] ?? m.severity}</span>
        {m.focus && (
          <span className="focus-mark" title="Foco da progressão">
            <Star size={14} strokeWidth={1.75} fill="currentColor" aria-label="Foco" />
          </span>
        )}
        <strong>
          <SpellName spellId={m.spellId} name={m.name} size={20} />
        </strong>
        <span className="muted small">{KIND_LABEL[m.kind] ?? m.kind}</span>
        {m.custom ? <span className="chip mech">sua regra</span> : m.tuned?.length ? <span className="chip mech" title={`Ajustado: ${m.tuned.join(', ')}`}>ajustada</span> : null}
        <span className="mechanic-count">{m.failures}×</span>
      </header>
      {m.summary && (
        <p className="mechanic-summary">
          <Colored text={m.summary} />
        </p>
      )}
      {m.tip && <p className="muted small">Como evitar: {m.tip}</p>}

      {blamed.length > 0 && (
        <table className="mechanic-players">
          <tbody>
            {blamed.map((p) => (
              <tr key={p.guid}>
                <td>
                  <PlayerName name={p.name} guid={p.guid} />
                </td>
                <td className="num">{m.kind === 'stack_limit' ? `${p.count} stacks` : `${p.count}×`}</td>
                <td className="num muted">{p.amount ? num(p.amount) : ''}</td>
                <td className="muted">
                  {p.firstT != null && (
                    <>
                      1ª vez {mmss(p.firstT)} <PlayAt t={p.firstT} seek={seek} />
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
          <span className="muted">Dispels: </span>
          {m.dispels.map((d, i) => (
            <span key={i} className={d.delayMs == null ? 'bad' : ''}>
              {i > 0 && ' · '}
              <PlayerName name={d.target} /> {d.delayMs == null ? 'sem dispel' : `${(d.delayMs / 1000).toFixed(1).replace('.', ',')}s`}
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
          <span className="muted">{m.kind === 'interrupt' ? 'Cortaram: ' : m.kind === 'dispel' ? 'Dispelaram: ' : 'Ajudaram: '}</span>
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
          <span className="muted small">Posições na falha:</span>
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
              {m.kind === 'failure_event' && blamed.length > 0
                ? 'Anel laranja: quem carregava o que explodiu.'
                : 'Onde cada um estava no instante da falha.'}{' '}
              <PlayAt t={snaps[snapIdx].t} seek={seek} label="ver no vídeo" />
            </p>
            <p className="muted small">Anéis a cada 10 jardas do boss. A orientação pode não bater com a do jogo; as distâncias batem.</p>
          </div>
        </div>
      )}
      {m.events.length > 0 && (
        <>
          <button className="link small" onClick={() => setShowEvents(!showEvents)}>
            {showEvents ? 'Esconder' : 'Ver'} linha do tempo ({m.events.length})
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
                  {e.detail} <PlayAt t={e.t} seek={seek} />
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
