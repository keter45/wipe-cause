import { useState } from 'react';
import type { MechanicResult, Pull } from '../types';
import { mmss, num, shortName } from '../lib/format';
import { useSeek } from '../lib/wcr';
import { PlayAt } from './VideoPanel';
import { SpellName } from './SpellIcon';
import { PositionMap, type Mark } from './PositionMap';

const SEVERITY_LABEL: Record<string, string> = { wipe: 'Causa', major: 'Grave', minor: 'Atenção', none: 'Info' };

const KIND_LABEL: Record<string, string> = {
  avoidable_damage: 'Dano evitável',
  stack_limit: 'Limite de stacks',
  soak: 'Soak',
  tank_soak: 'Soak de tank',
  interrupt: 'Interrupt',
  tank_range: 'Alcance do tank',
  positioning: 'Posicionamento',
  enrage: 'Enrage',
  failure_event: 'Falha do raid',
  dispel: 'Dispel',
  hp_balance: 'HP dos bosses',
  cc_required: 'CC',
  spread: 'Espalhar',
  add_kill: 'Matar adds',
  info: 'Info',
};

export function MechanicsView({ pull }: { pull: Pull }) {
  if (!pull.rulesFile) {
    return (
      <p className="muted pad">
        Ainda não há regras para <strong>{pull.encounterName}</strong>. Gere com a skill <code>boss-rules</code> a partir de um
        guia e dos spell IDs da aba “Habilidades do boss”.
      </p>
    );
  }
  const failed = pull.mechanics.filter((m) => m.failures > 0);
  const classes = new Map(pull.players.map((x) => [x.guid, x.class] as const));
  const clean = pull.mechanics.filter((m) => m.failures === 0 && m.evaluated);
  const notEvaluated = pull.mechanics.filter((m) => !m.evaluated);

  return (
    <div className="mechanics">
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
        <strong>
          <SpellName spellId={m.spellId} name={m.name} size={20} />
        </strong>
        <span className="muted small">{KIND_LABEL[m.kind] ?? m.kind}</span>
        <span className="mechanic-count">{m.failures}×</span>
      </header>
      {m.summary && <p className="mechanic-summary">{m.summary}</p>}
      {m.tip && <p className="muted small">Como evitar: {m.tip}</p>}

      {blamed.length > 0 && (
        <table className="mechanic-players">
          <tbody>
            {blamed.map((p) => (
              <tr key={p.guid}>
                <td>{shortName(p.name)}</td>
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
              {shortName(d.target)} {d.delayMs == null ? 'sem dispel' : `${(d.delayMs / 1000).toFixed(1).replace('.', ',')}s`}
              {d.dispelledBy && <span className="muted"> ({shortName(d.dispelledBy)})</span>}
            </span>
          ))}
        </p>
      )}
      {credits.length > 0 && (
        <p className="small">
          <span className="muted">{m.kind === 'interrupt' ? 'Cortaram: ' : m.kind === 'dispel' ? 'Dispelaram: ' : 'Ajudaram: '}</span>
          {credits.map((p) => `${shortName(p.name)} (${p.count})`).join(', ')}
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
                  <span className="muted">{mmss(e.t)}</span> {e.player ? `${shortName(e.player)} — ` : ''}
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
