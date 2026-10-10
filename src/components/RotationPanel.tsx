import { useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import type { RotationResult } from '../types';
import { OPENER_CASTS, OPENER_MIN_SUPPORT, type BenchView } from '../lib/bench';
import { ANCHOR_WINDOW_MS } from '../lib/benchMetrics';
import { mmss } from '../lib/format';
import { openExternal } from '../lib/api';
import { useSeek } from '../lib/wcr';
import { scoreTone } from '../lib/score';
import { SpellIcon, SpellName } from './SpellIcon';
import { PlayAt } from './VideoPanel';
import { tr, useMessages } from '../i18n';
import { rotationMsg } from './RotationPanel.i18n';

/** Momentos em ordem, um por segundo (vários no mesmo segundo viram um ▶ só). */
export const uniqueSeconds = (times: number[]) => {
  const seen = new Set<number>();
  return [...times].sort((a, b) => a - b).filter((t) => !seen.has(Math.floor(t / 1000)) && !!seen.add(Math.floor(t / 1000)));
};

const pctOf = (x: number) => Math.round(x * 100);
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

/**
 * A rotação do player comparada com a rotação base escrita da spec: aproveitamento, os erros
 * (com o momento, para ver no vídeo), a abertura, o uso dos cooldowns e a prioridade da spec.
 * Com `bench`, cada item traz também como os tops da spec jogam este boss (aproveitamento, uso dos
 * cooldowns, poção, mistura de habilidades e onde eles continuam castando depois das mecânicas).
 */
export function RotationPanel({ rotation: r, bench, boss }: { rotation: RotationResult; bench?: BenchView | null; boss?: string }) {
  const seek = useSeek();
  const t = useMessages(rotationMsg);
  const [aoe, setAoe] = useState(false);
  const problems = r.findings.filter((f) => f.count > 0 && f.id !== 'cooldowns');
  const fine = r.findings.filter((f) => f.count === 0 && f.id !== 'cooldowns');
  const prio = aoe && r.priorityAoe.length ? r.priorityAoe : r.prioritySt;

  return (
    <section className="rotation">
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

      <div className="rotation-cols">
        <div>
          <h4>{t.toFix}</h4>
          {problems.length === 0 ? (
            <p className="muted small">{t.noErrors}</p>
          ) : (
            <ul className="plain rotation-findings">
              {problems.map((f) => (
                <li key={f.id} className={`rot-finding imp-${f.importance}`}>
                  <div className="rot-finding-head">
                    <span className={`rot-kind imp-${f.importance}`}>{t.kind[f.importance]}</span>
                    {f.spellId != null && <SpellIcon spellId={f.spellId} size={18} />}
                    <strong>{tr(f.title)}</strong>
                  </div>
                  <p className="small">{tr(f.detail)}</p>
                  <p className="muted small">{tr(f.tip)}</p>
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
              <h4>{t.opener}</h4>
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
              <p className="muted small">{t.bossOpenerNote(Math.round(bench.opener.support * 100), bench.opener.n, bench.opener.tree)}</p>
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

          {r.cooldowns.length > 0 && (
            <>
              <h4>{t.cooldowns}</h4>
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
              <p className="muted small">{t.cdHint}</p>
            </>
          )}
          {bench && (bench.cooldowns.length > 0 || bench.potion) && (
            <ul className="plain bench-list small">
              {bench.cooldowns.map((c) => (
                <li key={c.spellId}>
                  <SpellIcon spellId={c.spellId} size={16} /> {c.kind === 'held' ? t.held(c.name, mmss(c.tops ?? 0), mmss(c.you ?? 0)) : t.pull(c.name, c.you != null ? mmss(c.you) : null)}
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

          {bench && bench.mix.length > 0 && (
            <>
              <h4>{t.mix}</h4>
              <ul className="plain bench-list small">
                {bench.mix.slice(0, 4).map((m) => (
                  <li key={m.spellId}>
                    <SpellName spellId={m.spellId} name={m.tops > m.you ? t.mixMore(m.name) : t.mixLess(m.name)} size={16} />
                    <span className="muted tabular"> — {t.mixLine(pctOf(m.you), pctOf(m.tops))}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">{t.mixHint}</p>
            </>
          )}

          {bench && bench.windows.length > 0 && (
            <>
              <h4>{t.windows}</h4>
              <ul className="plain bench-list small">
                {bench.windows.map((w) => (
                  <li key={`${w.spellId}-${w.k}`}>
                    <span className="rot-time">
                      <strong>{t.window(w.name, w.k)}</strong> {mmss(w.t)}
                      <PlayAt t={w.t} seek={seek} />
                    </span>
                    <br />
                    <span className="warn">{t.windowIdle(secs(w.you), secs(w.tops))}</span>
                    {w.use.length > 0 && <span className="muted"> · {t.theyUse(w.use.map((u) => u.name).join(', '))}</span>}
                  </li>
                ))}
              </ul>
              <p className="muted small">{t.windowsHint(ANCHOR_WINDOW_MS / 1000)}</p>
            </>
          )}
        </div>

        <aside>
          <h4>{t.keyPoints}</h4>
          <ol className="rot-points small">
            {r.keyPoints.map((k, i) => (
              <li key={i}>{tr(k)}</li>
            ))}
          </ol>
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
                {p.note && <span className="muted"> — {tr(p.note)}</span>}
              </li>
            ))}
          </ol>
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
        </aside>
      </div>
    </section>
  );
}
