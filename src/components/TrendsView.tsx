import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Bot, Plus, RotateCw, ShieldOff, TrendingDown, TrendingUp, TriangleAlert, Trophy, X } from 'lucide-react';
import { historyTrends, type HistoryEntry } from '../lib/api';
import { classColor, num, pct, shortName } from '../lib/format';
import { buildTrends, byGroup, trendBosses, type NightInput, type PlayerMove, type ProgAwardKey, type ProgAwards, type ProgAwardWinner, type Progression, type ProgressionPlayer, type Trends } from '../lib/trends';
import { bossKey } from '../lib/night';
import { metricOptions, metricTrend, moveMetric, saveBossMetrics, savedBossMetrics, type MetricTrend, type MetricTrendPlayer } from '../lib/bossMetrics';
import { AddMetric, UnusedItems } from './BossMetrics';
import { bossMetricsMsg } from './BossMetrics.i18n';
import { scoreTier } from '../lib/score';
import { phaseCountOf, pullProgress } from '../lib/phases';
import { SpellName } from './SpellIcon';
import { Markdown } from './AskView';
import { withErrorBoundary } from './ErrorBoundary';
import { spellIndex } from '../lib/spells';
import { BossName, PlayerName } from './Names';
import { intlLocale, messagesOf, useMessages } from '../i18n';
import { trendsViewMsg } from './TrendsView.i18n';
import { Hint } from './ui/Hint';
import { useNightPotentials } from '../lib/botRaid';

/**
 * Evolução entre noites de um boss: progresso, causas de wipe por noite e o que se repete com
 * cada player. Usa todas as análises salvas no histórico.
 */
interface TrendsViewProps {
  /** noites salvas: o "Reanalisar as noites deste boss" usa o logPath de cada uma */
  history?: HistoryEntry[];
  /** roda o lote do "Analisar todos" (só no app) */
  onReanalyzeAll?: (paths: string[]) => Promise<void>;
  busy?: boolean;
  /** false no navegador, onde os logs locais não ficam disponíveis para reanalisar */
  canReanalyzeAll?: boolean;
}

