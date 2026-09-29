import { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { Pull } from '../types';
import { checkAssignments, parseAssignments, savedNote, saveNote } from '../lib/assignments';
import { mmss } from '../lib/format';
import { SpellName } from './SpellIcon';

/** Escala de interrupts do boss: colar a nota e ver, cast a cast, de quem era a vez. */
export function AssignmentsPanel({ pull }: { pull: Pull }) {
  const mechs = pull.mechanics.filter((m) => m.kind === 'interrupt' && (m.casts?.length ?? 0) > 0);
  const [note, setNote] = useState(() => savedNote(pull));
  const [editing, setEditing] = useState(false);
  const parsed = useMemo(() => parseAssignments(note, pull), [note, pull]);

  if (mechs.length === 0) return null;

  return (
    <section className="panel assignments">
      <header className="assign-head">
        <h3>
          <ClipboardList size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> Escala de interrupts
        </h3>
        <button className="btn ghost sm" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {editing ? 'Fechar' : note.trim() ? 'Editar escala' : 'Colar escala'}
        </button>
      </header>

      {editing && (
        <div className="assign-edit">
          <p className="muted small">
            Cole a nota do MRT/NSRT ou escreva uma linha por add, na ordem de quem corta: <code>{mechs[0].name}: Fulano, Ciclano, Beltrano</code>. A
            escala fica salva para este boss e vale para todos os pulls.
          </p>
          <textarea
            className="text-input"
            rows={6}
            value={note}
            spellCheck={false}
            placeholder={`${mechs[0].name}: Fulano, Ciclano, Beltrano\n${mechs[0].name}: Eternål, Zé`}
            onChange={(e) => {
              setNote(e.target.value);
              saveNote(pull, e.target.value);
            }}
          />
          <ul className="plain small">
            {mechs.map((m) => (
              <li key={m.key}>
                <strong>{m.name}</strong>:{' '}
                {parsed.get(m.key)?.map((g, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}add {i + 1}: {g.join(' → ')}
                  </span>
                )) ?? <span className="muted">nenhum player do raid reconhecido</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mechs.map((m) => {
        const groups = parsed.get(m.key);
        if (!groups?.length) {
          return !editing ? (
            <p key={m.key} className="muted small">
              Sem escala para <SpellName spellId={m.spellId} name={m.name} size={16} />: cole a nota para ver de quem era a vez em cada cast.
            </p>
          ) : null;
        }
        const { casts, kickers } = checkAssignments(m, groups);
        const missed = kickers.filter((k) => k.missed > 0);
        return (
          <div key={m.key} className="assign-mech">
            <h4 className="recap-title">
              <SpellName spellId={m.spellId} name={m.name} size={16} />
            </h4>
            {missed.length > 0 ? (
              <p className="small">
                <strong className="bad">Passou na vez de: </strong>
                {missed.map((k) => `${k.name} (${k.missed} de ${k.turns})`).join(', ')}
              </p>
            ) : (
              <p className="small ok-text">Ninguém da escala deixou passar.</p>
            )}
            <table className="players">
              <thead>
                <tr>
                  <th>Tempo</th>
                  <th>Add</th>
                  <th>Vez de</th>
                  <th>Cortou</th>
                </tr>
              </thead>
              <tbody>
                {casts.map((c, i) => (
                  <tr key={i}>
                    <td className="muted">{mmss(c.t)}</td>
                    <td className="muted">{c.source}</td>
                    <td>{c.assigned ?? <span className="muted">—</span>}</td>
                    <td className={!c.by ? 'bad' : c.by !== c.assigned ? 'warn' : ''}>
                      {c.by ?? 'passou'}
                      {c.by && c.assigned && c.by !== c.assigned && <span className="muted small"> (cobriu)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              {kickers.map((k) => `${k.name}: ${k.kept}/${k.turns} na vez${k.covered ? `, cobriu ${k.covered}` : ''}`).join(' · ')}
            </p>
          </div>
        );
      })}
    </section>
  );
}
