import { useMemo, useState, type ReactNode } from 'react';
import { Award as AwardIcon, ChevronRight, EyeOff, Hand, Handshake, HeartPulse, ShieldCheck, ShieldOff, Skull, Swords, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Pull } from '../types';
import { classColor, mmss, num, pct, shortName } from '../lib/format';
import { bossKey, groupByBoss, summarizeNight, topBy, type Gap, type NightSummary as Summary, type PlayerNight } from '../lib/night';
import { dungeonsOnly, raidOnly } from '../lib/content';
import { BossName } from './Names';
import { lowestBossHp } from '../lib/verdict';
import { SpellName } from './SpellIcon';
import { scoreTone } from '../lib/score';
import { mechanicSpellId } from '../lib/spells';
import { ShareMenu } from './share/ShareMenu';
import { NightPhaseTimes } from './PhaseTimes';
import { NightStackOrigins } from './StackOrigins';
import { BossShareCard } from './share/BossCard';
import { NightShareCard } from './share/NightCard';
import { withErrorBoundary } from './ErrorBoundary';
import { bossPayload } from '../lib/discord';
import { messagesOf, useMessages } from '../i18n';
import { nightMsg } from './NightSummary.i18n';

interface Props {
  pulls: Pull[];
  onSelectPull: (id: number) => void;
}

function endClock(s: Summary): string {
  return s.pulls.length ? new Date(s.endMs + (s.pulls[0].tzOffsetHours ?? 0) * 3_600_000).toISOString().slice(11, 16) : '';
}

