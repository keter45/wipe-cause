import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { GearItem, PlayerStats, Pull } from '../types';
import { mmss, num, shortName } from '../lib/format';
import {
  SECONDARY,
  SLOT_NAMES,
  BURST_LEAD_MS,
  BURST_WINDOW_MS,
  burstCandidates,
  burstWindows,
  candidates,
  combatPotions,
  compareItems,
  compareRotation,
  defaultReference,
  detectCooldowns,
  isHealer,
  outputPerSec,
  perfInsights,
  statSplit,
  talentDiff,
  totalCpm,
  type BurstSide,
  type BurstWindow,
  type Sample,
} from '../lib/performance';
import { ShareMenu } from './ShareMenu';
import { BossName, PlayerName } from './Names';
import { ErrorBoundary } from './ErrorBoundary';
import { specLabel } from '../lib/specs';
import { useTalentTree, type TalentTree } from '../lib/talents';
import { useTooltip } from '../lib/wowhead';
import { SpellIcon, SpellName } from './SpellIcon';
import { PerfLinks, WclTopsButton, perfLinks, useOwnFight, type PerfLink } from './WclTops';
import { RotationPanel } from './RotationPanel';
import { CooldownCompare, signedSec } from './CooldownCompare';
import { loadTop, type TopRanking, type TopSample } from '../lib/wclApi';

const PLAYER_KEY = 'wipe-cause:perf-player';

function rememberedPlayer(): string | null {
  try {
    return localStorage.getItem(PLAYER_KEY);
  } catch {
    return null;
  }
}
function rememberPlayer(name: string) {
  try {
    localStorage.setItem(PLAYER_KEY, name);
  } catch {
    /* sem storage */
  }
}

const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 } as const;
const sampleKey = (s: Sample) => `${s.pull.id}:${s.player.guid}`;

/** "Fulano · pull 14" / "você no pull 14" */
function refLabel(me: Sample, s: Sample): string {
  const who = s.player.guid === me.player.guid ? 'Você' : shortName(s.player.name);
  const where = s.pull.id === me.pull.id ? 'neste pull' : `pull ${s.pull.pullNumber}${s.pull.success ? ' (kill)' : ''}`;
  return `${who} · ${where}`;
}


/** Comparação de desempenho com a mesma spec na noite (etapa 1: sem dados externos). */
export function PerformanceView({ pull, nightPulls, wclCode, defaultGuid }: { pull: Pull; nightPulls: Pull[]; wclCode?: string; defaultGuid?: string }) {
  const players = useMemo(
    () =>
      [...pull.players]
        .filter((p) => p.specId != null)
        .sort((a, b) => ROLE_ORDER[a.role ?? 'dps'] - ROLE_ORDER[b.role ?? 'dps'] || a.name.localeCompare(b.name)),
    [pull],
  );
  const [guid, setGuid] = useState<string | null>(null);
  const player =
    players.find((p) => p.guid === guid) ?? players.find((p) => p.guid === defaultGuid) ?? players.find((p) => p.name === rememberedPlayer()) ?? players.find((p) => p.role === 'dps') ?? players[0];

  if (!player) return <p className="muted pad">Sem dados de spec dos jogadores neste pull.</p>;
  if (!player.casts) return <p className="muted pad">Esta análise é de uma versão antiga do app. Analise o log de novo para ver o desempenho.</p>;

  return (
    <div className="perf">
      <label className="perf-field">
        <span className="muted small">Jogador</span>
        <select
          className="select"
          value={player.guid}
          onChange={(e) => {
            setGuid(e.target.value);
            const p = players.find((x) => x.guid === e.target.value);
            if (p) rememberPlayer(p.name);
          }}
        >
          {players.map((p) => (
            <option key={p.guid} value={p.guid}>
              {shortName(p.name)} — {specLabel(p.specId)}
            </option>
          ))}
        </select>
      </label>
      {player.rotation ? (
        <ErrorBoundary label={`na rotação de ${shortName(player.name)}`} resetKey={player.guid}>
          <RotationPanel rotation={player.rotation} />
        </ErrorBoundary>
      ) : (
        <p className="rot-wip small">
          <span className="chip">Em construção</span> A leitura da rotação de {specLabel(player.specId)} ainda está sendo preparada. Por enquanto, use a
          comparação com a referência abaixo.
        </p>
      )}
      {/* erro na comparação de um jogador não some com o seletor: dá para escolher outro */}
      <ErrorBoundary label={`na comparação de ${shortName(player.name)}`} resetKey={player.guid}>
        <Comparison key={`${player.guid}:${pull.encounterId}:${pull.difficultyId}`} me={{ pull, player }} nightPulls={nightPulls} wclCode={wclCode} />
      </ErrorBoundary>
    </div>
  );
}

