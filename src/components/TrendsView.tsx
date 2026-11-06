import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCw, ShieldOff, TrendingUp, TriangleAlert, Trophy, X } from 'lucide-react';
import { historyTrends, type HistoryEntry } from '../lib/api';
import { classColor, num, pct, shortName } from '../lib/format';
import { buildTrends, byGroup, trendBosses, type NightInput, type DeathRow, type DeathTable, type ProgAwardKey, type ProgAwards, type ProgAwardWinner, type Progression, type Trends } from '../lib/trends';
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
import { DeathSeverityCard } from './DeathSeverityCard';
import { ProgDeathCards } from './ProgDeathCards';

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
  // nomes de habilidades citados nas frases ganham ícone
  const spells = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of t.nights) for (const p of n.summary.pulls) for (const [k, v] of spellIndex(p)) if (!m.has(k)) m.set(k, v);
    return m;
  }, [t]);
  const nightPulls = useMemo(() => t.nights.map((n) => n.summary.pulls), [t]);
  const allPulls = useMemo(() => nightPulls.flat(), [nightPulls]);
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

      <MetricsPanel tr={t} />

      <ProgAwardsPanel awards={t.progAwards} deathTable={t.deathTable} progression={t.progression} />

      <DeathSeverityCard pulls={allPulls} mode="evolution" />

      <ProgDeathCards nights={nightPulls} />

      <PlayersPanel tr={t} />
    </>
  );
}

/** Número com 2 casas no idioma do app (vírgula em pt-BR). */
const fmt2 = (v: number) => v.toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type PlayerSort = 'name' | 'score' | 'deaths' | 'diesTo' | 'mistakes';
/** Quem jogou menos que essa fração das trys fica escondido na tabela (dá para mostrar). */
const FEW_PULLS = 0.3;

/** Jogadores da Evolução: médias, ordenáveis por coluna; quem jogou pouco fica recolhido. */
function PlayersPanel({ tr: t }: { tr: Trends }) {
  const m = useMessages(trendsViewMsg);
  const [sort, setSort] = useState<{ key: PlayerSort; dir: 1 | -1 }>({ key: 'score', dir: -1 });
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
  const sorted = [...t.players].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
    return c * sort.dir || b.pulls - a.pulls || a.name.localeCompare(b.name);
  });
  const few = sorted.filter((p) => p.pulls < minPulls).length;
  const shown = showFew ? sorted : sorted.filter((p) => p.pulls >= minPulls);
  const header = (key: PlayerSort, label: string, title?: string) => {
    const on = sort.key === key;
    // nome começa de A a Z; números começam do maior
    const next = () => setSort(on ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 });
    return (
      <th title={title} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button className={`sort-btn ${on ? 'on' : ''}`} onClick={next} aria-label={m.sortBy(label)}>
          {label}
          {on ? sort.dir === 1 ? <ArrowUp size={12} strokeWidth={2} aria-hidden /> : <ArrowDown size={12} strokeWidth={2} aria-hidden /> : <ArrowDown size={12} strokeWidth={2} className="sort-hint" aria-hidden />}
        </button>
      </th>
    );
  };
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
        {few > 0 && (
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
      <div className={`death-table${extra ? ' extra' : ''}`}>
        <div className="death-row death-head">
          <span />
          <span />
          <span>{m.deathBarLabel}</span>
          <span />
          <span title={m.deathFreeTitle}>{m.deathColFree}</span>
          {extra && <span title={m.deathFirstTitle}>{m.deathColFirst}</span>}
          {extra && <span title={m.deathBestTitle}>{m.deathColBest}</span>}
        </div>
        {rows.map((r, i) => (
          <div key={r.guid} className="death-row">
            <span className="prog-award-rank" aria-label={m.awardRank(i + 1)}>
              {m.awardRank(i + 1)}
            </span>
            <span className="death-name">
              <PlayerName name={r.name} guid={r.guid} cls={r.class} />
            </span>
            <span className="death-bar">
              {r.deaths === 0 ? (
                <span className="muted small">{m.awardNoDeaths}</span>
              ) : (
                <span className="death-track">
                  <i className="death-total" style={{ width: width(r.deaths) }} />
                  <i className="death-free" style={{ width: width(Math.min(r.free, r.deaths)) }} />
                </span>
              )}
            </span>
            <strong className="tabular">{fmt2(r.deaths)}</strong>
            <span className="tabular death-col">{fmt2(r.free)}</span>
            {extra && <span className="tabular death-col">{fmt2(r.first)}</span>}
            {extra && (
              <span className="tabular death-col" title={r.bestRate == null ? m.deathBestTitle : undefined}>
                {r.bestRate == null ? '—' : fmt2(r.bestRate)}
              </span>
            )}
          </div>
        ))}
      </div>
      <span className="death-legend muted small">
        <i className="death-swatch free" /> {m.deathLegendFree}
        <i className="death-swatch total" /> {m.deathLegendOther}
      </span>
      <span className="muted small">{m.deathCriterion}</span>
    </article>
  );
}

/** Melhores e piores da progressão: nota, dano evitável, mortes e erros de mecânica. */
function ProgAwardsPanel({ awards, deathTable, progression }: { awards: ProgAwards; deathTable: DeathTable; progression: Progression | null }) {
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

export const TrendsView = withErrorBoundary(TrendsViewInner, () => messagesOf(trendsViewMsg).errorScope);
