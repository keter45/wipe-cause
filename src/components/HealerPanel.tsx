import { Fragment } from 'react';
import type { PlayerStats, Pull } from '../types';
import { compareHealer, type Band, type CdMoments, type HealTip } from '../lib/healer';
import { mmss, uniqueSeconds } from '../lib/format';
import { useSeek } from '../lib/wcr';
import { tr, useMessages } from '../i18n';
import { SpellIcon, SpellName } from './SpellIcon';
import { PlayAt } from './VideoPanel';
import { healerMsg } from './HealerPanel.i18n';
import { Colored, useMentionsSpell } from './Names';
import { Hint } from './ui/Hint';

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Distância até o cast do boss: "+3 s", "−2 s". */
const dtLabel = (ms: number) => `${ms < 0 ? '−' : '+'}${Math.round(Math.abs(ms) / 1000)} s`;
const num = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : `${Math.round(x)}`);

/**
 * Healer: a cura comparada com a referência de healer (mesma spec no mesmo pull, ou kills no mítico
 * com composição parecida), na ordem do docs/healer-analysis.md: de onde vem a referência, o contexto
 * sem nota e as dicas fora da faixa.
 */
export function HealerPanel({ pull, me, part = 'all' }: { pull: Pull; me: PlayerStats; part?: 'all' | 'healing' | 'cooldowns' }) {
  const t = useMessages(healerMsg);
  const seek = useSeek();
  const mentions = useMentionsSpell();
  const cmp = compareHealer(pull, me);
  if (!cmp) return null;
  const { sel, context: c, tips } = cmp;
  const refCount = sel.entries.length;
  const comps = [...new Set(sel.entries.map((e) => e.healers.join(', ')))].slice(0, 4);
  const raidMore = c.dtps && c.dtps.median > 0 ? Math.round((c.you.dtps / c.dtps.median - 1) * 100) : null;
  const findingOf = (id?: string) => me.rotation?.findings.find((f) => f.id === id);

  const tipText = (x: HealTip) => {
    switch (x.kind) {
      case 'cooldown':
        return t.tip.cooldown(x.name ?? '', x.you, x.ref.median);
      case 'check':
        return t.tip.check(tr(findingOf(x.checkId)?.title));
      case 'manaLeft':
        return t.tip.manaLeft(Math.round(x.you), Math.round(x.ref.median));
      case 'manaOut':
        return t.tip.manaOut;
      case 'idle':
        return t.tip.idle(x.you, x.ref.median);
      case 'overheal':
        return t.tip.overheal(x.name ?? '', x.you, x.ref.median);
      case 'ally':
        return t.tip.ally(x.name ?? '', x.you, x.ref.median);
    }
  };
  const fmtOf = (x: HealTip): ((v: number) => string) => (x.kind === 'manaLeft' || x.kind === 'manaOut' ? (v) => `${Math.round(v)}%` : pct);

  const showHealing = part !== 'cooldowns';
  const showCooldowns = part !== 'healing';
  return (
    <section className="perf-section healer-panel">
      {part === 'all' && <h4>{t.title}</h4>}
      {showHealing && (
        <>
      {/* de onde vem a referência: o essencial em etiquetas, o detalhe fechado */}
      <div className="healer-source">
        {refCount === 0 ? (
          <span className="chip warn-chip">{t.noRefs}</span>
        ) : (
          <>
            <span className="chip">{t.chipKills(refCount)}</span>
            <span className="chip">{t.chipHealers(sel.ourHealers.length)}</span>
            {sel.looseCount && <span className="chip warn-chip">{t.chipLoose}</span>}
            {sel.distorted > 0 && <span className="chip">{t.chipDistorted(sel.distorted)}</span>}
            {cmp.numbersOnly && <span className="chip warn-chip">{t.chipNumbersOnly}</span>}
          </>
        )}
        <details className="healer-comps small">
          <summary>{t.compsSummary}</summary>
          <div className="muted">
            {refCount > 0 && <p>{t.sourceLogs(refCount, sel.ourHealers.length)}</p>}
            {sel.looseCount && <p>{t.loose}</p>}
            {sel.distorted > 0 && <p>{t.distorted(sel.distorted, sel.candidates)}</p>}
            <p>{t.ourComp(sel.ourHealers.join(', '))}</p>
            {comps.length > 0 && (
              <p>
                {t.theirComp}: {comps.join(' · ')}
              </p>
            )}
            {cmp.numbersOnly && refCount > 0 && <p>{t.numbersOnly(refCount)}</p>}
          </div>
        </details>
      </div>

      <h5>
          {t.context} <Hint>{t.contextHint}</Hint>
        </h5>
      <div className="healer-context">
        <Ctx label={t.hps} you={c.you.hps} band={c.hps} fmt={num} />
        <Ctx label={t.share} you={c.you.share} band={c.share} fmt={pct} />
        <Ctx label={t.dtps} you={c.you.dtps} band={c.dtps} fmt={num} />
      </div>
      {raidMore != null && raidMore >= 15 && <p className="small warn">{t.raidTookMore(raidMore)}</p>}

      {refCount > 0 && !cmp.numbersOnly && (
        <>
          <h5>{t.tips}</h5>
          {tips.length === 0 ? (
            <p className="muted small">{t.noTips}</p>
          ) : (
            <ul className="plain rotation-findings">
              {tips.map((x, i) => {
                const f = x.kind === 'check' ? findingOf(x.checkId) : undefined;
                const icon = x.spellId ?? f?.spellId ?? null;
                const times = uniqueSeconds(x.times);
                return (
                  <li key={`${x.kind}-${x.spellId ?? x.checkId ?? i}`} className="rot-finding imp-medium">
                    <div className="rot-finding-head">
                      {icon != null && !mentions(tipText(x)) && <SpellIcon spellId={icon} size={18} />}
                      <strong>
                        <Colored text={tipText(x)} />
                      </strong>
                    </div>
                    <p className="small tabular">
                      {t.youWere(fmtOf(x)(x.you))} · {t.refBand(x.ref, fmtOf(x))}
                    </p>
                    {f ? (
                      <p className="muted small">
                        <Colored text={tr(f.tip)} />
                      </p>
                    ) : t.why[x.kind] && <p className="muted small">{t.why[x.kind]}</p>}
                    {times.length > 0 && (
                      <p className="rot-times small">
                        <span className="muted">{t.when}: </span>
                        {times.slice(0, 8).map((at) => (
                          <span key={at} className="rot-time">
                            {mmss(at)}
                            <PlayAt t={at} seek={seek} />
                          </span>
                        ))}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {c.mix.length > 0 && (
        <>
          <h5>
          {t.mix} <Hint>{t.mixHint}</Hint>
        </h5>
          <table className="perf-table small healer-mix">
            <thead>
              <tr>
                <th rowSpan={2}>{t.spell}</th>
                <th colSpan={refCount > 0 ? 2 : 1} className="num group">
                  {t.mixShare}
                </th>
                <th colSpan={refCount > 0 ? 2 : 1} className="num group">
                  {t.mixOverheal}
                </th>
                <th colSpan={refCount > 0 ? 2 : 1} className="num group">
                  {t.mixCasts}
                </th>
              </tr>
              <tr>
                {[0, 1, 2].map((i) => (
                  <Fragment key={i}>
                    <th className="num">{t.you}</th>
                    {refCount > 0 && <th className="num">{t.ref}</th>}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.mix.map((m) => (
                <tr key={m.spellId}>
                  <td>
                    <SpellName spellId={m.spellId} name={m.name} size={16} />
                  </td>
                  <td className="num tabular">{pct(m.you)}</td>
                  {refCount > 0 && <td className="num tabular muted">{m.ref != null ? pct(m.ref) : '–'}</td>}
                  <td className={`num tabular ${m.overRef != null && m.overYou - m.overRef >= 0.1 ? 'warn' : m.overRef != null && m.overRef - m.overYou >= 0.1 ? 'good' : ''}`}>{pct(m.overYou)}</td>
                  {refCount > 0 && <td className="num tabular muted">{m.overRef != null ? pct(m.overRef) : '–'}</td>}
                  <td className={`num tabular ${m.castsYou != null && m.castsRef ? (m.castsYou < m.castsRef * 0.85 ? 'warn' : m.castsYou > m.castsRef * 1.15 ? 'good' : '') : ''}`}>{m.castsYou ?? '–'}</td>
                  {refCount > 0 && <td className="num tabular muted">{m.castsRef != null ? Math.round(m.castsRef) : '–'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
        </>
      )}

      {showCooldowns && (
        <>
      {c.moments.length > 0 && (
        <>
          <h5>
          {t.moments} <Hint>{t.momentsHint}</Hint>
        </h5>
          <ul className="plain small healer-moments">
            {c.moments.map((m) =>
              m.anchored ? (
                <li key={m.spellId} className="healer-moment">
                  <SpellName spellId={m.spellId} name={m.name} size={16} />
                  <CdTimeline m={m} durationMs={c.you.durationMs} />
                  <ul className="plain">
                    {m.anchored.map((a) => (
                      <li key={`${a.anchor}-${a.k}`}>
                        <span className="healer-anchor">
                          {t.ordinal(a.k)} <SpellName spellId={a.anchor} name={a.anchorName} size={14} />
                        </span>{' '}
                        <span className="tabular">
                          · {t.momentsRefDt(dtLabel(a.dt), Math.round(a.support * 100))} ·{' '}
                          {a.at == null ? (
                            <span className="muted">{t.notReached}</span>
                          ) : a.you == null ? (
                            <span className="warn">{t.momentsNone}</span>
                          ) : (
                            <span className={Math.abs(a.you - a.dt) > 8000 ? 'warn' : ''}>{t.momentsYouDt(dtLabel(a.you))}</span>
                          )}
                        </span>
                        {a.at != null && <PlayAt t={a.at + (a.you ?? a.dt)} seek={seek} />}
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li key={m.spellId}>
                  <SpellName spellId={m.spellId} name={m.name} size={16} />
                  <span className="tabular">
                    {' '}
                    {t.momentsRef(m.ref.map(mmss).join(', '))} · {m.you.length ? t.momentsYou(m.you.map(mmss).join(', ')) : t.momentsNone}
                  </span>
                </li>
              ),
            )}
          </ul>
        </>
      )}

        </>
      )}
    </section>
  );
}

/**
 * Linha do tempo de um cooldown: a luta inteira, as mecânicas do boss que são momento da referência
 * (com a linha guia descendo pelas faixas), quando a referência usa e cada uso seu.
 */
function CdTimeline({ m, durationMs }: { m: CdMoments; durationMs: number }) {
  const t = useMessages(healerMsg);
  const pos = (ms: number) => `${Math.max(0, Math.min(100, (ms / Math.max(1, durationMs)) * 100))}%`;
  const placed = (m.anchored ?? []).filter((a) => a.at != null);
  const minutes = Array.from({ length: Math.floor(durationMs / 60_000) + 1 }, (_, i) => i * 60_000);
  const label = (a: (typeof placed)[number]) => `${t.ordinal(a.k)} ${a.anchorName}`;
  return (
    <div className="hl-timeline" role="img" aria-label={t.timelineAria(m.name, m.you.map(mmss).join(', ') || t.momentsNone)}>
      <div className="hl-labels small" aria-hidden>
        <span>{t.lineBoss}</span>
        <span>{t.lineRef}</span>
        <span>{t.lineYou}</span>
      </div>
      <div className="hl-tracks">
        {placed.map((a) => (
          <span key={`g-${a.anchor}-${a.k}`} className="hl-guide" style={{ left: pos(a.at!) }} />
        ))}
        <div className="hl-lane">
          {placed.map((a) => (
            <span key={`b-${a.anchor}-${a.k}`} className="hl-boss" style={{ left: pos(a.at!) }}>
              <SpellIcon spellId={a.anchor} size={16} title={`${label(a)} · ${mmss(a.at!)}`} />
            </span>
          ))}
        </div>
        <div className="hl-lane">
          {placed.map((a) => (
            <span
              key={`r-${a.anchor}-${a.k}`}
              className="cd-mark ref"
              style={{ left: pos(a.at! + a.dt) }}
              title={`${t.lineRef}: ${label(a)} ${dtLabel(a.dt)} (${Math.round(a.support * 100)}%) · ${mmss(a.at! + a.dt)}`}
            />
          ))}
        </div>
        <div className="hl-lane">
          {m.you.map((u, i) => (
            <span key={i} className="cd-mark mine" style={{ left: pos(u) }} title={`${t.lineYou}: ${mmss(u)}`} />
          ))}
        </div>
        <div className="hl-axis small tabular" aria-hidden>
          {minutes.map((x) => (
            <span key={x} style={{ left: pos(x) }}>
              {mmss(x)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Um número de contexto com a faixa da referência desenhada: a barra é a faixa (p25–p75), o traço a
 * mediana e o ponto você. Cor neutra: contexto não é nota.
 */
function Ctx({ label, you, band, fmt }: { label: string; you: number; band: Band | null; fmt: (x: number) => string }) {
  const t = useMessages(healerMsg);
  const lo = Math.min(you, band?.p25 ?? you);
  const hi = Math.max(you, band?.p75 ?? you);
  const pad = (hi - lo) * 0.3 || Math.abs(hi) * 0.1 || 1;
  const [a, b] = [lo - pad, hi + pad];
  const x = (v: number) => `${((v - a) / (b - a)) * 100}%`;
  return (
    <div className="healer-ctx">
      <span className="stat-label">{label}</span>
      <strong className="tabular">{fmt(you)}</strong>
      {band && (
        <>
          <div className="bullet" aria-hidden>
            <span className="bullet-band" style={{ left: x(band.p25), width: `${((band.p75 - band.p25) / (b - a)) * 100}%` }} />
            <span className="bullet-med" style={{ left: x(band.median) }} />
            <span className="bullet-you" style={{ left: x(you) }} />
          </div>
          <span className="muted small tabular">{t.refBand(band, fmt)}</span>
        </>
      )}
    </div>
  );
}
