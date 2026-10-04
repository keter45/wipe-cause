import { useEffect, useMemo, useState } from 'react';
import { Repeat, Skull } from 'lucide-react';
import type { Pull } from '../types';
import { mmss, num, shortName } from '../lib/format';
import { soloBosses, soloEvolution, soloNight, type SoloBoss } from '../lib/solo';
import { setSoloCharacter, useSoloCharacter } from '../lib/mode';
import { historyTrends } from '../lib/api';
import { scoreTone } from '../lib/score';
import { specLabel } from '../lib/specs';
import { BossName, PlayerName } from './Names';
import { SpellIcon } from './SpellIcon';
import { Sparkline } from './SoloCharts';
import { withErrorBoundary } from './ErrorBoundary';
import { messagesOf, useMessages } from '../i18n';
import { soloNightMsg } from './SoloNight.i18n';

const unitOf = (b: SoloBoss) => (b.pulls[0]?.player.role === 'healer' ? 'HPS' : 'DPS');
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** Personagens de raid no log (para escolher quem é você quando o log não diz). */
function CharacterSelect({ pulls }: { pulls: Pull[] }) {
  const t = useMessages(soloNightMsg);
  const chosen = useSoloCharacter();
  const names = useMemo(() => {
    const m = new Map<string, { name: string; cls: string | null; specId: number | null }>();
    for (const p of pulls) if (!p.dungeon) for (const x of p.players) if (!m.has(x.name)) m.set(x.name, { name: x.name, cls: x.class, specId: x.specId });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [pulls]);
  return (
    <select className="select" aria-label={t.yourCharacter} value={chosen ?? ''} onChange={(e) => setSoloCharacter(e.target.value || null)}>
      <option value="">{t.logOwner}</option>
      {names.map((n) => (
        <option key={n.name} value={n.name}>
          {shortName(n.name)} — {specLabel(n.specId)}
        </option>
      ))}
    </select>
  );
}

/** Modo solo: a noite inteira do ponto de vista do seu personagem, boss a boss. */
export function SoloNightView({ pulls, onSelectPull }: { pulls: Pull[]; onSelectPull: (id: number) => void }) {
  const t = useMessages(soloNightMsg);
  const chosen = useSoloCharacter();
  const bosses = useMemo(() => soloNight(pulls, chosen), [pulls, chosen]);
  // um personagem só na noite: no título; trocou no meio do log: em cada boss
  const chars = new Set(bosses.flatMap((b) => b.pulls.map((p) => p.player.name)));
  const me = chars.size === 1 ? bosses[0]?.pulls[0]?.player : undefined;
  return (
    <div className="night solo-night">
      <header className="night-head">
        <h2>{t.yourNight}</h2>
        {me && <PlayerName name={me.name} cls={me.class} />}
        <span className="topbar-spacer" />
        <CharacterSelect pulls={pulls} />
      </header>
      {bosses.length === 0 ? (
        <p className="muted pad">{t.noneInNight}</p>
      ) : (
        bosses.map((b) => <SoloBossCard key={b.key} b={b} onSelectPull={onSelectPull} />)
      )}
    </div>
  );
}

/** Modo solo: um boss da noite, pull a pull. */
export function SoloBossView({ title, pulls, onSelectPull }: { title: string; pulls: Pull[]; onSelectPull: (id: number) => void }) {
  const t = useMessages(soloNightMsg);
  const chosen = useSoloCharacter();
  const b = useMemo(() => soloNight(pulls, chosen)[0] ?? null, [pulls, chosen]);
  return (
    <div className="night solo-night">
      <header className="night-head">
        <h2>{title}</h2>
        <span className="topbar-spacer" />
        <CharacterSelect pulls={pulls} />
      </header>
      {b ? <SoloBossCard b={b} onSelectPull={onSelectPull} open /> : <p className="muted pad">{t.notInBoss}</p>}
    </div>
  );
}

function SoloBossCard({ b, onSelectPull, open = false }: { b: SoloBoss; onSelectPull: (id: number) => void; open?: boolean }) {
  const t = useMessages(soloNightMsg);
  const unit = unitOf(b);
  const scores = b.pulls.map((p) => p.score).filter((x): x is number => x != null);
  const score = median(scores);
  return (
    <section className={`panel solo-boss ${open ? 'open' : ''}`}>
      <header className="solo-boss-head">
        <BossName encounterId={b.encounterId} name={b.key} size={22} />
        <PlayerName name={b.pulls[0].player.name} cls={b.pulls[0].player.class} />
        <span className="muted small">{t.bossLine(b.pulls.length, num(b.best?.output ?? 0), unit, score)}</span>
        <span className="topbar-spacer" />
        <Sparkline values={b.pulls.map((p) => p.output)} labels={b.pulls.map((p) => t.pullLabel(p.pull.pullNumber))} />
      </header>

      {b.recurring.length > 0 && (
        <div className="solo-recurring">
          <span className="muted small">
            <Repeat size={14} strokeWidth={1.5} className="inline-icon" aria-hidden /> {t.repeats}
          </span>
          {b.recurring.slice(0, 4).map((r) => (
            <span key={r.key} className="solo-rec" title={r.tip}>
              {r.spellId != null ? <SpellIcon spellId={r.spellId} size={14} /> : r.kind === 'death' && <Skull size={13} strokeWidth={1.5} aria-hidden />}
              {r.title}{' '}
              <span className="muted">{t.ofPulls(r.pulls, b.pulls.length)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="table-scroll">
        <table className="perf-table solo-pulls">
          <thead>
            <tr>
              <th>{t.pull}</th>
              <th className="num">{t.alive(unit)}</th>
              <th className="num">{t.rotation}</th>
              <th>{t.death}</th>
              <th className="num">{t.mechanics}</th>
              <th>{t.costliest}</th>
            </tr>
          </thead>
          <tbody>
            {b.pulls.map((p) => (
              <tr key={p.pull.id} className="clickable" onClick={() => onSelectPull(p.pull.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelectPull(p.pull.id)}>
                <td>
                  {p.pull.pullNumber} <span className={`small ${p.pull.success ? 'good' : 'muted'}`}>{p.pull.success ? t.kill : t.wipe}</span>
                </td>
                <td className={`num ${p === b.best ? 'good' : ''}`}>{num(p.output)}</td>
                <td className="num">{p.score != null ? <span className={`score-pill ${scoreTone(p.score)}`}>{p.score}</span> : <span className="muted">—</span>}</td>
                <td className={p.died != null ? 'bad' : 'muted'}>{p.died != null ? mmss(p.died) : '—'}</td>
                <td className={`num ${p.mechFails ? 'warn' : 'muted'}`}>{p.mechFails}</td>
                <td className="small">{p.losses[0]?.title ?? <span className="muted">{t.nothingSerious}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Modo solo: a sua evolução num boss ao longo das noites salvas. */
function SoloTrendsInner() {
  const t = useMessages(soloNightMsg);
  const chosen = useSoloCharacter();
  const [nights, setNights] = useState<{ id: string; title: string; raidStartMs: number; pulls: Pull[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boss, setBoss] = useState<string | null>(null);
  useEffect(() => {
    historyTrends()
      .then((xs) => setNights(xs.map((x) => ({ id: x.id, title: x.title, raidStartMs: x.raidStartMs ?? 0, pulls: x.report.pulls }))))
      .catch((e) => setError(String(e)));
  }, []);
  const bosses = useMemo(() => (nights ? soloBosses(nights, chosen) : []), [nights, chosen]);
  const selected = boss ?? bosses[0]?.key ?? null;
  const points = useMemo(() => (nights && selected ? soloEvolution(nights, selected, chosen) : []), [nights, selected, chosen]);
  const allPulls = useMemo(() => nights?.flatMap((n) => n.pulls) ?? [], [nights]);

  return (
    <div className="night trends solo-night">
      <header className="night-head">
        <h2>{t.evolution}</h2>
        <span className="muted small">{t.savedNights}</span>
        <span className="topbar-spacer" />
        {nights && <CharacterSelect pulls={allPulls} />}
      </header>
      {error && <div className="error">{t.error(error)}</div>}
      {!nights && !error && <p className="muted">{t.readingHistory}</p>}
      {nights && bosses.length === 0 && <p className="muted pad">{t.notInHistory}</p>}
      {bosses.length > 0 && (
        <div className="chips" role="radiogroup" aria-label={t.boss}>
          {bosses.map((b) => (
            <button key={b.key} role="radio" aria-checked={b.key === selected} className={b.key === selected ? 'active' : ''} onClick={() => setBoss(b.key)}>
              <BossName encounterId={b.encounterId} name={b.key} size={16} /> <span className="muted">{b.nights}</span>
            </button>
          ))}
        </div>
      )}
      {points.length > 0 && (
        <section className="panel solo-boss">
          <header className="solo-boss-head">
            <strong>{t.bestPerNight}</strong>
            <span className="topbar-spacer" />
            <Sparkline values={points.map((p) => p.bestOutput)} labels={points.map((p) => p.title)} width={180} height={36} />
          </header>
          <div className="table-scroll">
            <table className="perf-table">
              <thead>
                <tr>
                  <th>{t.night}</th>
                  <th className="num">{t.pulls}</th>
                  <th className="num">{t.bestPerSecond}</th>
                  <th className="num">{t.rotationMedian}</th>
                  <th className="num">{t.diedIn}</th>
                  <th className="num">{t.mechErrors}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => {
                  const prev = points[i - 1];
                  const up = prev ? p.bestOutput - prev.bestOutput : 0;
                  return (
                    <tr key={p.id}>
                      <td>{p.title}</td>
                      <td className="num">{p.pulls}</td>
                      <td className="num">
                        {num(p.bestOutput)} {prev && <span className={`small ${up >= 0 ? 'good' : 'bad'}`}>{up >= 0 ? '▲' : '▼'}</span>}
                      </td>
                      <td className="num">{p.score != null ? <span className={`score-pill ${scoreTone(p.score)}`}>{p.score}</span> : <span className="muted">—</span>}</td>
                      <td className={`num ${p.deathsPerPull > 0.5 ? 'bad' : ''}`}>{t.ofPullsPct(Math.round(p.deathsPerPull * 100))}</td>
                      <td className={`num ${p.mechPerPull >= 1 ? 'warn' : ''}`}>{p.mechPerPull.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export const SoloTrendsView = withErrorBoundary(SoloTrendsInner, () => messagesOf(soloNightMsg).errorScope);
