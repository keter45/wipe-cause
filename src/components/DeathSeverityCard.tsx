import { useMemo } from 'react';
import type { Pull } from '../types';
import { computeDeathSeverity, EVOLUTION_RULES, HEALTH_POTION_SPELL_ID, HEALTHSTONE_SPELL_ID, NIGHT_RULES, type ResourceKey, type SeverityRow } from '../lib/deathSeverity';
import { PlayerName } from './Names';
import { Hint } from './ui/Hint';
import { CollapseButton, useCollapsed } from './CollapsiblePanel';
import { SpellIcon } from './SpellIcon';
import { useMessages } from '../i18n';
import { deathSeverityMsg } from './DeathSeverityCard.i18n';

interface Props {
  pulls: Pull[];
  /** evolution: pulls de todas as noites do boss; night: pulls da noite */
  mode: 'evolution' | 'night';
}

/** Card "Gravidade das mortes: DPS": o que cada DPS ainda tinha livre ao morrer. Tudo impresso, nada depende de hover. */
export function DeathSeverityCard({ pulls, mode }: Props) {
  const t = useMessages(deathSeverityMsg);
  const rules = mode === 'evolution' ? EVOLUTION_RULES : NIGHT_RULES;
  // uma escolha para o resumo da noite e outra para a Evolução
  const [open, toggle] = useCollapsed(mode === 'evolution' ? 'trends.death-severity' : 'summary.death-severity');
  const result = useMemo(() => computeDeathSeverity(pulls, rules), [pulls, rules]);
  if (result.rows.length === 0) return null;

  return (
    <section className="panel sev-card">
      <header className="sev-head">
        <div>
          <h3>
            {t.title}
            <Hint>{mode === 'evolution' ? t.footEvolution(rules.minPulls, rules.dimBelow) : t.footNight(Math.round(rules.minPullsFrac * 100), rules.dimBelow)}</Hint>
          </h3>
          <p className="muted small">{t.subtitle}</p>
        </div>
        <span className="panel-head-actions">
          <CollapseButton open={open} onToggle={toggle} />
        </span>
      </header>
      {open && (
        <>
          <ul className="sev-legend">
            <li><span className="sev-dot sev-full" aria-hidden /> {t.legendFull}</li>
            <li><span className="sev-dot sev-partial" aria-hidden /> {t.legendPartial}</li>
            <li><span className="sev-dot sev-used" aria-hidden /> {t.legendUsed}</li>
          </ul>
          <div className="table-scroll">
            <table className="sev-table">
              <thead>
                <tr>
                  <th aria-hidden />
                  <th>{t.player}</th>
                  <th className="num">{t.pulls}</th>
                  <th className="num">{t.deaths}</th>
                  <th className="sev-how">{t.how}</th>
                  <th className="num">{t.allFree}</th>
                  <th>{t.freeOnDeath}</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <Row key={r.guid} row={r} rank={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Row({ row: r, rank }: { row: SeverityRow; rank: number }) {
  const t = useMessages(deathSeverityMsg);
  const dim = r.dim ? 'sev-dim' : '';
  return (
    <tr>
      <td className="sev-rank">{t.rank(rank)}</td>
      <td className="sev-player">
        <PlayerName name={r.name} guid={r.guid} cls={r.class} />
      </td>
      <td className="num">{r.pulls}</td>
      <td className="num">{r.deaths}</td>
      <td className={`sev-how ${dim}`}>
        <div className="sev-bar" role="img" aria-label={t.barLabel(r.full, r.partial, r.used)}>
          {r.full > 0 && <span className="sev-full" style={{ flexGrow: r.full }} />}
          {r.partial > 0 && <span className="sev-partial" style={{ flexGrow: r.partial }} />}
          {r.used > 0 && <span className="sev-used" style={{ flexGrow: r.used }} />}
        </div>
      </td>
      <td className={`num sev-pct ${dim}`}>{r.deaths ? `${Math.round(r.fullPct * 100)}%` : <span className="muted">—</span>}</td>
      <td>
        <div className="sev-slots">
          <Slot row={r} res="defensive" />
          <Slot row={r} res="healthstone" />
          <Slot row={r} res="potion" />
        </div>
      </td>
    </tr>
  );
}

function Slot({ row: r, res }: { row: SeverityRow; res: ResourceKey }) {
  const t = useMessages(deathSeverityMsg);
  const top = r.forgotten.includes(res);
  const n = r.free[res];
  const spellId = res === 'defensive' ? r.defensive?.spellId : res === 'healthstone' ? HEALTHSTONE_SPELL_ID : HEALTH_POTION_SPELL_ID;
  const label = res === 'defensive' ? r.defensive?.name ?? t.emptyDefensive : res === 'healthstone' ? t.healthstone : t.potion;
  // sem defensivo grande no kit: o slot continua ocupando o lugar
  if (spellId == null) {
    return (
      <span className="sev-slot" role="img" aria-label={label}>
        <span className="sev-ico sev-ico-empty" aria-hidden />
      </span>
    );
  }
  return (
    <span className={`sev-slot ${top ? 'sev-slot-hot' : 'sev-slot-cold'}`} role="img" aria-label={t.freeTimes(label, n)}>
      <span className="sev-ico">
        <SpellIcon spellId={spellId} size={22} title={label} />
      </span>
      <span className="sev-slot-n">{n}×</span>
    </span>
  );
}
