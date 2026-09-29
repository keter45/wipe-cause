import { useMemo, useState, type ReactNode } from 'react';
import { Award as AwardIcon, ChevronRight, EyeOff, Hand, Handshake, HeartPulse, ShieldCheck, ShieldOff, Skull, Swords, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Pull } from '../types';
import { classColor, mmss, num, pct, shortName } from '../lib/format';
import { bossKey, groupByBoss, summarizeNight, topBy, type Gap, type NightSummary as Summary, type PlayerNight } from '../lib/night';
import { lowestBossHp } from '../lib/verdict';
import { SpellName } from './SpellIcon';
import { scoreTone } from '../lib/score';
import { SendToDiscord } from './SendToDiscord';
import { ShareMenu } from './ShareMenu';
import { BossShareCard } from './ShareCards';
import { bossPayload } from '../lib/discord';

interface Props {
  pulls: Pull[];
  onSelectPull: (id: number) => void;
}

function endClock(s: Summary): string {
  return s.pulls.length ? new Date(s.endMs + (s.pulls[0].tzOffsetHours ?? 0) * 3_600_000).toISOString().slice(11, 16) : '';
}

function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min` : `${min}min`;
}

function clock(p: Pull): string {
  return p.startLocal.split(' ')[1]?.slice(0, 5) ?? '';
}

/** Visão geral da noite: tempo e downtime da raid inteira e um card por boss. */
export function NightOverview({ pulls, onSelectPull, onSelectBoss }: Props & { onSelectBoss: (key: string) => void }) {
  const s = useMemo(() => summarizeNight(pulls), [pulls]);
  const bosses = useMemo(() => groupByBoss(pulls).map((g) => ({ ...g, s: summarizeNight(g.pulls) })), [pulls]);
  const spellIds = useMechanicSpellIds(pulls);

  if (!pulls.length) return <p className="muted pad">Nenhum pull no log.</p>;

  return (
    <div className="night">
      <header className="night-head">
        <h2>Resumo da noite</h2>
        <span className="muted small">
          {bosses.length} boss{bosses.length > 1 ? 'es' : ''} · {s.pulls.length} pulls · {s.kills} kill{s.kills === 1 ? '' : 's'}
        </span>
      </header>

      <div className="tiles">
        <Tile label="Tempo de raid" value={duration(s.totalMs)} sub={`${clock(s.pulls[0])} → ${endClock(s)}`} />
        <Tile label="Em combate" value={s.totalMs ? `${Math.round((s.combatMs / s.totalMs) * 100)}%` : '—'} sub={duration(s.combatMs)} />
        <Tile label="Downtime" value={duration(s.downtimeMs)} sub={`${s.gaps.filter((g) => g.isBreak).length} pausa(s) de 10min+`} />
        <Tile label="Entre trys (média)" value={mmss(s.avgGapMs)} sub={`mediana ${mmss(s.medianGapMs)}`} />
        <Tile
          label="Maior intervalo"
          value={s.longestGap ? mmss(s.longestGap.ms) : '—'}
          sub={s.longestGap ? `após ${pullName(s.longestGap.after, true)}${s.longestGap.isBreak ? ' (pausa)' : ''}` : undefined}
        />
      </div>

      <section className="boss-cards" aria-label="Bosses da noite">
        {bosses.map(({ key, s: b }) => {
          const top = b.causes.find((c) => c.triggers > 0);
          return (
            <button key={key} className="panel boss-card" onClick={() => onSelectBoss(key)}>
              <span className="boss-card-title">{key}</span>
              <span className="boss-card-result">{b.kills ? 'Kill' : b.best ? `melhor ${pct(b.best.hp)}` : '—'}</span>
              <span className="muted small">
                {b.pulls.length} pulls · {b.wipes} wipes · {duration(b.combatMs)} em combate · {clock(b.pulls[0])} → {endClock(b)}
              </span>
              {top ? (
                <span className="small boss-card-cause">
                  Maior causa: <SpellName spellId={spellIds.get(top.key)} name={top.name} /> ({top.triggers}/{b.wipes} wipes)
                </span>
              ) : (
                <span className="muted small">Sem gatilho apontado</span>
              )}
              <span className="boss-card-open small">
                Ver resumo do boss <ChevronRight size={14} strokeWidth={1.5} aria-hidden />
              </span>
            </button>
          );
        })}
      </section>

      <section className="panel">
        <h3>Linha do tempo da noite</h3>
        <p className="muted small">Blocos = pulls; espaços = downtime. Intervalos de 10min ou mais contam como pausa.</p>
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
export function BossSummary({ title, pulls, onSelectPull }: Props & { title: string }) {
  const s = useMemo(() => summarizeNight(pulls), [pulls]);
  const mechanicSpellIds = useMechanicSpellIds(pulls);

  if (!pulls.length) return <p className="muted pad">Nenhum pull de {title} nesta análise.</p>;
  const topCause = s.causes.find((c) => c.triggers > 0) ?? s.causes[0];

  return (
    <div className="night">
      <header className="night-head">
        <h2>{title}</h2>
        <span className="head-actions">
          <SendToDiscord payload={() => bossPayload(title, s)} label="Enviar resumo ao Discord" />
          <ShareMenu card={() => <BossShareCard title={title} pulls={pulls} />} name={`Resumo - ${title}`} />
        </span>
      </header>

      <div className="tiles">
        <Tile label="Pulls" value={String(s.pulls.length)} sub={`${s.wipes} wipes · ${s.kills} kills`} />
        <Tile
          label="Melhor pull"
          value={s.kills ? 'Kill' : s.best ? pct(s.best.hp) : '—'}
          sub={s.best ? `pull ${s.best.pull.pullNumber} · ${clock(s.best.pull)}` : undefined}
          onClick={s.best ? () => onSelectPull(s.best!.pull.id) : undefined}
        />
        <Tile label="Tempo no boss" value={duration(s.totalMs)} sub={`${clock(s.pulls[0])} → ${endClock(s)}`} />
        <Tile label="Em combate" value={s.totalMs ? `${Math.round((s.combatMs / s.totalMs) * 100)}%` : '—'} sub={duration(s.combatMs)} />
        <Tile label="Entre trys (média)" value={mmss(s.avgGapMs)} sub={`mediana ${mmss(s.medianGapMs)}`} />
        <Tile
          label="Maior intervalo"
          value={s.longestGap ? mmss(s.longestGap.ms) : '—'}
          sub={s.longestGap ? `após o pull ${s.longestGap.after.pullNumber}${s.longestGap.isBreak ? ' (pausa)' : ''}` : undefined}
        />
      </div>

      {topCause && (
        <section className="panel hero-cause">
          <span className="muted small">Maior causa dos wipes</span>
          <div className="hero-figure">{topCause.name}</div>
          <p className="muted">
            {topCause.triggers > 0 && (
              <>
                gatilho em <strong>{topCause.triggers}</strong> de {s.wipes} wipes ({Math.round((topCause.triggers / Math.max(1, s.wipes)) * 100)}%) ·{' '}
              </>
            )}
            <strong>{topCause.deaths}</strong> mortes ligadas · {topCause.failures} falhas
          </p>
        </section>
      )}

      <section className="panel">
        <h3>Progresso por pull</h3>
        <p className="muted small">HP do boss no fim de cada pull (menor = mais perto do kill). Clique numa barra para abrir o pull.</p>
        <ProgressChart pulls={s.pulls} onSelect={onSelectPull} bestId={s.best?.pull.id} />
      </section>

      <div className="two-col">
        <section className="panel">
          <h3>Causas dos wipes</h3>
          <CausesTable s={s} spellIds={mechanicSpellIds} />
        </section>
        <section className="panel">
          <h3>Linha do tempo</h3>
          <p className="muted small">Blocos = pulls; espaços = downtime. Intervalos de 10min ou mais contam como pausa.</p>
          <Timeline s={s} onSelect={onSelectPull} />
          <GapList s={s} />
        </section>
      </div>

      <div className="two-col">
        <Awards title="Vilões" tone="bad" players={s.players} awards={VILLAIN_AWARDS} overall={(p) => p.villainScore} overallLabel="Vilão neste boss" reasons={villainReasons} />
        <Awards title="Mocinhos" tone="good" players={s.players} awards={HERO_AWARDS} overall={(p) => p.heroScore} overallLabel="Mocinho neste boss" reasons={heroReasons} />
      </div>

      <section className="panel">
        <h3>Placar</h3>
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
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="HP do boss no fim de cada pull">
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
  return (
    <>
      <strong>{p.success ? 'Kill' : `${pct(hp)} de HP`}</strong>
      <span>
        {pullName(p, true)} · {clock(p)} · {mmss(p.durationMs)}
      </span>
      {p.trigger && <span>Gatilho: {p.trigger.name}</span>}
      <span>{p.deaths.filter((d) => !d.ignored).length} mortes</span>
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
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Linha do tempo: pulls e intervalos">
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="grid" />
        {s.gaps
          .filter((g) => g.isBreak)
          .map((g) => {
            const x1 = x(g.after.startMs + g.after.durationMs);
            const x2 = x(g.before.startMs);
            return (
              <text key={g.after.id} x={(x1 + x2) / 2} y={H / 2 - 8} className="axis" textAnchor="middle">
                pausa {Math.round(g.ms / 60_000)}min
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
  return withBoss ? `${p.encounterName} ${p.pullNumber}` : `pull ${p.pullNumber}`;
}

function gapLabel(g: Gap): string {
  if (bossKey(g.after) !== bossKey(g.before)) return `troca de boss: ${pullName(g.after, true)} → ${pullName(g.before, true)}`;
  return `entre o pull ${g.after.pullNumber} e o ${g.before.pullNumber}`;
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
          {g.isBreak && <span className="chip">pausa</span>}
        </li>
      ))}
    </ul>
  );
}

function CausesTable({ s, spellIds }: { s: Summary; spellIds: Map<string, number> }) {
  const rows = s.causes.filter((c) => c.triggers || c.deaths).slice(0, 8);
  if (!rows.length) return <p className="muted small">Sem regras de boss para apontar causas.</p>;
  const max = Math.max(...rows.map((c) => c.triggers), 1);
  return (
    <table className="causes">
      <thead>
        <tr>
          <th>Mecânica</th>
          <th>Gatilho do wipe</th>
          <th className="num">Mortes</th>
          <th className="num">Falhas</th>
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

const VILLAIN_AWARDS: Award[] = [
  { icon: Skull, label: 'Mais mortes decisivas', score: (p) => p.decisiveDeaths, format: (p) => `${p.decisiveDeaths} em ${p.pulls} pulls` },
  { icon: TriangleAlert, label: 'Mais erros de mecânica', score: (p) => p.mechanicErrorsWeighted, format: (p) => `${p.mechanicErrors} erros` },
  { icon: ShieldOff, label: 'Morreu com defensivo sobrando', score: (p) => p.deathsNoDefensive, format: (p) => `${p.deathsNoDefensive}×` },
  { icon: EyeOff, label: 'Tinha interrupt e não cortou', score: (p) => p.idleInterruptPulls, format: (p) => `${p.idleInterruptPulls} pulls` },
];

const HERO_AWARDS: Award[] = [
  { icon: Hand, label: 'Mais interrupts', score: (p) => p.interrupts, format: (p) => `${p.interrupts} cortes` },
  { icon: Handshake, label: 'Mais ajuda em mecânicas', score: (p) => p.assists, format: (p) => `${p.assists} ajudas` },
  { icon: AwardIcon, label: 'Melhor nota média', score: (p) => (p.pulls >= 3 ? p.avgScore : 0), format: (p) => `${Math.round(p.avgScore)} em ${p.pulls} pulls` },
  { icon: ShieldCheck, label: 'Pulls limpos', score: (p) => p.cleanPulls, format: (p) => `${p.cleanPulls} de ${p.pulls}` },
  { icon: Swords, label: 'Maior DPS médio', score: (p) => (p.role === 'dps' ? p.avgDps : 0), format: (p) => num(p.avgDps) },
  { icon: HeartPulse, label: 'Maior HPS médio', score: (p) => (p.role === 'healer' ? p.avgHps : 0), format: (p) => num(p.avgHps) },
];

function villainReasons(p: PlayerNight): string {
  return [
    p.decisiveDeaths && `${p.decisiveDeaths} mortes decisivas`,
    p.mechanicErrors && `${p.mechanicErrors} erros de mecânica`,
    p.deathsNoDefensive && `${p.deathsNoDefensive} mortes com defensivo sobrando`,
    p.idleInterruptPulls && `${p.idleInterruptPulls} pulls sem cortar`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function heroReasons(p: PlayerNight): string {
  return [`${p.cleanPulls}/${p.pulls} pulls limpos`, p.interrupts && `${p.interrupts} interrupts`, p.assists && `${p.assists} ajudas em mecânica`]
    .filter(Boolean)
    .join(' · ');
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
                  <span className="muted">ninguém</span>
                ) : (
                  top.map((p, i) => (
                    <span key={p.guid} className={i === 0 ? 'first' : 'muted'}>
                      <span style={{ color: i === 0 ? classColor(p.class) : undefined }}>{shortName(p.name)}</span> {a.format(p)}
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
const COLS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'name', label: 'Jogador' },
  { key: 'avgScore', label: 'Nota', title: 'Nota média (0-100) nos pulls em que jogou' },
  { key: 'deaths', label: 'Mortes' },
  { key: 'decisiveDeaths', label: 'Decisivas', title: 'Mortes antes da cascata do wipe' },
  { key: 'mechanicErrors', label: 'Erros mec.' },
  { key: 'deathsNoDefensive', label: 'Sem def.', title: 'Mortes decisivas sem usar defensivo disponível' },
  { key: 'interrupts', label: 'Interrupts' },
  { key: 'assists', label: 'Ajudas', title: 'Soaks e outras ajudas em mecânicas (hits recebidos no lugar do raid)' },
  { key: 'cleanPulls', label: 'Limpos', title: 'Pulls sem morte decisiva e sem erro de mecânica' },
  { key: 'avgDps', label: 'DPS médio' },
  { key: 'avgHps', label: 'HPS médio' },
];

function Scoreboard({ players }: { players: PlayerNight[] }) {
  const [sort, setSort] = useState<SortKey>('decisiveDeaths');
  const rows = [...players].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) : sort === 'avgScore' ? a.avgScore - b.avgScore : (b[sort] as number) - (a[sort] as number),
  );
  return (
    <table className="players scoreboard">
      <thead>
        <tr>
          {COLS.map((c) => (
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