function duration(ms: number): string {
  // "2h 13min" serve para as duas línguas
  const min = Math.round(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min` : `${min}min`;
}

function clock(p: Pull): string {
  return p.startLocal.split(' ')[1]?.slice(0, 5) ?? '';
}

/** Visão geral da noite: tempo e downtime da raid inteira e um card por boss. */
function NightOverviewInner({ pulls: allPulls, onSelectPull, onSelectBoss }: Props & { onSelectBoss: (key: string) => void }) {
  // o foco é raid: masmorras (M+) não entram no tempo de raid nem nos cards
  const pulls = useMemo(() => raidOnly(allPulls), [allPulls]);
  const dungeonBosses = useMemo(() => groupByBoss(dungeonsOnly(allPulls)).length, [allPulls]);
  const s = useMemo(() => summarizeNight(pulls), [pulls]);
  const bosses = useMemo(() => groupByBoss(pulls).map((g) => ({ ...g, s: summarizeNight(g.pulls) })), [pulls]);
  const spellIds = useMechanicSpellIds(pulls);
  const t = useMessages(nightMsg);

  if (!pulls.length) return <p className="muted pad">{dungeonBosses ? t.onlyDungeons(dungeonBosses) : t.noPulls}</p>;

  return (
    <div className="night">
      <header className="night-head">
        <h2>{t.nightTitle}</h2>
        <span className="head-actions">
          <span className="muted small">{t.nightCounts(bosses.length, s.pulls.length, s.kills)}</span>
          <ShareMenu card={(detail) => <NightShareCard pulls={allPulls} detail={detail} />} name={t.shareNight(clock(s.pulls[0]))} />
        </span>
      </header>

      <div className="tiles">
        <Tile label={t.raidTime} value={duration(s.totalMs)} sub={`${clock(s.pulls[0])} → ${endClock(s)}`} />
        <Tile label={t.inCombat} value={s.totalMs ? `${Math.round((s.combatMs / s.totalMs) * 100)}%` : '—'} sub={duration(s.combatMs)} />
        <Tile label={t.downtime} value={duration(s.downtimeMs)} sub={t.breaks(s.gaps.filter((g) => g.isBreak).length)} />
        <Tile label={t.avgGap} value={mmss(s.avgGapMs)} sub={t.median(mmss(s.medianGapMs))} />
        <Tile label={t.longestGap} value={s.longestGap ? mmss(s.longestGap.ms) : '—'} sub={s.longestGap ? t.after(pullName(s.longestGap.after, true), s.longestGap.isBreak) : undefined} />
      </div>

      <section className="boss-cards" aria-label={t.bossesAria}>
        {bosses.map(({ key, s: b }) => {
          const top = b.causes.find((c) => c.triggers > 0);
          return (
            <button key={key} className="panel boss-card" onClick={() => onSelectBoss(key)}>
              <span className="boss-card-title">
                <BossName encounterId={b.pulls[0]?.encounterId} name={key} size={22} />
              </span>
              <span className="boss-card-result">{b.kills ? 'Kill' : b.best ? t.best(pct(b.best.hp)) : '—'}</span>
              <span className="muted small">{t.bossCardLine(b.pulls.length, b.wipes, duration(b.combatMs), clock(b.pulls[0]), endClock(b))}</span>
              {top ? (
                <span className="small boss-card-cause">
                  {t.topCause} <SpellName spellId={spellIds.get(top.key)} name={top.name} /> ({top.triggers}/{b.wipes} wipes)
                </span>
              ) : (
                <span className="muted small">{t.noTrigger}</span>
              )}
              <span className="boss-card-open small">
                {t.openBoss} <ChevronRight size={14} strokeWidth={1.5} aria-hidden />
              </span>
            </button>
          );
        })}
      </section>

      {dungeonBosses > 0 && (
        <p className="muted small">{t.alsoDungeons(dungeonBosses)}</p>
      )}

      <section className="panel">
        <h3>{t.nightTimeline}</h3>
        <p className="muted small">{t.timelineHint}</p>
        <Timeline s={s} onSelect={onSelectPull} />
        <GapList s={s} />
      </section>
    </div>
  );
}

function useMechanicSpellIds(pulls: Pull[]) {
  // ícone de cada mecânica (vem das regras do boss)
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pulls) for (const x of p.mechanics) if (x.spellId != null) m.set(x.key, x.spellId);
    return m;
  }, [pulls]);
}

/** Resumo de um boss: stats, maior causa, progresso, vilões/mocinhos, downtime e placar. */
function BossSummaryInner({ title, pulls, onSelectPull }: Props & { title: string }) {
  const s = useMemo(() => summarizeNight(pulls), [pulls]);
  const mechanicSpellIds = useMechanicSpellIds(pulls);
  const t = useMessages(nightMsg);

  if (!pulls.length) return <p className="muted pad">{t.noBossPulls(title)}</p>;
  const topCause = s.causes.find((c) => c.triggers > 0) ?? s.causes[0];

  return (
    <div className="night">
      <header className="night-head">
        <h2>
          <BossName encounterId={pulls[0]?.encounterId} name={title} size={26} />
        </h2>
        <span className="head-actions">
          <ShareMenu discord={() => bossPayload(title, s)} card={(detail) => <BossShareCard title={title} pulls={pulls} detail={detail} />} name={t.shareBoss(title)} />
        </span>
      </header>

      <div className="tiles">
        <Tile label={t.pulls} value={String(s.pulls.length)} sub={t.wipesKills(s.wipes, s.kills)} />
        <Tile
          label={t.bestPull}
          value={s.kills ? 'Kill' : s.best ? pct(s.best.hp) : '—'}
          sub={s.best ? t.pullAt(s.best.pull.pullNumber, clock(s.best.pull)) : undefined}
          onClick={s.best ? () => onSelectPull(s.best!.pull.id) : undefined}
        />
        <Tile label={t.bossTime} value={duration(s.totalMs)} sub={`${clock(s.pulls[0])} → ${endClock(s)}`} />
        <Tile label={t.inCombat} value={s.totalMs ? `${Math.round((s.combatMs / s.totalMs) * 100)}%` : '—'} sub={duration(s.combatMs)} />
        <Tile label={t.avgGap} value={mmss(s.avgGapMs)} sub={t.median(mmss(s.medianGapMs))} />
        <Tile label={t.longestGap} value={s.longestGap ? mmss(s.longestGap.ms) : '—'} sub={s.longestGap ? t.afterPull(s.longestGap.after.pullNumber, s.longestGap.isBreak) : undefined} />
      </div>

      {topCause && (
        <section className="panel hero-cause">
          <span className="muted small">{t.topCauseTitle}</span>
          <div className="hero-figure">
            <SpellName spellId={mechanicSpellIds.get(topCause.key)} name={topCause.name} size={30} />
          </div>
          <p className="muted">
            {topCause.triggers > 0 && t.triggerIn(topCause.triggers, s.wipes, Math.round((topCause.triggers / Math.max(1, s.wipes)) * 100))}
            {t.linked(topCause.deaths, topCause.failures)}
          </p>
        </section>
      )}

      <section className="panel">
        <h3>{t.progress}</h3>
        <p className="muted small">{t.progressHint}</p>
        <ProgressChart pulls={s.pulls} onSelect={onSelectPull} bestId={s.best?.pull.id} />
      </section>

      <NightPhaseTimes pulls={s.pulls} onSelectPull={onSelectPull} />
      <NightStackOrigins pulls={s.pulls} />

      <div className="two-col">
        <section className="panel">
          <h3>{t.causes}</h3>
          <CausesTable s={s} spellIds={mechanicSpellIds} />
        </section>
        <section className="panel">
          <h3>{t.timeline}</h3>
          <p className="muted small">{t.timelineHint}</p>
          <Timeline s={s} onSelect={onSelectPull} />
          <GapList s={s} />
        </section>
      </div>

      <div className="two-col">
        <Awards title={t.villains} tone="bad" players={s.players} awards={villainAwards()} overall={(p) => p.villainScore} overallLabel={t.villainOverall} reasons={villainReasons} />
        <Awards title={t.heroes} tone="good" players={s.players} awards={heroAwards()} overall={(p) => p.heroScore} overallLabel={t.heroOverall} reasons={heroReasons} />
      </div>

      <section className="panel">
        <h3>{t.scoreboard}</h3>
        <Scoreboard players={s.players} />
      </section>
    </div>
  );
}

function Tile({ label, value, sub, onClick }: { label: string; value: string; sub?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`tile ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Gráficos (SVG simples, uma série; tooltip por marca)

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function ProgressChart({ pulls, onSelect, bestId }: { pulls: Pull[]; onSelect: (id: number) => void; bestId?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const W = 760;
  const H = 180;
  const pad = { l: 34, r: 8, t: 14, b: 22 };
  const band = (W - pad.l - pad.r) / Math.max(1, pulls.length);
  const barW = Math.min(24, band - 2);
  const y = (v: number) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
  const base = y(0);

  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={messagesOf(nightMsg).progressAria}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 6} y={y(v) + 3} className="axis" textAnchor="end">
              {v}%
            </text>
          </g>
        ))}
        {pulls.map((p, i) => {
          const hp = p.success ? 0 : lowestBossHp(p) ?? 100;
          const cx = pad.l + band * i + band / 2;
          const top = y(hp);
          const h = Math.max(p.success ? 0 : 1, base - top);
          const label = p.success ? 'Kill' : p.id === bestId ? pct(hp) : null;
          return (
            <g
              key={p.id}
              className="bar-hit"
              tabIndex={0}
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(p.id)}
              onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, content: pullTip(p, hp) })}
              onFocus={() => setTip({ x: (cx / W) * 100, y: 10, content: pullTip(p, hp) })}
            >
              <rect x={cx - band / 2} y={pad.t} width={band} height={base - pad.t} fill="transparent" />
              {p.success ? (
                <circle cx={cx} cy={base - 6} r={5} className="mark-good" />
              ) : (
                <path d={roundedTop(cx - barW / 2, top, barW, h)} className={p.id === bestId ? 'mark mark-best' : 'mark'} />
              )}
              {label && (
                <text x={cx} y={p.success ? base - 16 : top - 4} className="value-label" textAnchor="middle">
                  {label}
                </text>
              )}
              {(pulls.length <= 30 || i % 2 === 0) && (
                <text x={cx} y={H - 6} className="axis" textAnchor="middle">
                  {p.pullNumber}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={base} y2={base} className="baseline" />
      </svg>
      {tip && <Tooltip tip={tip} />}
    </div>
  );
}

