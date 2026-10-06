import type { Pull } from '../../types';
import { mmss, pct } from '../../lib/format';
import { groupByBoss, summarizeNight } from '../../lib/night';
import { raidOnly } from '../../lib/content';
import { lowestBossHp } from '../../lib/verdict';
import { BossName } from '../Names';
import { ATTENTION_SCORE, Card, dateOf, hm, timeOf, type CardDetail } from './common';
import { CausesSection, PeopleSection, Scoreboard } from './BossCard';
import { intlLocale, useMessages } from '../../i18n';
import { shareMsg } from './share.i18n';

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
          const best = wipes.reduce<number | null>((m, p) => {
            const hp = lowestBossHp(p);
            return hp != null && (m == null || hp < m) ? hp : m;
          }, null);
          const time = ps.reduce((n, p) => n + p.durationMs, 0);
          return (
            <li key={key}>
              <BossName encounterId={ps[0].encounterId} name={key} size={18} />
              <span className="share-muted">
                {t.pulls(ps.length)}
                {full && wipes.length > 0 && ` · ${t.wipes(wipes.length)}`}
                {full && t.inCombat(mmss(time))}
                {full && kill && best != null && t.bestWipe(pct(best))}
              </span>
              <strong className={kill ? 'share-kill' : 'share-wipe'}>{kill ? 'Kill' : best != null ? pct(best) : '—'}</strong>
            </li>
          );
        })}
      </ul>

      <div className="share-cols">
        <CausesSection title={t.topWipeCauses} causes={causes} wipes={s.wipes} pulls={pulls} full={full} />
        <PeopleSection attention={attention} players={players} full={full} />
      </div>

      {full && <Scoreboard players={players} />}
    </Card>
  );
}
