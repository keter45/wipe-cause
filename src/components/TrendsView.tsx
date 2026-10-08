import { useEffect, useMemo, useState } from 'react';
import { TrendingDown, TrendingUp, Trophy } from 'lucide-react';
import { historyTrends } from '../lib/api';
import { classColor, pct, shortName } from '../lib/format';
import { buildTrends, byGroup, trendBosses, type NightInput, type PlayerMove, type Progression, type ProgressionPlayer, type Trends } from '../lib/trends';
import { scoreTone } from '../lib/score';
import { SpellName } from './SpellIcon';
import { Markdown } from './AskView';
import { withErrorBoundary } from './ErrorBoundary';
import { spellIndex } from '../lib/spells';
import { BossName } from './Names';
import { messagesOf, useMessages } from '../i18n';
import { trendsViewMsg } from './TrendsView.i18n';

/**
 * Evolução entre noites de um boss: progresso, causas de wipe por noite e o que se repete com
 * cada player. Usa todas as análises salvas no histórico.
 */
function TrendsViewInner() {
  const t = useMessages(trendsViewMsg);
  const [nights, setNights] = useState<NightInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boss, setBoss] = useState<string | null>(null);

  useEffect(() => {
    historyTrends()
      .then((xs) => setNights(xs.map((x) => ({ id: x.id, title: x.title, raidStartMs: x.raidStartMs, pulls: x.report.pulls }))))
      .catch((e) => setError(String(e)));
  }, []);

  // a Evolução é da raid da guilda; noites com outros personagens e gente aleatória ficam à parte
  const [withPug, setWithPug] = useState(false);
  const grouped = useMemo(() => (nights ? byGroup(nights, withPug ? 'all' : 'guild') : null), [nights, withPug]);
  const bosses = useMemo(() => (grouped ? trendBosses(grouped.nights) : []), [grouped]);
  const selected = boss ?? bosses.find((b) => b.nights >= 2)?.key ?? bosses[0]?.key ?? null;
  const trends = useMemo(() => (grouped && selected ? buildTrends(grouped.nights, selected) : null), [grouped, selected]);

  return (
    <div className="night trends">
      <header className="night-head">
        <h2>{t.title}</h2>
        <span className="muted small">{t.subtitle}</span>
        {grouped && grouped.pugPulls > 0 && (
          <label className="trends-pug small" title={t.withPugTitle}>
            <input type="checkbox" checked={withPug} onChange={(e) => setWithPug(e.target.checked)} /> {t.withPug(grouped.pugPulls)}
          </label>
        )}
      </header>

      {error && <div className="error">{t.error(error)}</div>}
      {!nights && !error && <p className="muted">{t.reading}</p>}
      {nights && bosses.length === 0 && <p className="muted">{t.empty}</p>}

      {bosses.length > 0 && (
        <div className="chips" role="tablist" aria-label={t.boss}>
          {bosses.map((b) => (
            <button key={b.key} role="tab" aria-selected={b.key === selected} className={b.key === selected ? 'active' : ''} onClick={() => setBoss(b.key)}>
              <BossName encounterId={b.encounterId} name={b.key} size={16} />
              <span className="muted">{t.nights(b.nights)}</span>
            </button>
          ))}
        </div>
      )}

      {trends && trends.nights.length < 2 && (
        <p className="muted">{t.oneNight(selected ?? '')}</p>
      )}
      {trends && trends.nights.length >= 1 && <TrendsBody tr={trends} />}
    </div>
  );
}