function pullTip(p: Pull, hp: number) {
  const t = messagesOf(nightMsg);
  return (
    <>
      <strong>{p.success ? 'Kill' : t.hp(pct(hp))}</strong>
      <span>
        {pullName(p, true)} · {clock(p)} · {mmss(p.durationMs)}
      </span>
      {p.trigger && (
        <span>
          {t.trigger} <SpellName spellId={mechanicSpellId(p, p.trigger.key)} name={p.trigger.name} size={14} />
        </span>
      )}
      <span>{t.deaths(p.deaths.filter((d) => !d.ignored).length)}</span>
    </>
  );
}

/** Coluna com o topo arredondado (4px) e base reta. */
function roundedTop(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function Tooltip({ tip }: { tip: Tip }) {
  return (
    <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y + 12 }} role="status">
      {tip.content}
    </div>
  );
}

function Timeline({ s, onSelect }: { s: Summary; onSelect: (id: number) => void }) {
  const [tip, setTip] = useState<Tip | null>(null);
  if (!s.pulls.length) return null;
  const W = 760;
  const H = 40;
  const x = (t: number) => ((t - s.startMs) / Math.max(1, s.totalMs)) * W;

  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={messagesOf(nightMsg).timelineAria}>
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="grid" />
        {s.gaps
          .filter((g) => g.isBreak)
          .map((g) => {
            const x1 = x(g.after.startMs + g.after.durationMs);
            const x2 = x(g.before.startMs);
            return (
              <text key={g.after.id} x={(x1 + x2) / 2} y={H / 2 - 8} className="axis" textAnchor="middle">
                {messagesOf(nightMsg).pauseMin(Math.round(g.ms / 60_000))}
              </text>
            );
          })}
        {s.pulls.map((p) => {
          const x1 = x(p.startMs);
          const w = Math.max(2, x(p.startMs + p.durationMs) - x1 - 1);
          return (
            <rect
              key={p.id}
              x={x1}
              y={H / 2 - 6}
              width={w}
              height={12}
              rx={2}
              className={p.success ? 'mark-good bar-hit' : 'mark bar-hit'}
              tabIndex={0}
              onClick={() => onSelect(p.id)}
              onMouseMove={(e) =>
                setTip({
                  x: e.nativeEvent.offsetX,
                  y: e.nativeEvent.offsetY,
                  content: pullTip(p, p.success ? 0 : lowestBossHp(p) ?? 100),
                })
              }
            />
          );
        })}
      </svg>
      {tip && <Tooltip tip={tip} />}
    </div>
  );
}

