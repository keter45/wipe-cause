import { useEffect, useMemo, useState } from 'react';
import type { Pull } from '../../types';
import { mmss, num, shortName } from '../../lib/format';
import { candidates, defaultReference, detectCooldowns, isHealer, outputPerSec, perfInsights, totalCpm, type Sample } from '../../lib/performance';
import { ShareMenu } from '../share/ShareMenu';
import { ErrorBoundary } from '../ErrorBoundary';
import { specLabel } from '../../lib/specs';
import { SpellIcon } from '../SpellIcon';
import { PerfLinks, WclTopsButton, perfLinks, useWclFight } from '../WclTops';
import { RotationPanel } from '../RotationPanel';
import { CooldownCompare } from './CooldownCompare';
import { loadTop, type TopRanking, type TopSample } from '../../lib/wclApi';

import { Stat, Bursts, Rotation, Potions, SetupView } from './sections';
import { PerfShareCard } from '../share/PerfCard';
import { Advantage, TakenMore } from './Advantage';
import { compareWithTops, decisionRefFor } from '../../lib/bench';
import { compareWithLog, povOf } from '../../lib/decisions';
import { DecisionList } from '../DecisionList';
import { soloPullMsg } from '../SoloPullView.i18n';
import { TrendingDown } from 'lucide-react';
import { messagesOf, useMessages } from '../../i18n';
import { perfViewMsg } from './perf.i18n';

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
  const t = messagesOf(perfViewMsg);
  const who = s.player.guid === me.player.guid ? t.you : shortName(s.player.name);
  const where = s.pull.id === me.pull.id ? t.thisPull : t.pullN(s.pull.pullNumber, s.pull.success);
  return `${who} · ${where}`;
}


/**
 * O desempenho de um player comparado com uma referência: um top do Warcraft Logs ou alguém da mesma
 * spec na noite. No modo guilda vem com a rotação (e a referência dos tops do boss); no modo solo a
 * rotação já está na aba Você, e o player é o escolhido lá (`solo`).
 */
