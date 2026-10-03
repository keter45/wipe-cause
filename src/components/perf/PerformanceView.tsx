import { useEffect, useMemo, useState } from 'react';
import type { Pull } from '../../types';
import { mmss, num, shortName } from '../../lib/format';
import { candidates, defaultReference, detectCooldowns, isHealer, outputPerSec, perfInsights, totalCpm, type Sample } from '../../lib/performance';
import { ShareMenu } from '../share/ShareMenu';
import { ErrorBoundary } from '../ErrorBoundary';
import { specLabel } from '../../lib/specs';
import { SpellIcon } from '../SpellIcon';
import { PerfLinks, WclTopsButton, perfLinks, useOwnFight } from '../WclTops';
import { RotationPanel } from '../RotationPanel';
import { CooldownCompare } from './CooldownCompare';
import { loadTop, type TopRanking, type TopSample } from '../../lib/wclApi';

import { Stat, Bursts, Rotation, Potions, SetupView } from './sections';
import { PerfShareCard } from '../share/PerfCard';

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
          card={(detail) => <PerfShareCard me={me} ref_={ref} refName={refName} cds={cds} links={links} detail={detail} />}
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

