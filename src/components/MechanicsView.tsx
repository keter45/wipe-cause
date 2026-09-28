import { useState } from 'react';
import type { MechanicResult, Pull } from '../types';
import { mmss, num, shortName } from '../lib/format';

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
  const clean = pull.mechanics.filter((m) => m.failures === 0 && m.evaluated);
  const notEvaluated = pull.mechanics.filter((m) => !m.evaluated);

  return (
    <div className="mechanics">
      {failed.length === 0 && <p className="muted pad">Nenhuma falha de mecânica detectada neste pull.</p>}
      {failed.map((m) => (
        <MechanicCard key={m.key} m={m} />
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

function MechanicCard({ m }: { m: MechanicResult }) {
  const [showEvents, setShowEvents] = useState(false);
  const blamed = m.players.filter((p) => !p.credit);
  const credits = m.players.filter((p) => p.credit);

  return (
    <section className={`mechanic finding ${m.severity === 'none' ? 'info' : m.severity}`}>
      <header className="mechanic-head">
        <span className="badge">{SEVERITY_LABEL[m.severity] ?? m.severity}</span>
        <strong>{m.name}</strong>
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
                <td className="muted">{p.firstT != null ? `1ª vez ${mmss(p.firstT)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {credits.length > 0 && (
        <p className="small">
          <span className="muted">{m.kind === 'interrupt' ? 'Cortaram: ' : 'Ajudaram: '}</span>
          {credits.map((p) => `${shortName(p.name)} (${p.count})`).join(', ')}
        </p>
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
                  {e.detail}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
