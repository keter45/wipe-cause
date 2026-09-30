import { useState } from 'react';
import type { PlayerStats } from '../types';
import { scoreTone, type PlayerScore } from '../lib/score';
import { classColor, mmss, num, ROLE_LABEL, shortName } from '../lib/format';
import { SpellIcon, SpellName } from './SpellIcon';
import { parseColor, type PlayerParse } from '../lib/wclParses';
import type { ParseState } from '../lib/useWclParses';

type SortKey = 'name' | 'score' | 'parse' | 'dps' | 'hps' | 'damageTaken' | 'deaths' | 'defensives';

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Jogador' },
  { key: 'score', label: 'Nota', num: true },
  { key: 'parse', label: 'Parse WCL', num: true },
  { key: 'dps', label: 'DPS', num: true },
  { key: 'hps', label: 'HPS', num: true },
  { key: 'damageTaken', label: 'Dano tomado', num: true },
  { key: 'deaths', label: 'Mortes', num: true },
  { key: 'defensives', label: 'Defensivos', num: true },
];

function value(p: PlayerStats, k: SortKey, scores: Map<string, PlayerScore>, parses?: Map<string, PlayerParse>): number | string {
  if (k === 'name') return p.name;
  if (k === 'parse') return parses?.get(p.guid)?.percent ?? -1;
  if (k === 'score') return scores.get(p.guid)?.score ?? 100;
  if (k === 'defensives') return p.defensivesUsed.length;
  return p[k];
}

export function PlayersTable({ players, scores, parseState }: { players: PlayerStats[]; scores: Map<string, PlayerScore>; parseState?: ParseState }) {
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
                title={c.key === 'parse' ? 'Parse do Warcraft Logs no ranking do papel: DPS para dps e tanks, HPS para healers' : undefined}
              >
                {c.label}
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
  if (state.kind === 'off') return <p className="muted small parse-note">{state.reason}</p>;
  if (state.kind === 'error') return <p className="small bad parse-note">Warcraft Logs: {state.message}</p>;
  if (state.kind === 'ready' && state.source === 'history')
    return (
      <p className="muted small parse-note">
        O Warcraft Logs só ranqueia kills: num wipe, “Parse WCL” mostra a <strong>mediana</strong> de cada player neste boss (histórico), no ranking do papel
        dele (DPS ou HPS).
        {state.parses.size === 0 && ' Ninguém tem kill registrado neste boss no Warcraft Logs ainda.'}
      </p>
    );
  return null;
}

/** Parse colorido como no site; métrica do papel ao lado (DPS/HPS). */
function ParseCell({ parse, loading }: { parse?: PlayerParse; loading: boolean }) {
  if (!parse) return <span className="muted">{loading ? '…' : '—'}</span>;
  const metric = parse.metric.toUpperCase();
  if (parse.kind === 'history') {
    const title = `Histórico no boss (${metric}): mediana ${parse.percent ?? '—'} · melhor ${parse.best ?? '—'} · ${parse.kills} kill${parse.kills === 1 ? '' : 's'}`;
    return (
      <span className="parse history" title={title}>
        <span className="parse-hint">med</span> <strong style={{ color: parseColor(parse.percent) }}>{parse.percent ?? '—'}</strong> <span className="parse-metric">{metric}</span>
      </span>
    );
  }
  const title = `Parse de ${metric} neste kill: ${parse.percent ?? '—'} geral · ${parse.bracketPercent ?? '—'} na faixa de item level${parse.rank ? ` · #${parse.rank} de ${parse.total}` : ''}`;
  return (
    <span className="parse" title={title}>
      <strong style={{ color: parseColor(parse.percent) }}>{parse.percent ?? '—'}</strong> <span className="parse-metric">{metric}</span>
    </span>
  );
}

function PlayerRow({
  p,
  score,
  parse,
  parseLoading,
  open,
  onToggle,
}: {
  p: PlayerStats;
  score?: PlayerScore;
  parse?: PlayerParse;
  parseLoading: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="player-row" onClick={onToggle}>
        <td>
          <span style={{ color: classColor(p.class) }}>{shortName(p.name)}</span>
          {p.role && <span className="role-tag">{ROLE_LABEL[p.role]}</span>}
        </td>
        <td className="num">
          {score && (
            <span className={`score-pill ${scoreTone(score.score)}`} title={score.parts.length ? score.parts.join('\n') : 'Sem descontos'}>
              {score.score}
            </span>
          )}
        </td>
        <td className="num">
          <ParseCell parse={parse} loading={parseLoading} />
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
                <h4>Dano tomado por habilidade</h4>
                <table>
                  <tbody>
                    {p.takenByAbility.map((a) => (
                      <tr key={`${a.spellId}:${a.source}`}>
                        <td>
                          <SpellName spellId={a.spellId} name={a.name} />
                        </td>
                        <td className="muted">{a.source}</td>
                        <td className="num">{a.hits}×</td>
                        <td className="num">{num(a.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h4>Defensivos</h4>
                {p.defensivesUsed.length === 0 ? (
                  <p className="muted">Nenhum.</p>
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