const topKey = (t: Pick<TopRanking, 'code' | 'fightId'>) => `top:${t.code}:${t.fightId}`;

type Mode = 'tops' | 'raid';

function Comparison({ me, nightPulls, wclCode }: { me: Sample; nightPulls: Pull[]; wclCode?: string }) {
  const list = useMemo(() => candidates(me, nightPulls), [me, nightPulls]);
  const [mode, setMode] = useState<Mode>('tops');
  const [raidKey, setRaidKey] = useState<string | null>(null);
  const [topSel, setTopSel] = useState<string | null>(null);
  const [tops, setTops] = useState<TopRanking[] | null>(null);
  const [loaded, setLoaded] = useState<Map<string, TopSample>>(new Map());
  const [topError, setTopError] = useState<string | null>(null);
  const wantTop = mode === 'tops' ? tops?.find((t) => topKey(t) === topSel) ?? tops?.[0] ?? null : null;
  const topSample = wantTop ? loaded.get(topKey(wantTop)) ?? null : null;
  const raidRef = list.find((s) => sampleKey(s) === raidKey) ?? defaultReference(me, list);
  const ref: Sample | null = mode === 'tops' ? topSample : raidRef;
  const cds = useMemo(() => detectCooldowns([me, ...list, ...loaded.values()]), [me, list, loaded]);

  // top escolhido e ainda não baixado: busca o fight dele
  useEffect(() => {
    if (!wantTop || loaded.has(topKey(wantTop))) return;
    let alive = true;
    setTopError(null);
    loadTop(wantTop, me, tops?.indexOf(wantTop) ?? 0)
      .then((s) => alive && setLoaded((m) => new Map(m).set(topKey(wantTop), s)))
      .catch((e) => alive && setTopError(String(e)));
    return () => {
      alive = false;
    };
  }, [wantTop, loaded, me, tops]);

  const own = useOwnFight(me.pull, me.player.name, wclCode);
  const links = perfLinks(me.player.name, own, wclCode, mode === 'tops' && topSample ? topSample.source : null);
  const healer = isHealer(me.player);
  const unit = healer ? 'HPS' : 'DPS';
  const picker = (
    <>
      <div className="segmented" role="radiogroup" aria-label="Comparar com">
        <button
          role="radio"
          aria-checked={mode === 'tops'}
          className={mode === 'tops' ? 'active' : ''}
          onClick={() => setMode('tops')}
          title="Só parses sem buffs externos (Power Infusion e afins): a referência é o que o player fez sozinho"
        >
          Top players (Warcraft Logs)
        </button>
        <button role="radio" aria-checked={mode === 'raid'} className={mode === 'raid' ? 'active' : ''} onClick={() => setMode('raid')}>
          Na própria raid
        </button>
      </div>
      {mode === 'tops' ? (
        <>
          <WclTopsButton me={me} onTops={setTops} />
          {tops && tops.length > 0 && (
            <div className="chips top-chips" role="radiogroup" aria-label="Top player">
              {tops.map((t, i) => {
                const k = topKey(t);
                const active = wantTop != null && topKey(wantTop) === k;
                return (
                  <button key={k} role="radio" aria-checked={active} className={active ? 'active' : ''} onClick={() => setTopSel(k)}>
                    <span className="top-rank">{i + 1}</span> {t.name}
                    <span className="muted">
                      {' '}
                      {num(t.amount)} {unit}
                      {t.itemLevel ? ` · ilvl ${t.itemLevel.toFixed(0)}` : ''} · {mmss(t.durationMs)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <label className="perf-field">
          <span className="muted small">Outro da mesma spec na noite (ou você em outra tentativa)</span>
          <select className="select" value={raidRef ? sampleKey(raidRef) : ''} onChange={(e) => setRaidKey(e.target.value)}>
            {!raidRef && <option value="">—</option>}
            {list.map((s) => (
              <option key={sampleKey(s)} value={sampleKey(s)}>
                {refLabel(me, s)} — {num(outputPerSec(s))} {unit} vivo
              </option>
            ))}
          </select>
        </label>
      )}
      <PerfLinks links={links} />
    </>
  );

  if (!ref)
    return (
      <>
        {picker}
        {mode === 'tops' ? (
          wantTop && <p className={`small ${topError ? 'bad' : 'muted'}`}>{topError ?? `Baixando o fight de ${wantTop.name} no Warcraft Logs…`}</p>
        ) : (
          <p className="muted pad">Ninguém mais jogou de {specLabel(me.player.specId)} neste boss na noite (nem você em outro pull com 30s+ vivo).</p>
        )}
      </>
    );

  const [mo, ro] = [outputPerSec(me), outputPerSec(ref)];
  const diff = ro > 0 ? ((mo - ro) / ro) * 100 : 0;
  const insights = perfInsights(me, ref, cds);
  const refName = mode === 'tops' && topSample ? `${topSample.source.name} (top ${num(topSample.source.amount)} ${unit})` : refLabel(me, ref);

  return (
    <>
      {picker}
      <div className="perf-bar">
        <p className="muted small perf-note">
          {mode === 'tops' ? 'Parse do Warcraft Logs com item level parecido' : 'Mesma spec, no mesmo boss e dificuldade'}. Tudo é por minuto vivo e os
          cooldowns são comparados só no tempo em que os dois estavam vivos, então dá para comparar um wipe com um kill.
        </p>
        <ShareMenu
          card={() => <PerfShareCard me={me} ref_={ref} refName={refName} cds={cds} links={links} />}
          pdf
          name={`${shortName(me.player.name)} - ${me.pull.encounterName} ${me.pull.difficultyName} - pull ${me.pull.pullNumber}`}
        />
      </div>

      <div className="death-stats perf-stats">
        <Stat label={`${healer ? 'Cura' : 'Dano'} por segundo vivo`} mine={num(mo)} ref={num(ro)} tone={diff <= -15 ? 'bad' : diff < -3 ? 'warn' : ''} extra={ro > 0 ? `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%` : undefined} />
        <Stat label="Tempo vivo" mine={mmss(me.player.aliveMs ?? 0)} ref={mmss(ref.player.aliveMs ?? 0)} />
        <Stat label="Casts por minuto" mine={totalCpm(me).toFixed(1)} ref={totalCpm(ref).toFixed(1)} />
        <Stat label="Item level" mine={me.player.setup?.itemLevel.toFixed(1) ?? '—'} ref={ref.player.setup?.itemLevel.toFixed(1) ?? '—'} />
      </div>

      {insights.length > 0 && (
        <section className="perf-section">
          <h4>Pontos principais</h4>
          <ul className="perf-insights">
            {insights.map((i, k) => (
              <li key={k} className={`tone-${i.tone}`}>
                {i.spellId != null && <SpellIcon spellId={i.spellId} size={16} />}
                {i.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Bursts me={me} ref_={ref} cds={cds} />
      <CooldownCompare me={me} ref_={ref} cds={cds} />
      <Rotation me={me} ref_={ref} cds={cds} />
      <Potions me={me} ref_={ref} />
      <SetupView me={me.player} ref_={ref.player} />
    </>
  );
}

function Stat({ label, mine, ref, tone = '', extra }: { label: string; mine: string; ref: string; tone?: string; extra?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className={tone}>
        {mine} {extra && <span className="small">({extra})</span>}
      </strong>
      <span className="muted small">referência: {ref}</span>
    </div>
  );
}

// ---- janelas de burst

const burstKey = (w: BurstWindow) => `${w.name}#${w.index}`;

/** Cada uso de cooldown maior vira uma janela (chip); dentro, a sequência de casts lado a lado. */
const PICK_KEY = 'wipe-cause:burst-cds:';

/** Cooldowns escolhidos para abrir janela, por spec (null = ainda não escolheu: usa os marcados de início). */
export function loadBurstPick(specId: number | null): Set<string> | null {
  try {
    const raw = specId != null ? localStorage.getItem(PICK_KEY + specId) : null;
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}
function saveBurstPick(specId: number | null, names: Set<string>) {
  try {
    if (specId != null) localStorage.setItem(PICK_KEY + specId, JSON.stringify([...names]));
  } catch {
    /* sem storage: vale só nesta sessão */
  }
}

function Bursts({ me, ref_, cds }: { me: Sample; ref_: Sample; cds: ReturnType<typeof detectCooldowns> }) {
  const specId = me.player.specId;
  const candidates = useMemo(() => burstCandidates(me, ref_, cds), [me, ref_, cds]);
  const [pick, setPick] = useState<Set<string> | null>(() => loadBurstPick(specId));
  const chosen = pick ?? new Set(candidates.filter((c) => c.preset).map((c) => c.name));
  const windows = useMemo(() => burstWindows(me, ref_, cds, chosen), [me, ref_, cds, [...chosen].join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState<string | null>(null);
  if (candidates.length === 0) return null;
  const w = windows.find((x) => burstKey(x) === sel) ?? windows[0];
  const toggle = (name: string) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPick(next);
    saveBurstPick(specId, next);
  };
  return (
    <section className="perf-section">
      <h4>
        Janelas de burst <span className="muted small">sequência de casts de {BURST_LEAD_MS / 1000}s antes a {BURST_WINDOW_MS / 1000}s depois de cada uso</span>
      </h4>
      <div className="burst-pick">
        <span className="muted small">Cooldowns para comparar ({specLabel(specId)}):</span>
        <div className="chips">
          {candidates.map((c) => {
            const on = chosen.has(c.name);
            return (
              <button key={c.name} aria-pressed={on} className={on ? 'active' : ''} onClick={() => toggle(c.name)}>
                <SpellIcon spellId={c.spellId} size={14} /> {c.name}
              </button>
            );
          })}
        </div>
      </div>
      {windows.length === 0 ? (
        <p className="muted small">Marque acima os cooldowns que abrem uma janela de burst.</p>
      ) : (
        <>
      <div className="chips burst-chips" role="radiogroup" aria-label="Janela de burst">
        {windows.map((x) => {
          const k = burstKey(x);
          const active = burstKey(w) === k;
          return (
            <button key={k} role="radio" aria-checked={active} className={`${active ? 'active' : ''} ${!x.mine ? 'missing' : ''}`} onClick={() => setSel(k)}>
              <SpellIcon spellId={x.spellId} size={16} /> {x.name} {x.index}
              <span className="muted"> {x.mine ? mmss(x.mine.start) : 'não usou'}</span>
            </button>
          );
        })}
      </div>
      <BurstCompare w={w} />
        </>
      )}
    </section>
  );
}

/** Posição (%) na janela de −3s a +20s. */
const burstPos = (dt: number) => ((dt + BURST_LEAD_MS) / (BURST_LEAD_MS + BURST_WINDOW_MS)) * 100;
/** Ícones mais perto que isto (em % da largura) vão para a linha de baixo. */
const ICON_GAP_PCT = 3.6;
const BURST_TICKS = [0, 5_000, 10_000, 15_000, 20_000];

/** Casts da janela no tempo, como a linha do tempo dos cooldowns: você em cima, referência embaixo. */
export function BurstCompare({ w }: { w: BurstWindow }) {
  return (
    <div className="burst-compare">
      <div className="burst-axis" aria-hidden>
        <span />
        <div className="burst-ticks">
          {BURST_TICKS.map((t) => (
            <span key={t} style={{ left: `${burstPos(t)}%` }}>
              {t === 0 ? 'uso' : `+${t / 1000}s`}
            </span>
          ))}
        </div>
      </div>
      <BurstLane label="Você" side={w.mine} />
      <BurstLane label="Referência" side={w.ref} />
      {w.mine && w.ref && (
        <p className="muted small">
          {w.mine.casts.length} casts contra {w.ref.casts.length} na janela · usado {signedSec(w.mine.start - w.ref.start)} em relação à referência (
          {mmss(w.mine.start)} × {mmss(w.ref.start)})
        </p>
      )}
    </div>
  );
}

function BurstLane({ label, side }: { label: string; side: BurstSide | null }) {
  // casts colados no tempo não se cobrem: cada um vai para a primeira linha livre
  const rows: number[] = [];
  const placed = (side?.casts ?? []).map((c) => {
    const pos = burstPos(c.dt);
    let row = rows.findIndex((last) => pos - last >= ICON_GAP_PCT);
    if (row < 0) row = rows.push(pos) - 1;
    else rows[row] = pos;
    return { c, pos, row };
  });
  return (
    <div className="burst-lane">
      <span className="muted small burst-who">{label}</span>
      {side ? (
        <ol className="burst-track" style={{ height: Math.max(1, rows.length) * 26 + 4 }} aria-label={`${label}: ${side.casts.map((c) => c.name).join(', ')}`}>
          <span className="burst-zero" style={{ left: `${burstPos(0)}%` }} aria-hidden />
          {placed.map(({ c, pos, row }, i) => (
            <li
              key={i}
              className={c.dt < 0 ? 'pre' : ''}
              style={{ left: `${pos}%`, top: row * 26 + 2 }}
              title={`${c.name} · ${c.dt >= 0 ? '+' : '−'}${(Math.abs(c.dt) / 1000).toFixed(1)}s`}
            >
              <SpellIcon spellId={c.spellId} size={22} />
            </li>
          ))}
        </ol>
      ) : (
        <span className="small warn">não usou este cooldown</span>
      )}
    </div>
  );
}

// ---- cartão para exportar e mandar ao jogador

/**
 * Relatório completo do jogador para mandar a quem não tem o app (PNG, HTML ou PDF): tudo o que a
 * aba mostra, aberto, com os links do fight (clicáveis no PDF e no HTML).
 */
export function PerfShareCard({
  me,
  ref_,
  refName,
  cds,
  links = [],
}: {
  me: Sample;
  ref_: Sample;
  refName: string;
  cds: ReturnType<typeof detectCooldowns>;
  links?: PerfLink[];
}) {
  const healer = isHealer(me.player);
  const [mo, ro] = [outputPerSec(me), outputPerSec(ref_)];
  const diff = ro > 0 ? ((mo - ro) / ro) * 100 : 0;
  const insights = perfInsights(me, ref_, cds);
  const windows = burstWindows(me, ref_, cds, loadBurstPick(me.player.specId) ?? undefined);
  return (
    <div className="share-card perf-card">
      <header className="share-head">
        <div>
          <div className="share-title">
            <PlayerName name={me.player.name} cls={me.player.class} /> · {specLabel(me.player.specId)}
          </div>
          <div className="share-sub">
            <BossName encounterId={me.pull.encounterId} name={`${me.pull.encounterName} ${me.pull.difficultyName}`} size={16} /> · pull {me.pull.pullNumber} (
            {me.pull.success ? 'kill' : 'wipe'}, {mmss(me.pull.durationMs)}) ·
            comparado com {refName}
          </div>
        </div>
        <div className={`share-big ${diff < -3 ? 'warn' : ''}`}>{ro > 0 ? `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%` : ''}</div>
      </header>

      <div className="death-stats perf-stats">
        <Stat label={`${healer ? 'Cura' : 'Dano'} por segundo vivo`} mine={num(mo)} ref={num(ro)} />
        <Stat label="Tempo vivo" mine={mmss(me.player.aliveMs ?? 0)} ref={mmss(ref_.player.aliveMs ?? 0)} />
        <Stat label="Casts por minuto" mine={totalCpm(me).toFixed(1)} ref={totalCpm(ref_).toFixed(1)} />
        <Stat label="Item level" mine={me.player.setup?.itemLevel.toFixed(1) ?? '—'} ref={ref_.player.setup?.itemLevel.toFixed(1) ?? '—'} />
      </div>

      {links.length > 0 && (
        <p className="perf-card-links small">
          {links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
              {l.who}: {l.label}
            </a>
          ))}
        </p>
      )}

      {insights.length > 0 && (
        <section className="perf-section">
          <h4>Pontos principais</h4>
          <ul className="perf-insights">
            {insights.map((i, k) => (
              <li key={k} className={`tone-${i.tone}`}>
                {i.spellId != null && <SpellIcon spellId={i.spellId} size={16} />}
                {i.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {windows.length > 0 && (
        <section className="perf-section">
          <h4>Janelas de burst</h4>
          {windows.map((w) => (
            <div key={burstKey(w)} className="perf-card-burst">
              <span className="perf-card-burst-title">
                <SpellName spellId={w.spellId} name={`${w.name} ${w.index}`} size={16} />
                <span className="muted small"> {w.mine ? mmss(w.mine.start) : 'não usou'}</span>
              </span>
              <BurstCompare w={w} />
            </div>
          ))}
        </section>
      )}

      <CooldownCompare me={me} ref_={ref_} cds={cds} expanded />
      <Rotation me={me} ref_={ref_} cds={cds} expanded />
      <Potions me={me} ref_={ref_} />
      <SetupView me={me.player} ref_={ref_.player} />

      <footer className="share-foot">
        <span className="share-brand">Wipe Cause</span>
        <span className="muted">Por minuto vivo; cooldowns no tempo em que os dois estavam vivos.</span>
      </footer>
    </div>
  );
}

// ---- rotação

function Rotation({ me, ref_, cds, expanded = false }: { me: Sample; ref_: Sample; cds: ReturnType<typeof detectCooldowns>; expanded?: boolean }) {
  const rows = compareRotation(me, ref_, cds);
  const [open, setShowAll] = useState(false);
  const showAll = open || expanded;
  if (rows.length === 0) return null;
  const core = rows.filter((r) => r.core);
  const shown = showAll ? rows : core;
  const what = isHealer(me.player) ? 'cura' : 'dano';
  const FLAG = { missing: 'não usou', low: 'abaixo', high: 'acima', extra: 'só você' } as const;
  return (
    <section className="perf-section">
      <h4>Rotação</h4>
      <div className="table-scroll">
        <table className="perf-table">
          <thead>
            <tr>
              <th>Habilidade</th>
              <th className="num">Você /min</th>
              <th className="num">Ref. /min</th>
              <th className="num">% do {what} (você)</th>
              <th className="num">% (ref.)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.spellId}>
                <td>
                  <SpellName spellId={r.spellId} name={r.name} size={16} />
                </td>
                <td className="num">{r.mineCpm.toFixed(1)}</td>
                <td className="num muted">{r.refCpm.toFixed(1)}</td>
                <td className="num">{r.mineShare != null ? `${r.mineShare.toFixed(1)}%` : '—'}</td>
                <td className="num muted">{r.refShare != null ? `${r.refShare.toFixed(1)}%` : '—'}</td>
                <td className={`small ${r.flag === 'missing' || r.flag === 'low' ? 'warn' : 'muted'}`}>{r.flag ? FLAG[r.flag] : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!expanded && core.length < rows.length && (
        <button className="link small more-toggle" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${showAll ? 'open' : ''}`} aria-hidden />
          {showAll ? 'Só a rotação' : `Mostrar ${rows.length - core.length} utilitária${rows.length - core.length > 1 ? 's' : ''} (movimento, buffs)`}
        </button>
      )}
    </section>
  );
}

// ---- poções

function Potions({ me, ref_ }: { me: Sample; ref_: Sample }) {
  const [mine, ref] = [combatPotions(me), combatPotions(ref_)];
  if (mine.length === 0 && ref.length === 0) return null;
  const line = (list: ReturnType<typeof combatPotions>) =>
    list.length === 0 ? (
      <span className="muted">nenhuma</span>
    ) : (
      list.map((c) => (
        <span key={c.spellId} className="perf-potion">
          <SpellName spellId={c.spellId} name={c.name} size={16} /> <span className="muted small">{c.times.map(mmss).join(', ')}</span>
        </span>
      ))
    );
  return (
    <section className="perf-section">
      <h4>Poção de combate</h4>
      <p className={`perf-line ${mine.length === 0 ? 'warn' : ''}`}>
        <span className="muted small perf-who">Você</span> {line(mine)}
      </p>
      <p className="perf-line">
        <span className="muted small perf-who">Referência</span> {line(ref)}
      </p>
    </section>
  );
}

// ---- setup

function SetupView({ me, ref_ }: { me: PlayerStats; ref_: PlayerStats }) {
  const { tree, error } = useTalentTree(me.specId);
  const [ms, rs] = [me.setup, ref_.setup];
  if (!ms || !rs) return null;
  const same = me.guid === ref_.guid;
  const [mSplit, rSplit] = [statSplit(ms.stats), statSplit(rs.stats)];
  const talents = talentDiff(ms.talents, rs.talents);
  const items = compareItems(ms.items, rs.items);
  return (
    <section className="perf-section">
      <h4>Setup</h4>
      <div className="perf-setup">
        <div>
          <h5 className="muted small">Distribuição de status secundários</h5>
          <table className="perf-table">
            <thead>
              <tr>
                <th>Status</th>
                <th className="num">Você</th>
                <th className="num">Ref.</th>
              </tr>
            </thead>
            <tbody>
              {SECONDARY.map((s) => {
                const d = mSplit[s.key] - rSplit[s.key];
                return (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td className={`num ${Math.abs(d) >= 8 ? 'warn' : ''}`}>
                      {mSplit[s.key].toFixed(0)}% <span className="muted small">({num(ms.stats[s.key])})</span>
                    </td>
                    <td className="num muted">
                      {rSplit[s.key].toFixed(0)}% <span className="small">({num(rs.stats[s.key])})</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <h5 className="muted small">Talentos {same && '(você mesmo em outro pull)'}</h5>
          {talents.onlyMine.length === 0 && talents.onlyRef.length === 0 && talents.rank.length === 0 ? (
            <p className="muted small">Mesmos talentos.</p>
          ) : (
            <div className="talent-diff">
              <TalentList title="Só você" list={talents.onlyMine} tree={tree} />
              <TalentList title="Só a referência" list={talents.onlyRef} tree={tree} />
            </div>
          )}
          {talents.rank.length > 0 && (
            <ul className="plain talent-list">
              <li className="muted small">Pontos diferentes (você → referência)</li>
              {talents.rank.map(([m, r]) => {
                const t = tree?.get(m[1]);
                return (
                  <li key={m[1]}>
                    {t ? <SpellName spellId={t.spellId} icon={t.icon} name={t.name} size={16} /> : <span className="muted">talento {m[1]}</span>}
                    <span className="small">
                      {m[2]} → {r[2]}
                      {t ? `/${t.maxRanks}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className="muted small">Sem os nomes dos talentos agora ({error}).</p>}
        </div>
      </div>
      <h5 className="muted small">Itens</h5>
      <div className="table-scroll">
        <table className="perf-table items">
          <thead>
            <tr>
              <th>Espaço</th>
              <th>Você</th>
              <th>Referência</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.slot} className={r.mine?.itemId !== r.ref?.itemId ? 'diff' : ''}>
                <td className="muted small">{SLOT_NAMES[r.slot]}</td>
                <td>
                  <ItemCell item={r.mine} missingEnchant={r.missingEnchant} missingGems={r.missingGems} />
                </td>
                <td>
                  <ItemCell item={r.ref} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TalentList({ title, list, tree }: { title: string; list: [number, number, number][]; tree: TalentTree | null }) {
  return (
    <div>
      <span className="muted small">{title}</span>
      {list.length === 0 ? (
        <p className="muted small">—</p>
      ) : (
        <ul className="plain talent-list">
          {list.map(([node, entry, rank]) => {
            const t = tree?.get(entry);
            return (
              <li key={`${node}:${entry}`}>
                {t ? <SpellName spellId={t.spellId} icon={t.icon} name={t.name} size={16} /> : <span className="muted">talento {entry}</span>}
                {t && t.maxRanks > 1 && <span className="muted small"> {rank}/{t.maxRanks}</span>}
                {t?.tree === 'hero' && <span className="chip mech">herói</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ItemCell({ item, missingEnchant, missingGems }: { item: GearItem | null; missingEnchant?: boolean; missingGems?: number }) {
  const tip = useTooltip(item?.itemId ?? -1, !!item, 'item');
  if (!item) return <span className="muted">—</span>;
  return (
    <span className="item-cell">
      <SpellIcon spellId={item.itemId} kind="item" size={18} />
      <span className={`item-name q${tip?.quality ?? ''}`}>{tip?.name ?? `item ${item.itemId}`}</span>
      <span className="muted small">{item.ilvl}</span>
      {item.enchant && <span className="chip mech" title={`Encantamento ${item.enchant}`}>enc.</span>}
      {item.gems.length > 0 && <span className="chip mech">{item.gems.length} gema{item.gems.length > 1 ? 's' : ''}</span>}
      {missingEnchant && <span className="chip">sem encantamento</span>}
      {!!missingGems && <span className="chip">−{missingGems} gema{missingGems > 1 ? 's' : ''}</span>}
    </span>
  );
}
