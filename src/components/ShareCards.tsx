// Cartões para compartilhar (imagem/HTML). Os ícones das habilidades vêm do Wowhead (o CDN
// libera CORS) e o gerador espera todos carregarem antes de virar imagem (lib/share.ts).

import type { Pull } from '../types';
import { classColor, mmss, pct, shortName } from '../lib/format';
import { summarizeNight } from '../lib/night';
import { scorePull, scoreTone } from '../lib/score';
import { analyzePull, lowestBossHp } from '../lib/verdict';
import { PositionMap, type Mark } from './PositionMap';
import { SpellIcon, SpellName } from './SpellIcon';
import { mechanicSpellId } from '../lib/spells';
import { BossName, Colored } from './Names';
import { getNote } from '../lib/notes';

function Brand() {
  return <span className="share-brand">Wipe Cause</span>;
}

/** "9/28/2026 22:48:18.335-3" (formato do log) -> "28/09" */
const dateOf = (p: Pull) =>
  (p.startLocal.split(' ')[0] ?? '')
    .split('/')
    .slice(0, 2)
    .reverse()
    .map((x) => x.padStart(2, '0'))
    .join('/');
const timeOf = (p: Pull) => p.startLocal.split(' ')[1]?.slice(0, 5) ?? '';

/** Um pull: resultado, gatilho, achados, mortes decisivas, notas baixas e o mapa da falha. */
export function PullShareCard({ pull: p }: { pull: Pull }) {
  const v = analyzePull(p);
  const hp = lowestBossHp(p);
  const scores = scorePull(p);
  const lowest = [...p.players]
    .map((x) => ({ x, s: scores.get(x.guid)?.score ?? 100 }))
    .filter((r) => r.s < 80)
    .sort((a, b) => a.s - b.s)
    .slice(0, 6);
  const findings = v.findings.filter((f) => f.severity !== 'minor' && f.severity !== 'info').slice(0, 5);
  const trigger = p.trigger ? p.mechanics.find((m) => m.key === p.trigger!.key) : null;
  const snap = trigger?.snapshots?.[0];
  const classes = new Map(p.players.map((x) => [x.guid, x.class] as const));
  const marks = new Map<string, Mark>(
    trigger?.kind === 'failure_event' ? trigger.players.filter((x) => !x.credit).map((x) => [x.guid, 'culprit'] as const) : [],
  );

  return (
    <div className={`share-card ${p.success ? 'kill' : 'wipe'}`}>
      <header className="share-head">
        <div>
          <div className="share-title">
            <BossName encounterId={p.encounterId} name={`${p.success ? 'Kill' : `Wipe · pull ${p.pullNumber}`} — ${p.encounterName} ${p.difficultyName}`} size={22} />
          </div>
          <div className="share-sub">
            {dateOf(p)} {timeOf(p)} · {mmss(p.durationMs)} · {p.deaths.filter((d) => !d.ignored).length} mortes
          </div>
        </div>
        {!p.success && hp != null && <div className="share-big">{pct(hp)}</div>}
      </header>
      <p className="share-headline">{v.headline}</p>
      {getNote(p).trim() && <p className="share-note">“{getNote(p).trim()}”</p>}

      <div className="share-cols">
        <div>
          {findings.length > 0 && (
            <section>
              <h4>O que deu errado</h4>
              <ul>
                {findings.map((f, i) => (
                  <li key={i} className={f.severity}>
                    {f.spellId != null && <SpellIcon spellId={f.spellId} size={16} />} <strong>
                      <Colored text={f.title} />
                    </strong>
                    {f.detail && (
                      <span>
                        {' '}
                        — <Colored text={f.detail} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {v.decisiveDeaths.length > 0 && (
            <section>
              <h4>Mortes decisivas</h4>
              <ul>
                {v.decisiveDeaths.map((d) => (
                  <li key={`${d.guid}:${d.t}`}>
                    <span style={{ color: classColor(d.class) }}>{shortName(d.name)}</span> {mmss(d.t)} —{' '}
                    <SpellName
                      spellId={d.causedBy ? mechanicSpellId(p, d.causedBy.key) ?? d.killingBlow?.spellId : d.killingBlow?.spellId}
                      name={d.killingBlowMechanic ?? d.killingBlow?.spellName ?? '?'}
                      size={16}
                    />
                    {d.defensivesRecent.length === 0 && d.defensivesAvailable.length > 0 && <span className="share-muted"> (sem defensivo)</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {lowest.length > 0 && (
            <section>
              <h4>Notas mais baixas</h4>
              <div className="share-scores">
                {lowest.map(({ x, s }) => (
                  <span key={x.guid}>
                    <span style={{ color: classColor(x.class) }}>{shortName(x.name)}</span> <span className={`score-pill ${scoreTone(s)}`}>{s}</span>
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
        {snap && (
          <div className="share-map">
            <h4>Posições na falha ({mmss(snap.t)})</h4>
            <PositionMap snap={snap} classes={classes} marks={marks} size={230} />
          </div>
        )}
      </div>
      <footer className="share-foot">
        <Brand />
      </footer>
    </div>
  );
}

/** Um boss na noite: pulls, melhor pull, progresso, maiores causas e quem precisa de atenção. */
export function BossShareCard({ title, pulls }: { title: string; pulls: Pull[] }) {
  const s = summarizeNight(pulls);
  const causes = s.causes.filter((c) => c.triggers > 0).slice(0, 5);
  const byScore = [...s.players].filter((x) => x.pulls >= Math.max(1, s.pulls.length / 3)).sort((a, b) => a.avgScore - b.avgScore);
  const W = 640;
  const H = 70;
  const band = W / Math.max(1, s.pulls.length);
  const first = s.pulls[0];

  return (
    <div className={`share-card ${s.kills ? 'kill' : 'wipe'}`}>
      <header className="share-head">
        <div>
          <div className="share-title">
            <BossName encounterId={pulls[0]?.encounterId} name={title} size={22} />
          </div>
          <div className="share-sub">
            {first ? `${dateOf(first)} · ` : ''}
            {s.pulls.length} pulls · {s.wipes} wipes · {s.kills} kill{s.kills === 1 ? '' : 's'}
          </div>
        </div>
        <div className="share-big">{s.kills ? 'Kill' : s.best ? pct(s.best.hp) : '—'}</div>
      </header>

      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="share-bars" role="img" aria-label="HP do boss por pull">
        {s.pulls.map((p, i) => {
          const hp = p.success ? 0 : lowestBossHp(p) ?? 100;
          const h = p.success ? H : Math.max(2, ((100 - hp) / 100) * H);
          // cor em linha: o gerador de imagem não aplica fill de SVG vindo de classe
          return <rect key={p.id} x={i * band + 1} y={H - h} width={Math.max(2, band - 2)} height={h} rx={2} style={{ fill: p.success ? 'var(--kill)' : '#3987e5' }} />;
        })}
      </svg>
      <p className="share-muted small">Barras = quanto do boss foi em cada pull.</p>

      <div className="share-cols">
        <section>
          <h4>Maiores causas</h4>
          {causes.length ? (
            <ul>
              {causes.map((c) => (
                <li key={c.key}>
                  <strong>
                    <SpellName spellId={mechanicSpellId(pulls, c.key)} name={c.name} size={16} />
                  </strong>{' '}
                  — gatilho em {c.triggers} de {s.wipes} wipes
                </li>
              ))}
            </ul>
          ) : (
            <p className="share-muted">Sem gatilhos apontados.</p>
          )}
        </section>
        <section>
          <h4>Precisam de atenção</h4>
          <div className="share-scores">
            {byScore.slice(0, 5).map((x) => (
              <span key={x.guid}>
                <span style={{ color: classColor(x.class) }}>{shortName(x.name)}</span>{' '}
                <span className={`score-pill ${scoreTone(x.avgScore)}`}>{Math.round(x.avgScore)}</span>
              </span>
            ))}
          </div>
          <h4>Destaques</h4>
          <div className="share-scores">
            {byScore
              .slice(-3)
              .reverse()
              .map((x) => (
                <span key={x.guid}>
                  <span style={{ color: classColor(x.class) }}>{shortName(x.name)}</span>{' '}
                  <span className={`score-pill ${scoreTone(x.avgScore)}`}>{Math.round(x.avgScore)}</span>
                </span>
              ))}
          </div>
        </section>
      </div>
      <footer className="share-foot">
        <span className="share-muted">Nota média 0–100 · entre trys: média {mmss(s.avgGapMs)}</span>
        <Brand />
      </footer>
    </div>
  );
}
