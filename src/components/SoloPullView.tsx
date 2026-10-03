import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ShieldAlert, Skull, Target, TrendingDown } from 'lucide-react';
import type { PlayerStats, Pull } from '../types';
import { mmss, num, shortName } from '../lib/format';
import { candidates, defaultReference, isHealer, outputPerSec, type Sample } from '../lib/performance';
import { advantageWindows, castDiff, fairReference, losses, relevantSpells, myDeaths, myMechanicFailures, takenMoreThan, timelineOf, type AdvantageWindow, type Loss } from '../lib/solo';
import { meIn, setSoloCharacter, useSoloCharacter } from '../lib/mode';
import { loadTop, type TopRanking, type TopSample } from '../lib/wclApi';
import { useSeek } from '../lib/wcr';
import { specLabel } from '../lib/specs';
import { scoreTone } from '../lib/score';
import { PlayAt } from './VideoPanel';
import { SpellIcon, SpellName } from './SpellIcon';
import { PlayerName } from './Names';
import { RotationPanel, uniqueSeconds } from './RotationPanel';
import { WclTopsButton } from './WclTops';
import { ErrorBoundary } from './ErrorBoundary';
import { OutputChart } from './SoloCharts';

type RefMode = 'top' | 'raid' | 'self';

/** Modo solo: o pull do ponto de vista de um player só, com o que ele pode corrigir. */
export function SoloPullView({ pull, nightPulls }: { pull: Pull; nightPulls: Pull[] }) {
  const chosen = useSoloCharacter();
  const me = meIn(pull, chosen);
  if (!me) return <WhoAreYou pull={pull} />;
  return (
    <ErrorBoundary label="na sua análise" resetKey={`${pull.id}:${me.guid}`}>
      <SoloPull key={me.guid} me={{ pull, player: me }} nightPulls={nightPulls} />
    </ErrorBoundary>
  );
}

function CharacterPicker({ pull, current }: { pull: Pull; current: PlayerStats | null }) {
  const players = [...pull.players].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select
      className="select"
      aria-label="Seu personagem"
      value={current?.guid ?? ''}
      onChange={(e) => {
        const p = players.find((x) => x.guid === e.target.value);
        setSoloCharacter(p ? p.name : null);
      }}
    >
      {!current && <option value="">Escolha…</option>}
      {players.map((p) => (
        <option key={p.guid} value={p.guid}>
          {shortName(p.name)} — {specLabel(p.specId)}
          {p.guid === pull.ownerGuid ? ' (gravou o log)' : ''}
        </option>
      ))}
    </select>
  );
}

function WhoAreYou({ pull }: { pull: Pull }) {
  return (
    <div className="panel solo-who">
      <Target size={20} strokeWidth={1.5} className="muted" aria-hidden />
      <div>
        <h3>Quem é você neste pull?</h3>
        <p className="muted small">Este pull não diz quem gravou o log (análise do Warcraft Logs). Escolha o seu personagem: o app lembra da escolha.</p>
      </div>
      <CharacterPicker pull={pull} current={null} />
    </div>
  );
}