export function PerformanceView({ pull, nightPulls, wclCode, defaultGuid, solo = false }: { pull: Pull; nightPulls: Pull[]; wclCode?: string; defaultGuid?: string; solo?: boolean }) {
  const players = useMemo(
    () =>
      [...pull.players]
        .filter((p) => p.specId != null)
        .sort((a, b) => ROLE_ORDER[a.role ?? 'dps'] - ROLE_ORDER[b.role ?? 'dps'] || a.name.localeCompare(b.name)),
    [pull],
  );
  const t = useMessages(perfViewMsg);
  const [guid, setGuid] = useState<string | null>(null);
  const player =
    players.find((p) => p.guid === guid) ?? players.find((p) => p.guid === defaultGuid) ?? players.find((p) => p.name === rememberedPlayer()) ?? players.find((p) => p.role === 'dps') ?? players[0];

  if (!player) return <p className="muted pad">{t.noSpecs}</p>;
  if (!player.casts) return <p className="muted pad">{t.oldAnalysis}</p>;

  return (
    <div className="perf">
      {!solo && (
        <label className="perf-field">
          <span className="muted small">{t.player}</span>
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
      )}
      {solo ? null : player.rotation ? (
        <ErrorBoundary label={t.errorRotation(shortName(player.name))} resetKey={player.guid}>
          <RotationPanel rotation={player.rotation} bench={compareWithTops(pull, player)} boss={pull.encounterName} />
        </ErrorBoundary>
      ) : (
        <p className="rot-wip small">
          <span className="chip">{t.wipChip}</span> {t.wipText(specLabel(player.specId))}
        </p>
      )}
      {/* erro na comparação de um jogador não some com o seletor: dá para escolher outro */}
      <ErrorBoundary label={t.errorComparison(shortName(player.name))} resetKey={player.guid}>
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

  // o fight de cada um no Warcraft Logs: o seu e o da referência (top, ou alguém da raid no report da noite)
  const healer = isHealer(me.player);
  const wclType = healer ? 'healing' : 'damage-done';
  const mineWcl = useWclFight(me.pull, me.player.name, wclCode);
  const raidWcl = useWclFight(raidRef?.pull ?? me.pull, raidRef?.player.name ?? '', mode === 'raid' ? wclCode : undefined);
  const refWcl = mode === 'tops' ? (topSample?.source ?? null) : raidWcl;
  const top = mode === 'tops' ? (topSample?.source ?? null) : null;
  const links = perfLinks(mineWcl, refWcl, wclType, top && { name: top.name, server: top.server, region: top.region });
  const unit = healer ? 'HPS' : 'DPS';
  const m = messagesOf(perfViewMsg);
  const picker = (
    <>
      <div className="segmented" role="radiogroup" aria-label={m.compareWith}>
        <button
          role="radio"
          aria-checked={mode === 'tops'}
          className={mode === 'tops' ? 'active' : ''}
          onClick={() => setMode('tops')}
          title={m.topsTitle}
        >
          {m.tops}
        </button>
        <button role="radio" aria-checked={mode === 'raid'} className={mode === 'raid' ? 'active' : ''} onClick={() => setMode('raid')}>
          {m.raid}
        </button>
      </div>
      {mode === 'tops' ? (
        <>
          <WclTopsButton me={me} onTops={setTops} />
          {tops && tops.length > 0 && (
            <div className="chips top-chips" role="radiogroup" aria-label={m.topPlayer}>
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
          <span className="muted small">{m.sameSpecLabel}</span>
          <select className="select" value={raidRef ? sampleKey(raidRef) : ''} onChange={(e) => setRaidKey(e.target.value)}>
            {!raidRef && <option value="">—</option>}
            {list.map((s) => (
              <option key={sampleKey(s)} value={sampleKey(s)}>
                {refLabel(me, s)} — {num(outputPerSec(s))} {m.aliveSuffix(unit)}
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
          wantTop && <p className={`small ${topError ? 'bad' : 'muted'}`}>{topError ?? m.downloadingTop(wantTop.name)}</p>
        ) : (
          <p className="muted pad">{m.nobodyElse(specLabel(me.player.specId))}</p>
        )}
      </>
    );

  const [mo, ro] = [outputPerSec(me), outputPerSec(ref)];
  const diff = ro > 0 ? ((mo - ro) / ro) * 100 : 0;
  const insights = perfInsights(me, ref, cds);
  // decisões contra este log (procs e cooldowns): o top do WCL não tem leitura de rotação, usa a sua
  const mine = povOf(me.pull, me.player);
  const theirs = mode === 'tops' && topSample ? povOf(topSample.pull, topSample.player, me.player.rotation, topSample.buffs) : povOf(ref.pull, ref.player);
  const decisions = mine && theirs ? compareWithLog(mine, theirs, decisionRefFor(me.player)) : [];
  const refName = mode === 'tops' && topSample ? m.topName(topSample.source.name, num(topSample.source.amount), unit) : refLabel(me, ref);

  return (
    <>
      {picker}
      <div className="perf-bar">
        <p className="muted small perf-note">
          {mode === 'tops' ? m.noteTops : m.noteRaid}
          {m.noteRest}
        </p>
        <ShareMenu
          card={(detail) => <PerfShareCard me={me} ref_={ref} refName={refName} cds={cds} links={links} detail={detail} />}
          name={`${shortName(me.player.name)} - ${me.pull.encounterName} ${me.pull.difficultyName} - pull ${me.pull.pullNumber}`}
        />
      </div>

      <div className="death-stats perf-stats">
        <Stat label={m.perSecondAlive(healer)} mine={num(mo)} ref={num(ro)} tone={diff <= -15 ? 'bad' : diff < -3 ? 'warn' : ''} extra={ro > 0 ? `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%` : undefined} />
        <Stat label={m.timeAlive} mine={mmss(me.player.aliveMs ?? 0)} ref={mmss(ref.player.aliveMs ?? 0)} />
        <Stat label={m.cpm} mine={totalCpm(me).toFixed(1)} ref={totalCpm(ref).toFixed(1)} />
        <Stat label={m.itemLevel} mine={me.player.setup?.itemLevel.toFixed(1) ?? '—'} ref={ref.player.setup?.itemLevel.toFixed(1) ?? '—'} />
      </div>

      {insights.length > 0 && (
        <section className="perf-section">
          <h4>{m.keyPoints}</h4>
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

      <section className="perf-section">
        <h4>
          <TrendingDown size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> {messagesOf(soloPullMsg).advantage}
        </h4>
        <Advantage me={me} ref_={ref} refLabel={refName} unit={unit} casts wcl={{ mine: mineWcl, ref: refWcl, type: wclType }} />
      </section>
      {decisions.length > 0 && (
        <section className="perf-section">
          <h4>{m.decisions}</h4>
          <DecisionList list={decisions} who={mode === 'tops' && topSample ? topSample.source.name : shortName(ref.player.name)} />
          <p className="muted small">{m.decisionsHint}</p>
        </section>
      )}
      <Bursts me={me} ref_={ref} cds={cds} />
      <CooldownCompare me={me} ref_={ref} cds={cds} />
      <Rotation me={me} ref_={ref} cds={cds} />
      <Potions me={me} ref_={ref} />
      <TakenMore me={me} ref_={ref} />
      <SetupView me={me.player} ref_={ref.player} />
    </>
  );
}

