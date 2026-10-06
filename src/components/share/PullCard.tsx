import type { Pull } from '../../types';
import { mmss, num, pct } from '../../lib/format';
import { scorePull, scoreTone } from '../../lib/score';
import { analyzePull, lowestBossHp } from '../../lib/verdict';
import { mechanicSpellId } from '../../lib/spells';
import { getNote } from '../../lib/notes';
import { PositionMap, type Mark } from '../PositionMap';
import { SpellIcon, SpellName } from '../SpellIcon';
import { BossName, Colored } from '../Names';
import { ATTENTION_SCORE, Card, More, ScoreChips, Section, Who, dateOf, timeOf, type CardDetail } from './common';
import { tr, useMessages } from '../../i18n';
import { shareMsg } from './share.i18n';

const SUMMARY = { findings: 3, deaths: 3, scores: 4 };

/**
 * Um pull. Resumo: o veredito, os 3 achados principais, as mortes decisivas, quem ficou abaixo
 * de 80 e o mapa da falha. Completo: todos os achados, cada morte em ordem, as mecânicas com
 * quem errou, os interrupts que passaram e a tabela dos jogadores.
 */
export function PullShareCard({ pull: p, detail = 'summary' }: { pull: Pull; detail?: CardDetail }) {
  const t = useMessages(shareMsg);
  const full = detail === 'full';
  const v = analyzePull(p);
  const hp = lowestBossHp(p);
  const scores = scorePull(p);
  const scored = p.players.map((x) => ({ guid: x.guid, name: x.name, class: x.class, score: scores.get(x.guid)?.score ?? 100 })).sort((a, b) => a.score - b.score);
  const lowest = scored.filter((r) => r.score < ATTENTION_SCORE);
  const findings = v.findings.filter((f) => full || (f.severity !== 'minor' && f.severity !== 'info'));
  const shownFindings = full ? findings : findings.slice(0, SUMMARY.findings);
  const decisive = full ? v.decisiveDeaths : v.decisiveDeaths.slice(0, SUMMARY.deaths);
  const trigger = p.trigger ? p.mechanics.find((m) => m.key === p.trigger!.key) : null;
  const snap = trigger?.snapshots?.[0];
  const classes = new Map(p.players.map((x) => [x.guid, x.class] as const));
  const marks = new Map<string, Mark>(trigger?.kind === 'failure_event' ? trigger.players.filter((x) => !x.credit).map((x) => [x.guid, 'culprit'] as const) : []);
  const note = getNote(p).trim();
  const counted = p.deaths.filter((d) => !d.ignored);

  return (
    <Card
      tone={p.success ? 'kill' : 'wipe'}
      wide={full}
      title={<BossName encounterId={p.encounterId} name={`${p.success ? 'Kill' : t.pullTitle(p.pullNumber)} — ${p.encounterName} ${p.difficultyName}`} size={22} />}
      sub={`${dateOf(p)} ${timeOf(p)} · ${mmss(p.durationMs)} · ${t.deaths(counted.length)}`}
      big={!p.success && hp != null ? pct(hp) : undefined}
      foot={full ? t.pullFoot : undefined}
    >
      <p className="share-headline">{v.headline}</p>
      {note && <p className="share-note">“{note}”</p>}

      <div className="share-cols">
        <div>
          {shownFindings.length > 0 && (
            <Section title={t.wentWrong}>
              <ul>
                {shownFindings.map((f, i) => (
                  <li key={i} className={f.severity}>
                    {f.spellId != null && <SpellIcon spellId={f.spellId} size={16} />}{' '}
                    <strong>
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
                {!full && <More n={findings.length - shownFindings.length} />}
              </ul>
            </Section>
          )}
          {decisive.length > 0 && (
            <Section title={t.decisiveDeaths}>
              <ul>
                {decisive.map((d) => (
                  <li key={`${d.guid}:${d.t}`}>
                    <Who name={d.name} cls={d.class} /> {mmss(d.t)} —{' '}
                    <SpellName
                      spellId={d.causedBy ? (mechanicSpellId(p, d.causedBy.key) ?? d.killingBlow?.spellId) : d.killingBlow?.spellId}
                      name={d.killingBlowMechanic ?? d.killingBlow?.spellName ?? '?'}
                      size={16}
                    />
                    {d.defensivesRecent.length === 0 && d.defensivesAvailable.length > 0 && <span className="share-muted">{t.noDefensive}</span>}
                  </li>
                ))}
                {!full && <More n={v.decisiveDeaths.length - decisive.length} />}
              </ul>
            </Section>
          )}
          {lowest.length > 0 && (
            <Section title={t.below80} aside={!full && lowest.length > SUMMARY.scores ? `+${lowest.length - SUMMARY.scores}` : undefined}>
              <ScoreChips list={full ? lowest : lowest.slice(0, SUMMARY.scores)} />
            </Section>
          )}
        </div>
        {snap && (
          <div className="share-map">
            <h4>{t.positions(mmss(snap.t))}</h4>
            <PositionMap snap={snap} classes={classes} marks={marks} size={230} />
            <p className="share-legend">
              <span className="lg-boss" /> boss · <span className="lg-player" /> {t.legendPlayer}
              {marks.size > 0 && (
                <>
                  {' '}
                  · <span className="lg-culprit" /> {t.missed(trigger!.name)}
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {full && <PullDetails pull={p} />}
    </Card>
  );
}

/** Só no completo: cada morte, as mecânicas, os interrupts e os jogadores. */
function PullDetails({ pull: p }: { pull: Pull }) {
  const t = useMessages(shareMsg);
  const scores = scorePull(p);
  const deaths = [...p.deaths].filter((d) => !d.ignored).sort((a, b) => a.t - b.t);
  const mechanics = p.mechanics.filter((m) => m.evaluated && m.failures > 0 && m.severity !== 'none');
  const passed = p.enemySpells.filter((e) => e.interruptible && e.casts > e.interrupted);
  const players = [...p.players].sort((a, b) => (scores.get(a.guid)?.score ?? 100) - (scores.get(b.guid)?.score ?? 100));
  return (
    <>
      {deaths.length > 0 && (
        <Section title={t.deathsInOrder}>
          <ol className="share-deaths">
            {deaths.map((d) => (
              <li key={`${d.guid}:${d.t}`}>
                <span className="tabular share-muted">{mmss(d.t)}</span> <Who name={d.name} cls={d.class} /> —{' '}
                {d.killingBlowMechanic ?? d.killingBlow?.spellName ?? '?'}
                {d.causedBy && d.causedBy.name !== (d.killingBlowMechanic ?? d.killingBlow?.spellName) && <span className="share-muted">{t.after(d.causedBy.name)}</span>}
              </li>
            ))}
          </ol>
        </Section>
      )}
      {mechanics.length > 0 && (
        <Section title={t.mechanics}>
          <ul>
            {mechanics.map((m) => {
              const who = m.players.filter((x) => !x.credit && x.count > 0);
              return (
                <li key={m.key} className={m.severity}>
                  {m.spellId != null && <SpellIcon spellId={m.spellId} size={16} />} <strong>{m.name}</strong> — {tr(m.summary) || t.failures(m.failures)}
                  {who.length > 0 && (
                    <span className="share-muted">
                      {' '}
                      ·{' '}
                      {who.map((x, i) => (
                        <span key={x.guid}>
                          {i > 0 && ', '}
                          <Who name={x.name} cls={p.players.find((pl) => pl.guid === x.guid)?.class} />
                          {x.count > 1 ? ` ${x.count}×` : ''}
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {passed.length > 0 && (
        <Section title={t.interruptsPassed}>
          <ul>
            {passed.map((e) => (
              <li key={e.spellId}>
                <SpellName spellId={e.spellId} name={e.name} size={16} /> — {t.outOf(e.casts - e.interrupted, e.casts)}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={t.players}>
        <table className="share-table">
          <thead>
            <tr>
              <th>{t.player}</th>
              <th className="num">{t.score}</th>
              <th className="num">DPS</th>
              <th className="num">HPS</th>
              <th className="num">{t.damageTaken}</th>
              <th className="num">{t.interrupts}</th>
            </tr>
          </thead>
          <tbody>
            {players.map((x) => {
              const s = scores.get(x.guid)?.score ?? 100;
              return (
                <tr key={x.guid}>
                  <td>
                    <Who name={x.name} cls={x.class} />
                  </td>
                  <td className="num">
                    <span className={`score-pill ${scoreTone(s)}`}>{s}</span>
                  </td>
                  <td className="num">{num(x.dps)}</td>
                  <td className="num">{x.hps > 0 ? num(x.hps) : '—'}</td>
                  <td className="num">{num(x.damageTaken)}</td>
                  <td className="num">{x.interrupts || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </>
  );
}
