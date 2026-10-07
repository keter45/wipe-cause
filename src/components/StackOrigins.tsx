import type { Pull } from '../types';
import { stackOriginsOfNight, sourcesTotal, type StackOriginsNight } from '../lib/stackOrigins';
import { PlayerName } from './Names';
import { SpellIcon, SpellName } from './SpellIcon';
import { intlLocale, useMessages } from '../i18n';
import { stackOriginsMsg } from './StackOrigins.i18n';

const int = (n: number) => n.toLocaleString(intlLocale());
const oneDecimal = (n: number) => n.toLocaleString(intlLocale(), { maximumFractionDigits: 1 });

/** Boss na noite: de onde vieram os stacks do debuff (evitáveis por fonte, inevitáveis, tirados) e cada player. */
export function NightStackOrigins({ pulls }: { pulls: Pull[] }) {
  const nights = stackOriginsOfNight(pulls);
  return (
    <>
      {nights.map((n) => (
        <StackOriginsPanel key={n.key} n={n} />
      ))}
    </>
  );
}

function StackOriginsPanel({ n }: { n: StackOriginsNight }) {
  const t = useMessages(stackOriginsMsg);
  const avoidable = sourcesTotal(n.avoidable);
  const rows = n.players.filter((p) => p.avoidableTotal + p.unavoidableTotal > 0);
  return (
    <section className="panel stack-origins">
      <header className="phase-head">
        <strong>
          <SpellName spellId={n.spellId} name={n.name} size={20} />
        </strong>
        <span className="muted small">{t.head}</span>
      </header>
      <div className="origin-totals">
        <span className={`origin-total ${avoidable ? 'bad' : 'good'}`}>
          <span className="tile-label">{t.avoidable}</span>
          <strong className="tabular">{int(avoidable)}</strong>
        </span>
        <span className="origin-total">
          <span className="tile-label">{t.unavoidable}</span>
          <strong className="tabular">{int(sourcesTotal(n.unavoidable))}</strong>
        </span>
        {n.removed.length > 0 && (
          <span className="origin-total">
            <span className="tile-label">{t.removed}</span>
            <strong className="tabular">{int(sourcesTotal(n.removed))}</strong>
          </span>
        )}
        {n.unknown > 0 && (
          <span className="origin-total">
            <span className="tile-label">{t.unknown}</span>
            <strong className="tabular">{int(n.unknown)}</strong>
          </span>
        )}
      </div>
      {n.avoidable.length > 0 ? (
        <ul className="origin-sources">
          {n.avoidable.map((s) => (
            <li key={s.key}>
              <SpellName spellId={s.spellId} name={s.name} size={16} /> <strong className="bad tabular">{int(s.count)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="good small">{t.noAvoidable}</p>
      )}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="perf-table origin-table">
            <thead>
              <tr>
                <th>{t.player}</th>
                <th className="num">{t.avoidable}</th>
                {n.avoidable.map((s) => (
                  <th key={s.key} className="num" title={s.name} aria-label={s.name}>
                    <SpellIcon spellId={s.spellId} size={16} />
                  </th>
                ))}
                <th className="num">{t.unavoidable}</th>
                <th className="num" title={t.maxStacksTitle}>
                  {t.maxStacks}
                </th>
                <th className="num">{t.pulls}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.guid}>
                  <td>
                    <PlayerName name={p.name} guid={p.guid} cls={p.class} />
                  </td>
                  <td className={`num ${p.avoidableTotal ? 'bad' : 'muted'}`} title={p.pulls ? t.perPull(oneDecimal(p.avoidableTotal / p.pulls)) : undefined}>
                    <strong className="tabular">{p.avoidableTotal || '—'}</strong>
                  </td>
                  {n.avoidable.map((s) => (
                    <td key={s.key} className="num tabular">
                      {p.avoidable[s.key] || ''}
                    </td>
                  ))}
                  <td className="num tabular muted">{p.unavoidableTotal || ''}</td>
                  <td className="num tabular">{p.maxStacks}</td>
                  <td className="num tabular">{p.pulls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{t.legend(n.name)}</p>
    </section>
  );
}
