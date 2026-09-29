import { useState } from 'react';
import { ChevronRight, ExternalLink, FlaskConical, Gem, Shield } from 'lucide-react';
import type { Death, DeathAura, RecapEntry } from '../types';
import { classColor, mmss, num, relSeconds, shortName } from '../lib/format';
import { useTooltip, wowheadUrl } from '../lib/wowhead';
import { SpellIcon, SpellName } from './SpellIcon';
import { openExternal } from '../lib/api';
import { useSeek } from '../lib/wcr';
import { PlayAt } from './VideoPanel';
import { PositionMap, dist, mainEnemy } from './PositionMap';

interface Props {
  deaths: Death[];
  /** chaves `${guid}:${t}` das mortes decisivas */
  decisive: Set<string>;
  /** momento da N-ésima morte: mortes depois disso são ignoradas */
  cutoffT: number | null;
  /** guid -> classe, para as cores do mini mapa */
  classes: Map<string, string | null>;
  /** mecânica (key) -> spell, para os ícones */
  mechanicSpells: Map<string, number>;
}

export const DEATH_KIND: Record<Death['deathKind'], { label: string; title: string }> = {
  spike: { label: 'Spike', title: 'Saiu de 60%+ de HP para 0 em até 3s: dano grande de uma vez' },
  slow: { label: 'Morte lenta', title: 'Ficou 6s+ abaixo de 50% antes de morrer' },
  normal: { label: 'Normal', title: 'Nem spike, nem morte lenta' },
  unknown: { label: '?', title: 'Sem dados de HP (Advanced Combat Logging desligado?)' },
};

