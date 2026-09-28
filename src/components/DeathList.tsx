import { useState } from 'react';
import type { Death, RecapEntry } from '../types';
import { classColor, mmss, num, relSeconds, shortName } from '../lib/format';

interface Props {
  deaths: Death[];
  /** chaves `${guid}:${t}` das mortes decisivas */
  decisive: Set<string>;
}

export function DeathList({ deaths, decisive }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  if (deaths.length === 0) return <p className="muted pad">Ninguém morreu neste pull.</p>;

  return (
    <div className="deaths">
      {deaths.map((d) => {
        const key = `${d.guid}:${d.t}`;
        const isOpen = open === key;
        return (
          <div key={key} className={`death ${decisive.has(key) ? 'decisive' : 'cascade'}`}>
            <button className="death-row" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
              <span className="death-order">{d.order}</span>
              <span className="death-time">{mmss(d.t)}</span>
              <span className="death-name" style={{ color: classColor(d.class) }}>
                {shortName(d.name)}
                {d.role === 'tank' && <span className="role-tag">tank</span>}
              </span>
              <span className="death-kb">
                {d.killingBlow ? (
                  <>
                    {d.killingBlow.spellName} <span className="muted">({d.killingBlow.source})</span>{' '}
                    {d.killingBlowMechanic && <span className="chip mech" title="Mecânica do boss (regras)">mecânica</span>}
                    <span className="dmg">{num(d.killingBlow.amount)}</span>
                  </>
                ) : (
                  <span className="muted">golpe final desconhecido</span>
                )}
              </span>
              <span className="death-flags">
                <Flag ok={d.defensivesRecent.length > 0} label="Def" title={defTitle(d)} />
                <Flag ok={d.usedHealthstone} label="HS" title={d.usedHealthstone ? 'Usou healthstone' : d.healthstoneKnown ? 'Tinha healthstone e não usou' : 'Sem healthstone no log'} muted={!d.usedHealthstone && !d.healthstoneKnown} />
                <Flag ok={d.usedHealthPotion} label="Pot" title={d.usedHealthPotion ? 'Usou poção de vida' : 'Não usou poção de vida'} />
              </span>
              <span className="chev">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && <Recap death={d} />}
          </div>
        );
      })}
      <p className="muted small">Mortes esmaecidas aconteceram depois das primeiras (efeito cascata).</p>
    </div>
  );
}

function defTitle(d: Death): string {
  if (d.defensivesRecent.length) return `Usou: ${d.defensivesRecent.map((x) => x.name).join(', ')}`;
  if (d.defensivesAvailable.length) return `Não usou. Disponível: ${d.defensivesAvailable.map((x) => x.name).join(', ')}`;
  return 'Nenhum defensivo nos últimos 10s';
}

function Flag({ ok, label, title, muted }: { ok: boolean; label: string; title: string; muted?: boolean }) {
  return (
    <span className={`flag ${ok ? 'ok' : muted ? 'na' : 'bad'}`} title={title}>
      {ok ? '✓' : '✕'} {label}
    </span>
  );
}

function Recap({ death }: { death: Death }) {
  return (
    <div className="recap">
      {death.defensivesAvailable.length > 0 && death.defensivesRecent.length === 0 && (
        <p className="recap-note">
          Defensivos disponíveis e não usados:{' '}
          {death.defensivesAvailable.map((a) => (
            <span key={a.spellId} className="chip">
              {a.name}
            </span>
          ))}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Tempo</th>
            <th>Evento</th>
            <th>Origem</th>
            <th className="num">Valor</th>
            <th>HP</th>
          </tr>
        </thead>
        <tbody>
          {death.recap.map((e, i) => (
            <RecapRow key={i} e={e} deathT={death.t} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecapRow({ e, deathT }: { e: RecapEntry; deathT: number }) {
  const sign = e.kind === 'damage' ? '-' : e.kind === 'heal' ? '+' : '';
  return (
    <tr className={`recap-${e.kind}`}>
      <td className="muted">{relSeconds(e.t - deathT)}</td>
      <td>
        {e.spellName}
        {e.overkill > 0 && <span className="muted"> (overkill {num(e.overkill)})</span>}
      </td>
      <td className="muted">{e.source}</td>
      <td className="num">
        {e.kind === 'buff' ? '—' : `${sign}${num(e.amount)}`}
        {e.absorbed > 0 && <span className="muted"> ({num(e.absorbed)} abs)</span>}
      </td>
      <td className="hp-cell">
        {e.hpPct != null && (
          <div className="hp">
            <div className="hp-fill" style={{ width: `${e.hpPct}%` }} />
            <span>{Math.round(e.hpPct)}%</span>
          </div>
        )}
      </td>
    </tr>
  );
}
