import { useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import type { RotationResult } from '../types';
import { OPENER_CASTS, OPENER_MIN_SUPPORT, type BenchView } from '../lib/bench';
import { ANCHOR_WINDOW_MS } from '../lib/benchMetrics';
import { mmss, uniqueSeconds } from '../lib/format';
import { openExternal } from '../lib/api';
import { useSeek } from '../lib/wcr';
import { scoreTone } from '../lib/score';
import { SpellIcon, SpellName } from './SpellIcon';
import { PlayAt } from './VideoPanel';
import { DecisionList } from './DecisionList';
import { tr, useMessages } from '../i18n';
import { rotationMsg } from './RotationPanel.i18n';
import { Colored, useMentionsSpell } from './Names';
import { Hint } from './ui/Hint';
import { Clamp } from './ui/Clamp';

export { uniqueSeconds };

const pctOf = (x: number) => Math.round(x * 100);
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

/**
 * A rotação do player comparada com a rotação base escrita da spec: aproveitamento, os erros
 * (com o momento, para ver no vídeo), a abertura, o uso dos cooldowns e a prioridade da spec.
 * Com `bench`, cada item traz também como os tops da spec jogam este boss (aproveitamento, uso dos
 * cooldowns, poção, mistura de habilidades e onde eles continuam castando depois das mecânicas).
 */
export function RotationPanel({
  rotation: r,
  bench,
  boss,
  part = 'all',
}: {
  rotation: RotationResult;
  bench?: BenchView | null;
  boss?: string;
  /** só uma parte: erros e leituras, uso dos cooldowns ou o guia da spec (pontos, prioridade, fontes) */
  part?: 'all' | 'findings' | 'cooldowns' | 'guide';
}) {
  const seek = useSeek();
  const t = useMessages(rotationMsg);
  const mentions = useMentionsSpell();
  const [aoe, setAoe] = useState(false);
  const problems = r.findings.filter((f) => f.count > 0 && f.id !== 'cooldowns');
  const fine = r.findings.filter((f) => f.count === 0 && f.id !== 'cooldowns');
  const prio = aoe && r.priorityAoe.length ? r.priorityAoe : r.prioritySt;

  const head = (
    <header className="rotation-head">
      <div>
        <h3>{t.title}</h3>
        <p className="muted small">{t.comparedWith(r.specName, r.tree ?? null, r.patch)}</p>
        {bench && boss && (
          <p className="muted small">
            {t.benchNote(bench.n, boss)}
            {bench.otherDifficulty && ` ${t.otherDifficulty}`}
          </p>
        )}
      </div>
      <span className={`score-pill big ${scoreTone(r.score)}`} title={t.scoreTitle}>
        {r.score}
      </span>
    </header>
  );
  const findings = (
    <>
      <h4>{t.toFix}</h4>
      {problems.length === 0 ? (
        <p className="muted small">{t.noErrors}</p>
      ) : (
        <ul className="plain rotation-findings">
          {problems.map((f) => (
            <li key={f.id} className={`rot-finding imp-${f.importance}`}>
              <div className="rot-finding-head">
                <span className={`rot-kind imp-${f.importance}`}>{t.kind[f.importance]}</span>
                {f.spellId != null && !mentions(tr(f.title)) && <SpellIcon spellId={f.spellId} size={18} />}
                <strong>
                  <Colored text={tr(f.title)} />
                </strong>
              </div>
              <p className="small">
                <Colored text={tr(f.detail)} />
              </p>
              <p className="muted small">
                <Clamp lines={2}>
                  <Colored text={tr(f.tip)} />
                </Clamp>
              </p>
              <div className="rot-rate" aria-label={t.rateAria(Math.round(f.rate * 100))}>
                <span style={{ transform: `scaleX(${f.rate})` }} />
              </div>
              {bench?.checks[f.id] != null && <p className="muted small tabular">{t.vsTops(pctOf(f.rate), pctOf(bench.checks[f.id]))}</p>}
              {f.times.length > 0 && (
                <p className="rot-times small">
                  {uniqueSeconds(f.times).slice(0, 8).map((at) => (
                    <span key={at} className="rot-time">
                      {mmss(at)}
                      <PlayAt t={at} seek={seek} />
                    </span>
                  ))}
                  {uniqueSeconds(f.times).length > 8 && <span className="muted"> +{uniqueSeconds(f.times).length - 8}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {fine.length > 0 && (
        <p className="muted small rot-fine">
          {t.fine(fine.map((f) => tr(f.title)).join(' · '))}
        </p>
      )}

      {bench?.opener ? (
        <>
          <h4>{t.opener} <Hint>{t.bossOpenerNote(Math.round(bench.opener.support * 100), bench.opener.n, bench.opener.tree)}</Hint></h4>
          <p className={`small ${bench.opener.missing && bench.opener.missing.length === 0 ? 'ok-text' : ''}`}>
            {bench.opener.missing == null
              ? bench.opener.support < OPENER_MIN_SUPPORT
                ? t.bossOpenerVaries
                : t.bossOpenerHint
              : bench.opener.missing.length === 0
                ? t.bossOpenerOk
                : t.bossOpenerMissing(bench.opener.missing.map((m) => m.name).join(', '))}
          </p>
          <div className="rot-seq">
            <span className="muted small">{t.topsHere}</span>
            {bench.opener.seq.map((s, i) => (
              <SpellIcon key={i} spellId={s.spellId} size={22} />
            ))}
          </div>
          {r.opener && (
            <div className="rot-seq">
              <span className="muted small">{t.you}</span>
              {r.opener.actual.slice(0, OPENER_CASTS).map((s, i) => (
                <SpellIcon key={i} spellId={s.spellId} size={22} />
              ))}
            </div>
          )}
        </>
      ) : r.opener && (
        <>
          <h4>{t.opener}</h4>
          <p className={`small ${r.opener.ok ? 'ok-text' : ''}`}>
            {r.opener.ok ? t.openerOk : t.openerMissing(r.opener.missing.map((m) => m.name).join(', '))}
          </p>
          <div className="rot-seq">
            <span className="muted small">{t.expected}</span>
            {r.opener.expected.map((s, i) => (
              <SpellIcon key={i} spellId={s.spellId} size={22} />
            ))}
          </div>
          <div className="rot-seq">
            <span className="muted small">{t.you}</span>
            {r.opener.actual.map((s, i) => (
              <SpellIcon key={i} spellId={s.spellId} size={22} />
            ))}
          </div>
        </>
      )}


    </>
  );
  const insights = (
    <>
      {bench && bench.context && bench.context.length > 0 && (
        <>
          <h4>{t.context} <Hint>{t.contextHint}</Hint></h4>
          <ul className="plain bench-list small">
            {bench.context.slice(0, 6).map((c) => (
              <li key={`${c.kind}-${c.kind === 'mix' ? `${c.ctx}-${c.spellId}` : c.id}`}>
                <span className="warn">
                  <Colored
                    text={
                      c.kind === 'mix'
                        ? t.ctxMix(c.ctx === 'aoe' ? 'AoE' : t.single, c.name, pctOf(c.tops), pctOf(c.you))
                        : t.ctxUptime(c.name, c.auraKind === 'debuff', pctOf(c.tops), pctOf(c.you))
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {bench && bench.context == null && bench.mix.length > 0 && (
        <>
          <h4>{t.mix} <Hint>{t.mixHint}</Hint></h4>
          <ul className="plain bench-list small">
            {bench.mix.slice(0, 4).map((m) => (
              <li key={m.spellId}>
                <Colored text={m.tops > m.you ? t.mixMore(m.name) : t.mixLess(m.name)} />
                <span className="muted tabular"> — {t.mixLine(pctOf(m.you), pctOf(m.tops))}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {bench && bench.windows.length > 0 && (
        <>
          <h4>{t.windows} <Hint>{t.windowsHint(ANCHOR_WINDOW_MS / 1000)}</Hint></h4>
          <ul className="plain bench-list small">
            {bench.windows.map((w) => (
              <li key={`${w.spellId}-${w.k}`}>
                <span className="rot-time">
                  <strong>{t.window(w.name, w.k)}</strong> {mmss(w.t)}
                  <PlayAt t={w.t} seek={seek} />
                </span>
                <br />
                <span className="warn">{t.windowIdle(secs(w.you), secs(w.tops))}</span>
                {w.use.length > 0 && (
                  <span className="muted">
                    {' '}
                    · <Colored text={t.theyUse(w.use.map((u) => u.name).join(', '))} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {bench && bench.decisions.length > 0 && (
        <>
          <h4>{t.decisions} <Hint>{t.decisionsHint}</Hint></h4>
          <DecisionList list={bench.decisions} />
        </>
      )}

    </>
  );
  const cooldowns = (
    <>
      {r.cooldowns.length > 0 && (
        <>
          <h4>{t.cooldowns} <Hint>{t.cdHint}</Hint></h4>
          <table className="rot-cds small">
            <tbody>
              {r.cooldowns.map((c) => (
                <tr key={c.spellId}>
                  <td>
                    <SpellName spellId={c.spellId} name={c.name} size={16} />
                  </td>
                  <td className="num tabular">
                    {c.casts}/{c.possible}
                  </td>
                  <td className="rot-cd-bar">
                    <div className="rot-rate">
                      <span style={{ transform: `scaleX(${c.usage})` }} />
                    </div>
                  </td>
                  {bench && <td className="num tabular muted">{bench.cdUsage[c.spellId] != null ? t.topsShort(pctOf(bench.cdUsage[c.spellId])) : ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {bench && (bench.cooldowns.length > 0 || bench.potion) && (
        <ul className="plain bench-list small">
          {bench.cooldowns.map((c) => (
            <li key={c.spellId}>
              <Colored text={c.kind === 'held' ? t.held(c.name, mmss(c.tops ?? 0), mmss(c.you ?? 0)) : t.pull(c.name, c.you != null ? mmss(c.you) : null)} />
            </li>
          ))}
          {bench.potion && (
            <li>
              {t.potion(
                [bench.potion.topsFirst, bench.potion.topsSecond]
                  .filter((x): x is number => x != null)
                  .map(mmss)
                  .join(' / '),
                bench.potion.you.length ? bench.potion.you.map(mmss).join(' / ') : null,
              )}
            </li>
          )}
        </ul>
      )}


    </>
  );
  const guide = (
    <>

        <h4>{t.keyPoints}</h4>
        <ol className="rot-points small">
          {r.keyPoints.map((k, i) => (
            <li key={i}>
              <Colored text={tr(k)} />
            </li>
          ))}
        </ol>
        {/* healer não tem prioridade (docs/healer-analysis.md) */}
        {prio.length > 0 && (
          <>
            <h4 className="rot-prio-head">
              {t.priority}
              {r.priorityAoe.length > 0 && (
                <span className="segmented sm" role="radiogroup" aria-label={t.targets}>
                  <button role="radio" aria-checked={!aoe} className={!aoe ? 'active' : ''} onClick={() => setAoe(false)}>
                    {t.single}
                  </button>
                  <button role="radio" aria-checked={aoe} className={aoe ? 'active' : ''} onClick={() => setAoe(true)}>
                    AoE
                  </button>
                </span>
              )}
            </h4>
            <ol className="rot-prio small">
              {prio.map((p, i) => (
                <li key={i}>
                  <SpellName spellId={p.spellId} name={p.name} size={16} />
                  {p.note && (
                    <span className="muted">
                      {' '}
                      — <Colored text={tr(p.note)} />
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
        <p className="muted small rot-sources">
          <BookOpen size={12} strokeWidth={1.5} aria-hidden /> {t.sources}{' '}
          {r.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && ' · '}
              <button className="link" onClick={() => openExternal(s.url)}>
                {s.title} <ExternalLink size={11} strokeWidth={1.5} aria-hidden />
              </button>
            </span>
          ))}
        </p>

    </>
  );
  // na página Você cada parte fica numa aba; na comparação detalhada vai tudo junto
  if (part === 'findings')
    return (
      <section className="rotation">
        {head}
        {findings}
        {insights}
      </section>
    );
  if (part === 'cooldowns') return <section className="rotation">{cooldowns}</section>;
  if (part === 'guide') return <section className="rotation">{guide}</section>;
  return (
    <section className="rotation">
      {head}
      <div className="rotation-cols">
        <div>
          {findings}
          {cooldowns}
          {insights}
        </div>
        <aside>{guide}</aside>
      </div>
    </section>
  );
}
