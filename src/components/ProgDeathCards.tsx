import { useMemo } from 'react';
import type { Pull } from '../types';
import { computeProgDeaths, DECISIVE_TOP, MIN_PULLS, type DecisiveRow } from '../lib/progDeaths';
import { ROLE_LABEL } from '../lib/format';
import { PlayerName } from './Names';
import { CollapseButton, useCollapsed } from './CollapsiblePanel';
import { SpellName } from './SpellIcon';
import { useMessages } from '../i18n';
import { Hint } from './ui/Hint';
import { progDeathMsg } from './ProgDeathCards.i18n';

const roleText = (r: string | null) => (r ? ROLE_LABEL[r] ?? r : '');

interface Props {
  /** pulls de cada noite do boss selecionado */
  nights: Pull[][];
}

/** Card de morte da Evolução: as mortes que viraram wipe. */
export function ProgDeathCards({ nights }: Props) {
  const r = useMemo(() => computeProgDeaths(nights), [nights]);
  return <DecisiveCard rows={r.decisive} />;
}

function DecisiveCard({ rows }: { rows: DecisiveRow[] }) {
  const t = useMessages(progDeathMsg);
  const [open, toggle] = useCollapsed('trends.decisive-deaths');
  if (rows.length === 0) return null;
  return (
    <section className="panel sev-card pd-card">
      <header className="sev-head">
        <div>
          <h3>
            {t.deathsTitle}
            <Hint>
              {t.deathsSubtitle} {t.decisiveFoot(DECISIVE_TOP, MIN_PULLS)}
            </Hint>
          </h3>
        </div>
        <span className="panel-head-actions">
          <CollapseButton open={open} onToggle={toggle} />
        </span>
      </header>
      {open && (
        <>
          <table className="sev-table pd-table">
            <thead>
              <tr>
                <th aria-hidden />
                <th>{t.player}</th>
                <th className="num">{t.pulls}</th>
                <th className="num">{t.turnedWipe}</th>
                <th>{t.topCause}</th>
                <th className="num">{t.frequency}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x, i) => (
                <tr key={x.guid}>
                  <td className="sev-rank">{t.rank(i + 1)}</td>
                  <td className="pd-player">
                    <span className="sev-player">
                      <PlayerName name={x.name} guid={x.guid} cls={x.class} />
                    </span>
                    <span className="muted small">{roleText(x.role)}</span>
                  </td>
                  <td className="num">{x.pulls}</td>
                  <td className="num"><strong>{x.decisive}</strong></td>
                  <td className="pd-cause">
                    {x.cause &&
                      (x.cause.name ? (
                        <>
                          <SpellName spellId={x.cause.spellId} name={x.cause.name} size={18} /> <span className="muted small">{x.cause.count}×</span>
                        </>
                      ) : (
                        <>
                          <span>{t.unknown}</span> <span className="muted small">{x.cause.count}×</span>
                        </>
                      ))}
                  </td>
                  <td className="num pd-every">
                    <span className="sev-pct">{t.everyN(x.every)}</span>
                    <span className="muted small">{t.pullsUnit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
