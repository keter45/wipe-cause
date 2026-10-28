import { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { Pull } from '../types';
import { checkAssignments, parseAssignments } from '../lib/assignments';
import { noteVersions, type NoteVersion } from '../lib/healNote';
import { NoteBox } from './NoteBox';
import { mmss } from '../lib/format';
import { SpellName } from './SpellIcon';
import { useMessages } from '../i18n';
import { assignMsg } from './AssignmentsPanel.i18n';

/** Escala de interrupts do boss: colar a nota e ver, cast a cast, de quem era a vez. */
export function AssignmentsPanel({ pull, nightPulls, live = false }: { pull: Pull; nightPulls: Pull[]; live?: boolean }) {
  const t = useMessages(assignMsg);
  const mechs = pull.mechanics.filter((m) => m.kind === 'interrupt' && (m.casts?.length ?? 0) > 0);
  const [versions, setVersions] = useState<NoteVersion[]>(() => noteVersions(pull));
  const note = versions[versions.length - 1]?.text ?? '';
  const [editing, setEditing] = useState(false);
  const parsed = useMemo(() => parseAssignments(note, pull), [note, pull]);

  if (mechs.length === 0) return null;

  return (
    <section className="panel assignments">
      <header className="assign-head">
        <h3>
          <ClipboardList size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> {t.title}
        </h3>
        <button className="btn ghost sm" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {editing ? t.close : note.trim() ? t.edit : t.paste}
        </button>
      </header>

      {editing && (
        <div className="assign-edit">
          <p className="muted small">{t.help(`${mechs[0].name}: ${t.names}`)}</p>
          <NoteBox
            pull={pull}
            nightPulls={nightPulls}
            live={live}
            versions={versions}
            onChange={setVersions}
            rows={6}
            placeholder={`${mechs[0].name}: ${t.names}\n${mechs[0].name}: ${t.names2}`}
          />
          <ul className="plain small">
            {mechs.map((m) => (
              <li key={m.key}>
                <strong>
                  <SpellName spellId={m.spellId} name={m.name} size={16} />
                </strong>
                :{' '}
                {parsed.get(m.key)?.map((g, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {t.add(i + 1)}: {g.join(' → ')}
                  </span>
                )) ?? <span className="muted">{t.noneRecognized}</span>}
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
              {t.noRoster(<SpellName spellId={m.spellId} name={m.name} size={16} />)}
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
                <strong className="bad">{t.missedTurn}</strong>
                {missed.map((k) => t.missedOf(k.name, k.missed, k.turns)).join(', ')}
              </p>
            ) : (
              <p className="small ok-text">{t.nobodyMissed}</p>
            )}
            <table className="players">
              <thead>
                <tr>
                  <th>{t.time}</th>
                  <th>Add</th>
                  <th>{t.turnOf}</th>
                  <th>{t.kicked}</th>
                </tr>
              </thead>
              <tbody>
                {casts.map((c, i) => (
                  <tr key={i}>
                    <td className="muted">{mmss(c.t)}</td>
                    <td className="muted">{c.source}</td>
                    <td>{c.assigned ?? <span className="muted">—</span>}</td>
                    <td className={!c.by ? 'bad' : c.by !== c.assigned ? 'warn' : ''}>
                      {c.by ?? t.passed}
                      {c.by && c.assigned && c.by !== c.assigned && <span className="muted small">{t.covered}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              {kickers.map((k) => t.kicker(k.name, k.kept, k.turns, k.covered)).join(' · ')}
            </p>
          </div>
        );
      })}
    </section>
  );
}