function SoloPull({ me, nightPulls }: { me: Sample; nightPulls: Pull[] }) {
  const seek = useSeek();
  const healer = isHealer(me.player);
  const unit = healer ? 'HPS' : 'DPS';
  const ls = useMemo(() => losses(me), [me]);
  const out = outputPerSec(me);

  // ---- referência: top do Warcraft Logs, o melhor da raid ou você no seu melhor pull
  const list = useMemo(() => candidates(me, nightPulls).filter((s) => fairReference(me, s)), [me, nightPulls]);
  const selfBest = list.find((s) => s.player.guid === me.player.guid && outputPerSec(s) > out) ?? null;
  const raidRef = defaultReference(
    me,
    list.filter((s) => s.player.guid !== me.player.guid),
  );
  const [mode, setMode] = useState<RefMode>('top');
  const [tops, setTops] = useState<TopRanking[] | null>(null);
  const [top, setTop] = useState<TopSample | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const wantTop = mode === 'top' ? tops?.[0] ?? null : null;
  useEffect(() => {
    if (!wantTop || (top && top.source.code === wantTop.code && top.source.fightId === wantTop.fightId)) return;
    let alive = true;
    setTopError(null);
    loadTop(wantTop, me, 0)
      .then((s) => alive && setTop(s))
      .catch((e) => alive && setTopError(String(e)));
    return () => {
      alive = false;
    };
  }, [wantTop?.code, wantTop?.fightId]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref: Sample | null = mode === 'top' ? top : mode === 'raid' ? raidRef : selfBest;
  const refLabel = mode === 'top' && top ? `${top.source.name} (top)` : mode === 'self' ? `Você no pull ${selfBest?.pull.pullNumber}` : ref ? shortName(ref.player.name) : 'Referência';
  const refOut = ref ? outputPerSec(ref) : 0;
  const diff = refOut > 0 ? ((out - refOut) / refOut) * 100 : null;

  const deaths = myDeaths(me);
  const mechs = myMechanicFailures(me);
  const mechCount = mechs.reduce((n, m) => n + m.player.count, 0);
  const r = me.player.rotation;

  return (
    <div className="solo">
      <div className="solo-head">
        <span className="solo-you">
          <span className="muted small">Você</span>
          <PlayerName name={me.player.name} cls={me.player.class} />
          <span className="muted small">{specLabel(me.player.specId)}</span>
        </span>
        <CharacterPicker pull={me.pull} current={me.player} />
      </div>

      <div className="death-stats perf-stats">
        <div className="stat">
          <span className="stat-label">{healer ? 'Cura' : 'Dano'} por segundo vivo</span>
          <strong className={diff != null && diff <= -15 ? 'bad' : diff != null && diff < -3 ? 'warn' : ''}>
            {num(out)} {diff != null && <span className="small">({diff >= 0 ? '+' : ''}{diff.toFixed(0)}%)</span>}
          </strong>
          <span className="muted small">{ref ? `${refLabel}: ${num(refOut)}` : 'sem referência ainda'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Rotação</span>
          <strong>{r ? <span className={`score-pill ${scoreTone(r.score)}`}>{r.score}</span> : <span className="muted">em construção</span>}</strong>
          <span className="muted small">{r ? `${mmss(r.downtimeMs)} parado` : specLabel(me.player.specId)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Sobrevivência</span>
          <strong className={deaths.length ? 'bad' : ''}>{deaths.length ? `morreu ${mmss(deaths[0].death.t)}` : 'vivo até o fim'}</strong>
          <span className="muted small">{me.pull.success ? 'kill' : 'wipe'} em {mmss(me.pull.durationMs)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Erros de mecânica</span>
          <strong className={mechCount ? 'warn' : ''}>{mechCount}</strong>
          <span className="muted small">{me.pull.rulesFile ? 'só os seus' : 'boss sem regras cadastradas'}</span>
        </div>
      </div>

      <NextPull losses={ls} unit={unit} seek={seek} />

      <section className="perf-section">
        <h4>
          <TrendingDown size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> Onde a referência abriu vantagem
        </h4>
        <div className="segmented sm" role="radiogroup" aria-label="Comparar com">
          {(
            [
              ['top', 'Top do Warcraft Logs'],
              ['raid', 'Melhor da raid'],
              ['self', 'Seu melhor pull'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={mode === k} className={mode === k ? 'active' : ''} onClick={() => setMode(k)}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'top' && <WclTopsButton me={me} onTops={setTops} />}
        {mode === 'top' && wantTop && !top && <p className={`small ${topError ? 'bad' : 'muted'}`}>{topError ?? `Baixando o fight de ${wantTop.name}…`}</p>}
        {mode === 'raid' && !raidRef && <p className="muted small">Ninguém mais jogou de {specLabel(me.player.specId)} neste boss na noite.</p>}
        {mode === 'self' && !selfBest && <p className="muted small">Este é o seu melhor pull neste boss na noite.</p>}
        {ref && <Advantage me={me} ref_={ref} refLabel={refLabel} unit={unit} />}
      </section>

      <Mechanics me={me} ref_={ref} refLabel={refLabel} seek={seek} />

      {r ? (
        <RotationPanel rotation={r} />
      ) : (
        <p className="rot-wip small">
          <span className="chip">Em construção</span> A leitura da rotação de {specLabel(me.player.specId)} ainda está sendo preparada.
        </p>
      )}
    </div>
  );
}

/** Momento do pull: o horário sempre, e o ▶ quando o pull tem vídeo. */
function At({ t, seek }: { t: number; seek: ((t: number) => void) | null }) {
  return (
    <span className="solo-at small tabular">
      {mmss(t)}
      <PlayAt t={t} seek={seek} />
    </span>
  );
}

// ---- o que corrigir primeiro

const LOSS_ICON: Partial<Record<Loss['kind'], typeof Skull>> = { death: Skull, mechanic: ShieldAlert, avoidable: ShieldAlert };

function NextPull({ losses: ls, unit, seek }: { losses: Loss[]; unit: string; seek: ((t: number) => void) | null }) {
  const [all, setAll] = useState(false);
  if (ls.length === 0)
    return (
      <section className="perf-section">
        <h4>Para o próximo pull</h4>
        <p className="muted">Nada de grave apareceu neste pull: sem morte cedo, sem erro de mecânica seu e a rotação sem falhas claras.</p>
      </section>
    );
  const shown = all ? ls : ls.slice(0, 3);
  return (
    <section className="perf-section">
      <h4>
        Para o próximo pull <span className="muted small">os erros ordenados pelo que custaram</span>
      </h4>
      <ol className="solo-losses">
        {shown.map((l, i) => {
          const Icon = LOSS_ICON[l.kind];
          return (
            <li key={l.key} className={`solo-loss ${i < 3 ? 'top' : ''}`}>
              <span className="solo-rank tabular">{i + 1}</span>
              <div>
                <div className="solo-loss-title">
                  {l.spellId != null ? <SpellIcon spellId={l.spellId} size={18} /> : Icon && <Icon size={16} strokeWidth={1.5} aria-hidden />}
                  <strong>{l.title}</strong>
                  <span className="muted small">{l.lost != null ? `~${num(l.lost)} de ${unit === 'HPS' ? 'cura' : 'dano'} (${Math.round(l.weightSec)}s do seu ${unit})` : costLabel(l)}</span>
                </div>
                {l.detail && <p className="small">{l.detail}</p>}
                {l.tip && <p className="muted small">{l.tip}</p>}
                {l.times.length > 0 && (
                  <span className="chips solo-times">
                    {uniqueSeconds(l.times)
                      .slice(0, 6)
                      .map((t) => (
                        <At key={t} t={t} seek={seek} />
                      ))}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {ls.length > 3 && (
        <button className="link small more-toggle" onClick={() => setAll(!all)} aria-expanded={all}>
          <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${all ? 'open' : ''}`} aria-hidden />
          {all ? 'Só os 3 principais' : `Mostrar os outros ${ls.length - 3}`}
        </button>
      )}
    </section>
  );
}

/** Sem estimativa de dano: o peso vira "alto / médio / baixo". */
const costLabel = (l: Loss) => (l.weightSec >= 25 ? 'custo alto' : l.weightSec >= 8 ? 'custo médio' : 'custo baixo');

// ---- vantagem da referência

function Advantage({ me, ref_, refLabel, unit }: { me: Sample; ref_: Sample; refLabel: string; unit: string }) {
  const [mine, ref] = [timelineOf(me.player), timelineOf(ref_.player)];
  const windows = useMemo(() => advantageWindows(me, ref_), [me, ref_]);
  const relevant = useMemo(() => relevantSpells(me.player, ref_.player), [me, ref_]);
  if (!mine.length) return <p className="muted small">Esta análise é de uma versão antiga do app: analise o log de novo para ver o dano ao longo do pull.</p>;
  if (!ref.length) return <p className="muted small">A referência não tem o dano ao longo do pull (fight antigo no cache ou sem dados no Warcraft Logs).</p>;
  return (
    <>
      <OutputChart mine={mine} ref={ref} windows={windows} unit={unit} refLabel={refLabel} />
      <p className="muted small">Alinhado pelo tempo desde o pull: em lutas com fases, os trechos depois da primeira troca de fase podem não bater.</p>
      {windows.length === 0 ? (
        <p className="muted small">A referência não passou de você em nenhum trecho.</p>
      ) : (
        <div className="solo-windows">
          {windows.map((w, i) => (
            <WindowCard key={w.startMs} n={i + 1} w={w} unit={unit} relevant={relevant} />
          ))}
        </div>
      )}
    </>
  );
}

const LANE_MS = 15_000;
const ICON_GAP_PCT = 4.5;

function WindowCard({ n, w, unit, relevant }: { n: number; w: AdvantageWindow; unit: string; relevant: Set<string> }) {
  const seek = useSeek();
  const diff = castDiff(w, relevant);
  const sec = (w.endMs - w.startMs) / 1000;
  return (
    <div className="solo-window">
      <div className="solo-window-head">
        <span className="out-band-n small">{n}</span>
        <strong>
          {mmss(w.startMs)}–{mmss(w.endMs)}
        </strong>
        <span className="muted small">
          referência {num(w.ref / sec)} × você {num(w.mine / sec)} {unit}
        </span>
        <At t={w.startMs} seek={seek} />
      </div>
      {w.deadAt != null && <p className="small bad">Você morreu em {mmss(w.deadAt)}.</p>}
      {diff.length > 0 && (
        <p className="small">
          A referência usou mais:{' '}
          {diff.map((d, i) => (
            <span key={d.name} className="solo-diff">
              {i > 0 && ', '}
              <SpellName spellId={d.spellId} name={d.name} size={14} />{' '}
              <span className="muted">
                {d.ref}× (você {d.mine}×)
              </span>
            </span>
          ))}
        </p>
      )}
      <Lane label="Você" casts={w.myCasts} />
      <Lane label="Referência" casts={w.refCasts} />
    </div>
  );
}

function Lane({ label, casts }: { label: string; casts: AdvantageWindow['myCasts'] }) {
  const rows: number[] = [];
  const placed = casts.map((c) => {
    const pos = (c.t / LANE_MS) * 100;
    let row = rows.findIndex((last) => pos - last >= ICON_GAP_PCT);
    if (row < 0) row = rows.push(pos) - 1;
    else rows[row] = pos;
    return { c, pos, row };
  });
  return (
    <div className="burst-lane">
      <span className="muted small burst-who">{label}</span>
      {casts.length ? (
        <ol className="burst-track" style={{ height: Math.max(1, rows.length) * 26 + 4 }} aria-label={`${label}: ${casts.map((c) => c.name).join(', ')}`}>
          {placed.map(({ c, pos, row }, i) => (
            <li key={i} style={{ left: `${pos}%`, top: row * 26 + 2 }} title={`${c.name} · +${(c.t / 1000).toFixed(1)}s`}>
              <SpellIcon spellId={c.spellId} size={22} />
            </li>
          ))}
        </ol>
      ) : (
        <span className="small warn">nenhum cast no trecho</span>
      )}
    </div>
  );
}

// ---- mecânicas

function Mechanics({ me, ref_, refLabel, seek }: { me: Sample; ref_: Sample | null; refLabel: string; seek: ((t: number) => void) | null }) {
  const fails = myMechanicFailures(me);
  const deaths = myDeaths(me);
  const taken = ref_ ? takenMoreThan(me, ref_) : [];
  return (
    <section className="perf-section">
      <h4>
        <ShieldAlert size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> Mecânicas
      </h4>
      {fails.length === 0 && deaths.length === 0 && taken.length === 0 && (
        <p className="muted small">{me.pull.rulesFile ? 'Nenhum erro seu nas mecânicas cadastradas, e você não morreu.' : 'Este boss ainda não tem regras de mecânica cadastradas.'}</p>
      )}
      {deaths.map(({ death: d }) => (
        <div key={d.t} className="solo-mech">
          <Skull size={16} strokeWidth={1.5} className="bad" aria-hidden />
          <div>
            <strong>Morte em {mmss(d.t)}</strong>
            <span className="muted small">
              {' '}
              {d.killingBlow ? `${d.killingBlow.spellName} (${d.killingBlow.source})` : 'golpe final desconhecido'}
              {d.causedBy ? ` · depois de ${d.causedBy.name}` : ''}
            </span>
            <p className="muted small">
              {d.defensivesAvailable.length ? `Disponível na hora: ${d.defensivesAvailable.map((x) => x.name).join(', ')}. ` : 'Sem defensivo disponível. '}
              {!d.usedHealthPotion && 'Sem poção de vida. '}
              {d.healthstoneKnown && !d.usedHealthstone && 'Sem Healthstone.'}
            </p>
          </div>
          <At t={d.t} seek={seek} />
        </div>
      ))}
      {fails.map(({ mechanic: m, player: p, times }) => (
        <div key={m.key} className="solo-mech">
          {m.spellId != null ? <SpellIcon spellId={m.spellId} size={18} /> : <ShieldAlert size={16} strokeWidth={1.5} aria-hidden />}
          <div>
            <strong>{m.name}</strong> <span className="muted small">{p.message || `${p.count} erro${p.count > 1 ? 's' : ''}`}</span>
            {m.tip && <p className="muted small">{m.tip}</p>}
          </div>
          {(times[0] ?? p.firstT) != null && <At t={(times[0] ?? p.firstT)!} seek={seek} />}
        </div>
      ))}
      {taken.length > 0 && (
        <>
          <h5 className="muted small">Dano que você tomou bem mais que {refLabel} (por minuto vivo)</h5>
          <div className="table-scroll">
            <table className="perf-table">
              <thead>
                <tr>
                  <th>Habilidade</th>
                  <th className="num">Você</th>
                  <th className="num">Ref.</th>
                  <th className="num">% do seu dano tomado</th>
                </tr>
              </thead>
              <tbody>
                {taken.slice(0, 6).map((t) => (
                  <tr key={t.name}>
                    <td>
                      <SpellName spellId={t.spellId} name={t.name} size={16} />
                    </td>
                    <td className="num">{num(t.minePerMin)}</td>
                    <td className="num muted">{num(t.refPerMin)}</td>
                    <td className="num">{(t.share * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Muito acima da referência costuma ser dano evitável: veja no vídeo de onde veio.</p>
        </>
      )}
    </section>
  );
}
