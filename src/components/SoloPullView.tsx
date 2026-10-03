import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ShieldAlert, Skull, Target, TrendingDown } from 'lucide-react';
import type { PlayerStats, Pull } from '../types';
import { mmss, num, shortName } from '../lib/format';
import { candidates, defaultReference, detectCooldowns, isHealer, outputPerSec, type Sample } from '../lib/performance';
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
import { CooldownCompare } from './CooldownCompare';
import { inTauri } from '../lib/api';
import { useSetup } from '../lib/setup';

/** Modo solo: o pull do ponto de vista de um player só, com o que ele pode corrigir. */
export function SoloPullView({ pull, nightPulls }: { pull: Pull; nightPulls: Pull[] }) {
  const chosen = useSoloCharacter();
  const me = meIn(pull, chosen);
  if (!me) return <WhoAreYou pull={pull} />;
  return (
    <ErrorBoundary label="na sua análise" resetKey={`${pull.id}:${me.guid}`}>
      {/* a escolha da referência vale para os pulls do mesmo boss; trocou de boss, volta ao padrão */}
      <SoloPull key={`${me.guid}:${pull.encounterId}:${pull.difficultyId}`} me={{ pull, player: me }} nightPulls={nightPulls} />
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

// ---- com quem comparar

type RefGroup = 'top' | 'spec' | 'self' | 'other';
interface RefOption {
  key: string;
  group: RefGroup;
  label: string;
  sample?: Sample;
}

const GROUPS: [RefGroup, string][] = [
  ['top', 'Top do Warcraft Logs'],
  ['spec', 'Sua spec na raid'],
  ['self', 'Você em outros pulls'],
  ['other', 'Outras specs neste pull'],
];

const sampleKey = (s: Sample) => `s:${s.pull.id}:${s.player.guid}`;
const topId = (t: TopRanking) => `${t.code}:${t.fightId}`;
const pullLabel = (p: Pull) => `pull ${p.pullNumber} (${p.success ? 'kill' : 'wipe'})`;

/** "Fulano", "Fulano · pull 6 (kill)", "Você no pull 6 (kill)" */
function sampleLabel(me: Sample, s: Sample): string {
  if (s.player.guid === me.player.guid) return `Você no ${pullLabel(s.pull)}`;
  return s.pull.id === me.pull.id ? shortName(s.player.name) : `${shortName(s.player.name)} · ${pullLabel(s.pull)}`;
}

/**
 * Quem dá para escolher como referência: os tops da spec no Warcraft Logs, a mesma spec na noite
 * (neste boss), você nos outros pulls e, neste pull, quem tem a mesma função em outra spec (só
 * para o dano ao longo do pull e o dano tomado).
 */
function refOptions(me: Sample, list: Sample[], tops: TopRanking[] | null, wclReady: boolean, unit: string): RefOption[] {
  const out: RefOption[] = [];
  if (tops?.length)
    tops.forEach((t, i) =>
      out.push({ key: `top:${i}`, group: 'top', label: `#${i + 1} ${t.name} — ${num(t.amount)} ${unit}${t.itemLevel ? ` · ilvl ${t.itemLevel.toFixed(0)}` : ''}` }),
    );
  else if (tops == null) out.push({ key: 'top:0', group: 'top', label: wclReady ? 'Top #1 (buscando…)' : 'Top da spec (conectar o Warcraft Logs)' });
  const tag = (s: Sample) => `${num(outputPerSec(s))} ${unit}${fairReference(me, s) ? '' : ' · viveu pouco'}`;
  for (const s of list) {
    const self = s.player.guid === me.player.guid;
    out.push({ key: sampleKey(s), group: self ? 'self' : 'spec', label: `${sampleLabel(me, s)} — ${tag(s)}`, sample: s });
  }
  const others = me.pull.players
    .filter((p) => p.guid !== me.player.guid && p.specId !== me.player.specId && p.role === me.player.role && (p.aliveMs ?? me.pull.analyzedMs) >= 30_000)
    .map((player) => ({ pull: me.pull, player }))
    .sort((a, b) => outputPerSec(b) - outputPerSec(a));
  for (const s of others) out.push({ key: sampleKey(s), group: 'other', label: `${shortName(s.player.name)} (${specLabel(s.player.specId)}) — ${tag(s)}`, sample: s });
  return out;
}

function SoloPull({ me, nightPulls }: { me: Sample; nightPulls: Pull[] }) {
  const seek = useSeek();
  const healer = isHealer(me.player);
  const unit = healer ? 'HPS' : 'DPS';
  const ls = useMemo(() => losses(me), [me]);
  const out = outputPerSec(me);

  // ---- referência: escolhida pelo player (top do Warcraft Logs, alguém da raid, você em outro
  // pull ou outra spec); sem escolha, o top #1 ou o melhor da raid
  const wclReady = inTauri && !!useSetup().status?.wcl?.configured;
  const list = useMemo(() => candidates(me, nightPulls), [me, nightPulls]);
  const fair = useMemo(() => list.filter((s) => fairReference(me, s)), [me, list]);
  const raidRef = defaultReference(
    me,
    fair.filter((s) => s.player.guid !== me.player.guid),
  );
  const selfBest = fair.find((s) => s.player.guid === me.player.guid && outputPerSec(s) > out) ?? null;
  const [tops, setTops] = useState<TopRanking[] | null>(null);
  const [loaded, setLoaded] = useState<Map<string, TopSample>>(new Map());
  const [topError, setTopError] = useState<string | null>(null);
  const options = useMemo(() => refOptions(me, list, tops, wclReady, unit), [me, list, tops, wclReady, unit]);
  const fallback = tops?.length || (wclReady && tops == null) ? 'top:0' : raidRef ? sampleKey(raidRef) : selfBest ? sampleKey(selfBest) : null;
  const [choice, setChoice] = useState<string | null>(null);
  const key = choice != null && options.some((o) => o.key === choice) ? choice : fallback;
  const opt = options.find((o) => o.key === key) ?? null;
  const wantTop = key?.startsWith('top:') ? tops?.[Number(key.slice(4))] ?? null : null;
  const top = wantTop ? loaded.get(topId(wantTop)) ?? null : null;
  useEffect(() => {
    if (!wantTop || loaded.has(topId(wantTop))) return;
    let alive = true;
    setTopError(null);
    loadTop(wantTop, me, tops?.indexOf(wantTop) ?? 0)
      .then((s) => alive && setLoaded((m) => new Map(m).set(topId(wantTop), s)))
      .catch((e) => alive && setTopError(String(e)));
    return () => {
      alive = false;
    };
  }, [wantTop, loaded, me, tops]);
  const ref: Sample | null = key?.startsWith('top:') ? top : (opt?.sample ?? null);
  const refLabel = !ref ? 'Referência' : wantTop ? `${wantTop.name} (top #${Number(key!.slice(4)) + 1})` : sampleLabel(me, ref);
  const sameSpec = ref != null && ref.player.specId === me.player.specId;
  const refOut = ref ? outputPerSec(ref) : 0;
  const diff = refOut > 0 ? ((out - refOut) / refOut) * 100 : null;
  const cds = useMemo(() => detectCooldowns([me, ...list, ...loaded.values()]), [me, list, loaded]);

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
        <label className="perf-field solo-ref">
          <span className="muted small">Comparar com</span>
          <select className="select" value={key ?? ''} onChange={(e) => setChoice(e.target.value)}>
            {key == null && <option value="">—</option>}
            {GROUPS.map(([g, label]) => {
              const os = options.filter((o) => o.group === g);
              return (
                os.length > 0 && (
                  <optgroup key={g} label={label}>
                    {os.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )
              );
            })}
          </select>
        </label>
        {(wclReady || key?.startsWith('top:')) && <WclTopsButton me={me} onTops={setTops} />}
        {wantTop && !top && <p className={`small ${topError ? 'bad' : 'muted'}`}>{topError ?? `Baixando o fight de ${wantTop.name}…`}</p>}
        {key == null && <p className="muted small">Ninguém mais jogou de {specLabel(me.player.specId)} neste boss na noite: escolha alguém de outra spec ou conecte o Warcraft Logs.</p>}
        {ref && !sameSpec && <p className="muted small">Outra spec: dá para comparar o dano ao longo do pull e o dano tomado, mas não os casts e os cooldowns.</p>}
        {ref && <Advantage me={me} ref_={ref} refLabel={refLabel} unit={unit} casts={sameSpec} />}
      </section>

      {ref && sameSpec && <CooldownCompare me={me} ref_={ref} cds={cds} refName={refLabel} />}

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

/** `casts`: mostrar os casts dos trechos (só faz sentido com a mesma spec). */
function Advantage({ me, ref_, refLabel, unit, casts }: { me: Sample; ref_: Sample; refLabel: string; unit: string; casts: boolean }) {
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
            <WindowCard key={w.startMs} n={i + 1} w={w} unit={unit} relevant={relevant} casts={casts} />
          ))}
        </div>
      )}
    </>
  );
}

const LANE_MS = 15_000;
const ICON_GAP_PCT = 4.5;

function WindowCard({ n, w, unit, relevant, casts }: { n: number; w: AdvantageWindow; unit: string; relevant: Set<string>; casts: boolean }) {
  const seek = useSeek();
  const diff = casts ? castDiff(w, relevant) : [];
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
      {casts && (
        <>
          <Lane label="Você" casts={w.myCasts} />
          <Lane label="Referência" casts={w.refCasts} />
        </>
      )}
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
