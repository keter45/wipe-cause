import { useState } from 'react';
import type { PlayerStats, Pull } from '../types';
import { classColor, mmss, shortName } from '../lib/format';
import { SpellIcon, SpellName } from './SpellIcon';
import { AssignmentsPanel } from './AssignmentsPanel';

/** Casts interrompíveis (cortados ao menos uma vez no log) e quem cortou / quem não. */
export function InterruptsView({ pull }: { pull: Pull }) {
  const [open, setOpen] = useState<string | null>(null);
  const spells = pull.enemySpells.filter((e) => e.interruptible);
  const kickers = [...pull.players]
    .filter((p) => p.canInterrupt || p.interruptAttempts > 0)
    .sort((a, b) => b.interrupts - a.interrupts || a.name.localeCompare(b.name));
  const idle = kickers.filter((p) => p.interrupts === 0);

  if (spells.length === 0 && kickers.every((p) => p.interruptAttempts === 0)) {
    return <p className="muted pad">Nenhum cast interrompível neste pull.</p>;
  }

  return (
    <div className="interrupts">
      <AssignmentsPanel pull={pull} />
      {spells.length > 0 && (
        <table className="spells">
          <thead>
            <tr>
              <th>Cast inimigo</th>
              <th className="num">Cortados</th>
              <th className="num">Passaram</th>
              <th className="num">% cortado</th>
            </tr>
          </thead>
          <tbody>
            {spells.map((s) => {
              const total = s.interrupted + s.casts;
              return (
                <tr key={s.spellId}>
                  <td>
                    <SpellName spellId={s.spellId} name={s.name} /> <span className="muted small">({s.sources.join(', ')})</span>
                  </td>
                  <td className="num">{s.interrupted}</td>
                  <td className={`num ${s.casts ? 'bad' : ''}`}>{s.casts}</td>
                  <td className="num">{total ? Math.round((s.interrupted / total) * 100) : 0}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {idle.length > 0 && (
        <p className="recap-note">
          <strong className="bad">Não cortaram nada</strong> <span className="muted">(tinham interrupt):</span>{' '}
          {idle.map((p) => (
            <span key={p.guid} className="chip" style={{ color: classColor(p.class) }}>
              {shortName(p.name)}
              {p.interruptAttempts > 0 ? ` (${p.interruptAttempts} tentativa${p.interruptAttempts > 1 ? 's' : ''})` : ''}
            </span>
          ))}
        </p>
      )}

      <table className="players">
        <thead>
          <tr>
            <th>Jogador</th>
            <th className="num">Cortes</th>
            <th className="num">Tentativas</th>
            <th className="num">Perdidas</th>
          </tr>
        </thead>
        <tbody>
          {kickers.map((p) => (
            <KickerRow key={p.guid} p={p} open={open === p.guid} onToggle={() => setOpen(open === p.guid ? null : p.guid)} />
          ))}
        </tbody>
      </table>
      <p className="muted small">
        “Perdidas” = interrupt usado que não cortou nada (atrasado, alvo errado ou cast já cortado por outro).
      </p>
    </div>
  );
}

function KickerRow({ p, open, onToggle }: { p: PlayerStats; open: boolean; onToggle: () => void }) {
  const wasted = p.interruptAttempts - p.interrupts;
  return (
    <>
      <tr className="player-row" onClick={onToggle}>
        <td style={{ color: classColor(p.class) }}>{shortName(p.name)}</td>
        <td className={`num ${p.interrupts === 0 ? 'bad' : ''}`}>{p.interrupts}</td>
        <td className="num">{p.interruptAttempts}</td>
        <td className="num muted">{wasted || ''}</td>
      </tr>
      {open && p.interruptLog.length > 0 && (
        <tr className="player-detail">
          <td colSpan={4}>
            <ul className="plain small">
              {p.interruptLog.map((u, i) => (
                <li key={i}>
                  <span className="muted">{mmss(u.t)}</span> <SpellIcon spellId={u.spellId} size={16} /> {u.spell} →{' '}
                  {u.targetSpell ? (
                    <SpellName spellId={u.targetSpellId} name={u.targetSpell} size={16} />
                  ) : (
                    <span className="muted">não cortou nada</span>
                  )}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
