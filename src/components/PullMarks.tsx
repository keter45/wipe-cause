import { useState } from 'react';
import { Flag, X } from 'lucide-react';
import type { Pull } from '../types';
import { classColor, shortName } from '../lib/format';
import { addMark, removeMark, useMarks } from '../lib/marks';

/**
 * Erros marcados à mão no pull (o que o log não prova: posição, bait, escala). Entram no
 * veredito e na nota como qualquer erro.
 */
export function PullMarks({ pull }: { pull: Pull }) {
  const marks = useMarks(pull);
  const [open, setOpen] = useState(false);
  const [guid, setGuid] = useState('');
  const [what, setWhat] = useState('');
  const [severity, setSeverity] = useState<'major' | 'minor'>('major');
  const players = [...pull.players].sort((a, b) => a.name.localeCompare(b.name));
  const classOf = new Map(pull.players.map((p) => [p.guid, p.class] as const));

  function submit() {
    const p = pull.players.find((x) => x.guid === guid);
    if (!p || !what.trim()) return;
    addMark(pull, { guid, name: p.name, what: what.trim(), severity });
    setWhat('');
    setOpen(false);
  }

  return (
    <div className="pull-marks">
      {marks.map((m) => (
        <span key={m.id} className={`mark-chip ${m.severity}`} title={m.severity === 'major' ? 'Erro grave (marcado à mão)' : 'Atenção (marcado à mão)'}>
          <Flag size={12} strokeWidth={1.75} aria-hidden />
          <span style={{ color: classColor(classOf.get(m.guid)) }}>{shortName(m.name)}</span>
          <span>{m.what}</span>
          <button className="icon-btn xs" onClick={() => removeMark(pull, m.id)} aria-label={`Remover marca de ${shortName(m.name)}`}>
            <X size={12} strokeWidth={1.75} aria-hidden />
          </button>
        </span>
      ))}
      {open ? (
        <span className="mark-form">
          <select className="select sm" value={guid} onChange={(e) => setGuid(e.target.value)} aria-label="Jogador">
            <option value="">Jogador…</option>
            {players.map((p) => (
              <option key={p.guid} value={p.guid}>
                {shortName(p.name)}
              </option>
            ))}
          </select>
          <input
            className="text-input sm"
            list="mark-mechanics"
            value={what}
            placeholder="o que errou (ex.: soakou o orb errado)"
            onChange={(e) => setWhat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <datalist id="mark-mechanics">
            {pull.mechanics.map((m) => (
              <option key={m.key} value={m.name} />
            ))}
          </datalist>
          <select className="select sm" value={severity} onChange={(e) => setSeverity(e.target.value as 'major' | 'minor')} aria-label="Gravidade">
            <option value="major">Grave</option>
            <option value="minor">Atenção</option>
          </select>
          <button className="btn sm primary" onClick={submit} disabled={!guid || !what.trim()}>
            Marcar
          </button>
          <button className="btn sm" onClick={() => setOpen(false)}>
            Cancelar
          </button>
        </span>
      ) : (
        <button className="link small" onClick={() => setOpen(true)} title="Para o que o log não mostra: posição, bait, escala errada">
          <Flag size={12} strokeWidth={1.75} aria-hidden /> Marcar erro
        </button>
      )}
    </div>
  );
}