/** "pull 12" dentro de um boss; "The Twin Fangs 12" quando a tela mistura bosses. */
function pullName(p: Pull, withBoss: boolean): string {
  return withBoss ? `${p.encounterName} ${p.pullNumber}` : messagesOf(nightMsg).pull(p.pullNumber);
}

function gapLabel(g: Gap): string {
  const t = messagesOf(nightMsg);
  if (bossKey(g.after) !== bossKey(g.before)) return t.bossSwap(pullName(g.after, true), pullName(g.before, true));
  return t.between(g.after.pullNumber, g.before.pullNumber);
}

function GapList({ s }: { s: Summary }) {
  const longest = [...s.gaps].sort((a, b) => b.ms - a.ms).slice(0, 3);
  if (!longest.length) return null;
  return (
    <ul className="plain small gap-list">
      {longest.map((g) => (
        <li key={g.after.id}>
          <span className="muted">
            {clock(g.after)} → {clock(g.before)}
          </span>{' '}
          <strong>{mmss(g.ms)}</strong> {gapLabel(g)}
          {g.isBreak && <span className="chip">{messagesOf(nightMsg).pause}</span>}
        </li>
      ))}
    </ul>
  );
}

function CausesTable({ s, spellIds }: { s: Summary; spellIds: Map<string, number> }) {
  const rows = s.causes.filter((c) => c.triggers || c.deaths).slice(0, 8);
  const t = messagesOf(nightMsg);
  if (!rows.length) return <p className="muted small">{t.noRules}</p>;
  const max = Math.max(...rows.map((c) => c.triggers), 1);
  return (
    <table className="causes">
      <thead>
        <tr>
          <th>{t.mechanic}</th>
          <th>{t.wipeTrigger}</th>
          <th className="num">{t.deathsCol}</th>
          <th className="num">{t.failuresCol}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.key}>
            <td>
              <SpellName spellId={spellIds.get(c.key)} name={c.name} />
            </td>
            <td>
              <span className="inline-bar">
                <span style={{ width: `${(c.triggers / max) * 100}%` }} />
              </span>
              <span className="num-inline">{c.triggers}</span>
            </td>
            <td className="num">{c.deaths}</td>
            <td className="num">{c.failures}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Vilões e mocinhos

interface Award {
  icon: LucideIcon;
  label: string;
  score: (p: PlayerNight) => number;
  format: (p: PlayerNight) => string;
}

function villainAwards(): Award[] {
  const a = messagesOf(nightMsg).awards;
  return [
    { icon: Skull, label: a.decisive, score: (p) => p.decisiveDeaths, format: (p) => a.decisiveFmt(p.decisiveDeaths, p.pulls) },
    { icon: TriangleAlert, label: a.mechanics, score: (p) => p.mechanicErrorsWeighted, format: (p) => a.mechanicsFmt(p.mechanicErrors) },
    { icon: ShieldOff, label: a.noDefensive, score: (p) => p.deathsNoDefensive, format: (p) => `${p.deathsNoDefensive}×` },
    { icon: EyeOff, label: a.idle, score: (p) => p.idleInterruptPulls, format: (p) => a.idleFmt(p.idleInterruptPulls) },
  ];
}

function heroAwards(): Award[] {
  const a = messagesOf(nightMsg).awards;
  return [
    { icon: Hand, label: a.interrupts, score: (p) => p.interrupts, format: (p) => a.interruptsFmt(p.interrupts) },
    { icon: Handshake, label: a.assists, score: (p) => p.assists, format: (p) => a.assistsFmt(p.assists) },
    { icon: AwardIcon, label: a.score, score: (p) => (p.pulls >= 3 ? p.avgScore : 0), format: (p) => a.scoreFmt(Math.round(p.avgScore), p.pulls) },
    { icon: ShieldCheck, label: a.clean, score: (p) => p.cleanPulls, format: (p) => a.cleanFmt(p.cleanPulls, p.pulls) },
    { icon: Swords, label: a.dps, score: (p) => (p.role === 'dps' ? p.avgDps : 0), format: (p) => num(p.avgDps) },
    { icon: HeartPulse, label: a.hps, score: (p) => (p.role === 'healer' ? p.avgHps : 0), format: (p) => num(p.avgHps) },
  ];
}

function villainReasons(p: PlayerNight): string {
  const r = messagesOf(nightMsg).villainReasons;
  return [
    p.decisiveDeaths && r.decisive(p.decisiveDeaths),
    p.mechanicErrors && r.mechanics(p.mechanicErrors),
    p.deathsNoDefensive && r.noDefensive(p.deathsNoDefensive),
    p.idleInterruptPulls && r.idle(p.idleInterruptPulls),
  ]
    .filter(Boolean)
    .join(' · ');
}

function heroReasons(p: PlayerNight): string {
  const r = messagesOf(nightMsg).heroReasons;
  return [r.clean(p.cleanPulls, p.pulls), p.interrupts && r.interrupts(p.interrupts), p.assists && r.assists(p.assists)].filter(Boolean).join(' · ');
}

function Awards(props: {
  title: string;
  tone: 'good' | 'bad';
  players: PlayerNight[];
  awards: Award[];
  overall: (p: PlayerNight) => number;
  overallLabel: string;
  reasons: (p: PlayerNight) => string;
}) {
  const winner = topBy(props.players, props.overall, 1)[0];
  return (
    <section className={`panel awards ${props.tone}`}>
      <h3>{props.title}</h3>
      {winner && (
        <div className="award-winner">
          <span className="muted small">{props.overallLabel}</span>
          <strong style={{ color: classColor(winner.class) }}>{shortName(winner.name)}</strong>
          <span className="muted small">{props.reasons(winner)}</span>
        </div>
      )}
      <ul className="plain award-list">
        {props.awards.map((a) => {
          const top = topBy(props.players, a.score, 3);
          return (
            <li key={a.label}>
              <span className="award-label">
                <a.icon size={14} strokeWidth={1.5} className="inline-icon" aria-hidden /> {a.label}
              </span>
              <span className="award-people">
                {top.length === 0 ? (
                  <span className="muted">{messagesOf(nightMsg).nobody}</span>
                ) : (
                  top.map((p, i) => (
                    <span key={p.guid} className={i === 0 ? 'first' : 'muted'}>
                      <span style={{ color: classColor(p.class) }}>{shortName(p.name)}</span> {a.format(p)}
                    </span>
                  ))
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type SortKey = 'name' | 'avgScore' | 'deaths' | 'decisiveDeaths' | 'mechanicErrors' | 'deathsNoDefensive' | 'interrupts' | 'assists' | 'cleanPulls' | 'avgDps' | 'avgHps';
const SORT_KEYS: SortKey[] = ['name', 'avgScore', 'deaths', 'decisiveDeaths', 'mechanicErrors', 'deathsNoDefensive', 'interrupts', 'assists', 'cleanPulls', 'avgDps', 'avgHps'];

function columns(): { key: SortKey; label: string; title?: string }[] {
  const c = messagesOf(nightMsg).cols as Record<string, string>;
  return SORT_KEYS.map((key) => ({ key, label: c[key], title: c[`${key}Title`] }));
}

function Scoreboard({ players }: { players: PlayerNight[] }) {
  const [sort, setSort] = useState<SortKey>('decisiveDeaths');
  const rows = [...players].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) : sort === 'avgScore' ? a.avgScore - b.avgScore : (b[sort] as number) - (a[sort] as number),
  );
  return (
    <table className="players scoreboard">
      <thead>
        <tr>
          {columns().map((c) => (
            <th key={c.key} className={c.key === 'name' ? '' : 'num'} title={c.title}>
              <button className={`sort ${sort === c.key ? 'active' : ''}`} onClick={() => setSort(c.key)}>
                {c.label}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.guid}>
            <td style={{ color: classColor(p.class) }}>{shortName(p.name)}</td>
            <td className="num">
              <span className={`score-pill ${scoreTone(p.avgScore)}`}>{Math.round(p.avgScore)}</span>
            </td>
            <td className="num">{p.deaths}</td>
            <td className="num">{p.decisiveDeaths || ''}</td>
            <td className="num">{p.mechanicErrors || ''}</td>
            <td className="num">{p.deathsNoDefensive || ''}</td>
            <td className="num">{p.interrupts || ''}</td>
            <td className="num">{p.assists || ''}</td>
            <td className="num">
              {p.cleanPulls}/{p.pulls}
            </td>
            <td className="num">{p.avgDps >= 1000 ? num(p.avgDps) : ''}</td>
            <td className="num">{p.avgHps >= 1000 ? num(p.avgHps) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const NightOverview = withErrorBoundary(NightOverviewInner, () => messagesOf(nightMsg).errorNight);
export const BossSummary = withErrorBoundary(BossSummaryInner, () => messagesOf(nightMsg).errorBoss);
