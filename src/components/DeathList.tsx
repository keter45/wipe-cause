import { useState } from 'react';
import { ChevronRight, ExternalLink, FlaskConical, Gem, Shield } from 'lucide-react';
import type { Death, DeathAura, RecapEntry } from '../types';
import { classColor, mmss, num, relSeconds, shortName, damageSource } from '../lib/format';
import { useTooltip, wowheadUrl } from '../lib/wowhead';
import { SpellIcon, SpellName } from './SpellIcon';
import { openExternal } from '../lib/api';
import { useSeek } from '../lib/wcr';
import { PlayAt } from './VideoPanel';
import { PositionMap, dist, mainEnemy } from './PositionMap';
import { deathKey, massDeathKeys, MASS_DEATH_MIN } from '../lib/massDeaths';
import { messagesOf, tr, useMessages } from '../i18n';
import { deathMsg } from './DeathList.i18n';

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
  /** "marcar como erro": vira uma marca manual do pull */
  onMark?: (d: Death) => void;
}

/** Tipo da morte (rótulo e explicação) no idioma atual. */
export const deathKind = (k: Death['deathKind']) => messagesOf(deathMsg).kind[k];

export function DeathList({ deaths, decisive, cutoffT, classes, mechanicSpells, onMark }: Props) {
  const t = useMessages(deathMsg);
  const [open, setOpen] = useState<string | null>(null);
  const seek = useSeek();
  const mass = massDeathKeys(deaths);
  if (deaths.length === 0) return <p className="muted pad">{t.nobodyDied}</p>;

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
                  {d.ignored && <span className="role-tag">{t.ignored}</span>}
                  {mass.has(deathKey(d)) && (
                    <span className="role-tag mass" title={t.massTitle(MASS_DEATH_MIN)}>
                      {t.mass}
                    </span>
                  )}
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
                        {damageSource(d.killingBlow.source)}
                        {d.causedBy && (
                          <span className="chip mech with-icon" title={t.causeTitle(Math.round(d.causedBy.pct))}>
                            {t.cause} <SpellName spellId={mechanicSpells.get(d.causedBy.key)} name={d.causedBy.name} size={14} />
                          </span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="muted">{t.unknownKillingBlow}</span>
                  )}
                </span>
                <span className="death-flags">
                  {(d.deathKind === 'spike' || d.deathKind === 'slow') && (
                    <span className={`flag kind-${d.deathKind}`} title={t.kind[d.deathKind].title}>
                      {t.kind[d.deathKind].label}
                    </span>
                  )}
                  {d.stats.underhealed && (
                    <span className="flag bad" title={t.lowHealTitle}>
                      {t.lowHeal}
                    </span>
                  )}
                </span>
                <span className="death-res" aria-label={t.resourcesAria}>
                  <Res state={d.defensivesRecent.length ? 'ok' : d.defensivesAvailable.length ? 'bad' : 'na'} label={defTitle(d)} icon={Shield} />
                  <Res
                    state={d.usedHealthstone ? 'ok' : d.healthstoneKnown ? 'bad' : 'na'}
                    label={d.usedHealthstone ? t.usedHealthstone : d.healthstoneKnown ? t.unusedHealthstone : t.noHealthstone}
                    icon={Gem}
                  />
                  <Res state={d.usedHealthPotion ? 'ok' : 'bad'} label={d.usedHealthPotion ? t.usedPotion : t.noPotion} icon={FlaskConical} />
                </span>
                <ChevronRight size={16} strokeWidth={1.5} className="chev" aria-hidden />
              </button>
              <PlayAt t={d.t} seek={seek} />
            </div>
            {isOpen && <DeathDetail death={d} classes={classes} mechanicSpells={mechanicSpells} onMark={onMark} />}
          </div>
        );
      })}
      <p className="muted small">
        {cutoffT != null ? t.cutoffNote(mmss(cutoffT)) : t.cascadeNote} {t.iconsNote}
      </p>
    </div>
  );
}

