import type { EnemySpell } from '../types';
import { num } from '../lib/format';

export function EnemySpellsTable({ spells }: { spells: EnemySpell[] }) {
  if (spells.length === 0) return <p className="muted pad">Nenhuma habilidade inimiga registrada.</p>;
  return (
    <>
      <p className="muted small">
        Tudo o que os inimigos castaram ou que causou dano em players neste pull. O spell ID é o que vai nas regras de boss
        (<code>encounters/*.yaml</code>).
      </p>
      <table className="spells">
        <thead>
          <tr>
            <th>Habilidade</th>
            <th>ID</th>
            <th>Origem</th>
            <th className="num">Casts</th>
            <th className="num">Hits em players</th>
            <th className="num">Dano em players</th>
          </tr>
        </thead>
        <tbody>
          {spells.map((s) => (
            <tr key={s.spellId}>
              <td>{s.name}</td>
              <td className="muted mono">{s.spellId}</td>
              <td className="muted">{s.sources.join(', ')}</td>
              <td className="num">{s.casts || ''}</td>
              <td className="num">{s.hitsOnPlayers || ''}</td>
              <td className="num">{s.damageToPlayers ? num(s.damageToPlayers) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
