import type { Pull } from '../../types';
import { mmss, num, pct } from '../../lib/format';
import { summarizeNight, type Cause, type NightSummary, type PlayerNight } from '../../lib/night';
import { lowestBossHp } from '../../lib/verdict';
import { mechanicSpellId } from '../../lib/spells';
import { scoreTone } from '../../lib/score';
import { SpellName } from '../SpellIcon';
import { BossName } from '../Names';
import { failedPhase, phaseLabel, phaseSec, phaseTone, phasesOfNight } from '../../lib/phases';
import { ATTENTION_SCORE, Card, More, ScoreChips, Section, Who, dateOf, type CardDetail } from './common';

const SUMMARY = { causes: 3, attention: 5, highlights: 3 };

/** Quem jogou pelo menos 1/3 dos pulls (quem entrou num pull só não vira destaque nem alerta). */
const regulars = (s: NightSummary) => [...s.players].filter((x) => x.pulls >= Math.max(1, s.pulls.length / 3)).sort((a, b) => a.avgScore - b.avgScore);
const asScore = (x: PlayerNight) => ({ guid: x.guid, name: x.name, class: x.class, score: x.avgScore });

/**
 * Um boss na noite. Resumo: o HP de cada pull, as maiores causas, quem ficou abaixo de 80 e os
 * destaques. Completo: cada pull numa tabela, todas as causas e o placar dos jogadores.
 */
export function BossShareCard({ title, pulls, detail = 'summary' }: { title: string; pulls: Pull[]; detail?: CardDetail }) {
  const full = detail === 'full';
  const s = summarizeNight(pulls);
  const causes = s.causes.filter((c) => c.triggers > 0);
  const players = regulars(s);
  const attention = players.filter((x) => x.avgScore < ATTENTION_SCORE);
  const first = s.pulls[0];

  return (
    <Card
      tone={s.kills ? 'kill' : 'wipe'}
      wide={full}
      title={<BossName encounterId={pulls[0]?.encounterId} name={title} size={22} />}
      sub={`${first ? `${dateOf(first)} · ` : ''}${s.pulls.length} pulls · ${s.wipes} wipes · ${s.kills} kill${s.kills === 1 ? '' : 's'}`}
      big={s.kills ? 'Kill' : s.best ? pct(s.best.hp) : '—'}
      foot={`Nota média 0–100 · entre trys: média ${mmss(s.avgGapMs)}${full ? ' · relatório completo' : ''}`}
    >
      <PullBars pulls={s.pulls} />
      <PhaseLine pulls={s.pulls} />

      <div className="share-cols">
        <CausesSection causes={causes} wipes={s.wipes} pulls={pulls} full={full} />
        <PeopleSection attention={attention} players={players} full={full} />
      </div>

      {full && <PullTable pulls={s.pulls} />}
      {full && <PhaseTables pulls={s.pulls} />}
      {full && <Scoreboard players={players} />}
    </Card>
  );
}

