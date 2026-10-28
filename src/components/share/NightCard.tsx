import type { Pull } from '../../types';
import { mmss } from '../../lib/format';
import { groupByBoss, summarizeNight } from '../../lib/night';
import { raidOnly } from '../../lib/content';
import { bestWipe, progressLabel } from '../../lib/phases';
import { BossName } from '../Names';
import { ATTENTION_SCORE, Card, Section, Who, dateOf, hm, timeOf, type CardDetail } from './common';
import { CausesSection, PeopleSection, Scoreboard } from './BossCard';
import { intlLocale, useMessages } from '../../i18n';
import { shareMsg } from './share.i18n';
import { SpellName } from '../SpellIcon';
import { nightBossMetrics, type MetricNight } from '../../lib/bossMetrics';
import { bossMetricsMsg } from '../BossMetrics.i18n';

/**
 * A noite inteira (só raid). Resumo: cada boss com kill ou melhor %, as maiores causas, quem
 * ficou abaixo de 80 e os destaques. Completo: o tempo e os wipes de cada boss, todas as causas
 * e o placar dos jogadores.
 */
export function NightShareCard({ pulls: all, detail = 'summary' }: { pulls: Pull[]; detail?: CardDetail }) {
  const t = useMessages(shareMsg);
  const full = detail === 'full';
  const pulls = raidOnly(all);
  const s = summarizeNight(pulls);
  const causes = s.causes.filter((c) => c.triggers > 0);
  const players = [...s.players].filter((x) => x.pulls >= Math.max(1, s.pulls.length / 3)).sort((a, b) => a.avgScore - b.avgScore);
  const attention = players.filter((x) => x.avgScore < ATTENTION_SCORE);
  const first = s.pulls[0];
  const end = new Date(s.endMs).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  const combatPct = s.totalMs > 0 ? Math.round((s.combatMs / s.totalMs) * 100) : 0;

  return (
    <Card
      tone={s.kills ? 'kill' : 'wipe'}
      wide={full}
      title={t.nightTitle}
      sub={t.nightSub(first ? `${dateOf(first)} · ${timeOf(first)}–${end} · ` : '', hm(s.totalMs), combatPct, s.pulls.length)}
      big={t.kills(s.kills)}
      foot={t.nightFoot(mmss(s.avgGapMs), hm(s.downtimeMs)) + (full ? t.fullReport : '')}
    >
      <ul className={`share-night-bosses ${full ? 'full' : ''}`}>
        {groupByBoss(pulls).map(({ key, pulls: ps }) => {
          const kill = ps.find((p) => p.success);
          const wipes = ps.filter((p) => !p.success);
          const top = bestWipe(wipes);
          const best = top ? progressLabel(top) : null;
          const time = ps.reduce((n, p) => n + p.durationMs, 0);
          return (
            <li key={key}>
              <BossName encounterId={ps[0].encounterId} name={key} size={18} />
              <span className="share-muted">
                {t.pulls(ps.length)}
                {full && wipes.length > 0 && ` · ${t.wipes(wipes.length)}`}
                {full && t.inCombat(mmss(time))}
                {full && kill && best != null && t.bestWipe(best)}
              </span>
              <strong className={kill ? 'share-kill' : 'share-wipe'}>{kill ? 'Kill' : best ?? '—'}</strong>
            </li>
          );
        })}
      </ul>

      <div className="share-cols">
        <CausesSection title={t.topWipeCauses} causes={causes} wipes={s.wipes} pulls={pulls} full={full} />
        <PeopleSection attention={attention} players={players} full={full} />
      </div>

      <GroupMetrics pulls={pulls} full={full} />

      {full && <Scoreboard players={players} />}
    </Card>
  );
}

/** Quantos players aparecem por métrica no resumo (o completo mostra todos). */
const METRIC_PEOPLE = 3;

/** As Métricas do grupo que o usuário escolheu no resumo de cada boss (salvas por boss). */
function GroupMetrics({ pulls, full }: { pulls: Pull[]; full: boolean }) {
  const t = useMessages(shareMsg);
  const bosses = nightBossMetrics(pulls);
  if (!bosses.length) return null;
  return (
    <Section title={t.groupMetrics}>
      {bosses.map((b) => (
        <div key={b.key} className="share-metrics">
          {bosses.length > 1 && <BossName encounterId={b.encounterId} name={b.key} size={16} />}
          <ul>
            {b.metrics.map((m) => (
              <MetricLine key={m.key} m={m} full={full} />
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

function MetricLine({ m, full }: { m: MetricNight; full: boolean }) {
  const t = useMessages(bossMetricsMsg);
  const ts = useMessages(shareMsg);
  const yd = m.unit === 'yd';
  const stack = m.kind === 'stack_limit';
  const all = m.perPull.length;
  const stats = yd
    ? m.total === 0
      ? t.cleanYards
      : t.statsYards(m.total, m.pullsWithFailure, all)
    : m.total === 0
      ? t.clean
      : stack
        ? t.statsStack(m.players.length, m.pullsWithFailure, all)
        : t.stats(m.total, m.pullsWithFailure, all);
  const people = full ? m.players : m.players.slice(0, METRIC_PEOPLE);
  return (
    <li>
      <strong>
        <SpellName spellId={m.spellId} name={m.name} size={16} />
      </strong>{' '}
      <span className={m.total ? 'share-muted' : 'share-kill'}>— {stats}</span>
      {people.length > 0 && (
        <div className="share-metric-people">
          {people.map((p, i) => (
            <span key={p.guid}>
              {i > 0 && ' · '}
              <Who name={p.name} cls={p.class} /> <span className="share-muted">{yd ? t.yards(p.count) : stack ? t.maxStacks(p.max) : t.times(p.count)}</span>
            </span>
          ))}
          {m.players.length > people.length && <span className="share-muted"> · {ts.more(m.players.length - people.length)}</span>}
        </div>
      )}
    </li>
  );
}
