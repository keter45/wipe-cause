// Painéis da Evolução: a tela (TrendsView) e o cartão de compartilhar (share/EvolutionCard) usam
// os mesmos. `still`: sem botões nem estado (o cartão é uma foto).

import { useCallback, useMemo, useState } from 'react';
import { ShieldOff, TrendingUp, TriangleAlert, Trophy } from 'lucide-react';
import { classColor, num, pct, shortName, decimals } from '../lib/format';
import type { DeathRow, DeathTable, ProgAwardKey, ProgAwards, ProgAwardWinner, Progression, Trends } from '../lib/trends';
import { metricTrend, savedBossMetrics, type MetricTrend, type MetricTrendPlayer } from '../lib/bossMetrics';
import { MetricPeople, MetricTools, MetricsPanel, type MetricEdit } from './BossMetrics';
import { bossMetricsMsg } from './BossMetrics.i18n';
import { scoreTier } from '../lib/score';
import { phaseCountOf, pullProgress } from '../lib/phases';
import { SpellName } from './SpellIcon';
import { Markdown } from './AskView';
import { spellIndex } from '../lib/spells';
import { PlayerName } from './Names';
import { useMessages } from '../i18n';
import { trendsViewMsg } from './TrendsView.i18n';
import { Hint } from './ui/Hint';
import { DeathSeverityCard } from './DeathSeverityCard';
import { ProgDeathCards } from './ProgDeathCards';
import { REGULAR_SHARE } from '../lib/night';
import { SortTh, useSort } from './ui/SortTh';

export function TrendsBody({ tr: t }: { tr: Trends }) {
  const nightPulls = useMemo(() => t.nights.map((n) => n.summary.pulls), [t]);
  const allPulls = useMemo(() => nightPulls.flat(), [nightPulls]);
  return (
    <>
      <TrendInsights tr={t} />
      <TrendProgress tr={t} />
      <TrendTriggers tr={t} />
      <TrendMetricsPanel tr={t} />
      <ProgAwardsPanel awards={t.progAwards} deathTable={t.deathTable} progression={t.progression} />
      <DeathSeverityCard pulls={allPulls} mode="evolution" />
      <ProgDeathCards nights={nightPulls} />
      <PlayersPanel tr={t} />
    </>
  );
}

/** "O que mudou": as frases da Evolução, com ícone nas habilidades citadas. */
export function TrendInsights({ tr: t }: { tr: Trends }) {
  const m = useMessages(trendsViewMsg);
  const spells = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of t.nights) for (const p of n.summary.pulls) for (const [k, v] of spellIndex(p)) if (!m.has(k)) m.set(k, v);
    return m;
  }, [t]);
  if (!t.insights.length) return null;
  return (
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
  );
}