function defTitle(d: Death): string {
  const t = messagesOf(deathMsg);
  if (d.defensivesRecent.length) return t.defUsed(d.defensivesRecent.map((x) => x.name).join(', '));
  if (d.defensivesAvailable.length) return t.defUnused(d.defensivesAvailable.map((x) => x.name).join(', '));
  return t.defNone;
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
const FILTERS: RecapFilter[] = ['all', 'damage', 'heal', 'aura'];

function DeathDetail({
  death,
  classes,
  mechanicSpells,
  onMark,
}: {
  death: Death;
  classes: Map<string, string | null>;
  mechanicSpells: Map<string, number>;
  onMark?: (d: Death) => void;
}) {
  const t = useMessages(deathMsg);
  const [marked, setMarked] = useState(false);
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
      {onMark && (
        <p className="recap-actions">
          <button
            className="link small"
            disabled={marked}
            onClick={() => {
              onMark(death);
              setMarked(true);
            }}
            title={t.markTitle}
          >
            {marked ? t.marked : t.mark}
          </button>
        </p>
      )}
      <div className="death-stats">
        <Stat label={t.type} value={t.kind[death.deathKind].label} title={t.kind[death.deathKind].title} />
        <Stat label={t.belowHalf} value={s.belowHalfMs != null ? `${(s.belowHalfMs / 1000).toFixed(1)}s` : '—'} />
        <Stat label={t.maxHp} value={s.maxHpPctLast3s != null ? `${Math.round(s.maxHpPctLast3s)}%` : '—'} />
        <Stat label={t.damage10} value={num(s.damageTaken10s)} />
        <Stat
          label={t.heal10}
          value={`${num(s.healingReceived10s)}${s.healingPctOfMax10s != null ? t.ofHp(Math.round(s.healingPctOfMax10s)) : ''}`}
          bad={s.underhealed}
        />
      </div>

      {(death.mechanicDamage.length > 0 || (death.defensivesAvailable.length > 0 && death.defensivesRecent.length === 0)) && (
        <div className="recap-notes">
          {death.mechanicDamage.length > 0 && (
            <p className="recap-note">
              <span className="muted">{t.mechDamage}</span>
              {death.mechanicDamage.map((m) => (
                <span key={m.key} className="chip mech with-icon">
                  <SpellName spellId={mechanicSpells.get(m.key)} name={m.name} size={14} /> {Math.round(m.pct)}%{m.failT != null ? t.failedAt(mmss(m.failT)) : ''}
                </span>
              ))}
            </p>
          )}
          {death.defensivesAvailable.length > 0 && death.defensivesRecent.length === 0 && (
            <p className="recap-note">
              <span className="muted">{t.unusedDefensives}</span>
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
          <h4 className="recap-title">{t.debuffs}</h4>
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
          {t.last15} <span className="muted small">{t.newestFirst}</span>
        </h4>
        <div className="segmented" role="tablist" aria-label={t.filterAria}>
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {t.filters[f]}
            </button>
          ))}
        </div>
      </div>
      <div className="recap-scroll">
      <table className="recap-table">
        <thead>
          <tr>
            <th>{t.time}</th>
            <th>{t.event}</th>
            <th>{t.source}</th>
            <th className="num">{t.value}</th>
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
                {t.noEvents}
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
  const t = useMessages(deathMsg);
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
        <h4 className="recap-title">{t.where}</h4>
        {!me ? (
          <p className="muted small">{t.noPosition}</p>
        ) : (
          <>
            {boss && (
              <p>{t.yardsFrom(dist(me, boss).toFixed(0), boss.name)}</p>
            )}
            <p>
              {near.length === 0 ? (
                <>{t.nobodyNear(NEAR_YD)}</>
              ) : (
                <>
                  {t.near(near.length, NEAR_YD)}
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
        <p className="muted small">{t.mapHint}</p>
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
  const t = useMessages(deathMsg);
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
          {damageSource(a.source)} · {t.ago(relSeconds(deathT - a.appliedT))}
        </span>
        <ChevronRight size={14} strokeWidth={1.5} className="chev" aria-hidden />
      </button>
      {show && (
        <div className="debuff-desc small">
          {a.tip && <p>{t.howToAvoid(tr(a.tip))}</p>}
          {tip === undefined && <p className="muted">{t.fetching}</p>}
          {tip === null && <p className="muted">{t.noDesc}</p>}
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
    <tr className={`recap-${e.kind} ${killingBlow ? 'kb-row' : ''}`} title={killingBlow ? messagesOf(deathMsg).killingBlow : undefined}>
      <td className="muted num-cell">{relSeconds(e.t - deathT)}</td>
      <td>
        <SpellName spellId={e.spellId} name={e.spellName} size={16} />
        {e.overkill > 0 && <span className="muted"> (overkill {num(e.overkill)})</span>}
      </td>
      <td className="muted">{damageSource(e.source)}</td>
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
