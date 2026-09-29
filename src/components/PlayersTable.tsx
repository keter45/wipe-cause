import { useState } from 'react';
import type { PlayerStats } from '../types';
import { scoreTone, type PlayerScore } from '../lib/score';
import { classColor, mmss, num, ROLE_LABEL, shortName } from '../lib/format';
import { SpellIcon, SpellName } from './SpellIcon';

type SortKey = 'name' | 'score' | 'dps' | 'hps' | 'damageTaken' | 'deaths' | 'defensives';

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Jogador' },
  { key: 'score', label: 'Nota', num: true },
  { key: 'dps', label: 'DPS', num: true },
  { key: 'hps', label: 'HPS', num: true },
  { key: 'damageTaken', label: 'Dano tomado', num: true },
  { key: 'deaths', label: 'Mortes', num: true },
  { key: 'defensives', label: 'Defensivos', num: true },
];

function value(p: PlayerStats, k: SortKey, scores: Map<string, PlayerScore>): number | string {
  if (k === 'name') return p.name;
  if (k === 'score') return scores.get(p.guid)?.score ?? 100;
  if (k === 'defensives') return p.defensivesUsed.length;
  return p[k];
}

export function PlayersTable({ players, scores }: { players: PlayerStats[]; scores: Map<string, PlayerScore> }) {
  const [sort, setSort] = useState<SortKey>('score');
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...players].sort((a, b) => {
    const va = value(a, sort, scores);
    const vb = value(b, sort, scores);
    // nota: pior primeiro (quem precisa de atenção)
    if (sort === 'score') return (va as number) - (vb as number);
    return typeof va === 'string' ? va.localeCompare(vb as string) : (vb as number) - va;
  });

  return (
    <table className="players">
      <thead>
        <tr>
          {COLUMNS.map((c) => (
            <th key={c.key} className={c.num ? 'num' : ''}>
              <button className={`sort ${sort === c.key ? 'active' : ''}`} onClick={() => setSort(c.key)}>
                {c.label}
              </button>
            </th>
          ))}
          <th className="num">Pot / HS</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <PlayerRow key={p.guid} p={p} score={scores.get(p.guid)} open={open === p.guid} onToggle={() => setOpen(open === p.guid ? null : p.guid)} />
        ))}
      </tbody>
    </table>
  );
}

function PlayerRow({ p, score, open, onToggle }: { p: PlayerStats; score?: PlayerScore; open: boolean; onToggle: () => void }) {
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
          <td colSpan={8}>
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