/** Progresso: o melhor pull de cada noite, numa barra até onde ele foi na luta toda. */
export function TrendProgress({ tr: t }: { tr: Trends }) {
  const m = useMessages(trendsViewMsg);
  const phases = phaseCountOf(t.nights.flatMap((x) => x.summary.pulls));
  return (
    <section className="panel">
      <h3>{m.progress} <Hint>{m.progressHint}</Hint></h3>
      <div className="night-cols">
        {t.nights.map((n) => {
          const s = n.summary;
          // o melhor pull da noite: fase e vida ("P3 82%"); a barra é até onde ele foi na luta toda
          const label = s.kills ? 'Kill' : s.best?.label ?? pct(100);
          const progress = s.kills ? 1 : s.best ? pullProgress(s.best.pull, phases) : 0;
          return (
            <div key={n.id} className="night-col" title={m.nightTitle(n.label, s.pulls.length, s.kills ? 'kill' : m.best(label))}>
              <span className="night-col-value">{label}</span>
              <span className="night-col-track" aria-hidden>
                <span className={s.kills ? 'kill' : ''} style={{ transform: `scaleY(${progress})` }} />
              </span>
              <strong>{n.label}</strong>
              <span className="muted small">{m.pulls(s.pulls.length)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Gatilhos de wipe por noite (mapa de calor): as `limit` mecânicas que mais derrubaram a raide. */
export function TrendTriggers({ tr: t, limit = 10 }: { tr: Trends; limit?: number }) {
  const m = useMessages(trendsViewMsg);
  return (
    <section className="panel">
      <h3>{m.triggers} <Hint>{m.triggersHint}</Hint></h3>
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
              {t.causes.slice(0, limit).map((c) => (
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
    </section>
  );
}

/** Número com 2 casas no idioma do app (vírgula em pt-BR). */
const fmt2 = (v: number) => decimals(v, 2, 2);

type PlayerSort = 'name' | 'score' | 'deaths' | 'diesTo' | 'mistakes';
/** Quem jogou menos que essa fração das trys fica escondido na tabela (dá para mostrar). */
const FEW_PULLS = REGULAR_SHARE;

/** Jogadores da Evolução: médias, ordenáveis por coluna; quem jogou pouco fica recolhido. */
/** `still`: o cartão de compartilhar — sem ordenar nem mostrar quem jogou pouco, na ordem da nota. */
export function PlayersPanel({ tr: t, still = false }: { tr: Trends; still?: boolean }) {
  const m = useMessages(trendsViewMsg);
  // nome começa de A a Z; números começam do maior
  const sort = useSort<PlayerSort>('score', (k) => (k === 'name' ? 1 : -1));
  const [showFew, setShowFew] = useState(false);
  const totalPulls = t.nights.reduce((a, n) => a + n.summary.pulls.length, 0);
  const minPulls = Math.ceil(totalPulls * FEW_PULLS);
  const value = (p: Trends['players'][number]): number | string => {
    switch (sort.key) {
      case 'name':
        return shortName(p.name).toLowerCase();
      case 'score':
        return p.avgScore;
      case 'deaths':
        return p.avgDeathsPerPull;
      case 'diesTo':
        return p.topKiller?.[1] ?? 0;
      case 'mistakes':
        return p.deathsNoDefensive + p.mechanicErrors;
    }
  };
  const sorted = [...t.players].sort((a, b) => sort.compare(value(a), value(b)) || b.pulls - a.pulls || a.name.localeCompare(b.name));
  const few = sorted.filter((p) => p.pulls < minPulls).length;
  const shown = showFew ? sorted : sorted.filter((p) => p.pulls >= minPulls);
  const header = (key: PlayerSort, label: string, title?: string) =>
    still ? (
      <th title={title}>{label}</th>
    ) : (
      <SortTh k={key} sort={sort} title={title}>
        {label}
      </SortTh>
    );
  return (
    <section className="panel">
      <h3>{m.players}</h3>
      <div className="table-scroll">
        <table className="players trend-players">
          <thead>
            <tr>
              {header('name', m.player)}
              {header('score', m.avgScoreCol, m.avgScoreTitle)}
              {header('deaths', m.deathsPerPull, m.deathsPerPullTitle)}
              {header('diesTo', m.diesTo)}
              {header('mistakes', m.mistakes, m.mistakesTitle)}
            </tr>
          </thead>
          <tbody>
          {shown.map((p) => {
            const nightsTitle = (base: string, value: (i: number) => string) =>
              `${base} · ${t.nights.map((n, i) => `${n.label}: ${value(i)}`).join(' · ')}`;
            return (
              <tr key={p.guid}>
                <td style={{ color: classColor(p.class) }}>{shortName(p.name)}</td>
                <td>
                  <span className={`score-pill ${scoreTier(p.avgScore)}`} title={nightsTitle(m.avgScoreTitle, (i) => (p.scorePerNight[i] != null ? m.cellScore(p.scorePerNight[i]!) : m.didNotPlay))}>
                    {Math.round(p.avgScore)}
                  </span>
                </td>
                <td title={nightsTitle(m.deathsPerPullTitle, (i) => (p.deathsPerPull[i] != null ? m.perPull(fmt2(p.deathsPerPull[i]!)) : m.didNotPlay))}>
                  <span className="trend-avg">
                    <strong className="tabular">{fmt2(p.avgDeathsPerPull)}</strong>
                    <span className="muted small">
                      {p.deaths}/{p.pulls}
                    </span>
                  </span>
                </td>
                <td>
                  {p.topKiller ? (
                    <span className="trend-dies" title={p.topKiller[0]}>
                      <SpellName spellId={p.topKillerSpellId} name={p.topKiller[0]} size={16} /> <span className="muted">{p.topKiller[1]}×</span>
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <span className="mistakes-cell">
                    {p.deathsNoDefensive > 0 && (
                      <span title={m.noDefTitle}>
                        <ShieldOff size={13} strokeWidth={1.75} aria-hidden /> {p.deathsNoDefensive}
                      </span>
                    )}
                    {p.mechanicErrors > 0 && (
                      <span title={m.mechErrors}>
                        <TriangleAlert size={13} strokeWidth={1.75} aria-hidden /> {p.mechanicErrors}
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
        {few > 0 && !still && (
          <button className="btn ghost sm trend-few" onClick={() => setShowFew(!showFew)} aria-expanded={showFew}>
            {showFew ? m.hideFewPulls(few) : m.showFewPulls(few, minPulls)}
          </button>
        )}
        <p className="muted small trend-legend">
          <span className={`score-pill ${scoreTier(85)}`}>85</span> {m.legendScore}
        </p>
      </div>
    </section>
  );
}

/** Métricas escolhidas do boss, com a evolução noite a noite (o mesmo painel e a mesma escolha do resumo do boss). */
function TrendMetricsPanel({ tr }: { tr: Trends }) {
  const m = useMessages(trendsViewMsg);
  const pulls = useMemo(() => tr.nights.flatMap((n) => n.summary.pulls), [tr]);
  const build = useCallback(
    (keys: string[]) => keys.map((key) => ({ key, value: metricTrend(tr.nights.map((n) => ({ label: n.label, pulls: n.summary.pulls })), key) })),
    [tr],
  );
  return <MetricsPanel pulls={pulls} hint={m.metricsHint} className="trends-metrics" collapseKey="trends.metrics" build={build} card={(trend, edit) => <TrendMetricCard trend={trend} edit={edit} />} />;
}

/** As métricas salvas do boss, noite a noite, só para ver (o cartão de compartilhar). */
export function TrendMetricsStill({ tr, full = false }: { tr: Trends; full?: boolean }) {
  const bm = useMessages(bossMetricsMsg);
  const trends = useMemo(() => {
    const encounterId = tr.nights[0]?.summary.pulls[0]?.encounterId ?? 0;
    const nights = tr.nights.map((n) => ({ label: n.label, pulls: n.summary.pulls }));
    return savedBossMetrics(encounterId).flatMap((k) => metricTrend(nights, k) ?? []);
  }, [tr]);
  if (!trends.length) return null;
  return (
    <section className="panel boss-metrics trends-metrics">
      <h3>{bm.title}</h3>
      <div className="metric-grid">
        {trends.map((trend) => (
          <TrendMetricCard key={trend.key} trend={trend} full={full} />
        ))}
      </div>
    </section>
  );
}

function TrendMetricCard({ trend: m, edit, full = false }: { trend: MetricTrend; edit?: MetricEdit; full?: boolean }) {
  const t = useMessages(trendsViewMsg);
  const b = useMessages(bossMetricsMsg);
  const yd = m.unit === 'yd';
  const stack = m.kind === 'stack_limit';
  const found = m.nights.filter((n) => n.night != null);
  const total = found.reduce((s, n) => s + (n.night?.total ?? 0), 0);
  const value = yd ? b.yards(total) : m.damage != null ? b.damageTaken(num(m.damage)) : t.metricSummaryFailures(total);
  return (
    <article className="metric-card trend-metric">
      <header className="metric-head">
        <strong className="metric-name">
          <SpellName spellId={m.spellId} name={m.name} size={18} />
          {yd && <span className="muted small"> · {b.walked}</span>}
        </strong>
        {edit && <MetricTools edit={edit} name={m.name} />}
      </header>

      <p className="muted small">{t.metricSummary(value, found.length, m.nights.length)}</p>

      {m.players.length > 0 && (
        <TrendPeople
          title={m.kind === 'no_defensive' ? b.whoNoDefensive : yd ? b.whoYards : m.collective && m.kind !== 'failure_event' ? b.hit : b.who}
          people={m.players}
          stack={stack}
          yards={yd}
          damage={m.damage != null}
          still={!edit}
          full={full}
        />
      )}
    </article>
  );
}

function TrendPeople({ title, people, stack = false, yards = false, damage = false, still = false, full = false }: { title: string; people: MetricTrendPlayer[]; stack?: boolean; yards?: boolean; damage?: boolean; still?: boolean; full?: boolean }) {
  const t = useMessages(trendsViewMsg);
  const b = useMessages(bossMetricsMsg);
  return (
    <MetricPeople
      title={title}
      people={people}
      tone="bad"
      full={full}
      still={still}
      yards={yards}
      damage={damage}
      value={(p) => (yards ? b.yards(p.count) : stack ? b.inPulls(p.count) : b.times(p.count))}
      note={(p) => t.metricNights(p.nights)}
    />
  );
}

const PROG_AWARD_ORDER: { key: ProgAwardKey; tone: 'good' | 'bad' }[] = [
  { key: 'bestScore', tone: 'good' },
  { key: 'leastDamage', tone: 'good' },
  { key: 'fewestMechErrors', tone: 'good' },
  { key: 'mostTimeAlive', tone: 'good' },
  { key: 'mostImproved', tone: 'good' },
  { key: 'bestKillParse', tone: 'good' },
  { key: 'mostWipesCaused', tone: 'bad' },
  { key: 'mostDamage', tone: 'bad' },
  { key: 'mostMechErrors', tone: 'bad' },
  { key: 'mostWorsened', tone: 'bad' },
];

/** Tabela larga de mortes ("Quem mais / menos morre"): barra de mortes por pull com a parte "com algo livre" destacada. */
function DeathTableCard({ rows, scale, tone, title, extra }: { rows: DeathRow[]; scale: number; tone: 'good' | 'bad'; title: string; extra: boolean }) {
  const m = useMessages(trendsViewMsg);
  const width = (v: number) => `${scale > 0 ? Math.min(100, (v / scale) * 100) : 0}%`;
  return (
    <article className={`prog-award wide ${tone}`}>
      <span className="prog-award-label">{title}</span>
      <div className={`dtab-table${extra ? ' extra' : ''}`}>
        <div className="dtab-row dtab-head">
          <span />
          <span />
          <span>{m.deathBarLabel}</span>
          <span />
          <span title={m.deathFreeTitle}>{m.deathColFree}</span>
          {extra && <span title={m.deathFirstTitle}>{m.deathColFirst}</span>}
          {extra && <span title={m.deathBestTitle}>{m.deathColBest}</span>}
        </div>
        {rows.map((r, i) => (
          <div key={r.guid} className="dtab-row">
            <span className="prog-award-rank" aria-label={m.awardRank(i + 1)}>
              {m.awardRank(i + 1)}
            </span>
            <span className="dtab-name">
              <PlayerName name={r.name} guid={r.guid} cls={r.class} />
            </span>
            <span className="dtab-bar">
              {r.deaths === 0 ? (
                <span className="muted small">{m.awardNoDeaths}</span>
              ) : (
                <span className="dtab-track">
                  <i className="dtab-total" style={{ width: width(r.deaths) }} />
                  <i className="dtab-free" style={{ width: width(Math.min(r.free, r.deaths)) }} />
                </span>
              )}
            </span>
            <strong className="tabular">{fmt2(r.deaths)}</strong>
            <span className="tabular dtab-col">{fmt2(r.free)}</span>
            {extra && <span className="tabular dtab-col">{fmt2(r.first)}</span>}
            {extra && (
              <span className="tabular dtab-col" title={r.bestRate == null ? m.deathBestTitle : undefined}>
                {r.bestRate == null ? '—' : fmt2(r.bestRate)}
              </span>
            )}
          </div>
        ))}
      </div>
      <span className="dtab-legend muted small">
        <i className="dtab-swatch free" /> {m.deathLegendFree}
        <i className="dtab-swatch total" /> {m.deathLegendOther}
      </span>
      <span className="muted small">{m.deathCriterion}</span>
    </article>
  );
}

/** Melhores e piores da progressão: nota, dano evitável, mortes e erros de mecânica. */
export function ProgAwardsPanel({ awards, deathTable, progression }: { awards: ProgAwards; deathTable: DeathTable; progression: Progression | null }) {
  const m = useMessages(trendsViewMsg);
  const shown = PROG_AWARD_ORDER.filter((x) => awards[x.key]);
  if (shown.length === 0 && deathTable.most.length === 0 && deathTable.least.length === 0) return null;
  const criterion = (key: ProgAwardKey) =>
    key === 'bestScore'
      ? m.awardScoreCriterion
      : key === 'mostWipesCaused'
        ? m.awardWipesCriterion
        : key === 'leastDamage' || key === 'mostDamage'
        ? m.awardDamageCriterion
        : key === 'fewestMechErrors' || key === 'mostMechErrors'
          ? m.awardMechErrorsCriterion
          : key === 'mostTimeAlive'
            ? m.awardTimeAliveCriterion
            : key === 'mostImproved' || key === 'mostWorsened'
              ? m.awardMoveCriterion
              : m.awardKillParseCriterion;
  // tudo por pull: o valor fica à direita; embaixo do nome, em quantos pulls
  const detail = (key: ProgAwardKey, a: ProgAwardWinner) =>
    key === 'mostWipesCaused'
      ? m.awardWipesDetail(a.byDeath ?? 0, a.byMechanic ?? 0, a.byTank ?? 0, a.pulls)
      : key === 'mostImproved' || key === 'mostWorsened'
      ? m.awardSep(m.awardMove(a.from ?? 0, a.to ?? 0), m.awardPulls(a.pulls))
      : a.value === 0 && key === 'fewestMechErrors'
        ? m.awardSep(m.awardNoErrors, m.awardPulls(a.pulls))
        : m.awardPulls(a.pulls);
  const group = (tone: 'good' | 'bad', title: string) => {
    const items = shown.filter((x) => x.tone === tone);
    const table = tone === 'good' ? deathTable.least : deathTable.most;
    if (items.length === 0 && table.length === 0) return null;
    return (
      <div className="prog-awards-group">
        <h4 className={`prog-awards-heading ${tone}`}>{title}</h4>
        {/* o card de mortes ocupa a linha toda; os pequenos dividem a linha de baixo sem deixar buraco */}
        {table.length > 0 && <DeathTableCard rows={table} scale={deathTable.scale} tone={tone} title={tone === 'good' ? m.deathLeast : m.deathMost} extra={tone === 'bad'} />}
        <div className="prog-awards-grid">
          {items.map(({ key }) => {
            const list = awards[key]!;
            return (
              <article key={key} className={`prog-award ${tone}`}>
                <span className="prog-award-label">{m.awardLabels[key]}</span>
                <ol className="prog-award-top">
                  {list.map((a, i) => (
                    <li key={a.guid} className={i === 0 ? 'first' : undefined}>
                      <span className="prog-award-rank" aria-label={m.awardRank(i + 1)}>
                        {m.awardRank(i + 1)}
                      </span>
                      <span className="prog-award-who">
                        <PlayerName name={a.name} guid={a.guid} cls={a.class} />
                        <span className="muted small">{detail(key, a)}</span>
                        <span className="prog-award-bar" aria-hidden>
                          <i style={{ width: `${a.scale > 0 ? Math.min(100, (Math.abs(a.value) / a.scale) * 100) : 0}%` }} />
                        </span>
                      </span>
                      {key === 'bestScore' ? (
                        <span className={`score-pill ${scoreTier(a.value)}`}>{Math.round(a.value)}</span>
                      ) : key === 'leastDamage' || key === 'mostDamage' ? (
                        <strong className="tabular">{num(a.value)}</strong>
                      ) : key === 'mostTimeAlive' ? (
                        <strong className="tabular">{Math.round(a.value * 100)}%</strong>
                      ) : key === 'bestKillParse' ? (
                        <span className={`score-pill ${scoreTier(a.value)}`}>{Math.round(a.value)}</span>
                      ) : key === 'mostImproved' || key === 'mostWorsened' ? (
                        <strong className="tabular">{`${(a.to ?? 0) - (a.from ?? 0) > 0 ? '+' : ''}${(a.to ?? 0) - (a.from ?? 0)}`}</strong>
                      ) : (
                        <strong className="tabular">{fmt2(a.value)}</strong>
                      )}
                    </li>
                  ))}
                </ol>
                <span className="muted small">{criterion(key)}</span>
              </article>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <section className="panel">
      <h3>
        <Trophy size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> {m.progAwards}
        <Hint>{m.progAwardsHint}</Hint>
      </h3>
      {progression && <p className="muted small">{progression.killedOn ? m.progressionKilled(progression.pulls, progression.killedOn) : m.progressionOngoing(progression.pulls)}</p>}
      {group('good', m.awardsBest)}
      {group('bad', m.awardsWorst)}
    </section>
  );
}