function TrendsViewInner({ history = [], onReanalyzeAll, busy = false, canReanalyzeAll = false }: TrendsViewProps) {
  const t = useMessages(trendsViewMsg);
  const [nights, setNights] = useState<NightInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boss, setBoss] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setError(null);
    historyTrends()
      .then((xs) => setNights(xs.map((x) => ({ id: x.id, title: x.title, raidStartMs: x.raidStartMs, pulls: x.report.pulls }))))
      .catch((e) => setError(String(e)));
  }, [reload]);

  async function reanalyzeAll() {
    setConfirming(false);
    if (!onReanalyzeAll || reanalyze.paths.length === 0) return;
    await onReanalyzeAll(reanalyze.paths);
    setReload((n) => n + 1);
  }

  // a Evolução é da raid da guilda; noites com outros personagens e gente aleatória ficam à parte
  const [withPug, setWithPug] = useState(false);
  const grouped = useMemo(() => (nights ? byGroup(nights, withPug ? 'all' : 'guild') : null), [nights, withPug]);
  const bosses = useMemo(() => (grouped ? trendBosses(grouped.nights) : []), [grouped]);
  // sem escolha: o boss com mais pulls entre os que têm duas noites (a progressão do momento)
  const busiest = [...bosses].sort((a, b) => b.pulls - a.pulls);
  const selected = boss ?? busiest.find((b) => b.nights >= 2)?.key ?? busiest[0]?.key ?? null;
  const bossName = bosses.find((b) => b.key === selected)?.name ?? selected ?? '';
  // logs locais que sumiram do disco ficam de fora (a mesma regra dos outros botões de reanalisar);
  // só entram as noites salvas que têm pulls do boss + dificuldade selecionados
  const reanalyze = useMemo(() => {
    const ids = new Set<string>();
    if (selected && nights) {
      for (const n of nights) {
        if (n.pulls.some((p) => bossKey(p) === selected)) ids.add(n.id);
      }
    }
    const paths: string[] = [];
    let skipped = 0;
    for (const e of history) {
      if (!ids.has(e.id)) continue;
      if (e.logExists) paths.push(e.logPath);
      else skipped++;
    }
    return { paths, skipped };
  }, [history, nights, selected]);
  // uma linha por dificuldade (Mythic, Heroic...), cada uma na ordem da raide
  const rows = useMemo(() => {
    const out: { id: number; name: string; bosses: typeof bosses }[] = [];
    for (const b of bosses) {
      const row = out.find((r) => r.id === b.difficultyId);
      if (row) row.bosses.push(b);
      else out.push({ id: b.difficultyId, name: b.difficultyName, bosses: [b] });
    }
    return out;
  }, [bosses]);
  const trends = useMemo(() => (grouped && selected ? buildTrends(grouped.nights, selected) : null), [grouped, selected]);

  return (
    <div className="night trends">
      <header className="night-head">
        <h2>{t.title}</h2>
        <span className="muted small">{t.subtitle}</span>
        <span className="topbar-spacer" />
        {canReanalyzeAll && onReanalyzeAll && (
          <button
            className="btn sm"
            disabled={busy || reanalyze.paths.length === 0}
            onClick={() => setConfirming(true)}
            title={t.reanalyzeBossTitle(bossName)}
          >
            <RotateCw size={14} strokeWidth={1.5} aria-hidden /> {t.reanalyzeBoss}
          </button>
        )}
        {grouped && grouped.pugPulls > 0 && (
          <label className="trends-pug small" title={t.withPugTitle}>
            <input type="checkbox" checked={withPug} onChange={(e) => setWithPug(e.target.checked)} /> {t.withPug(grouped.pugPulls)}
          </label>
        )}
      </header>

      {confirming && (
        <div className="night-confirm trends-reanalyze-confirm">
          <p className="small">{t.reanalyzeBossConfirm(bossName, reanalyze.paths.length, reanalyze.skipped)}</p>
          <div className="night-actions">
            <button className="btn primary sm" disabled={busy} onClick={reanalyzeAll}>
              <RotateCw size={14} strokeWidth={1.5} aria-hidden /> {t.reanalyzeAllConfirm}
            </button>
            <button className="btn ghost sm" onClick={() => setConfirming(false)}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {error && <div className="error">{t.error(error)}</div>}
      {!nights && !error && <p className="muted">{t.reading}</p>}
      {nights && bosses.length === 0 && <p className="muted">{t.empty}</p>}

      {rows.length > 0 && (
        <div className="trends-bosses" role="tablist" aria-label={t.boss}>
          {rows.map((r) => (
            <div key={r.id} className="trends-difficulty">
              <span className="tile-label">{[14, 15, 16, 17].includes(r.id) ? r.name : t.otherDifficulty}</span>
              <div className="chips">
                {r.bosses.map((b) => (
                  <button key={b.key} role="tab" aria-selected={b.key === selected} className={b.key === selected ? 'active' : ''} onClick={() => setBoss(b.key)} title={b.key}>
                    <BossName encounterId={b.encounterId} name={b.name} size={16} />
                    <span className="muted">{t.nights(b.nights)}</span>
                  </button>
                ))}
              </div>
            </div>
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
  // % do potencial do robô por noite, das simulações salvas (coluna só aparece com alguma)
  const nightPulls = useMemo(() => t.nights.map((n) => ({ pulls: n.summary.pulls })), [t]);
  const names = useMemo(() => t.players.map((p) => p.name), [t]);
  const potentials = useNightPotentials(nightPulls, names);
  const hasPotential = [...potentials.values()].some((xs) => xs.some((v) => v != null));
  const hasParse = t.nights.some((n, i) => n.summary.kills > 0 && t.players.some((p) => p.perfPerNight[i] != null));
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
        <h3>{m.progress} <Hint>{m.progressHint}</Hint></h3>
        <div className="night-cols">
          {t.nights.map((n, _i, all) => {
            const phases = phaseCountOf(all.flatMap((x) => x.summary.pulls));
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

      <MetricsPanel tr={t} />

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
      </section>

      {t.progression && <ProgressionPanel pr={t.progression} />}

      <ProgAwardsPanel awards={t.progAwards} />

      {t.nights.length >= 2 && (
        <section className="panel">
          <div className="two-col moves">
            <Moves title={m.improving} icon="up" list={t.improving} hint={m.movesHint} />
            <Moves title={m.worsening} icon="down" list={t.worsening} />
          </div>
        </section>
      )}

      <section className="panel">
        <h3>{m.players}</h3>
        <div className="table-scroll">
          <table className="players trend-players">
            <thead>
              <tr>
                <th>{m.player}</th>
                <th title={m.avgScoreTitle}>{m.avgScoreCol}</th>
                <th title={m.deathsPerPullTitle}>{m.deathsPerPull}</th>
                {hasParse && <th title={m.avgParseTitle}>{m.avgParseCol}</th>}
                {hasPotential && <th title={m.avgPotentialTitle}>{m.avgPotentialCol}</th>}
                <th>{m.diesTo}</th>
                <th title={m.mistakesTitle}>{m.mistakes}</th>
              </tr>
            </thead>
            <tbody>
              {t.players.map((p) => {
                const pot = potentials.get(p.name);
                const avgPot = meanOf(pot);
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
                    <td title={nightsTitle(m.deathsPerPullTitle, (i) => (p.deathsPerPull[i] != null ? m.perPull(p.deathsPerPull[i]!.toFixed(2)) : m.didNotPlay))}>
                      <span className="trend-avg">
                        <strong className="tabular">{p.avgDeathsPerPull.toFixed(2)}</strong>
                        <span className="muted small">
                          {p.deaths}/{p.pulls}
                        </span>
                      </span>
                    </td>
                    {hasParse && (
                      <td title={nightsTitle(m.avgParseTitle, (i) => (p.perfPerNight[i] != null ? m.cellParse(Math.round(p.perfPerNight[i]!)) : m.didNotPlay))}>
                        {p.avgParse != null ? (
                          <span className={`trend-avg tone-${perfTone(p.avgParse)}`}>
                            <Trophy size={13} strokeWidth={1.75} aria-hidden /> {Math.round(p.avgParse)}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    )}
                    {hasPotential && (
                      <td title={nightsTitle(m.avgPotentialTitle, (i) => (pot?.[i] != null ? m.cellPotential(Math.round(pot[i]! * 100)) : m.didNotPlay))}>
                        {avgPot != null ? (
                          <span className={`trend-avg tone-${potentialTone(avgPot)}`}>
                            <Bot size={13} strokeWidth={1.75} aria-hidden /> {Math.round(avgPot * 100)}%
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    )}
                    <td>
                      {p.topKiller ? (
                        <>
                          <SpellName spellId={p.topKillerSpellId} name={p.topKiller[0]} size={16} /> <span className="muted">{p.topKiller[1]}×</span>
                        </>
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
          <p className="muted small trend-legend">
            <span className={`score-pill ${scoreTier(85)}`}>85</span> {m.legendScore}
            {hasPotential && (
              <>
                {' '}
                · <Bot size={12} aria-hidden /> {m.legendPotential}
              </>
            )}
            {hasParse && (
              <>
                {' '}
                · <Trophy size={12} aria-hidden /> {m.legendParse}
              </>
            )}
          </p>
        </div>
      </section>
    </>
  );
}

/** Quantas pessoas cada lista mostra antes do "+ N". */
const TREND_TOP = 5;

/** Métricas escolhidas do boss, com a evolução noite a noite (a mesma escolha salva do resumo). */
function MetricsPanel({ tr }: { tr: Trends }) {
  const bm = useMessages(bossMetricsMsg);
  const m = useMessages(trendsViewMsg);
  const pulls = useMemo(() => tr.nights.flatMap((n) => n.summary.pulls), [tr]);
  const encounterId = pulls[0]?.encounterId ?? 0;
  const [keys, setKeysState] = useState<string[]>(() => savedBossMetrics(encounterId));
  const [loadedFor, setLoadedFor] = useState(encounterId);
  if (loadedFor !== encounterId) {
    setLoadedFor(encounterId);
    setKeysState(savedBossMetrics(encounterId));
  }
  const setKeys = (k: string[]) => {
    setKeysState(k);
    saveBossMetrics(encounterId, k);
  };
  const options = useMemo(() => metricOptions(pulls), [pulls]);
  const trends = useMemo(
    () => keys.map((k) => ({ key: k, trend: metricTrend(tr.nights.map((n) => ({ label: n.label, pulls: n.summary.pulls })), k) })),
    [tr, keys],
  );
  const toggleKey = (k: string) => setKeys(keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k]);
  if (!options.length) return null;
  const suggestions = [
    ...options.filter((o) => !o.unit && o.failures > 0 && !keys.includes(o.key)).slice(0, 3),
    ...options.filter((o) => o.unit && o.amount && !keys.includes(o.key)),
  ];
  return (
    <section className="panel boss-metrics trends-metrics">
      <header className="boss-metrics-head">
        <div>
          <h3>{bm.title} <Hint>{m.metricsHint}</Hint></h3>
        </div>
        <span className="panel-head-actions">
          <AddMetric options={options} chosen={keys} onToggle={toggleKey} />
        </span>
      </header>
      {keys.length === 0 && suggestions.length > 0 && (
        <div className="metric-suggest">
          <span className="muted small">{bm.empty}</span>
          <div className="chips">
            {suggestions.map((o) => (
              <button key={o.key} onClick={() => toggleKey(o.key)}>
                <Plus size={12} strokeWidth={2} aria-hidden /> <SpellName spellId={o.spellId} name={o.name} size={14} />
                {o.unit && <span className="muted">· {bm.walked}</span>}
                <span className="muted tabular">{o.unit ? bm.yards(o.amount ?? 0) : o.failures}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {trends.length > 0 && (
        <div className="metric-grid">
          {trends.map(({ key, trend }, i) =>
            trend ? (
              <TrendMetricCard
                key={key}
                trend={trend}
                edit={{
                  onRemove: () => toggleKey(key),
                  onMove: (dir) => setKeys(moveMetric(keys, key, dir)),
                  first: i === 0,
                  last: i === trends.length - 1,
                }}
              />
            ) : (
              <article key={key} className="metric-card gone">
                <span className="muted small">{bm.gone(key)}</span>
                <button className="icon-btn" onClick={() => toggleKey(key)} title={bm.remove(key)} aria-label={bm.remove(key)}>
                  <X size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </article>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function TrendMetricCard({ trend: m, edit }: { trend: MetricTrend; edit: { onRemove: () => void; onMove: (dir: -1 | 1) => void; first: boolean; last: boolean } }) {
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
        <span className="metric-tools">
          <button className="icon-btn" disabled={edit.first} onClick={() => edit.onMove(-1)} title={b.moveUp} aria-label={b.moveUp}>
            <ArrowUp size={14} strokeWidth={1.5} aria-hidden />
          </button>
          <button className="icon-btn" disabled={edit.last} onClick={() => edit.onMove(1)} title={b.moveDown} aria-label={b.moveDown}>
            <ArrowDown size={14} strokeWidth={1.5} aria-hidden />
          </button>
          <button className="icon-btn" onClick={edit.onRemove} title={b.remove(m.name)} aria-label={b.remove(m.name)}>
            <X size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </span>
      </header>

      <p className="muted small">{t.metricSummary(value, found.length, m.nights.length)}</p>

      {m.players.length > 0 && (
        <TrendPeople
          title={m.kind === 'no_defensive' ? b.whoNoDefensive : yd ? b.whoYards : m.collective && m.kind !== 'failure_event' ? b.hit : b.who}
          people={m.players}
          stack={stack}
          yards={yd}
          damage={m.damage != null}
        />
      )}
    </article>
  );
}

function TrendPeople({ title, people, stack = false, yards = false, damage = false }: { title: string; people: MetricTrendPlayer[]; stack?: boolean; yards?: boolean; damage?: boolean }) {
  const t = useMessages(trendsViewMsg);
  const b = useMessages(bossMetricsMsg);
  const [all, setAll] = useState(false);
  const shown = all ? people : people.slice(0, TREND_TOP);
  return (
    <div className={`metric-people ${yards ? 'metric-people-yards' : ''} ${damage ? 'metric-people-damage' : ''}`}>
      <span className="tile-label">{title}</span>
      <ul className="plain">
        {shown.map((p) => (
          <li key={p.guid}>
            <PlayerName name={p.name} guid={p.guid} cls={p.class} />
            <strong className="tabular bad">{yards ? b.yards(p.count) : stack ? b.inPulls(p.count) : b.times(p.count)}</strong>
            <span className="muted small">{t.metricNights(p.nights)}</span>
            {damage && <span className="muted small tabular">{b.playerDamage(num(p.damage ?? 0))}</span>}
            {p.items && p.items.length > 0 && <UnusedItems player={p} />}
          </li>
        ))}
      </ul>
      {people.length > TREND_TOP && (
        <button className="btn ghost sm" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? '−' : t.metricMore(people.length - TREND_TOP)}
        </button>
      )}
    </div>
  );
}

/** Média dos valores presentes (null = sem dado). */
const meanOf = (xs: (number | null)[] | undefined) => {
  const vs = (xs ?? []).filter((x): x is number => x != null);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
};

/** % do potencial do robô: perto da média dele, um pouco abaixo, bem abaixo. */
const potentialTone = (v: number) => (v >= 0.97 ? 'good' : v >= 0.85 ? 'mid' : 'bad');

/** Faixa do parse: da mediana do Warcraft Logs para cima, um pouco abaixo, bem abaixo. */
const perfTone = (v: number) => (v >= 50 ? 'good' : v >= 25 ? 'mid' : 'bad');
const pctOf = (v: number) => Math.round(v);

const PROG_AWARD_ORDER: { key: ProgAwardKey; tone: 'good' | 'bad' }[] = [
  { key: 'bestScore', tone: 'good' },
  { key: 'leastDamage', tone: 'good' },
  { key: 'fewestDeaths', tone: 'good' },
  { key: 'bestPotUse', tone: 'good' },
  { key: 'fewestMechErrors', tone: 'good' },
  { key: 'mostTimeAlive', tone: 'good' },
  { key: 'mostImproved', tone: 'good' },
  { key: 'bestKillParse', tone: 'good' },
  { key: 'mostDamage', tone: 'bad' },
  { key: 'wipeCauser', tone: 'bad' },
  { key: 'mostDeaths', tone: 'bad' },
  { key: 'mostFreeDeaths', tone: 'bad' },
  { key: 'mostMechErrors', tone: 'bad' },
  { key: 'firstToDie', tone: 'bad' },
  { key: 'mostWorsened', tone: 'bad' },
];

/** Melhores e piores da progressão: nota, dano evitável, mortes e wipes causados. */
function ProgAwardsPanel({ awards }: { awards: ProgAwards }) {
  const m = useMessages(trendsViewMsg);
  const shown = PROG_AWARD_ORDER.filter((x) => awards[x.key]);
  if (shown.length === 0) return null;
  const criterion = (key: ProgAwardKey) =>
    key === 'bestScore'
      ? m.awardScoreCriterion
      : key === 'leastDamage' || key === 'mostDamage'
        ? m.awardDamageCriterion
        : key === 'bestPotUse' || key === 'mostFreeDeaths'
          ? m.awardFreeDeathsCriterion
          : key === 'wipeCauser'
            ? m.awardWipesCriterion
            : key === 'fewestMechErrors' || key === 'mostMechErrors'
              ? m.awardMechErrorsCriterion
              : key === 'mostTimeAlive'
                ? m.awardTimeAliveCriterion
                : key === 'firstToDie'
                  ? m.awardFirstDeathCriterion
                  : key === 'mostImproved' || key === 'mostWorsened'
                    ? m.awardMoveCriterion
                    : key === 'bestKillParse'
                      ? m.awardKillParseCriterion
                      : m.awardDeathsCriterion;
  const rate = (v: number) => m.awardRate(v.toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }), v > 0 ? Math.round(1 / v) : null);
  const detail = (key: ProgAwardKey, a: ProgAwardWinner) =>
    key === 'bestScore' || key === 'leastDamage' || key === 'mostDamage' || key === 'mostTimeAlive' || key === 'bestKillParse'
      ? m.awardPulls(a.pulls)
      : key === 'mostImproved' || key === 'mostWorsened'
        ? `${m.awardMove(a.from ?? 0, a.to ?? 0)} · ${m.awardPulls(a.pulls)}`
        : key === 'firstToDie'
          ? `${m.awardFirstDeaths(a.count ?? 0)} · ${rate(a.value)}`
          : key === 'wipeCauser'
            ? `${m.awardWipes(a.wipes ?? 0)} · ${rate(a.value)}`
            : rate(a.value);
  return (
    <section className="panel">
      <h3>
        <Trophy size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> {m.progAwards}
        <Hint>{m.progAwardsHint}</Hint>
      </h3>
      <div className="prog-awards-grid">
        {shown.map(({ key, tone }) => {
          const list = awards[key]!;
          const Icon = tone === 'good' ? Trophy : TriangleAlert;
          return (
            <article key={key} className={`prog-award ${tone}`}>
              <span className="prog-award-label">
                <Icon size={14} strokeWidth={1.75} aria-hidden /> {m.awardLabels[key]}
              </span>
              <ol className="prog-award-top">
                {list.map((a, i) => (
                  <li key={a.guid} className={i === 0 ? 'first' : undefined}>
                    <span className="prog-award-rank" aria-label={m.awardRank(i + 1)}>
                      {m.awardRank(i + 1)}
                    </span>
                    <span className="prog-award-who">
                      <PlayerName name={a.name} guid={a.guid} cls={a.class} />
                      <span className="muted small">{detail(key, a)}</span>
                    </span>
                    {key === 'bestScore' ? (
                      <span className={`score-pill ${scoreTier(a.value)}`}>{Math.round(a.value)}</span>
                    ) : key === 'leastDamage' || key === 'mostDamage' ? (
                      <strong className="tabular">{num(a.value)}</strong>
                    ) : key === 'mostTimeAlive' ? (
                      <strong className="tabular">{Math.round(a.value * 100)}%</strong>
                    ) : key === 'bestKillParse' ? (
                      <span className={`score-pill ${scoreTier(a.value)}`}>{Math.round(a.value)}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
              <span className="muted small">{criterion(key)}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

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
       <Hint>{m.progressionHint(pr.minPulls)}</Hint></h3>
      <p className="muted small">{pr.killedOn ? m.progressionKilled(pr.pulls, pr.killedOn) : m.progressionOngoing(pr.pulls)}</p>
      <div className="progression-cards">
        {card(m.bestScore, pr.best, 'score', 'good')}
        {card(m.worstScore, pr.worst, 'score', 'bad')}
        {card(m.bestPerf, pr.bestPerf, 'perf', 'good')}
        {card(m.worstPerf, pr.worstPerf, 'perf', 'bad')}
      </div>
    </section>
  );
}

/** Quem subiu (ou caiu) de nota entre o começo e o fim das noites, com o desempenho junto. */
function Moves({ title, icon, list, hint }: { title: string; icon: 'up' | 'down'; list: PlayerMove[]; hint?: string }) {
  const m = useMessages(trendsViewMsg);
  const Icon = icon === 'up' ? TrendingUp : TrendingDown;
  return (
    <div>
      <h3>
        <Icon size={16} strokeWidth={1.5} className={`inline-icon ${icon === 'up' ? 'good' : 'bad'}`} aria-hidden /> {title}
        {hint && <Hint>{hint}</Hint>}
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

export const TrendsView = withErrorBoundary(TrendsViewInner, () => messagesOf(trendsViewMsg).errorScope);
