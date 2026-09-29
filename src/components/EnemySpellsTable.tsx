import { Fragment, useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { Pull } from '../types';
import { num } from '../lib/format';
import { rulesGet } from '../lib/rules';
import { SpellName } from './SpellIcon';
import { CreateRule } from './CreateRule';

/** IDs que alguma regra do boss (do app ou do usuário) já usa. */
function coveredIds(mechs: { detect?: Record<string, unknown> }[]): Set<number> {
  const out = new Set<number>();
  for (const m of mechs)
    for (const v of Object.values(m.detect ?? {})) {
      if (typeof v === 'number') out.add(v);
      if (Array.isArray(v)) v.forEach((x) => typeof x === 'number' && out.add(x));
    }
  return out;
}

export function EnemySpellsTable({ pull, onRulesChanged }: { pull: Pull; onRulesChanged?: () => void }) {
  const spells = pull.enemySpells;
  const [covered, setCovered] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    rulesGet(pull)
      .then((r) => alive && setCovered(coveredIds([...r.mechanics, ...(r.tuning?.custom ?? [])])))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pull]);

  if (spells.length === 0) return <p className="muted pad">Nenhuma habilidade inimiga registrada.</p>;
  return (
    <>
      <p className="muted small">
        Tudo o que os inimigos castaram ou que causou dano em players neste pull. Achou algo que as regras não pegam? Use <strong>+ criar regra</strong>
        para o app passar a apontar isso nos próximos pulls.
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
            <th />
          </tr>
        </thead>
        <tbody>
          {spells.map((s) => (
            <Fragment key={s.spellId}>
              <tr>
                <td>
                  <SpellName spellId={s.spellId} name={s.name} />
                </td>
                <td className="muted mono">{s.spellId}</td>
                <td className="muted">{s.sources.join(', ')}</td>
                <td className="num">{s.casts || ''}</td>
                <td className="num">{s.hitsOnPlayers || ''}</td>
                <td className="num">{s.damageToPlayers ? num(s.damageToPlayers) : ''}</td>
                <td className="num">
                  {covered.has(s.spellId) ? (
                    <span className="muted small rule-covered" title="Uma regra do boss já usa este spell">
                      <Check size={13} strokeWidth={2} aria-hidden /> tem regra
                    </span>
                  ) : (
                    <button className="link small" onClick={() => setCreating(creating === s.spellId ? null : s.spellId)} aria-expanded={creating === s.spellId}>
                      <Plus size={13} strokeWidth={2} aria-hidden /> criar regra
                    </button>
                  )}
                </td>
              </tr>
              {creating === s.spellId && (
                <tr className="create-rule-row">
                  <td colSpan={7}>
                    <CreateRule
                      pull={pull}
                      spell={s}
                      onCancel={() => setCreating(null)}
                      onSaved={() => {
                        setCreating(null);
                        setCovered((c) => new Set(c).add(s.spellId));
                        onRulesChanged?.();
                      }}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}