function TrendsBody({ tr: t }: { tr: Trends }) {
  const m = useMessages(trendsViewMsg);
  // nomes de habilidades citados nas frases ganham ícone
  const spells = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of t.nights) for (const p of n.summary.pulls) for (const [k, v] of spellIndex(p)) if (!m.has(k)) m.set(k, v);
    return m;
  }, [t]);
  return (
    <>
      {t.insights.length > 0 && (
        <section className="panel">
          <h3>
            <TrendingUp size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> {m.changed}
          </h3>
          <ul className="insights">
            {t.insights.map((s) => (
              <li key={s}>
                <Markdown text={s} spells={spells} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h3>{m.progress}</h3>
        <div className="night-cols">
          {t.nights.map((n) => {
            const s = n.summary;
            const hp = s.kills ? 0 : s.best?.hp ?? 100;
            return (
              <div key={n.id} className="night-col" title={m.nightTitle(n.label, s.pulls.length, s.kills ? 'kill' : m.best(pct(hp)))}>
                <span className="night-col-value">{s.kills ? 'Kill' : pct(hp)}</span>
                <span className="night-col-track" aria-hidden>
                  <span className={s.kills ? 'kill' : ''} style={{ transform: `scaleY(${(100 - hp) / 100})` }} />
                </span>
                <strong>{n.label}</strong>
                <span className="muted small">{m.pulls(s.pulls.length)}</span>
              </div>
            );
          })}
        </div>
        <p className="muted small">{m.progressHint}</p>
      </section>

      <section className="panel">
        <h3>{m.triggers}</h3>
        {t.causes.length === 0 ? (
          <p className="muted small">{m.noTriggers}</p>
        ) : (
          <div className="table-scroll">
            <table className="heat">
              <thead>
                <tr>
                  <th>{m.mechanic}</th>
                  {t.nights.map((n) => (
                    <th key={n.id} className="num">
                      {n.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.causes.slice(0, 10).map((c) => (
                  <tr key={c.key}>
                    <td>
                      <SpellName spellId={c.spellId} name={c.name} size={16} />
                    </td>
                    {c.perNight.map((v, i) => {
                      const wipes = t.nights[i].summary.wipes;
                      const share = v != null && wipes ? v / wipes : 0;
                      return (
                        <td key={i} className="num heat-cell" style={{ ['--heat' as string]: share }} title={m.ofWipes(v ?? 0, wipes)}>
                          {v ? `${Math.round(share * 100)}%` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">{m.triggersHint}</p>
      </section>

      {t.progression && <ProgressionPanel pr={t.progression} />}

      {t.nights.length >= 2 && (
        <section className="panel">
          <div className="two-col moves">
            <Moves title={m.improving} icon="up" list={t.improving} />
            <Moves title={m.worsening} icon="down" list={t.worsening} />
          </div>
          <p className="muted small">{m.movesHint}</p>
        </section>
      )}

      <section className="panel">
        <h3>{m.players}</h3>
        <div className="table-scroll">
          <table className="players">
            <thead>
              <tr>
                <th>{m.player}</th>
                <th title={m.deathsPerPullTitle}>{m.deathsPerPull}</th>
                <th title={m.scorePerNightTitle}>{m.scorePerNight}</th>
                <th title={m.perfPerNightTitle}>{m.perfPerNight}</th>
                <th className="num">{m.total}</th>
                <th>{m.diesTo}</th>
                <th className="num" title={m.noDefTitle}>
                  {m.noDef}
                </th>
                <th className="num">{m.mechErrors}</th>
              </tr>
            </thead>
            <tbody>
              {t.players.map((p) => (
                <tr key={p.guid}>
                  <td style={{ color: classColor(p.class) }}>{shortName(p.name)}</td>
                  <td>
                    <Spark values={p.deathsPerPull} labels={t.nights.map((n) => n.label)} />
                  </td>
                  <td className="score-trail">
                    {p.scorePerNight.map((s, i) => (
                      <span key={i} className={s == null ? 'muted' : `score-pill ${scoreTone(s)}`} title={t.nights[i].label}>
                        {s ?? '—'}
                      </span>
                    ))}
                  </td>
                  <td className="score-trail">
                    {p.perfPerNight.map((v, i) => (
                      <span key={i} className={v == null ? 'muted' : `score-pill ${perfTone(v)}`} title={t.nights[i].label}>
                        {v == null ? '—' : Math.round(v)}
                      </span>
                    ))}
                  </td>
                  <td className="num">
                    {p.deaths}/{p.pulls}
                  </td>
                  <td>
                    {p.topKiller ? (
                      <>
                        <SpellName spellId={p.topKillerSpellId} name={p.topKiller[0]} size={16} /> <span className="muted">{p.topKiller[1]}×</span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">{p.deathsNoDefensive || ''}</td>
                  <td className="num">{p.mechanicErrors || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** Faixa do parse: da mediana do Warcraft Logs para cima, um pouco abaixo, bem abaixo. */
const perfTone = (v: number) => (v >= 50 ? 'good' : v >= 25 ? 'mid' : 'bad');
const pctOf = (v: number) => Math.round(v);

/** Melhor e pior nota e desempenho nos wipes antes da kill. */
function ProgressionPanel({ pr }: { pr: Progression }) {
  const m = useMessages(trendsViewMsg);
  const card = (label: string, p: ProgressionPlayer | null, kind: 'score' | 'perf', tone: 'good' | 'bad') =>
    p && (
      <div className={`progression-card ${tone}`}>
        <span className="muted small">{label}</span>
        <strong style={{ color: classColor(p.class) }}>{shortName(p.name)}</strong>
        <span className="small">{kind === 'score' ? m.avgScore(Math.round(p.avgScore), p.pulls) : m.killParse(pctOf(p.killParse ?? 0))}</span>
      </div>
    );
  return (
    <section className="panel">
      <h3>
        <Trophy size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> {m.progression}
      </h3>
      <p className="muted small">{pr.killedOn ? m.progressionKilled(pr.pulls, pr.killedOn) : m.progressionOngoing(pr.pulls)}</p>
      <div className="progression-cards">
        {card(m.bestScore, pr.best, 'score', 'good')}
        {card(m.worstScore, pr.worst, 'score', 'bad')}
        {card(m.bestPerf, pr.bestPerf, 'perf', 'good')}
        {card(m.worstPerf, pr.worstPerf, 'perf', 'bad')}
      </div>
      <p className="muted small">{m.progressionHint(pr.minPulls)}</p>
    </section>
  );
}

/** Quem subiu (ou caiu) de nota entre o começo e o fim das noites, com o desempenho junto. */
function Moves({ title, icon, list }: { title: string; icon: 'up' | 'down'; list: PlayerMove[] }) {
  const m = useMessages(trendsViewMsg);
  const Icon = icon === 'up' ? TrendingUp : TrendingDown;
  return (
    <div>
      <h3>
        <Icon size={16} strokeWidth={1.5} className={`inline-icon ${icon === 'up' ? 'good' : 'bad'}`} aria-hidden /> {title}
      </h3>
      {list.length === 0 ? (
        <p className="muted small">{m.noMoves}</p>
      ) : (
        <ul className="plain moves-list small">
          {list.slice(0, 8).map((p) => (
            <li key={p.guid}>
              <strong style={{ color: classColor(p.class) }}>{shortName(p.name)}</strong>{' '}
              <span className="tabular">{m.scoreMove(p.scoreFrom, p.scoreTo)}</span>
              {p.perfFrom != null && p.perfTo != null && <span className="muted tabular"> · {m.perfMove(pctOf(p.perfFrom), pctOf(p.perfTo))}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Barrinhas de mortes por pull, uma por noite (vazio = não jogou). */
function Spark({ values, labels }: { values: (number | null)[]; labels: string[] }) {
  const m = messagesOf(trendsViewMsg);
  const W = 10;
  const H = 22;
  const max = 1; // 1 morte por pull = barra cheia
  return (
    <svg className="spark" width={values.length * (W + 3)} height={H} role="img" aria-label={values.map((v, i) => `${labels[i]}: ${v == null ? m.didNotPlay : v.toFixed(2)}`).join(', ')}>
      {values.map((v, i) => {
        const h = v == null ? 2 : Math.max(2, Math.min(1, v / max) * H);
        return (
          <rect key={i} x={i * (W + 3)} y={H - h} width={W} height={h} rx={2} className={v == null ? 'spark-none' : 'spark-bar'}>
            <title>{`${labels[i]}: ${v == null ? m.didNotPlay : m.perPull(v.toFixed(2))}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export const TrendsView = withErrorBoundary(TrendsViewInner, () => messagesOf(trendsViewMsg).errorScope);
