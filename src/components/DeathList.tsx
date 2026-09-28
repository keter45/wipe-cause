import { useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import type { Death, DeathAura, RecapEntry } from '../types';
import { classColor, mmss, num, relSeconds, shortName } from '../lib/format';
import { iconUrl, useTooltip, wowheadUrl } from '../lib/wowhead';
import { openExternal } from '../lib/api';
import { useSeek } from '../lib/wcr';
import { PlayAt } from './VideoPanel';

interface Props {
  deaths: Death[];
  /** chaves `${guid}:${t}` das mortes decisivas */
  decisive: Set<string>;
  /** momento da N-ésima morte: mortes depois disso são ignoradas */
  cutoffT: number | null;
}

export const DEATH_KIND: Record<Death['deathKind'], { label: string; title: string }> = {
  spike: { label: 'Spike', title: 'Saiu de 60%+ de HP para 0 em até 3s: dano grande de uma vez' },
  slow: { label: 'Morte lenta', title: 'Ficou 6s+ abaixo de 50% antes de morrer' },
  normal: { label: 'Normal', title: 'Nem spike, nem morte lenta' },
  unknown: { label: '?', title: 'Sem dados de HP (Advanced Combat Logging desligado?)' },
};

export function DeathList({ deaths, decisive, cutoffT }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const seek = useSeek();
  if (deaths.length === 0) return <p className="muted pad">Ninguém morreu neste pull.</p>;

  return (
    <div className="deaths">
      {deaths.map((d) => {
        const key = `${d.guid}:${d.t}`;
        const isOpen = open === key;
        return (
          <div key={key} className={`death ${decisive.has(key) ? 'decisive' : 'cascade'} ${d.ignored ? 'ignored' : ''}`}>
            <div className="death-head">
            <button className="death-row" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
              <span className="death-order">{d.order}</span>
              <span className="death-time">{mmss(d.t)}</span>
              <span className="death-name" style={{ color: classColor(d.class) }}>
                {shortName(d.name)}
                {d.role === 'tank' && <span className="role-tag">tank</span>}
                {d.ignored && <span className="role-tag">ignorada</span>}
              </span>
              <span className="death-kb">
                {d.killingBlow ? (
                  <>
                    {d.killingBlow.spellName} <span className="muted">({d.killingBlow.source})</span>{' '}
                    <span className="dmg">{num(d.killingBlow.amount)}</span>
                  </>
                ) : (
                  <span className="muted">golpe final desconhecido</span>
                )}
                {d.causedBy && (
                  <span className="chip mech" title={`${Math.round(d.causedBy.pct)}% do dano recebido nos últimos 15s`}>
                    causa: {d.causedBy.name}
                  </span>
                )}
              </span>
              <span className="death-flags">
                <span className={`flag kind-${d.deathKind}`} title={DEATH_KIND[d.deathKind].title}>
                  {DEATH_KIND[d.deathKind].label}
                </span>
                {d.stats.underhealed && (
                  <span className="flag bad" title="Cura recebida nos últimos 10s abaixo de 25% do HP máximo">
                    pouca cura
                  </span>
                )}
                <Flag ok={d.defensivesRecent.length > 0} label="Def" title={defTitle(d)} />
                <Flag ok={d.usedHealthstone} label="HS" title={d.usedHealthstone ? 'Usou healthstone' : d.healthstoneKnown ? 'Tinha healthstone e não usou' : 'Sem healthstone no log'} muted={!d.usedHealthstone && !d.healthstoneKnown} />
                <Flag ok={d.usedHealthPotion} label="Pot" title={d.usedHealthPotion ? 'Usou poção de vida' : 'Não usou poção de vida'} />
              </span>
              <span className="chev">{isOpen ? '▾' : '▸'}</span>
            </button>
            <PlayAt t={d.t} seek={seek} />
            </div>
            {isOpen && <DeathDetail death={d} />}
          </div>
        );
      })}
      <p className="muted small">
        {cutoffT != null
          ? `Mortes marcadas "ignorada" vieram depois do corte (${mmss(cutoffT)}): nada depois dele conta (dano, cura, erros, falhas).`
          : 'Mortes esmaecidas aconteceram depois das primeiras (efeito cascata).'}
      </p>
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
      {ok ? <Check size={12} strokeWidth={2} aria-hidden /> : <X size={12} strokeWidth={2} aria-hidden />} {label}
    </span>
  );
}

function DeathDetail({ death }: { death: Death }) {
  const s = death.stats;
  return (
    <div className="recap">
      <div className="death-stats">
        <Stat label="Tipo" value={DEATH_KIND[death.deathKind].label} title={DEATH_KIND[death.deathKind].title} />
        <Stat label="Abaixo de 50%" value={s.belowHalfMs != null ? `${(s.belowHalfMs / 1000).toFixed(1)}s` : '—'} />
        <Stat label="Maior HP nos 3s finais" value={s.maxHpPctLast3s != null ? `${Math.round(s.maxHpPctLast3s)}%` : '—'} />
        <Stat label="Dano recebido (10s)" value={num(s.damageTaken10s)} />
        <Stat
          label="Cura recebida (10s)"
          value={`${num(s.healingReceived10s)}${s.healingPctOfMax10s != null ? ` (${Math.round(s.healingPctOfMax10s)}% do HP)` : ''}`}
          bad={s.underhealed}
        />
      </div>

      {death.mechanicDamage.length > 0 && (
        <p className="recap-note">
          Dano de mecânicas com falha:{' '}
          {death.mechanicDamage.map((m) => (
            <span key={m.key} className="chip mech">
              {m.name} {Math.round(m.pct)}%{m.failT != null ? ` · falhou aos ${mmss(m.failT)}` : ''}
            </span>
          ))}
        </p>
      )}

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

      {death.debuffs.length > 0 && (
        <>
          <h4 className="recap-title">Debuffs na hora da morte</h4>
          <ul className="debuffs">
            {death.debuffs.map((a) => (
              <DebuffRow key={a.spellId} a={a} deathT={death.t} />
            ))}
          </ul>
        </>
      )}

      <h4 className="recap-title">Últimos 15s</h4>
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

function Stat({ label, value, title, bad }: { label: string; value: string; title?: string; bad?: boolean }) {
  return (
    <div className="stat" title={title}>
      <span className="muted small">{label}</span>
      <strong className={bad ? 'bad' : ''}>{value}</strong>
    </div>
  );
}

function DebuffRow({ a, deathT }: { a: DeathAura; deathT: number }) {
  const [show, setShow] = useState(false);
  const tip = useTooltip(a.spellId, show);
  return (
    <li className="debuff">
      <button className="debuff-head" onClick={() => setShow(!show)} aria-expanded={show}>
        {tip?.icon && <img src={iconUrl(tip.icon)} alt="" width={18} height={18} />}
        <strong>{a.name}</strong>
        {a.stacks > 1 && <span className="stacks">×{a.stacks}</span>}
        {a.mechanic && <span className="chip mech">{a.mechanic}</span>}
        <span className="muted small">
          {a.source} · há {relSeconds(deathT - a.appliedT)}
        </span>
      </button>
      {show && (
        <div className="debuff-desc small">
          {a.tip && <p>Como evitar: {a.tip}</p>}
          {tip === undefined && <p className="muted">Buscando descrição…</p>}
          {tip === null && <p className="muted">Sem descrição disponível.</p>}
          {tip && <p className="tooltip-text">{tip.text}</p>}
          <button className="link" onClick={() => openExternal(wowheadUrl(a.spellId))}>
            Wowhead #{a.spellId} <ExternalLink size={12} strokeWidth={1.5} className="inline-icon" aria-hidden />
          </button>
        </div>
      )}
    </li>
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
        {e.kind === 'buff' || e.kind === 'debuff' ? '—' : `${sign}${num(e.amount)}`}
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
