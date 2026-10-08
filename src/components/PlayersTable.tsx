import { useState } from 'react';
import type { PlayerStats, Pull } from '../types';
import { scoreTone, type PlayerScore } from '../lib/score';
import { classColor, mmss, num, ROLE_LABEL, shortName, damageSource } from '../lib/format';
import { SpellIcon, SpellName } from './SpellIcon';
import { ownPreviousParses, parseColor, type OwnParses, type PlayerParse } from '../lib/wclParses';
import type { ParseState } from '../lib/useWclParses';
import { useMessages } from '../i18n';
import { playersMsg } from './PlayersTable.i18n';

type SortKey = 'name' | 'score' | 'parse' | 'dps' | 'hps' | 'damageTaken' | 'deaths' | 'defensives';

const COLUMNS: { key: SortKey; num?: boolean }[] = [
  { key: 'name' },
  { key: 'score', num: true },
  { key: 'parse', num: true },
  { key: 'dps', num: true },
  { key: 'hps', num: true },
  { key: 'damageTaken', num: true },
  { key: 'deaths', num: true },
  { key: 'defensives', num: true },
];

function value(p: PlayerStats, k: SortKey, scores: Map<string, PlayerScore>, parses?: Map<string, PlayerParse>): number | string {
  if (k === 'name') return p.name;
  if (k === 'parse') return parses?.get(p.guid)?.percent ?? -1;
  if (k === 'score') return scores.get(p.guid)?.score ?? 100;
  if (k === 'defensives') return p.defensivesUsed.length;
  return p[k];
}

/** `pull`: no kill, compara o parse de cada um com os kills anteriores dele no mesmo boss e dificuldade. */
export function PlayersTable({ players, scores, parseState, pull }: { players: PlayerStats[]; scores: Map<string, PlayerScore>; parseState?: ParseState; pull?: Pull }) {
  const t = useMessages(playersMsg);
  const parses = parseState?.kind === 'ready' ? parseState.parses : undefined;
  const [sort, setSort] = useState<SortKey>('score');
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...players].sort((a, b) => {
    const va = value(a, sort, scores, parses);
    const vb = value(b, sort, scores, parses);
    // nota: pior primeiro (quem precisa de atenção)
    if (sort === 'score') return (va as number) - (vb as number);
    return typeof va === 'string' ? va.localeCompare(vb as string) : (vb as number) - va;
  });

  return (
    <>
    {parseState && <ParseNote state={parseState} />}
    <table className="players">
      <thead>
        <tr>
          {COLUMNS.map((c) => (
            <th key={c.key} className={c.num ? 'num' : ''}>
              <button
                className={`sort ${sort === c.key ? 'active' : ''}`}
                onClick={() => setSort(c.key)}
                title={c.key === 'parse' ? t.parseTitle : undefined}
              >
                {t.columns[c.key]}
              </button>
            </th>
          ))}
          <th className="num">Pot / HS</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <PlayerRow
            key={p.guid}
            p={p}
            score={scores.get(p.guid)}
            parse={parses?.get(p.guid)}
            parseLoading={parseState?.kind === 'loading'}
            own={pull?.success ? ownPreviousParses(pull, p.name) : undefined}
            open={open === p.guid}
            onToggle={() => setOpen(open === p.guid ? null : p.guid)}
          />
        ))}
      </tbody>
    </table>
    </>
  );
}

/** Linha explicando de onde vem o parse (ou por que não aparece). */
function ParseNote({ state }: { state: ParseState }) {
  const t = useMessages(playersMsg);
  if (state.kind === 'off') return <p className="muted small parse-note">{state.reason}</p>;
  if (state.kind === 'error') return <p className="small bad parse-note">{t.wclError(state.message)}</p>;
  if (state.kind === 'ready' && state.source === 'history')
    return (
      <p className="muted small parse-note">{t.historyNote(state.parses.size === 0)}</p>
    );
  return null;
}

const dayMonth = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });

/** Parse colorido como no site; métrica do papel ao lado (DPS/HPS); no kill, a variação contra o kill anterior dele. */
function ParseCell({ parse, loading, own }: { parse?: PlayerParse; loading: boolean; own?: OwnParses }) {
  const t = useMessages(playersMsg);
  if (!parse) return <span className="muted">{loading ? '…' : '—'}</span>;
  const metric = parse.metric.toUpperCase();
  if (parse.kind === 'history') {
    const title = t.historyTitle(metric, String(parse.percent ?? '—'), String(parse.best ?? '—'), parse.kills ?? 0);
    return (
      <span className="parse history" title={title}>
        <span className="parse-hint">{t.median}</span> <strong style={{ color: parseColor(parse.percent) }}>{parse.percent ?? '—'}</strong> <span className="parse-metric">{metric}</span>
      </span>
    );
  }
  const vs = own?.previous && parse.percent != null ? parse.percent - own.previous.percent : null;
  const title = [
    t.killTitle(metric, String(parse.percent ?? '—'), String(parse.bracketPercent ?? '—'), parse.rank ? t.rank(parse.rank, parse.total ?? 0) : ''),
    own?.previous ? t.ownTitle(own.previous.percent, dayMonth(own.previous.startMs), own.avg ?? own.previous.percent, own.kills) : own ? t.firstKill : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span className="parse" title={title}>
      <strong style={{ color: parseColor(parse.percent) }}>{parse.percent ?? '—'}</strong> <span className="parse-metric">{metric}</span>
      {vs != null && <span className={`parse-vs ${vs > 0 ? 'up' : vs < 0 ? 'down' : ''}`}>{vs > 0 ? `▲${vs}` : vs < 0 ? `▼${-vs}` : '='}</span>}
    </span>
  );
}

function PlayerRow({
  p,
  score,
  parse,
  parseLoading,
  own,
  open,
  onToggle,
}: {
  p: PlayerStats;
  score?: PlayerScore;
  parse?: PlayerParse;
  parseLoading: boolean;
  own?: OwnParses;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useMessages(playersMsg);
  return (
    <>
      <tr className="player-row" onClick={onToggle}>
        <td>
          <span style={{ color: classColor(p.class) }}>{shortName(p.name)}</span>
          {p.role && <span className="role-tag">{ROLE_LABEL[p.role]}</span>}
        </td>
        <td className="num">
          {score && (
            <span className={`score-pill ${scoreTone(score.score)}`} title={score.parts.length ? score.parts.join('\n') : t.noDeductions}>
              {score.score}
            </span>
          )}
        </td>
        <td className="num">
          <ParseCell parse={parse} loading={parseLoading} own={own} />
        </td>
        <td className="num">{num(p.dps)}</td>
        <td className="num">{num(p.hps)}</td>
        <td className="num">{num(p.damageTaken)}</td>
        <td className={`num ${p.deaths ? 'bad' : ''}`}>{p.deaths || ''}</td>
        <td className="num">{p.defensivesUsed.length}</td>
        <td className="num">
          {p.healthPotions} / {p.healthstones}
        </td>
      </tr>
      {open && (
        <tr className="player-detail">
          <td colSpan={9}>
            <div className="detail-grid">
              <div>
                <h4>{t.takenByAbility}</h4>
                <table>
                  <tbody>
                    {p.takenByAbility.map((a) => (
                      <tr key={`${a.spellId}:${a.source}`}>
                        <td>
                          <SpellName spellId={a.spellId} name={a.name} />
                        </td>
                        <td className="muted">{damageSource(a.source)}</td>
                        <td className="num">{a.hits}×</td>
                        <td className="num">{num(a.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h4>{t.defensives}</h4>
                {p.defensivesUsed.length === 0 ? (
                  <p className="muted">{t.none}</p>
                ) : (
                  <ul className="plain">
                    {p.defensivesUsed.map((d, i) => (
                      <li key={i}>
                        <span className="muted">{mmss(d.t)}</span> <SpellIcon spellId={d.spellId} size={16} /> {d.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