/** HP do boss em cada pull: a barra é quanto do boss foi; o número de cima é onde ele ficou. */
export function PullBars({ pulls }: { pulls: Pull[] }) {
  const W = 640;
  const H = 70;
  const TOP = 16;
  const BOTTOM = 16;
  const band = W / Math.max(1, pulls.length);
  const labelHp = band >= 34;
  const labelN = band >= 14;
  return (
    <figure className="share-figure">
      <svg width={W} height={TOP + H + BOTTOM} viewBox={`0 0 ${W} ${TOP + H + BOTTOM}`} className="share-bars" role="img" aria-label="HP do boss por pull">
        {pulls.map((p, i) => {
          const hp = p.success ? 0 : (lowestBossHp(p) ?? 100);
          const h = p.success ? H : Math.max(2, ((100 - hp) / 100) * H);
          const x = i * band + 1;
          const w = Math.max(2, band - 2);
          // cor e fonte em linha: o gerador de imagem não aplica fill de SVG vindo de classe
          return (
            <g key={p.id}>
              <rect x={x} y={TOP + H - h} width={w} height={h} rx={2} style={{ fill: p.success ? 'var(--kill)' : '#3987e5' }} />
              {labelHp && (
                <text x={x + w / 2} y={TOP + H - h - 4} textAnchor="middle" style={{ fill: p.success ? 'var(--kill)' : 'var(--text)', fontSize: 10, fontWeight: 600 }}>
                  {p.success ? 'kill' : pct(hp)}
                </text>
              )}
              {labelN && (
                <text x={x + w / 2} y={TOP + H + 12} textAnchor="middle" style={{ fill: 'var(--muted)', fontSize: 10 }}>
                  {p.pullNumber}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="share-muted small">Cada barra é um pull (número embaixo): a altura é quanto do boss foi{labelHp ? '; em cima, o HP em que ele ficou' : ''}.</figcaption>
    </figure>
  );
}

export function CausesSection({ causes, wipes, pulls, full, title = 'Maiores causas' }: { causes: Cause[]; wipes: number; pulls: Pull[]; full: boolean; title?: string }) {
  const shown = full ? causes : causes.slice(0, SUMMARY.causes);
  return (
    <Section title={title}>
      {shown.length ? (
        <ul>
          {shown.map((c) => (
            <li key={c.key}>
              <strong>
                <SpellName spellId={mechanicSpellId(pulls, c.key)} name={c.name} size={16} />
              </strong>{' '}
              — gatilho em {c.triggers} de {wipes} wipes
              {full && c.deaths > 0 && <span className="share-muted"> · {c.deaths} morte{c.deaths > 1 ? 's' : ''}</span>}
            </li>
          ))}
          {!full && <More n={causes.length - shown.length} />}
        </ul>
      ) : (
        <p className="share-muted">Sem gatilhos apontados.</p>
      )}
    </Section>
  );
}

export function PeopleSection({ attention, players, full }: { attention: PlayerNight[]; players: PlayerNight[]; full: boolean }) {
  const highlights = [...players].reverse().filter((x) => x.avgScore >= ATTENTION_SCORE).slice(0, SUMMARY.highlights);
  return (
    <div>
      <Section title="Abaixo de 80" aside={!full && attention.length > SUMMARY.attention ? `+${attention.length - SUMMARY.attention}` : undefined}>
        {attention.length ? <ScoreChips list={(full ? attention : attention.slice(0, SUMMARY.attention)).map(asScore)} /> : <p className="share-muted">Ninguém: todo mundo com nota média 80 ou mais.</p>}
      </Section>
      {highlights.length > 0 && (
        <Section title="Destaques">
          <ScoreChips list={highlights.map(asScore)} />
        </Section>
      )}
    </div>
  );
}

const oneDecimal = (n: number) => n.toFixed(1).replace('.', ',').replace(/,0$/, '');

/** Resumo: uma linha por fase cronometrada (média e melhor da noite contra o alvo). */
function PhaseLine({ pulls }: { pulls: Pull[] }) {
  const phases = phasesOfNight(pulls);
  if (!phases.length) return null;
  return (
    <>
      {phases.map((n) => {
        const best = n.best.filter((x): x is number => x != null);
        const failed = n.pulls.flatMap((p) => p.windows).filter(failedPhase).length;
        return (
          <p key={n.key} className="share-phase">
            <SpellName spellId={n.spellId} name={n.name} size={16} />{' '}
            {n.avg != null ? `média ${oneDecimal(n.avg)}s` : 'sem tempo limpo'}
            {best.length > 0 && ` · melhor ${Math.min(...best)}s`}
            {n.targetMs != null && <span className="share-muted"> · bom até {Math.round(n.targetMs / 1000)}s</span>}
            {failed > 0 && <span className="share-bad"> · {failed} com o raid morrendo na fase</span>}
          </p>
        );
      })}
    </>
  );
}

/** Completo: cada vez da fase, pull a pull. */
function PhaseTables({ pulls }: { pulls: Pull[] }) {
  return (
    <>
      {phasesOfNight(pulls).map((n) => (
        <Section key={n.key} title={`${n.name}: tempo de cada vez`}>
          <table className="share-table">
            <thead>
              <tr>
                <th>Pull</th>
                {Array.from({ length: n.slots }, (_, i) => (
                  <th key={i} className="num">
                    {i + 1}ª
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {n.pulls.map(({ pull, windows }) => (
                <tr key={pull.id}>
                  <td>
                    {pull.pullNumber} <span className="share-muted">{pull.success ? 'kill' : 'wipe'}</span>
                  </td>
                  {Array.from({ length: n.slots }, (_, i) => {
                    const w = windows[i];
                    return (
                      <td key={i} className={`num phase-cell ${w ? phaseTone(w, n) : ''}`}>
                        {w ? phaseLabel(w) : '—'}
                        {w && (w.deaths ?? 0) > 0 && <span className="share-muted"> †{w.deaths}</span>}
                        {w && phaseSec(w) === n.best[i] && !failedPhase(w) && <span className="phase-best"> ★</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ))}
    </>
  );
}

function PullTable({ pulls }: { pulls: Pull[] }) {
  return (
    <Section title="Pull a pull">
      <table className="share-table">
        <thead>
          <tr>
            <th>Pull</th>
            <th className="num">Boss</th>
            <th className="num">Duração</th>
            <th>Gatilho</th>
            <th className="num">Mortes</th>
          </tr>
        </thead>
        <tbody>
          {pulls.map((p) => (
            <tr key={p.id}>
              <td>{p.pullNumber}</td>
              <td className={`num ${p.success ? 'share-kill' : ''}`}>{p.success ? 'kill' : pct(lowestBossHp(p))}</td>
              <td className="num">{mmss(p.durationMs)}</td>
              <td>{p.trigger ? `${p.trigger.name} (${mmss(p.trigger.t)})` : <span className="share-muted">—</span>}</td>
              <td className="num">{p.deaths.filter((d) => !d.ignored).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export function Scoreboard({ players }: { players: PlayerNight[] }) {
  return (
    <Section title="Jogadores">
      <table className="share-table">
        <thead>
          <tr>
            <th>Jogador</th>
            <th className="num">Nota média</th>
            <th className="num">Pulls</th>
            <th className="num">Mortes</th>
            <th className="num">Decisivas</th>
            <th className="num">Erros de mecânica</th>
            <th className="num">Interrupts</th>
            <th className="num">DPS / HPS médio</th>
          </tr>
        </thead>
        <tbody>
          {players.map((x) => (
            <tr key={x.guid}>
              <td>
                <Who name={x.name} cls={x.class} />
              </td>
              <td className="num">
                <span className={`score-pill ${scoreTone(x.avgScore)}`}>{Math.round(x.avgScore)}</span>
              </td>
              <td className="num">{x.pulls}</td>
              <td className="num">{x.deaths}</td>
              <td className="num">{x.decisiveDeaths || '—'}</td>
              <td className="num">{x.mechanicErrors || '—'}</td>
              <td className="num">{x.interrupts || '—'}</td>
              <td className="num">{num(x.role === 'healer' ? x.avgHps : x.avgDps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