export function DeathList({ deaths, decisive, cutoffT, classes, mechanicSpells }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const seek = useSeek();
  if (deaths.length === 0) return <p className="muted pad">Ninguém morreu neste pull.</p>;

  return (
    <div className="deaths">
      {deaths.map((d) => {
        const key = `${d.guid}:${d.t}`;
        const isOpen = open === key;
        return (
          <div key={key} className={`death ${decisive.has(key) ? 'decisive' : 'cascade'} ${d.ignored ? 'ignored' : ''} ${isOpen ? 'open' : ''}`}>
            <div className="death-head">
              <button className="death-row" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                <span className="death-order">{d.order}</span>
                <span className="death-time">{mmss(d.t)}</span>
                <span className="death-who">
                  <span className="death-name" style={{ color: classColor(d.class) }}>
                    {shortName(d.name)}
                  </span>
                  {d.role === 'tank' && <span className="role-tag">tank</span>}
                  {d.ignored && <span className="role-tag">ignorada</span>}
                </span>
                <span className="death-kb">
                  {d.killingBlow ? (
                    <>
                      <span className="kb-line">
                        <span className="kb-spell">
                          <SpellName spellId={d.killingBlow.spellId} name={d.killingBlow.spellName} size={20} />
                        </span>
                        <span className="dmg">{num(d.killingBlow.amount)}</span>
                      </span>
                      <span className="kb-sub">
                        {d.killingBlow.source}
                        {d.causedBy && (
                          <span className="chip mech with-icon" title={`${Math.round(d.causedBy.pct)}% do dano recebido nos últimos 15s`}>
                            causa: <SpellName spellId={mechanicSpells.get(d.causedBy.key)} name={d.causedBy.name} size={14} />
                          </span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="muted">golpe final desconhecido</span>
                  )}
                </span>
                <span className="death-flags">
                  {(d.deathKind === 'spike' || d.deathKind === 'slow') && (
                    <span className={`flag kind-${d.deathKind}`} title={DEATH_KIND[d.deathKind].title}>
                      {DEATH_KIND[d.deathKind].label}
                    </span>
                  )}
                  {d.stats.underhealed && (
                    <span className="flag bad" title="Cura recebida nos últimos 10s abaixo de 25% do HP máximo">
                      pouca cura
                    </span>
                  )}
                </span>
                <span className="death-res" aria-label="Recursos usados antes de morrer">
                  <Res state={d.defensivesRecent.length ? 'ok' : d.defensivesAvailable.length ? 'bad' : 'na'} label={defTitle(d)} icon={Shield} />
                  <Res
                    state={d.usedHealthstone ? 'ok' : d.healthstoneKnown ? 'bad' : 'na'}
                    label={d.usedHealthstone ? 'Usou healthstone' : d.healthstoneKnown ? 'Tinha healthstone e não usou' : 'Sem healthstone no log'}
                    icon={Gem}
                  />
                  <Res state={d.usedHealthPotion ? 'ok' : 'bad'} label={d.usedHealthPotion ? 'Usou poção de vida' : 'Não usou poção de vida'} icon={FlaskConical} />
                </span>
                <ChevronRight size={16} strokeWidth={1.5} className="chev" aria-hidden />
              </button>
              <PlayAt t={d.t} seek={seek} />
            </div>
            {isOpen && <DeathDetail death={d} classes={classes} mechanicSpells={mechanicSpells} />}
          </div>
        );
      })}
      <p className="muted small">
        {cutoffT != null
          ? `Mortes marcadas "ignorada" vieram depois do corte (${mmss(cutoffT)}): nada depois dele conta (dano, cura, erros, falhas).`
          : 'Mortes esmaecidas aconteceram depois das primeiras (efeito cascata).'}
        {' '}Ícones: defensivo · healthstone · poção (verde = usou, vermelho = tinha e não usou).
      </p>
    </div>
  );
}

function defTitle(d: Death): string {
  if (d.defensivesRecent.length) return `Defensivo: usou ${d.defensivesRecent.map((x) => x.name).join(', ')}`;
  if (d.defensivesAvailable.length) return `Defensivo: não usou (tinha ${d.defensivesAvailable.map((x) => x.name).join(', ')})`;
  return 'Defensivo: nenhum nos últimos 10s';
}

/** Recurso usado/não usado antes da morte: ícone + cor + rótulo acessível (nunca só cor). */
function Res({ state, label, icon: Icon }: { state: 'ok' | 'bad' | 'na'; label: string; icon: typeof Shield }) {
  return (
    <span className={`res ${state}`} title={label} aria-label={label} role="img">
      <Icon size={14} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

type RecapFilter = 'all' | 'damage' | 'heal' | 'aura';
const FILTERS: { key: RecapFilter; label: string }[] = [
  { key: 'all', label: 'Tudo' },
  { key: 'damage', label: 'Dano' },
  { key: 'heal', label: 'Cura' },
  { key: 'aura', label: 'Defensivos e debuffs' },
];

function DeathDetail({ death, classes, mechanicSpells }: { death: Death; classes: Map<string, string | null>; mechanicSpells: Map<string, number> }) {
  const s = death.stats;
  const [filter, setFilter] = useState<RecapFilter>('all');
  // mais recente primeiro: o que matou fica no topo
  const recap = death.recap
    .filter((e) => (filter === 'all' ? true : filter === 'aura' ? e.kind === 'buff' || e.kind === 'debuff' : e.kind === filter))
    .reverse();
  const kb = death.killingBlow;
  const isKillingBlow = (e: RecapEntry) => kb != null && e.kind === 'damage' && e.t === kb.t && e.spellId === kb.spellId && e.amount === kb.amount;
  return (
    <div className="recap">
      <div className="death-stats">
        <Stat label="Tipo" value={DEATH_KIND[death.deathKind].label} title={DEATH_KIND[death.deathKind].title} />
        <Stat label="Abaixo de 50%" value={s.belowHalfMs != null ? `${(s.belowHalfMs / 1000).toFixed(1)}s` : '—'} />
        <Stat label="Maior HP nos 3s finais" value={s.maxHpPctLast3s != null ? `${Math.round(s.maxHpPctLast3s)}%` : '—'} />
        <Stat label="Dano recebido (10s)" value={num(s.damageTaken10s)} />
        <Stat
          label="Cura recebida (10s)"
          value={`${num(s.healingReceived10s)}${s.healingPctOfMax10s != null ? ` · ${Math.round(s.healingPctOfMax10s)}% do HP` : ''}`}
          bad={s.underhealed}
        />
      </div>

      {(death.mechanicDamage.length > 0 || (death.defensivesAvailable.length > 0 && death.defensivesRecent.length === 0)) && (
        <div className="recap-notes">
          {death.mechanicDamage.length > 0 && (
            <p className="recap-note">
              <span className="muted">Dano de mecânicas com falha</span>
              {death.mechanicDamage.map((m) => (
                <span key={m.key} className="chip mech with-icon">
                  <SpellName spellId={mechanicSpells.get(m.key)} name={m.name} size={14} /> {Math.round(m.pct)}%{m.failT != null ? ` · falhou aos ${mmss(m.failT)}` : ''}
                </span>
              ))}
            </p>
          )}
          {death.defensivesAvailable.length > 0 && death.defensivesRecent.length === 0 && (
            <p className="recap-note">
              <span className="muted">Defensivos disponíveis e não usados</span>
              {death.defensivesAvailable.map((a) => (
                <span key={a.spellId} className="chip with-icon">
                  <SpellIcon spellId={a.spellId} size={14} />
                  {a.name}
                </span>
              ))}
            </p>
          )}
        </div>
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

      {death.positions && <DeathPosition death={death} classes={classes} />}

      <div className="recap-toolbar">
        <h4 className="recap-title">
          Últimos 15s <span className="muted small">· mais recente primeiro</span>
        </h4>
        <div className="segmented" role="tablist" aria-label="Filtrar eventos">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="recap-scroll">
      <table className="recap-table">
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
          {recap.map((e, i) => (
            <RecapRow key={i} e={e} deathT={death.t} killingBlow={isKillingBlow(e)} />
          ))}
          {recap.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Nenhum evento deste tipo.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/** Players a até isso de quem morreu contam como "junto" (a maioria das explosões/poças). */
const NEAR_YD = 8;

/** Mini mapa da hora da morte + distâncias (boss, quem estava perto). */
function DeathPosition({ death, classes }: { death: Death; classes: Map<string, string | null> }) {
  const snap = death.positions!;
  const me = snap.units.find((u) => u.guid === death.guid);
  const boss = mainEnemy(snap);
  const near = me
    ? snap.units
        .filter((u) => u.kind === 'player' && u.guid !== me.guid)
        .map((u) => ({ u, d: dist(me, u) }))
        .filter((x) => x.d <= NEAR_YD)
        .sort((a, b) => a.d - b.d)
    : [];
  return (
    <div className="death-pos">
      <PositionMap snap={snap} classes={classes} marks={new Map([[death.guid, 'dead']])} size={220} />
      <div className="death-pos-facts">
        <h4 className="recap-title">Onde estava</h4>
        {!me ? (
          <p className="muted small">Posição de quem morreu não apareceu no log nos últimos segundos.</p>
        ) : (
          <>
            {boss && (
              <p>
                A <strong>{dist(me, boss).toFixed(0)} jardas</strong> do {boss.name}
              </p>
            )}
            <p>
              {near.length === 0 ? (
                <>Ninguém a menos de {NEAR_YD} jardas</>
              ) : (
                <>
                  {near.length} player{near.length > 1 ? 's' : ''} a menos de {NEAR_YD} jd:{' '}
                  {near.slice(0, 6).map((x, i) => (
                    <span key={x.u.guid}>
                      {i > 0 && ', '}
                      <span style={{ color: classColor(classes.get(x.u.guid)) }}>{shortName(x.u.name)}</span> ({x.d.toFixed(0)})
                    </span>
                  ))}
                </>
              )}
            </p>
          </>
        )}
        <p className="muted small">Anéis a cada 10 jardas do boss. Pontos apagados: posição vista há mais de 2s. A orientação pode não bater com a do jogo; as distâncias batem.</p>
      </div>
    </div>
  );
}

function Stat({ label, value, title, bad }: { label: string; value: string; title?: string; bad?: boolean }) {
  return (
    <div className="stat" title={title}>
      <span className="stat-label">{label}</span>
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
        <SpellIcon spellId={a.spellId} size={20} />
        <strong>{a.name}</strong>
        {a.stacks > 1 && <span className="stacks">×{a.stacks}</span>}
        {a.mechanic && <span className="chip mech">{a.mechanic}</span>}
        <span className="muted small">
          {a.source} · há {relSeconds(deathT - a.appliedT)}
        </span>
        <ChevronRight size={14} strokeWidth={1.5} className="chev" aria-hidden />
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

function RecapRow({ e, deathT, killingBlow }: { e: RecapEntry; deathT: number; killingBlow: boolean }) {
  const sign = e.kind === 'damage' ? '−' : e.kind === 'heal' ? '+' : '';
  return (
    <tr className={`recap-${e.kind} ${killingBlow ? 'kb-row' : ''}`} title={killingBlow ? 'Golpe final' : undefined}>
      <td className="muted num-cell">{relSeconds(e.t - deathT)}</td>
      <td>
        <SpellName spellId={e.spellId} name={e.spellName} size={16} />
        {e.overkill > 0 && <span className="muted"> (overkill {num(e.overkill)})</span>}
      </td>
      <td className="muted">{e.source}</td>
      <td className="num">
        {e.kind === 'buff' || e.kind === 'debuff' ? '—' : `${sign}${num(e.amount)}`}
        {e.absorbed > 0 && <span className="muted"> ({num(e.absorbed)} abs)</span>}
      </td>
      <td className="hp-cell">
        {e.hpPct != null && (
          <span className="hp">
            <span className="hp-value">{Math.round(e.hpPct)}%</span>
            <span className="hp-track">
              <span className={`hp-fill ${e.hpPct < 25 ? 'low' : e.hpPct < 50 ? 'mid' : ''}`} style={{ transform: `scaleX(${e.hpPct / 100})` }} />
            </span>
          </span>
        )}
      </td>
    </tr>
  );
}
